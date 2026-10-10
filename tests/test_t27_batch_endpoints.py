"""T27 G1-G3: batch rule history, per-module score series, version-keyed profile.

Runs against a real Postgres (RLS enforced) via MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import json
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_t27_app"


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


def _tenant(owner):
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T27')"), {"a": tid})
    return tid


def _asgi_client(router, tid, app_eng):
    """A minimal FastAPI app wrapping one router, tenant/db wired to the pg fixture's
    RLS-restricted role (not the migration-owner engine)."""
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T27", [])
    return api, aeng


def test_rules_history_batch(app_engine):
    """G1: GET /rules/history?version_id&module&limit_runs windows per check_id,
    in one query — not N+1 per check."""
    import asyncio
    from datetime import datetime, timedelta, timezone

    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    from api.routes.rules import router

    owner, app_eng = app_engine
    tid = _tenant(owner)
    sid = str(uuid.uuid4())
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    version_ids = [str(uuid.uuid4()) for _ in range(10)]
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for i, vid in enumerate(version_ids):
            c.execute(text("""
                INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata)
                VALUES (:v, :t, 'complete', :ra, CAST(:m AS jsonb))
            """), {"v": vid, "t": tid, "ra": base + timedelta(days=i),
                   "m": json.dumps({"system_id": sid})})
            c.execute(text("""
                INSERT INTO findings (id, tenant_id, version_id, module, check_id, severity, dimension,
                                      affected_count, total_count, pass_rate, details)
                VALUES (:id, :t, :v, 'material_master', 'MM001', 'high', 'completeness', :aff, 100, :pr, '{}'::jsonb)
            """), {"id": str(uuid.uuid4()), "t": tid, "v": vid, "aff": i, "pr": 100.0 - i})
        # a second check, only in half the runs
        for i, vid in enumerate(version_ids[-3:]):
            c.execute(text("""
                INSERT INTO findings (id, tenant_id, version_id, module, check_id, severity, dimension,
                                      affected_count, total_count, pass_rate, details)
                VALUES (:id, :t, :v, 'material_master', 'MM002', 'medium', 'completeness', 5, 50, 90.0, '{}'::jsonb)
            """), {"id": str(uuid.uuid4()), "t": tid, "v": vid})

    api, aeng = _asgi_client(router, tid, app_eng)
    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r = await c.get("/api/v1/rules/history",
                            params={"version_id": version_ids[-1], "module": "material_master", "limit_runs": 5},
                            headers={"X-User-Role": "viewer"})
            assert r.status_code == 200, r.text
            body = r.json()
            assert set(body["history"]) == {"MM001", "MM002"}
            assert len(body["history"]["MM001"]) == 5  # windowed to limit_runs, not all 10
            assert len(body["history"]["MM002"]) == 3  # fewer runs had it at all
            # newest run first
            assert body["history"]["MM001"][0]["version_id"] == version_ids[-1]
            assert body["history"]["MM001"][0]["hit_rate"] == 9.0  # affected 9 / total 100

            r404 = await c.get("/api/v1/rules/history",
                               params={"version_id": str(uuid.uuid4()), "module": "material_master"},
                               headers={"X-User-Role": "viewer"})
            assert r404.status_code == 404

    try:
        asyncio.run(scenario())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)
        asyncio.run(aeng.dispose())


def test_scores_history_per_module_series(app_engine):
    """G2: /scores/history's modules series aligns with the composite series by version_id."""
    import asyncio
    from datetime import datetime, timedelta, timezone

    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    from api.routes.findings import router

    owner, app_eng = app_engine
    tid = _tenant(owner)
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    v1, v2 = str(uuid.uuid4()), str(uuid.uuid4())
    summary1 = {"material_master": {"composite_score": 80.0, "total_checks": 10,
                                    "dimension_scores": {"completeness": 80.0},
                                    "dimension_coverage": {"completeness": 10}}}
    summary2 = {"material_master": {"composite_score": 90.0, "total_checks": 10,
                                    "dimension_scores": {"completeness": 90.0},
                                    "dimension_coverage": {"completeness": 10}},
                "business_partner": {"composite_score": 70.0, "total_checks": 5,
                                     "dimension_scores": {"completeness": 70.0},
                                     "dimension_coverage": {"completeness": 5}}}
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("""
            INSERT INTO analysis_versions (id, tenant_id, status, run_at, dqs_summary, metadata)
            VALUES (:v, :t, 'complete', :ra, CAST(:s AS jsonb), '{}'::jsonb)
        """), {"v": v1, "t": tid, "ra": base, "s": json.dumps(summary1)})
        c.execute(text("""
            INSERT INTO analysis_versions (id, tenant_id, status, run_at, dqs_summary, metadata)
            VALUES (:v, :t, 'complete', :ra, CAST(:s AS jsonb), '{}'::jsonb)
        """), {"v": v2, "t": tid, "ra": base + timedelta(days=1), "s": json.dumps(summary2)})

    api, aeng = _asgi_client(router, tid, app_eng)
    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r = await c.get("/api/v1/scores/history", headers={"X-User-Role": "viewer"})
            assert r.status_code == 200, r.text
            body = r.json()
            by_vid = {h["version_id"]: h for h in body["history"]}
            assert set(body["modules"]) == {"material_master", "business_partner"}
            mm_series = {row["version_id"]: row["composite"] for row in body["modules"]["material_master"]}
            assert mm_series[v1] == 80.0 and mm_series[v2] == 90.0
            bp_series = {row["version_id"]: row["composite"] for row in body["modules"]["business_partner"]}
            assert bp_series == {v2: 70.0}  # absent from v1, not padded with a null
            # the module series' composite equals what the composite history already reports per-module
            assert by_vid[v2]["under_current"]["modules"]["material_master"] == mm_series[v2]

    try:
        asyncio.run(scenario())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)
        asyncio.run(aeng.dispose())


def test_version_profile_without_system_id(app_engine):
    """G3: GET /versions/{version_id}/profile works for an upload-sourced version
    (no system_id at all), returning real tables instead of 404."""
    import asyncio

    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    from api.routes.field_profiles import by_version_router

    owner, app_eng = app_engine
    tid = _tenant(owner)
    vid = str(uuid.uuid4())
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        # metadata has no system_id — an upload-sourced run
        c.execute(text("""
            INSERT INTO analysis_versions (id, tenant_id, status, metadata)
            VALUES (:v, :t, 'complete', '{}'::jsonb)
        """), {"v": vid, "t": tid})
        c.execute(text("""
            INSERT INTO field_profiles (tenant_id, version_id, module, table_name, field, stats)
            VALUES (:t, :v, 'material_master', 'MARA', 'MATNR', CAST(:s AS jsonb))
        """), {"t": tid, "v": vid, "s": json.dumps({"rows": 10, "table_rows": 10, "blank": 0, "blank_pct": 0.0,
                                                    "distinct": 10})})

    api, aeng = _asgi_client(by_version_router, tid, app_eng)
    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r = await c.get(f"/api/v1/versions/{vid}/profile", params={"object": "material_master"},
                            headers={"X-User-Role": "viewer"})
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["object"] == "material_master"
            tables = {t["table"]: t for t in body["tables"]}
            assert "MARA" in tables and tables["MARA"]["fields"][0]["field"] == "MATNR"

            r404 = await c.get(f"/api/v1/versions/{uuid.uuid4()}/profile", headers={"X-User-Role": "viewer"})
            assert r404.status_code == 404

    try:
        asyncio.run(scenario())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)
        asyncio.run(aeng.dispose())
