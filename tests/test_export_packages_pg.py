"""Export packages (migration 072): sha256 audit trail, four-eyes guard on export, diff.

Two distinct human users (maker/checker) over the real remediation router + LocalAuthMiddleware,
against a real Postgres (RLS enforced). Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import hashlib
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_export_app"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="module")
def app_engine():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": _ROOT})
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


def _seed_batch(app, tid, created_by):
    """Draft batch with two items that have proposals (mirrors remediation.store_batch's insert shape)."""
    from sqlalchemy import text

    bid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, filter, created_by, "
                       "created_by_label) VALUES (:b, :t, 'Batch', 'draft', '{}', CAST(:u AS uuid), 'maker@test')"),
                  {"b": bid, "t": tid, "u": created_by})
        for i, (rk, cur) in enumerate((("MATNR=1", "misc"), ("MATNR=2", None))):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, "
                           "record_key, grain, field, current_value, proposed_value, proposal_source) VALUES "
                           "(:t, :b, 'upload', 'material_master', 'LR-000001', :rk, 'MARA', 'MARA.MATKL', :cur, "
                           ":new, 'manual')"),
                      {"t": tid, "b": bid, "rk": rk, "cur": cur, "new": f"MG-{i}"})
    return bid


def test_export_records_sha256_and_requires_checker(app_engine):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.middleware.local_auth import LocalAuthMiddleware
    from api.routes.remediation import router as remediation_router

    owner, app_eng = app_engine
    tid = str(uuid.uuid4())
    maker_uid, checker_uid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D')"), {"t": tid})
    bid = _seed_batch(app_eng, tid, maker_uid)

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.add_middleware(LocalAuthMiddleware)
    api.include_router(remediation_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D", [])

    tokens = {"maker-token": {"sub": maker_uid, "email": "maker@test"},
             "checker-token": {"sub": checker_uid, "email": "checker@test"}}

    import api.middleware.local_auth as local_auth
    orig_load, orig_decode = local_auth._load_jwt_secret, local_auth.decode_access_token
    local_auth._load_jwt_secret = lambda: "test-secret"
    local_auth.decode_access_token = lambda token, secret: tokens.get(token)

    class _User:
        def __init__(self, client, token, role):
            self.client, self.headers = client, {"Authorization": f"Bearer {token}", "X-User-Role": role}

        async def post(self, path, **kw):
            return await self.client.post(path, headers=self.headers, **kw)

        async def get(self, path, **kw):
            return await self.client.get(path, headers=self.headers, **kw)

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            maker, checker = _User(c, "maker-token", "steward"), _User(c, "checker-token", "approver")

            assert (await maker.post(f"/api/v1/remediation/batches/{bid}/export?format=mdg_cr_json")).status_code == 409
            assert (await maker.post(f"/api/v1/remediation/batches/{bid}/approve")).status_code == 403  # maker != checker
            assert (await checker.post(f"/api/v1/remediation/batches/{bid}/approve")).status_code == 200

            bad = await checker.post(f"/api/v1/remediation/batches/{bid}/export?format=mdg_cr_json&cr_type=drop table")
            assert bad.status_code == 422
            bad = await checker.post(
                f"/api/v1/remediation/batches/{bid}/export?format=mdg_cr_json&cr_type={'A' * 41}")
            assert bad.status_code == 422
            # I1: an absent cr_type must 422, never silently default to a made-up CR type
            missing = await checker.post(f"/api/v1/remediation/batches/{bid}/export?format=mdg_cr_json")
            assert missing.status_code == 422
            assert "cr_type" in missing.json()["detail"]

            r = await checker.post(f"/api/v1/remediation/batches/{bid}/export?format=mass_maintenance_zip")
            assert r.status_code == 200
            assert r.headers["x-content-sha256"] == hashlib.sha256(r.content).hexdigest()

            # defence in depth: the creator still cannot export, even once the batch is approved
            assert (await maker.post(f"/api/v1/remediation/batches/{bid}/export?format=cockpit_csv")).status_code == 403

            pk = (await checker.get(f"/api/v1/remediation/batches/{bid}/packages")).json()["items"]
            assert pk[0]["sha256"] == r.headers["x-content-sha256"] and pk[0]["format"] == "mass_maintenance_zip"

            ev = (await checker.get(f"/api/v1/remediation/batches/{bid}/events")).json()["items"]
            assert any(e["action"] == "exported" and e["to_value"] == "mass_maintenance_zip" for e in ev)

            diff = (await checker.get(f"/api/v1/remediation/batches/{bid}/diff")).json()["records"]
            assert diff and diff[0]["changes"][0]["after"] is not None

    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"
    try:
        asyncio.run(scenario())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)
        local_auth._load_jwt_secret, local_auth.decode_access_token = orig_load, orig_decode
        asyncio.run(aeng.dispose())
