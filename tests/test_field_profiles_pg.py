"""Field profiles (migration 051) + profile route against a real Postgres (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import json
import os
import uuid

import numpy as np
import pandas as pd
import pytest

from checks.frames import TableFrames
from sap.ddic import get_dictionary

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_profile_app"


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
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{_ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _frames(n=400, violators=3):
    types = np.array(["FERT", "HALB", "ROH", "HAWA"])[np.arange(n) % 4]
    sector = np.array([{"FERT": "M", "HALB": "M", "ROH": "C", "HAWA": "A"}[t] for t in types])
    sector[:violators] = "X"
    mara = pd.DataFrame({"MARA.MATNR": [f"{i + 1:018d}" for i in range(n)], "MARA.MTART": types,
                         "MARA.MBRSH": sector, "MARA.ERSDA": ["20240101"] * n})
    makt = pd.DataFrame({"MAKT.MATNR": [f"{i + 1:018d}" for i in range(n)], "MAKT.SPRAS": ["E"] * n,
                         "MAKT.MAKTX": [f"Bolt M{i % 7}" for i in range(n)]})
    return TableFrames({"MARA": mara, "MAKT": makt}, get_dictionary("ecc6"), module="material_master")


def _version(owner, app, sid):
    from sqlalchemy import text

    tid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'P')"), {"a": tid})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": sid, "modules": ["material_master"]})})
    return tid, vid


def _count(app, tid, table):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return c.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()


def test_profile_store_is_idempotent_and_isolated(app_engine):
    from api.services.field_profiles import profile_and_store

    owner, app = app_engine
    sid = str(uuid.uuid4())
    tid, vid = _version(owner, app, sid)
    other, _ = _version(owner, app, str(uuid.uuid4()))
    frames = _frames()

    first = profile_and_store(app, tid, vid, "material_master", frames, frames.dictionary)
    assert first["fields"] == 7 and first["dependencies"] == 1
    again = profile_and_store(app, tid, vid, "material_master", frames, frames.dictionary)
    assert again == first
    assert _count(app, tid, "field_profiles") == 7 and _count(app, tid, "field_dependencies") == 1
    assert _count(app, other, "field_profiles") == 0  # RLS: the other tenant sees nothing

    # a failure is swallowed (and logged): the analysis carries on
    assert profile_and_store(app, tid, str(uuid.uuid4()), "material_master", frames, frames.dictionary) is None


def test_profile_api(app_engine):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.field_profiles import router
    from api.services.field_profiles import profile_and_store

    owner, app_eng = app_engine
    sid = str(uuid.uuid4())
    tid, vid = _version(owner, app_eng, sid)
    frames = _frames()
    profile_and_store(app_eng, tid, vid, "material_master", frames, frames.dictionary)
    other_tid, other_vid = _version(owner, app_eng, sid)
    profile_and_store(app_eng, other_tid, other_vid, "material_master", frames, frames.dictionary)

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "P", [])
    hdr = {"X-User-Role": "viewer"}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            url = f"/api/v1/systems/{sid}/versions/{vid}/profile"
            r = await c.get(url, headers=hdr, params={"object": "material_master"})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["object"] == "material_master" and body["objects"] == ["material_master"]
            tables = {t["table"]: t for t in body["tables"]}
            assert set(tables) == {"MAKT", "MARA"} and tables["MARA"]["rows"] == 400
            fields = {f["field"]: f["stats"] for f in tables["MARA"]["fields"]}
            assert [f["field"] for f in tables["MARA"]["fields"]] == ["MATNR", "MTART", "MBRSH", "ERSDA"]
            assert fields["MTART"]["top_values"][0] == {"value": "FERT", "count": 100}
            assert fields["ERSDA"]["dates"]["min"] == "2024-01-01"
            maktx = {f["field"]: f["stats"] for f in tables["MAKT"]["fields"]}["MAKTX"]
            assert maktx["masked"] and maktx["top_values"] is None  # DDIC length 40: not a code field
            assert body["dependencies"] == [{
                "table": "MARA", "determinant": "MARA.MTART", "dependent": "MARA.MBRSH", "support": 0.9925,
                "rows": 400, "violations": 3,
                "sample_keys": ["MATNR=000000000000000001", "MATNR=000000000000000002", "MATNR=000000000000000003"],
                "accepted": False}]

            # default object = first profiled one
            assert (await c.get(url, headers=hdr)).json()["object"] == "material_master"
            # an object without a profile is empty, not an error
            empty = (await c.get(url, headers=hdr, params={"object": "fi_gl"})).json()
            assert empty["tables"] == [] and empty["dependencies"] == []
            # version of another system / another tenant → 404, no internals leaked
            r = await c.get(f"/api/v1/systems/{uuid.uuid4()}/versions/{vid}/profile", headers=hdr)
            assert r.status_code == 404 and r.json() == {"detail": "Version not found for this system"}
            r = await c.get(f"/api/v1/systems/{sid}/versions/{other_vid}/profile", headers=hdr)
            assert r.status_code == 404

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"
    try:
        asyncio.run(main())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)
