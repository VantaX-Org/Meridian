"""Customer master sales-area, partner, unloading point, output, tax and cross-object rules (SDCM700-899)."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

DDIC = get_dictionary("ecc6")
ALL = yaml.safe_load(open("checks/rules/ecc/sd_customer_master.yaml"))["rules"]
RULES = {r["id"]: r for r in ALL}
NEW = [r for r in ALL if 700 <= int(r["id"][4:]) <= 799]
COUNT = 67
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|KOINH|TEL|SMTP")
AREAS = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="sd_customer_master"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_ids_contiguous_and_unique():
    ids = [r["id"] for r in ALL]
    assert len(ids) == len(set(ids))
    assert [r["id"] for r in NEW] == [f"SDCM{n}" for n in range(700, 700 + COUNT)]


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
            tf = _fields(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= tf, r["id"]
        assert not SENSITIVE.search(" ".join(re.findall(r"\{([A-Z0-9_.]+)\}", r["record_fix_template"]))), r["id"]
        if "s4_area" in r:
            assert r["s4_area"] in AREAS and r["s4_impact"] in ("blocking", "warning"), r["id"]


def _id(message):
    return next(r["id"] for r in NEW if r["message"] == message)


def test_sales_area_must_exist_in_tvta():
    knvv = frame("KNVV", KUNNR=["1", "2"], VKORG=["1000", "1000"], VTWEG=["10", "20"], SPART=["00", "00"])
    tvta = frame("TVTA", VKORG=["1000"], VTWEG=["10"], SPART=["00"], VTWKU=["10"], SPAKU=["00"])
    assert fire("SDCM700", {"KNVV": knvv, "TVTA": tvta}) == (1, 2)


def test_non_reference_sales_area_is_flagged():
    knvv = frame("KNVV", KUNNR=["1", "2"], VKORG=["1000", "1000"], VTWEG=["10", "20"], SPART=["00", "00"])
    tvta = frame("TVTA", VKORG=["1000", "1000"], VTWEG=["10", "20"], SPART=["00", "00"], VTWKU=["10", "10"],
                 SPAKU=["00", "00"])
    assert fire("SDCM701", {"KNVV": knvv, "TVTA": tvta}) == (1, 2)


def test_partner_row_without_any_partner():
    rid = _id("Partner function row has no partner")
    knvp = frame("KNVP", KUNNR=["1", "1", "1"], VKORG=["1000"] * 3, VTWEG=["10"] * 3, SPART=["00"] * 3,
                 PARVW=["WE", "ZM", "AP"], PARZA=["000"] * 3, KUNN2=["2", None, None], LIFNR=[None] * 3,
                 PERNR=[None, "00000000", None], PARNR=[None, "0000000000", "0000000123"])
    assert fire(rid, {"KNVP": knvp}) == (1, 3)


def test_partner_row_with_two_partners():
    rid = _id("Partner function row names more than one partner")
    knvp = frame("KNVP", KUNNR=["1", "1"], VKORG=["1000"] * 2, VTWEG=["10"] * 2, SPART=["00"] * 2,
                 PARVW=["WE", "SP"], PARZA=["000"] * 2, KUNN2=["2", "3"], LIFNR=[None, "V1"],
                 PERNR=[None, None], PARNR=["0000000000", None])
    assert fire(rid, {"KNVP": knvp}) == (1, 2)


def test_two_default_partners_for_one_function():
    rid = _id("More than one default partner is flagged for the same partner function")
    knvp = frame("KNVP", KUNNR=["1", "1", "1"], VKORG=["1000"] * 3, VTWEG=["10"] * 3, SPART=["00"] * 3,
                 PARVW=["WE"] * 3, PARZA=["000", "001", "002"], KUNN2=["2", "3", "4"], DEFPA=["X", "X", ""])
    affected, _ = fire(rid, {"KNVP": knvp})
    assert affected == 2


def test_contact_person_on_non_ap_function_ignores_zero_parnr():
    rid = _id("A contact person is assigned to a partner function whose partner type is not AP")
    knvp = frame("KNVP", KUNNR=["1", "1", "1"], VKORG=["1000"] * 3, VTWEG=["10"] * 3, SPART=["00"] * 3,
                 PARVW=["AP", "WE", "WE"], PARZA=["000"] * 3, KUNN2=[None, "2", "2"],
                 PARNR=["0000000123", "0000000456", "0000000000"])
    tpar = frame("TPAR", PARVW=["AP", "WE"], NRART=["AP", "KU"])
    assert fire(rid, {"KNVP": knvp, "TPAR": tpar}) == (1, 2)


def test_receiving_window_ending_before_start():
    rid = _id("Unloading point has a goods receiving window that ends before it starts")
    cols = {f"{d}{k}": [None] * 3 for d in ("MO", "DI", "MI", "DO", "FR", "SA", "SO")
            for k in ("AB1", "BI1", "AB2", "BI2")}
    cols.update(MOAB1=["080000", "080000", None], MOBI1=["170000", "070000", None], FRAB2=[None, None, "130000"],
                FRBI2=[None, None, "120000"])
    knva = frame("KNVA", KUNNR=["1", "2", "3"], ABLAD=["G1", "G1", "G1"], **cols)
    assert fire(rid, {"KNVA": knva}) == (2, 3)


def test_incoterms_dat_replaced_by_dpu():
    rid = _id("Customer uses Incoterm DAT, which Incoterms 2020 replaced with DPU")
    knvv = frame("KNVV", KUNNR=["1", "2"], VKORG=["1000"] * 2, VTWEG=["10"] * 2, SPART=["00"] * 2,
                 INCO1=["DAT", "DPU"])
    assert fire(rid, {"KNVV": knvv}) == (1, 2)


def test_rebate_without_settlement_management():
    rid = _id("Customer is relevant for SD rebates but not for Settlement Management")
    knvv = frame("KNVV", KUNNR=["1", "2", "3"], VKORG=["1000"] * 3, VTWEG=["10"] * 3, SPART=["00"] * 3,
                 BOKRE=["X", "X", ""], AGREL=["", "X", ""])
    assert fire(rid, {"KNVV": knvv}) == (1, 3)


def test_plant_customer_needs_sales_data_in_plant_sales_area():
    rid = _id("Plant customer has no sales data in the sales area defined for the plant")
    t001w = frame("T001W", WERKS=["P1", "P2", "P3"], KUNNR=["C1", "C2", None], VKORG=["1000", "1000", "1000"],
                  VTWEG=["10", "10", "10"], SPART=["00", "00", "00"])
    knvv = frame("KNVV", KUNNR=["C1"], VKORG=["1000"], VTWEG=["10"], SPART=["00"])
    assert fire(rid, {"T001W": t001w, "KNVV": knvv}) == (1, 2)


@pytest.mark.parametrize("value,bad", [("50", False), ("100", False), ("101", True), ("5", False)])
def test_order_probability_range(value, bad):
    rid = _id("Order probability of the customer is not a percentage between 0 and 100")
    knvv = frame("KNVV", KUNNR=["1"], VKORG=["1000"], VTWEG=["10"], SPART=["00"], AWAHR=[value])
    assert fire(rid, {"KNVV": knvv})[0] == int(bad)
