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
}
EXPECT = {"MM901": (2, 3), "MM908": (2, 3), "MM916": (2, 3), "MM917": (2, 3), "MM920": (2, 3)}


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
