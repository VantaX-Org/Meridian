"""L1-L5 generation from a mining result (spec §4). No database."""

from __future__ import annotations

import re
from collections import Counter

import pytest

from api.models.process_model import ID_PATTERN, ProcessModelDocument
from api.services.process_discovery.builders import builder
from api.services.process_discovery.generate import generate, keep_edges, label_of, mapping_row, node_key, unique_keys
from api.services.process_discovery.mining import (END, ActivityStats, CaseTypeResult, Edge, MiningResult, Variant,
                                                   conformance)
from api.services.process_model_validator import validate_document
from sap.process_definitions import reference_document

MAP = builder("PTP").MAPPING
HAPPY = ("CREATE_PO_ITEM", "GOODS_RECEIPT", "INVOICE_RECEIPT", "CLEAR_INVOICE")
REWORK = ("CREATE_PO_ITEM", "CHANGE_PO_QTY", "CHANGE_PO_QTY", *HAPPY[1:])
ODD = ("CREATE_PO_ITEM", "ZZ_NEW", "INVOICE_RECEIPT")


def _result(case_type: str, variants: list[tuple[tuple[str, ...], int]], edges=(), mapping=MAP) -> CaseTypeResult:
    """A CaseTypeResult whose activity stats are counted from the variants, as the SQL would."""
    rows = {m.key: m for m in mapping if m.case_type == case_type}
    total = sum(n for _, n in variants)
    vs = [Variant(f"{i:032x}", acts, n, n / total, 100.0 * (i + 1), 200.0 * (i + 1), ("c",))
          for i, (acts, n) in enumerate(variants)]
    ev: Counter[str] = Counter()
    cs: Counter[str] = Counter()
    rw: Counter[str] = Counter()
    for acts, n in variants:
        for a, k in Counter(acts).items():
            ev[a] += k * n
            cs[a] += n
            rw[a] += n if k > 1 else 0
    acts = {a: ActivityStats(a, rows[a].l5_id if a in rows else None, ev[a], cs[a], cs[a] / total, 60.0, 120.0,
                             rw[a] / cs[a], 0.5, ev[a] // 2, ev[a]) for a in ev}
    r = CaseTypeResult(case_type, total, sum(ev.values()), 3600.0, 7200.0, list(edges), acts, vs)
    r.conformance = conformance(r.stored(), list(rows.values()))
    return r


@pytest.fixture(scope="module")
def mined() -> MiningResult:
    po = _result("po_item", [(HAPPY, 6), (REWORK, 3), (ODD, 1)],
                 [Edge("CREATE_PO_ITEM", "CHANGE_PO_QTY", 3, 3, 3600.0, 7200.0)])
    return MiningResult("PTP", "po_item", {"po_item": po, "vendor": _result("vendor", [(("CREATE_VENDOR",), 2)])})


@pytest.fixture(scope="module")
def gen(mined):
    return generate(reference_document(), mined, MAP, system_type="ecc")


def _nodes(doc: ProcessModelDocument) -> dict:
    out = {}
    for l1 in doc.l1:
        out[l1.id] = l1
        for b in l1.l2:
            out[b.id] = b
            for c in b.l3:
                out[c.id] = c
                for d in c.l4:
                    out[d.id] = d
                    out.update({a.id: a for a in d.activities})
    return out


def test_document_is_the_one_l1_and_discovered(gen) -> None:
    doc = gen.document
    assert [x.id for x in doc.l1] == ["PTP"] and doc.source == "discovered" and doc.system_type == "ecc"
    assert doc.l1[0].discovery.case_count == 10 and doc.l1[0].discovery.share == 1.0
    assert doc.l1[0].discovery.median_seconds == 3600.0 and doc.l1[0].discovery.case_type == "po_item"


def test_rule_1_reference_l5_gets_stats_and_sibling_edges(gen) -> None:
    d = _nodes(gen.document)["PTP-PO-ME21N-02"].discovery
    assert (d.observed, d.case_type, d.case_count, d.event_count, d.entry_count) == (True, "po_item", 10, 10, 10)
    assert d.share == 1.0 and d.rework_rate == 0.0 and d.automation_rate == 0.5
    assert [(e.target, e.count, e.median_seconds) for e in d.edges] == [
        ("PTP-PO-ME21N-X_CHANGE_QTY", 3, 3600.0), (END, 7, None)]
    assert _nodes(gen.document)["PTP-GR-MIGO-01"].discovery.fitness == pytest.approx(0.9)


def test_rule_2_extra_l5_is_added_under_its_l4(gen) -> None:
    a = _nodes(gen.document)["PTP-PO-ME21N-X_CHANGE_QTY"]
    assert (a.source, a.name, [f.field for f in a.fields], a.sap_tables) == (
        "discovered", "Change order quantity", ["EKPO.MENGE"], ["EKPO"])
    assert (a.discovery.event_count, a.discovery.case_count, a.discovery.rework_rate) == (6, 3, 1.0)
    assert [(e.target, e.count) for e in a.discovery.edges] == [(END, 3)]


def test_rule_3_unmapped_activity_goes_to_the_dsc_branch(gen) -> None:
    n = _nodes(gen.document)
    assert n["PTP-DSC"].source == n["PTP-DSC-P1"].source == n["PTP-DSC-ZZ_NEW"].source == "discovered"
    assert n["PTP-DSC"].name == "Discovered, not in reference" and n["PTP-DSC-ZZ_NEW"].name == "ZZ_NEW"
    assert n["PTP-DSC-ZZ_NEW-01"].discovery.case_count == 1
    assert gen.l5_of[("po_item", "ZZ_NEW")] == "PTP-DSC-ZZ_NEW-01"


def test_rule_4_reference_nodes_without_cases_are_not_observed(gen) -> None:
    n = _nodes(gen.document)
    for x in ("PTP-PO-ME21N-01", "PTP-PR-ME51N-01", "PTP-PR"):
        assert n[x].discovery.observed is False and n[x].discovery.case_count == 0


def test_l2_edges_and_case_types(gen) -> None:
    n = _nodes(gen.document)
    flow = {(x, e.target): e.count for x in ("PTP-PO", "PTP-GR", "PTP-IV", "PTP-PAY", "PTP-DSC")
            for e in n[x].discovery.edges}
    assert flow == {("PTP-PO", "PTP-GR"): 9, ("PTP-PO", "PTP-DSC"): 1, ("PTP-DSC", "PTP-IV"): 1,
                    ("PTP-GR", "PTP-IV"): 9, ("PTP-IV", "PTP-PAY"): 9, ("PTP-IV", END): 1, ("PTP-PAY", END): 9}
    assert n["PTP-VM"].discovery.case_type == "vendor" and n["PTP-VM"].discovery.case_count == 2
    assert n["PTP-PO"].discovery.rework_rate == 0.0 and n["PTP-PO-ME21N"].discovery.event_count == 16


def test_l4_diagram_is_the_as_is_flow(gen) -> None:
    d = _nodes(gen.document)["PTP-PO-ME21N"].diagram
    flows = {(f.source, f.target) for f in d.flows}
    assert ("PTP-PO-ME21N-S", "PTP-PO-ME21N-02-T") in flows
    assert {("PTP-PO-ME21N-02-T", "PTP-PO-ME21N-02-GO"), ("PTP-PO-ME21N-02-GO", "PTP-PO-ME21N-X_CHANGE_QTY-T"),
            ("PTP-PO-ME21N-02-GO", "PTP-PO-ME21N-E"), ("PTP-PO-ME21N-X_CHANGE_QTY-T", "PTP-PO-ME21N-E")} <= flows
    assert {f.label for f in d.flows if f.source == "PTP-PO-ME21N-02-GO"} == {"3 cases", "7 cases"}
    loose = next(x for x in d.nodes if x.activity_id == "PTP-PO-ME21N-01")
    assert all(loose.id not in (f.source, f.target) for f in d.flows)


def test_generated_model_validates_and_every_id_matches(gen) -> None:
    res = validate_document(gen.document, check_ids=[])
    assert res.errors == []
    pat = re.compile(ID_PATTERN)
    for x in _nodes(gen.document):
        assert pat.match(x), x
    for l4 in gen.document.all_l4():
        assert all(pat.match(n.id) for n in l4.diagram.nodes) and all(pat.match(f.id) for f in l4.diagram.flows)


def test_documents_without_discovery_still_load() -> None:
    raw = reference_document().model_dump()
    for l1 in raw["l1"]:
        for x in (l1, *l1["l2"], *(c for b in l1["l2"] for c in b["l3"])):
            x.pop("discovery"), x.pop("source")
    assert validate_document(ProcessModelDocument.model_validate(raw), check_ids=[]).errors == []


def test_generation_is_deterministic_and_leaves_the_base_alone(mined) -> None:
    base = reference_document()
    before = base.model_dump_json()
    a, b = generate(base, mined, MAP), generate(base, mined, MAP)
    assert a.document.model_dump_json() == b.document.model_dump_json() and a.l5_of == b.l5_of
    assert base.model_dump_json() == before


def test_l5_of_covers_every_activity(gen, mined) -> None:
    assert set(gen.l5_of) == {(ct, a) for ct, r in mined.by_type.items() for a in r.activities}
    assert gen.l5_of[("po_item", "CHANGE_PO_QTY")] == "PTP-PO-ME21N-X_CHANGE_QTY"
    assert gen.l5_of[("vendor", "CREATE_VENDOR")] == "PTP-VM-FK01-01"


def test_unknown_l1_is_rejected(mined) -> None:
    with pytest.raises(ValueError):
        generate(reference_document(), MiningResult("NOPE", "x", {}), MAP)


def test_keep_edges_prunes_and_repairs_reachability() -> None:
    edges = [("S", "A", 1000), ("A", "B", 995), ("A", "C", 5), ("B", "C", 3), ("B", "E", 992), ("C", "E", 8)]
    assert keep_edges(edges, 1000, ["S"]) == [("S", "A", 1000), ("A", "B", 995), ("A", "C", 5), ("B", "E", 992),
                                              ("C", "E", 8)]


def test_runtime_keys_take_their_template_label() -> None:
    pm = builder("PM").MAPPING
    row = mapping_row("STATUS_TECO", pm)
    assert row.key == "STATUS_<STAT>" and label_of("STATUS_TECO", row) == "Set status TECO"
    assert label_of("ZZ", None) == "ZZ" and node_key("a.b-c") == "A_B_C"


def test_colliding_activity_names_get_distinct_keys_and_l4s() -> None:
    acts = ["a.b", "a_b", "A.B", "CREATE_PO_ITEM"]
    assert len({node_key(a) for a in acts[:3]}) == 1  # the plain key does collide
    keys = unique_keys(reversed(acts))
    assert len(set(keys.values())) == 4 and keys == unique_keys(acts)
    po = _result("po_item", [(("CREATE_PO_ITEM", "a.b", "a_b", "A.B"), 2)])
    g = generate(reference_document(), MiningResult("PTP", "po_item", {"po_item": po}), MAP)
    dsc = [x for x in _nodes(g.document) if x.startswith("PTP-DSC-") and x.count("-") == 2 and x != "PTP-DSC-P1"]
    assert len(dsc) == 3 and len({g.l5_of[("po_item", a)] for a in acts[:3]}) == 3
    assert validate_document(g.document, check_ids=[]).errors == []


def test_output_is_invariant_to_variant_edge_and_mapping_order() -> None:
    variants = [(HAPPY, 6), (REWORK, 3), (ODD, 1)]
    edges = [Edge("CREATE_PO_ITEM", "CHANGE_PO_QTY", 3, 3, 3600.0, 7200.0),
             Edge("CREATE_PO_ITEM", "GOODS_RECEIPT", 6, 6, 60.0, 90.0), Edge("GOODS_RECEIPT", END, 2, 2, None, None)]

    def doc(mapping, reverse: bool) -> str:
        po = _result("po_item", variants, edges)
        if reverse:
            po.variants.reverse(), po.edges.reverse()
        return generate(reference_document(), MiningResult("PTP", "po_item", {"po_item": po}), mapping,
                        system_type="ecc").document.model_dump_json()

    base = doc(MAP, False)
    assert doc(MAP, True) == base and doc(MAP[::-1], False) == base and doc(MAP[::-1], True) == base
