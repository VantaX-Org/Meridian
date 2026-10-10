"""Source→target gap engine: ECC vendors against the S/4HANA standard dictionary."""

import pandas as pd

from api.services.migration.engine import Mapping, analyze, seed_mappings
from checks.frames import TableFrames
from sap.ddic import get_dictionary

ECC, S4 = get_dictionary("ecc6"), get_dictionary("s4hana")


def _frames():
    lfa1 = pd.DataFrame({
        "LFA1.LIFNR": ["0000100001", "0000100002", "0000100003"],
        "LFA1.KTOKK": ["KRED", "LIEF", "KRED"],
        "LFA1.NAME1": ["Acme Mining Supplies", "x" * 41, "Komatsu Parts"],
        "LFA1.LAND1": ["ZA", "ZA", "ZA"],
        "LFA1.ERDAT": ["20200101", "20201340", "20210505"],
        "LFA1.ZZRISK": ["A", "", "B"],
    })
    lfb1 = pd.DataFrame({
        "LFB1.LIFNR": ["0000100001", "0000100001", "0000100002"],
        "LFB1.BUKRS": ["1000", "2000", "1000"],
        "LFB1.AKONT": ["160000", "", "160000"],
        "LFB1.ZTERM": ["0001", "0001", "0002"],
    })
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1}, ECC, module="accounts_payable")


def _run(value_maps=None, target_config=None, connected=False):
    frames = _frames()
    maps = seed_mappings({t: list(df.columns) for t, df in frames.frames.items()}, ECC, S4)
    return analyze("accounts_payable", frames, ["LFA1", "LFB1"], maps, S4, value_maps or {},
                   target_config or {}, None, connected)


def test_seed_is_identity_plus_cvi():
    maps = seed_mappings({"LFA1": ["LFA1.LIFNR", "LFA1.KTOKK", "LFA1.NAME1"]}, ECC, S4)
    targets = {(m.source, m.target, m.origin) for m in maps}
    assert ("LFA1.NAME1", "LFA1.NAME1", "identity") in targets
    assert ("LFA1.NAME1", "BUT000.NAME_ORG1", "sap_standard") in targets
    assert any(m.target == "BUT000.BU_GROUP" and m.value_map for m in maps)


def test_gaps_are_record_level_and_grounded():
    gaps, res = _run()
    by = {}
    for g in gaps:
        by.setdefault(g.gap_type, []).append(g)
    # NAME1 41 chars > LFA1.NAME1 CHAR35 and BUT000.NAME_ORG1 CHAR40
    trunc = {(g.target_field, g.record_key) for g in by["length_truncation"]}
    assert ("LFA1.NAME1", "LIFNR=0000100002") in trunc and ("BUT000.NAME_ORG1", "LIFNR=0000100002") in trunc
    # invalid date 20201340 → type conversion into DATS
    assert any(g.target_field == "LFA1.ERDAT" and g.source_value == "20201340" for g in by["type_conversion"])
    # every vendor needs a BP grouping mapping for its account group (CVI)
    assert {g.source_value for g in by["value_unmapped"]} == {"KRED", "LIEF"}
    # reconciliation account blank on vendor 1 / company code 2000
    assert [g.record_key for g in by["target_mandatory"] if g.target_field == "LFB1.AKONT"] == ["LIFNR=0000100001|BUKRS=2000"]
    # customer field without a mapping is reported, low severity
    assert any(g.source_field == "LFA1.ZZRISK" and g.severity == "low" for g in by["unmapped_field"])
    # no target connected → check-table values reported as unverified, never assumed valid
    assert any(g.target_field == "LFA1.KTOKK" and not g.grounded for g in by["target_config_unverified"])
    assert res.verdict == "no-go"


def test_value_maps_and_live_target_config_resolve_gaps():
    vm = {"BUT000.BU_GROUP": {"KRED": "BP01", "LIEF": "BP02"}}
    cfg = {"T077K.KTOKK": {"KRED"}, "TB001.BU_GROUP": {"BP01", "BP02"}}
    gaps, res = _run(vm, cfg, connected=True)
    types = {g.gap_type for g in gaps}
    assert "value_unmapped" not in types
    # LIEF is not configured as an account group in the target
    assert [g.source_value for g in gaps if g.gap_type == "check_table_value" and g.target_field == "LFA1.KTOKK"] == ["LIEF"]
    assert "target_config_unverified" not in {g.gap_type for g in gaps if g.target_field in ("LFA1.KTOKK", "BUT000.BU_GROUP")}


def test_key_collision_detected():
    frames = _frames()
    frames.frames["LFA1"].loc[2, "LFA1.LIFNR"] = "0000100001"
    maps = [Mapping("LFA1.LIFNR", "LFA1.LIFNR"), Mapping("LFA1.NAME1", "LFA1.NAME1")]
    gaps, _ = analyze("accounts_payable", frames, ["LFA1"], maps, S4)
    assert sum(g.gap_type == "key_collision" for g in gaps) == 2


def test_obsolete_target_is_structural_critical():
    frames = TableFrames({"VBUK": pd.DataFrame({"VBUK.VBELN": ["1"], "VBUK.GBSTK": ["C"]})}, ECC)
    gaps, res = analyze("sd_sales_orders", frames, ["VBUK"], [Mapping("VBUK.GBSTK", "VBUK.GBSTK")], S4)
    assert any(g.gap_type == "obsolete_target" and g.severity == "critical" for g in gaps)
    assert res.verdict == "no-go"


def test_load_files_exclude_blocked_records_and_apply_value_maps():
    import io
    import zipfile

    from api.services.migration.export import build_load_tables, to_csv_zip, to_xlsx

    frames = _frames()
    maps = [Mapping("LFA1.LIFNR", "BUT000.PARTNER"), Mapping("LFA1.KTOKK", "BUT000.BU_GROUP", value_map=True),
            Mapping("LFA1.ZZRISK", None)]
    vm = {"BUT000.BU_GROUP": {"KRED": "BP01", "LIEF": "BP02"}}
    tables = build_load_tables(frames, {"accounts_payable": ["LFA1"]}, {"accounts_payable": maps},
                               {"accounts_payable": vm}, {"accounts_payable": {"LIFNR=0000100002"}})
    but000 = tables["BUT000"]
    assert list(but000["SOURCE_RECORD"]) == ["LIFNR=0000100001", "LIFNR=0000100003"]
    assert list(but000["BU_GROUP"]) == ["BP01", "BP01"]
    assert "ZZRISK" not in but000.columns  # unmapped (not migrated) field never reaches a load file
    with zipfile.ZipFile(io.BytesIO(to_csv_zip(tables))) as z:
        assert z.namelist() == ["BUT000.csv"]
    assert to_xlsx(tables)[:2] == b"PK"


def test_verdict_for_matches_engine_rules():
    from api.services.migration.engine import verdict_for

    assert verdict_for(10, 0, False) == (100.0, "go")
    assert verdict_for(100, 5, False) == (95.0, "conditional")
    assert verdict_for(10, 5, False) == (50.0, "no-go")
    assert verdict_for(10, 0, True)[1] == "no-go"
    assert verdict_for(10_000, 1, False) == (99.99, "conditional")


def test_config_value_map_applies_through_the_check_table():
    vm = {"T077K.KTOKK": {"LIEF": "KRED"}}
    cfg = {"T077K.KTOKK": {"KRED"}, "TB001.BU_GROUP": {"BP01", "BP02"}}
    gaps, _ = _run(vm, cfg, connected=True)
    assert not [g for g in gaps if g.gap_type == "check_table_value" and g.target_field == "LFA1.KTOKK"]


def test_baseline_target_config_flags_without_blocking():
    frames = _frames()
    maps = seed_mappings({t: list(df.columns) for t, df in frames.frames.items()}, ECC, S4)
    cfg = {"T077K.KTOKK": {"KRED"}}
    gaps, _ = analyze("accounts_payable", frames, ["LFA1", "LFB1"], maps, S4, {}, cfg, None, True,
                      config_basis="baseline")
    hit = [g for g in gaps if g.gap_type == "check_table_value" and g.target_field == "LFA1.KTOKK"]
    assert [(g.source_value, g.severity, g.provenance) for g in hit] == [("LIEF", "medium", "target_baseline_config")]


def test_load_files_apply_config_maps_through_the_check_table():
    from api.services.migration.export import build_load_tables

    maps = [Mapping("LFA1.LIFNR", "LFA1.LIFNR"), Mapping("LFA1.KTOKK", "LFA1.KTOKK")]
    tables = build_load_tables(_frames(), {"accounts_payable": ["LFA1"]}, {"accounts_payable": maps},
                               {"accounts_payable": {"T077K.KTOKK": {"LIEF": "KRED"}}}, {}, target_dict=S4)
    assert list(tables["LFA1"]["KTOKK"]) == ["KRED"] * 3
