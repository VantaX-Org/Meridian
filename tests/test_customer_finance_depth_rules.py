"""Customer company code and finance depth rules (SDCM500+): KNB1, KNB4, KNB5, KNBK, TIBAN, KNBW, KNKK, KNKA and
FIN-FSCM-CR credit management. Integrity of the pack plus pass/fail fixtures for a representative sample."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

START, COUNT = 500, 190
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|KOINH|TEL|SMTP|INTAD|TLF|WTSTCD")
DDIC = get_dictionary("ecc6")
PACK = yaml.safe_load(open("checks/rules/ecc/sd_customer_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][4:].isdigit() and START <= int(r["id"][4:]) < START + COUNT]
AREAS = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="sd_customer_master"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def iban_rule(country, check_class="regex_check", part=None):
    for r in NEW:
        if r["field"] == "TIBAN.IBAN" and r["check_class"] == check_class and r["applies_when"]["TIBAN.BANKS"] == [
                country] and (part is None or f"`TIBAN.{part}`" in r["fail_when"]):
            return r["id"]
    raise KeyError(country)


def _fields(table):
    return {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


# ---- integrity ---------------------------------------------------------------------------------------------------

def test_ids_are_unique_and_contiguous():
    assert len(RULES) == len(PACK)
    assert sorted(int(r["id"][4:]) for r in NEW) == list(range(START, START + COUNT))


def test_every_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1
        if "s4_area" in r:
            assert r["s4_area"] in AREAS and r["s4_impact"] in ("blocking", "warning")


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= _fields(r["target_table"]), r["id"]


def test_templates_never_echo_personal_or_bank_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert not SENSITIVE.search(f), (r["id"], f)


def test_iban_patterns_match_iso_length():
    lengths = {"DE": 22, "FR": 27, "GB": 22, "IT": 27, "NL": 18, "NO": 15, "LC": 32, "MT": 31}
    for cc, n in lengths.items():
        pat = RULES[iban_rule(cc)]["pattern"]
        assert re.fullmatch(r"\^" + cc + r".*\$", pat)
    assert re.match(RULES[iban_rule("DE")]["pattern"], "DE89370400440532013000")
    assert not re.match(RULES[iban_rule("DE")]["pattern"], "DE8937040044053201300")
    assert re.match(RULES[iban_rule("GB")]["pattern"], "GB29NWBK60161331926819")
    assert re.match(RULES[iban_rule("FR")]["pattern"], "FR1420041010050500013M02606")
    assert re.match(RULES[iban_rule("NO")]["pattern"], "NO9386011117947")


# ---- behaviour ---------------------------------------------------------------------------------------------------

def test_payment_terms_must_be_valid_for_customers():
    t052 = frame("T052", ZTERM=["Z001", "Z002"], ZTAGG=["0", "0"], KOART=["", "K"])
    knb1 = frame("KNB1", KUNNR=["C1", "C2", "C3"], BUKRS=["1000"] * 3, ZTERM=["Z001", "Z002", "Z999"])
    assert fire("SDCM500", {"KNB1": knb1, "T052": t052}) == (2, 3)


def test_tolerance_group_checked_per_company_code():
    t043g = frame("T043G", BUKRS=["1000"], TOGRU=["A"])
    knb1 = frame("KNB1", KUNNR=["C1", "C2", "C3"], BUKRS=["1000", "2000", "2000"], TOGRU=["A", "A", ""])
    assert fire("SDCM520", {"KNB1": knb1, "T043G": t043g}) == (1, 2)


def test_unconfirmed_sensitive_change_flagged():
    knb1 = frame("KNB1", KUNNR=["C1", "C2"], BUKRS=["1000"] * 2, CONFS=["", "1"])
    assert fire("SDCM515", {"KNB1": knb1})[0] == 1


def test_dunning_level_without_procedure():
    knb5 = frame("KNB5", KUNNR=["C1", "C2", "C3"], BUKRS=["1000"] * 3, MABER=[""] * 3, MAHNS=["0", "2", "2"],
                 MAHNA=["", "", "Z001"])
    assert fire("SDCM534", {"KNB5": knb5})[0] == 1


def test_french_control_key_only_for_french_accounts():
    knbk = frame("KNBK", KUNNR=["C1", "C2", "C3"], BANKS=["FR", "FR", "DE"], BKONT=["06", "6X", "6X"])
    assert fire("SDCM537", {"KNBK": knbk}) == (1, 2)


def test_iban_structure_only_for_its_country():
    tiban = frame("TIBAN", BANKS=["DE", "DE", "AT"], TABNAME=["KNBK"] * 3,
                  IBAN=["DE89370400440532013000", "DE8937040044053201300", "AT611904300234573201"])
    assert fire(iban_rule("DE"), {"TIBAN": tiban}) == (1, 2)


def test_german_iban_must_embed_bank_code_and_account():
    tiban = frame("TIBAN", BANKS=["DE"] * 3, TABNAME=["KNBK"] * 3, BANKL=["37040044", "37040045", "37040044"],
                  BANKN=["532013000", "532013000", "532013001"], IBAN=["DE89370400440532013000"] * 3)
    assert fire(iban_rule("DE", "cross_field_check", "BANKL"), {"TIBAN": tiban})[0] == 1
    assert fire(iban_rule("DE", "cross_field_check", "BANKN"), {"TIBAN": tiban})[0] == 1


def test_withholding_exemption_rate_bounds():
    knbw = frame("KNBW", KUNNR=["C1", "C2", "C3"], BUKRS=["1000"] * 3, WITHT=["01"] * 3, WT_EXRT=["50", "150", "-1"])
    assert fire("SDCM642", {"KNBW": knbw})[0] == 2


def test_limit_on_dependent_credit_account():
    knkk = frame("KNKK", KUNNR=["C1", "C2", "C3"], KKBER=["1000"] * 3, KNKLI=["C1", "C9", "C9"],
                 KLIMK=["500", "500", "0"])
    assert fire("SDCM662", {"KNKK": knkk})[0] == 1


def test_expired_fscm_limit_only_when_limit_set():
    sgm = frame("UKMBP_CMS_SGM", PARTNER=["P1", "P2", "P3"], CREDIT_SGMNT=["0000"] * 3,
                CREDIT_LIMIT=["1000", "0", "1000"], LIMIT_VALID_DATE=["20200101", "20200101", "20991231"])
    assert fire("SDCM680", {"UKMBP_CMS_SGM": sgm}) == (1, 2)


def test_zero_limit_flag_contradicts_limit():
    sgm = frame("UKMBP_CMS_SGM", PARTNER=["P1", "P2"], CREDIT_SGMNT=["0000"] * 2, X_LIMIT_ZERO=["X", "X"],
                CREDIT_LIMIT=["1000", "0"])
    assert fire("SDCM683", {"UKMBP_CMS_SGM": sgm})[0] == 1


@pytest.mark.parametrize("rid", ["SDCM528", "SDCM529", "SDCM635"])
def test_company_code_children_need_knb1(rid):
    table = RULES[rid]["field"].split(".")[0]
    child = frame(table, KUNNR=["C1", "C2"], BUKRS=["1000", "1000"])
    knb1 = frame("KNB1", KUNNR=["C1"], BUKRS=["1000"])
    assert fire(rid, {table: child, "KNB1": knb1}) == (1, 2)
