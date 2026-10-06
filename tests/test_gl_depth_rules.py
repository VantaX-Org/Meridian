"""G/L account depth rules (GL207 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

MODULE, PREFIX, START = "fi_gl", "GL", 207
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
    assert len(new) == 20


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
    tables = {"SKA1": frame("SKA1", KTOPL=["INT"], SAKNR=["1"]), "SKB1": frame("SKB1", BUKRS=["1000"], SAKNR=["1"])}
    frames = TableFrames(tables, DDIC, module=MODULE)
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- chart of accounts segment -----------------------------------------------------------------------------------

def test_account_group_must_exist_for_chart():
    ska1 = frame("SKA1", KTOPL=["INT", "INT"], SAKNR=["1", "2"], KTOKS=["SAKO", "ZZZZ"])
    t077s = frame("T077S", KTOPL=["INT"], KTOKS=["SAKO"])
    assert fire("GL207", {"SKA1": ska1, "T077S": t077s}) == (1, 2)


def test_group_account_number_required_and_must_exist():
    t004 = frame("T004", KTOPL=["INT"], KKTPL=["GRP"], DSPRA=["E"])
    ska1 = frame("SKA1", KTOPL=["INT", "INT", "INT", "GRP"], SAKNR=["1", "2", "3", "900"], BILKT=["900", "999", "", ""])
    assert fire("GL208", {"T004": t004, "SKA1": ska1})[0] == 1  # account 2 points at a missing group account
    assert fire("GL209", {"T004": t004, "SKA1": ska1})[0] == 1  # account 3 has none


def test_account_text_in_chart_language():
    t004 = frame("T004", KTOPL=["INT"], DSPRA=["E"])
    ska1 = frame("SKA1", KTOPL=["INT", "INT"], SAKNR=["1", "2"])
    skat = frame("SKAT", SPRAS=["E", "D"], KTOPL=["INT", "INT"], SAKNR=["1", "2"])
    assert fire("GL210", {"T004": t004, "SKA1": ska1, "SKAT": skat}) == (1, 2)


# ---- company code segment ----------------------------------------------------------------------------------------

def test_company_code_segment_needs_chart_master_record():
    t001 = frame("T001", BUKRS=["1000"], KTOPL=["INT"])
    ska1 = frame("SKA1", KTOPL=["INT"], SAKNR=["1"])
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["1", "2"])
    assert fire("GL211", {"T001": t001, "SKA1": ska1, "SKB1": skb1}) == (1, 2)


def test_reconciliation_and_local_currency_accounts_use_company_currency():
    t001 = frame("T001", BUKRS=["1000"], WAERS=["EUR"])
    skb1 = frame("SKB1", BUKRS=["1000"] * 3, SAKNR=["1", "2", "3"], MITKZ=["D", "K", ""], WAERS=["EUR", "USD", "USD"],
                 XSALH=["", "", "X"])
    assert fire("GL212", {"T001": t001, "SKB1": skb1})[0] == 1
    assert fire("GL213", {"T001": t001, "SKB1": skb1})[0] == 1


def test_profit_and_loss_account_in_foreign_currency():
    t001 = frame("T001", BUKRS=["1000"], WAERS=["EUR"])
    ska1 = frame("SKA1", KTOPL=["INT", "INT"], SAKNR=["1", "2"], XBILK=["", "X"])
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["1", "2"], WAERS=["USD", "USD"])
    t001 = t001.assign(**{"T001.KTOPL": ["INT"]})
    assert fire("GL214", {"T001": t001, "SKA1": ska1, "SKB1": skb1})[0] == 1  # balance sheet account 2 is allowed


def test_field_status_group_in_company_code_variant():
    t001 = frame("T001", BUKRS=["1000"], FSTVA=["0001"])
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["1", "2"], FSTAG=["G001", "G999"])
    t004f = frame("T004F", BUKRS=["0001"], FSTAG=["G001"])
    assert fire("GL215", {"T001": t001, "SKB1": skb1, "T004F": t004f}) == (1, 2)


def test_unused_reconciliation_accounts():
    skb1 = frame("SKB1", BUKRS=["1000"] * 3, SAKNR=["140000", "141000", "160000"], MITKZ=["D", "D", "K"])
    knb1 = frame("KNB1", KUNNR=["C1"], BUKRS=["1000"], AKONT=["140000"])
    lfb1 = frame("LFB1", LIFNR=["V1"], BUKRS=["1000"], AKONT=["160000"])
    assert fire("GL216", {"SKB1": skb1, "KNB1": knb1})[0] == 1
    assert fire("GL217", {"SKB1": skb1, "LFB1": lfb1})[0] == 0


def test_alternative_account_in_country_chart():
    t001 = frame("T001", BUKRS=["1000"], KTOP2=["CAFR"])
    skb1 = frame("SKB1", BUKRS=["1000"] * 3, SAKNR=["1", "2", "3"], ALTKT=["401", "999", ""])
    ska1 = frame("SKA1", KTOPL=["CAFR"], SAKNR=["401"])
    assert fire("GL218", {"T001": t001, "SKB1": skb1, "SKA1": ska1})[0] == 1
    assert fire("GL219", {"T001": t001, "SKB1": skb1})[0] == 1


def test_sort_key_must_exist():
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["1", "2"], ZUAWA=["001", "ZZZ"])
    assert fire("GL220", {"SKB1": skb1}, {"TZUN.ZUAWA": {"001"}}) == (1, 2)


# ---- retained earnings, cost elements, company code settings -----------------------------------------------------

def test_retained_earnings_account_is_balance_sheet_and_assigned():
    ska1 = frame("SKA1", KTOPL=["INT"] * 3, SAKNR=["900000", "400000", "400001"], XBILK=["X", "", ""],
                 GVTYP=["", "X", "Y"])
    t030 = frame("T030", KTOPL=["INT", "INT"], KTOSL=["BIL", "BIL"], BWMOD=["", ""], KOMOK=["X", "Z"],
                 BKLAS=["", ""], KONTS=["900000", "400000"])
    assert fire("GL221", {"T030": t030, "SKA1": ska1})[0] == 1  # Z points at a P&L account
    assert fire("GL222", {"SKA1": ska1, "T030": t030})[0] == 1  # type Y has no retained earnings account


def test_profit_and_loss_account_needs_cost_element():
    ska1 = frame("SKA1", KTOPL=["INT"] * 3, SAKNR=["400000", "400001", "100000"], XBILK=["", "", "X"])
    cska = frame("CSKA", KTOPL=["INT"], KSTAR=["400000"])
    assert fire("GL223", {"SKA1": ska1, "CSKA": cska})[0] == 1


def test_account_text_in_company_code_language():
    t001 = frame("T001", BUKRS=["1000"], KTOPL=["INT"], SPRAS=["D"])
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["1", "2"])
    skat = frame("SKAT", SPRAS=["D", "E"], KTOPL=["INT", "INT"], SAKNR=["1", "2"])
    assert fire("GL224", {"T001": t001, "SKB1": skb1, "SKAT": skat}) == (1, 2)


def test_company_code_charts_must_exist():
    t001 = frame("T001", BUKRS=["1000", "2000"], KTOPL=["INT", "XXX"], KTOP2=["CAFR", "YYY"])
    t004 = frame("T004", KTOPL=["INT", "CAFR"])
    assert fire("GL225", {"T001": t001, "T004": t004}) == (1, 2)
    assert fire("GL226", {"T001": t001, "T004": t004}) == (1, 2)
