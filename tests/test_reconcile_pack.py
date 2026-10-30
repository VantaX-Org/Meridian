"""The reconciliation pack (api/services/reconcile.py): the SE16 selection of a rule, derived from its YAML and check
type, without a database. The route is tested against Postgres in tests/test_reconcile_pg.py."""
from __future__ import annotations

from api.services import reconcile as rc


def _pack(rule: dict, details: dict | None = None, keys: list[str] | None = None, grain: str | None = None,
          category: str = "ecc", as_of: str = "2026-10-20") -> dict:
    return rc.build_pack(rule={"id": "T1", **rule}, check_id="T1", module="material_master", category=category,
                         finding={"total_count": 1000, "affected_count": 42, "details": details or {}},
                         sample_keys=keys or [], grain=grain, as_of=as_of)


def _ops(lines: list[dict]) -> list[tuple[str, str, str, list[str]]]:
    return [(x["table"], x["field"], x["operator"], x["values"]) for x in lines]


def test_null_check_on_one_table_is_one_se16_selection_with_the_deletion_flag():
    p = _pack({"check_class": "null_check", "field": "MARA.NTGEW"})
    assert p["se16"] is True and p["transaction"] == "SE16N" and p["grain"]["table"] == "MARA"
    assert _ops(p["population_selection"]) == [("MARA", "LVORM", "initial", [])]
    assert _ops(p["failing_selection"]) == [("MARA", "NTGEW", "initial", [])]
    assert p["conditions"] == [] and p["joins"] == []
    assert (p["population"], p["failing"]) == (1000, 42)
    assert p["grain"]["key_fields"] == ["MATNR"]  # the DDIC key without the client


def test_applies_when_becomes_population_lines():
    p = _pack({"check_class": "null_check", "field": "MARC.DISPO",
               "applies_when": {"MARC.BESKZ": ["E", "X"], "MARC.DISMM": {"populated": True, "not_in": ["ND"]},
                                "MARC.MMSTD": {"older_than_days": 30}}})
    lines = _ops(p["population_selection"])
    assert ("MARC", "BESKZ", "in", ["E", "X"]) in lines
    assert ("MARC", "DISMM", "not_in", ["ND"]) in lines and ("MARC", "DISMM", "not_initial", []) in lines
    assert ("MARC", "MMSTD", "LT", ["20260920"]) in lines  # 30 days before the run's as-of date
    # MARA.LVORM is the central deletion flag of a plant record: a join, so not one SE16 selection
    assert ("MARA", "LVORM", "initial", []) in lines and p["se16"] is False
    assert [j["words"] for j in p["joins"]] == ["MARC to MARA on MARC.MATNR = MARA.MATNR"]
    assert any(c["kind"] == "join" for c in p["conditions"])


def test_population_all_drops_the_exclusions():
    p = _pack({"check_class": "null_check", "field": "MARA.NTGEW", "population": "all"})
    assert p["population_selection"] == []


def test_a_pattern_is_said_in_words_with_the_closest_selection():
    p = _pack({"check_class": "regex_check", "field": "MARA.MATNR", "pattern": "^[A-Z0-9]+$"})
    assert p["se16"] is False and p["transaction"] == "SE16H"
    assert ("MARA", "MATNR", "not_initial", []) in _ops(p["population_selection"])
    assert [(c["kind"], c["params"]) for c in p["conditions"]] == [("pattern", {"pattern": "^[A-Z0-9]+$"})]
    assert "does not match the pattern ^[A-Z0-9]+$" in p["conditions"][0]["words"]


def test_value_list_is_an_exclusion_selection_and_a_live_check_table_is_a_lookup():
    listed = _pack({"check_class": "domain_value_check", "field": "MARA.MTART"},
                   details={"allowed_values": ["FERT", "HALB"], "reference_source": "rule_baseline"})
    assert _ops(listed["failing_selection"]) == [("MARA", "MTART", "not_in", ["FERT", "HALB"])] and listed["se16"] is True
    live = _pack({"check_class": "domain_value_check", "field": "MARA.MTART"},
                 details={"allowed_values": "12 values from live T134.MTART", "reference_source": "live_config",
                          "reference_table": "T134.MTART"})
    assert live["failing_selection"] == [] and live["se16"] is False
    assert [(c["kind"], c["params"]) for c in live["conditions"]] == [("not_in_check_table", {"table": "T134", "field": "MTART"})]


def test_freshness_is_a_date_selection_from_the_stored_cutoff():
    p = _pack({"check_class": "freshness_check", "field": "MARA.LAEDA", "max_age_hours": 720},
              details={"cutoff_datetime": "2026-09-20T00:00:00+00:00"})
    assert ("MARA", "LAEDA", "LT", ["20260920"]) in _ops(p["failing_selection"])
    assert [c["kind"] for c in p["conditions"]] == ["not_a_date"]


def test_uniqueness_and_exists_are_not_se16_selections():
    u = _pack({"check_class": "uniqueness_check", "fields": ["LFA1.STCD1"]}, grain="LFA1")
    assert u["se16"] is False and [c["kind"] for c in u["conditions"]] == ["duplicate"]
    e = _pack({"check_class": "exists_check", "field": "LFB1.LNRZE", "target_table": "LFA1", "target_fields": ["LIFNR"]},
              grain="LFB1")
    c = next(x for x in e["conditions"] if x["kind"] == "missing_in_target")
    assert c["params"]["table"] == "LFA1" and c["params"]["target_fields"] == ["LFA1.LIFNR"]


def test_cross_field_and_group_checks_say_the_condition():
    x = _pack({"check_class": "cross_field_check", "fail_when": "`MARA.BRGEW` < `MARA.NTGEW`", "require_populated": True})
    assert ("MARA", "BRGEW", "not_initial", []) in _ops(x["population_selection"])
    assert x["conditions"][0]["kind"] == "expression_true" and "`MARA.BRGEW` < `MARA.NTGEW`" in x["conditions"][0]["words"]
    b = _pack({"check_class": "balance_check", "group_by": ["BSEG.BUKRS", "BSEG.BELNR", "BSEG.GJAHR"],
               "amount": "BSEG.DMBTR", "sign_field": "BSEG.SHKZG"}, grain="BSEG")
    assert b["conditions"][0]["kind"] == "group_logic" and "net to zero in BSEG.DMBTR" in b["conditions"][0]["words"]


def test_sample_keys_are_alpha_formatted_with_the_raw_key_alongside():
    p = _pack({"check_class": "null_check", "field": "MARC.DISPO"}, grain="MARC",
              keys=["MATNR=000000000000000232|WERKS=3000", "MATNR=ABC-1|WERKS=0001"])
    k = p["sample_keys"]
    assert k[0]["raw"] == "MATNR=000000000000000232|WERKS=3000" and k[0]["display"] == "MATNR 232, WERKS 3000"
    assert k[1]["display"] == "MATNR ABC-1, WERKS 0001"  # not numeric, and WERKS has no ALPHA exit: as stored
    assert p["grain"]["key_fields"] == ["MATNR", "WERKS"]
    lifnr = rc.display_key("LIFNR=0000100001", "LFA1")
    assert lifnr["fields"] == [{"field": "LIFNR", "raw": "0000100001", "display": "100001"}]


def test_cloud_rules_name_no_transaction():
    p = _pack({"check_class": "null_check", "field": "EMPJOBHIST.USERID"}, category="successfactors")
    assert p["system"] == "cloud" and p["transaction"] is None and p["se16"] is False
    assert "SE16 does not apply" in rc.steps_in_words(p)[0]


def test_steps_and_summary_words():
    p = _pack({"check_class": "null_check", "field": "MARA.NTGEW"})
    steps = rc.steps_in_words(p)
    assert steps[0] == "Open SE16N and enter table MARA." and steps[-1] == "Count the entries: Meridian measured 42 failing records."
    assert rc.selection_in_words(p) == ("MARA-LVORM is initial (leave the value empty with option =); "
                                        "MARA-NTGEW is initial (leave the value empty with option =)")
