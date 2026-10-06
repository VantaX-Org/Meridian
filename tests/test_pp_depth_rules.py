"""Production planning depth rules (PP205 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/production_planning.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if int(r["id"][2:]) >= 205]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="production_planning")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_ids_unique_and_contiguous():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][2:]) for r in NEW)
    assert new == list(range(205, 205 + len(new)))
    assert len(new) >= 200


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
            names = _fields(r["target_table"])
            assert set(r["target_fields"]) <= set(names), r["id"]
            assert set(r.get("target_when", {})) <= set(names), r["id"]


def test_referential_rules_have_a_check_table():
    for r in NEW:
        if r["check_class"] == "referential_check":
            table, name = r["field"].split(".")
            assert _fields(table)[name].get("check_table"), r["id"]


def test_new_rules_run_without_error_on_empty_frames():
    tables = {"MARC": frame("MARC", MATNR=["M1"], WERKS=["P1"])}
    frames = TableFrames(tables, DDIC, module="production_planning")
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- BOM ---------------------------------------------------------------------------------------------------------

def test_mast_to_deleted_bom():
    mast = frame("MAST", MATNR=["A", "B"], WERKS=["P1", "P1"], STLAN=["1", "1"], STLNR=["1", "2"], STLAL=["01", "01"])
    stko = frame("STKO", STLTY=["M", "M"], STLNR=["1", "2"], STLAL=["01", "01"], LKENZ=["", "X"])
    assert fire("PP205", {"MAST": mast, "STKO": stko}) == (1, 2)


def test_orphan_bom_header():
    stko = frame("STKO", STLTY=["M", "M"], STLNR=["1", "2"], STLAL=["01", "01"], LKENZ=["", ""])
    mast = frame("MAST", MATNR=["A"], WERKS=["P1"], STLAN=["1"], STLNR=["1"], STLAL=["01"])
    assert fire("PP206", {"STKO": stko, "MAST": mast}) == (1, 2)


def test_scrap_range_and_net_indicator():
    stpo = frame("STPO", STLTY=["M"] * 3, STLNR=["1"] * 3, STLKN=["1", "2", "3"], POSNR=["10", "20", "30"], LKENZ=[""] * 3,
                 AUSCH=["5", "150", "-1"], NETAU=["", "", "X"])
    assert fire("PP220", {"STPO": stpo}) == (2, 3)
    assert fire("PP222", {"STPO": stpo}) == (0, 3)


def test_alternative_item_needs_strategy():
    stpo = frame("STPO", STLTY=["M"] * 2, STLNR=["1"] * 2, STLKN=["1", "2"], POSNR=["10", "20"], LKENZ=[""] * 2,
                 ALPOS=["X", "X"], ALPST=["1", ""])
    assert fire("PP224", {"STPO": stpo}) == (1, 2)


def test_price_without_unit_or_currency():
    stpo = frame("STPO", STLTY=["M"] * 2, STLNR=["1"] * 2, STLKN=["1", "2"], POSNR=["10", "20"], LKENZ=[""] * 2,
                 PREIS=["10", "10"], PEINH=["1", "0"], WAERS=["", "USD"])
    assert fire("PP229", {"STPO": stpo})[0] == 1
    assert fire("PP230", {"STPO": stpo})[0] == 1


# ---- supersession ------------------------------------------------------------------------------------------------

def _bom(nfmat):
    stko = frame("STKO", STLTY=["M"], STLNR=["1"], STLAL=["01"], LKENZ=[""])
    stpo = frame("STPO", STLTY=["M"], STLNR=["1"], STLKN=["1"], POSNR=["10"], LKENZ=[""], IDNRK=["C1"], NFMAT=[nfmat],
                 POSTP=["L"])
    mast = frame("MAST", MATNR=["A"], WERKS=["P1"], STLAN=["1"], STLNR=["1"], STLAL=["01"])
    return stko, stpo, mast


def test_successor_must_exist_in_bom_plant():
    stko, stpo, mast = _bom("S1")
    marc_ok = frame("MARC", MATNR=["S1"], WERKS=["P1"], LVORM=[""])
    marc_other = frame("MARC", MATNR=["S1"], WERKS=["P2"], LVORM=[""])
    t = {"STKO": stko, "STPO": stpo, "MAST": mast}
    assert fire("PP253", {**t, "MARC": marc_ok})[0] == 0
    assert fire("PP253", {**t, "MARC": marc_other})[0] == 1


def test_successor_equals_component_or_header():
    stko, stpo, mast = _bom("C1")
    assert fire("PP255", {"STPO": stpo})[0] == 1
    stko, stpo, mast = _bom("A")
    assert fire("PP256", {"STKO": stko, "STPO": stpo, "MAST": mast})[0] == 1


def test_successor_dead_end_and_blocked():
    stko, stpo, mast = _bom("S1")
    t = {"STKO": stko, "STPO": stpo, "MAST": mast}
    dead = frame("MARC", MATNR=["S1"], WERKS=["P1"], KZAUS=["X"], NFMAT=[""], MMSTA=[""])
    live = frame("MARC", MATNR=["S1"], WERKS=["P1"], KZAUS=[""], NFMAT=[""], MMSTA=[""])
    assert fire("PP257", {**t, "MARC": dead})[0] == 1
    assert fire("PP257", {**t, "MARC": live})[0] == 0
    blocked = frame("MARC", MATNR=["S1"], WERKS=["P1"], KZAUS=[""], NFMAT=[""], MMSTA=["01"])
    assert fire("PP258", {**t, "MARC": blocked})[0] == 1


def test_circular_supersession_inside_bom():
    stpo = frame("STPO", STLTY=["M", "M"], STLNR=["1", "1"], STLKN=["1", "2"], POSNR=["10", "20"], LKENZ=["", ""],
                 IDNRK=["X", "Y"], NFMAT=["Y", "X"])
    assert fire("PP268", {"STPO": stpo})[0] >= 1
    ok = frame("STPO", STLTY=["M", "M"], STLNR=["1", "1"], STLKN=["1", "2"], POSNR=["10", "20"], LKENZ=["", ""],
               IDNRK=["X", "Y"], NFMAT=["Y", ""])
    assert fire("PP268", {"STPO": ok})[0] == 0


def test_component_past_effective_out():
    stko, stpo, mast = _bom("")
    t = {"STKO": stko, "STPO": stpo, "MAST": mast}
    old = (pd.Timestamp.today() - pd.Timedelta(days=30)).strftime("%Y%m%d")
    gone = frame("MARC", MATNR=["C1"], WERKS=["P1"], KZAUS=["X"], AUSDT=[old])
    fine = frame("MARC", MATNR=["C1"], WERKS=["P1"], KZAUS=[""], AUSDT=[""])
    assert fire("PP261", {**t, "MARC": gone})[0] == 1
    assert fire("PP261", {**t, "MARC": fine})[0] == 0


def test_successor_of_discontinued_part_needs_bom():
    marc = frame("MARC", MATNR=["A"], WERKS=["P1"], KZAUS=["X"], BESKZ=["E"], NFMAT=["B"])
    no_bom = frame("MAST", MATNR=["Z"], WERKS=["P1"], STLAN=["1"], STLNR=["9"], STLAL=["01"])
    bom = frame("MAST", MATNR=["B"], WERKS=["P1"], STLAN=["1"], STLNR=["9"], STLAL=["01"])
    assert fire("PP265", {"MARC": marc, "MAST": no_bom})[0] == 1
    assert fire("PP265", {"MARC": marc, "MAST": bom})[0] == 0


# ---- routings ----------------------------------------------------------------------------------------------------

def test_operation_without_sequence():
    plpo = frame("PLPO", PLNTY=["N", "N"], PLNNR=["1", "1"], PLNKN=["1", "2"], VORNR=["10", "20"], LOEKZ=["", ""])
    plas = frame("PLAS", PLNTY=["N"], PLNNR=["1"], PLNAL=["1"], PLNKN=["1"], LOEKZ=[""])
    assert fire("PP284", {"PLPO": plpo, "PLAS": plas}) == (1, 2)


def test_operation_standard_value_checks():
    plpo = frame("PLPO", PLNTY=["N"] * 2, PLNNR=["1"] * 2, PLNKN=["1", "2"], VORNR=["10", "20"], LOEKZ=["", ""],
                 VGW01=["5", "-5"], VGW02=["0", "0"], VGW03=["0", "0"], VGW04=["0", "0"], VGW05=["0", "0"], VGW06=["0", "0"],
                 UMREN=["1", "0"])
    assert fire("PP289", {"PLPO": plpo}) == (1, 2)
    assert fire("PP287", {"PLPO": plpo}) == (1, 2)


def test_operation_work_centre_in_other_plant():
    plpo = frame("PLPO", PLNTY=["N"] * 2, PLNNR=["1"] * 2, PLNKN=["1", "2"], VORNR=["10", "20"], LOEKZ=["", ""],
                 ARBID=["100", "100"], WERKS=["P1", "P2"])
    crhd = frame("CRHD", OBJTY=["A"], OBJID=["100"], WERKS=["P1"], ARBPL=["WC1"])
    assert fire("PP283", {"PLPO": plpo, "CRHD": crhd}) == (1, 2)


def test_routing_linked_to_missing_bom():
    plko = frame("PLKO", PLNTY=["N", "N"], PLNNR=["1", "2"], PLNAL=["1", "1"], LOEKZ=["", ""], STLTY=["M", "M"],
                 STLNR=["5", "6"], STLAL=["01", "01"])
    stko = frame("STKO", STLTY=["M"], STLNR=["5"], STLAL=["01"], LKENZ=[""])
    assert fire("PP276", {"PLKO": plko, "STKO": stko}) == (1, 2)


# ---- work centres and capacity -----------------------------------------------------------------------------------

def test_work_centre_capacity_in_other_plant():
    crhd = frame("CRHD", OBJTY=["A", "A"], OBJID=["1", "2"], WERKS=["P1", "P1"], ARBPL=["W1", "W2"], KAPID=["10", "20"])
    kako = frame("KAKO", KAPID=["10", "20"], WERKS=["P1", "P2"])
    assert fire("PP334", {"CRHD": crhd, "KAKO": kako}) == (1, 2)


def test_capacity_values():
    kako = frame("KAKO", KAPID=["1", "2", "3"], POOLK=["", "", ""], AZNOR=["1", "0", "1"], NGRAD=["090", "090", "120"],
                 BEGZT=["21600", "21600", "21600"], ENDZT=["50400", "50400", "50400"], PAUSE=["1800", "1800", "1800"])
    assert fire("PP376", {"KAKO": kako}) == (1, 3)
    assert fire("PP377", {"KAKO": kako}) == (1, 3)


def test_costing_validity_inversion():
    crco = frame("CRCO", OBJTY=["A", "A"], OBJID=["1", "2"], BEGDA=["20240101", "20240101"], ENDDA=["20231231", "99991231"])
    assert fire("PP366", {"CRCO": crco}) == (1, 2)


# ---- production versions and plant data --------------------------------------------------------------------------

def test_version_with_neither_bom_nor_routing():
    mkal = frame("MKAL", MATNR=["A", "B"], WERKS=["P1", "P1"], VERID=["1", "1"], PLNNR=["", "7"], STLAL=["", ""])
    assert fire("PP393", {"MKAL": mkal})[0] == 1


def test_version_on_bought_material():
    mkal = frame("MKAL", MATNR=["A", "B"], WERKS=["P1", "P1"], VERID=["1", "1"])
    marc = frame("MARC", MATNR=["A", "B"], WERKS=["P1", "P1"], BESKZ=["E", "F"])
    assert fire("PP392", {"MKAL": mkal, "MARC": marc}) == (1, 2)


def test_special_procurement_key_matches_type():
    marc = frame("MARC", MATNR=["A", "B"], WERKS=["P1", "P1"], BESKZ=["E", "F"], SOBSL=["30", "30"])
    t460a = frame("T460A", WERKS=["P1"], SOBSL=["30"], BESKZ=["F"])
    assert fire("PP402", {"MARC": marc, "T460A": t460a}) == (1, 2)


def test_bought_material_with_bom():
    marc = frame("MARC", MATNR=["A", "B"], WERKS=["P1", "P1"], BESKZ=["F", "F"], SOBSL=["", ""], LVORM=["", ""])
    mast = frame("MAST", MATNR=["A"], WERKS=["P1"], STLAN=["1"], STLNR=["1"], STLAL=["01"])
    assert fire("PP405", {"MARC": marc, "MAST": mast}) == (1, 2)
