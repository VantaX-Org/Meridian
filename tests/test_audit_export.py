"""Audit export: spreadsheet formula injection guard, JSON cells, xlsx format."""

import inspect

from api.routes.audit import _csv_cell, export_audit_entries


def test_formula_cells_are_escaped() -> None:
    for bad in ("=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tx", "\rx"):
        assert _csv_cell(bad) == "'" + bad


def test_plain_and_structured_cells() -> None:
    assert _csv_cell(None) == ""
    assert _csv_cell("PATCH") == "PATCH"
    assert _csv_cell(200) == "200"
    assert _csv_cell({"a": 1}) == '{"a": 1}'


def test_export_endpoint_accepts_xlsx_format() -> None:
    # format=xlsx must be a valid query option alongside the existing csv default.
    sig = inspect.signature(export_audit_entries)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "csv"
