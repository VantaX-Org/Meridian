"""Material master depth rules (MM317 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][2:].isdigit() and int(r["id"][2:]) >= 317]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_pack_loads_with_unique_contiguous_ids():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][2:]) for r in NEW)
    assert new == list(range(317, 317 + len(new)))
    assert len(new) >= 240


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {}), *r.get("block_by", [])}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            names = {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}
            assert name in names, (r["id"], f)
        if r["check_class"] == "exists_check":
            names = {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{r['target_table']}.json"))["fields"]}
            assert set(r["target_fields"]) <= names, r["id"]


def test_referential_rules_have_a_check_table_and_domain_rules_fixed_values():
    for r in NEW:
        table, name = r["field"].split(".")
        fld = next(x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"] if x["name"] == name)
        if r["check_class"] == "referential_check":
            assert fld.get("check_table"), r["id"]
        if r["check_class"] == "domain_value_check":
            dom = json.load(open(f"sap/dictionaries/ecc6/domains/{fld['domain']}.json"))
            assert dom.get("fixed_values"), r["id"]


def test_new_rules_run_without_error_on_empty_frames():
    tables = {"MARA": frame("MARA", MATNR=["M1"]), "MARC": frame("MARC", MATNR=["M1"], WERKS=["P1"])}
    frames = TableFrames(tables, DDIC, module="material_master")
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- basic data --------------------------------------------------------------------------------------------------

def test_domain_rule_flags_value_outside_domain():
    mara = frame("MARA", MATNR=["M1", "M2"], ATTYP=["01", "ZZ"])
    assert fire("MM317", {"MARA": mara}) == (1, 2)


def test_negative_dimensions_and_shelf_life():
    mara = frame("MARA", MATNR=["M1", "M2"], BRGEW=["1.000", "-1.000"], NTGEW=["1", "1"], VOLUM=["1", "1"],
                 LAENG=["1", "1"], BREIT=["1", "1"], HOEHE=["1", "1"], MHDLP=["20", "150"])
    assert fire("MM319", {"MARA": mara}) == (1, 2)
    assert fire("MM447", {"MARA": mara}) == (1, 2)


def test_variant_needs_generic_material():
    mara = frame("MARA", MATNR=["V1", "V2"], ATTYP=["02", "02"], SATNR=["G1", ""])
    assert fire("MM320", {"MARA": mara}) == (1, 2)


def test_generic_material_must_exist_and_be_generic():
    mara = frame("MARA", MATNR=["G1", "V1", "V2"], ATTYP=["01", "02", "02"], SATNR=["", "G1", "G9"])
    assert fire("MM322", {"MARA": mara})[0] == 1


def test_status_without_dependent_data():
    mara = frame("MARA", MATNR=["M1", "M2"], VPSTA=["KV", "KV"])
    mvke = frame("MVKE", MATNR=["M1"], VKORG=["S1"], VTWEG=["01"])
    assert fire("MM330", {"MARA": mara, "MVKE": mvke}) == (1, 2)


def test_old_material_number_duplicates():
    mara = frame("MARA", MATNR=["M1", "M2", "M3"], BISMT=["OLD1", "OLD1", "OLD2"])
    affected, total = fire("MM334", {"MARA": mara})
    assert (affected, total) == (2, 3)


def test_manufacturer_part_number_near_duplicates():
    mara = frame("MARA", MATNR=["M1", "M2", "M3"], MFRNR=["V1", "V1", "V1"], MFRPN=["HYDRAULIC-PUMP-100", "HYDRAULIC-PUMP-100X", "ZZ-9"])
    affected, _ = fire("MM335", {"MARA": mara})
    assert affected >= 2


# ---- GTIN --------------------------------------------------------------------------------------------------------

def test_gtin_uniqueness_and_check_digit():
    mean = frame("MEAN", MATNR=["M1", "M2", "M3"], MEINH=["EA", "EA", "EA"], LFNUM=["1", "1", "1"],
                 EAN11=["4006381333931", "4006381333931", "4006381333932"], HPEAN=["X", "X", ""])
    assert fire("MM336", {"MEAN": mean}) == (2, 3)
    assert fire("MM337", {"MEAN": mean}) == (1, 3)


def test_main_gtin_unique_per_material():
    mean = frame("MEAN", MATNR=["M1", "M1", "M2"], MEINH=["EA", "BOX", "EA"], LFNUM=["1", "2", "1"],
                 EAN11=["1", "2", "3"], HPEAN=["X", "X", "X"])
    assert fire("MM445", {"MEAN": mean}) == (2, 3)


def test_gtin_unit_must_be_a_material_unit():
    marm = frame("MARM", MATNR=["M1"], MEINH=["EA"])
    mean = frame("MEAN", MATNR=["M1", "M1"], MEINH=["EA", "BOX"], LFNUM=["1", "2"], EAN11=["1", "2"])
    assert fire("MM444", {"MARM": marm, "MEAN": mean}) == (1, 2)


# ---- descriptions ------------------------------------------------------------------------------------------------

def test_description_rules():
    makt = frame("MAKT", MATNR=["M1", "M2", "M3"], SPRAS=["E", "E", "E"], MAKTX=["Bolt M8", " Nut  M8", "Washer"],
                 MAKTG=["BOLT M8", "NUT M8", ""])
    assert fire("MM341", {"MAKT": makt}) == (1, 3)
    assert fire("MM343", {"MAKT": makt}) == (1, 3)
    bad = makt.assign(**{"MAKT.MAKTG": ["BOLT M8", "NUT M8", "SCREW"]})
    assert fire("MM342", {"MAKT": bad}) == (1, 3)


# ---- referential -------------------------------------------------------------------------------------------------

def test_referential_rules_flag_values_missing_from_check_table():
    mvke = frame("MVKE", MATNR=["M1", "M2"], VKORG=["S1", "S1"], VTWEG=["01", "01"], KONDM=["10", "99"])
    mara = frame("MARA", MATNR=["M1", "M2"])
    assert fire("MM357", {"MARA": mara, "MVKE": mvke}, {"T178.KONDM": {"10"}})[0] == 1
    marc = frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"], USEQU=["G1", "G9"])
    assert fire("MM388", {"MARC": marc}, {"TMQ2.USEQU": {"G1"}}) == (1, 2)


# ---- MARC cross-field --------------------------------------------------------------------------------------------

def test_marc_cross_field_rules():
    marc = frame("MARC", MATNR=["M1", "M2", "M3"], WERKS=["P1", "P1", "P1"], SHZET=["2", "0", "0"], SHFLG=["", "X", "X"],
                 LVORM=["", "", "X"], DISMM=["PD", "PD", "PD"], AUSDT=["20150101", "20150101", "20150101"],
                 LZEIH=["", "", ""], MAXLZ=["0", "0", "0"])
    assert fire("MM391", {"MARC": marc})[0] == 1  # days but no indicator (M1)
    assert fire("MM392", {"MARC": marc})[0] == 1  # indicator but no days (M2; M3 is deleted)
    assert fire("MM398", {"MARC": marc})[0] == 2  # passed effective-out, still planned (M1, M2)
    assert fire("MM399", {"MARC": marc})[0] == 1  # deleted plant row still planned (M3)
    unit = marc.assign(**{"MARC.MAXLZ": ["5", "0", "0"], "MARC.LZEIH": ["", "", ""]})
    assert fire("MM393", {"MARC": unit})[0] == 1


def test_marc_deletion_cascade():
    mara = frame("MARA", MATNR=["M1", "M2"], LVORM=["X", ""])
    marc = frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LVORM=["", ""])
    assert fire("MM380", {"MARA": mara, "MARC": marc})[0] == 1


# ---- classification ----------------------------------------------------------------------------------------------

def test_classification_rules():
    klah = frame("KLAH", CLINT=["1", "2"], KLART=["001", "001"], VONDT=["20200101", "20200101"],
                 BISDT=["20191231", "99991231"], STATU=["1", ""])
    assert fire("MM349", {"KLAH": klah}) == (1, 2)
    assert fire("MM348", {"KLAH": klah})[0] == 1
    cabn = frame("CABN", ATINN=["1", "2"], ATFOR=["CHAR", "CHAR"], ANZST=["10", "0"], ANZDZ=["0", "0"])
    assert fire("MM354", {"CABN": cabn}) == (1, 2)


def test_classification_assignment_needs_class():
    kssk = frame("KSSK", OBJEK=["O1", "O2"], MAFID=["O", "O"], KLART=["001", "001"], CLINT=["1", "9"])
    klah = frame("KLAH", CLINT=["1"], KLART=["001"])
    assert fire("MM350", {"KSSK": kssk, "KLAH": klah})[0] == 1


# ---- accounting and stock ----------------------------------------------------------------------------------------

def test_future_price_date_past():
    mbew = frame("MBEW", MATNR=["M1", "M2"], BWKEY=["P1", "P1"], BWTAR=["", ""], ZKPRS=["10", "10"],
                 ZKDAT=["20150101", "20991231"], STPRS=["-1", "5"], VERPR=["1", "1"])
    assert fire("MM423", {"MBEW": mbew}) == (1, 2)
    assert fire("MM422", {"MBEW": mbew})[0] == 1


def test_valuated_quantity_must_cover_storage_location_stock():
    mbew = frame("MBEW", MATNR=["M1", "M2"], BWKEY=["P1", "P1"], BWTAR=["", ""], LBKUM=["5", "20"])
    mard = frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"], LABST=["10", "10"])
    assert fire("MM425", {"MBEW": mbew, "MARD": mard}) == (1, 2)


def test_storage_stock_matches_batch_stock():
    mara = frame("MARA", MATNR=["M1", "M2"], XCHPF=["X", "X"])
    marc = frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"])
    mard = frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"], LABST=["10", "10"])
    mchb = frame("MCHB", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"], CHARG=["B1", "B1"],
                 CLABS=["10", "7"])
    assert fire("MM434", {"MARA": mara, "MARC": marc, "MARD": mard, "MCHB": mchb}) == (1, 2)


def test_physical_inventory_overdue():
    mard = frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"], LABST=["5", "5"],
                 DLINL=["20150101", pd.Timestamp.now().strftime("%Y%m%d")])
    assert fire("MM437", {"MARD": mard}) == (1, 2)


def test_stock_of_material_flagged_for_deletion():
    mara = frame("MARA", MATNR=["M1", "M2"], LVORM=["X", ""])
    mard = frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["0001", "0001"], LABST=["5", "5"])
    marc = frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"])
    assert fire("MM441", {"MARA": mara, "MARC": marc, "MARD": mard})[0] == 1


def test_units_of_measure_negative_dimension():
    marm = frame("MARM", MATNR=["M1", "M2"], MEINH=["BOX", "BOX"], BRGEW=["1", "-1"], VOLUM=["1", "1"],
                 LAENG=["1", "1"], BREIT=["1", "1"], HOEHE=["1", "1"])
    assert fire("MM443", {"MARM": marm}) == (1, 2)


# ---- supersession and discontinuation (MM542-MM563) ---------------------------------------------------------------

def marc_chain(nfmat, **extra):
    n = len(nfmat)
    cols = {"MATNR": [f"M{i}" for i in range(n)], "WERKS": ["P1"] * n, "NFMAT": nfmat}
    cols.update(extra)
    return frame("MARC", **cols)


def test_supersession_pack_is_complete():
    ss = [RULES[f"MM{i}"] for i in range(542, 564)]
    assert len(ss) == 22
    text = json.dumps(ss)
    for f in ("KZAUS", "AUSDT", "NFMAT", "NFEAG", "NFGRP"):
        assert f in text, f


def test_follow_up_without_indicator_or_date_without_indicator():
    marc = marc_chain(["M1", "M0", ""], KZAUS=["", "X", ""], AUSDT=["20300101", "", "20300101"])
    assert fire("MM542", {"MARC": marc})[0] == 1
    assert fire("MM543", {"MARC": marc})[0] == 2


def test_follow_up_must_exist_in_plant_and_client():
    marc = marc_chain(["M1", "ZZ", ""])
    assert fire("MM544", {"MARC": marc})[0] == 1
    mara = frame("MARA", MATNR=["M0", "M1", "M2"])
    assert fire("MM545", {"MARA": mara, "MARC": marc})[0] == 1


def test_follow_up_must_not_be_deleted_blocked_or_unplanned():
    base = {"LVORM": ["", "", ""], "MMSTA": ["", "", ""], "DISMM": ["PD", "PD", "PD"]}
    nf = ["M1", "M2", ""]
    assert fire("MM547", {"MARC": marc_chain(nf, **{**base, "LVORM": ["", "X", ""]})})[0] == 1
    assert fire("MM548", {"MARC": marc_chain(nf, **{**base, "MMSTA": ["", "01", ""]})})[0] == 1
    assert fire("MM549", {"MARC": marc_chain(nf, **{**base, "DISMM": ["PD", "ND", "PD"]})})[0] == 1
    mara = frame("MARA", MATNR=["M0", "M1", "M2"], LVORM=["", "X", ""])
    assert fire("MM546", {"MARA": mara, "MARC": marc_chain(nf)})[0] == 1


def test_follow_up_dead_end():
    marc = marc_chain(["M1", "", ""], KZAUS=["X", "X", ""])
    assert fire("MM550", {"MARC": marc})[0] == 1  # M0 -> M1, and M1 is discontinued with no successor
    ok = marc_chain(["M1", "M2", ""], KZAUS=["X", "X", ""])
    assert fire("MM550", {"MARC": ok})[0] == 0


def test_follow_up_loop_is_scoped_per_plant():
    marc = frame("MARC", MATNR=["A", "B", "C", "D"], WERKS=["P1"] * 4, NFMAT=["B", "A", "", ""])
    assert fire("MM551", {"MARC": marc})[0] == 2
    self_loop = frame("MARC", MATNR=["A"], WERKS=["P1"], NFMAT=["A"])
    assert fire("MM551", {"MARC": self_loop})[0] == 1
    long_loop = frame("MARC", MATNR=["A", "B", "C"], WERKS=["P1"] * 3, NFMAT=["B", "C", "A"])
    assert fire("MM551", {"MARC": long_loop})[0] == 3
    cross = frame("MARC", MATNR=["A", "B"], WERKS=["P1", "P2"], NFMAT=["B", "A"])  # not a loop inside either plant
    assert fire("MM551", {"MARC": cross})[0] == 0


def test_follow_up_chain_depth_limit():
    four = frame("MARC", MATNR=list("ABCDE"), WERKS=["P1"] * 5, NFMAT=["B", "C", "D", "E", ""])
    assert fire("MM552", {"MARC": four})[0] == 1  # A is four links from the end
    three = frame("MARC", MATNR=list("ABCD"), WERKS=["P1"] * 4, NFMAT=["B", "C", "D", ""])
    assert fire("MM552", {"MARC": three})[0] == 0
    five = frame("MARC", MATNR=list("ABCDEF"), WERKS=["P1"] * 6, NFMAT=["B", "C", "D", "E", "F", ""])
    assert fire("MM552", {"MARC": five})[0] == 2  # A and B
    loop = frame("MARC", MATNR=["A", "B"], WERKS=["P1"] * 2, NFMAT=["B", "A"])
    assert fire("MM552", {"MARC": loop})[0] == 2  # loop records fail every hierarchy_check, depth limit or not


def test_follow_up_must_match_unit_type_and_valuation():
    mara = frame("MARA", MATNR=["M0", "M1", "M2"], MEINS=["EA", "EA", "KG"], MTART=["ROH", "ROH", "FERT"])
    marc = marc_chain(["M1", "M2", ""])
    assert fire("MM553", {"MARA": mara, "MARC": marc})[0] == 1
    assert fire("MM554", {"MARA": mara, "MARC": marc})[0] == 1
    mbew = frame("MBEW", MATNR=["M0", "M1", "M2"], BWKEY=["P1"] * 3, BWTAR=[""] * 3, BKLAS=["3000", "3000", "7900"])
    assert fire("MM555", {"MBEW": mbew, "MARC": marc})[0] >= 1
    assert fire("MM556", {"MBEW": mbew.iloc[:2], "MARC": marc})[0] >= 1


def test_follow_up_needs_sales_view_when_predecessor_has_one():
    mara = frame("MARA", MATNR=["M0", "M1"], VPSTA=["KV", "KV"])
    marc = marc_chain(["M1", "M9"])
    mvke = frame("MVKE", MATNR=["M0", "M1"], VKORG=["S1", "S1"], VTWEG=["01", "01"])
    assert fire("MM557", {"MARA": mara, "MARC": marc, "MVKE": mvke})[0] >= 1


def test_effective_out_date_passed_without_block():
    today = pd.Timestamp.now().normalize()
    d = [(today + pd.Timedelta(days=x)).strftime("%Y%m%d") for x in (-400, -10, 10, -400)]
    marc = frame("MARC", MATNR=["M0", "M1", "M2", "M3"], WERKS=["P1"] * 4, AUSDT=d, MMSTA=["", "", "", "01"],
                 LVORM=[""] * 4, KZAUS=["X"] * 4)
    mara = frame("MARA", MATNR=["M0", "M1", "M2", "M3"], MSTAE=[""] * 4)
    assert fire("MM558", {"MARC": marc, "MARA": mara})[0] == 2  # M0 and M1 are past and unblocked
    assert fire("MM559", {"MARC": marc, "MARA": mara})[0] == 1  # only M0 is over a year old (@today and .dt.days evaluate)


def test_bom_discontinuation_group_rules():
    stpo = frame("STPO", STLTY=["M"] * 3, STLNR=["1", "1", "2"], STLKN=["1", "2", "1"], STPOZ=["1"] * 3,
                 IDNRK=["A", "B", "C"], NFEAG=["G1", "", "G2"], NFGRP=["", "G1", ""], LKENZ=[""] * 3)
    assert fire("MM561", {"STPO": stpo})[0] == 1  # G2 leader has no follower
    stpo2 = stpo.assign(**{"STPO.NFGRP": ["", "G1", "G5"], "STPO.NFEAG": ["G1", "", ""]})
    assert fire("MM562", {"STPO": stpo2})[0] == 1  # G5 follower has no leader
    flag = stpo.assign(**{"STPO.KZNFP": ["X", "X", ""], "STPO.NFGRP": ["", "G1", ""]})
    assert fire("MM563", {"STPO": flag})[0] == 1


def test_active_bom_component_is_discontinued_part():
    stpo = frame("STPO", STLTY=["M"] * 3, STLNR=["1"] * 3, STLKN=["1", "2", "3"], STPOZ=["1"] * 3,
                 IDNRK=["A", "B", "C"], NFGRP=["", "", "G1"], LKENZ=[""] * 3)
    marc = frame("MARC", MATNR=["A", "B", "C"], WERKS=["P1"] * 3, KZAUS=["X", "", "X"])
    assert fire("MM560", {"STPO": stpo, "MARC": marc})[0] == 1  # A is discontinued with no group; C has a group
