"""Mining logic that needs no database (spec §3.1, §3.3, §3.4, §3.5, §3.7)."""

from __future__ import annotations

import hashlib
from datetime import date

import pytest
from pydantic import ValidationError

from api.services.process_discovery.builders import builder
from api.services.process_discovery.filters import ProcessFilter, case_filter_sql
from api.services.process_discovery.mining import (
    OTHER, OTHER_HASH, ActivityStats, CaseTypeResult, Conformance, Edge, MiningResult, Scope, Variant,
    cache_key, conformance, expected_groups, is_unmapped, loops, score_variant, truncate, _order_of,
)
from api.services.process_discovery.events import ActivityMap

PTP = [m for m in builder("PTP").MAPPING if m.case_type == "po_item"]
HAPPY = ("CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE")


def v(acts: tuple[str, ...], n: int, h: str = "") -> Variant:
    return Variant(h or hashlib.md5(">".join(acts).encode()).hexdigest(), acts, n, 0.0, None, None, ("c",))


def test_expected_groups_follow_order() -> None:
    assert expected_groups(PTP) == [frozenset({k}) for k in HAPPY]


def test_happy_path_fits_and_optional_steps_are_not_extra() -> None:
    order = _order_of(PTP)
    groups = expected_groups(PTP)
    assert score_variant(HAPPY, groups, order)[0] == 1.0
    fit, missing, bad = score_variant(("CREATE_PR", "CREATE_PO_ITEM", "CHANGE_PO_QTY", *HAPPY[1:]), groups, order)
    assert (fit, missing, bad) == (1.0, [], set())


def test_missing_extra_and_out_of_order() -> None:
    order = _order_of(PTP)
    groups = expected_groups(PTP)
    # GR missing (1), ZZ unmapped (1), INVOICE before CREATE_PO_ITEM: one inverted pair (1). 3 / (4 + 4)
    fit, missing, bad = score_variant(("INVOICE_RECEIPT", "CREATE_PO_ITEM", "ZZ", "CLEAR_INVOICE"), groups, order)
    assert fit == pytest.approx(1 - 3 / 8)
    assert missing == [frozenset({"GOODS_RECEIPT"})]
    assert bad == {"INVOICE_RECEIPT", "CREATE_PO_ITEM"}


def test_repeat_counts_only_first_occurrence_for_order() -> None:
    order = _order_of(PTP)
    fit, _, bad = score_variant((*HAPPY[:2], "CREATE_PO_ITEM", *HAPPY[2:]), expected_groups(PTP), order)
    assert bad == set() and fit == 1.0


def test_alternatives_share_an_order() -> None:
    a = ActivityMap("A", "A", "X-A", "c", "", "", "", 1, True)
    b = ActivityMap("B", "B", "X-B", "c", "", "", "", 1, True)
    z = ActivityMap("Z", "Z", "X-Z", "c", "", "", "", 2, True)
    groups = expected_groups([a, b, z])
    assert groups == [frozenset({"A", "B"}), frozenset({"Z"})]
    assert score_variant(("B", "Z"), groups, _order_of([a, b, z]))[0] == 1.0


def test_runtime_keys_match_their_template_row() -> None:
    m = builder("PM").MAPPING
    order = _order_of(m)
    tmpl = next(x for x in m if x.key == "STATUS_<STAT>")
    assert order("STATUS_TECO") == tmpl.order
    assert order("NOT_A_KEY") is None


def test_conformance_is_weighted_and_other_bucket_scores_zero() -> None:
    vs = [v(HAPPY, 3), v(HAPPY[:1] + HAPPY[2:], 1)]
    rest = [v(HAPPY + (f"X{i}",), 1) for i in range(3)]
    stored = truncate(vs + rest, 7, top=2)
    assert stored[-1].hash == OTHER_HASH and stored[-1].activities == (OTHER,)
    assert stored[-1].case_count == 3 and stored[-1].sample_case_ids == ("c", "c", "c")
    c = conformance(stored, PTP)
    assert stored[-1].fitness == 0.0
    assert stored[0].fitness == 1.0
    assert stored[1].fitness == pytest.approx(round(1 - 1 / 7, 4))
    assert c.fitness == pytest.approx(round((3 * 1 + 1 * (1 - 1 / 7)) / 7, 4))
    assert c.missing["GOODS_RECEIPT"] == pytest.approx(round(4 / 7, 4))
    assert c.step_fitness["CREATE_PO_ITEM"] == pytest.approx(round(1 - 3 / 7, 4))


def test_no_expected_rows_means_no_conformance() -> None:
    opt = [ActivityMap("A", "A", "X-A", "c", "", "", "", 1, False)]
    assert conformance([v(("A",), 2)], opt) == Conformance(None, {}, {}, {})


def test_truncate_keeps_short_lists_whole() -> None:
    vs = [v(HAPPY, 2)]
    assert truncate(vs, 2) == vs


def test_loops_are_back_edges_and_self_loops_are_not() -> None:
    e = [Edge("__START__", "A", 5, 5, None, None), Edge("A", "B", 5, 5, 1, 1), Edge("B", "A", 2, 2, 1, 1),
         Edge("B", "B", 1, 1, 0, 0), Edge("B", "__END__", 5, 5, None, None)]
    assert loops(e) == {("B", "A")}


def test_unmapped_is_the_discovered_branch() -> None:
    assert is_unmapped("R2R-DSC-POST_ZF01-01") and is_unmapped(None)
    assert not is_unmapped("PM-PLN-IW31-X_STATUS_TECO") and not is_unmapped("PTP-GR-MIGO-01")


def test_filter_from_query_and_sql() -> None:
    flt = ProcessFilter.from_query({"from": "2025-01-01", "to": "2025-03-31", "org.BUKRS": ["1000,2000"],
                                    "doc_type": "NB", "automated": "false", "case_type": "po_item"})
    assert flt.period_from == date(2025, 1, 1) and flt.org == {"BUKRS": ["1000", "2000"]}
    assert (flt.doc_type, flt.automated, flt.case_type) == (["NB"], False, "po_item")
    sql, p = case_filter_sql(flt, "Africa/Johannesburg")
    assert "(array_agg(org ->> :f_ok0 ORDER BY ts, seq, id))[1] = ANY(:f_ov0)" in sql
    assert "NOT coalesce(bool_or(automated), false)" in sql
    assert p["f_ok0"] == "BUKRS" and p["f_ov0"] == ["1000", "2000"] and p["f_dt"] == ["NB"]
    assert case_filter_sql(ProcessFilter(), "UTC") == ("TRUE", {"f_tz": "UTC"})


def test_org_key_is_validated_because_it_reaches_the_query() -> None:
    with pytest.raises(ValidationError):
        ProcessFilter(org={"BUKRS'; DROP": ["1"]})


def test_cache_key_changes_with_filter_and_run() -> None:
    s = Scope("t", "s", "PTP")
    a = cache_key(s, ProcessFilter(), "r1")
    assert a.startswith("pd:dfg:t:s:PTP:") and a.endswith(":r1")
    assert a != cache_key(s, ProcessFilter(doc_type=["NB"]), "r1") and a != cache_key(s, ProcessFilter(), "r2")


def test_stats_shape() -> None:
    act = ActivityStats("POST_ZF01", "R2R-DSC-POST_ZF01-01", 4, 2, 1.0, None, None, 0.5, 0.25, 1, 4)
    r = CaseTypeResult("fi_doc", 2, 4, 10.0, 20.0, [], {act.activity: act}, [v(("POST_ZF01",), 2)],
                       Conformance(0.5, {"A": 0.5}, {}, {}))
    s = MiningResult("R2R", "fi_doc", {"fi_doc": r}).stats({"BKPF": {"rows": 4, "partial": False}}, [], 0)
    assert set(s) == {"cases", "events", "variants", "case_types", "throughput", "automation_rate", "conformance",
                      "happy_path", "rework", "tables", "truncated_tables", "shared_objects", "unmapped"}
    assert s["automation_rate"] == 0.25 and s["unmapped"] == {"POST_ZF01": 4} and s["rework"] == {"POST_ZF01": 0.5}
    assert s["throughput"] == {"median_seconds": 10.0, "p90_seconds": 20.0} and s["conformance"]["fitness"] == 0.5


def test_happy_path_is_the_most_common_conformant_variant() -> None:
    """The happy path is the highest-case-count variant that follows the process exactly."""
    # HAPPY is perfectly conformant; the second variant skips GOODS_RECEIPT (missing); the
    # third is HAPPY with a leading rework (extra, still fitness < 1 because of the extra).
    vs = [v(HAPPY, 50, "happy"), v(("CREATE_PO_ITEM", "INVOICE_RECEIPT", "CLEAR_INVOICE"), 30, "skip"),
          v(("CREATE_PO_ITEM", *HAPPY), 20, "rework")]
    r = CaseTypeResult("po_item", 100, 400, None, None, [], {}, vs)
    r.conformance = conformance(vs, PTP)  # sets each variant's fitness

    hp = r.happy_path()

    assert hp["activities"] == list(HAPPY)
    assert hp["case_count"] == 50
    assert hp["share"] == 0.5
    assert hp["fitness"] == 1.0


def test_happy_path_is_empty_when_no_variant_conforms() -> None:
    vs = [v(("INVOICE_RECEIPT", "CREATE_PO_ITEM"), 100, "bad")]
    r = CaseTypeResult("po_item", 100, 200, None, None, [], {}, vs)
    r.conformance = conformance(vs, PTP)
    assert r.happy_path() == {"activities": [], "case_count": 0, "share": 0.0, "fitness": None}
