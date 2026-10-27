"""GET /api/v1/rules/names against a real Postgres (RLS enforced, non-superuser role).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py); skipped otherwise.
The catalogue names a rule "<check id>: <words>" and its `id` is a UUID, so a check id is named by the part of the
name before the ':'. Covers: plain names by check id (prefix stripped, unknown ids left out, comma-separated and
repeated parameters), tenant isolation, the 500-id limit, and the RBAC gate (every role that can view rules).
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_rule_names_app"


@pytest.fixture(scope="module")
def app_engine():
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
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _rules(app, tid: str, rows: list[tuple[str, str]]) -> None:
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for name, module in rows:
            c.execute(text("INSERT INTO rules (tenant_id, name, module, category, severity) "
                           "VALUES (:t, :n, :m, 'ecc', 'high')"), {"t": tid, "n": name, "m": module})


@pytest.fixture()
def client_factory(app_engine, monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.rules import router

    _, app_eng = app_engine
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    who: dict[str, str] = {}
    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(who["tenant"]), "T", [])
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    def make(tid: str) -> AsyncClient:
        who["tenant"] = tid
        return AsyncClient(transport=ASGITransport(app=api), base_url="http://t")

    yield make
    import asyncio
    asyncio.run(aeng.dispose())


def test_names_by_check_id_tenant_scoped(app_engine, client_factory):
    import asyncio

    from sqlalchemy import text

    owner, app = app_engine
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'N1'), (:b, 'N2')"), {"a": tid, "b": other})
    _rules(app, tid, [("MM045: Material type missing", "material_master"),
                      ("AP001: Vendor is blocked", "accounts_payable"),
                      ("no prefix at all", "material_master")])
    # Another tenant's catalogue: names a rule this tenant also has, and one only it has.
    _rules(app, other, [("MM045: Someone else's words", "material_master"), ("SD777: Other tenant only", "sd")])

    async def scenario():
        h = {"X-User-Role": "viewer"}
        async with client_factory(tid) as c:
            r = await c.get("/api/v1/rules/names", headers=h, params={"check_ids": "MM045,AP001,SD777,ZZ999"})
            assert r.status_code == 200, r.text
            # plain words, no "ID: " prefix; the other tenant's rule and an unknown id are left out
            assert r.json() == {"names": {"MM045": "Material type missing", "AP001": "Vendor is blocked"}}
            # the parameter repeated works as well as comma-separated
            r = await c.get("/api/v1/rules/names", headers=h, params=[("check_ids", "MM045"), ("check_ids", "AP001")])
            assert r.json()["names"] == {"MM045": "Material type missing", "AP001": "Vendor is blocked"}
            # a name without a "<check id>:" prefix names no check
            r = await c.get("/api/v1/rules/names", headers=h, params={"check_ids": "no prefix at all"})
            assert r.json() == {"names": {}}
            assert (await c.get("/api/v1/rules/names", headers=h,
                                params={"check_ids": ",".join(f"X{i}" for i in range(501))})).status_code == 422
            assert (await c.get("/api/v1/rules/names", headers=h)).status_code == 422
        async with client_factory(other) as c:
            r = await c.get("/api/v1/rules/names", headers=h, params={"check_ids": "MM045,AP001,SD777"})
            assert r.json() == {"names": {"MM045": "Someone else's words", "SD777": "Other tenant only"}}

    asyncio.run(scenario())


def test_names_rbac_matches_reading_rules(app_engine, client_factory, monkeypatch):
    """Every role that can view (every role reading the rules list) gets names; without a user, nothing."""
    import asyncio

    from sqlalchemy import text

    from api.config import settings
    from api.services.rbac import PERMISSIONS, has_permission

    owner, app = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'N3')"), {"a": tid})
    _rules(app, tid, [("MM045: Material type missing", "material_master")])

    async def scenario():
        async with client_factory(tid) as c:
            for role in PERMISSIONS:
                r = await c.get("/api/v1/rules/names", headers={"X-User-Role": role}, params={"check_ids": "MM045"})
                assert r.status_code == (200 if has_permission(role, "view") else 403), role
                if r.status_code == 200:
                    assert r.json()["names"] == {"MM045": "Material type missing"}
            monkeypatch.setattr(settings, "auth_mode", "local")
            r = await c.get("/api/v1/rules/names", params={"check_ids": "MM045"})
            assert r.status_code == 403

    asyncio.run(scenario())


def test_names_route_is_not_shadowed_by_rule_id():
    from api.routes.rules import router

    paths = [r.path for r in router.routes]
    assert paths.index("/api/v1/rules/names") < paths.index("/api/v1/rules/{rule_id}")
