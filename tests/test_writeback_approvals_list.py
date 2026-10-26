"""GET /writeback/approvals: gated by `approve`, tenant-scoped, pending live requests only (mocked session)."""

import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import get_db, get_tenant
from api.routes import writeback
from api.services import rbac

TENANT = SimpleNamespace(id=uuid.uuid4(), name="t")


class _Recorder:
    def __init__(self, rows) -> None:
        self.rows = rows
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))
        return MagicMock(fetchall=lambda: self.rows)


def _client(monkeypatch, role: str, rows=()) -> tuple[TestClient, _Recorder]:
    async def fake_role(*a, **k):
        return role

    monkeypatch.setattr(rbac, "_get_user_role", fake_role)
    rec = _Recorder(list(rows))
    app = FastAPI()
    app.include_router(writeback.router)
    app.dependency_overrides[get_tenant] = lambda: TENANT
    app.dependency_overrides[get_db] = lambda: rec
    return TestClient(app), rec


def test_lists_pending_requests_for_the_tenant(monkeypatch) -> None:
    row = (uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), 3, "sap-host", datetime(2026, 1, 1),
           "BP_TAX_001", "business_partner", "Tax number is missing", "Thandi Nkosi")
    client, rec = _client(monkeypatch, "approver", [row])
    r = client.get("/api/v1/writeback/approvals")
    assert r.status_code == 200
    body = r.json()
    assert body["approvals"][0]["records_updated"] == 3 and body["approvals"][0]["created_at"].startswith("2026-01-01")
    # the rule and the requester come named, so an approver without the findings or users APIs never sees an id
    a = body["approvals"][0]
    assert (a["check_id"], a["module"], a["rule_message"], a["requested_by_name"]) == (
        "BP_TAX_001", "business_partner", "Tax number is missing", "Thandi Nkosi")
    sql, params = rec.calls[1]
    assert "approved_by IS NULL" in sql and "dry_run = false" in sql
    assert "LEFT JOIN findings" in sql and "LEFT JOIN users" in sql and "u.tenant_id = w.tenant_id" in sql
    assert params["tid"] == str(TENANT.id)


def test_forbidden_without_approve(monkeypatch) -> None:
    client, rec = _client(monkeypatch, "viewer")
    assert client.get("/api/v1/writeback/approvals").status_code == 403
    assert rec.calls == []
