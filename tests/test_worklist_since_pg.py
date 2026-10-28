"""Fix work's ``since=<baseline run>`` filter (api/routes/work.py) against a real Postgres.

The object monitoring strip says "N new failing records" against its baseline; ``since`` opens exactly those: the
records of the run that fail a check they did not fail in the baseline run, read from ``finding_records`` of both runs
(primary key version, check, record: an index lookup per key). Checks a run did not evaluate in full (an error, or
failing keys cut at the cap) are left out, as the run compare leaves them out of the count.

Baseline B (material master):  MM001 fails MATNR=1, 2     MM002 fails MATNR=2     MM003 (keys cut)  fails MATNR=1
Current  C (material master):  MM001 fails MATNR=1, 2, 3  MM002 fails MATNR=2, 4  MM003 (keys cut)  fails MATNR=1, 9
                               MM004 fails MATNR=7 (the baseline never ran it: not comparable)
New in C: MATNR=3 (MM001), MATNR=4 (MM002). MATNR=2 fails the same checks as before; MATNR=9 is on a cut check.
"""
from __future__ import annotations

import json
import os
import time
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000a1"


@pytest.fixture(scope="module")
def owner():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield engine
    engine.dispose()


@pytest.fixture
def client_for(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    def make(tid):
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                            lambda token, secret: {"sub": USER, "email": "steward@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return make


def _tenant(c, tid: str) -> None:
    c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
    c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'Steward', 'admin') "
                   "ON CONFLICT (id) DO NOTHING"), {"u": USER, "t": tid, "e": f"{tid[:8]}@example.com"})


def _drop(c, tid: str) -> None:
    """The runs and what hangs off them go; the tenant row stays, as in the other pg tests."""
    for table in ("work_records", "finding_records", "findings", "analysis_versions"):
        c.execute(text(f"DELETE FROM {table} WHERE tenant_id = :t"), {"t": tid})


def _run(c, tid: str, sid: str, minutes_ago: int) -> str:
    vid = str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) "
                   "VALUES (:v, :t, 'complete', now() - make_interval(mins => :ago), CAST(:m AS jsonb), "
                   "CAST('{\"material_master\": {}}' AS jsonb))"),
              {"v": vid, "t": tid, "ago": minutes_ago,
               "m": json.dumps({"system_id": sid, "modules": ["material_master"], "worklist_built_at": "2026-10-01T00:00:00Z"})})
    return vid


def _finding(c, tid: str, vid: str, check: str, details: dict | None = None) -> None:
    c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
                   "total_count, details) VALUES (:v, :t, 'material_master', :c, 'high', 'completeness', 1, 10, "
                   "CAST(:d AS jsonb))"),
              {"v": vid, "t": tid, "c": check, "d": json.dumps({"message": f"{check} fails", **(details or {})})})


def _fails(c, tid: str, vid: str, check: str, keys: list[str]) -> None:
    for k in keys:
        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                       "field_values) VALUES (:t, :v, :c, 'material_master', 'MARA', :k, '{}'::jsonb)"),
                  {"t": tid, "v": vid, "c": check, "k": k})


def _work(c, tid: str, vid: str, sid: str, by_key: dict[str, list[str]]) -> None:
    for k, checks in by_key.items():
        c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, name, issues, "
                       "sev_rank, checks, proposed, status) VALUES (:t, :v, :s, 'material_master', :k, :k, :n, 1, "
                       "CAST(:ch AS text[]), 0, 'to_fix')"),
                  {"t": tid, "v": vid, "s": sid, "k": k, "n": len(checks), "ch": "{" + ",".join(checks) + "}"})


@pytest.fixture
def runs(owner):
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        _tenant(c, tid)
        base, cur = _run(c, tid, sid, 60), _run(c, tid, sid, 1)
        for check in ("MM001", "MM002"):
            _finding(c, tid, base, check)
        _finding(c, tid, base, "MM003", {"failing_keys_truncated": True})
        for check in ("MM001", "MM002", "MM004"):
            _finding(c, tid, cur, check)
        _finding(c, tid, cur, "MM003", {"failing_keys_truncated": True})
        _fails(c, tid, base, "MM001", ["MATNR=1", "MATNR=2"])
        _fails(c, tid, base, "MM002", ["MATNR=2"])
        _fails(c, tid, base, "MM003", ["MATNR=1"])
        _fails(c, tid, cur, "MM001", ["MATNR=1", "MATNR=2", "MATNR=3"])
        _fails(c, tid, cur, "MM002", ["MATNR=2", "MATNR=4"])
        _fails(c, tid, cur, "MM003", ["MATNR=1", "MATNR=9"])
        _fails(c, tid, cur, "MM004", ["MATNR=7"])
        _work(c, tid, cur, sid, {"MATNR=1": ["MM001", "MM003"], "MATNR=2": ["MM001", "MM002"], "MATNR=3": ["MM001"],
                                 "MATNR=4": ["MM002"], "MATNR=7": ["MM004"], "MATNR=9": ["MM003"]})
    yield tid, base, cur
    with owner.begin() as c:
        _drop(c, tid)


@pytest.mark.anyio
async def test_since_opens_exactly_the_records_that_are_new_against_the_baseline(runs, client_for):
    tid, base, cur = runs
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        get = lambda path, **p: client.get(f"/api/v1/work{path}", params={"version_id": cur, **p}, headers=HEADERS)
        listed = (await get("/records", since=base, module="material_master")).json()
        assert sorted(i["record_key"] for i in listed["items"]) == ["MATNR=3", "MATNR=4"]
        assert listed["total"] == 2
        # without it the whole work list; a check that was cut or never ran in the baseline is not "new"
        assert (await get("/records", module="material_master")).json()["total"] == 6
        # the rule filter still applies on top
        only = (await get("/records", since=base, check_id="MM002")).json()
        assert [i["record_key"] for i in only["items"]] == ["MATNR=4"]
        # the tiles count what the list shows
        totals = (await get("/summary", since=base, module="material_master")).json()["totals"]
        assert totals["open"] == totals["records"] == 2 and totals["issues"] == 2
        # the fix sheet exports the same records
        sheet = await get("/export", since=base)
        assert sheet.status_code == 200 and sheet.content[:2] == b"PK"


@pytest.mark.anyio
async def test_since_edge_cases(owner, runs, client_for):
    tid, base, cur = runs
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        get = lambda **p: client.get("/api/v1/work/records", params=p, headers=HEADERS)
        # a run against itself has nothing new
        assert (await get(version_id=cur, since=cur)).json()["total"] == 0
        # one run only, and a baseline of this tenant
        assert (await get(since=base, scope="current")).status_code == 422
        assert (await get(version_id=cur, since=str(uuid.uuid4()))).status_code == 404
        assert (await get(version_id=cur, since="not-a-run")).status_code == 422
    # another tenant cannot use this tenant's run as a baseline
    other = str(uuid.uuid4())
    with owner.begin() as c:
        _tenant(c, other)
        mine = _run(c, other, str(uuid.uuid4()), 5)
    try:
        deps, client = client_for(other)
        await deps.engine.dispose()
        async with client:
            r = await client.get("/api/v1/work/records", params={"version_id": mine, "since": base}, headers=HEADERS)
            assert r.status_code == 404
    finally:
        with owner.begin() as c:
            _drop(c, other)


@pytest.mark.anyio
async def test_since_stays_on_the_primary_key_at_scale(owner, client_for):
    """200,000 failing records in each run, 1,000 new: found by index lookups of finding_records, not by reading the
    work list or the findings payloads, in well under the seconds an 18M-record tenant would tolerate per page."""
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    n, new = 200_000, 1_000
    with owner.begin() as c:
        _tenant(c, tid)
        base, cur = _run(c, tid, sid, 60), _run(c, tid, sid, 1)
        _finding(c, tid, base, "MM001")
        _finding(c, tid, cur, "MM001")
        # base fails keys 1..n; current fails keys new+1..n+new, so keys n+1..n+new are new
        for vid, lo, hi in ((base, 1, n), (cur, new + 1, n + new)):
            c.execute(text("""
                INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, field_values)
                SELECT :t, :v, 'MM001', 'material_master', 'MARA', 'MATNR=' || g, '{}'::jsonb
                  FROM generate_series(:lo, :hi) g"""), {"t": tid, "v": vid, "lo": lo, "hi": hi})
        c.execute(text("""
            INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, name, issues, sev_rank, checks,
                                      proposed, status)
            SELECT :t, :v, :s, 'material_master', 'MATNR=' || g, NULL, 1, 1, ARRAY['MM001'], 0, 'to_fix'
              FROM generate_series(:lo, :hi) g"""), {"t": tid, "v": cur, "s": sid, "lo": new + 1, "hi": n + new})
    with owner.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(text("ANALYZE finding_records"))
        c.execute(text("ANALYZE work_records"))
    try:
        deps, client = client_for(tid)
        await deps.engine.dispose()
        async with client:
            t0 = time.perf_counter()
            r = await client.get("/api/v1/work/records", params={"version_id": cur, "since": base,
                                                                  "module": "material_master", "limit": 50},
                                 headers=HEADERS)
            took = time.perf_counter() - t0
        body = r.json()
        assert r.status_code == 200, r.text
        assert body["total"] == new and len(body["items"]) == 50
        assert all(int(i["record_key"].split("=")[1]) > n for i in body["items"])
        assert took < 10, f"since took {took:.1f}s for {n:,} records"
    finally:
        with owner.begin() as c:
            _drop(c, tid)
