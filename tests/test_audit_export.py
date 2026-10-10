"""Audit export: spreadsheet formula injection guard, JSON cells, xlsx format."""

import asyncio
import inspect
import io
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import openpyxl

from api.routes.audit import _COLUMNS, _csv_cell, export_audit_entries


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


def test_export_audit_entries_builds_real_workbook() -> None:
    """I9: build a real workbook through export_audit_entries and reload with
    openpyxl — mono id columns, sheet/column names, and the cover's
    formula-injection guard on tenant name."""
    cols = [c.strip() for c in _COLUMNS.split(",")]
    row = MagicMock()
    row._mapping = {
        "id": uuid.uuid4(),
        "actor_user_id": uuid.uuid4(),
        "actor_email": "steward@example.com",
        "action": "update",
        "entity_type": "record_issue",
        "entity_id": "REC-1",
        "method": "PATCH",
        "path": "/api/v1/issues/REC-1",
        "status_code": 200,
        "ip": "10.0.0.1",
        "user_agent": "pytest",
        "before_json": '{"status": "open"}',
        "after_json": '{"status": "resolved"}',
        "created_at": datetime(2026, 1, 1, 0, 0),
    }

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(),  # _set_rls
        MagicMock(fetchall=lambda: [row]),
    ])
    tenant = SimpleNamespace(id=uuid.uuid4(), name="=1+1")

    response = asyncio.run(export_audit_entries(
        actor_user_id=None, entity_type=None, entity_id=None, action=None,
        method=None, since=None, until=None, format="xlsx", db=db, tenant=tenant,
    ))

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Audit log"]
    ws = wb["Audit log"]
    headers = [c.value for c in ws[1]]
    assert headers == cols
    assert ws.cell(row=2, column=headers.index("action") + 1).value == "update"

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")
