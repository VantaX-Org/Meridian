"""A sheet spanning several entities fills its other columns by joining on the person, never across dependants."""
import pandas as pd

from api.services.migration import workbook as wb
from checks.frames import TableFrames
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def book(name, ids):
    cols = [wb.Column(header=i, id=i) for i in ids]
    return wb.Workbook(sheets=[wb.Sheet(name, "grid", cols)], picklists={})


def frames():
    return TableFrames({
        "EMPEMPLOYMENT": pd.DataFrame({
            "EMPEMPLOYMENT.USERID": ["U1", "U2"], "EMPEMPLOYMENT.PERSON_ID": ["P1", "P2"],
            "EMPEMPLOYMENT.START_DATE": ["2024-01-01", "2024-02-01"],
        }),
        "PERINFO": pd.DataFrame({"PERINFO.PERSON_ID": ["P2", "P1"], "PERINFO.FIRSTNAME": ["Bo", "Al"]}),
        "PEREMAIL": pd.DataFrame({
            "PEREMAIL.PERSON_ID": ["P1", "P1", "P2"], "PEREMAIL.EMAIL_TYPE": ["B", "P", "B"],
            "PEREMAIL.EMAIL_ADDRESS": ["a@x.test", "a2@x.test", "b@x.test"],
        }),
        "DEPENDENT": pd.DataFrame({
            "DEPENDENT.PERSON_ID": ["P1"], "DEPENDENT.RELATED_PERSON_ID": ["R1"],
            "DEPENDENT.START_DATE": ["2024-01-01"], "DEPENDENT.FIRST_NAME": ["Kid"],
        }),
    }, D)


def test_contingent_worker_takes_name_and_email_from_the_person():
    tabs, report = wb.fill(book("Contingent Worker", ["userId", "startDate", "firstName", "emailAddress"]), frames())
    tab = tabs["Contingent Worker"]
    rows = {r["userId"]: r for r in tab.to_dict("records") if r["userId"] in ("U1", "U2")}
    assert (rows["U1"]["firstName"], rows["U1"]["emailAddress"]) == ("Al", "a@x.test")  # first e-mail per person
    assert (rows["U2"]["firstName"], rows["U2"]["emailAddress"]) == ("Bo", "b@x.test")
    assert next(s for s in report["sheets"])["table"] == "EMPEMPLOYMENT"


def test_dependants_sheet_never_takes_the_employee_name():
    tabs, report = wb.fill(book("Dependents", ["personIdExternal", "relatedPersonIdExternal", "firstName"]), frames())
    row = next(s for s in report["sheets"])
    assert row["table"] == "DEPENDENT"
    assert "Al" not in tabs["Dependents"]["firstName"].tolist()


def test_new_foundation_fields_resolve():
    assert D.field("FOPAYGRADE", "STATUS").qualified == "FOPAYGRADE.STATUS"
    assert D.field("FOFREQUENCY", "ANNUALIZATION_FACTOR").qualified == "FOFREQUENCY.ANNUALIZATION_FACTOR"


def test_added_key_follows_the_sheet_spelling():
    """A definition sheet written in SuccessFactors import spelling (first-name) gets its missing person key
    as person-id-external, the header the import expects, not the OData property name."""
    sheet = wb.Sheet("Personal Information", "definition", [wb.Column(header=i, id=i) for i in ("first-name", "last-name")])
    _, report = wb.fill(wb.Workbook(sheets=[sheet], picklists={}), frames())
    assert report["sheets"][0]["added_keys"] == ["person-id-external"]


def test_job_info_sheet_takes_every_history_record():
    """A sheet with the job history keys fills from EMPJOBHIST, one row per effective-dated record."""
    f = frames()
    f.frames["EMPJOBHIST"] = pd.DataFrame({
        "EMPJOBHIST.USERID": ["U1", "U1", "U2"], "EMPJOBHIST.START_DATE": ["2020-01-01", "2024-01-01", "2024-02-01"],
        "EMPJOBHIST.SEQ_NUMBER": ["1", "1", "1"],
    })
    tabs, report = wb.fill(book("Job Info", ["user-id", "start-date", "seq-number"]), f)
    assert next(s for s in report["sheets"])["table"] == "EMPJOBHIST"
    assert len(tabs["Job Info"]) == 3
