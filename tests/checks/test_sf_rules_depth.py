"""SuccessFactors depth rules on a small dirty / clean extract: each dirty record
fails exactly the rule written for it, and the clean records fail none of them."""

import pandas as pd

from checks.frames import TableFrames
from checks.runner import run_checks
from checks.types.hierarchy_check import HierarchyCheck

FUTURE = (pd.Timestamp.today() + pd.Timedelta(days=800)).strftime("%Y%m%d")


def _emp(uid, person, mgr="NO_MANAGER", status="A", start="20200101", end="", pos="P1", company="C1", dept="D1",
         job="J1", cc="CC1"):
    return {"EMPEMPLOYMENT.USERID": uid, "EMPEMPLOYMENT.PERSON_ID": person, "EMPEMPLOYMENT.MANAGER_ID": mgr,
            "EMPEMPLOYMENT.STATUS": status, "EMPEMPLOYMENT.START_DATE": start, "EMPEMPLOYMENT.END_DATE": end,
            "EMPEMPLOYMENT.POSITION": pos, "EMPEMPLOYMENT.COMPANY": company, "EMPEMPLOYMENT.DEPARTMENT": dept,
            "EMPEMPLOYMENT.JOB_CODE": job, "EMPEMPLOYMENT.COST_CENTER": cc}


def _per(person, first, last, dob="19850101", nid="", country=""):
    return {"PERINFO.PERSON_ID": person, "PERINFO.FIRSTNAME": first, "PERINFO.LASTNAME": last,
            "PERINFO.DATE_OF_BIRTH": dob, "PERINFO.NATIONAL_ID": nid, "PERINFO.NATIONAL_ID_COUNTRY": country}


def _frames() -> TableFrames:
    emp = pd.DataFrame([
        _emp("U1", "P01"),                                   # clean, top of the hierarchy
        _emp("U2", "P02", mgr="U1"),                         # clean
        _emp("L1", "P03", mgr="L2"), _emp("L2", "P04", mgr="L1"),  # manager loop (EC076)
        _emp("U3", "P05", mgr="T1"),                         # manager terminated (EC077)
        _emp("T1", "P06", status="T", start="20100101", end="20150101"),
        _emp("U4", "P07", start=FUTURE),                     # hire too far ahead (EC078)
        _emp("U5", "P08", end="20200601"),                   # ended but active (EC081)
        _emp("U6", "P09", company="C2"),                     # company differs from position (EC096)
        _emp("U7", "P10", pos="PX"),                         # position inactive (EC101)
    ])
    per = pd.DataFrame([
        _per("P01", "Ann", "Lee", nid="8001015009087", country="ZAF"),  # valid ZA ID
        _per("P02", "Bob", "Ray", nid="123-45-6789", country="USA"),
        _per("P03", "Cat", "Kim", nid="8001015009088", country="ZAF"),  # bad check digit (EC089)
        _per("P04", "Dan", "Fox", nid="666-12-3456", country="USA"),    # invalid SSN area (EC087)
        _per("P05", "Eve", "Johnson", dob="19900505"),
        _per("P06", "Eve", "Jonson", dob="19900505"),        # near-duplicate (EC084)
        _per("P07", "Gus", "Hill", dob="20200101"),          # under 15 at hire and today (EC079, EC080)
        _per("P08", "Hal", "Orr"), _per("P09", "Ivy", "Pak"), _per("P10", "Jon", "Qi"),
    ])
    pos = pd.DataFrame([
        {"POSITION.CODE": "P1", "POSITION.COMPANY": "C1", "POSITION.DEPARTMENT": "D1", "POSITION.JOB_CODE": "J1",
         "POSITION.COST_CENTER": "CC1", "POSITION.VACANT": "false", "POSITION.EFFECTIVE_STATUS": "A"},
        {"POSITION.CODE": "PX", "POSITION.COMPANY": "C1", "POSITION.DEPARTMENT": "D1", "POSITION.JOB_CODE": "J1",
         "POSITION.COST_CENTER": "CC1", "POSITION.VACANT": "false", "POSITION.EFFECTIVE_STATUS": "I"},
    ])
    co = pd.DataFrame([{"FOCOMPANY.EXTERNAL_CODE": c, "FOCOMPANY.COUNTRY": "ZAF", "FOCOMPANY.CURRENCY": "ZAR",
                        "FOCOMPANY.STATUS": "A"} for c in ("C1", "C2")])
    dept = pd.DataFrame([{"FODEPARTMENT.EXTERNAL_CODE": "D1", "FODEPARTMENT.COST_CENTER": "CC1",
                          "FODEPARTMENT.STATUS": "A"}])
    return TableFrames({"EMPEMPLOYMENT": emp, "PERINFO": per, "POSITION": pos, "FOCOMPANY": co,
                        "FODEPARTMENT": dept}, module="employee_central")


def test_each_dirty_record_fails_its_rule_and_clean_records_pass():
    by_id = {r.check_id: r for r in run_checks("employee_central", _frames(), "t")}
    expected = {"EC076": 2, "EC077": 1, "EC078": 1, "EC079": 1, "EC080": 1, "EC081": 1, "EC084": 2, "EC087": 1, "EC089": 1,
                "EC096": 1, "EC101": 1}
    got = {k: by_id[k].affected_count for k in expected}
    assert got == expected
    for clean in ("EC082", "EC083", "EC088", "EC097", "EC098", "EC099", "EC100", "EC102", "EC103", "EC104"):
        assert by_id[clean].affected_count == 0, clean


def test_hierarchy_check_flags_every_record_on_a_loop_only():
    df = pd.DataFrame({"E.ID": ["A", "B", "C", "D", "S", "X"], "E.MGR": ["B", "A", "A", "", "S", "OUTSIDE"]})
    ev = HierarchyCheck({"id": "H", "field": "E.MGR", "id_field": "E.ID"}).evaluate(df)
    assert list(ev.failing) == [True, True, False, False, True, False]
    assert list(ev.population) == [True, True, True, False, True, True]
