"""S/4HANA conversion rules for sales, customer master, receivables and payables: integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"sd_sales_orders": ("SDSO", 312, 29), "sd_customer_master": ("SDCM", 243, 7),
         "accounts_receivable": ("AR", 255, 12), "accounts_payable": ("AP", 277, 8)}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template", "s4_area", "s4_impact", "simplification_item"]
DDIC = get_dictionary("ecc6")
RULES, NEW, MODULE = {}, [], {}
for _mod, (_prefix, _start, _) in PACKS.items():
    for _r in yaml.safe_load(open(f"checks/rules/ecc/{_mod}.yaml"))["rules"]:
        RULES[_r["id"]] = _r
        MODULE[_r["id"]] = _mod
        _num = _r["id"][len(_prefix):]
        if _r["id"].startswith(_prefix) and _num.isdigit() and int(_num) >= _start:
            NEW.append(_r)
AREAS = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|KOINH|TEL|SMTP")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module=MODULE[rid])
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


@pytest.mark.parametrize("mod", PACKS)
def test_new_ids_are_unique_and_contiguous(mod):
    prefix, start, count = PACKS[mod]
    ids = [r["id"] for r in yaml.safe_load(open(f"checks/rules/ecc/{mod}.yaml"))["rules"]]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][len(prefix):]) for r in NEW if MODULE[r["id"]] == mod)
    assert new == list(range(start, start + count))


def test_every_new_rule_has_full_metadata_and_a_known_area():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1
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


def test_templates_never_echo_personal_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert not SENSITIVE.search(f), (r["id"], f)


# ---- conditional branches: skipped when the condition is false, flagged when true ----------------------------------

def test_open_settlement_only_for_rebate_agreements():
    kona = frame("KONA", KNUMA=["1", "2", "3"], KAPPL=["V", "V", "M"], BOSTA=["C", "D", "C"])
    assert fire("SDSO314", {"KONA": kona}) == (1, 2)


def test_expired_rebate_not_settled():
    kona = frame("KONA", KNUMA=["1", "2", "3"], KAPPL=["V", "V", "V"], BOSTA=["", "D", ""],
                 DATBI=["20200101", "20200101", "20991231"])
    assert fire("SDSO312", {"KONA": kona}) == (1, 3)


def test_unprocessed_output_age_only_for_status_zero():
    nast = frame("NAST", KAPPL=["V1"] * 3, OBJKY=["1", "2", "3"], KSCHL=["RD00"] * 3, VSTAT=["0", "1", "0"],
                 ERDAT=["20200101", "20200101", "20991231"])
    assert fire("SDSO328", {"NAST": nast})[0] == 1


def test_print_output_needs_device_only_for_print():
    nast = frame("NAST", KAPPL=["V1"] * 3, OBJKY=["1", "2", "3"], KSCHL=["RD00"] * 3, NACHA=["1", "1", "5"],
                 LDEST=["", "LP01", ""])
    assert fire("SDSO333", {"NAST": nast}) == (1, 2)


def test_telex_output_master_flagged():
    knvd = frame("KNVD", KUNNR=["C1", "C2"], VKORG=["1000"] * 2, VTWEG=["10"] * 2, SPART=["00"] * 2, DOCTP=["1"] * 2,
                 NACHA=["4", "1"])
    assert fire("SDCM247", {"KNVD": knvd}) == (1, 2)


def test_copies_without_medium_only_when_copies_requested():
    knvd = frame("KNVD", KUNNR=["C1", "C2", "C3"], VKORG=["1000"] * 3, VTWEG=["10"] * 3, SPART=["00"] * 3,
                 DOCTP=["1"] * 3, DOANZ=["2", "0", "2"], NACHA=["", "", "1"])
    assert fire("SDCM249", {"KNVD": knvd}) == (1, 2)


def test_overall_limit_needs_currency_only_when_limit_set():
    knka = frame("KNKA", KUNNR=["C1", "C2", "C3"], KLIMG=["1000", "0", "500"], WAERS=["", "", "EUR"])
    assert fire("AR256", {"KNKA": knka}) == (1, 2)


def test_deleted_customer_archive_candidate_only_when_flagged():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], LOEVM=["X", "X", ""])
    bsid = frame("BSID", KUNNR=["C2"], BUKRS=["1000"], BELNR=["1"])
    assert fire("AR265", {"KNA1": kna1, "BSID": bsid}) == (1, 2)


def test_linked_tax_number_mismatch_only_when_both_sides_set():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], KUNNR=["C1", "C2", ""], STCD1=["A1", "A2", "A3"])
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], STCD1=["B1", "A2"])
    assert fire("AP277", {"LFA1": lfa1, "KNA1": kna1}) == (1, 2)
