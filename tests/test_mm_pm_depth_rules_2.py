"""Purchasing and plant maintenance depth rules, second pass (PUR369+, PM319+): integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"mm_purchasing": ("PUR", 369, 48), "plant_maintenance": ("PM", 319, 51)}
MANDATORY = ["id", "field", "check_class", "grain", "severity", "dimension", "message", "why_it_matters",
             "rule_authority", "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")
RULES, NEW, MODULE = {}, [], {}
for _mod, (_prefix, _start, _) in PACKS.items():
    for _r in yaml.safe_load(open(f"checks/rules/ecc/{_mod}.yaml"))["rules"]:
        RULES[_r["id"]] = _r
        MODULE[_r["id"]] = _mod
        _num = _r["id"][len(_prefix):]
        if _r["id"].startswith(_prefix) and _num.isdigit() and int(_num) >= _start:
            NEW.append(_r)
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|PFACH|PSTL|TEL|SMTP")


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
        assert r["rule_authority"] in {"sap_hard_constraint", "best_practice"}


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = _fields(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= set(target), r["id"]


def test_templates_and_messages_never_echo_personal_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert not SENSITIVE.search(f), (r["id"], f)


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"EKKO": frame("EKKO", EBELN=["4500000001"]), "AFIH": frame("AFIH", AUFNR=["4000001"])}
    for r in NEW:
        _, res = run_rule(dict(r), TableFrames(tables, DDIC, module=MODULE[r["id"]]), {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- purchasing ---------------------------------------------------------------------------------------------------

def _invoice(**rseg):
    rbkp = frame("RBKP", BELNR=["5100000001"], GJAHR=["2024"], RBSTAT=["5"], STBLG=[""], BUDAT=["20240101"],
                 BUKRS=["1000"])
    n = len(next(iter(rseg.values())))
    base = {"BELNR": ["5100000001"] * n, "GJAHR": ["2024"] * n, "BUZEI": [f"{i + 1:06d}" for i in range(n)]}
    return {"RBKP": rbkp, "RSEG": frame("RSEG", **base, **rseg)}


def test_old_price_block_is_flagged():
    assert fire("PUR369", _invoice(SPGRP=["X", ""])) == (1, 2)


def test_invoice_item_company_code_matches_header():
    assert fire("PUR376", _invoice(BUKRS=["1000", "2000"]))[0] == 1


def test_payment_term_stages_are_ordered():
    ekko = frame("EKKO", EBELN=["1", "2", "3"], LOEKZ=["", "", ""], ZBD1T=["10", "30", "10"],
                 ZBD2T=["30", "10", "0"])
    assert fire("PUR392", {"EKKO": ekko})[0] == 1


def test_fixed_rate_must_be_positive():
    ekko = frame("EKKO", EBELN=["1", "2", "3"], LOEKZ=["", "", ""], KUFIX=["X", "X", ""], WKURS=["1.1", "0", "0"])
    assert fire("PUR395", {"EKKO": ekko})[0] == 1


def test_requisition_overordered():
    eban = frame("EBAN", BANFN=["1", "2"], BNFPO=["10", "10"], LOEKZ=["", ""], MENGE=["5", "5"], BSMNG=["6", "5"])
    assert fire("PUR404", {"EBAN": eban}) == (1, 2)


def test_goods_receipt_against_missing_po_item():
    ekbe = frame("EKBE", EBELN=["45", "46", "47"], EBELP=["10", "10", "10"], VGABE=["1", "1", "2"],
                 GJAHR=["2024", "2024", "2024"], BELNR=["50", "51", "52"], BUZEI=["1", "1", "1"])
    ekpo = frame("EKPO", EBELN=["45"], EBELP=["10"])
    assert fire("PUR383", {"EKBE": ekbe, "EKPO": ekpo}) == (1, 2)


# ---- plant maintenance --------------------------------------------------------------------------------------------

def test_open_order_needs_planning_plant():
    afih = frame("AFIH", AUFNR=["1", "2", "3"], IPHAS=["0", "2", "6"], IWERK=["1000", "", ""])
    assert fire("PM319", {"AFIH": afih}) == (1, 2)


def test_plan_order_needs_call_number():
    afih = frame("AFIH", AUFNR=["1", "2", "3"], WARPL=["P1", "P1", ""], ABNUM=["3", "0", "0"])
    assert fire("PM327", {"AFIH": afih})[0] == 1


def test_breakdown_needs_start_and_positive_duration():
    qmih = frame("QMIH", QMNUM=["1", "2", "3"], MSAUS=["X", "X", ""], AUSVN=["20240101", "", ""],
                 AUSZT=["3600", "-5", "0"])
    assert fire("PM341", {"QMIH": qmih}) == (1, 2)
    assert fire("PM342", {"QMIH": qmih})[0] == 1


def test_counter_going_backwards_without_replacement():
    imrg = frame("IMRG", MDOCM=["1", "2", "3"], POINT=["P", "P", "P"], CANCL=["", "", ""], LVORM=["", "", ""],
                 EXCHG=["", "X", ""], CDIFF=["-5", "-5", "10"])
    assert fire("PM356", {"IMRG": imrg}) == (1, 2)


def test_vendor_special_stock_needs_vendor():
    eqbs = frame("EQBS", EQUNR=["1", "2", "3"], SOBKZ=["K", "K", ""], LIFNR=["V1", "", ""])
    assert fire("PM368", {"EQBS": eqbs}) == (1, 2)
