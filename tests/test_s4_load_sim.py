import pandas as pd

from api.services.migration import load_sim
from api.services.s4_readiness import membership
from checks.frames import TableFrames


def _tf(**tables: pd.DataFrame) -> TableFrames:
    return TableFrames(dict(tables))


def _ids(gaps):
    return sorted({g.detail.split(" ", 1)[0] for g in gaps})


def test_matnr_alpha_collision_and_length():
    mara = pd.DataFrame({"MATNR": ["000000000000012345", "12345", "A" * 41, "OK-1", "lower"]})
    gaps = load_sim.check_matnr(_tf(MARA=mara), "material_master")
    by_key = {(g.record_key, g.detail.split(" ", 1)[0]) for g in gaps}
    assert ("MATNR=000000000000012345", "S4L-MM-MATNR-ALPHA") in by_key
    assert ("MATNR=12345", "S4L-MM-MATNR-ALPHA") in by_key
    assert ("MATNR=" + "A" * 41, "S4L-MM-MATNR-LEN") in by_key
    assert ("MATNR=lower", "S4L-MM-MATNR-CHARS") in by_key
    assert not any(k == "MATNR=OK-1" for k, _ in by_key)
    assert all(g.gap_type == "s4_load" and g.target_table == "MARA" for g in gaps)


def test_matnr_absent_table_is_noop():
    assert load_sim.check_matnr(_tf(), "material_master") == []


def test_catalogue_ids_are_prefixed_unique_and_linked():
    rules = load_sim.rules()
    assert rules, "catalogue must not be empty"
    assert all(r.id.startswith("S4L-") for r in rules.values())
    assert len(rules) == len({r.id for r in rules.values()})
    for r in rules.values():
        assert r.severity in {"critical", "high", "medium", "low"}
        assert r.reason and r.target
        assert r.area in {"material", "business_partner", "credit_management", "mrp",
                          "material_ledger", "sales", "output_management", "finance"}


def test_related_ids_exist_in_readiness_pack_or_cvi():
    known = set(membership())
    for r in load_sim.rules().values():
        for cid in r.related:
            assert cid in known or cid.startswith("S4-CVI-") or cid.startswith("S4-CRM-"), (r.id, cid)


def test_cvi_overlap_grouping_mandatory_tax_knvk():
    lfa1 = pd.DataFrame({"LIFNR": ["100", "200"], "NAME1": ["Alpha Supply", ""], "LAND1": ["ZA", "ZA"],
                         "KTOKK": ["KRED", "ZXXX"], "STCD1": ["T1", "T9"]})
    kna1 = pd.DataFrame({"KUNNR": ["100", "300"], "NAME1": ["Other Name", "Gamma"], "LAND1": ["ZA", ""],
                         "KTOKD": ["DEBI", "DEBI"], "STCD1": ["T2", "T1"]})
    knvk = pd.DataFrame({"PARNR": ["1", "2"], "KUNNR": ["300", "999"], "LIFNR": ["", ""]})
    gaps = load_sim.check_cvi(_tf(LFA1=lfa1, KNA1=kna1, KNVK=knvk), "business_partner",
                              {"KRED": "BP01", "DEBI": "BP02"})
    got = {(g.record_key, g.detail.split(" ", 1)[0]) for g in gaps}
    assert ("LIFNR=100", "S4L-BP-NUM-OVERLAP") in got and ("KUNNR=100", "S4L-BP-NUM-OVERLAP") in got
    assert ("LIFNR=200", "S4L-BP-GROUPING") in got
    assert ("LIFNR=200", "S4L-BP-MANDATORY") in got and ("KUNNR=300", "S4L-BP-MANDATORY") in got
    assert ("LIFNR=100", "S4L-BP-TAX") in got and ("KUNNR=300", "S4L-BP-TAX") in got
    assert ("PARNR=2", "S4L-BP-KNVK-ORPHAN") in got and ("PARNR=1", "S4L-BP-KNVK-ORPHAN") not in got


def test_cvi_same_number_same_name_is_not_overlap():
    lfa1 = pd.DataFrame({"LIFNR": ["100"], "NAME1": ["Same"], "LAND1": ["ZA"], "KTOKK": ["KRED"]})
    kna1 = pd.DataFrame({"KUNNR": ["100"], "NAME1": ["same "], "LAND1": ["ZA"], "KTOKD": ["DEBI"]})
    gaps = load_sim.check_cvi(_tf(LFA1=lfa1, KNA1=kna1), "business_partner", {"KRED": "B", "DEBI": "B"})
    assert "S4L-BP-NUM-OVERLAP" not in _ids(gaps)


def test_credit_mrp_ml():
    kna1 = pd.DataFrame({"KUNNR": ["1"]})
    knkk = pd.DataFrame({"KUNNR": ["1", "2", "1"], "KKBER": ["1000", "1000", ""]})
    mard = pd.DataFrame({"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "LGORT": ["L1", "L2"], "DISKZ": ["1", ""]})
    t001l = pd.DataFrame({"WERKS": ["P1", "P1"], "LGORT": ["L1", "L2"], "DISKZ": ["", ""]})
    mbew = pd.DataFrame({"MATNR": ["M1", "M2", "M3"], "BWKEY": ["P1"] * 3, "BWTAR": [""] * 3,
                         "LBKUM": [5, 5, 0], "BKLAS": ["", "3000", ""], "VPRSV": ["S", "", ""],
                         "STPRS": [1, 0, 0], "VERPR": [0, 0, 0]})
    f = _tf(KNA1=kna1, KNKK=knkk, MARD=mard, T001L=t001l, MBEW=mbew)
    assert {g.record_key for g in load_sim.check_credit(f, "sd_customer_master")} == {"KUNNR=2|KKBER=1000", "KUNNR=1|KKBER="}
    assert [g.record_key for g in load_sim.check_mrp_area(f, "material_master")] == ["MATNR=M1|WERKS=P1|LGORT=L1"]
    ml = {(g.record_key.split("|")[0], g.detail.split(" ", 1)[0]) for g in load_sim.check_material_ledger(f, "material_master")}
    assert ml == {("MATNR=M1", "S4L-ML-BKLAS"), ("MATNR=M2", "S4L-ML-PRICE")}


def test_material_ledger_without_price_columns():
    """Test that check_material_ledger works when STPRS/VERPR columns are absent."""
    mbew = pd.DataFrame({"MATNR": ["M1", "M2"], "BWKEY": ["P1", "P1"], "BWTAR": ["", ""],
                         "LBKUM": [5, 0]})
    gaps = load_sim.check_material_ledger(_tf(MBEW=mbew), "material_master")
    # M1 has stock but no BKLAS, so should flag with S4L-ML-BKLAS
    assert any(g.record_key == "MATNR=M1|BWKEY=P1|BWTAR=" and "S4L-ML-BKLAS" in g.detail for g in gaps)
    assert not any(g.record_key == "MATNR=M2" for g in gaps)


def test_material_ledger_without_lbkum_column():
    """Test that check_material_ledger does not crash when LBKUM column is absent."""
    mbew = pd.DataFrame({"MATNR": ["M1", "M2"], "BWKEY": ["P1", "P1"], "BWTAR": ["", ""],
                         "BKLAS": ["3000", ""], "STPRS": [1, 0]})
    # Should not crash; with no LBKUM (treated as all zeros), stock = False for all rows, so no gaps
    gaps = load_sim.check_material_ledger(_tf(MBEW=mbew), "material_master")
    assert gaps == []


def test_konv_orphan_afle_nast():
    vbak = pd.DataFrame({"VBELN": ["S1"], "KNUMV": ["K1"]})
    konv = pd.DataFrame({"KNUMV": ["K1", "K9"], "KPOSN": ["10", "10"], "STUNR": ["1", "1"],
                         "ZAEHK": ["1", "1"], "KWERT": [99_000_000_000.0, 5.0]})
    nast = pd.DataFrame({"KAPPL": ["V1", "V1"], "OBJKY": ["S1", "S1"], "KSCHL": ["BA00", "BA00"],
                         "PARNR": ["1", "2"], "VSTAT": ["0", "1"]})
    gaps = load_sim.check_simplification(_tf(VBAK=vbak, KONV=konv, NAST=nast), "sd_sales_orders")
    got = {(g.record_key.split("|")[0], g.detail.split(" ", 1)[0]) for g in gaps}
    assert got == {("KNUMV=K9", "S4L-SD-KONV-ORPHAN"), ("KNUMV=K1", "S4L-FI-AFLE"),
                   ("KAPPL=V1", "S4L-OUT-NAST-OPEN")}


def test_konv_without_knumv_no_crash():
    """Test that KONV without KNUMV column plus VBAK with KNUMV returns no orphan gaps and no crash."""
    vbak = pd.DataFrame({"VBELN": ["S1"], "KNUMV": ["K1"]})
    konv = pd.DataFrame({"KPOSN": ["10"], "STUNR": ["1"], "ZAEHK": ["1"], "KWERT": [5.0]})
    gaps = load_sim.check_simplification(_tf(VBAK=vbak, KONV=konv), "sd_sales_orders")
    # Should not crash; KONV without KNUMV means no orphan check, no KWERT check (below threshold),
    # no NAST means no open records. Result should be empty.
    assert gaps == []


def test_fold_moves_blocked_keys_and_recomputes():
    from api.services.migration.engine import ModuleResult

    res = ModuleResult("material_master", 3, 0, 100.0, "go", {"field_mapping": 0},
                       {"MARA": ["MATNR=A", "MATNR=B", "MATNR=C"]})
    sim = [load_sim.Gap("material_master", "s4_load", "critical", "S4L-MM-MATNR-LEN x", "MATNR=A", "MARA"),
           load_sim.Gap("material_master", "s4_load", "low", "S4L-FI-AFLE x", "MATNR=B", "MARA")]
    out = load_sim.fold(res, sim)
    assert out.blocked_records == 1 and out.ready_keys["MARA"] == ["MATNR=B", "MATNR=C"]
    assert out.verdict == "no-go" and out.counts["s4_load"] == 2


def test_record_status_reasons():
    g = [load_sim.Gap("m", "s4_load", "critical", "S4L-MM-MATNR-LEN too long", "MATNR=A", "MARA"),
         load_sim.Gap("m", "s4_load", "low", "S4L-FI-AFLE edge", "MATNR=B", "MARA")]
    st = {r["record_key"]: r for r in load_sim.record_status(g)}
    assert st["MATNR=A"]["status"] == "load_fail" and st["MATNR=A"]["reasons"] == ["S4L-MM-MATNR-LEN too long"]
    assert st["MATNR=B"]["status"] == "load_ready"
