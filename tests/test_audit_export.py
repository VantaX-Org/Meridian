"""Audit CSV export: spreadsheet formula injection guard and JSON cells."""

from api.routes.audit import _csv_cell


def test_formula_cells_are_escaped() -> None:
    for bad in ("=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tx", "\rx"):
        assert _csv_cell(bad) == "'" + bad


def test_plain_and_structured_cells() -> None:
    assert _csv_cell(None) == ""
    assert _csv_cell("PATCH") == "PATCH"
    assert _csv_cell(200) == "200"
    assert _csv_cell({"a": 1}) == '{"a": 1}'
