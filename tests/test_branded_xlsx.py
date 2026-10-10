"""Tests for api.services.branded_xlsx — see ui-brand-exports-addendum.md T7."""

from datetime import datetime, timezone

import openpyxl
import pytest

from api.services.branded_xlsx import (
    ColumnSpec,
    SheetSpec,
    build_workbook,
    guard_formula_cell,
    guard_sap_reimport_cell,
    xlsx_filename,
)


def _load(data: bytes) -> openpyxl.Workbook:
    import io

    return openpyxl.load_workbook(io.BytesIO(data))


def _basic_sheet(rows=None) -> SheetSpec:
    return SheetSpec(
        title="Findings",
        columns=[
            ColumnSpec(key="check_id", header="Check ID", kind="mono"),
            ColumnSpec(key="affected", header="Affected", kind="int"),
            ColumnSpec(key="pass_rate", header="Pass rate", kind="pct"),
            ColumnSpec(key="note", header="Note", kind="text"),
        ],
        rows=rows if rows is not None else [
            {"check_id": "BP-001", "affected": 12, "pass_rate": 87.5, "note": "ok"},
        ],
    )


def test_cover_sheet_first_and_active_with_metadata():
    wb = _load(
        build_workbook(
            tenant_name="Acme Corp",
            run_label="Nightly run",
            run_id="abc-123",
            title="Findings export",
            sheets=[_basic_sheet()],
        )
    )
    assert wb.sheetnames[0] == "Cover"
    assert wb.active.title == "Cover"
    ws = wb["Cover"]
    text_cells = " ".join(str(c.value) for row in ws.iter_rows() for c in row if c.value)
    assert "Meridian" in text_cells
    assert "Findings export" in text_cells
    assert "Acme Corp" in text_cells
    assert "Nightly run" in text_cells
    assert "abc-123" in text_cells
    assert "SAST" in text_cells


def test_data_sheet_freeze_panes_and_autofilter():
    wb = _load(build_workbook(tenant_name="T", run_label="R", run_id="1", title="X", sheets=[_basic_sheet()]))
    ws = wb["Findings"]
    assert ws.freeze_panes == "A2"
    assert ws.auto_filter.ref is not None


def test_header_fill_is_brand_accent():
    wb = _load(build_workbook(tenant_name="T", run_label="R", run_id="1", title="X", sheets=[_basic_sheet()]))
    ws = wb["Findings"]
    header_cell = ws.cell(row=1, column=1)
    assert header_cell.fill.fgColor.rgb in ("002D3A8C", "2D3A8C", "00000000FF2D3A8C") or "2D3A8C" in str(
        header_cell.fill.fgColor.rgb
    )


def test_number_formats_per_kind():
    wb = _load(build_workbook(tenant_name="T", run_label="R", run_id="1", title="X", sheets=[_basic_sheet()]))
    ws = wb["Findings"]
    # row 2: Check ID (mono), Affected (int), Pass rate (pct), Note (text)
    assert ws.cell(row=2, column=2).number_format == "#,##0"
    assert ws.cell(row=2, column=3).number_format == "0.0%"


def test_formula_injection_guard_on_text_column():
    guarded = guard_formula_cell("=1+1")
    assert guarded == "'=1+1"
    wb = _load(
        build_workbook(
            tenant_name="T",
            run_label="R",
            run_id="1",
            title="X",
            sheets=[_basic_sheet(rows=[{"check_id": "BP-001", "affected": 1, "pass_rate": 1, "note": "=1+1"}])],
        )
    )
    ws = wb["Findings"]
    assert ws.cell(row=2, column=4).value == "'=1+1"


def test_cover_sheet_note_has_no_mid_string_apostrophe():
    """N5: a sheet note starting with '=' must not leave a literal apostrophe
    in the middle of the cover's "Sheets" sentence — only the cell's actual
    leading character matters for the formula guard."""
    wb = _load(
        build_workbook(
            tenant_name="T",
            run_label="R",
            run_id="1",
            title="X",
            sheets=[SheetSpec(title="Findings", columns=[], rows=[], note="=1+1 rows truncated")],
        )
    )
    ws = wb["Cover"]
    text_cells = [str(c.value) for row in ws.iter_rows() for c in row if c.value]
    sheet_row = next(t for t in text_cells if "Findings" in t and "row" in t)
    assert sheet_row == "Findings — 0 rows. =1+1 rows truncated"
    assert "'" not in sheet_row


def test_sap_reimport_guard_leaves_negative_values_untouched():
    """N3: a SAP-reimport file (kind='raw') must not prefix a leading
    apostrophe onto a negative quantity or a '-'-prefixed SAP code, or the
    reimport receives corrupted data. It must still guard '=' / '@' / tab /
    CR, which do evaluate as formulas."""
    assert guard_sap_reimport_cell("-5") == "-5"
    assert guard_sap_reimport_cell("-X100") == "-X100"
    assert guard_sap_reimport_cell("+5") == "+5"
    assert guard_sap_reimport_cell("=1+1") == "'=1+1"
    assert guard_sap_reimport_cell("@SUM(A1)") == "'@SUM(A1)"
    assert guard_sap_reimport_cell("\tx") == "'\tx"

    wb = _load(
        build_workbook(
            tenant_name="T",
            run_label="R",
            run_id="1",
            title="X",
            sheets=[
                SheetSpec(
                    title="Cockpit",
                    columns=[ColumnSpec(key="qty", header="Qty", kind="raw")],
                    rows=[{"qty": "-5"}],
                )
            ],
        )
    )
    ws = wb["Cockpit"]
    assert ws.cell(row=2, column=1).value == "-5"


def test_row_cap_truncates_and_notes_on_cover():
    rows = [{"check_id": f"BP-{i}", "affected": i, "pass_rate": 1, "note": "x"} for i in range(100_001)]
    wb = _load(
        build_workbook(
            tenant_name="T", run_label="R", run_id="1", title="X", sheets=[_basic_sheet(rows=rows)]
        )
    )
    ws = wb["Findings"]
    assert ws.max_row == 100_001  # header + 100,000 data rows
    cover_text = " ".join(str(c.value) for row in wb["Cover"].iter_rows() for c in row if c.value)
    assert "Truncated" in cover_text


def test_sheet_titles_truncated_to_31_chars_and_unique():
    long_title = "This Sheet Title Is Way Too Long For Excel"
    wb = _load(
        build_workbook(
            tenant_name="T",
            run_label="R",
            run_id="1",
            title="X",
            sheets=[
                SheetSpec(title=long_title, columns=_basic_sheet().columns, rows=[]),
                SheetSpec(title=long_title, columns=_basic_sheet().columns, rows=[]),
            ],
        )
    )
    data_titles = [t for t in wb.sheetnames if t != "Cover"]
    assert all(len(t) <= 31 for t in data_titles)
    assert len(set(data_titles)) == 2


def test_generated_at_utc_renders_two_hours_later_in_sast():
    generated = datetime(2025, 6, 1, 10, 0, tzinfo=timezone.utc)
    wb = _load(
        build_workbook(
            tenant_name="T",
            run_label="R",
            run_id="1",
            title="X",
            sheets=[_basic_sheet()],
            generated_at=generated,
        )
    )
    cover_text = " ".join(str(c.value) for row in wb["Cover"].iter_rows() for c in row if c.value)
    assert "12:00" in cover_text  # UTC+2 SAST


def test_xlsx_filename_format():
    name = xlsx_filename("findings", "Nightly Run", datetime(2025, 6, 1, 10, 0, tzinfo=timezone.utc))
    assert name.startswith("meridian-findings-nightly-run-")
    assert name.endswith("-SAST.xlsx")
