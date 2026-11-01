"""Exhaustive material-master gap rules (MM900 upward): IDs, schema contract and firing fixtures.

Each fixture flags a known subset of its records; most hold one failing and one passing record.
"""

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][2:].isdigit() and int(r["id"][2:]) >= 900]
DDIC = get_dictionary("ecc6")
OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros", "regex_replace",
       "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
ENRICHMENT = ("message", "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(RULES[rid]), frames, None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def kssk(**cols):
    base = {"OBJEK": ["M1", "M2"], "MAFID": ["O", "O"], "KLART": ["001", "001"], "CLINT": ["C1", "C2"],
            "LKENZ": ["", ""]}
    return frame("KSSK", **{**base, **cols})


def ausp(**cols):
    base = {"OBJEK": ["M1", "M2"], "ATINN": ["A1", "A2"], "KLART": ["001", "001"], "LKENZ": ["", ""]}
    return frame("AUSP", **{**base, **cols})


def cabn(**cols):
    base = {"ATINN": ["A1", "A2"], "ATNAM": ["COLOR", "SIZE"], "ATFOR": ["CHAR", "CHAR"], "ATTAB": ["", ""]}
    return frame("CABN", **{**base, **cols})


def mast(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "STLAN": ["1", "1"], "STLNR": ["1", "2"],
            "STLAL": ["01", "01"]}
    return frame("MAST", **{**base, **cols})


def stko(**cols):
    base = {"STLTY": ["M", "M"], "STLNR": ["1", "2"], "STLAL": ["01", "01"], "STKOZ": ["1", "1"],
            "LKENZ": ["", ""]}
    return frame("STKO", **{**base, **cols})


def mcha(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "CHARG": ["B1", "B2"]}
    return frame("MCHA", **{**base, **cols})


def mchb(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "LGORT": ["L1", "L1"], "CHARG": ["B1", "B2"]}
    return frame("MCHB", **{**base, **cols})


def eord(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "ZEORD": ["1", "1"]}
    return frame("EORD", **{**base, **cols})


def qinf(**cols):
    base = {"MATNR": ["M1", "M2"], "ZAEHL": ["1", "2"], "LIEFERANT": ["V1", "V1"], "WERK": ["P1", "P1"],
            "LOEKZ": ["", ""]}
    return frame("QINF", **{**base, **cols})


def marc(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"]}
    return frame("MARC", **{**base, **cols})


CASES = {
    "MM900": {"KSSK": kssk(STATU=["", "1"])},
    "MM901": {"KSSK": kssk(OBJEK=["M1", "M1", "M2"], MAFID=["O"] * 3, KLART=["001"] * 3,
                           CLINT=["C1", "C2", "C3"], LKENZ=[""] * 3, STDCL=["X", "X", "X"])},
    "MM902": {"KSSK": kssk(), "KLAH": frame("KLAH", CLINT=["C1", "C2"], KLART=["001", "023"])},
    "MM903": {"KSSK": kssk(), "KLAH": frame("KLAH", CLINT=["C1", "C2"], BISDT=["20000101", "99991231"])},
    "MM904": {"AUSP": ausp(DATUV=["20200101", "20200101"], DATUB=["20190101", "99991231"])},
    "MM905": {"AUSP": ausp(), "CABN": cabn(LKENZ=["X", ""])},
    "MM906": {"AUSP": ausp(ATINN=["A1", "A1"], ATWRT=["RED", "BLUE"]),
              "CAWN": frame("CAWN", ATINN=["A1", "A1"], ATWRT=["RED", "BLUE"], LKENZ=["X", ""])},
    "MM907": {"INOB": frame("INOB", CUOBJ=["1", "2"], OBTAB=["MARA", "MARA"], OBJEK=["", "M1"])},
    "MM908": {"INOB": frame("INOB", CUOBJ=["1", "2", "3"], OBTAB=["MARA"] * 3, OBJEK=["M1", "M1", "M2"],
                            KLART=["001"] * 3)},
    "MM909": {"CABN": cabn(ATINT=["X", "X"], ATFOR=["CHAR", "NUM"])},
    "MM910": {"CABN": cabn(ATVOR=["X", "X"], ATFOR=["DATE", "NUM"])},
    "MM911": {"CABN": cabn(ATKLE=["X", "X"], ATFOR=["NUM", "CHAR"])},
    "MM912": {"CABN": cabn(ANZDZ=["2", "0"])},
    "MM913": {"CABN": cabn(ATTAB=["MARA", "MARA"], ATFEL=["", "BRGEW"])},
    "MM914": {"CABN": cabn(ATNAM=["", "SIZE"])},
    "MM915": {"CABN": cabn(ATFOR=["", "CHAR"])},
    "MM916": {"CAWN": frame("CAWN", ATINN=["A1"] * 3, ATZHL=["1", "2", "3"], ATWRT=["RED", "RED", "BLUE"],
                            LKENZ=[""] * 3)},
    "MM917": {"KLAH": frame("KLAH", CLINT=["1", "2", "3"], KLART=["001"] * 3, CLASS=["PUMPS", "PUMPS", "VALVES"])},
    "MM918": {"MAST": mast(STLAN=["", "1"])},
    "MM919": {"MAST": mast(STLAL=["", "01"])},
    "MM920": {"MAST": mast(MATNR=["M1", "M1", "M2"], WERKS=["P1"] * 3, STLAN=["1"] * 3, STLNR=["1", "2", "3"],
                           STLAL=["01", "02", "01"])},
    "MM921": {"MAST": mast(), "STKO": stko(STLAL=["01", "02"])},
    "MM922": {"MAST": mast(), "MARC": frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LVORM=["X", ""])},
    "MM923": {"MAST": mast(), "STKO": stko(BMEIN=["EA", "EA"]),
              "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["KG", "EA"])},
    "MM924": {"STKO": stko(BMENG=["0", "1"])},
    "MM925": {"STKO": stko(BMEIN=["", "EA"])},
    "MM926": {"STKO": stko(STLST=["", "1"])},
    "MM927": {"STKO": stko(DATUV=["", "20200101"])},
    "MM928": {"STKO": stko(STLAL=["", "01"])},
    "MM929": {"MCHA": mcha(), "MARC": marc(MATNR=["M2", "M3"])},
    "MM930": {"MCHA": mcha(HSDAT=["20240101", "20240101"], VFDAT=["20231231", "20250101"])},
    "MM931": {"MCHA": mcha(ERSDA=["20240101", "20240101"], LAEDA=["20231231", "20240201"])},
    "MM932": {"MCHA": mcha(HSDAT=["20240101", "20240101"], LWEDT=["20231231", "20240201"])},
    "MM933": {"MCHA": mcha(HSDAT=["29990101", "20240101"])},
    "MM934": {"MCHA": mcha(LWEDT=["29990101", "20240101"])},
    "MM935": {"MCHA": mcha(VERAB=["20250201", "20240101"], VFDAT=["20250101", "20250101"])},
    "MM936": {"MCHA": mcha(VLCHA=["B9", "B9"], VLMAT=["", "M9"])},
    "MM937": {"MCHA": mcha(LIFNR=["V9", "V1"]), "LFA1": frame("LFA1", LIFNR=["V1"])},
    "MM938": {"MCHA": mcha(VFDAT=["20200101", "20200101"], ZUSTD=["", "X"])},
    "MM939": {"MCHA": mcha(QNDAT=["20200101", "29990101"], ZUSTD=["", ""])},
    "MM940": {"MCHA": mcha(CHAME=["KG", "EA"]), "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["EA", "EA"])},
    "MM941": {"MCHB": mchb(), "MCHA": mcha(MATNR=["M2"], WERKS=["P1"], CHARG=["B2"])},
    "MM942": {"MCHB": mchb(), "MARD": frame("MARD", MATNR=["M2"], WERKS=["P1"], LGORT=["L1"])},
    "MM943": {"MCHB": mchb(CEINM=[-1.0, 0.0], CINSM=[0.0, 0.0], CSPEM=[0.0, 0.0], CRETM=[0.0, 0.0],
                           CUMLM=[0.0, 5.0])},
    "MM944": {"MCHB": mchb(LVORM=["X", "X"], CLABS=[5.0, 0.0], CINSM=[0.0, 0.0], CSPEM=[0.0, 0.0],
                           CEINM=[0.0, 0.0], CRETM=[0.0, 0.0]), "MCHA": mcha(LVORM=["", ""])},
    "MM945": {"MCHB": mchb(), "MARC": marc(XCHAR=["", "X"])},
    "MM946": {"MCHB": mchb(CHDLL=["29990101", "20240101"])},
    "MM947": {"MCHB": mchb(ERSDA=["20240101", "20240101"], LAEDA=["20231231", "20240201"])},
    "MM948": {"MCHB": mchb(CLABS=[5.0, 0.0]), "MCHA": mcha(VFDAT=["20200101", "20200101"])},
    "MM949": {"EORD": eord(), "MARC": marc(MATNR=["M2", "M3"])},
    "MM950": {"EORD": eord(NOTKZ=["", ""]), "MARC": marc(LVORM=["X", ""])},
    "MM951": {"EORD": eord(LIFNR=["V1", "V1"], RESWK=["P2", ""])},
    "MM952": {"EORD": eord(RESWK=["P1", "P2"])},
    "MM953": {"EORD": eord(EMATN=["X9", "M1"]), "MARA": frame("MARA", MATNR=["M1", "M2"])},
    "MM954": {"EORD": eord(MATNR=["M1", "M1", "M2"], WERKS=["P1"] * 3, ZEORD=["1", "2", "1"],
                           VDATU=["20240101", "20240601", "20240101"], BDATU=["20241231", "20251231", "20241231"],
                           FLIFN=["X"] * 3, NOTKZ=[""] * 3)},
    "MM955": {"EORD": eord(VDATU=["20240601", "20240101"], BDATU=["20240101", "20241231"])},
    "MM956": {"EORD": eord(MEINS=["KG", "EA"]), "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["EA", "EA"])},
    "MM957": {"QINF": qinf(), "MARC": marc(MATNR=["M2", "M3"])},
    "MM958": {"QINF": qinf(), "MARC": marc(LVORM=["X", ""])},
}
EXPECT = {"MM901": (2, 3), "MM908": (2, 3), "MM916": (2, 3), "MM917": (2, 3), "MM920": (2, 3), "MM954": (1, 3)}


def test_ids_contiguous_from_900():
    ids = [int(r["id"][2:]) for r in NEW]
    assert ids == list(range(900, 900 + len(ids)))
    assert PACK[-len(NEW):] == NEW


def test_schema_contract():
    for r in NEW:
        assert all(r.get(k) for k in ENRICHMENT), r["id"]
        assert r["severity"] in ("critical", "high", "medium", "low"), r["id"]
        assert r["rule_authority"] in ("sap_hard_constraint", "best_practice"), r["id"]
        af = r.get("auto_fix")
        if af:
            assert af["confidence"] in ("high", "medium", "low"), r["id"]
            assert af["steps"] and all(s["op"] in OPS for s in af["steps"]), r["id"]


def test_every_new_rule_has_a_fixture():
    assert sorted(CASES) == [r["id"] for r in NEW]


@pytest.mark.parametrize("rid", sorted(CASES))
def test_rule_fires(rid):
    assert fire(rid, CASES[rid]) == EXPECT.get(rid, (1, 2))
