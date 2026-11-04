"""Material master cross-table consistency rules (MM1097-MM1107): orphan rows and deletion-flag cascade.

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
FIRST, LAST = 1097, 1107
NEW = [r for r in PACK if r["id"][2:].isdigit() and FIRST <= int(r["id"][2:]) <= LAST]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="material_master"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


MARA = frame("MARA", MATNR=["M1"])  # M2 has no general data
MARC1 = frame("MARC", MATNR=["M1"], WERKS=["P1"])
M = ["M1", "M2"]
CASES = {
    "MM1097": {"MBEW": frame("MBEW", MATNR=M, BWKEY=["P1", "P9"]), "MARC": MARC1},
    "MM1098": {"MARD": frame("MARD", MATNR=M, WERKS=["P1", "P9"], LGORT=["0001", "0001"]), "MARC": MARC1},
    "MM1099": {"MVKE": frame("MVKE", MATNR=M, VKORG=["S1", "S1"], VTWEG=["01", "01"]), "MARC": MARC1},
    "MM1100": {"MARC": frame("MARC", MATNR=M, WERKS=["P1", "P1"]), "MARA": MARA},
    "MM1101": {"MBEW": frame("MBEW", MATNR=M, BWKEY=["P1", "P1"]), "MARA": MARA},
    "MM1102": {"MVKE": frame("MVKE", MATNR=M, VKORG=["S1", "S1"], VTWEG=["01", "01"]), "MARA": MARA},
    "MM1103": {"MARD": frame("MARD", MATNR=M, WERKS=["P1", "P1"], LGORT=["0001", "0001"]), "MARA": MARA},
    "MM1104": {"MARM": frame("MARM", MATNR=M, MEINH=["PC", "PC"]), "MARA": MARA},
    "MM1105": {"MLAN": frame("MLAN", MATNR=M, ALAND=["ZA", "ZA"], TATYP=["MWST", "MWST"]), "MARA": MARA},
    "MM1106": {"MARA": frame("MARA", MATNR=M, LVORM=["X", "X"]),
               "MARC": frame("MARC", MATNR=M, WERKS=["P1", "P1"]),
               "MARD": frame("MARD", MATNR=M, WERKS=["P1", "P1"], LGORT=["0001", "0001"], LVORM=["", "X"])},
    "MM1107": {"MARA": frame("MARA", MATNR=M, LVORM=["X", "X"]),
               "MARC": frame("MARC", MATNR=M, WERKS=["P1", "P1"]),
               "MBEW": frame("MBEW", MATNR=M, BWKEY=["P1", "P1"], LVORM=["", "X"])},
}


def test_ids_are_contiguous_and_cases_complete():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    assert sorted(int(r["id"][2:]) for r in NEW) == list(range(FIRST, LAST + 1))
    assert set(CASES) == {r["id"] for r in NEW}


@pytest.mark.parametrize("rid", sorted(CASES))
def test_rule_flags_the_bad_record_only(rid):
    assert fire(rid, CASES[rid]) == (1, 2)
