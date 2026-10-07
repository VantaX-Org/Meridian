"""Fixed asset depth rules (AA207 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

MODULE, PREFIX, START = "asset_accounting", "AA", 207
PACK = yaml.safe_load(open(f"checks/rules/ecc/{MODULE}.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][2:].isdigit() and int(r["id"][2:]) >= START]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module=MODULE)
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def ddic_fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_pack_loads_with_unique_contiguous_ids():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][2:]) for r in NEW)
    assert new == list(range(START, START + len(new)))
    assert len(new) == 40


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in ddic_fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = ddic_fields(r["target_table"])
            assert set(r["target_fields"]) <= set(target), r["id"]
            assert set(r.get("target_when", {})) <= set(target), r["id"]


def test_referential_rules_have_a_check_table_and_domain_rules_fixed_values():
    for r in NEW:
        table, name = r["field"].split(".")
        fld = ddic_fields(table)[name]
        if r["check_class"] == "referential_check":
            assert fld.get("check_table"), r["id"]
        if r["check_class"] == "domain_value_check":
            dom = json.load(open(f"sap/dictionaries/ecc6/domains/{fld['domain']}.json"))
            assert dom.get("fixed_values"), r["id"]


def test_new_rules_run_without_error_on_empty_frames():
    tables = {"ANLA": frame("ANLA", BUKRS=["1000"], ANLN1=["1"], ANLN2=["0"]),
              "ANLB": frame("ANLB", BUKRS=["1000"], ANLN1=["1"], ANLN2=["0"], AFABE=["01"])}
    frames = TableFrames(tables, DDIC, module=MODULE)
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


CUR = "99991231"


def anla(**extra):
    n = len(next(iter(extra.values())))
    cols = {"BUKRS": ["1000"] * n, "ANLN1": [str(i) for i in range(n)], "ANLN2": ["0"] * n}
    cols.update(extra)
    return frame("ANLA", **cols)


def keyed(table, n, **extra):
    cols = {"BUKRS": ["1000"] * n, "ANLN1": [str(i) for i in range(n)], "ANLN2": ["0"] * n}
    cols.update(extra)
    return frame(table, **cols)


# ---- class and account determination -----------------------------------------------------------------------------

def test_class_blocked_or_deleted():
    anka = frame("ANKA", ANLKL=["1000", "2000", "3000"], XLOEV=["", "X", ""], XSPEA=["", "", "X"])
    assert fire("AA207", {"ANLA": anla(ANLKL=["1000", "2000", "3000"]), "ANKA": anka}) == (2, 3)


def test_account_determination_matches_class():
    anka = frame("ANKA", ANLKL=["1000"], KTOGR=["10000"])
    assert fire("AA208", {"ANLA": anla(ANLKL=["1000", "1000"], KTOGR=["10000", "20000"]), "ANKA": anka}) == (1, 2)


def test_account_determination_has_accounts_in_chart():
    t001 = frame("T001", BUKRS=["1000"], KTOPL=["INT"])
    a = anla(KTOGR=["10000", "20000"])
    t095 = frame("T095", KTOPL=["INT"], KTOGR=["10000"], AFABE=["01"])
    assert fire("AA209", {"T001": t001, "ANLA": a, "T095": t095}) == (1, 2)
    t095b = frame("T095B", KTOPL=["INT"], KTOGR=["20000"], AFABE=["01"])
    assert fire("AA210", {"T001": t001, "ANLA": a, "T095B": t095b}) == (1, 2)


# ---- depreciation areas ------------------------------------------------------------------------------------------

def test_area_active_on_asset_but_not_in_class():
    t093c = frame("T093C", BUKRS=["1000"], AFAPL=["1DE"])
    a = anla(ANLKL=["1000", "1000"])
    anlb = keyed("ANLB", 2, AFABE=["01", "15"], XAFBE=["", ""])
    ankb = frame("ANKB", ANLKL=["1000", "1000"], AFAPL=["1DE", "1DE"], AFABE=["01", "15"], BDATU=[CUR, CUR],
                 XAFBE=["", "X"])
    assert fire("AA211", {"T093C": t093c, "ANLA": a, "ANLB": anlb, "ANKB": ankb}) == (1, 2)


def test_depreciation_key_in_chart_of_depreciation():
    t093c = frame("T093C", BUKRS=["1000"], AFAPL=["1DE"])
    anlb = keyed("ANLB", 2, AFABE=["01", "01"], AFASL=["LINS", "ZZZZ"])
    t090na = frame("T090NA", AFAPL=["1DE", "1US"], AFASL=["LINS", "ZZZZ"])
    tables = {"T093C": t093c, "ANLA": anla(ANLKL=["1", "1"]), "ANLB": anlb, "T090NA": t090na}
    assert fire("AA212", tables) == (1, 2)


def test_useful_life_periods_below_one_year():
    anlb = keyed("ANLB", 4, AFABE=["01"] * 4, NDJAR=["5"] * 4, NDPER=["000", "011", "012", "024"], XAFBE=[""] * 4)
    assert fire("AA214", {"ANLA": anla(ANLKL=["1"] * 4), "ANLB": anlb}) == (2, 4)


def test_depreciation_calculation_error_flag():
    anlc = keyed("ANLC", 3, GJAHR=["2026"] * 3, AFABE=["01"] * 3, ZUJHR=["0000"] * 3, ZUCOD=["0000"] * 3,
                 XAFAR=["0", "1", "2"])
    assert fire("AA215", {"ANLA": anla(ANLKL=["1"] * 3), "ANLC": anlc}) == (2, 3)


# ---- time-dependent data and origin ------------------------------------------------------------------------------

def test_location_defined_for_plant():
    anlz = keyed("ANLZ", 2, BDATU=[CUR, CUR], ADATU=["20200101"] * 2, WERKS=["P1", "P1"], STORT=["L1", "L9"])
    t499s = frame("T499S", WERKS=["P1"], STAND=["L1"])
    assert fire("AA213", {"ANLA": anla(ANLKL=["1", "1"]), "ANLZ": anlz, "T499S": t499s}) == (1, 2)


def test_investment_order_and_wbs_element_exist():
    aufk = frame("AUFK", AUFNR=["500000"])
    a = anla(EAUFN=["500000", "599999"], POSNR=["00000001", "00000009"])
    assert fire("AA216", {"ANLA": a, "AUFK": aufk}) == (1, 2)
    assert fire("AA217", {"ANLA": a}, {"PRPS.PSPNR": {"00000001"}}) == (1, 2)


def test_internal_order_on_asset_exists():
    anlz = keyed("ANLZ", 2, BDATU=[CUR, CUR], ADATU=["20200101"] * 2, CAUFN=["500000", "599999"])
    assert fire("AA218", {"ANLA": anla(ANLKL=["1", "1"]), "ANLZ": anlz}, {"AUFK.AUFNR": {"500000"}}) == (1, 2)


def test_cost_centres_on_asset():
    csks = frame("CSKS", KOKRS=["1000", "1000"], KOSTL=["C1", "C2"], DATBI=[CUR, CUR], BUKRS=["1000", "2000"])
    anlz = keyed("ANLZ", 2, BDATU=[CUR, CUR], ADATU=["20200101"] * 2, KOSTL=["C1", "C2"], KOSTLV=["C1", "C9"])
    tables = {"ANLA": anla(ANLKL=["1", "1"]), "ANLZ": anlz, "CSKS": csks}
    assert fire("AA219", tables) == (1, 2)
    assert fire("AA220", tables) == (1, 2)


def test_deleted_assets_are_out_of_scope():
    anka = frame("ANKA", ANLKL=["2000"], XLOEV=["X"], XSPEA=[""])
    a = anla(ANLKL=["2000", "2000"], XLOEV=["X", ""])
    assert fire("AA207", {"ANLA": a, "ANKA": anka})[0] == 1
