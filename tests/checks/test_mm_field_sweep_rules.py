"""Material master field-sweep rules (MM1115+): each fires on its dirty row ("BAD")
and passes the clean one ("OK") — population 2, exactly one failure."""

from datetime import date, timedelta

import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import module_rules, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
M = "material_master"


def _day(n: int) -> str:
    return (date.today() + timedelta(days=n)).strftime("%Y%m%d")


def _f(table: str, **cols) -> pd.DataFrame:
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def marc(**c):
    return {"MARC": _f("MARC", MATNR=["OK", "BAD"], WERKS=["1000", "1000"], **c)}


def mbew(**c):
    return {"MBEW": _f("MBEW", MATNR=["OK", "BAD"], BWKEY=["1000", "1000"], **c)}


def mara(**c):
    return {"MARA": _f("MARA", MATNR=["OK", "BAD"], **c)}


def keyed(t, keys, **c):
    return {t: _f(t, MATNR=["OK", "BAD"], **keys, **c)}


CASES = {
    "MM1115": marc(PRENG=[_day(30), _day(-5)], LVORM=["", ""]),
    "MM1116": marc(PREND=[_day(-30), _day(10)]),
    "MM1117": marc(PRENO=["C1", "C2"], PREND=[_day(-30), ""]),
    "MM1118": marc(HERBL=["GP", "GP"], HERKL=["ZA", ""]),
    "MM1119": marc(ITARK=["X", "X"], STAWN=["84295100", ""]),
    "MM1120": marc(UID_IEA=["X", "X"], IUID_RELEVANT=["X", ""]),
    "MM1121": marc(MIN_TROC=["5", "20"], MAX_TROC=["10", "10"]),
    "MM1122": marc(TARGET_STOCK=["10", "-1"]),
    "MM1123": marc(LGRAD=["95", "100"]),
    "MM1124": marc(LOSFX=["10", "-1"]),
    "MM1125": marc(VZUSL=["5", "-5"]),
    "MM1126": marc(RUEZT=["1", "1"], TRANZ=["1", "-1"], TAKZT=["1", "1"]),
    "MM1127": marc(GI_PR_TIME=["1", "-1"], DPLHO=["1", "1"]),
    "MM1128": marc(FIXLS=["1", "1"], LTINC=["1", "-2"]),
    "MM1129": {**marc(FVIDK=["0001", "0002"]),
               "MKAL": _f("MKAL", MATNR=["OK"], WERKS=["1000"], VERID=["0001"])},
    "MM1130": marc(CCFIX=["X", "X"], ABCIN=["A", ""]),
    "MM1131": marc(VRBFK=["1", "1"], VRBMT=["REF", ""]),
    "MM1132": {"MARD": _f("MARD", MATNR=["OK", "BAD"], WERKS=["1000", "1000"], LGORT=["0001", "0001"],
                          VMLAB=["-1", "-1"]),
               "MARC": _f("MARC", MATNR=["OK", "BAD"], WERKS=["1000", "1000"], XMCNG=["X", ""])},
    "MM1133": mbew(VMKUM=["5", "5"], VMSAL=["10", "-10"], VJKUM=["0", "0"], VJSAL=["0", "0"]),
    "MM1134": mbew(BWPH1=["1", "1"], BWPS1=["1", "-1"], VJBWH=["1", "1"], VJBWS=["1", "1"]),
    "MM1135": mbew(BWPRH=["10", "10"], BWPRS=["0", "0"], BWPEI=["1", ""]),
    "MM1136": mbew(LPLPX=["5", "15"], LPLPR=["10", "10"], VPLPX=["0", "0"], VPLPR=["0", "0"],
                   FPLPX=["0", "0"], ZPLPR=["0", "0"]),
    "MM1137": mbew(WLINL=[_day(-10), _day(10)]),
    "MM1138": mara(VPREH=["100", "100"], INHME=["G", ""], INHAL=["500", "500"]),
    "MM1139": mara(MAXC=["10", ""], MAXC_TOL=["5", "5"]),
    "MM1140": mara(FIBER_PART1=["60", "60"], FIBER_PART2=["40", "50"], FIBER_PART3=["", ""],
                   FIBER_PART4=["", ""], FIBER_PART5=["", ""]),
    "MM1141": mara(ZEINR=["D1", "D2"], ZEIAR=["DRW", ""]),
    "MM1142": keyed("MARM", {"MEINH": ["PAL", "PAL"]}, NEST_FTR=["50", "120"], MAX_STACK=["1", "1"],
                    CAPAUSE=["1", "1"]),
    "MM1143": keyed("MLAN", {"ALAND": ["ZA", "ZA"]}, TAXM1=["1", ""], TAXM2=["1", "1"], TAXM3=["", ""],
                    TAXM4=["", ""]),
    "MM1144": keyed("MLGN", {"LGNUM": ["100", "100"]}, MKAPV=["1", "-1"]),
    "MM1145": keyed("QMAT", {"WERKS": ["1000", "1000"], "ART": ["01", "01"]}, DYN=["X", "X"], DYNREGEL=["R1", ""]),
    "MM1146": keyed("QMAT", {"WERKS": ["1000", "1000"], "ART": ["01", "01"]}, INSMK=["X", "X"], AKTIV=["X", ""]),
    "MM1147": keyed("MKAL", {"WERKS": ["1000", "1000"], "VERID": ["0001", "0001"]}, PRDAT=[_day(-1), _day(5)]),
    "MM1148": keyed("MKAL", {"WERKS": ["1000", "1000"], "VERID": ["0001", "0001"]}, LOSGR=["10", "-10"]),
    "MM1149": keyed("MDMA", {"BERID": ["A1", "A1"]}, LGRAD=["95", "95"], LOSFX=["1", "-1"]),
    "MM1150": keyed("MDMA", {"BERID": ["A1", "A1"]}, VRBFK=["1", "1"], VRBMT=["REF", ""]),
    "MM1151": {"CKMLHD": _f("CKMLHD", KALNR=["OK", "BAD"], ABRECHDAT=[_day(-1), _day(5)])},
}


@pytest.mark.parametrize("check_id", list(CASES))
def test_rule_fires_on_dirty_and_passes_clean(check_id):
    rule = {**next(r for r in module_rules(M) if r["id"] == check_id), "module": M}
    _, res = run_rule(rule, TableFrames(CASES[check_id], D, module=M))
    assert res.error is None, res.error
    assert res.affected_count == 1, (res.total_count, res.affected_count)
