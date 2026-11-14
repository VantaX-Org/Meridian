"""Notification routes: a caller sees tenant-wide rows and their own, never another user's,
and reading a tenant-wide row records the read for that caller only."""

import json
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import notifications
from api.routes.notifications import router
from api.routes.preferences import Preferences

UID = str(uuid.uuid4())
CLAUSE = "(user_id IS NULL OR user_id = :uid)"
NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class _Result:
    def __init__(self, row=None):
        self.row = row

    def scalar(self):
        return self.row[0] if self.row else 0

    def first(self):
        return self.row

    def fetchone(self):
        return self.row

    def fetchall(self):
        return [self.row] if self.row else []


class _DB:
    """Fake session: the caller owns no row unless own=True; the shared row exists unless shared=False."""

    def __init__(self, prefs=None, own=False, shared=True):
        self.calls = []
        self.prefs = prefs or {}
        self.own, self.shared = own, shared

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        params = dict(params or {})
        if sql.startswith("SET "):
            return _Result()
        self.calls.append((sql, params))
        if sql.startswith("SELECT preferences FROM users"):
            return _Result((self.prefs,))
        if sql.startswith("UPDATE users SET preferences"):
            self.prefs = json.loads(params["p"])
            return _Result()
        if sql == "SELECT now()":
            return _Result((NOW,))
        if sql.startswith("UPDATE notifications") and "RETURNING id" in sql:
            return _Result((params["nid"],) if self.own or "uid" not in params else None)
        if sql.startswith("SELECT id FROM notifications"):
            return _Result((params["nid"],) if self.shared else None)
        return _Result()

    async def commit(self):
        pass

    def notification_sql(self):
        return [(s, p) for s, p in self.calls if "notifications" in s and "users" not in s]


def _client(db, monkeypatch, uid):
    monkeypatch.setattr(notifications, "current_user_id", lambda _r=None: uid)
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")  # the route's view guard; viewer holds view
    return TestClient(api, headers={"X-User-Role": "viewer"})


def _hit(c):
    assert c.get("/api/v1/notifications").status_code == 200
    assert c.get("/api/v1/notifications/unread-count").status_code == 200
    assert c.put(f"/api/v1/notifications/{uuid.uuid4()}/read").status_code == 200
    assert c.put("/api/v1/notifications/read-all").status_code == 200


def test_reads_are_scoped_to_the_caller(monkeypatch):
    db = _DB()
    _hit(_client(db, monkeypatch, UID))
    reads = [(s, p) for s, p in db.notification_sql() if s.startswith("SELECT COUNT") or "ORDER BY" in s]
    assert len(reads) == 3  # list = count + select, plus unread-count
    for sql, params in reads:
        assert CLAUSE in sql and params["uid"] == UID


def test_a_known_user_never_flips_the_shared_flag(monkeypatch):
    db = _DB()
    _hit(_client(db, monkeypatch, UID))
    updates = [(s, p) for s, p in db.notification_sql() if s.startswith("UPDATE notifications")]
    assert len(updates) == 2
    for sql, params in updates:
        assert "user_id = :uid" in sql and "user_id IS NULL" not in sql and params["uid"] == UID


def test_reading_a_tenant_wide_row_is_recorded_for_the_caller_only(monkeypatch):
    db = _DB(prefs={"theme": "dark"})
    nid = str(uuid.uuid4())
    r = _client(db, monkeypatch, UID).put(f"/api/v1/notifications/{nid}/read")
    assert r.status_code == 200
    assert db.prefs == {"theme": "dark", "notifications_read": {"ids": [nid]}}
    saves = [p for s, p in db.calls if s.startswith("UPDATE users")]
    assert len(saves) == 1 and saves[0]["uid"] == UID
    Preferences.model_validate(db.prefs)  # later PATCH /me/preferences still validates


def test_reading_an_own_row_uses_the_row_flag(monkeypatch):
    db = _DB(own=True)
    assert _client(db, monkeypatch, UID).put(f"/api/v1/notifications/{uuid.uuid4()}/read").status_code == 200
    assert not [s for s, _ in db.calls if s.startswith("UPDATE users")]


def test_unknown_notification_is_404(monkeypatch):
    db = _DB(shared=False)
    assert _client(db, monkeypatch, UID).put(f"/api/v1/notifications/{uuid.uuid4()}/read").status_code == 404


def test_read_all_sets_the_callers_watermark(monkeypatch):
    db = _DB(prefs={"notifications_read": {"ids": ["a", "b"]}})
    assert _client(db, monkeypatch, UID).put("/api/v1/notifications/read-all").status_code == 200
    assert db.prefs == {"notifications_read": {"before": NOW.isoformat(), "ids": []}}


def test_list_and_count_bind_the_callers_read_state(monkeypatch):
    db = _DB(prefs={"notifications_read": {"before": NOW.isoformat(), "ids": ["x"]}})
    c = _client(db, monkeypatch, UID)
    assert c.get("/api/v1/notifications?is_read=false").status_code == 200
    assert c.get("/api/v1/notifications/unread-count").status_code == 200
    reads = [(s, p) for s, p in db.notification_sql() if s.startswith("SELECT")]
    assert len(reads) == 3
    for sql, params in reads:
        assert "CASE WHEN user_id IS NULL" in sql
        assert params["read_before"] == NOW and params["read_ids"] == ["x"]


def test_without_a_user_only_tenant_wide_rows(monkeypatch):
    db = _DB()
    _hit(_client(db, monkeypatch, None))
    assert len(db.calls) == 5
    for sql, params in db.calls:
        assert "user_id IS NULL" in sql and "user_id = :uid" not in sql and "uid" not in params
