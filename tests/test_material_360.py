import pandas as pd

from api.services import material_360 as m
from tests.material_360_fixture import A, B, C, D, E, tables


def test_norm():
    assert m.norm_matnr("101") == A and m.norm_matnr("ABC-1") == "ABC-1"


def test_matrix_three_plants_and_missing_sales_org():
    out = m.build_material(tables(), A)
    assert out["description"] == "Hydraulic pump seal kit 50mm"
    ids = [lv["id"] for lv in out["levels"]]
    assert {"plant:1000", "plant:2000", "plant:3000", "sales:2000/10", "sales:3000/10"} <= set(ids)
    sales = next(r for r in out["views"] if r["view"] == "sales")
    state = {c["level"]: c["state"] for c in sales["cells"]}
    assert state["sales:2000/10"] == "ok" and state["sales:3000/10"] == "missing"


def test_cap_levels():
    lv = [{"id": str(i), "kind": "plant", "plant": str(i)} for i in range(15)]
    shown, total = m.cap_levels(lv, None)
    assert len(shown) == 12 and total == 15
    assert len(m.cap_levels(lv, "3")[0]) == 1


def test_loop_flagged():
    s = m.build_supersession(tables(), B)
    p = s["plants"][0]
    assert p["loop_at"] == B and p["links"] == 2
    assert [n["matnr"] for n in p["chain"]] == [B, C]
    assert "MM551" in p["chain"][-1]["flags"]


def test_dead_end_and_truncation():
    t = tables()
    t["MARC"].loc[t["MARC"].MATNR == C, "NFMAT"] = D
    t["MARC"].loc[t["MARC"].MATNR == D, ["KZAUS", "NFMAT"]] = ["X", ""]
    p = m.build_supersession(t, B)["plants"][0]
    assert p["dead_end"] and "MM550" in p["chain"][-1]["flags"] and not p["loop_at"]
    t["MARC"].loc[t["MARC"].MATNR == D, "NFMAT"] = E
    p = m.build_supersession(t, B, depth=2)["plants"][0]
    assert p["truncated"] and p["links"] == 2


def test_per_plant_and_bom():
    s = m.build_supersession(tables(), A)
    assert len(s["plants"]) == 3
    assert [p["loop_at"] for p in s["plants"]] == [None, None, A] and s["plants"][2]["links"] == 2
    assert len(m.build_supersession(tables(), A, plant="2000")["plants"]) == 1
    assert m.build_supersession(tables(), B)["bom_usage"][0]["flags"] == ["MM560"]
    t = tables(); del t["STPO"]
    assert m.build_supersession(t, B)["bom_usage"] is None


def test_unknown_material():
    assert m.build_material(tables(), "999") is None and m.build_supersession(tables(), "999") is None


def test_duplicates_ean_and_description():
    d = m.build_duplicates(tables(), A)
    assert d["threshold"] == 60
    top = d["items"][0]
    assert top["matnr"] == D and top["score"] >= 60 and "EAN same" in top["matches_on"]
    assert m.build_duplicates(tables(), E)["items"] == []


def test_findings_sum_equals_rule_count():
    cat = m.rule_catalogue()
    assert len(cat) == 418
    rid = next(iter(cat))
    f = m.build_findings([{"check_id": rid, "record_key": f"MATNR={A}|WERKS=1000", "field_values": {}}], {},
                         m.present_tables(tables(), A), set(tables()))
    n = sum(len(v["failing"]) + v["passing_count"] + len(v["not_evaluated"]) for v in f["by_view"])
    assert n == f["rules_total"] == 418
    assert f["by_view"][0]["failing"] or any(v["failing"] for v in f["by_view"])
