"""S/4HANA readiness layer for material, MRP, ML, purchasing, PP, PM, foreign trade, archiving, batch."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

AREAS = {"material", "mrp", "material_ledger", "purchasing", "production", "plant_maintenance",
         "foreign_trade", "archiving", "batch_serial"}
META = ("id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
        "sap_impact", "fix_map", "record_fix_template", "s4_area", "s4_impact", "simplification_item")
D = get_dictionary("s4hana")
DOC = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))
MINE = [r for r in DOC["rules"] if r["s4_area"] in AREAS]


def _run(**frames):
    res = run_checks("s4_readiness", TableFrames({t: pd.DataFrame(df) for t, df in frames.items()}, D), "t")
    return {r.check_id: r for r in res}


def test_rules_are_complete_and_tagged():
    assert len(MINE) >= 80
    ids = [r["id"] for r in MINE]
    assert len(ids) == len(set(ids))
    for r in MINE:
        assert all(r.get(k) for k in META), r["id"]
        assert r["baseline"] == "s4_target" and r["rule_authority"] == "s4hana_migration"
        assert r["message"].startswith("S/4HANA readiness: ")


def test_areas_exist_and_cover_all_rules():
    assert AREAS <= set(DOC["areas"])
    assert all(a in DOC["areas"] for a in {r["s4_area"] for r in DOC["rules"]})


def test_storage_location_mrp_flags_only_populated():
    r = _run(MARD={"MARD.MATNR": ["A", "B"], "MARD.WERKS": ["P", "P"], "MARD.LGORT": ["1", "2"],
                   "MARD.LBSTF": ["5", "0"]})["S4R-MRP-MARD-LBSTF"]
    assert (r.affected_count, r.total_count) == (1, 2)


def test_contract_on_blocked_vendor_conditional():
    r = _run(EKKO={"EKKO.EBELN": ["1", "2", "3"], "EKKO.BSTYP": ["K", "K", "F"], "EKKO.LOEKZ": ["", "", ""],
                   "EKKO.LIFNR": ["V1", "V2", "V1"]},
             LFA1={"LFA1.LIFNR": ["V1", "V2"], "LFA1.SPERM": ["X", ""]})
    c = r["S4R-PUR-CO-SPERM"]
    assert c.affected_count == 1  # PO on the same vendor is outside the contract rule
    assert r["S4R-PUR-PO-SPERM"].affected_count == 1


def test_contract_skipped_when_deleted():
    r = _run(EKKO={"EKKO.EBELN": ["1"], "EKKO.BSTYP": ["K"], "EKKO.LOEKZ": ["L"], "EKKO.LIFNR": ["V1"]},
             LFA1={"LFA1.LIFNR": ["V1"], "LFA1.SPERM": ["X"]}).get("S4R-PUR-CO-SPERM")
    assert r is None or r.affected_count == 0


def test_ml_negative_value_on_positive_stock():
    r = _run(MBEW={"MBEW.MATNR": ["A", "B"], "MBEW.BWKEY": ["P", "P"], "MBEW.LBKUM": ["10", "10"],
                   "MBEW.SALK3": ["-5", "5"]})["S4R-ML-NEG-VALUE"]
    assert r.affected_count == 1


def test_foreign_trade_flags_populated_commodity_code():
    r = _run(MARC={"MARC.MATNR": ["A", "B"], "MARC.WERKS": ["P", "P"], "MARC.STAWN": ["8501", ""]})["S4R-FT-MARC-STAWN"]
    assert r.affected_count == 1


def test_batch_stock_without_master():
    r = _run(MCHB={"MCHB.MATNR": ["A", "B"], "MCHB.WERKS": ["P", "P"], "MCHB.CHARG": ["1", "2"]},
             MCHA={"MCHA.MATNR": ["A"], "MCHA.WERKS": ["P"], "MCHA.CHARG": ["1"]})["S4R-BATCH-MCHB-NOMCHA"]
    assert r.affected_count == 1
