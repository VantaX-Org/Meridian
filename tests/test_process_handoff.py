"""Process owner -> steward hand-off of a blocking rule (handoff_rule).

A process analyst holds handoff_rule but not `assign`: they may create one task for a blocking rule, assigned to a
user who can fix, and nothing else in the inbox. The Postgres scenario runs with MERIDIAN_TEST_DB_URL (RLS
enforced, non-superuser role); the permission checks run everywhere.
"""

from __future__ import annotations

import ast
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest

from api.routes.stewardship import can_fix
from api.services.rbac import LEGACY_ACTION_MAP, VALID_ROLES, has_permission, legacy_actions_for_pairs

ROOT = Path(__file__).resolve().parent.parent
ROLE = "meridian_handoff_app"


def test_process_analyst_hands_off_without_assign() -> None:
    assert has_permission("process_analyst", "handoff_rule")
    for action in ("assign", "approve", "apply", "manage_rules"):
        assert not has_permission("process_analyst", action), action
    for role in ("programme_lead", "data_steward", "platform_admin", "manager", "steward", "admin"):
        assert has_permission(role, "handoff_rule"), role
    for role in ("viewer", "auditor", "analyst", "data_owner", "approver", "sap_basis", "ai_reviewer"):
        assert not has_permission(role, "handoff_rule"), role


def test_handoff_rule_is_its_own_pair() -> None:
    assert LEGACY_ACTION_MAP["handoff_rule"] == {("stewardship", "create")}
    # A custom role ticked with stewardship/create hands off; it does not assign.
    got = legacy_actions_for_pairs({("stewardship", "create")})
    assert "handoff_rule" in got and "assign" not in got


def test_targets_are_people_who_can_fix() -> None:
    fixers = {r for r in VALID_ROLES if can_fix(r)}
    assert {"data_steward", "programme_lead", "platform_admin"} <= fixers
    assert not fixers & {"process_analyst", "viewer", "auditor", "analyst", "data_owner"}


def test_handoff_routes_are_guarded_by_handoff_rule() -> None:
    src = (ROOT / "api" / "routes" / "stewardship.py").read_text()
    guards = {}
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.AsyncFunctionDef) and node.name in ("handoff_rule", "handoff_stewards"):
            guards[node.name] = 'require_permission("handoff_rule")' in ast.get_source_segment(src, node)
    assert guards == {"handoff_rule": True, "handoff_stewards": True}


# ── Postgres scenario ────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engines():
    if not os.environ.get("MERIDIAN_TEST_DB_URL"):
        pytest.skip("MERIDIAN_TEST_DB_URL not set")
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=ROOT, capture_output=True, text=True, check=False,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": str(ROOT)})
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


def _seed(owner):
    from sqlalchemy import text

    tid, vid, fid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    users = {k: str(uuid.uuid4()) for k in ("data_steward", "viewer", "process_analyst")}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Handoff')"), {"t": tid})
        for role, uid in users.items():
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                           "VALUES (:i, :t, :e, :n, :r, true)"),
                      {"i": uid, "t": tid, "e": f"{role}-{uid[:8]}@example.test", "n": role, "r": role})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                       "affected_count, total_count) VALUES (:f, :v, :t, 'mm_purchasing', 'PO-12', 'critical', "
                       "'completeness', 40, 100)"), {"f": fid, "v": vid, "t": tid})
    return tid, vid, fid, users


def _rows(app, tid, sql, **p):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return c.execute(text(sql), p).fetchall()


def test_handoff_creates_a_task_the_steward_sees(engines, monkeypatch):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.stewardship import router as stewardship_router
    from api.routes.users import router as users_router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, vid, fid, users = _seed(owner)
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(stewardship_router)
    api.include_router(users_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Handoff", [])
    due = (date.today() + timedelta(days=7)).isoformat()
    body = {"check_id": "PO-12", "module": "mm_purchasing", "assignee_id": users["data_steward"],
            "note": "Vendor field blank on 40 POs; blocks goods receipt.", "due_date": due,
            "version_id": vid, "process": "Procure to pay", "field": "EKKO.LIFNR"}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            pa, viewer, steward = ({"X-User-Role": r} for r in ("process_analyst", "viewer", "data_steward"))

            # the picker lists only people who can fix
            r = await c.get("/api/v1/stewardship/handoff/stewards", headers=pa)
            assert r.status_code == 200
            assert [u["id"] for u in r.json()] == [users["data_steward"]]
            assert (await c.get("/api/v1/stewardship/handoff/stewards", headers=viewer)).status_code == 403

            # permission: viewer cannot hand off; nobody can hand to a viewer or into the past
            assert (await c.post("/api/v1/stewardship/handoff", headers=viewer, json=body)).status_code == 403
            bad = {**body, "assignee_id": users["viewer"]}
            assert (await c.post("/api/v1/stewardship/handoff", headers=pa, json=bad)).status_code == 422
            past = {**body, "due_date": (date.today() - timedelta(days=1)).isoformat()}
            assert (await c.post("/api/v1/stewardship/handoff", headers=pa, json=past)).status_code == 422

            # the hand-off: an exception on the rule plus an assigned task with the chosen due date
            r = await c.post("/api/v1/stewardship/handoff", headers=pa, json=body)
            assert r.status_code == 201, r.text
            out = r.json()
            assert out["assigned_to"] == users["data_steward"] and out["due_at"].startswith(due)
            task = _rows(app_eng, tid, "SELECT item_type, source_id::text, assigned_to::text, status, priority, "
                                       "due_at::date::text, domain FROM stewardship_queue WHERE id = CAST(:i AS uuid)",
                         i=out["task_id"])[0]
            assert tuple(task) == ("exception", out["exception_id"], users["data_steward"], "in_progress", 1, due,
                                   "mm_purchasing")
            exc = _rows(app_eng, tid, "SELECT type, severity, title, description, linked_finding_id::text, "
                                      "assigned_to::text FROM exceptions WHERE id = CAST(:i AS uuid)",
                        i=out["exception_id"])[0]
            assert tuple(exc) == ("dq_rule", "critical", "Hand-off: PO-12 blocks Procure to pay", body["note"], fid,
                                  users["data_steward"])
            note = _rows(app_eng, tid, "SELECT text FROM exception_comments WHERE exception_id = CAST(:i AS uuid)",
                         i=out["exception_id"])
            assert len(note) == 1 and "EKKO.LIFNR" in note[0][0] and body["note"] in note[0][0]
            bell = _rows(app_eng, tid, "SELECT title, link FROM notifications WHERE user_id = CAST(:u AS uuid)",
                         u=users["data_steward"])
            assert tuple(bell[0]) == ("Handed to you: PO-12", f"/inbox?focus={out['task_id']}")

            # the steward sees it in their inbox (Mine, in progress)
            r = await c.get(f"/api/v1/stewardship?status=in_progress&assigned_to={users['data_steward']}",
                            headers=steward)
            assert r.status_code == 200 and [t["id"] for t in r.json()["items"]] == [out["task_id"]]

            # the narrow right stays narrow: no assigning, no general assignable-users list
            assign = f"/api/v1/stewardship/{out['task_id']}/assign"
            assert (await c.put(assign, headers=pa, json={"user_id": None})).status_code == 403
            assert (await c.get("/api/v1/users/assignable", headers=pa)).status_code == 403

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(aeng.dispose())


def test_process_owner_raises_exceptions_and_comments_on_issues(engines, monkeypatch):
    """run_process_discovery (process owners) may raise an exception and comment on a record issue; viewers may not."""
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.exceptions import router as exceptions_router
    from api.routes.record_issues import router as issues_router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, vid, _fid, _users = _seed(owner)
    with app_eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        issue = str(c.execute(text(
            "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status, "
            "first_seen_version, last_seen_version) VALUES (:t, 'sys', 'mm_purchasing', 'PO-12', 'EBELN=1', "
            "'EKKO', 'high', 'open', :v, :v) RETURNING id"), {"t": tid, "v": vid}).scalar())
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(exceptions_router)
    api.include_router(issues_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Handoff", [])
    exc = {"type": "dq_rule", "category": "mm_purchasing", "severity": "high", "title": "PO-12 blocks PTP",
           "description": "Vendor missing"}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            pa, viewer = {"X-User-Role": "process_analyst"}, {"X-User-Role": "viewer"}
            assert (await c.post("/api/v1/exceptions", headers=pa, json=exc)).status_code == 201
            assert (await c.post("/api/v1/exceptions", headers=viewer, json=exc)).status_code == 403
            url = f"/api/v1/issues/{issue}/comments"
            assert (await c.post(url, headers=pa, json={"body": "Blocks goods receipt"})).status_code == 200
            assert (await c.post(url, headers=viewer, json={"body": "No"})).status_code == 403

    try:
        asyncio.run(scenario())
    finally:
        asyncio.run(aeng.dispose())
