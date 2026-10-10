"""Findings export endpoint (T9): /findings/export, csv|xlsx.

No DB fixture — just checks the endpoint signature and that the xlsx column
spec has no duplicate/missing keys.
"""

import asyncio
import inspect
import io
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import openpyxl

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


def test_export_findings_builds_real_workbook() -> None:
    """I9: build a real two-sheet workbook through export_findings and reload with
    openpyxl — the created_at datetime cell, the pass_rate percent cell, sheet and
    column names, and the cover's formula-injection guard on tenant name."""
    created_at = datetime(2026, 3, 1, 12, 30, tzinfo=timezone.utc)
    finding = SimpleNamespace(
        id=uuid.uuid4(),
        module="material_master",
        check_id="MM-001",
        finding_type="data_quality",
        severity="high",
        dimension="completeness",
        rule_context={"message": "Bad field"},
        affected_count=5,
        total_count=100,
        pass_rate=95.5,
        cost_at_risk=1200.0,
        impact_score=8.2,
        details={"baseline": "live_config"},
        remediation_text="Fix it",
        created_at=created_at,
    )

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(),  # SET app.tenant_id
        MagicMock(scalars=lambda: MagicMock(all=lambda: [finding])),
    ])
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=SUM(A1:A2)")

    response = asyncio.run(export_findings(version_id=str(uuid.uuid4()), db=db, tenant=tenant))

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Summary", "Findings"]

    ws = wb["Findings"]
    headers = [c.value for c in ws[1]]
    assert headers == [
        "ID", "Module", "Object", "Check ID", "Type", "Severity", "Dimension", "Message",
        "Affected", "Total", "Pass rate", "Cost at risk", "Impact score", "Baseline",
        "Remediation", "Created",
    ]
    pass_rate_cell = ws.cell(row=2, column=headers.index("Pass rate") + 1).value
    assert abs(pass_rate_cell - 0.955) < 1e-6
    created_cell = ws.cell(row=2, column=headers.index("Created") + 1).value
    assert isinstance(created_cell, datetime)
    assert created_cell == datetime(2026, 3, 1, 14, 30)  # UTC 12:30 -> SAST (UTC+2) 14:30, tz stripped

    summary_ws = wb["Summary"]
    assert [c.value for c in summary_ws[1]] == ["Severity", "Findings", "Affected records"]
    assert summary_ws.cell(row=2, column=1).value == "high"
    assert summary_ws.cell(row=2, column=2).value == 1

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")
