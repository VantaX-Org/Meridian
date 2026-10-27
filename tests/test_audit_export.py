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
        method=None, since=None, until=None, path_contains=None, format="xlsx", db=db, tenant=tenant,
    ))

    wb = openpyxl.load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Cover", "Audit log"]
    ws = wb["Audit log"]
    headers = [c.value for c in ws[1]]
    assert headers == cols
    assert ws.cell(row=2, column=headers.index("action") + 1).value == "update"

    cover = wb["Cover"]
    assert cover.cell(row=6, column=2).value.startswith("'=")


# ── CSV export: streamed, filtered, tenant-scoped, guarded ──────────────────


def _audit_row(i: int, action: str = "update") -> MagicMock:
    row = MagicMock()
    row._mapping = {
        "id": uuid.UUID(int=i), "actor_user_id": None, "actor_email": "=cmd|' /C calc'!A0",
        "action": action, "entity_type": "user", "entity_id": None, "method": "PUT",
        "path": "/api/v1/users/1", "status_code": 200, "ip": None, "user_agent": None,
        "before_json": {"role": "viewer"}, "after_json": None, "created_at": datetime(2026, 1, 1, 0, i % 60),
    }
    return row


class _RecordingDB:
    """Answers SELECTs from queued batches and keeps every statement and its params."""

    def __init__(self, batches: list[list]) -> None:
        self.batches = list(batches)
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), dict(params or {})))
        if str(stmt).startswith("SET"):
            return MagicMock()
        rows = self.batches.pop(0) if self.batches else []
        return MagicMock(fetchall=lambda rows=rows: rows)


async def _drain(response) -> str:
    return "".join([chunk async for chunk in response.body_iterator])


def _export(db, **kw):
    args = dict(actor_user_id=None, entity_type=None, entity_id=None, action=None, method=None,
                since=None, until=None, path_contains=None, format="csv")
    args.update(kw)
    return asyncio.run(export_audit_entries(db=db, tenant=SimpleNamespace(id=uuid.UUID(int=7), name="T"), **args))


def test_csv_export_streams_in_keyset_batches(monkeypatch) -> None:
    import csv as _csv

    from fastapi.responses import StreamingResponse

    import api.routes.audit as audit

    monkeypatch.setattr(audit, "_EXPORT_BATCH", 2)
    db = _RecordingDB([[_audit_row(1), _audit_row(2)], [_audit_row(3)]])
    response = _export(db)
    assert isinstance(response, StreamingResponse)
    assert response.media_type == "text/csv"
    assert "audit_log.csv" in response.headers["content-disposition"]

    body = asyncio.run(_drain(response))
    lines = list(_csv.reader(io.StringIO(body)))
    assert lines[0] == [c.strip() for c in _COLUMNS.split(",")]
    assert len(lines) == 4  # header + 3 rows across two batches
    selects = [(sql, p) for sql, p in db.calls if sql.startswith("SELECT")]
    assert len(selects) == 2  # second batch short -> stop, no third round trip
    assert "(created_at, id) >" not in selects[0][0]
    assert "(created_at, id) > (:after_ts, :after_id)" in selects[1][0]
    assert selects[1][1]["after_id"] == uuid.UUID(int=2)
    # RLS is set first and every SELECT is tenant-scoped.
    assert db.calls[0][0].startswith("SET app.tenant_id")
    assert all("tenant_id = :tid" in sql and p["tid"] == str(uuid.UUID(int=7)) for sql, p in selects)


def test_csv_export_guards_formula_cells() -> None:
    db = _RecordingDB([[_audit_row(1)]])
    body = asyncio.run(_drain(_export(db)))
    assert "'=cmd|' /C calc'!A0" in body
    assert ",=cmd" not in body
    assert '{""role"": ""viewer""}' in body  # JSON cells serialised, csv-quoted


def test_csv_export_applies_page_filters_and_date_window() -> None:
    db = _RecordingDB([[]])
    body = asyncio.run(_drain(_export(
        db, actor_user_id="u1", action="create", entity_type="user", path_contains="/users",
        since="2026-01-01T00:00:00Z", until="2026-01-31T23:59:59.999Z",
    )))
    assert body.count("\n") == 1  # header only
    sql, params = next((s, p) for s, p in db.calls if s.startswith("SELECT"))
    for clause in ("actor_user_id = :actor", "action = :action", "entity_type = :etype",
                   "path ILIKE :pathlike", "created_at >= :since", "created_at <= :until"):
        assert clause in sql
    assert params["since"] == datetime.fromisoformat("2026-01-01T00:00:00Z")
    assert params["until"].day == 31
    assert params["pathlike"] == "%/users%"


def test_export_rejects_a_malformed_date() -> None:
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _export(_RecordingDB([]), since="last tuesday")
    assert exc.value.status_code == 422


def test_csv_export_gates_by_role_over_http(monkeypatch) -> None:
    from tests.test_rbac_matrix import _audit_client

    client = _audit_client(monkeypatch)
    for role, status in (("auditor", 200), ("admin", 200), ("viewer", 403)):
        r = client.get("/api/v1/audit/export", params={"format": "csv", "since": "2026-01-01"},
                       headers={"X-User-Role": role})
        assert r.status_code == status, (role, r.text)
        if status == 200:
            assert r.text.startswith("id,actor_user_id")
