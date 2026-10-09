"""Depth/enrichment/fixture contract for EC239-EC443: the SuccessFactors
employee_central rules added on top of the EC121-238 batch covered by
tests/test_sf_ec_depth_rules.py. Same contract, same idioms, scoped to the
newer id range so the two files never collide on id ranges or CASES ids."""
import re
from datetime import date, timedelta

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and int(r["id"][2:]) >= 239]

MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message",
             "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template"]

ACTIVE = ["A", "U", "P", "S"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    frames = TableFrames(tables, S4, module="employee_central")
    _, res = run_rule(dict(BY_ID[rid]), frames, {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def test_new_ids_unique_and_contiguous():
    nums = [int(r["id"][2:]) for r in NEW]
    assert nums == list(range(239, 239 + len(nums)))
    assert len(NEW) == 205


def test_new_rules_fully_enriched():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        for f in re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]):
            table, field = f.split(".")
            assert S4.field(table, field) is not None, (r["id"], f)


# ── fixtures: (rule_id, tables, expected_affected, slice_tables_for_clean) ──

CASES = [
    # EMPJOBHIST ------------------------------------------------------------
    ("EC239", {"EMPJOBHIST": frame("EMPJOBHIST", USERID=[None, "u2"])}, 1, ["EMPJOBHIST"]),
    ("EC240", {"EMPJOBHIST": frame("EMPJOBHIST", SEQ_NUMBER=[None, "2"])}, 1, ["EMPJOBHIST"]),
    ("EC241", {"EMPJOBHIST": frame("EMPJOBHIST", EVENT=[None, "hire"])}, 1, ["EMPJOBHIST"]),
    ("EC246", {"EMPJOBHIST": frame("EMPJOBHIST", SEQ_NUMBER=["12a", "12"])}, 1, ["EMPJOBHIST"]),
    ("EC247", {"EMPJOBHIST": frame("EMPJOBHIST",
        USERID=["u1", "u1", "u2"], START_DATE=["20200101", "20200101", "20200101"],
        SEQ_NUMBER=["1", "1", "2"])}, 2, ["EMPJOBHIST"]),
    ("EC248", {
        "EMPJOBHIST": frame("EMPJOBHIST", MANAGER_ID=["m_missing", "m_ok"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["m_ok"]),
     }, 1, ["EMPJOBHIST"]),
    ("EC249", {"EMPJOBHIST": frame("EMPJOBHIST", USERID=["u1", "u2"], MANAGER_ID=["u2", "u1"])}, 2, ["EMPJOBHIST"]),
    ("EC250", {
        "EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], BUSINESS_UNIT=["BU_BAD", "BU_OK"]),
        "FOBUSINESSUNIT": frame("FOBUSINESSUNIT", EXTERNAL_CODE=["BU_OK"], STATUS=["A"]),
     }, 1, ["EMPJOBHIST"]),
    ("EC259", {"EMPJOBHIST": frame("EMPJOBHIST",
        START_DATE=["20200101", "20200101"], END_DATE=["20200101", "20200201"])}, 1, ["EMPJOBHIST"]),
    ("EC260", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], FTE=[0.0, 1.0])}, 1, ["EMPJOBHIST"]),
    ("EC261", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], FTE=[1.5, 1.0])}, 1, ["EMPJOBHIST"]),
    ("EC262", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], STANDARD_HOURS=[200.0, 40.0])}, 1, ["EMPJOBHIST"]),
    ("EC263", {"EMPJOBHIST": frame("EMPJOBHIST", IS_FULLTIME=["true", "false"], FTE=[0.5, 0.5])}, 1, ["EMPJOBHIST"]),
    ("EC265", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], PAY_GROUP=[None, "PG1"])}, 1, ["EMPJOBHIST"]),
    ("EC266", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], EMPLOYEE_CLASS=[None, "RG"])}, 1, ["EMPJOBHIST"]),
    ("EC267", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], WORK_SCHEDULE=[None, "WS1"])}, 1, ["EMPJOBHIST"]),
    ("EC268", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], HOLIDAY_CALENDAR=[None, "HC1"])}, 1, ["EMPJOBHIST"]),
    ("EC269", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], TIME_TYPE_PROFILE=[None, "TT1"])}, 1, ["EMPJOBHIST"]),
    ("EC270", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], TIMEZONE=[None, "UTC"])}, 1, ["EMPJOBHIST"]),
    ("EC377", {"EMPJOBHIST": frame("EMPJOBHIST",
        START_DATE=[(date.today() + timedelta(days=400)).strftime("%Y%m%d"),
                    (date.today() + timedelta(days=5)).strftime("%Y%m%d")])}, 1, ["EMPJOBHIST"]),
    ("EC378", {"EMPJOBHIST": frame("EMPJOBHIST", SEQ_NUMBER=[-1, 1])}, 1, ["EMPJOBHIST"]),
    ("EC380", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["T", "T"], EVENT=[None, "termination"])}, 1, ["EMPJOBHIST"]),
    ("EC381", {"EMPJOBHIST": frame("EMPJOBHIST", EVENT=["hire", "hire"], STATUS=["T", "A"])}, 1, ["EMPJOBHIST"]),
    ("EC382", {"EMPJOBHIST": frame("EMPJOBHIST", USERID=["u1", "u1", "u2"],
        EVENT=["hire", "hire", "hire"])}, 2, ["EMPJOBHIST"]),
    ("EC385", {"EMPJOBHIST": frame("EMPJOBHIST", COUNTRY_OF_COMPANY=["usa", "USA"])}, 1, ["EMPJOBHIST"]),
    ("EC386", {
        "EMPJOBHIST": frame("EMPJOBHIST", EVENT=["bogus_event", "hire"]),
        "FOEVENTREASON": frame("FOEVENTREASON", EVENT=["hire"]),
     }, 1, ["EMPJOBHIST"]),
    ("EC387", {"EMPJOBHIST": frame("EMPJOBHIST", USERID=["u1", "u2"], MANAGER_ID=["u1", "u3"])}, 1, ["EMPJOBHIST"]),
    ("EC389", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"],
        TIME_TYPE_PROFILE=["TT1", "TT1"], HOLIDAY_CALENDAR=[None, "HC1"],
        WORK_SCHEDULE=["WS1", "WS1"])}, 1, ["EMPJOBHIST"]),
    ("EC404", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], MANAGER_ID=[None, "m1"])}, 1, ["EMPJOBHIST"]),
    ("EC405", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], POSITION=[None, "P1"])}, 1, ["EMPJOBHIST"]),
    ("EC406", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], BUSINESS_UNIT=[None, "BU1"])}, 1, ["EMPJOBHIST"]),
    ("EC407", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], DIVISION=[None, "D1"])}, 1, ["EMPJOBHIST"]),
    ("EC408", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], COST_CENTER=[None, "CC1"])}, 1, ["EMPJOBHIST"]),
    ("EC409", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], LOCATION=[None, "L1"])}, 1, ["EMPJOBHIST"]),
    ("EC410", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], PAY_GRADE=[None, "PG1"])}, 1, ["EMPJOBHIST"]),
    ("EC411", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], EVENT_REASON=[None, "ER1"])}, 1, ["EMPJOBHIST"]),
    ("EC428", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], FTE=[None, 1.0])}, 1, ["EMPJOBHIST"]),
    ("EC429", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], STANDARD_HOURS=[None, 40.0])}, 1, ["EMPJOBHIST"]),
    ("EC430", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], IS_FULLTIME=[None, "true"])}, 1, ["EMPJOBHIST"]),
    ("EC436", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], JOB_CODE=["JC_BAD", "JC_OK"], EMPLOYEE_CLASS=["RG", "RG"]),
        "FOJOBCODE": frame("FOJOBCODE", EXTERNAL_CODE=["JC_BAD", "JC_OK"], EMPLOYEE_CLASS=["TMP", "RG"])}, 1, ["EMPJOBHIST"]),
    ("EC438", {
        "EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], EVENT_REASON=["ER_BAD", "ER_OK"]),
        "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["ER_OK"], STATUS=["A"]),
     }, 1, ["EMPJOBHIST"]),
    ("EC441", {"EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"],
        EVENT=["termination", "hire"], END_DATE=[None, None])}, 1, ["EMPJOBHIST"]),
    ("EC442", {
        "EMPJOBHIST": frame("EMPJOBHIST", USERID=["p_missing", "p_ok"]),
        "PERPERSON": frame("PERPERSON", PERSON_ID=["p_ok"]),
     }, 1, ["EMPJOBHIST"]),

    # USERACCOUNT -------------------------------------------------------------
    ("EC272", {"USERACCOUNT": frame("USERACCOUNT", USER_ID=[None, "u2"])}, 1, ["USERACCOUNT"]),
    ("EC273", {"USERACCOUNT": frame("USERACCOUNT", USERNAME=[None, "u2"])}, 1, ["USERACCOUNT"]),
    ("EC274", {"USERACCOUNT": frame("USERACCOUNT", EMAIL=[None, "u2@x.com"])}, 1, ["USERACCOUNT"]),
    ("EC275", {"USERACCOUNT": frame("USERACCOUNT", FIRST_NAME=[None, "Jo"])}, 1, ["USERACCOUNT"]),
    ("EC276", {"USERACCOUNT": frame("USERACCOUNT", LAST_NAME=[None, "Doe"])}, 1, ["USERACCOUNT"]),
    ("EC277", {"USERACCOUNT": frame("USERACCOUNT", STATUS=[None, "A"])}, 1, ["USERACCOUNT"]),
    ("EC278", {"USERACCOUNT": frame("USERACCOUNT", EMP_ID=[None, "e2"])}, 1, ["USERACCOUNT"]),
    ("EC279", {"USERACCOUNT": frame("USERACCOUNT", HIRE_DATE=[None, "20200101"])}, 1, ["USERACCOUNT"]),
    ("EC280", {"USERACCOUNT": frame("USERACCOUNT", USERNAME=["dup", "dup", "uniq"])}, 2, ["USERACCOUNT"]),
    ("EC281", {"USERACCOUNT": frame("USERACCOUNT", EMAIL=["dup@x.com", "dup@x.com", "uniq@x.com"])}, 2, ["USERACCOUNT"]),
    ("EC283", {"USERACCOUNT": frame("USERACCOUNT", EMAIL=["not-an-email", "ok@x.com"])}, 1, ["USERACCOUNT"]),
    ("EC284", {"USERACCOUNT": frame("USERACCOUNT", USERNAME=["bad name!", "good_name"])}, 1, ["USERACCOUNT"]),
    ("EC285", {"USERACCOUNT": frame("USERACCOUNT", DEFAULT_LOCALE=["ENGLISH", "en_US"])}, 1, ["USERACCOUNT"]),
    ("EC286", {"USERACCOUNT": frame("USERACCOUNT", TIMEZONE=[None, "UTC"])}, 1, ["USERACCOUNT"]),
    ("EC287", {"USERACCOUNT": frame("USERACCOUNT", DEFAULT_LOCALE=[None, "en_US"])}, 1, ["USERACCOUNT"]),
    ("EC288", {
        "USERACCOUNT": frame("USERACCOUNT", DEPARTMENT=["D_BAD", "D_OK"]),
        "FODEPARTMENT": frame("FODEPARTMENT", EXTERNAL_CODE=["D_OK"], STATUS=["A"]),
     }, 1, ["USERACCOUNT"]),
    ("EC291", {
        "USERACCOUNT": frame("USERACCOUNT", USER_ID=["u_bad", "u_ok"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u_ok"]),
     }, 1, ["USERACCOUNT"]),
    ("EC293", {
        "USERACCOUNT": frame("USERACCOUNT", USER_ID=["u_bad", "u_ok"], STATUS=["A", "A"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u_ok"], STATUS=["A"]),
     }, 1, ["USERACCOUNT"]),
    ("EC295", {"USERACCOUNT": frame("USERACCOUNT",
        HIRE_DATE=[(date.today() + timedelta(days=500)).strftime("%Y%m%d"),
                   (date.today() + timedelta(days=5)).strftime("%Y%m%d")])}, 1, ["USERACCOUNT"]),
    ("EC296", {"USERACCOUNT": frame("USERACCOUNT", FIRST_NAME=["J0hn123", "John"])}, 1, ["USERACCOUNT"]),
    ("EC297", {"USERACCOUNT": frame("USERACCOUNT", LAST_NAME=["D0e456", "Doe"])}, 1, ["USERACCOUNT"]),
    ("EC390", {"USERACCOUNT": frame("USERACCOUNT", USER_ID=["u1", "u2"], STATUS=["A", "A"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u1", "u2"], STATUS=["T", "A"])}, 1, ["EMPEMPLOYMENT"]),
    ("EC391", {"USERACCOUNT": frame("USERACCOUNT", USER_ID=["u1", "u2"], STATUS=["I", "A"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u1", "u2"], STATUS=["A", "A"])}, 1, ["EMPEMPLOYMENT"]),
    ("EC392", {"USERACCOUNT": frame("USERACCOUNT", EMP_ID=["other", "u2"], USER_ID=["u1", "u2"])}, 1, ["USERACCOUNT"]),
    ("EC398", {"USERACCOUNT": frame("USERACCOUNT",
        USERNAME=["jdoe", "jdoe@x.com"], EMAIL=["jdoe@x.com", "jdoe@x.com"])}, 1, ["USERACCOUNT"]),
    ("EC399", {"USERACCOUNT": frame("USERACCOUNT", FIRST_NAME=["Smith", "John"], LAST_NAME=["Smith", "Doe"])}, 1, ["USERACCOUNT"]),
    ("EC432", {"USERACCOUNT": frame("USERACCOUNT", STATUS=["X", "A"])}, 1, ["USERACCOUNT"]),
    ("EC443", {
        "USERACCOUNT": frame("USERACCOUNT", USER_ID=["p_missing", "p_ok"]),
        "PERPERSON": frame("PERPERSON", PERSON_ID=["p_ok"]),
     }, 1, ["USERACCOUNT"]),

    # POSITION ------------------------------------------------------------
    ("EC298", {"POSITION": frame("POSITION", CODE=[None, "P2"])}, 1, ["POSITION"]),
    ("EC299", {"POSITION": frame("POSITION", CODE=["dup", "dup", "uniq"])}, 2, ["POSITION"]),
    ("EC300", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=[None, "A"])}, 1, ["POSITION"]),
    ("EC301", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], CRITICALITY=[None, "high"])}, 1, ["POSITION"]),
    ("EC302", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], TARGET_FTE=[0.0, 1.0])}, 1, ["POSITION"]),
    ("EC303", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"],
        TARGET_FTE=[2.0, 1.0], MULTIPLE_INCUMBENTS=["false", "false"])}, 1, ["POSITION"]),
    ("EC304", {"POSITION": frame("POSITION", STANDARD_HOURS=[200.0, 40.0])}, 1, ["POSITION"]),
    ("EC305", {"POSITION": frame("POSITION",
        EFFECTIVE_START_DATE=["20200101", "20200101"], EFFECTIVE_END_DATE=["20190101", "20210101"])}, 1, ["POSITION"]),
    ("EC307", {
        "POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], BUSINESS_UNIT=["BU_BAD", "BU_OK"]),
        "FOBUSINESSUNIT": frame("FOBUSINESSUNIT", EXTERNAL_CODE=["BU_OK"], STATUS=["A"]),
     }, 1, ["POSITION"]),
    ("EC312", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"],
        VACANT=["true", "true"], EXTERNAL_NAME=[None, "Name"])}, 1, ["POSITION"]),
    ("EC313", {
        "POSITION": frame("POSITION", CODE=["P_BAD", "P_OK"], EFFECTIVE_STATUS=["A", "A"], VACANT=["false", "false"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", POSITION=["P_OK"], STATUS=["A"]),
     }, 1, ["POSITION"]),
    ("EC314", {"POSITION": frame("POSITION", CODE=["dup", "dup", "uniq"],
        EFFECTIVE_STATUS=["A", "A", "A"], MULTIPLE_INCUMBENTS=["false", "false", "false"])}, 2, ["POSITION"]),
    ("EC400", {"POSITION": frame("POSITION", CODE=["P_BAD", "P_OK"], COMPANY=["C_BAD", "C1"]),
        "EMPJOBHIST": frame("EMPJOBHIST", STATUS=["A", "A"], POSITION=["P_BAD", "P_OK"], COMPANY=["C1", "C1"])}, 1, ["EMPJOBHIST"]),
    ("EC412", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], COMPANY=[None, "C1"])}, 1, ["POSITION"]),
    ("EC413", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], DEPARTMENT=[None, "D1"])}, 1, ["POSITION"]),
    ("EC414", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], COST_CENTER=[None, "CC1"])}, 1, ["POSITION"]),
    ("EC415", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], BUSINESS_UNIT=[None, "BU1"])}, 1, ["POSITION"]),
    ("EC416", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], DIVISION=[None, "D1"])}, 1, ["POSITION"]),
    ("EC417", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], LOCATION=[None, "L1"])}, 1, ["POSITION"]),
    ("EC433", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], PAY_GRADE=[None, "PG1"])}, 1, ["POSITION"]),
    ("EC434", {"POSITION": frame("POSITION", EFFECTIVE_START_DATE=[None, "20200101"])}, 1, ["POSITION"]),
    ("EC435", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], EXTERNAL_NAME=[None, "Name"])}, 1, ["POSITION"]),
    ("EC439", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], VACANT=[None, "true"])}, 1, ["POSITION"]),
    ("EC440", {"POSITION": frame("POSITION", EFFECTIVE_STATUS=["A", "A"], MULTIPLE_INCUMBENTS=[None, "false"])}, 1, ["POSITION"]),

    # EMPJOBRELATIONSHIPS ---------------------------------------------------
    ("EC315", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", USERID=[None, "u2"])}, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC316", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", RELATIONSHIP_TYPE=[None, "HR_PARTNER"])}, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC317", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", START_DATE=[None, "20200101"])}, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC318", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", RELATED_USER_ID=[None, "u3"])}, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC319", {
        "EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", RELATED_USER_ID=["u_bad", "u_ok"]),
        "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u_ok"]),
     }, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC321", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS",
        USERID=["u1", "u1", "u2"], RELATIONSHIP_TYPE=["HR", "HR", "HR"],
        START_DATE=["20200101", "20200101", "20200101"])}, 2, ["EMPJOBRELATIONSHIPS"]),
    ("EC322", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS",
        START_DATE=["20200201", "20200101"], END_DATE=["20200101", "20200601"])}, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC323", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", USERID=["u1", "u1"], RELATED_USER_ID=["u1", "u2"])}, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC424", {
        "EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS", RELATED_USER_ID=["u_bad", "u_ok"]),
        "USERACCOUNT": frame("USERACCOUNT", USER_ID=["u_ok"]),
     }, 1, ["EMPJOBRELATIONSHIPS"]),
    ("EC425", {"EMPJOBRELATIONSHIPS": frame("EMPJOBRELATIONSHIPS",
        START_DATE=[(date.today() + timedelta(days=500)).strftime("%Y%m%d"),
                    (date.today() + timedelta(days=5)).strftime("%Y%m%d")])}, 1, ["EMPJOBRELATIONSHIPS"]),

    # FO reference tables ----------------------------------------------------
    ("EC324", {"FOBUSINESSUNIT": frame("FOBUSINESSUNIT", EXTERNAL_CODE=[None, "BU2"])}, 1, ["FOBUSINESSUNIT"]),
    ("EC325", {"FOBUSINESSUNIT": frame("FOBUSINESSUNIT", STATUS=[None, "A"])}, 1, ["FOBUSINESSUNIT"]),
    ("EC326", {"FOBUSINESSUNIT": frame("FOBUSINESSUNIT", EXTERNAL_CODE=["dup", "dup", "uniq"])}, 2, ["FOBUSINESSUNIT"]),
    ("EC327", {"FODIVISION": frame("FODIVISION", EXTERNAL_CODE=[None, "D2"])}, 1, ["FODIVISION"]),
    ("EC328", {"FODIVISION": frame("FODIVISION", STATUS=[None, "A"])}, 1, ["FODIVISION"]),
    ("EC329", {"FODIVISION": frame("FODIVISION", EXTERNAL_CODE=["dup", "dup", "uniq"])}, 2, ["FODIVISION"]),
    ("EC330", {"FODEPARTMENT": frame("FODEPARTMENT", EXTERNAL_CODE=[None, "DP2"])}, 1, ["FODEPARTMENT"]),
    ("EC331", {"FODEPARTMENT": frame("FODEPARTMENT", STATUS=[None, "A"])}, 1, ["FODEPARTMENT"]),
    ("EC333", {
        "FODEPARTMENT": frame("FODEPARTMENT", STATUS=["A", "A"], COST_CENTER=["CC_BAD", "CC_OK"]),
        "FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=["CC_OK"], STATUS=["A"]),
     }, 1, ["FODEPARTMENT"]),
    ("EC334", {"FOLOCATION": frame("FOLOCATION", EXTERNAL_CODE=[None, "L2"])}, 1, ["FOLOCATION"]),
    ("EC335", {"FOLOCATION": frame("FOLOCATION", STATUS=[None, "A"])}, 1, ["FOLOCATION"]),
    ("EC337", {"FOLOCATION": frame("FOLOCATION", STANDARD_HOURS=[200.0, 40.0])}, 1, ["FOLOCATION"]),
    ("EC338", {"FOJOBCODE": frame("FOJOBCODE", EXTERNAL_CODE=[None, "J2"])}, 1, ["FOJOBCODE"]),
    ("EC339", {"FOJOBCODE": frame("FOJOBCODE", STATUS=[None, "A"])}, 1, ["FOJOBCODE"]),
    ("EC341", {"FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=[None, "CC2"])}, 1, ["FOCOSTCENTER"]),
    ("EC342", {"FOCOSTCENTER": frame("FOCOSTCENTER", STATUS=[None, "A"])}, 1, ["FOCOSTCENTER"]),
    ("EC344", {
        "FOCOSTCENTER": frame("FOCOSTCENTER", STATUS=["A", "A"], LEGAL_ENTITY=["LE_BAD", "LE_OK"]),
        "FOCOMPANY": frame("FOCOMPANY", EXTERNAL_CODE=["LE_OK"], STATUS=["A"]),
     }, 1, ["FOCOSTCENTER"]),
    ("EC345", {"FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=[None, "ER2"])}, 1, ["FOEVENTREASON"]),
    ("EC346", {"FOEVENTREASON": frame("FOEVENTREASON", EVENT=[None, "hire"])}, 1, ["FOEVENTREASON"]),
    ("EC347", {"FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["dup", "dup", "uniq"])}, 2, ["FOEVENTREASON"]),
    ("EC348", {"FOCOMPANY": frame("FOCOMPANY", STATUS=[None, "A"])}, 1, ["FOCOMPANY"]),
    ("EC350", {"FOCOMPANY": frame("FOCOMPANY", CURRENCY=["usd", "USD"])}, 1, ["FOCOMPANY"]),
    ("EC351", {"FOCOMPANY": frame("FOCOMPANY", COUNTRY=["usa", "USA"])}, 1, ["FOCOMPANY"]),
    ("EC418", {"FOCOMPANY": frame("FOCOMPANY", EXTERNAL_CODE=[None, "LE2"])}, 1, ["FOCOMPANY"]),
    ("EC419", {"FOEVENTREASON": frame("FOEVENTREASON", STATUS=[None, "A"])}, 1, ["FOEVENTREASON"]),
    ("EC420", {"FOLOCATION": frame("FOLOCATION", STATUS=["A", "A"], TIMEZONE=[None, "UTC"])}, 1, ["FOLOCATION"]),
    ("EC421", {"FOJOBCODE": frame("FOJOBCODE", STATUS=["A", "A"], IS_FULLTIME=[None, "true"])}, 1, ["FOJOBCODE"]),
    ("EC422", {"FOJOBCODE": frame("FOJOBCODE", STATUS=["A", "A"], EMPLOYEE_CLASS=[None, "RG"])}, 1, ["FOJOBCODE"]),
    ("EC423", {"FOJOBCODE": frame("FOJOBCODE", STATUS=["A", "A"], REGULAR_TEMP=[None, "regular"])}, 1, ["FOJOBCODE"]),

    # PERADDRESS -------------------------------------------------------------
    ("EC352", {"PERADDRESS": frame("PERADDRESS", PERSON_ID=[None, "p2"])}, 1, ["PERADDRESS"]),
    ("EC353", {"PERADDRESS": frame("PERADDRESS", ADDRESS_LINE1=[None, "1 Main St"])}, 1, ["PERADDRESS"]),
    ("EC354", {"PERADDRESS": frame("PERADDRESS", CITY=[None, "Joburg"])}, 1, ["PERADDRESS"]),
    ("EC355", {"PERADDRESS": frame("PERADDRESS", COUNTRY=[None, "ZAF"])}, 1, ["PERADDRESS"]),
    ("EC356", {"PERADDRESS": frame("PERADDRESS",
        ADDRESS_TYPE=["home", "home"], ZIPCODE=[None, "2000"], COUNTRY=["ZAF", "ZAF"])}, 1, ["PERADDRESS"]),
    ("EC357", {"PERADDRESS": frame("PERADDRESS",
        PERSON_ID=["p1", "p1", "p2"], ADDRESS_TYPE=["home", "home", "home"],
        START_DATE=["20200101", "20200101", "20200101"])}, 2, ["PERADDRESS"]),
    ("EC358", {
        "PERADDRESS": frame("PERADDRESS", PERSON_ID=["p_bad", "p_ok"]),
        "PERINFO": frame("PERINFO", PERSON_ID=["p_ok"]),
     }, 1, ["PERADDRESS"]),
    ("EC426", {"PERADDRESS": frame("PERADDRESS", ADDRESS_TYPE=[None, "home"])}, 1, ["PERADDRESS"]),
    ("EC427", {"PERADDRESS": frame("PERADDRESS", COUNTRY=["USA", "USA"], STATE=[None, "NY"])}, 1, ["PERADDRESS"]),
]


def clean(tables, slice_tables):
    out = {}
    for t, df in tables.items():
        if t in slice_tables:
            out[t] = df.iloc[1:].reset_index(drop=True)
        else:
            out[t] = df
    return out


@pytest.mark.parametrize("rid,tables,expected,slice_tables", CASES, ids=[c[0] for c in CASES])
def test_fixture_flags_only_the_bad_record(rid, tables, expected, slice_tables):
    assert fire(rid, tables) == expected


@pytest.mark.parametrize("rid,tables,expected,slice_tables", CASES, ids=[c[0] for c in CASES])
def test_fixture_clean_rows_pass(rid, tables, expected, slice_tables):
    assert fire(rid, clean(tables, slice_tables)) == 0


def test_fixture_coverage():
    assert len({c[0] for c in CASES}) >= 60


def test_job_history_open_ended_gap_detected():
    tables = {"EMPJOBHIST": frame("EMPJOBHIST",
        USERID=["u1"], START_DATE=["20200101"], END_DATE=["20200601"])}
    assert fire("EC271", tables) == 1
    clean_tables = {"EMPJOBHIST": frame("EMPJOBHIST",
        USERID=["u1"], START_DATE=["20200101"], END_DATE=["99991231"])}
    assert fire("EC271", clean_tables) == 0


def test_job_history_continuous_gap_detected():
    tables = {"EMPJOBHIST": frame("EMPJOBHIST",
        USERID=["u1", "u1"], START_DATE=["20200101", "20200601"], END_DATE=["20200301", "99991231"])}
    assert fire("EC379", tables) == 1
    clean_tables = {"EMPJOBHIST": frame("EMPJOBHIST",
        USERID=["u1", "u1"], START_DATE=["20200101", "20200302"], END_DATE=["20200301", "99991231"])}
    assert fire("EC379", clean_tables) == 0


def test_position_validity_overlap_detected():
    tables = {"POSITION": frame("POSITION",
        CODE=["P1", "P1"], EFFECTIVE_START_DATE=["20200101", "20200201"],
        EFFECTIVE_END_DATE=["20200601", "20201231"])}
    assert fire("EC306", tables) == 1
    clean_tables = {"POSITION": frame("POSITION",
        CODE=["P1", "P1"], EFFECTIVE_START_DATE=["20200101", "20200602"],
        EFFECTIVE_END_DATE=["20200601", "20201231"])}
    assert fire("EC306", clean_tables) == 0
