"""EC694-EC708 (field-coverage audit) and the no-strftime guard on every rule pack."""
import glob
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 694 <= int(r["id"][2:]) <= 708]
DICT = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))["tables"]
T = pd.Timestamp


def fire(rule_id, table, cols):
    frames = TableFrames({table: pd.DataFrame(cols)}, S4, module="employee_central")
    _, res = run_rule(dict(BY_ID[rule_id]), frames, {})
    assert res is not None and not res.error, (rule_id, res and res.error)
    return res.affected_count


def test_no_rule_pack_uses_strftime():
    # .dt.strftime raises on all-NaT columns and on mixed dtypes; rules build date parts
    # from .dt.year/.dt.month/.dt.day instead.
    bad = [f for f in glob.glob("checks/rules/**/*.yaml", recursive=True) if ".dt.strftime" in open(f).read()]
    assert not bad, bad


def test_pack_shape():
    assert len(NEW) == 15
    for r in NEW:
        for tok in re.findall(r"`(\w+)\.(\w+)`", r.get("fail_when", "")) + [tuple(r["field"].split("."))]:
            assert tok[1] in DICT[tok[0]]["fields"], (r["id"], tok)


def test_names_missing():
    assert fire("EC694", "FODEPARTMENT", {"FODEPARTMENT.EXTERNAL_CODE": ["D1", "D2"], "FODEPARTMENT.NAME": [None, "Sales"]}) == 1
    assert fire("EC695", "FOCOMPANY", {"FOCOMPANY.EXTERNAL_CODE": ["C1", "C2"], "FOCOMPANY.NAME": ["", "Acme"]}) == 1


def test_self_parent():
    assert fire("EC696", "POSITION", {"POSITION.CODE": ["P1", "P2", "P3"], "POSITION.PARENT_POSITION": ["P1", "P1", None]}) == 1
    assert fire("EC697", "FODEPARTMENT", {"FODEPARTMENT.EXTERNAL_CODE": ["D1", "D2"], "FODEPARTMENT.PARENT_DEPARTMENT": ["D1", "D1"]}) == 1


def test_date_order():
    lo, hi = T("2024-01-01"), T("2024-06-01")
    pairs = {"EC698": ("HIRE_DATE", "TERMINATION_DATE"),
             "EC699": ("LEAVE_OF_ABSENCE_START_DATE", "LEAVE_OF_ABSENCE_RETURN_DATE"),
             "EC706": ("START_DATE", "SALARY_END_DATE"),
             "EC707": ("START_DATE", "BENEFITS_END_DATE"),
             "EC708": ("START_DATE", "STOCK_END_DATE")}
    for rid, (start, end) in pairs.items():
        cols = {"EMPEMPLOYMENT.USERID": ["ok", "bad", "open"],
                f"EMPEMPLOYMENT.{start}": [lo, hi, lo], f"EMPEMPLOYMENT.{end}": [hi, lo, None]}
        assert fire(rid, "EMPEMPLOYMENT", cols) == 1, rid
    assert fire("EC701", "PERINFO", {"PERINFO.PERSON_ID": ["a", "b"],
                                     "PERINFO.CERTIFICATE_START_DATE": [lo, hi],
                                     "PERINFO.CERTIFICATE_END_DATE": [hi, lo]}) == 1


def test_shift_code_and_work_permit():
    assert fire("EC700", "EMPEMPLOYMENT", {"EMPEMPLOYMENT.USERID": ["a", "b", "c"],
                                           "EMPEMPLOYMENT.IS_SHIFT_EMPLOYEE": ["true", "true", "false"],
                                           "EMPEMPLOYMENT.SHIFT_CODE": [None, "S1", None]}) == 1
    past, future = T.now() - pd.Timedelta(days=30), T.now() + pd.Timedelta(days=30)
    assert fire("EC705", "EMPEMPLOYMENT", {"EMPEMPLOYMENT.USERID": ["a", "b", "c"],
                                           "EMPEMPLOYMENT.WORK_PERMIT_EXPIRY": [past, past, future],
                                           "EMPEMPLOYMENT.STATUS": ["A", "T", "A"]}) == 1


def test_third_nationality_and_negative_amounts():
    assert fire("EC702", "PERINFO", {"PERINFO.PERSON_ID": ["a", "b", "c"],
                                     "PERINFO.NATIONALITY": ["DEU", "DEU", "DEU"],
                                     "PERINFO.SECOND_NATIONALITY": ["FRA", "FRA", None],
                                     "PERINFO.THIRD_NATIONALITY": ["FRA", "ITA", None]}) == 1
    for rid, f in (("EC703", "PENSIONABLE_SALARY"), ("EC704", "BENEFITS_RATE")):
        assert fire(rid, "COMPINFO", {"COMPINFO.USERID": ["a", "b"], f"COMPINFO.{f}": [-1.0, 100.0]}) == 1, rid
