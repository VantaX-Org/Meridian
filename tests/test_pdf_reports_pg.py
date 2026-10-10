"""PDF report loaders and routes against a real Postgres with RLS enforced.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_record_issues_pg.py); skipped otherwise.
Tenant A owns two runs of one system and one upload; tenant B owns nothing and must
not be able to render any of A's reports.
"""

from __future__ import annotations

import json
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")
pytest.importorskip("weasyprint")

_ROLE = "meridian_pdf_app"


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


def _seed(owner, app):
    from sqlalchemy import text

    from tests import pdf_fixtures as fx

    a, b, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'Tenant A'), (:b, 'Tenant B')"), {"a": a, "b": b})
    vids = {}
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": a})
        for key, v, findings, days in (("v1", fx.V1, fx.FINDINGS1, 30), ("v2", fx.V2, fx.FINDINGS2, 1),
                                       ("upload", {**fx.V1, "metadata": {"modules": ["business_partner"]}}, [], 2)):
            vid = vids[key] = str(uuid.uuid4())
            meta = {**v["metadata"], "system_id": sid} if key != "upload" else v["metadata"]
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:v, :t, :l, 'complete', now() - make_interval(days => :d), "
                           "CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                      {"v": vid, "t": a, "l": v["label"], "d": days, "m": json.dumps(meta),
                       "q": json.dumps(v["dqs_summary"])})
            for f in findings:
                c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                               "affected_count, total_count, pass_rate, details) VALUES (:v, :t, :m, :c, :s, :d, "
                               ":a, :n, :p, CAST(:det AS jsonb))"),
                          {"v": vid, "t": a, "m": f["module"], "c": f["check_id"], "s": f["severity"],
                           "d": f["dimension"], "a": f["affected_count"], "n": f["total_count"],
                           "p": f["pass_rate"], "det": json.dumps(f["details"])})
    return a, b, vids


def test_reports_are_tenant_scoped(app_engine, monkeypatch):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    import workers.db
    from api.deps import Tenant, get_db, get_tenant
    from api.routes.reports import router
    from api.services.pdf_reports import build
    from workers.db import tenant_session

    owner, app_eng = app_engine
    a, b, v = _seed(owner, app_eng)

    with tenant_session(app_eng, a) as s:
        for kind, vid, vid1 in (("analysis", v["v2"], None), ("extraction", v["v2"], None),
                                ("cleaning", v["v2"], None), ("cleaning", None, None),
                                ("comparison", v["v2"], v["v1"]), ("executive", v["v2"], None)):
            assert build(s, a, kind, vid, vid1).startswith(b"%PDF"), kind
        assert build(s, a, "extraction", v["upload"]) is None  # an upload has no extraction report

    with tenant_session(app_eng, b) as s:
        for kind, vid, vid1 in (("analysis", v["v2"], None), ("extraction", v["v2"], None),
                                ("cleaning", v["v2"], None), ("comparison", v["v2"], v["v1"]),
                                ("executive", v["v2"], None)):
            assert build(s, b, kind, vid, vid1) is None, kind

    monkeypatch.setattr(workers.db, "get_sync_engine", lambda: app_eng)
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    who = {"tenant": a}
    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(who["tenant"]), "T", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            for url in (f"/api/v1/reports/analysis/{v['v2']}.pdf", f"/api/v1/reports/extraction/{v['v2']}.pdf",
                        f"/api/v1/reports/cleaning.pdf?version_id={v['v2']}", "/api/v1/reports/cleaning.pdf",
                        f"/api/v1/reports/compare.pdf?v2={v['v2']}"):
                r = await c.get(url)
                assert r.status_code == 200, (url, r.text)
                assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
            assert (await c.get(f"/api/v1/reports/extraction/{v['upload']}.pdf")).status_code == 404
            assert (await c.get("/api/v1/reports/compare.pdf?v2=nope")).status_code == 422
            who["tenant"] = b
            for url in (f"/api/v1/reports/analysis/{v['v2']}.pdf", f"/api/v1/reports/extraction/{v['v2']}.pdf",
                        f"/api/v1/reports/cleaning.pdf?version_id={v['v2']}",
                        f"/api/v1/reports/compare.pdf?v2={v['v2']}&v1={v['v1']}"):
                assert (await c.get(url)).status_code == 404, url
        await aeng.dispose()

    asyncio.run(scenario())


def test_summary_section_shows_previous_run_delta(app_engine):
    """T17: analysis/executive reports for v2 pick up v1 (same system lineage,
    earlier run_at) as the previous run and show a DQS delta; the upload run
    has no earlier run in its own ('upload') lineage, so it shows no delta."""
    from api.routes.findings import composite_dqs
    from api.services.pdf_reports import load_previous_dqs, load_version
    from workers.db import tenant_session

    owner, app_eng = app_engine
    a, b, v = _seed(owner, app_eng)

    with tenant_session(app_eng, a) as s:
        v1 = load_version(s, a, v["v1"])
        v2 = load_version(s, a, v["v2"])
        upload = load_version(s, a, v["upload"])
        assert load_previous_dqs(s, a, v1) is None  # nothing earlier in this lineage
        assert load_previous_dqs(s, a, v2) == pytest.approx(composite_dqs([v1["dqs_summary"]])["composite"])
        assert load_previous_dqs(s, a, upload) is None  # upload lineage has only itself so far

        from api.services.pdf_reports import build
        pdf = build(s, a, "analysis", v["v2"])
        assert pdf.startswith(b"%PDF")


def test_object_report_404_for_unknown_module_and_tenant_scoped(app_engine):
    """T18: the object report 404s for a module the rule catalogue does not know, renders
    for a real one with findings, and is tenant-scoped like every other report."""
    from api.services.pdf_reports import build
    from workers.db import tenant_session

    owner, app_eng = app_engine
    a, b, v = _seed(owner, app_eng)

    with tenant_session(app_eng, a) as s:
        assert build(s, a, "object", v["v2"], module="not_a_real_module") is None
        pdf = build(s, a, "object", v["v2"], module="material_master")
        assert pdf.startswith(b"%PDF")

    with tenant_session(app_eng, b) as s:
        assert build(s, b, "object", v["v2"], module="material_master") is None


def test_record_report_404_without_extracted_dataset(app_engine):
    """T19: the record report 404s when the run has no dataset_path (nothing was
    extracted into object storage for it, as in this fixture's seeded runs)."""
    from api.services.pdf_reports import build
    from workers.db import tenant_session

    owner, app_eng = app_engine
    a, b, v = _seed(owner, app_eng)

    with tenant_session(app_eng, a) as s:
        assert build(s, a, "record", v["v2"], matnr="100-100") is None
