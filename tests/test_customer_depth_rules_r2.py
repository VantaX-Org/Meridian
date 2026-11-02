"""Customer master round-2 depth rules (SDCM800+): company code account control, central control and marketing
data, bank details, sales-area blocks and address consistency. Integrity of the pack plus pass/fail fixtures."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

START, COUNT = 800, 36
DDIC = get_dictionary("ecc6")
ALL = yaml.safe_load(open("checks/rules/ecc/sd_customer_master.yaml"))["rules"]
RULES = {r["id"]: r for r in ALL}
NEW = [r for r in ALL if START <= int(r["id"][4:]) < START + COUNT]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|KOINH|TEL|SMTP")
AREAS = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, ref=None):
    """Run a rule; ``ref`` is the live value list of the field's DDIC check table."""
    rule = dict(RULES[rid])
    live = {DDIC.resolve(rule["field"]).check_ref: set(ref)} if ref is not None else None
    _, res = run_rule(rule, TableFrames(tables, DDIC, module="sd_customer_master"), live)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_ids_contiguous_and_unique():
    ids = [r["id"] for r in ALL]
    assert len(ids) == len(set(ids))
    assert [r["id"] for r in NEW] == [f"SDCM{n}" for n in range(START, START + COUNT)]


def test_metadata_fields_and_templates():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        refs = [r["field"], *r.get("fields", []), *r.get("applies_when", {})]
        refs += re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", ""))
        for ref in refs:
            table, fld = ref.split(".")
            assert fld in _fields(table), (r["id"], ref)
        if "target_table" in r:
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= _fields(r["target_table"]), r["id"]
        if r["check_class"] == "referential_check":
            assert DDIC.resolve(r["field"]).check_ref, r["id"]
        assert not SENSITIVE.search(" ".join(re.findall(r"\{([A-Z0-9_.]+)\}", r["record_fix_template"]))), r["id"]
        if "s4_area" in r:
            assert r["s4_area"] in AREAS and r["s4_impact"] in ("blocking", "warning"), r["id"]


def test_messages_distinct():
    assert len({r["message"] for r in NEW}) == COUNT


KNB1_KEYS = dict(KUNNR=["1", "2", "3"], BUKRS=["1000"] * 3)


def test_reconciliation_account_required():
    assert fire("SDCM800", {"KNB1": frame("KNB1", **KNB1_KEYS, AKONT=["140000", None, "140000"])}) == (1, 3)


def test_reconciliation_account_must_be_customer_type_and_open():
    knb1 = frame("KNB1", **KNB1_KEYS, AKONT=["140000", "160000", "999999"])
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["140000", "160000"], MITKZ=["D", "K"], XSPEB=[None, "X"])
    assert fire("SDCM801", {"KNB1": knb1, "SKB1": skb1}) == (2, 3)
    assert fire("SDCM802", {"KNB1": knb1, "SKB1": skb1}) == (2, 3)


@pytest.mark.parametrize("rid, field, values, ref, expected", [
    ("SDCM803", "ZWELS", ["DE", "DZ", None], ["D", "E"], (1, 2)),
    ("SDCM804", "ZAHLS", ["A", "Q", None], ["A"], (1, 2)),
    ("SDCM808", "ZUAWA", ["001", "777", None], ["001"], (1, 2)),
    ("SDCM809", "FDGRV", ["E1", "ZZ", None], ["E1"], (1, 2)),
    ("SDCM810", "XAUSZ", ["1", "9", None], ["1"], (1, 2)),
    ("SDCM811", "UZAWE", ["01", "99", None], ["01"], (1, 2)),
])
def test_knb1_value_lists(rid, field, values, ref, expected):
    assert fire(rid, {"KNB1": frame("KNB1", **KNB1_KEYS, **{field: values})}, ref) == expected


def test_knb1_posting_block_and_deletion_flags():
    knb1 = frame("KNB1", **KNB1_KEYS, SPERR=["X", "Y", None], LOEVM=["X", "X", "X"], NODEL=[None, "X", None])
    assert fire("SDCM805", {"KNB1": frame("KNB1", **KNB1_KEYS, SPERR=["X", "Y", None])}) == (1, 2)
    assert fire("SDCM806", {"KNB1": knb1}) == (1, 3)
    assert fire("SDCM807", {"KNB1": knb1}) == (1, 3)


def test_clearing_with_vendor_needs_vendor():
    knb1 = frame("KNB1", KUNNR=["1", "2"], BUKRS=["1000"] * 2, XVERR=["X", "X"])
    kna1 = frame("KNA1", KUNNR=["1", "2"], LIFNR=["V1", None])
    assert fire("SDCM812", {"KNB1": knb1, "KNA1": kna1}) == (1, 2)


@pytest.mark.parametrize("rid, field, ref", [
    ("SDCM813", "BRSCH", ["0001"]), ("SDCM814", "VBUND", ["0001"]), ("SDCM815", "KUKLA", ["0001"]),
])
def test_kna1_value_lists(rid, field, ref):
    kna1 = frame("KNA1", KUNNR=["1", "2", "3"], **{field: ["0001", "ZZZZ", None]})
    assert fire(rid, {"KNA1": kna1}, ref) == (1, 2)


def test_kna1_deletion_flags():
    kna1 = frame("KNA1", KUNNR=["1", "2", "3"], LOEVM=["X", "X", "X"], NODEL=["X", None, None],
                 AUFSD=[None, "01", None], CASSD=[None, None, None])
    assert fire("SDCM816", {"KNA1": kna1}) == (1, 3)
    assert fire("SDCM817", {"KNA1": kna1}) == (2, 3)


@pytest.mark.parametrize("rid, field", [("SDCM818", "KNRZA"), ("SDCM819", "FISKN")])
def test_kna1_references_active_customer(rid, field):
    # customer 2 is flagged for deletion: out of scope itself, and an invalid target
    kna1 = frame("KNA1", KUNNR=["1", "2", "3", "4"], LOEVM=[None, "X", None, None],
                 **{field: ["2", "3", "9", "3"]})
    assert fire(rid, {"KNA1": kna1}) == (2, 3)


def test_marketing_figures_need_a_year():
    kna1 = frame("KNA1", KUNNR=["1", "2", "3"], UMSA1=["1000", "500", "0"], UMJAH=["2025", None, None],
                 JMZAH=["10", "20", None], JMJAH=["0000", "2024", None])
    assert fire("SDCM820", {"KNA1": kna1}) == (1, 2)
    assert fire("SDCM821", {"KNA1": kna1}) == (1, 2)


def test_dunning_block_value_list():
    knb5 = frame("KNB5", KUNNR=["1", "2"], BUKRS=["1000"] * 2, MABER=[None] * 2, MANSP=["A", "Q"])
    assert fire("SDCM822", {"KNB5": knb5}, ["A"]) == (1, 2)


def test_bank_details():
    knbk = frame("KNBK", KUNNR=["1", "1", "2"], BANKS=["DE", "DE", "DE"], BANKL=["10000000", "20000000", "30000000"],
                 KOVON=["20250101", "20260101", None], KOBIS=["20251231", "20250101", None],
                 EBPP_BVSTATUS=["A", "Z", None], BVTYP=["0001", "0001", "0001"])
    bnka = frame("BNKA", BANKS=["DE", "DE"], BANKL=["10000000", "20000000"], LOEVM=[None, "X"])
    assert fire("SDCM823", {"KNBK": knbk, "BNKA": bnka}) == (2, 3)
    assert fire("SDCM824", {"KNBK": knbk}) == (1, 2)
    assert fire("SDCM825", {"KNBK": knbk}) == (1, 2)
    assert fire("SDCM826", {"KNBK": knbk})[0] == 2


def test_sales_area_deletion_without_block():
    knvv = frame("KNVV", KUNNR=["1", "2"], VKORG=["1000"] * 2, VTWEG=["10"] * 2, SPART=["00"] * 2,
                 LOEVM=["X", "X"], AUFSD=[None, None], CASSD=["01", None])
    assert fire("SDCM827", {"KNVV": knvv}) == (1, 2)


def test_address_rules():
    adrc = frame("ADRC", ADDRNUMBER=["1", "2", "3"], COUNTRY=["DE", "US", "DE"], CITY1=["Berlin", None, "Bonn"],
                 REGION=["09", "09", None], PO_BOX_CTY=["DE", "QQ", None], ID_CATEGORY=["I", "Z", None],
                 PO_BOX_NUM=["X", "X", None], PO_BOX=["123", None, "9"],
                 FLAGCOMM2=["X", "X", None], FLAGCOMM3=["X", None, None], FLAGCOMM6=["X", "X", "X"])
    t005s = frame("T005S", LAND1=["DE"], BLAND=["09"])
    assert fire("SDCM828", {"ADRC": adrc}) == (1, 3)
    assert fire("SDCM829", {"ADRC": adrc, "T005S": t005s}) == (1, 2)
    assert fire("SDCM830", {"ADRC": adrc}, ["DE", "US"]) == (1, 2)
    assert fire("SDCM831", {"ADRC": adrc}) == (1, 2)
    assert fire("SDCM832", {"ADRC": adrc}) == (1, 3)
    has = {"ADR2": frame("ADR2", ADDRNUMBER=["1"]), "ADR3": frame("ADR3", ADDRNUMBER=["1"]),
           "ADR6": frame("ADR6", ADDRNUMBER=["1", "3"])}
    assert fire("SDCM833", {"ADRC": adrc, **has}) == (1, 2)
    assert fire("SDCM834", {"ADRC": adrc, **has}) == (0, 1)
    assert fire("SDCM835", {"ADRC": adrc, **has}) == (1, 3)
