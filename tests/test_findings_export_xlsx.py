"""Findings export endpoint (T9): /findings/export, csv|xlsx.

No DB fixture — just checks the endpoint signature and that the xlsx column
spec has no duplicate/missing keys.
"""

import inspect

from api.routes.findings import _EXPORT_COLUMNS, export_findings


def test_export_endpoint_accepts_csv_and_xlsx_format() -> None:
    sig = inspect.signature(export_findings)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"
    # same filters as GET /findings
    for name in ("version_id", "module", "severity", "dimension", "check_id", "baseline", "sort", "finding_type"):
        assert name in sig.parameters


def test_export_columns_have_unique_keys() -> None:
    keys = [c.key for c in _EXPORT_COLUMNS]
    assert len(keys) == len(set(keys))
    assert "check_id" in keys
    assert "pass_rate" in keys
