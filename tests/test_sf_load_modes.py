"""SuccessFactors full and incremental loads, and the generated templates. Synthetic data only."""
from datetime import date

import pandas as pd
import pytest

from api.services.migration import workbook as wb
from api.services.migration.export import to_xlsx
from checks.frames import TableFrames
from checks.runner import module_rules
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
JOB = "EmpJob Values (EMPJOBHIST)"


def _book():
    tabs = wb.blank_template(D, module_rules("employee_central"), {})
    return wb.parse_workbook(to_xlsx({JOB: tabs[JOB]}, sanitize_formulas=True), "ec.xlsx")


def _frames():  # two people, history out of order; u2 is terminated
    return TableFrames({"EMPJOBHIST": pd.DataFrame({
        "EMPJOBHIST.USERID": ["u2", "u1", "u1", "u2", "u1"],
        "EMPJOBHIST.START_DATE": ["2024-05-01", "2023-01-01", "2021-03-01", "2020-01-01", "2023-01-01"],
        "EMPJOBHIST.SEQ_NUMBER": ["1", "2", "1", "1", "1"],
        "EMPJOBHIST.STATUS": ["T", "A", "A", "A", "A"],
        "EMPJOBHIST.EVENT": ["26", "5", "H", "H", ""],
    })}, D)


def _rows(tabs, report):
    sheet = next(r for r in report["sheets"] if r["table"] == "EMPJOBHIST")
    df = tabs[JOB]
    # The template carries a label row under the field ids once most columns are described; records start below it.
    return sheet, (df.iloc[1:].reset_index(drop=True) if df.iloc[0].tolist()[1:2] == ["Record effective start"] else df)


def test_full_load_keeps_every_history_row_in_order_with_inactive_people():
    tabs, report = wb.fill(_book(), _frames())
    sheet, df = _rows(tabs, report)
    assert sheet["rows"] == 5 and sheet["people"] == 2
    assert df["userId"].tolist() == ["u1", "u1", "u1", "u2", "u2"]
    assert df["startDate"].astype(str).tolist() == ["2021-03-01", "2023-01-01", "2023-01-01", "2020-01-01", "2024-05-01"]
    assert df["seqNumber"].astype(str).tolist() == ["1", "1", "2", "1", "1"]
    assert report["summary"]["load_mode"] == "full" and report["purge_type"] == "Full Purge"
    assert "T" in df["emplStatus"].tolist()  # the terminated person stays in a full load


def test_full_load_reports_missing_mandatory_values():
    book = _book()
    for s in book.sheets:
        for c in s.columns:
            c.mandatory = c.id in {"event", "eventReason"}  # one blank event; no event reason in the run
    tabs, report = wb.fill(book, _frames())
    sheet, _ = _rows(tabs, report)
    assert sheet["mandatory_missing"] == {"event": 1, "eventReason": 5}
    assert report["summary"]["mandatory_missing"] == 6


def test_incremental_load_keeps_rows_since_the_date():
    tabs, report = wb.fill(_book(), _frames(), load_mode="incremental", since=date(2023, 1, 1))
    sheet, df = _rows(tabs, report)
    assert sheet["rows"] == 3 and sheet["since_field"] == "EMPJOBHIST.START_DATE"
    assert report["purge_type"] == "Incremental Load" and report["summary"]["since"] == "2023-01-01"


def test_incremental_load_needs_a_since_date_and_a_known_mode():
    with pytest.raises(ValueError):
        wb.fill(_book(), _frames(), load_mode="incremental")
    with pytest.raises(ValueError):
        wb.fill(_book(), _frames(), load_mode="delta")


def test_instructions_name_the_purge_type():
    df = wb.instructions("incremental", date(2024, 1, 1))
    text = " ".join(df.astype(str).values.ravel())
    assert "Incremental Load" in text and "2024-01-01" in text
    assert "Full Purge" in " ".join(wb.instructions().astype(str).values.ravel())


def test_generated_templates_cover_every_entity_and_parse_back():
    tabs = wb.sf_load_templates(D, {})
    assert list(tabs)[0] == wb.INSTRUCTIONS_TAB
    assert any(n.startswith("EmpGlobalAssignment") for n in tabs)
    cover = " ".join(tabs[wb.INSTRUCTIONS_TAB].astype(str).values.ravel())
    assert wb.GENERATED_NOTE in cover.lower()
    assert all(len(n) <= 31 for n in tabs)
    cov = wb.coverage(wb.parse_workbook(to_xlsx(tabs, sanitize_formulas=True), "all.xlsx"), D)
    unmatched = [s for s in cov["sheets"] if s["unmapped"]]
    assert cov["matched"] >= cov["columns"] - 6
    assert all("DEPENDENT" in s["name"] for s in unmatched)
