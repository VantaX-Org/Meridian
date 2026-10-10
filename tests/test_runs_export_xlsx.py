"""Runs export endpoints (T10): /runs/export, /runs/{version_id}/steps/export.

No DB fixture — checks signatures and route ordering (/export must not be
shadowed by the /{version_id} family).
"""

import asyncio
import inspect
import io
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import openpyxl

import api.routes.runs as runs_module
from api.routes.runs import export_run_steps, export_runs, router


def test_export_runs_signature() -> None:
    sig = inspect.signature(export_runs)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_export_runs_builds_real_workbook() -> None:
    """I9: build a real workbook through export_runs and reload with openpyxl —
    sheet/column names, and the cover's formula-injection guard on tenant name."""
    version = SimpleNamespace(
        id="11111111-1111-1111-1111-111111111111",
        run_at="2026-01-02T03:04:00",
        label="Nightly run",
        status="complete",
        metadata={"system_id": "S1"},
    )

    async def fake_list_versions(**kwargs):
        return {"versions": [version]}

    db = AsyncMock()
    db.execute.return_value = MagicMock(
        fetchall=lambda: [(version.id, datetime(2026, 1, 2, 3, 30, tzinfo=timezone.utc), 4200)]
    )
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=cmd|' /c calc'!A1")

    original = runs_module.list_versions
    runs_module.list_versions = fake_list_versions
    try:
        response = asyncio.run(export_runs(limit=100, db=db, tenant=tenant))
    finally:
        runs_module.list_versions = original

    # I9: filename must carry the shared "meridian-" export stamp.
    disposition = response.headers["content-disposition"]
    filename = disposition.split("filename=", 1)[1].strip('"')
    assert filename.startswith("meridian-")

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Runs"]
    ws = wb["Runs"]
    headers = [c.value for c in ws[1]]
    assert headers == ["Run ID", "Run at", "Label", "Status", "System", "Finished", "Duration (ms)", "Baseline"]
    assert ws.cell(row=2, column=1).value == version.id
    assert ws.cell(row=2, column=3).value == "Nightly run"

    cover = wb["Cover"]
    org_cell = cover.cell(row=6, column=2).value
    assert org_cell.startswith("'=")  # tenant name is formula-guarded


def test_export_run_steps_signature() -> None:
    sig = inspect.signature(export_run_steps)
    assert "format" in sig.parameters
    assert "version_id" in sig.parameters


def test_export_routes_registered() -> None:
    paths = {r.path for r in router.routes}
    assert "/api/v1/runs/export" in paths
    assert "/api/v1/runs/{version_id}/steps/export" in paths
