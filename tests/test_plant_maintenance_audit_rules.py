"""Plant maintenance audit rules PM370-PM375: ids and fire/no-fire fixtures."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/ecc/plant_maintenance.yaml"))["rules"]}
DDIC = get_dictionary("ecc6")
D = pd.to_datetime


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="plant_maintenance"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_ids_exist():
    for n in range(370, 376):
        assert f"PM{n}" in RULES


def test_pm370_order_master():
    t = {"AFIH": frame("AFIH", AUFNR=["1", "2"]), "AUFK": frame("AUFK", AUFNR=["1"])}
    assert fire("PM370", t)[0] == 1


def test_pm371_availability_window():
    t = {"AFIH": frame("AFIH", AUFNR=["1", "2"], ANLVD=D(["2024-05-01", "2024-01-01"]),
                       ANLBD=D(["2024-01-01", "2024-05-01"]))}
    assert fire("PM371", t)[0] == 1


def test_pm372_order_without_object():
    t = {"AFIH": frame("AFIH", AUFNR=["1", "2", "3"], EQUNR=[None, "E1", None], ILOAN=[None, None, None],
                       BAUTL=[None, None, None], IPHAS=["1", "1", "3"])}
    assert fire("PM372", t)[0] == 1


def test_pm373_plan_location():
    t = {"MPLA": frame("MPLA", WARPL=["1", "2", "3"], TPLNR=["F1", "F2", None]), "IFLOT": frame("IFLOT", TPLNR=["F1"])}
    assert fire("PM373", t)[0] == 1


def test_pm374_item_without_object():
    t = {"MPOS": frame("MPOS", WARPL=["1", "1"], WAPOS=["1", "2"], EQUNR=[None, "E1"], ILOAN=[None, None],
                       BAUTL=[None, None])}
    assert fire("PM374", t)[0] == 1


def test_pm375_measuring_point():
    t = {"EQUI": frame("EQUI", EQUNR=["1", "2", "3"], IMRC_POINT=["P1", "P2", None]),
         "IMPTT": frame("IMPTT", POINT=["P1"])}
    assert fire("PM375", t)[0] == 1
