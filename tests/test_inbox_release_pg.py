"""Inbox task release against a real Postgres (RLS enforced, non-superuser role).

PUT /stewardship/{id}/assign with user_id null and the triage bulk "release" action both put work
back in the unassigned pool: owner and team cleared, a claimed task reopens, assigned_at kept so the
auto-assign sweep leaves it alone, the SLA clock untouched; issues get an 'assign' history event.
Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_release_app"


@pytest.fixture(scope="module")
def engines():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True, check=False,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {ROLE}"))
    owner.dispose()


def _seed(owner, app):
    from sqlalchemy import text

    tid, vid, uid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Release')"), {"t": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                       "VALUES (:i, :t, :e, 'Steward', 'steward', true)"),
                  {"i": uid, "t": tid, "e": f"steward-{uid[:8]}@example.test"})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
    with app.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        tasks = [str(c.execute(text(
            "INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority, status) "
            "VALUES (:t, 'merge_review', :src, 'business_partner', 2, :st) RETURNING id"),
            {"t": tid, "src": str(uuid.uuid4()), "st": st}).scalar()) for st in ("open", "open", "open", "resolved")]
        issue = str(c.execute(text(
            "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status, "
            "first_seen_version, last_seen_version) VALUES (:t, 'sys', 'accounts_payable', 'AP-2', 'LIFNR=1', "
            "'LFA1', 'high', 'open', :v, :v) RETURNING id"), {"t": tid, "v": vid}).scalar())
    return tid, uid, tasks, issue


def _rows(app, tid, sql, **p):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return c.execute(text(sql), p).fetchall()


def test_release(engines, monkeypatch):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.stewardship import router as stewardship_router
    from api.routes.triage import router as triage_router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, uid, tasks, issue = _seed(owner, app_eng)
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(stewardship_router)
    api.include_router(triage_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Release", [])
    task_sql = ("SELECT assigned_to::text, status, assigned_at IS NOT NULL, sla_started_at IS NOT NULL "
                "FROM stewardship_queue WHERE id = CAST(:id AS uuid)")

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            approver, analyst, steward = ({"X-User-Role": r} for r in ("approver", "analyst", "steward"))
            assign = f"/api/v1/stewardship/{tasks[0]}/assign"
            # claim, then release with an explicit null: same `approve` guard as claim
            assert (await c.put(assign, headers=approver, json={"user_id": uid})).status_code == 200
            assert _rows(app_eng, tid, task_sql, id=tasks[0])[0][:2] == (uid, "in_progress")
            assert (await c.put(assign, headers=analyst, json={"user_id": None})).status_code == 403
            assert (await c.put(assign, headers=approver, json={})).status_code == 422  # null must be explicit
            r = await c.put(assign, headers=approver, json={"user_id": None})
            assert r.status_code == 200 and r.json() == {"id": tasks[0], "status": "open", "assigned_to": None}
            owner_, status, assigned_at, sla = _rows(app_eng, tid, task_sql, id=tasks[0])[0]
            assert (owner_, status, assigned_at, sla) == (None, "open", True, True)  # clock and history kept
            # closed or missing tasks
            closed = f"/api/v1/stewardship/{tasks[3]}/assign"
            assert (await c.put(closed, headers=approver, json={"user_id": None})).status_code == 409
            missing = f"/api/v1/stewardship/{uuid.uuid4()}/assign"
            assert (await c.put(missing, headers=approver, json={"user_id": None})).status_code == 404

            # bulk release needs `assign`; only owned items count
            for t in tasks[1:3]:
                await c.put(f"/api/v1/stewardship/{t}/assign", headers=approver, json={"user_id": uid})
            body = {"kind": "queue", "ids": tasks, "action": "release"}
            assert (await c.post("/api/v1/triage/bulk", headers=approver, json=body)).status_code == 403
            r = await c.post("/api/v1/triage/bulk", headers=steward, json=body)
            assert r.status_code == 200 and r.json()["updated"] == 2
            for t in tasks[1:3]:
                assert _rows(app_eng, tid, task_sql, id=t)[0][:2] == (None, "open")
            again = await c.post("/api/v1/triage/bulk", headers=steward, json=body)
            assert again.json()["updated"] == 0  # idempotent

            # issues: the release is recorded in the issue history
            await c.post("/api/v1/triage/bulk", headers=steward,
                         json={"kind": "issue", "ids": [issue], "action": "reassign", "user_id": uid})
            r = await c.post("/api/v1/triage/bulk", headers=steward,
                             json={"kind": "issue", "ids": [issue], "action": "release", "note": "on leave"})
            assert r.json()["updated"] == 1
            ev = _rows(app_eng, tid, "SELECT action, from_value, to_value, note FROM record_issue_events "
                                     "WHERE issue_id = CAST(:id AS uuid) ORDER BY created_at DESC LIMIT 1", id=issue)
            assert tuple(ev[0]) == ("assign", uid, None, "on leave")
            assert _rows(app_eng, tid, "SELECT assigned_to FROM record_issues WHERE id = CAST(:id AS uuid)",
                         id=issue)[0][0] is None

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(aeng.dispose())
