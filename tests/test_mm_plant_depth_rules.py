"""Plant / MRP / production depth rules (MM700-MM799): IDs, auto_fix contract and firing fixtures.

Each fixture holds one failing and one passing record, so every rule must flag exactly 1 of 2.
"""

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
PLANT = [r for r in PACK if r["id"][2:].isdigit() and 700 <= int(r["id"][2:]) <= 799]
DDIC = get_dictionary("ecc6")
OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros", "regex_replace",
       "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
OWN_TABLES = {"MARC", "MARD", "MKAL", "MDMA", "MAST", "STPO", "MAPL"}


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, rule=None):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(rule or RULES[rid]), frames, None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def marc(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"]}
    return frame("MARC", **{**base, **cols})


def mkal(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "VERID": ["0001", "0001"], "ADATU": ["20200101"] * 2,
            "BDATU": ["99991231"] * 2}
    return frame("MKAL", **{**base, **cols})


def mdma(**cols):
    base = {"MATNR": ["M1", "M2"], "BERID": ["A1", "A2"], "WERKS": ["P1", "P1"]}
    return frame("MDMA", **{**base, **cols})


def stpo(**cols):
    base = {"STLTY": ["M", "M"], "STLNR": ["1", "1"], "STLKN": ["1", "2"], "STPOZ": ["1", "1"],
            "POSNR": ["0010", "0020"], "POSTP": ["L", "L"], "IDNRK": ["C1", "C2"], "MEINS": ["EA", "EA"],
            "LKENZ": ["", ""]}
    return frame("STPO", **{**base, **cols})


CASES = {
    "MM700": {"MARC": marc(BSTRF=["50", "10"], BSTMA=["20", "20"])},
    "MM701": {"MARC": marc(DISLS=["FX", "FX"], BSTFE=["25", "30"], BSTRF=["10", "10"])},
    "MM702": {"MARC": marc(DISLS=["EX", "EX"], BSTFE=["100", "0"])},
    "MM703": {"MARC": marc(DISLS=["EX", "EX"], MABST=["500", "0"])},
    "MM704": {"MARC": marc(DISLS=["HB", "HB"], MABST=["100", "100"], BSTMI=["200", "50"])},
    "MM705": {"MARC": marc(EISBE=["-1", "5"])},
    "MM710": {"MARC": marc(BSTRF=["-10", "10"])},
    "MM711": {"MARC": marc(DISMM=["P1", "P1"], FXHOR=["000", "010"])},
    "MM712": {"MARC": marc(DISMM=["ND", "ND"], STRGR=["40", ""])},
    "MM714": {"MARC": marc(WEBAZ=["45", "2"])},
    "MM715": {"MARC": marc(BESKZ=["E", "E"], DZEIT=["400", "10"])},
    "MM716": {"MARC": marc(BESKZ=["E", "E"], DISMM=["PD", "PD"], DZEIT=["0", "5"], BEARZ=["0", "0"])},
    "MM717": {"MARC": marc(BESKZ=["E", "E"], SOBSL=["", ""], PLIFZ=["10", "0"])},
    "MM718": {"MARC": marc(UNETO=["150", "10"])},
    "MM719": {"MARC": marc(AUSSS=["100", "5"])},
    "MM720": {"MARC": marc(SOBSL=["30", "30"], BESKZ=["", "F"])},
    "MM721": {"MARC": marc(BESKZ=["F", "F"], SOBSL=["50", "30"]),
              "T460A": frame("T460A", WERKS=["P1", "P1"], SOBSL=["50", "30"], BESKZ=["E", "F"])},
    "MM722": {"MARC": marc(BESKZ=["E", "E"], DISMM=["PD", "PD"], MTVFP=["", "02"])},
    "MM723": {"MARC": marc(RGEKZ=["1", "1"], LGPRO=["", "0001"])},
    "MM724": {"MARC": marc(LGPRO=["0009", "0001"]),
              "MARD": frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"])},
    "MM725": {"MARC": marc(VERKZ=["X", "X"]), "MKAL": mkal(MATNR=["M2", "M2"], VERID=["0001", "0002"])},
    "MM727": {"MARC": marc(MMSTA=["B1", "B2"], DISMM=["PD", "PD"]),
              "T141": frame("T141", MMSTA=["B1", "B2"], DDISP=["B", "A"])},
    "MM729": {"MARC": marc(USEQU=["", ""]),
              "EQUK": frame("EQUK", MATNR=["M1"], WERKS=["P1"], QUNUM=["1"])},
    "MM730": {"MARC": marc(DIBER=["X", "X"]), "MDMA": mdma(MATNR=["M2", "M2"])},
    "MM731": {"MARC": marc(BESKZ=["F", "F"], SAUFT=["X", ""])},
    "MM733": {"MARC": marc(KZKRI=["Y", "X"])},
    "MM743": {"MARC": marc(APOKZ=["9", "1"])},
    "MM745": {"MARD": frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"],
                            DISKZ=["1", "1"], LMINB=["0", "20"])},
    "MM746": {"MARD": frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"],
                            DISKZ=["", ""], LMINB=["20", "0"])},
    "MM748": {"MKAL": mkal(ADATU=["", "20200101"])},
    "MM750": {"MKAL": mkal(BDATU=["20000101", "99991231"])},
    "MM751": {"MKAL": mkal(PRFG_F=["3", "1"])},
    "MM753": {"MKAL": mkal(PLNTY=["N", "N"], PLNNR=["", "50000001"])},
    "MM756": {"MKAL": mkal(STLAL=["01", "01"], STLAN=["", "1"])},
    "MM758": {"MKAL": mkal(ELPRO=["0009", "0001"]),
              "MARD": frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"])},
    "MM760": {"MKAL": mkal(MKSP=["X", "1"])},
    "MM763": {"MDMA": mdma(BSTMI=["100", "10"], BSTMA=["50", "50"])},
    "MM764": {"MDMA": mdma(DISMM=["VB", "VB"], MINBE=["0", "20"])},
    "MM766": {"MDMA": mdma(DISMM=["PD", "PD"], DISPO=["", "001"])},
    "MM768": {"MDMA": mdma(DISLS=["FX", "FX"], BSTFE=["0", "100"])},
    "MM770": {"MDMA": mdma(LOEKZ=["X", "X"], DISMM=["PD", "ND"])},
    "MM771": {"MDMA": mdma(PLIFZX=["", ""], PLIFZ=["10", "0"])},
    "MM772": {"MDMA": mdma(BERID=["P1", "A2"])},
    "MM775": {"MAST": frame("MAST", MATNR=["M1", "M2"], WERKS=["P1", "P1"], STLAN=["1", "1"], STLNR=["1", "2"],
                            STLAL=["01", "01"], LOSVN=["100", "0"], LOSBS=["50", "50"])},
    "MM776": {"STPO": stpo(MENGE=["0", "2"])},
    "MM777": {"STPO": stpo(MEINS=["", "EA"])},
    "MM780": {"STPO": stpo(AUSCH=["100", "5"])},
    "MM781": {"STPO": stpo(ALPGR=["A1", "A1"], ALPST=["", "1"])},
    "MM782": {"STPO": stpo(), "MARA": frame("MARA", MATNR=["C2"])},
    "MM783": {"STPO": stpo(), "MARA": frame("MARA", MATNR=["C1", "C2"], LVORM=["X", ""])},
    "MM784": {"STPO": stpo(STLTY=["Q", "M"])},
    "MM787": {"MAPL": frame("MAPL", MATNR=["M1", "M2"], WERKS=["P1", "P1"], PLNTY=["N", "N"], PLNNR=["1", "2"],
                            PLNAL=["01", "01"], LOEKZ=["", ""]),
              "PLKO": frame("PLKO", PLNTY=["N"], PLNNR=["2"], PLNAL=["01"], ZAEHL=["1"])},
    "MM788": {"MAPL": frame("MAPL", MATNR=["M1", "M2"], WERKS=["P1", "P1"], PLNTY=["N", "N"], PLNNR=["1", "2"],
                            PLNAL=["01", "01"], LOEKZ=["", ""]),
              "PLKO": frame("PLKO", PLNTY=["N", "N"], PLNNR=["1", "2"], PLNAL=["01", "01"], ZAEHL=["1", "1"],
                            LOEKZ=["X", ""])},
}


def test_ids_in_range_and_contiguous():
    ids = sorted(int(r["id"][2:]) for r in PLANT)
    assert ids == list(range(700, 700 + len(ids)))
    assert 60 <= len(ids) <= 100
    # one contiguous block in the pack
    start = PACK.index(PLANT[0])
    assert [r["id"] for r in PACK[start:start + len(PLANT)]] == [r["id"] for r in PLANT]
    assert all(r["field"].split(".")[0] in OWN_TABLES for r in PLANT)


def test_auto_fix_contract():
    with_fix = [r for r in PACK if r.get("auto_fix") and r["field"].split(".")[0] in OWN_TABLES]
    assert len(with_fix) >= 30
    for r in with_fix:
        af = r["auto_fix"]
        assert set(af) <= {"when", "steps", "confidence"}, r["id"]
        assert af["confidence"] in ("high", "medium", "low"), r["id"]
        assert af["steps"] and all(s["op"] in OPS for s in af["steps"]), r["id"]
        assert r.get("fix_map") and r.get("record_fix_template"), r["id"]


@pytest.mark.parametrize("rid", sorted(CASES))
def test_rule_fires_on_one_of_two(rid):
    assert fire(rid, CASES[rid]) == (1, 2)


@pytest.mark.parametrize("rid,field,value", [("MM702", "MARC.BSTFE", "0"), ("MM717", "MARC.PLIFZ", "0"),
                                             ("MM770", "MDMA.DISMM", "ND"), ("MM746", "MARD.LMINB", "0")])
def test_set_fix_clears_the_finding(rid, field, value):
    assert RULES[rid]["auto_fix"]["steps"][-1] == {"op": "set", "value": value}
    tables = {t: f.copy() for t, f in CASES[rid].items()}
    tables[field.split(".")[0]][field] = value
    assert fire(rid, tables)[0] == 0


def test_retrofitted_auto_fix():
    expected = {"MM233": "medium", "MM380": "medium", "MM399": "medium", "MM397": "medium", "MM379": "high",
                "MM394": "medium", "MM391": "medium", "MM393": "low", "MM094": "medium", "MM496": "medium"}
    assert {rid: RULES[rid]["auto_fix"]["confidence"] for rid in expected} == expected
    assert RULES["MM233"]["auto_fix"]["steps"] == [{"op": "copy", "from": "MARA.XCHPF"}]
