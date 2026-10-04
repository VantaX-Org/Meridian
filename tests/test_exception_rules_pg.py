"""Exception rules + billing against a real Postgres (RLS enforced, non-superuser role).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
Covers: enabled custom rules raise one exception per scan (a re-scan adds none), disabled
rules never fire, rule update null semantics, and the billing permission gate.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_exc_app"


@pytest.fixture(scope="module")
def engines():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
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


def _rule(c, tid, name, active, assignee=None) -> str:
    from sqlalchemy import text

    return str(c.execute(text(
        "INSERT INTO exception_rules (id, tenant_id, name, description, rule_type, object_type, condition, "
        "severity, auto_assign_to, is_active) VALUES (gen_random_uuid(), :t, :n, 'd', 'field_condition', "
        "'vendor', 'check_id == CHK-X', 'high', :a, :act) RETURNING id"),
        {"t": tid, "n": name, "a": assignee, "act": active}).scalar())


def _custom_exceptions(app, tid):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return c.execute(text("SELECT source_reference, assigned_to, billing_tier FROM exceptions "
                              "WHERE type = 'custom_business'")).fetchall()


def test_enabled_rule_fires_once_disabled_never(engines, monkeypatch):
    from sqlalchemy import text

    import workers.tasks.run_exception_scan as scan

    owner, app = engines
    tid, other, vid, assignee = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'E1'), (:b, 'E2')"), {"a": tid, "b": other})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                       "affected_count, total_count) VALUES (:v, :t, 'accounts_payable', 'CHK-X', 'high', "
                       "'completeness', 2, 3)"), {"v": vid, "t": tid})
        enabled = _rule(c, tid, "enabled", True, assignee)
        _rule(c, tid, "disabled", False)
        _rule(c, other, "other tenant", True)  # same condition, other tenant: must not fire here

    monkeypatch.setattr(scan, "get_sync_engine", lambda: app)
    first = scan.run_exception_scan(vid, tid)
    assert "error" not in first and first["exceptions"] == 1
    rows = _custom_exceptions(app, tid)
    assert [(r[0], str(r[1]), r[2]) for r in rows] == [(enabled, assignee, 4)]

    again = scan.run_exception_scan(vid, tid)
    assert "error" not in again and again["exceptions"] == 0
    assert len(_custom_exceptions(app, tid)) == 1
    assert _custom_exceptions(app, other) == []


def test_rule_update_and_billing_routes(engines, monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.exceptions import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, assignee = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'E3')"), {"a": tid})
        rid = _rule(c, tid, "r", True, assignee)

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "E3", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            steward = {"X-User-Role": "steward"}
            url = f"/api/v1/exceptions/rules/{rid}"

            # omitted fields are kept
            r = (await c.put(url, headers=steward, json={"description": "new"})).json()
            assert (r["description"], str(r["auto_assign_to"]), r["name"]) == ("new", assignee, "r")
            # explicit null clears the assignee, leaves the rest
            r = (await c.put(url, headers=steward, json={"auto_assign_to": None})).json()
            assert r["auto_assign_to"] is None and r["description"] == "new" and r["is_active"] is True
            # null is invalid for non-nullable fields
            assert (await c.put(url, headers=steward, json={"name": None})).status_code == 422
            assert (await c.put(url, headers=steward, json={})).status_code == 400

            billing = "/api/v1/exceptions/billing?period=2026-09"
            assert (await c.get(billing, headers={"X-User-Role": "analyst"})).status_code == 403
            r = await c.get(billing, headers={"X-User-Role": "admin"})
            assert r.status_code == 200 and r.json()["period"] == "2026-09"
        await aeng.dispose()

    asyncio.run(scenario())

    with owner.begin() as c:
        assert c.execute(text("SELECT count(*) FROM exception_billing WHERE tenant_id = :t AND period = '2026-09'"),
                         {"t": tid}).scalar() == 1
