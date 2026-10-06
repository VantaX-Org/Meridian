"""SD sales depth rules (SDSO202 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/sd_sales_orders.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if re.fullmatch(r"SDSO\d+", r["id"]) and int(r["id"][4:]) >= 202]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
PERSONAL = {"NAME1", "NAME2", "STRAS", "ORT01", "PSTLZ", "BANKN", "BANKL", "IBAN", "STCD1", "STCD2", "STCEG",
            "SMTP_ADDR", "TELF1", "ADRNR"}
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="sd_sales_orders")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_pack_loads_with_unique_contiguous_ids():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][4:]) for r in NEW)
    assert new == list(range(202, 202 + len(new)))
    assert len(new) >= 100


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= set(_fields(r["target_table"])), r["id"]


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
    tables = {"VBAK": frame("VBAK", VBELN=["1"]), "VBAP": frame("VBAP", VBELN=["1"], POSNR=["000010"])}
    frames = TableFrames(tables, DDIC, module="sd_sales_orders")
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


def test_item_confirmed_quantity_above_ordered():
    vbap = frame("VBAP", VBELN=["1", "2"], POSNR=["000010"] * 2, KWMENG=["5", "5"], KBMENG=["9", "5"])
    assert fire("SDSO225", {"VBAP": vbap}) == (1, 2)


def test_rejected_item_keeps_confirmed_quantity():
    vbap = frame("VBAP", VBELN=["1", "2", "3"], POSNR=["000010"] * 3, ABGRU=["Z1", "Z1", ""], KBMENG=["4", "0", "4"])
    assert fire("SDSO226", {"VBAP": vbap}) == (1, 2)


def test_schedule_line_confirmed_above_ordered():
    vbep = frame("VBEP", VBELN=["1", "2"], POSNR=["000010"] * 2, ETENR=["0001"] * 2, WMENG=["5", "5"], BMENG=["6", "5"])
    assert fire("SDSO240", {"VBEP": vbep}) == (1, 2)


def test_zero_exchange_rate_on_order_business_data():
    vbkd = frame("VBKD", VBELN=["1", "2"], POSNR=["000000"] * 2, KURSK=["0", "1.1"], KURRF=["1", "1"])
    assert fire("SDSO252", {"VBKD": vbkd}) == (1, 2)


def test_condition_header_without_variable_key():
    konh = frame("KONH", KNUMH=["1", "2"], VAKEY=["", "0001"])
    assert fire("SDSO290", {"KONH": konh})[0] == 1


def test_credit_area_without_currency():
    t014 = frame("T014", KKBER=["1000", "2000"], WAERS=["EUR", ""])
    assert fire("SDSO310", {"T014": t014}) == (1, 2)


def test_credit_status_blocked_but_delivered():
    vbuk = frame("VBUK", VBELN=["1", "2"], CMGST=["B", "B"], LFSTK=["C", "A"], GBSTK=["B", "B"])
    vbak = frame("VBAK", VBELN=["1", "2"], KKBER=["1000", "1000"])
    assert fire("SDSO208", {"VBAK": vbak, "VBUK": vbuk}) == (1, 2)


def test_quantity_scale_conversion_must_be_positive():
    konp = frame("KONP", KNUMH=["1", "2"], KOPOS=["01", "01"], KRECH=["C", "C"], KMEIN=["PC", "PC"],
                 KUMZA=["0", "1"], KUMNE=["1", "1"], LOEVM_KO=["", ""])
    assert fire("SDSO283", {"KONP": konp}) == (1, 2)
