"""Per-object, per-version drill-down routes against a real Postgres (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_record_issues_pg.py); skipped otherwise.
Two runs of one system (v1 older, v2 newer), one run of another system (vx), one upload (vu):
  CHK-A  fails in both (v1: LIFNR=1,2 · v2: LIFNR=2)
  CHK-B  passes in v1, fails in v2           → newly failing
  CHK-C  fails in v1, passes in v2           → fixed
  CHK-E  errored in v1                       → no conclusion
  BP-1   business_partner, newly failing     → dropped by the module filter
"""

from __future__ import annotations

import json
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_drill_app"


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


def _version(c, tid, meta, dqs, days_ago):
    from sqlalchemy import text

    vid = str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                   "(:v, :t, 'complete', now() - make_interval(days => :d), CAST(:m AS jsonb), CAST(:q AS jsonb))"),
              {"v": vid, "t": tid, "d": days_ago, "m": json.dumps(meta), "q": json.dumps(dqs)})
    return vid


def _finding(c, tid, vid, check_id, keys, module="accounts_payable", error=None):
    from sqlalchemy import text

    c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                   "affected_count, total_count, details) VALUES (:v, :t, :m, :c, 'high', 'completeness', "
                   ":a, 10, CAST(:det AS jsonb))"),
              {"v": vid, "t": tid, "m": module, "c": check_id, "a": len(keys),
               "det": json.dumps({"error": error} if error else {})})
    for k in keys:
        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key) "
                       "VALUES (:t, :v, :c, :m, 'LFA1', :k)"),
                  {"t": tid, "v": vid, "c": check_id, "m": module, "k": f"LIFNR={k}"})


def _seed(app, tid):
    from sqlalchemy import text

    sid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD'), (:o, :t, 'QAS')"),
                  {"s": sid, "o": other, "t": tid})
        fs = [{"segment": "LFA1", "definition": "0001", "reason": "account group KRED", "account_groups": 1,
               "rules": 4}]
        v1 = _version(c, tid, {"system_id": sid, "modules": ["accounts_payable"], "field_status": fs},
                      {"accounts_payable": {"composite_score": 80.0,
                                            "dimension_scores": {"completeness": 70.0, "validity": 90.0}}}, 2)
        v2 = _version(c, tid, {"system_id": sid, "modules": ["accounts_payable", "business_partner"]},
                      {"accounts_payable": {"composite_score": 85.5,
                                            "dimension_scores": {"completeness": 80.0, "validity": 88.0}},
                       "business_partner": {"composite_score": 70.0, "dimension_scores": {}}}, 1)
        vx = _version(c, tid, {"system_id": other, "modules": ["accounts_payable"]}, {}, 1)
        vu = _version(c, tid, {"modules": ["accounts_payable"]}, {}, 3)
        for vid, fails in ((v1, {"CHK-A": ["1", "2"], "CHK-B": [], "CHK-C": ["9"], "CHK-E": []}),
                           (v2, {"CHK-A": ["2"], "CHK-B": ["5"], "CHK-C": [], "CHK-E": ["7"]})):
            for cid, keys in fails.items():
                _finding(c, tid, vid, cid, keys, error="boom" if (vid, cid) == (v1, "CHK-E") else None)
        _finding(c, tid, v1, "BP-1", [], module="business_partner")
        _finding(c, tid, v2, "BP-1", ["3"], module="business_partner")
        for cid, key, first, last in (("CHK-A", "LIFNR=1", v1, v1), ("CHK-A", "LIFNR=2", v1, v2),
                                      ("CHK-B", "LIFNR=5", v2, v2)):
            c.execute(text("INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, "
                           "severity, first_seen_version, last_seen_version) VALUES (:t, :s, 'accounts_payable', "
                           ":c, :k, 'LFA1', 'high', :f, :l)"),
                      {"t": tid, "s": sid, "c": cid, "k": key, "f": first, "l": last})
    return sid, v1, v2, vx, vu


def test_drilldown_routes(app_engine):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.record_issues import router as issues_router
    from api.routes.system_objects import router as objects_router
    from api.routes.versions import router as versions_router

    owner, app_eng = app_engine
    tid, stranger = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'D1'), (:b, 'D2')"), {"a": tid, "b": stranger})
    sid, v1, v2, vx, vu = _seed(app_eng, tid)

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    who = {"tenant": tid}
    api = FastAPI()
    for r in (issues_router, objects_router, versions_router):
        api.include_router(r)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(who["tenant"]), "D", [])

    async def scenario():
        h = {"X-User-Role": "analyst"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            # records of one check in one version
            r = (await c.get(f"/api/v1/versions/{v1}/findings/CHK-A/records", headers=h)).json()
            assert r["total"] == 2
            assert r["records"] == [{"record_key": "LIFNR=1", "grain": "LFA1", "module": "accounts_payable"},
                                    {"record_key": "LIFNR=2", "grain": "LFA1", "module": "accounts_payable"}]
            page = (await c.get(f"/api/v1/versions/{v1}/findings/CHK-A/records", headers=h,
                                params={"limit": 1, "offset": 1})).json()
            assert page["total"] == 2 and [x["record_key"] for x in page["records"]] == ["LIFNR=2"]
            assert (await c.get(f"/api/v1/versions/{uuid.uuid4()}/findings/CHK-A/records",
                                headers=h)).status_code == 404

            # issues filtered to the records failing in a version (list, counts and export)
            i1 = (await c.get("/api/v1/issues", headers=h, params={"version_id": v1})).json()
            assert sorted(i["record_key"] for i in i1["items"]) == ["LIFNR=1", "LIFNR=2"]
            assert i1["total"] == 2 and i1["counts"] == {"open": 2}
            i2 = (await c.get("/api/v1/issues", headers=h, params={"version_id": v2, "check_id": "CHK-B"})).json()
            assert [i["record_key"] for i in i2["items"]] == ["LIFNR=5"]
            assert (await c.get("/api/v1/issues", headers=h, params={"version_id": "nope"})).status_code == 422
            csv = await c.get("/api/v1/issues/export", headers={"X-User-Role": "steward"},
                              params={"format": "csv", "version_id": v2})
            assert csv.status_code == 200
            assert sorted(line.split(",")[4] for line in csv.text.strip().splitlines()[1:]) == ["LIFNR=2", "LIFNR=5"]

            # compare: per-object DQS + dimension deltas, checks newly failing / fixed
            cmp = (await c.get("/api/v1/versions/compare", headers=h, params={"v1": v1, "v2": v2})).json()
            ap = cmp["delta"]["accounts_payable"]
            assert ap["dqs_change"] == 5.5
            assert ap["dimensions"]["completeness"] == {"v1": 70.0, "v2": 80.0, "change": 10.0}
            assert [x["check_id"] for x in cmp["checks"]["newly_failing"]] == ["BP-1", "CHK-B"]
            assert [x["check_id"] for x in cmp["checks"]["fixed"]] == ["CHK-C"]  # CHK-E errored in v1
            one = (await c.get("/api/v1/versions/compare", headers=h,
                               params={"v1": v1, "v2": v2, "module": "accounts_payable"})).json()
            assert list(one["delta"]) == ["accounts_payable"]
            assert [x["check_id"] for x in one["checks"]["newly_failing"]] == ["CHK-B"]

            # versions of different systems are never compared; an upload may be
            for path in ("/api/v1/versions/compare", "/api/v1/versions/compare/records"):
                bad = await c.get(path, headers=h, params={"v1": v1, "v2": vx})
                assert bad.status_code == 400 and "different systems" in bad.json()["detail"]
            assert (await c.get("/api/v1/versions/compare/records/CHK-A", headers=h,
                                params={"v1": vx, "v2": v2})).status_code == 400
            assert (await c.get("/api/v1/versions/compare", headers=h,
                                params={"v1": vu, "v2": v2})).status_code == 200

            # versions list per system
            listed = (await c.get("/api/v1/versions", headers=h, params={"system_id": sid})).json()["versions"]
            assert [v["id"] for v in listed] == [v2, v1]

            # field-status summary on the system's versions
            sv = {v["id"]: v for v in (await c.get(f"/api/v1/systems/{sid}/versions", headers=h)).json()["versions"]}
            assert sv[v1]["field_status"] == [{"segment": "LFA1", "definition": "0001",
                                               "reason": "account group KRED", "rules": 4}]
            assert sv[v2]["field_status"] == []

            # another tenant sees none of it
            who["tenant"] = stranger
            assert (await c.get(f"/api/v1/versions/{v1}/findings/CHK-A/records", headers=h)).status_code == 404
            assert (await c.get("/api/v1/issues", headers=h, params={"version_id": v1})).json()["total"] == 0

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
