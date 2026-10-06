"""Plant maintenance depth rules (PM202+): integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

START, COUNT = 202, 117
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")
ALL = yaml.safe_load(open("checks/rules/ecc/plant_maintenance.yaml"))["rules"]
RULES = {r["id"]: r for r in ALL}
NEW = [r for r in ALL if int(r["id"][2:]) >= START]


def rid(field, text):
    hits = [r["id"] for r in NEW if r["field"] == field and text in r["message"]]
    assert len(hits) == 1, (field, text, hits)
    return hits[0]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rule_id, tables):
    _, res = run_rule(dict(RULES[rule_id]), TableFrames(tables, DDIC, module="plant_maintenance"), {})
    assert res is not None and not res.error, (rule_id, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def test_ids_unique_and_contiguous():
    ids = [r["id"] for r in ALL]
    assert len(ids) == len(set(ids))
    assert sorted(int(r["id"][2:]) for r in NEW) == list(range(START, START + COUNT))


def test_metadata_complete():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)


def test_fields_exist_in_ddic():
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


def test_no_personal_values_echoed():
    bad = re.compile(r"NAME|STRAS|CITY|TEL|SMTP|BIRTH")
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"]):
            assert not bad.search(f), (r["id"], f)


def test_every_new_rule_runs_on_minimal_frames():
    tables = {"EQUI": frame("EQUI", EQUNR=["E1"]), "MPLA": frame("MPLA", WARPL=["P1"]),
              "MPOS": frame("MPOS", WAPOS=["I1"], WARPL=["P1"])}
    for r in NEW:
        _, res = run_rule(dict(r), TableFrames(tables, DDIC, module="plant_maintenance"), {})
        assert res is None or not res.error, (r["id"], res.error)


def test_superior_equipment_flagged_for_deletion():
    equi = frame("EQUI", EQUNR=["E1", "E2", "E3"], LVORM=["X", "", ""])
    equz = frame("EQUZ", EQUNR=["E1", "E2", "E3"], DATBI=["99991231"] * 3, EQLFN=["001"] * 3, HEQUI=["", "E1", "E3"])
    assert fire(rid("EQUZ.HEQUI", "flagged for deletion"), {"EQUI": equi, "EQUZ": equz}) == (1, 2)


def test_warranty_end_before_start():
    equi = frame("EQUI", EQUNR=["E1", "E2"], GWLDT=["20240101", "20240101"], GWLEN=["20230101", "20250101"])
    assert fire(rid("EQUI.GWLEN", "before it starts"), {"EQUI": equi}) == (1, 2)


def test_discontinued_material_with_and_without_follow_up():
    equi = frame("EQUI", EQUNR=["E1", "E2", "E3"], MATNR=["M1", "M2", "M3"], WERK=["1000"] * 3)
    marc = frame("MARC", MATNR=["M1", "M2", "M3"], WERKS=["1000"] * 3, KZAUS=["X", "X", ""], NFMAT=["M9", "", ""])
    t = {"EQUI": equi, "MARC": marc}
    assert fire(rid("EQUI.MATNR", "discontinued with a follow-up"), t) == (1, 3)
    assert fire(rid("EQUI.MATNR", "discontinued without a follow-up"), t) == (1, 3)


def test_bom_component_discontinued():
    stpo = frame("STPO", STLTY=["E", "E", "M"], STLNR=["1", "2", "3"], STLKN=["1"] * 3, IDNRK=["M1", "M2", "M1"], LKENZ=["", "", ""])
    marc = frame("MARC", MATNR=["M1"], WERKS=["1000"], KZAUS=["X"], NFMAT=["M9"])
    assert fire(rid("STPO.IDNRK", "discontinued with a follow-up"), {"STPO": stpo, "MARC": marc}) == (1, 2)


def test_cost_centre_must_exist_in_company_code():
    iloa = frame("ILOA", ILOAN=["1", "2"], KOKRS=["A"] * 2, KOSTL=["C1", "C1"], BUKRS=["1000", "2000"])
    csks = frame("CSKS", KOKRS=["A"], KOSTL=["C1"], BUKRS=["1000"], DATBI=["99991231"])
    assert fire(rid("ILOA.KOSTL", "does not exist in the controlling"), {"ILOA": iloa, "CSKS": csks}) == (1, 2)


def test_counter_without_maximum_reading():
    imptt = frame("IMPTT", POINT=["P1", "P2"], INDCT=["X", "X"], MRMAXI=["", "X"])
    assert fire(rid("IMPTT.MRMAXI", "upper reading limit"), {"IMPTT": imptt}) == (1, 2)


def test_plan_without_item_and_single_cycle_plan_without_cycle():
    mpla = frame("MPLA", WARPL=["P1", "P2"], STRAT=["", ""], LVORM=["", ""])
    mpos = frame("MPOS", WAPOS=["I1"], WARPL=["P1"])
    mmpt = frame("MMPT", WARPL=["P2"], ZAEHL=["01"])
    t = {"MPLA": mpla, "MPOS": mpos, "MMPT": mmpt}
    assert fire(rid("MPLA.WARPL", "no maintenance item"), t) == (1, 2)
    assert fire(rid("MPLA.WARPL", "has no cycle"), t) == (1, 2)


def test_item_strategy_differs_from_plan():
    mpla = frame("MPLA", WARPL=["P1"], STRAT=["S1"])
    mpos = frame("MPOS", WAPOS=["I1", "I2"], WARPL=["P1", "P1"], WSTRA=["S1", "S2"])
    assert fire(rid("MPOS.WSTRA", "differs from plan"), {"MPLA": mpla, "MPOS": mpos}) == (1, 2)


def test_item_task_list_missing():
    mpos = frame("MPOS", WAPOS=["I1", "I2"], WARPL=["P1"] * 2, PLNTY=["A", "A"], PLNNR=["T1", "T2"], PLNAL=["01", "01"])
    plko = frame("PLKO", PLNTY=["A"], PLNNR=["T1"], PLNAL=["01"], ZAEHL=["1"], LOEKZ=[""])
    assert fire(rid("MPOS.PLNNR", "does not exist"), {"MPOS": mpos, "PLKO": plko}) == (1, 2)


def test_cycle_without_unit():
    mmpt = frame("MMPT", WARPL=["P1", "P1"], ZAEHL=["01", "02"], ZYKL1=[12.0, 12.0], ZEIEH=["MON", ""])
    assert fire(rid("MMPT.ZEIEH", "without unit"), {"MMPT": mmpt}) == (1, 2)


def test_pm_operation_without_control_key():
    plpo = frame("PLPO", PLNTY=["A", "A", "N"], PLNNR=["T1"] * 3, PLNKN=["1", "2", "3"], ZAEHL=["1"] * 3,
                 VORNR=["10", "20", "30"], STEUS=["PM01", "", ""])
    assert fire(rid("PLPO.STEUS", "no control key"), {"PLPO": plpo}) == (1, 2)

