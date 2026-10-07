"""Material master valuation / sales / WM / QM / batch / info-record depth rules (MM800-MM899).

Every fixture holds one failing and one passing record, so each rule is proven to fire and to stay quiet.
"""
import datetime as dt

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
BLOCK = [r for r in PACK if r["id"][2:].isdigit() and 800 <= int(r["id"][2:]) <= 899]
DDIC = get_dictionary("ecc6")
OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros", "regex_replace",
       "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]


def _day(offset):
    return (dt.date.today() + dt.timedelta(days=offset)).strftime("%Y%m%d")


def t(table, *rows):
    cols = list(dict.fromkeys(k for r in rows for k in r))
    return pd.DataFrame({f"{table}.{c}": [r.get(c) for r in rows] for c in cols})


def fire(rid, tables):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(RULES[rid]), frames, {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def mb(**kw):
    return {"MATNR": "M1", "BWKEY": "P1", **kw}


MARA2 = t("MARA", {"MATNR": "M1", "MTART": "ROH"}, {"MATNR": "M2", "MTART": "FERT"})
MARC2 = t("MARC", {"MATNR": "M1", "WERKS": "P1"}, {"MATNR": "M2", "WERKS": "P1"})

# rule id -> tables; every fixture expects exactly one failing record out of two in scope
CASES = {
    "MM800": {"MBEW": t("MBEW", mb(VPRSV="S"), mb(MATNR="M2", VPRSV="S")), "MARA": MARA2, "MARC": MARC2,
              "T134": t("T134", {"MTART": "ROH", "KZVPR": "X", "VPRSV": "V"}, {"MTART": "FERT", "VPRSV": "S"})},
    "MM801": {"MBEW": t("MBEW", mb(VPRSV="V"), mb(MATNR="M2", VPRSV="V")), "MARA": MARA2, "MARC": MARC2,
              "T134": t("T134", {"MTART": "ROH", "KZVPR": "X", "VPRSV": "S"}, {"MTART": "FERT", "VPRSV": "V"})},
    "MM802": {"MBEW": t("MBEW", mb(), mb(BWKEY="P2")),
              "T001K": t("T001K", {"BWKEY": "P1", "MLBWA": "X"}, {"BWKEY": "P2"})},
    "MM803": {"CKMLHD": t("CKMLHD", {"KALNR": "1", "MATNR": "M1", "BWKEY": "P1", "MLAST": "3"},
                          {"KALNR": "2", "MATNR": "M2", "BWKEY": "P1", "MLAST": "2"}),
              "MBEW": t("MBEW", mb(MLAST="2"), mb(MATNR="M2", MLAST="2"))},
    "MM804": {"MBEW": t("MBEW", mb(MLAST="3", VPRSV="V"), mb(MATNR="M2", MLAST="3", VPRSV="S"))},
    "MM805": {"MBEW": t("MBEW", mb(MLMAA="X"), mb(MATNR="M2", MLMAA="X", KALN1="100"))},
    "MM806": {"MBEW": t("MBEW", mb(KALN1="100"), mb(MATNR="M2", KALN1="200")),
              "CKMLHD": t("CKMLHD", {"KALNR": "200", "MATNR": "M2", "BWKEY": "P1"})},
    "MM807": {"CKMLHD": t("CKMLHD", {"KALNR": "1", "BWKEY": "P1"}, {"KALNR": "2", "BWKEY": "P2"}),
              "T001K": t("T001K", {"BWKEY": "P1"}, {"BWKEY": "P2", "MLBWA": "X"})},
    "MM809": {"MBEW": t("MBEW", mb(MLMAA="X", VPRSV="S", LBKUM="5", VERPR="0"),
                        mb(MATNR="M2", MLMAA="X", VPRSV="S", LBKUM="5", VERPR="9.5"))},
    "MM810": {"MBEW": t("MBEW", mb(ZKDAT="20300101"), mb(MATNR="M2", ZKDAT="20300101", ZKPRS="12"))},
    "MM811": {"MBEW": t("MBEW", mb(VMVPR="S", VMKUM="3", VMSTP="0"), mb(MATNR="M2", VMVPR="S", VMKUM="3", VMSTP="4"))},
    "MM813": {"MBEW": t("MBEW", mb(VMKUM="3", VMPEI="0", VJKUM=None, VJPEI=None), mb(MATNR="M2", VMKUM="3", VMPEI="1"))},
    "MM815": {"MBEW": t("MBEW", mb(LVORM="X", LBKUM="2", SALK3="20"), mb(MATNR="M2", LVORM="X", LBKUM="0", SALK3="0"))},
    "MM816": {"MBEW": t("MBEW", mb(BWTTY="X"), mb(MATNR="M2", BWTTY="X"), mb(MATNR="M2", BWTAR="DOM", BWTTY="X"))},
    "MM817": {"MBEW": t("MBEW", mb(BWTAR="DOM"), mb(MATNR="M2"), mb(MATNR="M2", BWTAR="DOM"))},
    "MM821": {"MBEW": t("MBEW", mb(ZPLD1="20300601", ZPLD2="20300101", ZPLD3=None), mb(MATNR="M2", ZPLD1="20300101", ZPLD2="20300601"))},
    "MM824": {"MBEW": t("MBEW", mb(MYPOL="P01"), mb(MATNR="M2", MYPOL="P01", XLIFO="X"))},
    "MM825": {"MBEW": t("MBEW", mb(VPRSV="S", STPRS="0", LBKUM="0"), mb(MATNR="M2", VPRSV="S", STPRS="5", LBKUM="0"))},
    "MM827": {"MVKE": t("MVKE", {"MATNR": "M1", "VKORG": "1000", "VTWEG": "10", "DWERK": "P9"},
                        {"MATNR": "M2", "VKORG": "1000", "VTWEG": "10", "DWERK": "P1"}),
              "TVKWZ": t("TVKWZ", {"VKORG": "1000", "VTWEG": "10", "WERKS": "P1"})},
    "MM829": {"MVKE": t("MVKE", {"MATNR": "M1", "VKORG": "1000", "VTWEG": "10", "SCHME": "PAL"},
                        {"MATNR": "M2", "VKORG": "1000", "VTWEG": "10", "SCHME": "CS"}),
              "MARM": t("MARM", {"MATNR": "M2", "MEINH": "CS"})},
    "MM830": {"MVKE": t("MVKE", {"MATNR": "M1", "VKORG": "1000", "VTWEG": "10", "LFMAX": "5", "LFMNG": "10"},
                        {"MATNR": "M2", "VKORG": "1000", "VTWEG": "10", "LFMAX": "50", "LFMNG": "10"})},
    "MM834": {"MVKE": t("MVKE", {"MATNR": "M1", "VKORG": "1000", "VTWEG": "10", "AUMNG": "7", "SCMNG": "5"},
                        {"MATNR": "M2", "VKORG": "1000", "VTWEG": "10", "AUMNG": "10", "SCMNG": "5"})},
    "MM835": {"MVKE": t("MVKE", {"MATNR": "M1", "VKORG": "1000", "VTWEG": "10", "PMATN": "M1"},
                        {"MATNR": "M2", "VKORG": "1000", "VTWEG": "10", "PMATN": "M1"})},
    "MM838": {"MLGN": t("MLGN", {"MATNR": "M1", "LGNUM": "100", "LHMG1": "40", "LHMG2": None, "LETY2": None, "LHMG3": None, "LETY3": None},
                        {"MATNR": "M2", "LGNUM": "100", "LHMG1": "40", "LETY1": "E1"})},
    "MM843": {"MLGT": t("MLGT", {"MATNR": "M1", "LGNUM": "100", "LGTYP": "001", "LGPLA": "01-01"},
                        {"MATNR": "M2", "LGNUM": "100", "LGTYP": "001", "LGPLA": "01-02"}),
              "LAGP": t("LAGP", {"LGNUM": "100", "LGTYP": "001", "LGPLA": "01-02"})},
    "MM846": {"MLGT": t("MLGT", {"MATNR": "M1", "LGNUM": "100", "LGTYP": "001", "LPMAX": "10", "NSMNG": "20"},
                        {"MATNR": "M2", "LGNUM": "100", "LGTYP": "001", "LPMAX": "30", "NSMNG": "20"})},
    "MM849": {"QMAT": t("QMAT", {"ART": "01", "MATNR": "M1", "WERKS": "P1", "HPZ": "X", "SPROZ": "10", "STICHPRVER": None},
                        {"ART": "01", "MATNR": "M2", "WERKS": "P1", "HPZ": "X"})},
    "MM851": {"QMAT": t("QMAT", {"ART": "01", "MATNR": "M1", "WERKS": "P1", "MER": "X", "SPEZUEBER": None, "CONF": None, "TLS": None},
                        {"ART": "01", "MATNR": "M2", "WERKS": "P1", "MER": "X", "PPL": "X"})},
    "MM856": {"MCH1": t("MCH1", {"MATNR": "M1", "CHARG": "B1"}, {"MATNR": "M1", "CHARG": "B2", "VFDAT": "20300101"}),
              "MARA": t("MARA", {"MATNR": "M1", "MHDHB": "180"})},
    "MM858": {"MCH1": t("MCH1", {"MATNR": "M1", "CHARG": "B1", "HSDAT": _day(30)},
                        {"MATNR": "M1", "CHARG": "B2", "HSDAT": _day(-30)})},
    "MM859": {"MCH1": t("MCH1", {"MATNR": "M1", "CHARG": "B1", "HSDAT": "20250201", "LWEDT": "20250101"},
                        {"MATNR": "M1", "CHARG": "B2", "HSDAT": "20250101", "LWEDT": "20250201"})},
    "MM857": {"MCH1": t("MCH1", {"MATNR": "M1", "CHARG": "B1", "HSDAT": "20250101", "VFDAT": "20250401"},
                        {"MATNR": "M1", "CHARG": "B2", "HSDAT": "20250101", "VFDAT": "20250131"}),
              "MARA": t("MARA", {"MATNR": "M1", "MHDHB": "30"})},
    "MM861": {"MCH1": t("MCH1", {"MATNR": "M1", "CHARG": "B1", "LWEDT": "20250101", "VFDAT": "20250110"},
                        {"MATNR": "M1", "CHARG": "B2", "LWEDT": "20250101", "VFDAT": "20250601"}),
              "MARA": t("MARA", {"MATNR": "M1", "MHDRZ": "30"})},
    "MM866": {"EINA": t("EINA", {"INFNR": "1", "LIFNR": "V9", "MATNR": "M1"}, {"INFNR": "2", "LIFNR": "V1", "MATNR": "M1"}),
              "LFA1": t("LFA1", {"LIFNR": "V1"})},
    "MM867": {"EINA": t("EINA", {"INFNR": "1", "LIFNR": "V2", "MATNR": "M1"}, {"INFNR": "2", "LIFNR": "V1", "MATNR": "M1"}),
              "LFA1": t("LFA1", {"LIFNR": "V1"}, {"LIFNR": "V2", "SPERM": "X"})},
    "MM870": {"EINA": t("EINA", {"INFNR": "1", "LIFNR": "V1", "MATNR": "M1", "MATKL": "OLD"},
                        {"INFNR": "2", "LIFNR": "V1", "MATNR": "M2", "MATKL": "G2"}),
              "MARA": t("MARA", {"MATNR": "M1", "MATKL": "G1"}, {"MATNR": "M2", "MATKL": "G2"})},
    "MM873": {"EINE": t("EINE", {"INFNR": "1", "EKORG": "1000", "ESOKZ": "0"}, {"INFNR": "2", "EKORG": "1000", "ESOKZ": "0"}),
              "EINA": t("EINA", {"INFNR": "1", "LIFNR": "V9"}, {"INFNR": "2", "LIFNR": "V1"}),
              "LFM1": t("LFM1", {"LIFNR": "V1", "EKORG": "1000"})},
    "MM877": {"EINE": t("EINE", {"INFNR": "1", "EKORG": "1000", "ESOKZ": "0", "NETPR": "0"},
                        {"INFNR": "2", "EKORG": "1000", "ESOKZ": "0", "NETPR": "12.5"}, {"INFNR": "3", "EKORG": "1000", "ESOKZ": "2"})},
    "MM879": {"EINE": t("EINE", {"INFNR": "1", "EKORG": "1000", "ESOKZ": "0", "MINBM": "10", "NORBM": "5"},
                        {"INFNR": "2", "EKORG": "1000", "ESOKZ": "0", "MINBM": "10", "NORBM": "20"})},
    "MM880": {"EINE": t("EINE", {"INFNR": "1", "EKORG": "1000", "ESOKZ": "0", "PRDAT": _day(-10)},
                        {"INFNR": "2", "EKORG": "1000", "ESOKZ": "0", "PRDAT": _day(300)})},
    "MM883": {"EINE": t("EINE", {"INFNR": "1", "EKORG": "1000", "ESOKZ": "0"}, {"INFNR": "2", "EKORG": "1000", "ESOKZ": "0", "LOEKZ": "X"}),
              "EINA": t("EINA", {"INFNR": "1", "LOEKZ": "X"}, {"INFNR": "2", "LOEKZ": "X"})},
    "MM884": {"EINE": t("EINE", {"INFNR": "1", "EKORG": "1000", "ESOKZ": "0", "UEBTK": "X", "UEBTO": "10"},
                        {"INFNR": "2", "EKORG": "1000", "ESOKZ": "0", "UEBTK": "X"})},
}


def test_block_ids_are_in_range_and_contiguous():
    ids = sorted(int(r["id"][2:]) for r in BLOCK)
    assert 60 <= len(ids) <= 100
    assert ids == list(range(800, 800 + len(ids)))
    pos = [i for i, r in enumerate(PACK) if r in BLOCK]
    assert pos == list(range(len(PACK) - len(BLOCK), len(PACK)))  # one block at the end of the pack


def test_block_has_full_metadata():
    for r in BLOCK:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)


def test_auto_fix_uses_known_ops_and_confidence():
    fixes = [r for r in PACK if "auto_fix" in r]
    assert sum(1 for r in BLOCK if "auto_fix" in r) >= 8
    for r in fixes:
        af = r["auto_fix"]
        assert af["confidence"] in {"high", "medium", "low"}, r["id"]
        assert af["steps"] and all(s["op"] in OPS for s in af["steps"]), r["id"]


def test_at_least_25_fixtures():
    assert len(CASES) >= 25 and set(CASES) <= {r["id"] for r in BLOCK}


@pytest.mark.parametrize("rid", sorted(CASES))
def test_rule_fails_bad_and_passes_good_record(rid):
    affected, total = fire(rid, CASES[rid])
    assert affected == 1, (rid, affected, total)
    assert total == 2, (rid, affected, total)
