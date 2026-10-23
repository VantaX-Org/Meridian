"""Cleaning batch audit: bulk approve leaves per-item audit rows, and /cleaning/audit filters by batch."""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import get_db, get_tenant
from api.routes import cleaning
from api.services import rbac

TENANT = SimpleNamespace(id=uuid.uuid4(), name="t")


class _Recorder:
    def __init__(self, bulk_rows=()):
        self.calls: list[tuple[str, dict]] = []
        self.bulk_rows = list(bulk_rows)

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "UPDATE cleaning_queue cq" in sql:
            return MagicMock(fetchall=lambda: self.bulk_rows)
        return MagicMock(fetchall=lambda: [], scalar=lambda: 0)

    def begin_nested(self):
        class _Ctx:
            async def __aenter__(s): return None
            async def __aexit__(s, *a): return False
        return _Ctx()

    async def commit(self) -> None:
        pass


def _client(monkeypatch, db):
    async def role(*a, **k):
        return "admin"

    monkeypatch.setattr(rbac, "_get_user_role", role)
    app = FastAPI()
    app.include_router(cleaning.router)
    app.dependency_overrides[get_tenant] = lambda: TENANT
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_bulk_approve_writes_one_audit_row_per_approved_item(monkeypatch) -> None:
    ids = [uuid.uuid4(), uuid.uuid4()]
    db = _Recorder(bulk_rows=[(ids[0], "100001", "material_master"), (ids[1], "100002", "material_master")])
    r = _client(monkeypatch, db).post("/api/v1/cleaning/bulk-approve", json={"max_count": 5})
    assert r.status_code == 200 and r.json()["approved_count"] == 2
    inserts = [p for sql, p in db.calls if "INSERT INTO cleaning_audit" in sql]
    assert [p["queue_id"] for p in inserts] == [str(i) for i in ids]
    assert all(p["actor_name"] for p in inserts)
    assert all(p["action"] == "approved" and p["tenant_id"] == str(TENANT.id) for p in inserts)


def test_cleaning_audit_filters_by_batch_within_the_tenant(monkeypatch) -> None:
    db = _Recorder()
    batch = uuid.uuid4()
    assert _client(monkeypatch, db).get("/api/v1/cleaning/audit", params={"batch_id": str(batch)}).status_code == 200
    sql, params = next((s, p) for s, p in db.calls if "FROM cleaning_audit" in s and "batch_id" in s)
    assert "SELECT id FROM cleaning_queue WHERE batch_id = :bid AND tenant_id = :tid" in sql
    assert params["bid"] == str(batch) and params["tid"] == str(TENANT.id)


def test_bulk_approve_with_ids_approves_exactly_those_items_in_the_tenant(monkeypatch) -> None:
    """A batch page names its proposals: approve those, not N from the whole queue's automatic rules."""
    ids = [uuid.uuid4(), uuid.uuid4()]
    db = _Recorder(bulk_rows=[(ids[0], "100001", "material_master"), (ids[1], "100002", "material_master")])
    r = _client(monkeypatch, db).post("/api/v1/cleaning/bulk-approve", json={"ids": [str(i) for i in ids]})
    assert r.status_code == 200 and r.json()["approved_count"] == 2
    sql, params = next((s, p) for s, p in db.calls if "UPDATE cleaning_queue cq" in s)
    assert "id = ANY(:ids)" in sql and "tenant_id = :tid" in sql
    assert "automation_level" not in sql
    assert params["ids"] == [str(i) for i in ids] and params["max_count"] == 2
    assert params["tid"] == str(TENANT.id)


def test_bulk_approve_without_ids_keeps_the_automatic_rule_gate(monkeypatch) -> None:
    db = _Recorder()
    assert _client(monkeypatch, db).post("/api/v1/cleaning/bulk-approve", json={"max_count": 5}).status_code == 200
    sql, params = next((s, p) for s, p in db.calls if "UPDATE cleaning_queue cq" in s)
    assert "automation_level = 'auto'" in sql and "ids" not in params
