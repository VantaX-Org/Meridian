"""SuccessFactors history: Job Info fills from every EmpJob record with the EmpEmployment columns joined as of
each record's date, multi-row entities keep their primary record, and history rows dated before a Foundation
Object's current record are not judged against it. Synthetic values only."""
import inspect

import pandas as pd
import yaml

from api.services.connectivity_manager import ConnectivityManager, _primary_first
from api.services.migration import workbook as wb
from checks.frames import TableFrames
from checks.runner import _with_targets, run_rule
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]}


def book(name, ids):
    return wb.Workbook(sheets=[wb.Sheet(name, "grid", [wb.Column(header=i, id=i) for i in ids])], picklists={})


def test_primary_first_keeps_order_otherwise():
    df = pd.DataFrame({"T.K": ["P1", "P1", "P2"], "T.V": ["a", "b", "c"], "T.IS_PRIMARY": ["false", "true", None]})
    assert _primary_first(df, "T.IS_PRIMARY").drop_duplicates("T.K")["T.V"].tolist() == ["b", "c"]
    assert _primary_first(df, "T.NOPE") is df


def test_connectivity_collapse_puts_primary_first():
    src = inspect.getsource(ConnectivityManager._extract_successfactors)
    assert src.index('_primary_first(out, f"{table}.IS_PRIMARY")') < src.index("drop_duplicates(subset=on)")


def test_side_join_takes_the_primary_email():
    f = TableFrames({
        "EMPEMPLOYMENT": pd.DataFrame({"EMPEMPLOYMENT.USERID": ["U1"], "EMPEMPLOYMENT.PERSON_ID": ["P1"]}),
        "PEREMAIL": pd.DataFrame({"PEREMAIL.PERSON_ID": ["P1", "P1"], "PEREMAIL.IS_PRIMARY": ["false", "true"],
                                  "PEREMAIL.EMAIL_ADDRESS": ["old@x.test", "main@x.test"]}),
    }, D)
    tabs, _ = wb.fill(book("Contingent Worker", ["userId", "emailAddress"]), f)
    assert tabs["Contingent Worker"]["emailAddress"].tolist() == ["main@x.test"]


def test_job_info_keeps_history_rows_and_the_employment_columns():
    emp = {"EMPEMPLOYMENT.USERID": ["U1", "U2"], "EMPEMPLOYMENT.PERSON_ID": ["P1", "P2"],
           "EMPEMPLOYMENT.START_DATE": ["2019-01-01", "2024-02-01"],
           "EMPEMPLOYMENT.COMPANY": ["C9", "C9"], "EMPEMPLOYMENT.JOB_TITLE": ["T9", "T9"]}
    hist = {"EMPJOBHIST.USERID": ["U1", "U1", "U2"], "EMPJOBHIST.START_DATE": ["2020-01-01", "2024-01-01", "2024-02-01"],
            "EMPJOBHIST.SEQ_NUMBER": ["1", "1", "1"], "EMPJOBHIST.COMPANY": ["C1", "C2", "C3"],
            "EMPJOBHIST.JOB_TITLE": ["T1", "T2", "T3"]}
    b = book("Job Info", ["user-id", "start-date", "seq-number", "company", "jobTitle", "person"])
    b.sheets[0].mapped = {"person": "EMPEMPLOYMENT.PERSON_ID"}  # an EmpEmployment-only column, mapped by hand
    _, only_emp = wb.fill(b, TableFrames({"EMPEMPLOYMENT": pd.DataFrame(emp)}, D))
    tabs, rep = wb.fill(b, TableFrames({"EMPEMPLOYMENT": pd.DataFrame(emp), "EMPJOBHIST": pd.DataFrame(hist)}, D))
    sheet = rep["sheets"][0]
    assert sheet["table"] == "EMPJOBHIST"
    assert sheet["matched"] >= only_emp["sheets"][0]["matched"] and not sheet["unmapped"]  # no column lost to history
    tab = tabs["Job Info"]
    assert len(tab) == 3 and tab["jobTitle"].tolist() == ["T1", "T2", "T3"]  # history values, not the current one
    assert tab["person"].tolist() == ["P1", "P1", "P2"]  # EmpEmployment joined as of each record's date


def _ec250(hist_dates):
    hist = pd.DataFrame({"EMPJOBHIST.USERID": ["U1"] * len(hist_dates), "EMPJOBHIST.START_DATE": hist_dates,
                         "EMPJOBHIST.SEQ_NUMBER": ["1"] * len(hist_dates), "EMPJOBHIST.STATUS": ["A"] * len(hist_dates),
                         "EMPJOBHIST.BUSINESS_UNIT": ["BU1"] * (len(hist_dates) - 1) + ["BU9"]})
    fo = pd.DataFrame({"FOBUSINESSUNIT.EXTERNAL_CODE": ["BU1"], "FOBUSINESSUNIT.STATUS": ["A"],
                       "FOBUSINESSUNIT.EFFECTIVE_START_DATE": ["2022-01-01"]})
    return TableFrames({"EMPJOBHIST": hist, "FOBUSINESSUNIT": fo}, D, module="employee_central")


def test_target_since_is_resolved_per_key():
    rule = _with_targets(dict(RULES["EC250"]), _ec250(["2023-01-01", "2023-06-01"]))
    assert str(rule["_target_since"]["BU1"].date()) == "2022-01-01"


def test_history_before_the_fo_start_is_not_judged_but_unknown_keys_still_fail():
    # 2020 row predates the FO's current record: out of scope; 2023 row matches; the last row's BU9 is unknown
    _, res = run_rule(dict(RULES["EC250"]), _ec250(["2020-01-01", "2023-01-01", "2023-06-01"]), {})
    assert res is not None and not res.error, res and res.error
    assert (res.affected_count, res.total_count) == (1, 2)


def test_fo_rules_with_a_start_date_are_as_of():
    tables = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))["tables"]
    for rid in ("EC250", "EC251", "EC252", "EC255", "EC256"):
        r = RULES[rid]
        assert r["as_of_field"] == "EMPJOBHIST.START_DATE"
        assert r["target_since"] in tables[r["target_table"]]["fields"]
    assert not any(RULES[rid].get("target_since") for rid in ("EC253", "EC254", "EC257"))
