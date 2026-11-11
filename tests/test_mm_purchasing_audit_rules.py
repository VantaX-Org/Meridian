"""Purchasing audit rules PUR420-PUR428: pack integrity and fire / no-fire fixtures."""
import json

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/mm_purchasing.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
IDS = [f"PUR{n}" for n in range(420, 429)]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    frames = TableFrames(tables, DDIC, module="mm_purchasing")
    _, res = run_rule(dict(RULES[rid]), frames, {})
    if res is None:  # nothing in scope
        return 0, 0
    assert not res.error, (rid, res.error)
    return res.affected_count, res.total_count


def _names(table):
    return {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_rules_exist_with_metadata_and_real_fields():
    for rid in IDS:
        r = RULES[rid]
        for k in MANDATORY:
            assert r.get(k), (rid, k)
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        for ref in refs:
            t, f = ref.split(".")
            assert f in _names(t), ref


def _po(**item):
    base = dict(EBELN=["4500000001"], EBELP=["00010"], LOEKZ=[""], ELIKZ=[""])
    base.update(item)
    return base


def _hdr(**kw):
    return frame("EKKO", EBELN=["4500000001"], BSTYP=["F"], **kw)


def test_pur420_receipt_above_tolerance():
    def run(wemng, uebto="10", uebtk=""):
        return fire("PUR420", {
            "EKET": frame("EKET", EBELN=["4500000001"], EBELP=["00010"], ETENR=["0001"], MENGE=["100"], WEMNG=[wemng]),
            "EKPO": frame("EKPO", **_po(UEBTO=[uebto], UEBTK=[uebtk], RETPO=[""]))})
    assert run("120")[0] == 1
    assert run("110")[0] == 0
    assert run("120", uebtk="X")[0] == 0


def test_pur421_422_date_order():
    def run(rid, **d):
        return fire(rid, {"EKET": frame("EKET", EBELN=["4500000001"], EBELP=["00010"], ETENR=["0001"], **d),
                          "EKPO": frame("EKPO", **_po())})[0]
    assert run("PUR421", WADAT=["20260110"], EINDT=["20260105"]) == 1
    assert run("PUR421", WADAT=["20260101"], EINDT=["20260105"]) == 0
    assert run("PUR422", TDDAT=["20260103"], LDDAT=["20260102"], WADAT=["20260104"]) == 1
    assert run("PUR422", TDDAT=["20260101"], LDDAT=["20260102"], WADAT=["20260104"]) == 0


def test_pur423_424_item_checks():
    def run(rid, **d):
        return fire(rid, {"EKPO": frame("EKPO", **_po(**d))})[0]
    assert run("PUR423", NAVNW=["5.00"], MWSKZ=[""]) == 1
    assert run("PUR423", NAVNW=["5.00"], MWSKZ=["V1"]) == 0
    assert run("PUR424", NTGEW=["12"], BRGEW=["10"]) == 1
    assert run("PUR424", NTGEW=["9"], BRGEW=["10"]) == 0


def test_pur425_requisition_with_order_but_not_edited():
    def run(statu):
        return fire("PUR425", {"EBAN": frame("EBAN", BANFN=["10000001"], BNFPO=["00010"], EBELN=["4500000001"],
                                             STATU=[statu], LOEKZ=[""])})[0]
    assert run("N") == 1
    assert run("B") == 0


def test_pur426_amortization_period():
    def run(v, b):
        return fire("PUR426", {"EINE": frame("EINE", INFNR=["5300000001"], EKORG=["1000"], LOEKZ=[""],
                                             AMODV=[v], AMODB=[b])})[0]
    assert run("20261231", "20260101") == 1
    assert run("20260101", "20261231") == 0


def test_pur427_source_list_required_without_record():
    marc = frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"], KORDB=["X", "X"], LVORM=["", ""])
    eord = frame("EORD", MATNR=["M2"], WERKS=["P1"])
    assert fire("PUR427", {"MARC": marc, "EORD": eord})[0] == 1


def test_pur428_value_without_pricing_document():
    def run(knumv):
        return fire("PUR428", {"EKKO": _hdr(KNUMV=[knumv]),
                               "EKPO": frame("EKPO", **_po(NETWR=["100.00"]))})[0]
    assert run("") == 1
    assert run("0000012345") == 0
