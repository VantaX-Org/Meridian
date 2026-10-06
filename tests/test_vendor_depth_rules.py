"""Vendor master depth rules (AP212 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/accounts_payable.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"].startswith("AP") and r["id"][2:].isdigit() and int(r["id"][2:]) >= 212]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
PERSONAL = {"NAME1", "NAME2", "STRAS", "ORT01", "PSTLZ", "PFACH", "PSTL2", "BANKN", "BANKL", "IBAN", "KOINH",
            "STCD1", "STCD2", "STCD3", "STCD4", "STCEG", "QSZNR", "SMTP_ADDR", "TELF1"}
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="accounts_payable")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_pack_loads_with_unique_contiguous_ids():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][2:]) for r in NEW)
    assert new == list(range(212, 212 + len(new)))
    assert len(new) >= 60


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {}), *r.get("block_by", [])}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        if r.get("evidence_key"):
            refs.add(r["evidence_key"])
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = _fields(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= set(target), r["id"]


def test_referential_rules_have_a_check_table():
    for r in NEW:
        if r["check_class"] == "referential_check":
            table, name = r["field"].split(".")
            assert _fields(table)[name].get("check_table") not in (None, "", "*"), r["id"]


def test_templates_never_echo_personal_values():
    for r in NEW:
        echoed = {f.split(".")[1] for f in re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"])}
        assert not echoed & PERSONAL, (r["id"], echoed & PERSONAL)


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"LFA1": frame("LFA1", LIFNR=["V1"]), "LFB1": frame("LFB1", LIFNR=["V1"], BUKRS=["1000"])}
    frames = TableFrames(tables, DDIC, module="accounts_payable")
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- general data -------------------------------------------------------------------------------------------------

def test_trading_partner_and_industry_must_exist():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], VBUND=["C1", "C9"], BRSCH=["B1", "B9"])
    assert fire("AP213", {"LFA1": lfa1, "T880": frame("T880", RCOMP=["C1"])}) == (1, 2)
    assert fire("AP212", {"LFA1": lfa1, "T016": frame("T016", BRSCH=["B1"])}) == (1, 2)


def test_one_time_flag_matches_account_group():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3", "V4"], KTOKK=["CPD", "KRED", "CPD", "KRED"], XCPDK=["X", "X", "", ""])
    t077k = frame("T077K", KTOKK=["CPD", "KRED"], XCPDS=["X", ""])
    assert fire("AP216", {"LFA1": lfa1, "T077K": t077k}) == (1, 2)  # V2: one-time flag, normal group
    assert fire("AP217", {"LFA1": lfa1, "T077K": t077k}) == (1, 2)  # V3: one-time group, no flag


def test_alternative_payee_needs_bank_and_must_be_active():
    lfa1 = frame("LFA1", LIFNR=["V1", "P1", "V2", "P2"], LNRZA=["P1", "", "P2", ""], LOEVM=["", "", "", "X"],
                 SPERR=["", "", "", ""])
    lfbk = frame("LFBK", LIFNR=["P1"], BANKS=["DE"], BANKL=["1"], BANKN=["1"])
    assert fire("AP218", {"LFA1": lfa1, "LFBK": lfbk}) == (1, 2)
    assert fire("AP219", {"LFA1": lfa1}) == (1, 2)


def test_deletion_flag_without_blocks():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], LOEVM=["X", "X", ""], SPERR=["X", "", ""], SPERM=["X", "X", ""],
                 NODEL=["X", "", ""])
    assert fire("AP221", {"LFA1": lfa1}) == (1, 3)
    assert fire("AP220", {"LFA1": lfa1}) == (1, 3)


def test_address_differs_from_adrc():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], ADRNR=["A1", "A2"], LAND1=["DE", "DE"], ORT01=["Berlin", "Berlin"],
                 PSTLZ=["10115", "10115"])
    adrc = frame("ADRC", ADDRNUMBER=["A1", "A2"], NATION=["", ""], COUNTRY=["DE", "AT"], CITY1=["Berlin", "Berlin"],
                 POST_CODE1=["10115", "10115"])
    assert fire("AP226", {"LFA1": lfa1, "ADRC": adrc})[0] == 1


def test_vat_liable_eu_vendor_without_vat_number():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], LAND1=["DE", "DE", "US"], STKZU=["X", "X", "X"],
                 STCEG=["DE123456789", "", ""])
    assert fire("AP227", {"LFA1": lfa1}) == (1, 2)


def test_additional_vat_number_prefix():
    lfas = frame("LFAS", LIFNR=["V1", "V1", "V1", "V1"], LAND1=["FR", "GR", "GB", "IT"],
                 STCEG=["FR12345678901", "EL123456789", "XI123456789", "DE123456789"])
    assert fire("AP228", {"LFAS": lfas}) == (1, 4)


def test_tax_number_duplicates_per_country():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], LAND1=["ZA", "ZA", "NA"],
                 STCD1=["41-2345", "412345", "412345"])
    assert fire("AP229", {"LFA1": lfa1}) == (2, 3)


def test_customer_link_to_deleted_customer():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], KUNNR=["C1", "C2"], LOEVM=["", ""])
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LOEVM=["X", ""])
    assert fire("AP233", {"LFA1": lfa1, "KNA1": kna1})[0] == 1


# ---- bank data ----------------------------------------------------------------------------------------------------

def test_partner_bank_type_ambiguity():
    lfbk = frame("LFBK", LIFNR=["V1", "V1", "V2", "V2"], BANKS=["DE"] * 4, BANKL=["1", "2", "3", "4"],
                 BANKN=["1", "2", "3", "4"], BVTYP=["A", "A", "", ""])
    assert fire("AP235", {"LFBK": lfbk}) == (2, 2)
    assert fire("AP236", {"LFBK": lfbk}) == (2, 2)


def test_vendor_bank_equals_house_bank():
    lfbk = frame("LFBK", LIFNR=["V1", "V2"], BANKS=["DE", "DE"], BANKL=["1", "1"], BANKN=["111", "222"])
    t012k = frame("T012K", BUKRS=["1000"], HBKID=["DB"], HKTID=["EUR"], BANKN=["111"])
    assert fire("AP238", {"LFBK": lfbk, "T012K": t012k}) == (1, 2)


def test_bank_flagged_for_deletion():
    lfbk = frame("LFBK", LIFNR=["V1", "V2"], BANKS=["DE", "DE"], BANKL=["1", "2"], BANKN=["1", "2"])
    bnka = frame("BNKA", BANKS=["DE", "DE"], BANKL=["1", "2"], LOEVM=["", "X"])
    assert fire("AP239", {"LFBK": lfbk, "BNKA": bnka}) == (1, 2)


# ---- company code data --------------------------------------------------------------------------------------------

def test_customer_only_payment_terms():
    lfb1 = frame("LFB1", LIFNR=["V1", "V2"], BUKRS=["1000", "1000"], ZTERM=["ZB30", "D030"])
    t052 = frame("T052", ZTERM=["ZB30", "D030"], ZTAGG=["0", "0"], KOART=["", "D"])
    assert fire("AP240", {"LFB1": lfb1, "T052": t052}) == (1, 2)


def test_house_bank_in_other_company_code():
    lfb1 = frame("LFB1", LIFNR=["V1", "V2"], BUKRS=["1000", "2000"], HBKID=["DB", "DB"])
    t012 = frame("T012", BUKRS=["1000"], HBKID=["DB"])
    assert fire("AP242", {"LFB1": lfb1, "T012": t012}) == (1, 2)


def test_head_office_chain_and_missing_head_office():
    lfb1 = frame("LFB1", LIFNR=["H0", "H1", "B1", "B2"], BUKRS=["1000"] * 4, LNRZE=["", "H0", "H1", "H9"])
    assert fire("AP248", {"LFB1": lfb1}) == (1, 3)  # B2: H9 not in 1000
    assert fire("AP249", {"LFB1": lfb1}) == (1, 3)  # B1: H1 is itself a branch


def test_expired_withholding_exemption():
    lfb1 = frame("LFB1", LIFNR=["V1", "V2"], BUKRS=["1000", "1000"], QSZNR=["C1", "C2"], QSZDT=["20000101", "29991231"])
    assert fire("AP247", {"LFB1": lfb1}) == (1, 2)


def test_central_deletion_with_open_company_code():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], LOEVM=["X", "X"], SPERR=["", ""])
    lfb1 = frame("LFB1", LIFNR=["V1", "V2"], BUKRS=["1000", "1000"], LOEVM=["", "X"], SPERR=["", ""])
    assert fire("AP253", {"LFA1": lfa1, "LFB1": lfb1}) == (1, 2)


def test_previous_account_duplicates():
    lfb1 = frame("LFB1", LIFNR=["V1", "V2", "V3"], BUKRS=["1000", "1000", "2000"], ALTKN=["L1", "L1", "L1"])
    assert fire("AP246", {"LFB1": lfb1}) == (2, 3)


# ---- purchasing, partners, contacts, lifecycle ----------------------------------------------------------------------

def test_ers_without_gr_based_iv():
    lfm1 = frame("LFM1", LIFNR=["V1", "V2"], EKORG=["1000", "1000"], XERSY=["X", "X"], WEBRE=["X", ""])
    assert fire("AP257", {"LFM1": lfm1}) == (1, 2)


def test_purchasing_data_without_company_code():
    lfm1 = frame("LFM1", LIFNR=["V1", "V2"], EKORG=["1000", "1000"], SPERM=["", ""])
    lfb1 = frame("LFB1", LIFNR=["V1"], BUKRS=["1000"])
    assert fire("AP262", {"LFM1": lfm1, "LFB1": lfb1}) == (1, 2)


def test_partner_function_targets():
    wyt3 = frame("WYT3", LIFNR=["V1", "V1"], EKORG=["1000", "1000"], PARVW=["RS", "RS"], LIFN2=["P1", "P2"],
                 DEFPA=["X", "X"], LTSNR=["", ""], WERKS=["", ""])
    lfa1 = frame("LFA1", LIFNR=["V1", "P1", "P2"], LOEVM=["", "", "X"], SPERM=["", "X", ""])
    lfb1 = frame("LFB1", LIFNR=["P1"], BUKRS=["1000"])
    assert fire("AP265", {"WYT3": wyt3, "LFA1": lfa1}) == (1, 2)
    assert fire("AP266", {"WYT3": wyt3, "LFA1": lfa1}) == (1, 2)
    assert fire("AP271", {"WYT3": wyt3, "LFB1": lfb1}) == (1, 2)
    assert fire("AP269", {"WYT3": wyt3}) == (2, 2)


def test_contact_person_rules():
    knvk = frame("KNVK", PARNR=["1", "2", "3"], LIFNR=["V1", "V2", "V9"], KUNNR=["", "C1", ""], LOEVM=["", "", ""])
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], LOEVM=["X", ""])
    assert fire("AP272", {"KNVK": knvk, "LFA1": lfa1}) == (1, 3)
    assert fire("AP273", {"KNVK": knvk}) == (1, 3)
    assert fire("AP274", {"KNVK": knvk, "LFA1": lfa1})[0] == 1


def test_vendor_without_company_code_or_purchasing_view():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], SPERR=["", ""], SPERM=["", ""], WERKS=["", ""], XCPDK=["", ""])
    lfb1 = frame("LFB1", LIFNR=["V1"], BUKRS=["1000"])
    lfm1 = frame("LFM1", LIFNR=["V2"], EKORG=["1000"])
    assert fire("AP275", {"LFA1": lfa1, "LFB1": lfb1}) == (1, 2)
    assert fire("AP276", {"LFA1": lfa1, "LFM1": lfm1}) == (1, 2)


def test_name_city_duplicates_and_staleness():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], NAME1=["Acme Supplies", "ACME Supplies", "Other Ltd"],
                 LAND1=["ZA", "ZA", "ZA"], ORT01=["Durban", "Durban", "Durban"],
                 UPDAT=["20100101", "29990101", "29990101"], SPERR=["", "", ""], SPERM=["", "", ""])
    assert fire("AP232", {"LFA1": lfa1})[0] == 2
    assert fire("AP234", {"LFA1": lfa1})[0] == 1
