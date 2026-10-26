"""Per-object fix list with value at risk, and importing a filled-in one.

A steward works one object at a time. The combined fix sheet forced one object per download, so the
per-object workbook gives a Summary ranked by value at risk plus a sheet per object - and the
importer has to accept those sheets, not only the single combined one.
"""
from pathlib import Path

SRC = (Path(__file__).resolve().parents[1] / "api" / "routes" / "work.py").read_text(encoding="utf-8")


def test_per_object_export_exists_and_splits_by_object():
    assert '@router.get("/export/per-object")' in SRC
    body = SRC[SRC.index('async def export_per_object'):SRC.index('@router.post("/import")')]
    assert "by_object.setdefault(r[\"module\"]" in body, "rows are grouped per object"
    assert 'title="Summary"' in body, "the workbook leads with a summary"
    assert "value_at_risk" in body, "each record carries its attributed value"


def test_value_is_attributed_not_invented():
    """The row's value is the check's cost shared across its failing records, and must say so."""
    body = SRC[SRC.index('async def export_per_object'):SRC.index('@router.post("/import")')]
    assert "/ f.affected_count" in body, "cost_at_risk is divided by the failing record count"
    assert "attribution" in body, "and the sheet explains that it is an attribution, not a saving"


def test_import_accepts_any_sheet_with_the_columns():
    body = SRC[SRC.index('async def import_sheet'):]
    assert "for name in wb.sheetnames:" in body, "must scan every sheet"
    assert "required <= set(col)" in body, "accepting any sheet that has the required columns"
    assert "SHEET not in wb.sheetnames" not in body, "the single-sheet restriction is gone"
