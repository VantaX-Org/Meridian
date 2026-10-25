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
        self.seen_gate_sql = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        sql = str(stmt).strip()
        if sql.startswith("SELECT set_config"):
            return _Result([])
        if sql.startswith("SELECT retention"):
            return _Result([(self.retention,)])
        if sql.startswith("SELECT min(created_at) FROM purge_log"):
            self.seen_gate_sql.append(sql)
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
    assert c.post("/api/v1/settings/retention/preview", json={"versions_days": 30}).status_code == 403
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
    # every PUT stamps the policy so the dry-run window restarts from it
    assert db.retention["updated_at"] == NOW.isoformat()
    assert "updated_at" not in r.json()["policy"]
    # and a stored stamp is not echoed back by GET
    assert "updated_at" not in c.get("/api/v1/settings/retention").json()["policy"]


def test_status_counts_only_nightly_dry_runs_since_the_policy_changed(monkeypatch):
    """The gate query names the source and the policy stamp; the SQL itself is proven
    against Postgres in tests/test_rls_integration.py."""
    from api.services.retention import OLDEST_NIGHTLY_DRY_RUN_SQL

    assert "source = 'nightly'" in OLDEST_NIGHTLY_DRY_RUN_SQL and "dry_run = true" in OLDEST_NIGHTLY_DRY_RUN_SQL
    assert "retention->>'updated_at'" in OLDEST_NIGHTLY_DRY_RUN_SQL
    monkeypatch.setenv("MERIDIAN_PURGE_ENABLED", "true")
    c, db = _client(monkeypatch, _DB(retention={}, oldest_dry_run=NOW - timedelta(days=9)))
    assert c.get("/api/v1/settings/retention").json()["enforcement"]["enforced"] is True
    assert db.seen_gate_sql and all("source = 'nightly'" in q for q in db.seen_gate_sql)


def test_preview_writes_preview_rows_and_a_manual_delete_writes_manual_rows(monkeypatch):
    """The sync helpers pass the source through to purge_version."""
    from api.services import purge as purge_service
    from api.services import retention as retention_service

    seen = []

    def fake(session, tenant_id, version_id, *, dry_run, actor=None, force=False, source="manual"):
        seen.append((version_id, dry_run, source))
        return {"rows_by_table": {}, "bytes_freed": 0, "blocked_reason": None, "storage_errors": [],
                "purge_log_id": "x"}

    class _Ctx:
        def __enter__(self):
            return object()

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(routes, "purge_version", fake)
    monkeypatch.setattr(routes, "_sync_session", lambda tid: _Ctx())
    monkeypatch.setattr(routes, "load_policy", lambda s, t: retention_service.RetentionPolicy(versions_days=1))
    monkeypatch.setattr(routes, "select_expired_versions", lambda s, t, policy, now: [
        retention_service.ExpiredVersion(id=str(VID), label="Q1", run_at=NOW, system_id="upload", status="complete")])
    routes._preview(str(TENANT))
    routes._delete_version(str(TENANT), str(VID), routes.Actor())
    assert seen == [(str(VID), True, "preview"), (str(VID), False, "manual")]
    assert "preview" in purge_service.PURGE_SOURCES and "manual" in purge_service.PURGE_SOURCES


def test_preview_runs_the_dry_run_helper(monkeypatch):
    items = [{"version_id": str(VID), "label": "Q1", "run_at": NOW, "system_id": "upload",
              "blocked_reason": "1 cleaning item not finished", "rows_by_table": {}, "bytes_freed": 0}]
    seen = []
    monkeypatch.setattr(routes, "_preview", lambda tid: seen.append(tid) or items)
    c, _ = _client(monkeypatch)
    r = c.get("/api/v1/settings/retention/preview")
    assert r.status_code == 200 and r.json()["items"][0]["blocked_reason"] == "1 cleaning item not finished"
    assert seen == [str(TENANT)]


def test_draft_preview_evaluates_the_body_not_the_saved_policy(monkeypatch):
    """POST preview selects with the draft in the body; the saved policy is neither read nor changed."""
    from api.services import retention as retention_service

    seen_policies = []

    class _Ctx:
        def __enter__(self):
            return object()

        def __exit__(self, *a):
            return False

    def select(session, tenant_id, policy, now):
        seen_policies.append((tenant_id, policy))
        return [retention_service.ExpiredVersion(id=str(VID), label="Q1", run_at=NOW, system_id="upload",
                                                 status="complete")] if policy.versions_days == 30 else []

    def no_saved(*a):
        raise AssertionError("the draft preview must not read the saved policy")

    monkeypatch.setattr(routes, "_sync_session", lambda tid: _Ctx())
    monkeypatch.setattr(routes, "load_policy", no_saved)
    monkeypatch.setattr(routes, "select_expired_versions", select)
    monkeypatch.setattr(routes, "purge_version", lambda *a, **k: {
        "rows_by_table": {"findings": 4}, "bytes_freed": 10, "blocked_reason": None})
    c, db = _client(monkeypatch, _DB(retention={"versions_days": 365}))
    r = c.post("/api/v1/settings/retention/preview", json={"versions_days": 30, "keep_latest_per_system": 0})
    assert r.status_code == 200, r.text
    assert [i["version_id"] for i in r.json()["items"]] == [str(VID)]
    assert seen_policies[0][0] == str(TENANT)
    assert seen_policies[0][1].versions_days == 30 and seen_policies[0][1].keep_latest_per_system == 0
    assert db.updates == [] and db.retention == {"versions_days": 365}
    # the draft is validated like a PUT body
    assert c.post("/api/v1/settings/retention/preview", json={"versions_days": 0}).status_code == 422


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


def test_delete_version_blocked_by_open_record_issues(monkeypatch):
    """The real purge_version on a fake session: issues only seen in this run block the delete."""
    monkeypatch.setattr(routes, "_version_label", lambda tid, vid: ("Q1", True))

    class _Res:
        def __init__(self, rows):
            self.rows = rows

        def fetchone(self):
            return self.rows[0] if self.rows else None

        def scalar(self):
            return self.rows[0][0] if self.rows else None

    class _Session:
        def __init__(self):
            self.logs = []

        def execute(self, stmt, params=None):
            sql = " ".join(str(stmt).split())
            if sql.startswith("SELECT label, metadata FROM analysis_versions"):
                return _Res([("Q1", {})])
            if sql.startswith("SELECT count(*) FROM record_issues"):
                return _Res([(2,)])
            if sql.startswith("SELECT count(*)"):
                return _Res([(0,)])
            if sql.startswith("INSERT INTO purge_log"):
                self.logs.append(params)
                return _Res([])
            raise AssertionError(sql)

        def commit(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    session = _Session()
    monkeypatch.setattr(routes, "_sync_session", lambda tid: session)
    c, _ = _client(monkeypatch)
    r = c.request("DELETE", f"/api/v1/versions/{VID}", json={"confirm": "Q1"})
    assert r.status_code == 409
    assert r.json()["detail"]["blocked_reason"] == \
        "2 open record issues were only observed in this run; resolve or dismiss them first"
    assert session.logs[0]["src"] == "manual" and session.logs[0]["why"].startswith("2 open record issues")


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

def test_tenant_purge_sweeps_the_tenant_prefixes_and_counts_them(monkeypatch):
    from api.config import settings

    tid = str(TENANT)

    class _Res:
        def __init__(self, rows, rowcount=0):
            self.rows, self.rowcount = rows, rowcount

        def fetchall(self):
            return self.rows

        def __iter__(self):
            return iter(self.rows)

    class _Session:
        logs: list[dict] = []
        deletes: list[str] = []

        def execute(self, stmt, params=None):
            sql = " ".join(str(stmt).split())
            if sql.startswith("SELECT id FROM analysis_versions"):
                return _Res([])
            if sql.startswith("SELECT pdf_path FROM reports"):
                return _Res([(f"reports/{tid}/a.pdf",), ("reports/other-tenant/b.pdf",)])
            if sql.startswith("INSERT INTO purge_log"):
                _Session.logs.append(params)
                return _Res([])
            if sql.startswith("DELETE FROM"):
                _Session.deletes.append(sql)
                return _Res([], rowcount=3)
            raise AssertionError(sql)

        def commit(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    swept, removed = [], []
    monkeypatch.setattr(routes, "_sync_session", lambda t: _Session())
    monkeypatch.setattr("api.services.storage.object_size", lambda b, n: 10)
    monkeypatch.setattr("api.services.storage.delete_file", lambda b, n: removed.append(n))

    def delete_prefix(bucket, prefix):
        swept.append((bucket, prefix))
        return (2, 100) if prefix.startswith("uploads/") else (0, 0)

    monkeypatch.setattr("api.services.storage.delete_prefix", delete_prefix)
    out = routes._purge_tenant(tid, routes.Actor(email="admin@example.com"))
    assert swept == [(settings.minio_bucket_uploads, f"uploads/{tid}/"), (settings.minio_bucket_uploads, f"staging/{tid}/"),
                     (settings.minio_bucket_reports, f"reports/{tid}/"), (settings.minio_bucket_reports, f"archive/{tid}/")]
    assert out["rows_by_table"][f"storage objects uploads/{tid}/"] == 2
    assert out["bytes_freed"] == 100 + 10
    # the report keyed outside this tenant's prefix is neither deleted nor counted
    assert removed == [f"reports/{tid}/a.pdf"]
    log = _Session.logs[-1]
    assert log["src"] == "tenant" and log["k"] == "tenant"
    assert '"skipped_untrusted_key": ["reports/other-tenant/b.pdf"]' in log["r"]
    assert f'"storage objects uploads/{tid}/": 2' in log["r"]


def test_certificate_says_the_request_records_are_retained(monkeypatch):
    from api.services import pdf_reports

    captured = {}

    def render(template, ctx):
        html = pdf_reports._env().get_template(template).render(**ctx)
        captured["html"] = html
        return html.encode()

    monkeypatch.setattr(pdf_reports, "render", render)
    outcome = {"rows_by_table": {"findings": 4, "analysis_versions": 2, f"storage objects uploads/{TENANT}/": 3},
               "bytes_freed": 99, "versions": 2, "storage_errors": [], "purge_log_id": "log-9", "purged_at": NOW}
    routes._certificate_pdf("Acme", str(TENANT), outcome, routes.Actor(email="admin@example.com"))
    html = captured["html"]
    assert ("The audit entry for this purge request and the purge log entry are retained as the record of "
            "deletion.") in html
    assert f"storage objects uploads/{TENANT}/" in html and "uploaded files" in html


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
