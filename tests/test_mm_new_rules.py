"""New material master rules fire on the bad record and only on it."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]}


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


MARA = frame("MARA", MATNR=["M1", "M2"], MEINS=["EA", "EA"], BRGEW=["1.000", "1.000"], GEWEI=["KG", "KG"])
MARC = frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"], PRCTR=["PC1", "PCX"],
             PLIFZ=["30", "500"], EISBE=["5", "50"], MABST=["10", "10"])
MBEW = frame("MBEW", MATNR=["M1", "M2"], BWKEY=["P1", "P1"], BWTAR=["", ""], VPRSV=["S", "S"], LBKUM=["10", "10"],
             STPRS=["100.00", "100.00"], PEINH=["1", "1"], SALK3=["1000.00", "700.00"], VERPR=["110.00", "300.00"],
             LAEPR=[pd.Timestamp.now().strftime("%Y%m%d"), "20150101"])
MARD = frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"], LABST=["5", "5"],
             INSME=["0", "0"], SPEME=["0", "0"])
MARM = frame("MARM", MATNR=["M1", "M2"], MEINH=["BOX", "BOX"], UMREZ=["10", "10"], UMREN=["1", "1"],
             BRGEW=["11.000", "1.000"], GEWEI=["KG", "KG"], EAN11=["4006381333931", "4006381333948"])
MVKE = frame("MVKE", MATNR=["M1", "M2"], VKORG=["S1", "S1"], VTWEG=["01", "01"])
CEPC = frame("CEPC", PRCTR=["PC1"])
MLAN = frame("MLAN", MATNR=["M1"], ALAND=["ZA"])
MEAN = frame("MEAN", MATNR=["M1"], MEINH=["BOX"], EAN11=["4006381333931"])


def frames(marc=MARC):
    return TableFrames({"MARA": MARA, "MARC": marc, "MBEW": MBEW, "MARD": MARD, "MARM": MARM, "MVKE": MVKE,
                        "CEPC": CEPC, "MLAN": MLAN, "MEAN": MEAN}, get_dictionary("ecc6"), module="material_master")


def test_new_rules_flag_only_the_bad_material():
    for rid in ["MM216", "MM217", "MM218", "MM219", "MM220", "MM221", "MM223", "MM224", "MM225"]:
        _, res = run_rule(dict(RULES[rid]), frames())
        assert res is not None and not res.error, (rid, res and res.error)
        assert (res.affected_count, res.total_count) == (1, 2), (rid, res.affected_count, res.total_count)


def test_new_referential_rules_use_check_tables():
    refs = {"MM212": ("T001W.WERKS", {"P2"}), "MM213": ("T001K.BWKEY", {"P2"}),
            "MM214": ("TVKO.VKORG", {"S2"}), "MM215": ("TVTW.VTWEG", {"02"})}
    for rid, (ref, values) in refs.items():
        _, res = run_rule(dict(RULES[rid]), frames(), {ref: values})
        assert res is not None and res.affected_count == 2, (rid, res and res.affected_count)


def test_stock_on_plant_flagged_for_deletion():
    _, res = run_rule(dict(RULES["MM222"]), frames(MARC.assign(**{"MARC.LVORM": ["", "X"]})))
    assert (res.affected_count, res.total_count) == (1, 2)
