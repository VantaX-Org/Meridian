"""Record-level findings + issue lifecycle against a real Postgres (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
Three runs of the same system:
  v1  vendors 1,2 fail CHK-A           → 2 issues opened
  v2  vendor 1 fixed, 3 fails, 2 absent → 1 auto-resolved, 2 untouched (not in extract), 1 new
  v3  vendor 1 fails again              → re-opened
"""

from __future__ import annotations

import json
import os
import uuid

import pandas as pd
import pytest

from checks.base import CheckResult
from checks.frames import TableFrames
from sap.ddic import get_dictionary

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


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
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = 'meridian_issue_app'")).scalar():
            c.execute(text("DROP OWNED BY meridian_issue_app CASCADE"))
        c.execute(text("DROP ROLE IF EXISTS meridian_issue_app"))
        c.execute(text("CREATE ROLE meridian_issue_app LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text("GRANT USAGE, CREATE ON SCHEMA public TO meridian_issue_app"))
        c.execute(text("GRANT ALL ON ALL TABLES IN SCHEMA public TO meridian_issue_app"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"meridian_issue_app:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text("DROP OWNED BY meridian_issue_app CASCADE"))
        c.execute(text("DROP ROLE meridian_issue_app"))
    owner.dispose()


def _result(check_id, keys, total=3, error=None, truncated=False):
    details = {"record_key_fields": ["LFA1.LIFNR"]}
    if truncated:
        details["failing_keys_truncated"] = True
    return CheckResult(check_id=check_id, module="accounts_payable", field="LFA1.NAME1", severity="high",
                       dimension="completeness", passed=not keys, affected_count=len(keys), total_count=total,
                       pass_rate=100.0, message="", details=details, error=error,
                       failing_record_keys=[f"LIFNR={k}" for k in keys], grain="LFA1")


def _frames(vendors):
    return TableFrames({"LFA1": pd.DataFrame({"LFA1.LIFNR": vendors, "LFA1.NAME1": ["x"] * len(vendors)})},
                       get_dictionary("ecc6"), module="accounts_payable")


def _run(app, tid, sid, results, vendors):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.record_issues import track

    vid = str(uuid.uuid4())
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        s.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": sid})})
        for r in results:
            s.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count, details) VALUES (:v, :t, :m, :c, :sev, :d, :a, :n, "
                           "CAST(:det AS jsonb))"),
                      {"v": vid, "t": tid, "m": r.module, "c": r.check_id, "sev": r.severity, "d": r.dimension,
                       "a": r.affected_count, "n": r.total_count,
                       "det": json.dumps({**r.details, **({"error": r.error} if r.error else {})})})
        with s.begin_nested():
            stats = track(s, tid, vid, sid, results, _frames(vendors))
        s.commit()
    return vid, stats


def _issues(app, tid):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return {(r.check_id, r.record_key): r for r in c.execute(text("SELECT * FROM record_issues"))}


def test_lifecycle_and_diff(app_engine):
    from sqlalchemy import text

    from api.services.record_issues import DIFF_SQL, diff_records_sql

    owner, app = app_engine
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T1'), (:b, 'T2')"), {"a": tid, "b": other})
    sid = str(uuid.uuid4())

    v1, st1 = _run(app, tid, sid, [_result("CHK-A", ["1", "2"]), _result("CHK-ERR", ["1"])], ["1", "2", "3"])
    assert st1 == {"failing_records": 3, "created": 3, "reopened": 0, "auto_resolved": 0}

    # vendor 2 is not in the second extract; CHK-ERR errored this time
    v2, st2 = _run(app, tid, sid, [_result("CHK-A", ["3"]), _result("CHK-ERR", [], error="boom")], ["1", "3"])
    assert st2["created"] == 1 and st2["auto_resolved"] == 1
    iss = _issues(app, tid)
    assert iss[("CHK-A", "LIFNR=1")].status == "resolved"
    assert iss[("CHK-A", "LIFNR=1")].resolution == "verified_fixed"
    assert iss[("CHK-A", "LIFNR=2")].status == "open"      # absent from extract → never assumed fixed
    assert iss[("CHK-ERR", "LIFNR=1")].status == "open"    # errored check → no conclusion
    assert iss[("CHK-A", "LIFNR=3")].status == "open"

    v3, st3 = _run(app, tid, sid, [_result("CHK-A", ["1", "3"])], ["1", "3"])
    assert st3["reopened"] == 1
    iss = _issues(app, tid)
    assert iss[("CHK-A", "LIFNR=1")].status == "open" and iss[("CHK-A", "LIFNR=1")].reopened_count == 1

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        d = {r.check_id: r for r in c.execute(text(DIFF_SQL), {"v1": v1, "v2": v2})}
        assert (d["CHK-A"].new, d["CHK-A"].resolved, d["CHK-A"].persisting) == (1, 2, 0)
        assert d["CHK-ERR"].ran_v1 and not d["CHK-ERR"].ran_v2
        rows = c.execute(text(diff_records_sql("resolved")),
                         {"v1": v1, "v2": v2, "cid": "CHK-A", "q": None, "limit": 10, "offset": 0}).fetchall()
        assert [r[0] for r in rows] == ["LIFNR=1", "LIFNR=2"]
        events = c.execute(text("SELECT action FROM record_issue_events ORDER BY created_at")).scalars().all()
        assert events == ["auto_resolved", "reopened"]

    # tenant isolation: the other tenant sees nothing
    assert _issues(app, other) == {}


def test_issue_and_diff_api(app_engine):
    """Routes against the same database, through asyncpg, as a non-superuser."""
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.record_issues import router as issues_router
    from api.routes.versions import router as versions_router

    owner, app_eng = app_engine
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T3')"), {"a": tid})
    v1, _ = _run(app_eng, tid, sid, [_result("CHK-A", ["1", "2"])], ["1", "2"])
    v2, _ = _run(app_eng, tid, sid, [_result("CHK-A", ["2"])], ["1", "2"])

    url = app_eng.url.set(drivername="postgresql+asyncpg")
    aeng = create_async_engine(url)
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(issues_router)
    api.include_router(versions_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T3", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            steward, analyst = {"X-User-Role": "steward"}, {"X-User-Role": "analyst"}
            r = (await c.get("/api/v1/issues", headers=analyst)).json()
            assert r["counts"] == {"open": 1, "resolved": 1}
            open_id = next(i["id"] for i in r["items"] if i["status"] == "open")
            assert next(i for i in r["items"] if i["status"] == "open")["record_key"] == "LIFNR=2"

            # analyst may comment but not accept risk
            assert (await c.post("/api/v1/issues/bulk", headers=analyst,
                                 json={"ids": [open_id], "status": "accepted", "resolution": "accepted_risk"})).status_code == 403
            assert (await c.post(f"/api/v1/issues/{open_id}/comments", headers=analyst,
                                 json={"body": "Vendor owner contacted"})).status_code == 200
            # accepting needs a resolution
            assert (await c.post("/api/v1/issues/bulk", headers=steward,
                                 json={"ids": [open_id], "status": "accepted"})).status_code == 400
            ok = await c.post("/api/v1/issues/bulk", headers=steward,
                              json={"ids": [open_id], "status": "accepted", "resolution": "accepted_risk",
                                    "note": "Signed off by AP lead"})
            assert ok.json() == {"updated": 1}
            d = (await c.get(f"/api/v1/issues/{open_id}", headers=analyst)).json()
            assert d["issue"]["status"] == "accepted"
            assert [e["action"] for e in d["events"]] == ["comment", "status"]
            assert [run["failing"] for run in d["runs"]] == [True, True]

            diff = (await c.get("/api/v1/versions/compare/records", headers=analyst, params={"v2": v2})).json()
            assert diff["v1"] == v1 and diff["totals"] == {"new": 0, "resolved": 1, "persisting": 1}
            keys = (await c.get("/api/v1/versions/compare/records/CHK-A", headers=analyst,
                                params={"v2": v2, "change": "resolved"})).json()["record_keys"]
            assert keys == ["LIFNR=1"]
            pin = await c.post(f"/api/v1/versions/{v1}/baseline", headers=steward)
            assert pin.json()["baseline"] is True

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


def test_contract_evaluation_dedupes_exception(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.contract_compliance import evaluate_freshness, evaluate_run

    owner, app = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T4')"), {"a": tid})
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        s.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, quality_contract, "
                       "volume_contract, freshness_contract, status) VALUES (:t, 'BP quality', "
                       "'SAP business_partner', 'Finance', '{\"min_dqs\": 90}', '{\"min_records\": 10}', "
                       "'{\"max_age_hours\": 24}', 'active')"), {"t": tid})
        for score in (80.0, 85.0):
            vid = str(uuid.uuid4())
            s.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata, dqs_summary) VALUES "
                           "(:v, :t, 'complete', CAST(:m AS jsonb), CAST(:d AS jsonb))"),
                      {"v": vid, "t": tid,
                       "m": json.dumps({"modules": ["business_partner"], "module_rows": {"business_partner": 4}}),
                       "d": json.dumps({"business_partner": {"composite_score": score, "dimension_scores": {}}})})
            res = evaluate_run(s, tid, vid)
            assert [(r["compliant"], r["violations"]) for r in res] == [(False, 2)]  # dqs + volume
        assert evaluate_freshness(s, tid)[0]["fresh"] is True
        s.commit()
        exc = s.execute(text("SELECT description FROM exceptions WHERE type = 'contract_violation'")).fetchall()
        assert len(exc) == 1 and "dqs 85.0 < 90.0" in exc[0][0]
        hist = s.execute(text("SELECT overall_compliant FROM contract_compliance_history")).scalars().all()
        assert hist == [False, False]


def test_master_record_merge(app_engine):
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from api.services.mdm_merge import merge_master_records

    owner, app = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T5')"), {"a": tid})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for key, fields in (("100", {"NAME_ORG1": "Acme", "BU_GROUP": ""}),
                            ("200", {"NAME_ORG1": "ACME Ltd", "BU_GROUP": "BP01", "TAXNUM": "ZA1"})):
            c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) "
                           "VALUES (:t, 'business_partner', :k, CAST(:f AS jsonb), 'golden')"),
                      {"t": tid, "k": key, "f": json.dumps(fields)})

    aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))

    async def go():
        from sqlalchemy.ext.asyncio import AsyncSession
        try:
            async with AsyncSession(aeng) as db:
                await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
                res = await merge_master_records(db, tid, "business_partner", "100", "200", None,
                                                 {"TAXNUM": "ZA9"})
                assert await merge_master_records(db, tid, "business_partner", "100", "999", None) is None
                await db.commit()
                return res
        finally:
            await aeng.dispose()

    res = asyncio.run(go())
    assert sorted(res["filled_fields"]) == ["BU_GROUP", "TAXNUM"]
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        rec = {r.sap_object_key: r for r in c.execute(text("SELECT * FROM master_records"))}
        assert rec["100"].golden_fields == {"NAME_ORG1": "Acme", "BU_GROUP": "BP01", "TAXNUM": "ZA9"}
        assert rec["100"].source_contributions["TAXNUM"]["source_system"] == "steward_override"
        assert rec["200"].status == "superseded"
        kinds = sorted(c.execute(text("SELECT change_type FROM master_record_history")).scalars())
        assert kinds == ["merged", "superseded"]
