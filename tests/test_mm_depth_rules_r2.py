"""Material master depth rules round 2 (MM1074-MM1096): field-coverage gaps, firing fixtures.

Each fixture holds one failing and one passing record, so every rule must flag exactly 1 of 2.
"""

import json

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
FIRST, LAST = 1074, 1096
NEW = [r for r in PACK if r["id"][2:].isdigit() and FIRST <= int(r["id"][2:]) <= LAST]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def mara(**cols):
    return frame("MARA", **{"MATNR": ["M1", "M2"], **cols})


def marc(**cols):
    return frame("MARC", **{"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], **cols})


def mkal(**cols):
    return frame("MKAL", **{"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "VERID": ["0001", "0001"], **cols})


CASES = {
    "MM1074": ({"MARA": mara(LIQDT=["20250101", "20250101"], LVORM=["", "X"])}, None),
    "MM1075": ({"MARA": mara(XGCHP=["X", "X"], XCHPF=["", "X"])}, None),
    "MM1076": ({"MARA": mara(KZEFF=["Y", "X"])}, None),
    "MM1077": ({"MARC": marc(DZEIT=["5", "5"], BASMG=["0", "100"])}, None),
    "MM1078": ({"MARC": marc(BESKZ=["F", "F"], WZEIT=["5", "20"], PLIFZ=["10", "10"])}, None),
    "MM1079": ({"MARC": marc(MINLS=["50", "10"], MAXLS=["20", "20"])}, None),
    "MM1080": ({"MARC": marc(MAXLS=["500", "100"], BSTMA=["200", "200"])}, None),
    "MM1081": ({"MARC": marc(QZGTP=["Z9", "E31"])}, {"TQ05.ZGTYP": {"E31"}}),
    "MM1082": ({"MARC": marc(BESKZ=["F", "E"]),
                "MBEW": frame("MBEW", MATNR=["M1", "M2"], BWKEY=["P1", "P1"], BWTAR=["", ""], OWNPR=["X", "X"])},
               None),
    "MM1083": ({"MVKE": frame("MVKE", MATNR=["M1", "M2"], VKORG=["S1", "S1"], VTWEG=["01", "01"],
                              SKTOF=["1", "X"])}, None),
    "MM1084": ({"MKAL": mkal(ALORT=["9999", "0001"])}, {"T001L.LGORT": {"0001"}}),
    "MM1085": ({"MKAL": mkal(ALORT=["0009", "0001"]),
                "MARD": frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"])}, None),
    "MM1086": ({"MKAL": mkal(VERTO=["ZZZZ", "000A"])}, {"T437V.VERTL": {"000A"}}),
    "MM1087": ({"MKAL": mkal(SOBSL=["99", "50"])}, {"T460A.SOBSL": {"50"}}),
    "MM1088": ({"MKAL": mkal(EWAHR=["150", "50"])}, None),
    "MM1089": ({"QMAT": frame("QMAT", MATNR=["M1", "M2"], WERKS=["P1", "P1"], ART=["01", "01"],
                              AUFNR_CO=["000000999999", "000000100001"])}, {"AUFK.AUFNR": {"000000100001"}}),
    "MM1090": ({"MARA": mara(CMREL=["X", "1"])}, None),
    "MM1091": ({"MARC": marc(KZPSP=["2", "1"])}, None),
    "MM1092": ({"MARC": marc(UCHKZ=["X", "1"])}, None),
    "MM1093": ({"MLGN": frame("MLGN", MATNR=["M1", "M2"], LGNUM=["W01", "W01"], L2SKR=["1", "2"])}, None),
    "MM1094": ({"MARA": mara(MATFI=["Y", "X"])}, None),
    "MM1095": ({"MARA": mara(KZNFM=["1", "X"])}, None),
    "MM1096": ({"MARC": marc(FXPRU=["X", "X"], KZKUP=["", "X"])}, None),
}


def test_ids_are_contiguous_and_unique():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    assert sorted(int(r["id"][2:]) for r in NEW) == list(range(FIRST, LAST + 1))
    assert set(CASES) == {r["id"] for r in NEW}


def test_referential_rules_have_a_check_table_and_domain_rules_fixed_values():
    for r in NEW:
        table, name = r["field"].split(".")
        fld = next(x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"] if x["name"] == name)
        if r["check_class"] == "referential_check":
            assert fld.get("check_table"), r["id"]
        if r["check_class"] == "domain_value_check":
            dom = json.load(open(f"sap/dictionaries/ecc6/domains/{fld['domain']}.json"))
            assert dom.get("fixed_values"), r["id"]


@pytest.mark.parametrize("rid", sorted(CASES))
def test_rule_flags_the_bad_record_only(rid):
    tables, refs = CASES[rid]
    assert fire(rid, tables, refs) == (1, 2)
