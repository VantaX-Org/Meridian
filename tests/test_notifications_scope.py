"""Notification routes: a caller sees tenant-wide rows and their own, never another user's."""

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import notifications
from api.routes.notifications import router

UID = str(uuid.uuid4())
CLAUSE = "(user_id IS NULL OR user_id = :uid)"


class _Result:
    def scalar(self):
        return 0

    def fetchall(self):
        return []

    def fetchone(self):
        return (1,)


class _DB:
    def __init__(self):
        self.calls = []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if not sql.startswith("SET "):
            self.calls.append((sql, dict(params or {})))
        return _Result()

    async def commit(self):
        pass


def _client(db, monkeypatch, uid):
    monkeypatch.setattr(notifications, "current_user_id", lambda _r=None: uid)
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


def _hit(c):
    assert c.get("/api/v1/notifications").status_code == 200
    assert c.get("/api/v1/notifications/unread-count").status_code == 200
    assert c.put(f"/api/v1/notifications/{uuid.uuid4()}/read").status_code == 200
    assert c.put("/api/v1/notifications/read-all").status_code == 200


def test_every_statement_is_scoped_to_the_caller(monkeypatch):
    db = _DB()
    _hit(_client(db, monkeypatch, UID))
    assert len(db.calls) == 5  # list = count + select
    for sql, params in db.calls:
        assert CLAUSE in sql and params["uid"] == UID


def test_without_a_user_only_tenant_wide_rows(monkeypatch):
    db = _DB()
    _hit(_client(db, monkeypatch, None))
    assert len(db.calls) == 5
    for sql, params in db.calls:
        assert "user_id IS NULL" in sql and "user_id = :uid" not in sql and "uid" not in params
