"""The target workbook drives the export: its columns, its rules, and only values the run really holds."""

import io
import zipfile

import pandas as pd
import pytest
from openpyxl import Workbook as Book

from api.services.migration import workbook as wb
from checks.frames import ParquetTable, TableFrames
from sap.ddic import get_dictionary

HEAD = ["", "", "System Field Id", "SF Label", "Type", "Max Length", "Visibility", "Mandatory", "Picklist"]


def definition(book, name, rows):
    ws = book.create_sheet(name)
    ws.append(["Title"]), ws.append([]), ws.append([]), ws.append(HEAD)
    ws.append(["HRIS SECTION: personal"])
    for r in rows:
        ws.append(["", "", *r])


def sample() -> bytes:
    book = Book()
    book.remove(book.active)
    definition(book, "Personal Info", [
        ("first-name", "First Name", "STRING", 5, "Edit", "Yes", ""),
        ("gender", "Gender", "PICKLIST", 0, "Edit", "No", "Picklist: GENDER"),
        ("second-title", "Second Title", "STRING", 0, "Edit", "Yes", ""),
        ("hidden-one", "Hidden", "STRING", 0, "None", "No", ""),
        ("note", "A note under the fields", "National ID", "", "", "", ""),
    ])
    definition(book, "Job Info", [("start-date", "Start Date", "DATE", 0, "Edit", "Yes", "")])
    definition(book, "Legal Entity", [("externalCode", "Code", "STRING", 4, "Edit", "Yes", "")])
    grid = book.create_sheet("Legal Entity Values")
    grid.append(["effectiveStartDate", "externalCode", "name.en_US", "effectiveStatus"])
    grid.append(["Start Date", "Code", "Name", "Status"])
    pay = book.create_sheet("Pay Component Values (US)")
    pay.append(["externalCode", "name"])
    lists = book.create_sheet("Picklists")
    lists.append(["id", "effectiveStartDate", "values.externalCode"])
    lists.append(["Id", "Start", "Code"])
    lists.append(["gender", "", "F"])
    lists.append(["", "", "M"])
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def frames() -> TableFrames:
    return TableFrames({
        "PERINFO": pd.DataFrame({
            "PERINFO.PERSON_ID": ["P1", "P2", "P3", "P4"],
            "PERINFO.FIRSTNAME": ["Ann", "Bartholomew", "", "Cy"],
            "PERINFO.GENDER": ["F", "M", "M", "X"],
        }),
        "FOCOMPANY": pd.DataFrame({"FOCOMPANY.EXTERNAL_CODE": ["C1"], "FOCOMPANY.STATUS": ["A"]}),
        "EMPEMPLOYMENT": pd.DataFrame({"EMPEMPLOYMENT.USERID": ["U1"], "EMPEMPLOYMENT.START_DATE": ["2020-01-01"]}),
    }, get_dictionary("s4hana"))


def sheet(book, name):
    return next(s for s in book.sheets if s.name == name)


def test_reads_definitions_grids_and_picklists():
    book = wb.parse_workbook(sample())
    ids = [c.id for c in sheet(book, "Personal Info").columns]
    assert ids == ["first-name", "gender", "second-title"]  # the hidden field and the note row are out
    assert sheet(book, "Personal Info").columns[1].picklist == "GENDER"
    assert book.picklists["gender"] == {"F", "M"}
    # the grid is the load format, so it replaces its definition and takes the rules
    assert [s.name for s in book.sheets].count("Legal Entity") == 0
    code = sheet(book, "Legal Entity Values").columns[1]
    assert (code.mandatory, code.max_length) == (True, 4)


def test_fills_workbook_columns_and_holds_back_only_rule_breakers():
    tabs, report = wb.fill(wb.parse_workbook(sample()), frames())
    tab = tabs["Personal Info"]
    assert list(tab.columns) == ["personIdExternal", "first-name", "gender", "second-title"]
    assert tab.iloc[0]["first-name"] == "First Name"  # label row, then data
    assert tab["personIdExternal"].tolist()[1:] == ["P1"]
    row = next(s for s in report["sheets"] if s["name"] == "Personal Info")
    assert (row["rows"], row["ready"], row["held"]) == (4, 1, 3)
    assert row["added_keys"] == ["personIdExternal"]
    assert report["reasons"] == {"too_long": 1, "mandatory": 1, "not_in_picklist": 1}
    assert {"id": "second-title", "label": "Second Title", "mandatory": True} in row["unmapped"]
    assert {h["record"] for h in report["held"]} == {"PERSON_ID=P2", "PERSON_ID=P3", "PERSON_ID=P4"}
    assert all("value" not in h for h in report["held"])  # personal data stays out of the report


def test_a_table_held_compressed_fills_the_same_as_a_decoded_one():
    plain = frames()
    lazy = TableFrames({t: ParquetTable(df.to_parquet()) for t, df in plain.frames.items()}, plain.dictionary)
    book = wb.parse_workbook(sample())
    tabs, report = wb.fill(book, lazy)
    want, want_report = wb.fill(book, frames())
    assert report == want_report
    assert all(tabs[name].equals(want[name]) for name in want)


def test_grid_keeps_its_exact_headers_and_leaves_unknown_columns_empty():
    tabs, _ = wb.fill(wb.parse_workbook(sample()), frames())
    tab = tabs["Legal Entity Values"]
    assert list(tab.columns) == ["effectiveStartDate", "externalCode", "name.en_US", "effectiveStatus"]
    assert tab.iloc[0].tolist() == ["Start Date", "Code", "Name", "Status"]  # the grid's own label row stays
    assert tab["externalCode"].tolist() == ["Code", "C1"] and tab["effectiveStatus"].tolist() == ["Status", "A"]
    assert tab["name.en_US"].tolist()[1:] == [None]


def test_a_first_data_row_is_not_taken_for_a_label_row():
    assert wb._labels(("a", "b"), [("01/01/1900", "Head Office")]) == {}
    assert wb._labels(("a", "b", "c"), [("Name", None, None)]) == {}
    assert wb._labels(("a", "b"), [("APAC", "12/31/9999")]) == {}
    assert wb._labels(("a", "b"), [("Name", "Country Code (ISO 3166)")])  # a digit later in a label is still a label


def test_job_start_date_never_takes_the_employment_start_date():
    tabs, _ = wb.fill(wb.parse_workbook(sample()), frames())
    assert "Job Info" not in tabs


def test_pay_component_setup_grid_is_not_filled_from_employee_pay():
    book = wb.parse_workbook(sample())
    assert wb._candidates(sheet(book, "Pay Component Values (US)"), get_dictionary("s4hana")) == {}


@pytest.mark.parametrize("data", [b"not a workbook", b""])
def test_rejects_a_file_that_is_not_a_workbook(data):
    with pytest.raises(wb.WorkbookError):
        wb.parse_workbook(data)


def test_rejects_a_zip_with_no_workbook_inside():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("a.txt", "x")
    with pytest.raises(wb.WorkbookError):
        wb.parse_workbook(out.getvalue())


def test_rejects_a_zip_bomb(monkeypatch):
    monkeypatch.setattr(wb, "MAX_UNPACKED_BYTES", 10)
    with pytest.raises(wb.WorkbookError, match="too large"):
        wb.parse_workbook(sample())


def test_rejects_a_workbook_with_no_fields():
    out = io.BytesIO()
    Book().save(out)
    with pytest.raises(wb.WorkbookError, match="No field"):
        wb.parse_workbook(out.getvalue())
