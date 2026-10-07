"""Business partner and project system depth rules, second pass (BP249+, PS116+): integrity and conditional proofs."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"business_partner": ("BP", 249, 47), "project_system": ("PS", 116, 50)}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
AUTHORITIES = {"sap_hard_constraint", "best_practice", "s4hana_migration", "regulatory", "iso_standard"}
DDIC = get_dictionary("ecc6")
RULES, NEW, MODULE = {}, [], {}
for _mod, (_prefix, _start, _) in PACKS.items():
    for _r in yaml.safe_load(open(f"checks/rules/ecc/{_mod}.yaml"))["rules"]:
        RULES[_r["id"]] = _r
        MODULE[_r["id"]] = _mod
        _num = _r["id"][len(_prefix):]
        if _r["id"].startswith(_prefix) and _num.isdigit() and int(_num) >= _start:
            NEW.append(_r)
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
    ids = [r["id"] for r in yaml.safe_load(open(f"checks/rules/ecc/{mod}.yaml"))["rules"]]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][len(prefix):]) for r in NEW if MODULE[r["id"]] == mod)
    assert new == list(range(start, start + count))


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["rule_authority"] in AUTHORITIES, r["id"]


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
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= set(_fields(r["target_table"])), r["id"]
        if r["check_class"] == "referential_check":
            table, name = r["field"].split(".")
            assert _fields(table)[name].get("check_table"), r["id"]


def test_templates_and_messages_never_echo_personal_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert not SENSITIVE.search(f), (r["id"], f)


def test_s4_tagged_rules_exist():
    areas = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]
    for mod in PACKS:
        tagged = [i for ids in areas[mod]["related"].values() for i in ids if i in {r["id"] for r in NEW}]
        assert len(tagged) >= 6, mod
        assert all(i in RULES for i in tagged)


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"BUT000": frame("BUT000", PARTNER=["B1"]), "PROJ": frame("PROJ", PSPNR=["1"])}
    for r in NEW:
        _, res = run_rule(dict(r), TableFrames(tables, DDIC, module=MODULE[r["id"]]), {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- business partner proofs -------------------------------------------------------------------------------------

def test_bank_country_required_only_when_account_or_iban_present():
    bk = frame("BUT0BK", PARTNER=["B1"] * 3, BKVID=["1", "2", "3"], BANKS=["", "DE", ""],
               BANKN=["123", "456", ""], IBAN=["", "", ""])
    assert fire("BP255", {"BUT0BK": bk})[0] == 1


def test_orphan_bank_detail_without_partner():
    bk = frame("BUT0BK", PARTNER=["B1", "B9"], BKVID=["1", "1"])
    assert fire("BP256", {"BUT0BK": bk, "BUT000": frame("BUT000", PARTNER=["B1"])})[0] == 1


def test_self_relationship_flagged():
    rel = frame("BUT050", RELNR=["R1", "R2"], PARTNER1=["B1", "B1"], PARTNER2=["B1", "B2"], RELTYP=["BUR001"] * 2)
    assert fire("BP286", {"BUT050": rel}) == (1, 2)


def test_address_usage_validity_reversed():
    fs = frame("BUT021_FS", PARTNER=["B1", "B2", "B3"], ADDRNUMBER=["1", "2", "3"],
               VALID_FROM=["20200101000000", "20250101000000", ""], VALID_TO=["20991231235959", "20200101000000", "1"])
    assert fire("BP263", {"BUT021_FS": fs}) == (1, 2)


def test_central_block_must_reach_the_customer():
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], PARTNER_GUID=["G1", "G2", "G3"],
                   XBLCK=["X", "X", ""], XDELE=["", "", ""])
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], SPERR=["", "X", ""])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G1", "G2", "G3"], CUSTOMER=["C1", "C2", "C3"])
    assert fire("BP280", {"BUT000": but000, "KNA1": kna1, "CVI_CUST_LINK": link})[0] == 1


# ---- project system proofs ---------------------------------------------------------------------------------------

def test_open_project_past_finish_needs_closed_status():
    proj = frame("PROJ", PSPNR=["1", "2", "3", "4"], OBJNR=["PD1", "PD2", "PD3", "PD4"], LOEVM=["", "", "", "X"],
                 PLSEZ=["20150101", "20150101", "20990101", "20150101"])
    jest = frame("JEST", OBJNR=["PD2"], STAT=["I0046"], INACT=[""])
    # PD1 flagged; PD2 closed; PD3 not yet due; PD4 deletion flag
    assert fire("PS121", {"PROJ": proj, "JEST": jest}) == (1, 2)


def test_settlement_receiver_must_match_category():
    cobrb = frame("COBRB", OBJNR=["O1", "O2", "O3", "O4"], LFDNR=["1"] * 4, KONTY=["KS", "KS", "PR", "OR"],
                  KOSTL=["", "CC1", "", ""], PS_PSP_PNR=["", "", "", ""], AUFNR=["", "", "", "100"])
    assert fire("PS158", {"COBRB": cobrb}) == (1, 1)
    assert fire("PS160", {"COBRB": cobrb}) == (1, 1)


def test_settlement_rule_without_share():
    cobrb = frame("COBRB", OBJNR=["O1", "O2", "O3"], LFDNR=["1"] * 3, KONTY=["KS"] * 3,
                  PROZS=["0", "100", ""], AQZIF=["", "", "5"], BETRR=["", "", ""])
    assert fire("PS164", {"COBRB": cobrb}) == (1, 3)


def test_statistical_order_with_settlement_rule():
    aufk = frame("AUFK", AUFNR=["1", "2", "3"], OBJNR=["OR1", "OR2", "OR3"], ASTKZ=["X", "X", ""])
    cobrb = frame("COBRB", OBJNR=["OR1", "OR3"], LFDNR=["1", "1"])
    assert fire("PS140", {"AUFK": aufk, "COBRB": cobrb}) == (1, 2)


def test_external_activity_needs_price_only_with_vendor():
    afvc = frame("AFVC", AUFPL=["1", "2", "3", "4"], APLZL=["1"] * 4, VORNR=["0010"] * 4,
                 LIFNR=["V1", "V1", "", "V1"], PREIS=["0", "50", "0", ""], LOEKZ=["", "", "", "X"])
    assert fire("PS151", {"AFVC": afvc}) == (1, 2)
