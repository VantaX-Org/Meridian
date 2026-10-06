"""Customer master and business partner depth rules (AR210+, SDCM208+, BP201+): integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"accounts_receivable": ("AR", 210, 57), "sd_customer_master": ("SDCM", 208, 42),
         "business_partner": ("BP", 201, 26)}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")
RULES, NEW, MODULE = {}, [], {}
for _mod, (_prefix, _start, _) in PACKS.items():
    for _r in yaml.safe_load(open(f"checks/rules/ecc/{_mod}.yaml"))["rules"]:
        RULES[_r["id"]] = _r
        MODULE[_r["id"]] = _mod
        _num = _r["id"][len(_prefix):]
        if _r["id"].startswith(_prefix) and _num.isdigit() and int(_num) >= _start:
            NEW.append(_r)
# keys a similarity rule may report as evidence
KEYS = {"KUNNR", "BUKRS", "VKORG", "VTWEG", "SPART", "PARVW", "PARTNER", "CUSTOMER", "VENDOR", "KKBER", "PARNR",
        "KUNN2", "LIFNR", "KNRZE", "KNRZB", "FISKN", "AKONT", "ADRNR", "ADDRNUMBER", "BKVID", "BANKS", "LAND1",
        "ALAND", "TATYP", "KTOKD", "VBUND", "ZTERM", "RLTYP", "KNKLI"}
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|BIRTH|DEATH|PFACH|PSTL|TEL|SMTP")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module=MODULE[rid])
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


# ---- integrity ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("mod", PACKS)
def test_new_ids_are_unique_and_contiguous(mod):
    prefix, start, count = PACKS[mod]
    pack = yaml.safe_load(open(f"checks/rules/ecc/{mod}.yaml"))["rules"]
    ids = [r["id"] for r in pack]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][len(prefix):]) for r in NEW if MODULE[r["id"]] == mod)
    assert new == list(range(start, start + count))


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {}), *r.get("block_by", [])}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
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
            assert _fields(table)[name].get("check_table"), r["id"]


def test_templates_and_messages_never_echo_personal_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert not SENSITIVE.search(f), (r["id"], f)
        if r["check_class"] == "similarity_check":
            assert r["evidence_key"].split(".")[1] in KEYS, r["id"]


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"KNA1": frame("KNA1", KUNNR=["C1"]), "KNB1": frame("KNB1", KUNNR=["C1"], BUKRS=["1000"]),
              "BUT000": frame("BUT000", PARTNER=["B1"])}
    for r in NEW:
        _, res = run_rule(dict(r), TableFrames(tables, DDIC, module=MODULE[r["id"]]), {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- KNA1 ---------------------------------------------------------------------------------------------------------

def test_us_customer_needs_tax_jurisdiction():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], LAND1=["US", "US", "DE"], TXJCD=["TX0001", "", ""],
                 XCPDK=["", "", ""])
    assert fire("AR213", {"KNA1": kna1}) == (1, 2)


def test_fiscal_address_must_be_active_and_not_self():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3", "C4"], FISKN=["C2", "C9", "C3", ""], LOEVM=["", "", "", ""])
    assert fire("AR215", {"KNA1": kna1}) == (1, 3)
    assert fire("AR216", {"KNA1": kna1}) == (1, 3)


def test_one_time_flag_matches_account_group():
    t077d = frame("T077D", KTOKD=["CPD", "KUNA"], XCPDS=["X", ""])
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3", "C4"], KTOKD=["CPD", "KUNA", "CPD", "KUNA"],
                 XCPDK=["X", "X", "", ""])
    assert fire("AR217", {"KNA1": kna1, "T077D": t077d}) == (1, 2)
    assert fire("AR218", {"KNA1": kna1, "T077D": t077d}) == (1, 2)


def test_one_time_account_without_bank_details():
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], XCPDK=["X", "X"])
    knbk = frame("KNBK", KUNNR=["C1"], BANKS=["DE"], BANKL=["10020030"], BANKN=["1"])
    assert fire("AR220", {"KNA1": kna1, "KNBK": knbk}) == (1, 2)


def test_central_deletion_without_central_block():
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LOEVM=["X", "X"], SPERR=["X", ""])
    assert fire("AR221", {"KNA1": kna1})[0] == 1


def test_central_deletion_not_mirrored_in_company_code():
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LOEVM=["X", ""])
    knb1 = frame("KNB1", KUNNR=["C1", "C1", "C2"], BUKRS=["1000", "2000", "1000"], LOEVM=["X", "", ""])
    assert fire("AR225", {"KNA1": kna1, "KNB1": knb1})[0] == 1


def test_address_number_and_country_against_adrc():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], ADRNR=["A1", "A2", "A9"], LAND1=["DE", "FR", "DE"])
    adrc = frame("ADRC", ADDRNUMBER=["A1", "A2"], COUNTRY=["DE", "DE"])
    assert fire("AR227", {"KNA1": kna1, "ADRC": adrc}) == (1, 3)
    assert fire("AR228", {"KNA1": kna1, "ADRC": adrc})[0] == 1


def test_indian_gstin_format():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], LAND1=["IN", "IN", "DE"],
                 STCD3=["27AAPFU0939F1ZV", "27AAPFU0939F1Z", "DE123"])
    assert fire("AR233", {"KNA1": kna1}) == (1, 2)


def test_tax_number_duplicates_per_country():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], LAND1=["DE", "DE", "FR"], STCD2=["12/345", "12345", "12345"],
                 LOEVM=["", "", ""])
    assert fire("AR234", {"KNA1": kna1})[0] == 2


def test_name_similarity_within_city_reports_only_keys():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], NAME1=["ACME ENGINEERING WORKS", "ACME ENGINERING WORKS", "ZULU"],
                 LAND1=["DE", "DE", "DE"], ORT01=["X", "X", "X"], LOEVM=["", "", ""])
    assert fire("AR236", {"KNA1": kna1})[0] == 2


# ---- KNB1 / KNB5 / KNKK / KNBK -----------------------------------------------------------------------------------

def test_reconciliation_account_must_exist_in_skb1():
    skb1 = frame("SKB1", BUKRS=["1000"], SAKNR=["140000"])
    knb1 = frame("KNB1", KUNNR=["C1", "C2"], BUKRS=["1000", "1000"], AKONT=["140000", "140001"])
    assert fire("AR237", {"KNB1": knb1, "SKB1": skb1}) == (1, 2)


def test_head_office_must_exist_and_not_be_a_branch():
    knb1 = frame("KNB1", KUNNR=["H1", "B1", "B2"], BUKRS=["1000"] * 3, KNRZE=["", "H1", "B1"])
    assert fire("AR247", {"KNB1": knb1}) == (1, 2)


def test_dunning_level_without_date():
    knb5 = frame("KNB5", KUNNR=["C1", "C2", "C3"], BUKRS=["1000"] * 3, MABER=["", "", ""], MAHNS=["2", "1", "0"],
                 MADAT=["", "20250101", ""])
    assert fire("AR249", {"KNB5": knb5})[0] == 1


def test_stale_credit_limit():
    knkk = frame("KNKK", KUNNR=["C1", "C2"], KKBER=["0001", "0001"], KLIMK=[1000, 1000], CASHD=["20150101", "20990101"])
    assert fire("AR253", {"KNKK": knkk})[0] == 1


def test_bank_control_key_for_spain():
    knbk = frame("KNBK", KUNNR=["C1", "C2", "C3"], BANKS=["ES", "ES", "DE"], BANKL=["1", "2", "3"],
                 BANKN=["1", "2", "3"], BKONT=["45", "", ""])
    assert fire("AR254", {"KNBK": knbk}) == (1, 2)


# ---- KNVV / KNVI / KNVP / KNVK --------------------------------------------------------------------------------------

def _knvv(**cols):
    base = dict(KUNNR=["C1", "C2"], VKORG=["1000", "1000"], VTWEG=["10", "10"], SPART=["00", "00"])
    return frame("KNVV", **{**base, **cols})


def test_central_deletion_not_mirrored_in_sales_area():
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LOEVM=["X", "X"])
    assert fire("SDCM208", {"KNA1": kna1, "KNVV": _knvv(LOEVM=["X", ""])})[0] == 1


def test_posting_block_with_open_sales_area():
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], SPERR=["X", "X"])
    assert fire("SDCM212", {"KNA1": kna1, "KNVV": _knvv(AUFSD=["01", ""], LOEVM=["", ""])})[0] == 1


def test_sales_area_without_tax_classification():
    knvi = frame("KNVI", KUNNR=["C1"], ALAND=["DE"], TATYP=["MWST"], TAXKD=["1"])
    assert fire("SDCM223", {"KNVV": _knvv(), "KNVI": knvi}) == (1, 2)


def test_payer_blocked_for_posting():
    kna1 = frame("KNA1", KUNNR=["P1", "P2"], SPERR=["X", ""])
    knvp = frame("KNVP", KUNNR=["C1", "C2"], VKORG=["1000"] * 2, VTWEG=["10"] * 2, SPART=["00"] * 2,
                 PARVW=["RG", "RG"], PARZA=["000", "000"], KUNN2=["P1", "P2"])
    assert fire("SDCM229", {"KNA1": kna1, "KNVP": knvp}) == (1, 2)


def test_customer_partner_function_without_customer():
    tpar = frame("TPAR", PARVW=["WE", "AP"], NRART=["KU", "AP"])
    knvp = frame("KNVP", KUNNR=["C1", "C1", "C1"], VKORG=["1000"] * 3, VTWEG=["10"] * 3, SPART=["00"] * 3,
                 PARVW=["WE", "AP", "WE"], PARZA=["000", "000", "001"], KUNN2=["", "", "C1"])
    assert fire("SDCM232", {"KNVP": knvp, "TPAR": tpar}) == (1, 2)


def test_sales_area_without_sold_to():
    knvp = frame("KNVP", KUNNR=["C1"], VKORG=["1000"], VTWEG=["10"], SPART=["00"], PARVW=["AG"], PARZA=["000"],
                 KUNN2=["C1"])
    assert fire("SDCM233", {"KNVV": _knvv(LOEVM=["", ""]), "KNVP": knvp}) == (1, 2)


def test_orphan_contact_person():
    kna1 = frame("KNA1", KUNNR=["C1"])
    knvk = frame("KNVK", PARNR=["1", "2"], KUNNR=["C1", "C9"])
    assert fire("SDCM234", {"KNA1": kna1, "KNVK": knvk}) == (1, 2)


# ---- business partner --------------------------------------------------------------------------------------------

def test_cvi_link_to_missing_partner_and_duplicate_link():
    but000 = frame("BUT000", PARTNER=["B1"], PARTNER_GUID=["G1"])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G1", "G2", "G3"], CUSTOMER=["C1", "C2", "C1"])
    assert fire("BP201", {"BUT000": but000, "CVI_CUST_LINK": link}) == (2, 3)
    assert fire("BP202", {"CVI_CUST_LINK": link}) == (2, 3)


def test_linked_customer_needs_flcu00_role():
    but000 = frame("BUT000", PARTNER=["B1", "B2"], PARTNER_GUID=["G1", "G2"])
    but100 = frame("BUT100", PARTNER=["B1", "B2"], RLTYP=["FLCU00", "000000"])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G1", "G2"], CUSTOMER=["C1", "C2"])
    assert fire("BP203", {"BUT000": but000, "BUT100": but100, "CVI_CUST_LINK": link}) == (1, 2)


def test_archived_partner_with_active_customer():
    but000 = frame("BUT000", PARTNER=["B1", "B2"], PARTNER_GUID=["G1", "G2"], XDELE=["X", "X"])
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LOEVM=["", "X"])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G1", "G2"], CUSTOMER=["C1", "C2"])
    assert fire("BP204", {"BUT000": but000, "KNA1": kna1, "CVI_CUST_LINK": link})[0] == 1


def test_person_with_organisation_data():
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], TYPE=["1", "1", "2"], LEGAL_ENTY=["01", "", "01"],
                    LEGAL_ORG=["", "", ""], FOUND_DAT=["", "", ""])
    assert fire("BP214", {"BUT000": but000})[0] == 1


def test_liquidated_organisation_not_blocked():
    but000 = frame("BUT000", PARTNER=["B1", "B2"], LIQUID_DAT=["20200101", "20200101"], XBLCK=["", "X"],
                   XDELE=["", ""])
    assert fire("BP216", {"BUT000": but000})[0] == 1


def test_contact_role_on_organisation():
    but000 = frame("BUT000", PARTNER=["B1", "B2"], TYPE=["1", "2"])
    but100 = frame("BUT100", PARTNER=["B1", "B2"], RLTYP=["BUP001", "BUP001"])
    assert fire("BP220", {"BUT000": but000, "BUT100": but100})[0] == 1


def test_iban_shared_between_partners():
    but0bk = frame("BUT0BK", PARTNER=["B1", "B2", "B3"], BKVID=["0001"] * 3,
                   IBAN=["DE89370400440532013000", "DE89 3704 0044 0532 0130 00", "FR1420041010050500013M02606"])
    assert fire("BP224", {"BUT0BK": but0bk}) == (2, 3)


def test_person_duplicates_on_name_and_birth_date():
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], TYPE=["1", "1", "1"], NAME_LAST=["Smith", "SMITH", "Smith"],
                   NAME_FIRST=["Ann", "Ann", "Ann"], BIRTHDT=["19800101", "19800101", "19810101"],
                   XDELE=["", "", ""])
    assert fire("BP225", {"BUT000": but000})[0] == 2
