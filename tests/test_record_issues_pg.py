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


def test_hq_rule_governance_round_trip(app_engine, monkeypatch):
    """Manifest sync lands in rules_hq_cache; load_overrides reads it (+ tenant toggle)."""
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    import workers.db as wdb
    from api.deps import _DEV_TENANT
    from api.middleware.licence import _do_sync_manifest
    from checks.overrides import load_overrides

    owner, app = app_engine
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Dev') ON CONFLICT DO NOTHING"),
                  {"t": str(_DEV_TENANT.id)})
    monkeypatch.setattr(wdb, "_engine", app)
    _do_sync_manifest([{"id": "BP001", "enabled": False}, {"id": "BP002", "severity": "critical"}],
                      [{"module": "business_partner", "standard_field": "BUT000.BU_TYPE", "customer_field": "ZTYPE"}])
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": str(_DEV_TENANT.id)})
        o = load_overrides(s)
        assert o["BP001"]["enabled"] is False and o["BP002"]["severity"] == "critical"
        assert s.execute(text("SELECT customer_field FROM field_mappings WHERE standard_field = 'BUT000.BU_TYPE'")).scalar() == "ZTYPE"


def test_versions_and_trends_per_object(app_engine):
    """Three analysed downloads of one system: deltas, comparability flags, baseline, re-analyse gate."""
    import asyncio
    from unittest.mock import patch

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.system_objects import router as objects_router
    from api.routes.versions import router as versions_router

    owner, app_eng = app_engine
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T6')"), {"a": tid})
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": tid})
        vids = []
        for i, (dqs, rows, scope, rules, failing) in enumerate([
            (80.0, 100, {}, "r1", ["1", "2", "3"]),
            (86.0, 104, {}, "r1", ["2"]),
            (90.0, 60, {"company_codes": ["1000"]}, "r2", []),
        ]):
            vid = str(uuid.uuid4())
            vids.append(vid)
            meta = {"system_id": sid, "modules": ["accounts_payable"], "object_rows": {"accounts_payable": rows},
                    "scope": scope, "rule_set": rules, "dataset_path": f"staging/{vid}/",
                    **({"baseline": True} if i == 0 else {})}
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) "
                           "VALUES (:v, :t, 'complete', now() - make_interval(days => :d), CAST(:m AS jsonb), "
                           "CAST(:q AS jsonb))"),
                      {"v": vid, "t": tid, "d": 10 - i, "m": json.dumps(meta),
                       "q": json.dumps({"accounts_payable": {"composite_score": dqs, "dimension_scores": {"completeness": dqs}}})})
            for k in failing:
                c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, record_key) "
                               "VALUES (:t, :v, 'AP001', 'accounts_payable', :k)"), {"t": tid, "v": vid, "k": f"LIFNR={k}"})

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(objects_router)
    api.include_router(versions_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T6", [])

    async def scenario():
        h = {"X-User-Role": "analyst"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            vs = (await c.get(f"/api/v1/systems/{sid}/versions", headers=h)).json()["versions"]
            assert [v["records"]["accounts_payable"] for v in vs] == [60, 104, 100]  # newest first
            t = (await c.get(f"/api/v1/systems/{sid}/trends", headers=h, params={"object": "accounts_payable"})).json()
            pts = t["series"]["accounts_payable"]
            assert [p["failing_records"] for p in pts] == [3, 1, 0]
            assert pts[1]["dqs_delta"] == 6.0 and pts[1]["failing_records_delta"] == -2 and pts[1]["comparable"]
            assert set(pts[2]["flags"]) == {"scope_changed", "rules_changed", "volume_shift"}
            s = t["summary"][0]
            assert s["vs_baseline"] == {"version_id": vids[0], "pinned": True, "dqs_delta": 10.0,
                                        "failing_records_delta": -3}
            with patch("workers.tasks.run_checks.run_checks.delay") as delay:
                delay.return_value.id = "job-1"
                r = await c.post(f"/api/v1/versions/{vids[1]}/analyse", headers={"X-User-Role": "steward"})
                assert r.status_code == 202
                assert delay.call_args.kwargs["reanalyse"] is True
                again = await c.post(f"/api/v1/versions/{vids[1]}/analyse", headers={"X-User-Role": "steward"})
                assert again.status_code == 409  # already pending

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


def test_postal_code_reference_upload_feeds_the_rules(app_engine):
    """Upload an official postal-code list → stored per system under RLS → loaded with the
    system's configuration → PX- rules generated for the countries it covers."""
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.orm import Session

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.system_objects import router as objects_router
    from checks.country_rules import generate
    from checks.field_status_rules import load_config

    owner, app_eng = app_engine
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T7')"), {"a": tid})
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": tid})
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(objects_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T7", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            csv = "country,postcode\nZA,2196\nza,0700\nZA,=CMD()\nGB,SW1A 1AA\n"
            r = await c.post(f"/api/v1/systems/{sid}/reference/postal-codes", content=csv.encode(),
                             headers={"X-User-Role": "analyst"})
            assert r.status_code == 403  # managing a system's reference data is an admin action
            r = await c.post(f"/api/v1/systems/{sid}/reference/postal-codes", content=csv.encode(),
                             headers={"X-User-Role": "admin"})
            assert r.status_code == 200 and r.json() == {"kind": "postal-codes", "records": 3,
                                                         "countries": ["GB", "ZA"]}  # formula row rejected
            bics = "BIC\nSBZAZAJJ\nfirnzajj903\nNOT-A-BIC\n"
            r = await c.post(f"/api/v1/systems/{sid}/reference/bic", content=bics.encode(),
                             headers={"X-User-Role": "analyst"})
            assert r.status_code == 403
            r = await c.post(f"/api/v1/systems/{sid}/reference/bic", content=bics.encode(),
                             headers={"X-User-Role": "admin"})
            assert r.status_code == 200 and r.json() == {"kind": "bic", "records": 2, "countries": ["ZA"]}
            lists = (await c.get(f"/api/v1/systems/{sid}/reference", headers={"X-User-Role": "analyst"})).json()
            assert lists == [{"kind": "bic", "records": 2, "countries": ["ZA"]},
                             {"kind": "postal-codes", "records": 3, "countries": ["GB", "ZA"]}]

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
    with Session(app_eng) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        config = load_config(s, sid)
    assert len(config["REF_POSTAL"]) == 3
    assert sorted(r["BIC"] for r in config["REF_BIC"]) == ["FIRNZAJJ903", "SBZAZAJJXXX"]
    rules = generate("accounts_payable", [{"field": "LFA1.LIFNR", "check_class": "null_check"}], config,
                     get_dictionary("ecc6"))
    px = next(r for r in rules if r["id"] == "PX-LFA1-PSTLZ")
    assert px["countries"] == ["GB", "ZA"] and "ZA|0700" in px["keys"]


def test_pilot_scorecard_precision_and_recall(app_engine):
    """Steward decisions on issues → precision per rule; uploaded known issues → recall; RLS-scoped."""
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.pilot import router as pilot_router

    owner, app_eng = app_engine
    tid, other, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'T8'), (:b, 'T9')"), {"a": tid, "b": other})
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": tid})
    vendors = [str(i) for i in range(1, 13)]
    _run(app_eng, tid, sid, [_result("CHK-A", vendors, total=12)], vendors)
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for k, res in [("1", "false_positive"), ("2", "false_positive")] + [(str(i), "fixed_in_source")
                                                                           for i in range(3, 12)]:
            c.execute(text("UPDATE record_issues SET status = 'resolved', resolution = :r WHERE record_key = :k"),
                      {"r": res, "k": f"LIFNR={k}"})
    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(pilot_router)
    api.dependency_overrides[get_db] = _db
    who = {"tenant": tid}
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(who["tenant"]), "T", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            csv = ("object,record,note\naccounts_payable,1,duplicate vendor\n,LIFNR=0000000005,\n"
                   "accounts_payable,99,known bad\nfi_gl,7,\n=HYPERLINK(1),x,\n")
            url = f"/api/v1/systems/{sid}/pilot"
            r = await c.post(f"{url}/known-issues", content=csv.encode(), headers={"X-User-Role": "analyst"})
            assert r.status_code == 403
            r = await c.post(f"{url}/known-issues", content=csv.encode(), headers={"X-User-Role": "admin"})
            assert r.status_code == 200 and r.json() == {"records": 4, "rejected": 1}
            card = (await c.get(f"{url}/scorecard", headers={"X-User-Role": "analyst"})).json()
            assert card["precision"]["reviewed"] == 11 and card["precision"]["false_positives"] == 2
            [rule] = card["rules"]
            assert rule["check_id"] == "CHK-A" and rule["flagged"] == 12 and rule["open"] == 1
            assert rule["precision"] == round(9 / 11, 4) and rule["needs_tuning"]
            rec = card["recall"]
            assert (rec["known"], rec["caught"], rec["missed_total"]) == (4, 2, 2)
            assert {m["record_ref"] for m in rec["missed"]} == {"99", "7"} and rec["objects_not_analysed"] == ["fi_gl"]
            who["tenant"] = other   # another tenant sees neither the system nor its lists
            r = await c.get(f"{url}/scorecard", headers={"X-User-Role": "admin"})
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
