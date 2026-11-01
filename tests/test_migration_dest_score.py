"""Projected destination DQS: the source data scored in the S/4HANA shape by the same formula."""

import pandas as pd

from api.services.migration import load_sim
from api.services.migration.dest_score import project
from api.services.migration.engine import analyze, seed_mappings
from checks.base import CheckResult
from checks.frames import TableFrames
from sap.ddic import get_dictionary

ECC, S4 = get_dictionary("ecc6"), get_dictionary("s4hana")


def _passing(module: str, check_id: str, field: str, n: int, severity: str = "high") -> CheckResult:
    return CheckResult(check_id=check_id, module=module, field=field, severity=severity, dimension="completeness",
                       passed=True, affected_count=0, total_count=n, pass_rate=100.0, message="", details={})


def _project(module, frames, tables, source_results, value_maps=None, sim=False):
    maps = seed_mappings({t: list(df.columns) for t, df in frames.frames.items()}, ECC, S4)
    tv: dict = {}
    gaps, _ = analyze(module, frames, tables, maps, S4, value_maps or {}, {}, None, False, target_out=tv)
    if sim:
        gaps += load_sim.simulate(frames, module, load_sim.standard_grouping(), set(tables))
    records = {t: len(df) for t, df in frames.frames.items()}
    return project(module, target_type="s4hana", target_values=tv, mappings=maps, gaps=gaps,
                   source_results=source_results, table_records=records, source_tables=tables,
                   source_dict=ECC, target_dict=S4, tenant_id="t1", raw_cfg={})


def _customers():
    kna1 = pd.DataFrame({
        "KNA1.KUNNR": ["0000200001", "0000200002", "0000200003", "0000200004"],
        "KNA1.KTOKD": ["ZCUS", "ZCUS", "ZEXP", "ZCUS"],
        "KNA1.NAME1": ["Acme Mining", "Northwind", "Contoso", "Fabrikam"],
        "KNA1.LAND1": ["ZA", "ZA", "DE", "ZA"],
    })
    return TableFrames({"KNA1": kna1}, ECC, module="sd_customer_master")


def test_kna1_to_bp_grouping_gap_lowers_destination_and_value_map_restores_it():
    src = [_passing("sd_customer_master", "SRC-NAME", "KNA1.NAME1", 4)]
    out = _project("sd_customer_master", _customers(), ["KNA1"], src)
    assert out["source_score"] == 100.0
    # KTOKD has no BP grouping mapping: every customer lands in BUT000 without BU_GROUP
    assert out["composite_score"] < out["source_score"]
    top = {c["check_id"]: c for c in out["contributors"]}
    assert "value_unmapped:BUT000.BU_GROUP" in top
    assert top["value_unmapped:BUT000.BU_GROUP"]["dest_affected"] == 4
    assert top["value_unmapped:BUT000.BU_GROUP"]["field_description"]
    mapped = _project("sd_customer_master", _customers(), ["KNA1"], src,
                      value_maps={"BUT000.BU_GROUP": {"ZCUS": "BP01", "ZEXP": "BP02"}})
    assert mapped["composite_score"] > out["composite_score"]
    # the source rule survives the mapping and is re-pointed, not dropped
    assert out["rules_carried"] == 1 and out["rules_dropped"] == 0


def test_rule_on_a_field_that_is_not_migrated_drops_out():
    frames = _customers()
    frames.frames["KNA1"]["KNA1.ZZLEGACY"] = ["", "", "", "X"]
    bad = CheckResult(check_id="SRC-Z", module="sd_customer_master", field="KNA1.ZZLEGACY", severity="critical",
                      dimension="completeness", passed=False, affected_count=3, total_count=4, pass_rate=25.0,
                      message="", details={})
    out = _project("sd_customer_master", frames, ["KNA1"], [bad],
                   value_maps={"BUT000.BU_GROUP": {"ZCUS": "BP01", "ZEXP": "BP02"}})
    assert out["rules_dropped"] == 1
    assert any(c["check_id"] == "SRC-Z" and c["kind"] == "dropped" for c in out["contributors"])
    assert out["source_score"] <= 85.0  # one critical caps the source


def test_matnr_length_and_format_lower_destination_score():
    mara = pd.DataFrame({
        "MARA.MATNR": ["000000000000100001", "100001", "pump-housing_x", "A" * 41, "VALVE-01"],
        "MARA.MTART": ["ROH", "ROH", "HALB", "FERT", "ROH"],
    })
    frames = TableFrames({"MARA": mara}, ECC, module="material_master")
    src = [_passing("material_master", "SRC-MTART", "MARA.MTART", 5)]
    out = _project("material_master", frames, ["MARA"], src, sim=True)
    ids = {c["check_id"].split(":")[0] for c in out["contributors"]}
    assert {"S4L-MM-MATNR-LEN", "S4L-MM-MATNR-ALPHA", "S4L-MM-MATNR-CHARS"} <= ids
    assert out["composite_score"] < out["source_score"]
    clean = TableFrames({"MARA": mara.iloc[[1, 4]].reset_index(drop=True)}, ECC, module="material_master")
    better = _project("material_master", clean, ["MARA"], src, sim=True)
    assert better["composite_score"] > out["composite_score"]
