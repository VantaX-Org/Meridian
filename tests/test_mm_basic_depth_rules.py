"""Material master basic-data depth rules (MM600-MM699): MARA, MAKT, MARM, MEAN, MLAN and classification.
Pack integrity, auto_fix contract and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][2:].isdigit() and 600 <= int(r["id"][2:]) < 700]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros", "regex_replace",
       "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def fields_of(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


# ---- pack integrity ----------------------------------------------------------------------------------------------

def test_new_ids_are_contiguous_from_mm600():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = [int(r["id"][2:]) for r in NEW]
    assert new == list(range(600, 600 + len(new)))
    assert 60 <= len(new) <= 100
    assert ids[-len(new):] == [r["id"] for r in NEW]  # one block at the end of the pack


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["rule_authority"] in ("sap_hard_constraint", "best_practice"), r["id"]
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        refs |= {s["from"] for s in (r.get("auto_fix") or {}).get("steps", []) if s.get("from")}
        for f in refs:
            table, name = f.split(".")
            assert name in fields_of(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            names = fields_of(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when") or {}) <= set(names), r["id"]


def test_referential_rules_have_a_check_table_and_domain_rules_fixed_values():
    for r in NEW:
        table, name = r["field"].split(".")
        fld = fields_of(table)[name]
        if r["check_class"] == "referential_check":
            assert fld.get("check_table"), r["id"]
        if r["check_class"] == "domain_value_check" and not r.get("allowed_values"):
            dom = json.load(open(f"sap/dictionaries/ecc6/domains/{fld['domain']}.json"))
            assert dom.get("fixed_values"), r["id"]


def test_auto_fix_uses_only_contract_ops():
    fixed = [r for r in PACK if r.get("auto_fix")]
    assert sum(1 for r in NEW if r.get("auto_fix")) >= 25
    for r in fixed:
        af = r["auto_fix"]
        assert set(af) <= {"when", "steps", "confidence"}, r["id"]
        assert af["confidence"] in ("high", "medium", "low"), r["id"]
        assert af["steps"], r["id"]
        for s in af["steps"]:
            assert s["op"] in OPS, (r["id"], s)


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"MARA": frame("MARA", MATNR=["M1"]), "MARM": frame("MARM", MATNR=["M1"], MEINH=["ST"]),
              "MAKT": frame("MAKT", MATNR=["M1"], SPRAS=["E"], MAKTX=["BOLT"])}
    frames = TableFrames(tables, DDIC, module="material_master")
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- MARA --------------------------------------------------------------------------------------------------------

def test_material_number_reserved_characters():
    mara = frame("MARA", MATNR=["BOLT-M8", "BOLT*M8"])
    assert fire("MM600", {"MARA": mara}) == (1, 2)


def test_kmat_must_be_configurable():
    mara = frame("MARA", MATNR=["M1", "M2", "M3"], MTART=["KMAT", "KMAT", "FERT"], KZKFG=["X", "", ""])
    assert fire("MM601", {"MARA": mara}) == (1, 3)


def test_configurable_material_needs_variant_class():
    mara = frame("MARA", MATNR=["M1", "M2"], KZKFG=["X", "X"])
    inob = frame("INOB", CUOBJ=["1", "2"], OBJEK=["M1", "M2"], KLART=["300", "001"], OBTAB=["MARA", "MARA"])
    assert fire("MM602", {"MARA": mara, "INOB": inob})[0] == 1


def test_service_material_not_batch_managed():
    mara = frame("MARA", MATNR=["M1", "M2"], MTART=["DIEN", "ROH"], XCHPF=["X", "X"])
    assert fire("MM603", {"MARA": mara}) == (1, 2)


def test_weight_based_material_net_weight_is_one():
    mara = frame("MARA", MATNR=["M1", "M2"], MEINS=["KG", "KG"], GEWEI=["KG", "KG"], NTGEW=["1", "25"])
    assert fire("MM604", {"MARA": mara}) == (1, 2)


def test_partial_dimensions():
    mara = frame("MARA", MATNR=["M1", "M2"], LAENG=["10", "10"], BREIT=["5", "0"], HOEHE=["2", "0"])
    assert fire("MM606", {"MARA": mara}) == (1, 2)


def test_volume_against_box():
    mara = frame("MARA", MATNR=["M1", "M2"], MEABM=["CM", "CM"], VOLEH=["CCM", "CCM"], VOLUM=["100", "100"],
                 LAENG=["10", "100"], BREIT=["5", "100"], HOEHE=["2", "100"])
    assert fire("MM608", {"MARA": mara}) == (1, 2)


def test_length_unit_code_list():
    mara = frame("MARA", MATNR=["M1", "M2"], MEABM=["CM", "MTR"])
    assert fire("MM614", {"MARA": mara}) == (1, 2)


def test_packaging_weight_without_unit():
    mara = frame("MARA", MATNR=["M1", "M2"], ERGEW=["500", "500"], ERGEI=["KG", ""])
    assert fire("MM618", {"MARA": mara}) == (1, 2)


def test_gtin_length_matches_category():
    mara = frame("MARA", MATNR=["M1", "M2"], EAN11=["4006381333931", "400638133393"], NUMTP=["HE", "HE"])
    assert fire("MM635", {"MARA": mara}) == (1, 2)


def test_deleted_material_without_status():
    mara = frame("MARA", MATNR=["M1", "M2"], LVORM=["X", "X"], MSTAE=["99", ""])
    assert fire("MM645", {"MARA": mara}) == (1, 2)


def test_single_material_with_generic_reference():
    mara = frame("MARA", MATNR=["M1", "M2"], ATTYP=["02", "00"], SATNR=["G1", "G1"])
    assert fire("MM646", {"MARA": mara}) == (1, 2)


def test_gds_relevant_needs_gtin():
    mara = frame("MARA", MATNR=["M1", "M2"], GDS_RELEVANT=["X", "X"], EAN11=["4006381333931", ""])
    assert fire("MM647", {"MARA": mara}) == (1, 2)


def test_remaining_shelf_life_needs_total():
    mara = frame("MARA", MATNR=["M1", "M2"], MHDRZ=["10", "10"], MHDHB=["90", "0"])
    assert fire("MM649", {"MARA": mara}) == (1, 2)


def test_xfeld_domain():
    mara = frame("MARA", MATNR=["M1", "M2"], HAZMAT=["X", "Y"])
    assert fire("MM650", {"MARA": mara}) == (1, 2)


def test_country_of_origin_referential():
    mara = frame("MARA", MATNR=["M1", "M2"], HERKL=["DE", "XX"])
    assert fire("MM659", {"MARA": mara}, {"T005.LAND1": {"DE"}}) == (1, 2)


# ---- MARM / MEAN -------------------------------------------------------------------------------------------------

def test_base_unit_row_weight_matches_mara():
    mara = frame("MARA", MATNR=["M1", "M2"], MEINS=["ST", "ST"], BRGEW=["2", "2"], GEWEI=["KG", "KG"])
    marm = frame("MARM", MATNR=["M1", "M2"], MEINH=["ST", "ST"], UMREZ=["1", "1"], UMREN=["1", "1"],
                 BRGEW=["2", "3"], GEWEI=["KG", "KG"])
    assert fire("MM620", {"MARA": mara, "MARM": marm}) == (1, 2)


def test_base_unit_row_gtin_missing():
    mara = frame("MARA", MATNR=["M1", "M2"], MEINS=["ST", "ST"], EAN11=["4006381333931", "4006381333948"])
    marm = frame("MARM", MATNR=["M1", "M2"], MEINH=["ST", "ST"], EAN11=["4006381333931", ""])
    assert fire("MM622", {"MARA": mara, "MARM": marm}) == (1, 2)


def test_pack_weight_below_contents():
    mara = frame("MARA", MATNR=["M1"], MEINS=["ST"], NTGEW=["1"], GEWEI=["KG"])
    marm = frame("MARM", MATNR=["M1", "M1"], MEINH=["KAR", "PAL"], UMREZ=["10", "100"], UMREN=["1", "1"],
                 BRGEW=["11", "50"], GEWEI=["KG", "KG"])
    assert fire("MM626", {"MARA": mara, "MARM": marm}) == (1, 2)


def test_lower_level_unit_must_exist_and_differ():
    marm = frame("MARM", MATNR=["M1", "M1", "M1"], MEINH=["ST", "KAR", "PAL"], MESUB=["", "ST", "BOX"])
    assert fire("MM627", {"MARM": marm})[0] == 1
    loop = frame("MARM", MATNR=["M1", "M1"], MEINH=["KAR", "PAL"], MESUB=["KAR", "KAR"])
    assert fire("MM628", {"MARM": loop}) == (1, 2)


def test_packaging_unit_less_than_one_piece():
    mara = frame("MARA", MATNR=["M1"], MEINS=["ST"])
    marm = frame("MARM", MATNR=["M1", "M1"], MEINH=["KAR", "PAL"], UMREZ=["12", "1"], UMREN=["1", "480"])
    assert fire("MM629", {"MARA": mara, "MARM": marm}) == (1, 2)


def test_duplicate_conversion_factor():
    marm = frame("MARM", MATNR=["M1", "M1", "M1"], MEINH=["CS", "CAR", "PAL"], UMREZ=["12", "12", "480"],
                 UMREN=["1", "1", "1"])
    assert fire("MM630", {"MARM": marm})[0] == 2


def test_main_gtin_matches_unit_gtin():
    marm = frame("MARM", MATNR=["M1", "M2"], MEINH=["ST", "ST"], EAN11=["4006381333931", "4006381333948"])
    mean = frame("MEAN", MATNR=["M1", "M2"], MEINH=["ST", "ST"], LFNUM=["1", "1"],
                 EAN11=["4006381333931", "4006381333955"], HPEAN=["X", "X"])
    assert fire("MM632", {"MARM": marm, "MEAN": mean})[0] == 1


def test_instore_gtin_category():
    mean = frame("MEAN", MATNR=["M1", "M2"], MEINH=["ST", "ST"], LFNUM=["1", "1"],
                 EAN11=["2001234567893", "4006381333931"], EANTP=["HE", "HE"])
    assert fire("MM636", {"MEAN": mean}) == (1, 2)


# ---- MAKT --------------------------------------------------------------------------------------------------------

def test_description_rules():
    makt = frame("MAKT", MATNR=["M1", "M2"], SPRAS=["E", "E"], MAKTX=["BOLT M8", "BOLT|M8"])
    assert fire("MM638", {"MAKT": makt}) == (1, 2)
    mara = frame("MARA", MATNR=["M1", "M2"], LVORM=["", ""], MSTAE=["", "99"])
    old = frame("MAKT", MATNR=["M1", "M2"], SPRAS=["E", "E"], MAKTX=["BOLT DO NOT USE", "BOLT OBSOLETE"])
    assert fire("MM639", {"MARA": mara, "MAKT": old}) == (1, 2)
    digits = frame("MAKT", MATNR=["M1", "M2"], SPRAS=["E", "E"], MAKTX=["BOLT M8", "123-456"])
    assert fire("MM641", {"MAKT": digits}) == (1, 2)
    cut = frame("MAKT", MATNR=["M1", "M2"], SPRAS=["E", "E"], MAKTX=["BOLT M8", "BOLT M8 ZINC PLATED /"])
    assert fire("MM643", {"MAKT": cut}) == (1, 2)
    low = frame("MAKT", MATNR=["M1", "M2"], SPRAS=["E", "E"], MAKTX=["Bolt M8", "bolt m8"])
    assert fire("MM644", {"MAKT": low}) == (1, 2)


# ---- classification ----------------------------------------------------------------------------------------------

def test_class_must_be_released():
    klah = frame("KLAH", CLINT=["1", "2"], KLART=["001", "001"], CLASS=["A", "B"], STATU=["1", "2"])
    kssk = frame("KSSK", OBJEK=["M1", "M2"], MAFID=["O", "O"], KLART=["001", "001"], CLINT=["1", "2"], ADZHL=["0", "0"])
    assert fire("MM671", {"KLAH": klah, "KSSK": kssk})[0] == 1


def test_interval_upper_below_lower():
    ausp = frame("AUSP", OBJEK=["M1", "M2"], ATINN=["1", "1"], ATZHL=["1", "1"], MAFID=["O", "O"], KLART=["001", "001"],
                 ADZHL=["0", "0"], ATFLV=["1", "10"], ATFLB=["5", "5"])
    assert fire("MM672", {"AUSP": ausp}) == (1, 2)


def test_characteristic_and_class_names_upper_case():
    cabn = frame("CABN", ATINN=["1", "2"], ADZHL=["0", "0"], ATNAM=["COLOR", "Color"])
    assert fire("MM675", {"CABN": cabn}) == (1, 2)
    klah = frame("KLAH", CLINT=["1", "2"], KLART=["001", "001"], CLASS=["PUMPS", "pumps"])
    assert fire("MM676", {"KLAH": klah}) == (1, 2)


def test_classification_of_missing_material():
    mara = frame("MARA", MATNR=["M1"])
    kssk = frame("KSSK", OBJEK=["M1", "M9"], MAFID=["O", "O"], KLART=["001", "001"], CLINT=["1", "1"], ADZHL=["0", "0"])
    assert fire("MM678", {"MARA": mara, "KSSK": kssk})[0] == 1


def test_character_characteristic_length():
    cabn = frame("CABN", ATINN=["1", "2"], ADZHL=["0", "0"], ATNAM=["A", "B"], ATFOR=["CHAR", "CHAR"], ANZST=["30", "40"])
    assert fire("MM682", {"CABN": cabn}) == (1, 2)
