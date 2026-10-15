"""Retention routes: guards, confirm mismatch, blocked purge, the tenant-purge token flow.

The sync purge helpers run in a thread against the real engine in production; here
they are replaced on the route module, and the async DB is a fake that answers the
few statements the settings routes make. Redis is a dict."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import retention as routes
from api.routes.retention import router

TENANT = uuid.uuid4()
VID = uuid.uuid4()
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows

    def scalar(self):
        return self._rows[0][0] if self._rows else None


class _DB:
    def __init__(self, retention=None, oldest_dry_run=None, log_rows=()):
        self.retention = retention if retention is not None else {}
        self.oldest_dry_run = oldest_dry_run
        self.log_rows = list(log_rows)
        self.updates = []
        self.audits = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        sql = str(stmt).strip()
        if sql.startswith("SELECT set_config"):
            return _Result([])
        if sql.startswith("SELECT retention"):
            return _Result([(self.retention,)])
        if sql.startswith("SELECT min(created_at) FROM purge_log"):
            return _Result([(self.oldest_dry_run,)])
        if sql.startswith("UPDATE tenants SET retention"):
            self.updates.append(params)
            self.retention = json.loads(params["r"])
            return _Result([])
        if sql.startswith("INSERT INTO audit_log"):
            self.audits.append(params)
            return _Result([])
        if sql.startswith("SELECT id, kind, target_id"):
            return _Result(self.log_rows[: params["n"]])
        raise AssertionError(sql)

    async def commit(self):
        self.commits += 1


class _Redis:
    def __init__(self):
        self.store: dict[str, str] = {}

    def setex(self, key, ttl, value):
        self.store[key] = value

    def get(self, key):
        return self.store.get(key)

    def delete(self, key):
        self.store.pop(key, None)


def _client(monkeypatch, db: _DB | None = None, role="admin") -> tuple[TestClient, _DB]:
    db = db or _DB()
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(routes, "_now", lambda: NOW)
    app = FastAPI()
    app.include_router(router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "Acme", [])
    c = TestClient(app)
    c.headers.update({"X-User-Role": role})
    return c, db


# ── guards ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["viewer", "steward", "manager", "auditor"])
def test_every_retention_route_needs_manage_settings(monkeypatch, role):
    c, _ = _client(monkeypatch, role=role)
    assert c.get("/api/v1/settings/retention").status_code == 403
    assert c.put("/api/v1/settings/retention", json={"versions_days": 30}).status_code == 403
    assert c.get("/api/v1/settings/retention/preview").status_code == 403
    assert c.get("/api/v1/settings/purge-log").status_code == 403
    assert c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": "x"}).status_code == 403
    assert c.post("/api/v1/admin/purge-tenant", json={}).status_code == 403


# ── policy ───────────────────────────────────────────────────────────────────

def test_get_retention_returns_defaults_and_dry_run_status(monkeypatch):
    monkeypatch.setenv("MERIDIAN_PURGE_ENABLED", "true")
    c, _ = _client(monkeypatch, _DB(retention={}, oldest_dry_run=NOW - timedelta(days=2)))
    r = c.get("/api/v1/settings/retention")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["policy"] == {"versions_days": None, "reports_days": None, "audit_days": None,
                              "keep_baseline": True, "keep_latest_per_system": 1}
    assert body["enforcement"]["flag_enabled"] is True and body["enforcement"]["enforced"] is False
    assert body["enforcement"]["dry_run_until"].startswith("2026-10-20")


def test_put_retention_validates_stores_and_audits(monkeypatch):
    c, db = _client(monkeypatch)
    assert c.put("/api/v1/settings/retention", json={"versions_days": 0}).status_code == 422
    assert c.put("/api/v1/settings/retention", json={"audit_days": 3}).status_code == 422
    r = c.put("/api/v1/settings/retention", json={"versions_days": 180, "keep_latest_per_system": 2})
    assert r.status_code == 200, r.text
    assert db.retention["versions_days"] == 180 and db.retention["keep_baseline"] is True
    assert db.commits == 1 and len(db.audits) == 1
    assert db.audits[0]["a"] == "update" and db.audits[0]["et"] == "retention_policy"
    assert r.json()["policy"]["keep_latest_per_system"] == 2


def test_preview_runs_the_dry_run_helper(monkeypatch):
    items = [{"version_id": str(VID), "label": "Q1", "run_at": NOW, "system_id": "upload",
              "blocked_reason": "1 cleaning item not finished", "rows_by_table": {}, "bytes_freed": 0}]
    seen = []
    monkeypatch.setattr(routes, "_preview", lambda tid: seen.append(tid) or items)
    c, _ = _client(monkeypatch)
    r = c.get("/api/v1/settings/retention/preview")
    assert r.status_code == 200 and r.json()["items"][0]["blocked_reason"] == "1 cleaning item not finished"
    assert seen == [str(TENANT)]


def test_purge_log_honours_limit(monkeypatch):
    rows = [(uuid.uuid4(), "version", VID, True, {"findings": 3}, 10, None, "a@x", NOW) for _ in range(5)]
    c, _ = _client(monkeypatch, _DB(log_rows=rows))
    r = c.get("/api/v1/settings/purge-log?limit=2")
    assert r.status_code == 200 and len(r.json()["items"]) == 2
    item = r.json()["items"][0]
    assert item["kind"] == "version" and item["dry_run"] is True and item["rows_by_table"] == {"findings": 3}
    assert c.get("/api/v1/settings/purge-log?limit=0").status_code == 422


# ── one version ──────────────────────────────────────────────────────────────

def test_delete_version_404_when_unknown(monkeypatch):
    monkeypatch.setattr(routes, "_version_label", lambda tid, vid: None)
    c, _ = _client(monkeypatch)
    assert c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": "x"}).status_code == 404


def test_delete_version_confirm_must_match_label(monkeypatch):
    monkeypatch.setattr(routes, "_version_label", lambda tid, vid: ("October run", True))
    called = []
    monkeypatch.setattr(routes, "_delete_version", lambda *a: called.append(a))
    c, _ = _client(monkeypatch)
    r = c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": "october run"})
    assert r.status_code == 400 and called == []
    assert c.request("DELETE", f"/api/v1/versions/{VID}", json={}).status_code == 422


def test_delete_version_refuses_an_unarchived_run(monkeypatch):
    monkeypatch.setattr(routes, "_version_label", lambda tid, vid: ("October run", False))
    c, _ = _client(monkeypatch)
    r = c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": "October run"})
    assert r.status_code == 409 and "Archive" in r.json()["detail"]["blocked_reason"]


def test_delete_version_blocked_is_409_with_reason(monkeypatch):
    monkeypatch.setattr(routes, "_version_label", lambda tid, vid: (None, True))
    monkeypatch.setattr(routes, "_delete_version", lambda tid, vid, actor: {
        "rows_by_table": {}, "bytes_freed": 0, "blocked_reason": "2 write-back requests pending or approved",
        "storage_errors": [], "purge_log_id": "x"})
    c, _ = _client(monkeypatch)
    # no label: the id is the confirmation
    r = c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": str(VID)})
    assert r.status_code == 409
    assert r.json()["detail"]["blocked_reason"] == "2 write-back requests pending or approved"


def test_delete_version_returns_the_purge_result(monkeypatch):
    monkeypatch.setattr(routes, "_version_label", lambda tid, vid: ("Q1", True))
    got = []
    monkeypatch.setattr(routes, "_delete_version", lambda tid, vid, actor: got.append((tid, vid, actor)) or {
        "rows_by_table": {"findings": 12, "analysis_versions": 1}, "bytes_freed": 2048, "blocked_reason": None,
        "storage_errors": [], "purge_log_id": "log-1"})
    c, _ = _client(monkeypatch)
    r = c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": "Q1"})
    assert r.status_code == 200, r.text
    assert r.json()["rows_by_table"]["findings"] == 12 and r.json()["bytes_freed"] == 2048
    assert got[0][:2] == (str(TENANT), str(VID)) and got[0][2].method == "DELETE"


# ── tenant purge token flow ──────────────────────────────────────────────────

def test_tenant_purge_needs_redis(monkeypatch):
    monkeypatch.setattr(routes, "get_redis", lambda: None)
    c, _ = _client(monkeypatch)
    assert c.post("/api/v1/admin/purge-tenant", json={}).status_code == 503


def test_tenant_purge_token_flow(monkeypatch):
    redis = _Redis()
    monkeypatch.setattr(routes, "get_redis", lambda: redis)
    purged = []
    monkeypatch.setattr(routes, "_purge_tenant", lambda tid, actor: purged.append(tid) or {
        "rows_by_table": {"findings": 4, "analysis_versions": 2}, "bytes_freed": 99, "versions": 2,
        "storage_errors": [], "purge_log_id": "log-9", "purged_at": NOW + timedelta(hours=25)})
    monkeypatch.setattr(routes, "_certificate_pdf", lambda name, tid, outcome, actor: b"%PDF-cert")
    c, _ = _client(monkeypatch)

    # step one: a token, usable 24 h later
    r = c.post("/api/v1/admin/purge-tenant", json={})
    assert r.status_code == 200, r.text
    token, after = r.json()["token"], datetime.fromisoformat(r.json()["executes_after"])
    assert after == NOW + timedelta(hours=24)
    assert list(redis.store) == [f"meridian:purge-tenant:{TENANT}:{token}"]

    # too early
    r = c.post("/api/v1/admin/purge-tenant", json={"token": token})
    assert r.status_code == 409 and r.json()["detail"]["error"] == "too_early"
    assert purged == []

    # unknown token
    assert c.post("/api/v1/admin/purge-tenant", json={"token": "nope"}).status_code == 404

    # step two, after the delay: purge and certificate
    monkeypatch.setattr(routes, "_now", lambda: NOW + timedelta(hours=24, minutes=1))
    r = c.post("/api/v1/admin/purge-tenant", json={"token": token})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content == b"%PDF-cert"
    assert r.headers["x-purge-log-id"] == "log-9"
    assert purged == [str(TENANT)]
    # the token is single-use
    assert redis.store == {}
    assert c.post("/api/v1/admin/purge-tenant", json={"token": token}).status_code == 404
