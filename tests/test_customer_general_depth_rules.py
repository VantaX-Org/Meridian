"""Customer general data, address, communication and tax depth rules (SDCM300+): integrity and pass/fail fixtures."""
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

START, COUNT = 300, 161
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")
PACK = yaml.safe_load(open("checks/rules/ecc/sd_customer_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if START <= int(r["id"][4:]) < START + COUNT]
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STREET|STCD|STCEG|BIRTH|GBDAT|PFACH|PSTL|TEL|FAX|SMTP|KNURL")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="sd_customer_master"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


# ---- integrity ---------------------------------------------------------------------------------------------------

def test_ids_unique_and_contiguous():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    assert sorted(int(r["id"][4:]) for r in NEW) == list(range(START, START + COUNT))


def test_full_metadata_and_fields_exist():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        refs = {r["field"], *r.get("fields", []), *(r.get("applies_when") or {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            assert DDIC.resolve(f) is not None, (r["id"], f)


def test_templates_never_echo_personal_or_tax_values():
    for r in NEW:
        for text in (r["record_fix_template"], r["message"]):
            for f in re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", text):
                assert not SENSITIVE.search(f.split(".")[1]), (r["id"], f)


# ---- behaviour ---------------------------------------------------------------------------------------------------

def test_postal_code_format_per_country():
    kna1 = frame("KNA1", KUNNR=["1", "2", "3"], LAND1=["DE", "DE", "US"], PSTLZ=["80331", "8033", "8033"])
    assert fire("SDCM300", {"KNA1": kna1}) == (1, 2)
    us = frame("KNA1", KUNNR=["1", "2", "3"], LAND1=["US"] * 3, PSTLZ=["10001", "10001-1234", "1000"])
    assert fire("SDCM321", {"KNA1": us}) == (1, 3)


def test_region_against_postal_code():
    ca = frame("KNA1", KUNNR=["1", "2", "3"], LAND1=["CA"] * 3, PSTLZ=["M5V 2T6", "V6B 1A1", "X0A 0H0"],
               REGIO=["ON", "AB", "NU"])
    assert fire("SDCM330", {"KNA1": ca}) == (1, 3)
    es = frame("KNA1", KUNNR=["1", "2"], LAND1=["ES"] * 2, PSTLZ=["28001", "08001"], REGIO=["28", "28"])
    assert fire("SDCM332", {"KNA1": es}) == (1, 2)
    us = frame("KNA1", KUNNR=["1", "2"], LAND1=["US"] * 2, PSTLZ=["94105", "02110"], REGIO=["CA", "CA"])
    assert fire("SDCM333", {"KNA1": us}) == (1, 2)


def test_vat_number_structure():
    kna1 = frame("KNA1", KUNNR=["1", "2", "3"], STCEG=["DE123456789", "DE12345678", "FR12345678901"])
    assert fire("SDCM334", {"KNA1": kna1}) == (1, 2)
    gr = frame("KNA1", KUNNR=["1", "2"], STCEG=["GR123456789", "EL123456789"])
    assert fire("SDCM353", {"KNA1": gr})[0] == 1
    it = frame("KNA1", KUNNR=["1", "2"], LAND1=["IT", "IT"], STCEG=["IT01234567890", "IT01234567890"],
               STCD2=["01234567890", "09876543210"])
    assert fire("SDCM355", {"KNA1": it}) == (1, 2)


def test_foreign_vat_prefix_matches_country():
    knas = frame("KNAS", KUNNR=["1", "1", "1"], LAND1=["FR", "GR", "AT"],
                 STCEG=["FR12345678901", "EL123456789", "DE123456789"])
    assert fire("SDCM360", {"KNAS": knas}) == (1, 3)


def test_natural_person_against_tax_number_and_name():
    mx = frame("KNA1", KUNNR=["1", "2"], LAND1=["MX", "MX"], STKZN=["X", "X"], STCD1=["GODE561231GR8", "ABC010101AB1"])
    assert fire("SDCM375", {"KNA1": mx}) == (1, 2)
    kna1 = frame("KNA1", KUNNR=["1", "2", "3"], STKZN=["X", "X", "X"],
                 NAME1=["Acme Trading (Pty) Ltd", "Abbott Asmussen", "Muster GmbH"])
    assert fire("SDCM381", {"KNA1": kna1})[0] == 2


def test_communication_entries():
    kna1 = frame("KNA1", KUNNR=["1", "2"], TELF1=["+27 16 973 4400", "see email"])
    assert fire("SDCM382", {"KNA1": kna1}) == (1, 2)
    adr2 = frame("ADR2", ADDRNUMBER=["A1", "A2"], CONSNUMBER=["001", "001"], TEL_NUMBER=["0169734400", ""],
                 TEL_EXTENS=["12", "34"])
    assert fire("SDCM390", {"ADR2": adr2}) == (1, 2)
    adr6 = frame("ADR6", ADDRNUMBER=["A1", "A2"], CONSNUMBER=["001", "001"],
                 SMTP_ADDR=["ap@example.com", "ap@example.com; ar@example.com"])
    assert fire("SDCM412", {"ADR6": adr6}) == (1, 2)


def test_one_default_number_per_address():
    adr2 = frame("ADR2", ADDRNUMBER=["A1", "A1", "A2"], PERSNUMBER=["", "", ""], DATE_FROM=["00010101"] * 3,
                 CONSNUMBER=["001", "002", "001"], TEL_NUMBER=["111", "222", "333"], FLGDEFAULT=["X", "X", "X"])
    assert fire("SDCM400", {"ADR2": adr2})[0] == 2


def test_customer_master_copy_against_central_address():
    kna1 = frame("KNA1", KUNNR=["1", "2"], ADRNR=["A1", "A2"], NAME1=["Acme", "Old Name"])
    adrc = frame("ADRC", ADDRNUMBER=["A1", "A2"], NAME1=["Acme", "New Name"])
    assert fire("SDCM413", {"KNA1": kna1, "ADRC": adrc}) == (1, 2)


def test_address_content():
    kna1 = frame("KNA1", KUNNR=["1", "2"], ADRNR=["A1", "A2"], LAND1=["DE", "DE"])
    adrc = frame("ADRC", ADDRNUMBER=["A1", "A2"], COUNTRY=["DE", "DE"], STREET=["Hauptstrasse 5", "Hauptstrasse"],
                 HOUSE_NUM1=["", "5"])
    assert fire("SDCM434", {"KNA1": kna1, "ADRC": adrc})[0] == 1
    names = frame("KNA1", KUNNR=["1", "2"], NAME1=["acme trading", "Acme Trading"])
    assert fire("SDCM439", {"KNA1": names}) == (1, 2)
    bran = frame("KNA1", KUNNR=["1", "2"], BRAN1=["MINE", "MINE"], BRAN2=["OIL", "OIL"], BRAN3=["MINE", "RAIL"])
    assert fire("SDCM446", {"KNA1": bran}) == (1, 2)


def test_contact_persons():
    knvk = frame("KNVK", PARNR=["1", "2", "3"], KUNNR=["C1", "C1", "C1"], UEPAR=["2", "2", ""])
    assert fire("SDCM454", {"KNVK": knvk})[0] == 1
