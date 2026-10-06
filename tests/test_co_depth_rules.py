"""Controlling depth rules (CO042 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

MODULE, PREFIX, START = "controlling", "CO", 42
PACK = yaml.safe_load(open(f"checks/rules/ecc/{MODULE}.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][2:].isdigit() and int(r["id"][2:]) >= START]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module=MODULE)
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def ddic_fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_pack_loads_with_unique_contiguous_ids():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][2:]) for r in NEW)
    assert new == list(range(START, START + len(new)))
    assert len(new) == 18


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in ddic_fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = ddic_fields(r["target_table"])
            assert set(r["target_fields"]) <= set(target), r["id"]
            assert set(r.get("target_when", {})) <= set(target), r["id"]


def test_referential_rules_have_a_check_table_and_domain_rules_fixed_values():
    for r in NEW:
        table, name = r["field"].split(".")
        fld = ddic_fields(table)[name]
        if r["check_class"] == "referential_check":
            assert fld.get("check_table"), r["id"]
        if r["check_class"] == "domain_value_check":
            dom = json.load(open(f"sap/dictionaries/ecc6/domains/{fld['domain']}.json"))
            assert dom.get("fixed_values"), r["id"]


def test_new_rules_run_without_error_on_empty_frames():
    tables = {"CSKS": frame("CSKS", KOKRS=["1000"], KOSTL=["C1"], DATBI=["99991231"]),
              "CSKB": frame("CSKB", KOKRS=["1000"], KSTAR=["400000"], DATBI=["99991231"])}
    frames = TableFrames(tables, DDIC, module=MODULE)
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


CUR = "99991231"


# ---- cost centres ------------------------------------------------------------------------------------------------

def csks(**extra):
    n = len(next(iter(extra.values())))
    cols = {"KOKRS": ["1000"] * n, "KOSTL": [f"C{i}" for i in range(n)], "DATBI": [CUR] * n}
    cols.update(extra)
    return frame("CSKS", **cols)


def test_cost_centre_category_must_exist():
    tka05 = frame("TKA05", KOSAR=["F"])
    assert fire("CO042", {"CSKS": csks(KOSAR=["F", "Z"]), "TKA05": tka05}) == (1, 2)


def test_cost_centre_company_code_and_currency():
    tka02 = frame("TKA02", BUKRS=["1000"], GSBER=[""], KOKRS=["1000"])
    t001 = frame("T001", BUKRS=["1000", "2000"], WAERS=["EUR", "USD"])
    cc = csks(BUKRS=["1000", "2000"], WAERS=["EUR", "EUR"])
    assert fire("CO043", {"CSKS": cc, "TKA02": tka02}) == (1, 2)
    assert fire("CO044", {"CSKS": cc, "T001": t001}) == (1, 2)


def test_cost_centre_points_to_locked_profit_centre():
    cepc = frame("CEPC", KOKRS=["1000", "1000"], PRCTR=["P1", "P2"], DATBI=[CUR, CUR], LOCK_IND=["", "X"])
    assert fire("CO045", {"CSKS": csks(PRCTR=["P1", "P2"]), "CEPC": cepc}) == (1, 2)


# ---- cost elements -----------------------------------------------------------------------------------------------

def test_cost_element_category_against_balance_sheet_indicator():
    tka01 = frame("TKA01", KOKRS=["1000"], KTOPL=["INT"])
    ska1 = frame("SKA1", KTOPL=["INT"] * 3, SAKNR=["400000", "100000", "200000"], XBILK=["", "X", "X"])
    cskb = frame("CSKB", KOKRS=["1000"] * 3, KSTAR=["400000", "100000", "200000"], DATBI=[CUR] * 3,
                 KATYP=["01", "01", "90"])
    assert fire("CO046", {"TKA01": tka01, "SKA1": ska1, "CSKB": cskb})[0] == 1  # 100000 is a balance sheet account
    pl = ska1.assign(**{"SKA1.XBILK": ["", "X", ""]})
    assert fire("CO047", {"TKA01": tka01, "SKA1": pl, "CSKB": cskb})[0] == 1  # category 90 on a P&L account


# ---- activity types ----------------------------------------------------------------------------------------------

def test_activity_type_rules():
    csla = frame("CSLA", KOKRS=["1000"] * 3, LSTAR=["A1", "A2", "A3"], DATAB=["20200101", "20200101", "20300101"],
                 DATBI=[CUR, CUR, "20251231"], LEINH=["H", "", "H"], LATYP=["1", "1", "1"], VKSTA=["943000", "", ""])
    cskb = frame("CSKB", KOKRS=["1000", "1000"], KSTAR=["943000", "400000"], DATBI=[CUR, CUR], KATYP=["43", "01"])
    assert fire("CO048", {"CSLA": csla, "CSKB": cskb})[0] == 0
    wrong = csla.assign(**{"CSLA.VKSTA": ["400000", "", ""]})
    assert fire("CO048", {"CSLA": wrong, "CSKB": cskb})[0] == 1
    assert fire("CO049", {"CSLA": csla})[0] == 1  # A2 has no unit
    assert fire("CO050", {"CSLA": csla})[0] == 1  # A2 is category 1 without an allocation cost element
    assert fire("CO051", {"CSLA": csla})[0] == 1  # A3 starts after it ends


# ---- profit centres ----------------------------------------------------------------------------------------------

def test_profit_centre_segment_and_successor():
    cepc = frame("CEPC", KOKRS=["1000"] * 3, PRCTR=["P1", "P2", "P3"], DATBI=[CUR] * 3, SEGMENT=["S1", "S9", ""],
                 NPRCTR=["", "P1", "P8"])
    assert fire("CO052", {"CEPC": cepc}, {"FAGL_SEGM.SEGMENT": {"S1"}})[0] == 1
    assert fire("CO053", {"CEPC": cepc})[0] == 1
    assert fire("CO054", {"CEPC": cepc})[0] == 1


# ---- orders ------------------------------------------------------------------------------------------------------

def test_statistical_order_with_settlement_rule():
    aufk = frame("AUFK", AUFNR=["1", "2", "3"], OBJNR=["OR1", "OR2", "OR3"], ASTKZ=["X", "X", ""])
    cobrb = frame("COBRB", OBJNR=["OR1", "OR3"], BUREG=["1", "1"], LFDNR=["1", "1"])
    assert fire("CO055", {"AUFK": aufk, "COBRB": cobrb})[0] == 1  # OR3 is a real order


def test_order_settlement_cost_centre_must_exist():
    aufk = frame("AUFK", AUFNR=["1", "2"], KOKRS=["1000", "1000"], KOSTL=["C0", "C9"])
    assert fire("CO056", {"AUFK": aufk, "CSKS": csks(KOSAR=["F"])}) == (1, 2)


# ---- controlling area --------------------------------------------------------------------------------------------

def test_controlling_area_chart_and_company_code_alignment():
    tka01 = frame("TKA01", KOKRS=["1000", "2000"], KTOPL=["INT", "XXX"], LMONA=["K4", "K4"])
    t004 = frame("T004", KTOPL=["INT"])
    assert fire("CO057", {"TKA01": tka01, "T004": t004}) == (1, 2)
    tka02 = frame("TKA02", BUKRS=["1000", "1100"], GSBER=["", ""], KOKRS=["1000", "1000"])
    t001 = frame("T001", BUKRS=["1000", "1100"], KTOPL=["INT", "CAUS"], PERIV=["K4", "V3"])
    assert fire("CO058", {"TKA01": tka01, "TKA02": tka02, "T001": t001}) == (1, 2)
    assert fire("CO059", {"TKA01": tka01, "TKA02": tka02, "T001": t001}) == (1, 2)
