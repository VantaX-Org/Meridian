"""Production planning audit rules PP411-PP419: ids and fire/no-fire fixtures."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/ecc/production_planning.yaml"))["rules"]}
DDIC = get_dictionary("ecc6")
D = pd.to_datetime


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="production_planning"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_ids_exist():
    for n in range(411, 420):
        assert f"PP{n}" in RULES


def test_pp411_validity_order():
    t = {"MKAL": frame("MKAL", ADATU=D(["2024-01-01", "2024-06-01"]), BDATU=D(["2023-01-01", "2025-01-01"]))}
    assert fire("PP411", t)[0] == 1


def test_pp412_lot_size_range():
    t = {"MKAL": frame("MKAL", BSTMI=[100, 10, 5], BSTMA=[50, 50, 0])}
    assert fire("PP412", t)[0] == 1


def test_pp413_routing_exists():
    t = {"MKAL": frame("MKAL", PLNTY=["N", "N"], PLNNR=["1", "2"], ALNAL=["01", "01"], MKSP=[None, None]),
         "PLKO": frame("PLKO", PLNTY=["N"], PLNNR=["1"], PLNAL=["01"], LOEKZ=[None])}
    assert fire("PP413", t)[0] == 1


def test_pp414_bom_exists():
    t = {"MKAL": frame("MKAL", MATNR=["A", "B"], WERKS=["P1", "P1"], STLAN=["1", "1"], STLAL=["01", "01"],
                       MKSP=[None, None], MATKO=[None, None]),
         "MAST": frame("MAST", MATNR=["A"], WERKS=["P1"], STLAN=["1"], STLAL=["01"])}
    assert fire("PP414", t)[0] == 1


def test_pp415_cost_data():
    t = {"CRHD": frame("CRHD", OBJTY=["A", "A"], OBJID=["1", "2"], XKOST=["X", "X"], LVORM=[None, None]),
         "CRCO": frame("CRCO", OBJTY=["A"], OBJID=["1"])}
    assert fire("PP415", t)[0] == 1


def test_pp416_standard_vs_normal_duration():
    t = {"CRHD": frame("CRHD", ZWMIN=[5, 1], ZWNOR=[2, 2])}
    assert fire("PP416", t)[0] == 1


def test_pp417_pp419_operation_durations():
    t = {"PLPO": frame("PLPO", PLNTY=["N", "N"], LOEKZ=[None, None], ZWMIN=[5, 1], ZWNOR=[2, 2],
                       ZTMIN=[1, 1], ZTNOR=[2, 2])}
    assert fire("PP417", t)[0] == 1


def test_pp418_operation_text():
    t = {"PLPO": frame("PLPO", PLNTY=["N", "N"], LOEKZ=[None, None], LTXA1=[None, "Text"])}
    assert fire("PP418", t)[0] == 1


def test_pp419_maintenance_duration():
    t = {"PLPO": frame("PLPO", PLNTY=["A", "A"], LOEKZ=[None, None], DAUMI=[9, 1], DAUNO=[2, 2])}
    assert fire("PP419", t)[0] == 1
