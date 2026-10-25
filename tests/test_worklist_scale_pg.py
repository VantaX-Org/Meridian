"""The work list at production scale: synthetic, opt-in (`pytest -m perf`), against a real Postgres.

Seeds one run with WORKLIST_SCALE failing records (default 2,000,000) over 40 checks and ~1M record keys,
builds the work list, and holds every work-list read to a budget. No customer data: keys are generated.
"""
from __future__ import annotations

import json
import os
import time
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

pytestmark = [pytest.mark.perf,
              pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")]

N = int(os.environ.get("WORKLIST_SCALE", "2000000"))
CHECKS = 40
BUDGET_MS = 300
ANALYTICS_BUDGET_MS = 500
ANALYTICS_FIRST_MS = 3000  # a scan of every issue, cached for work_analytics.CACHE_TTL_S after
HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


@pytest.fixture(scope="module")
def seeded():
    owner = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    t0 = time.perf_counter()
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata) VALUES "
                       "(:v, :t, 'complete', now(), CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": sid, "modules": ["material_master"]})})
        c.execute(text(f"""
            INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                  total_count, details)
            SELECT CAST(:v AS uuid), CAST(:t AS uuid), CASE WHEN g % 2 = 0 THEN 'material_master' ELSE 'business_partner' END,
                   'C' || lpad(g::text, 3, '0'), (ARRAY['critical','high','medium','low'])[1 + g % 4], 'completeness',
                   {N} / {CHECKS}, {N}, jsonb_build_object('message', 'Check ' || g, 'field_checked', 'MARA.F' || g)
              FROM generate_series(1, {CHECKS}) g"""), {"v": vid, "t": tid})
        # each check fails N/CHECKS records out of a pool of N/2 keys, so records fail ~2 checks on average
        c.execute(text(f"""
            INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, field_values)
            SELECT CAST(:t AS uuid), CAST(:v AS uuid), 'C' || lpad(g::text, 3, '0'),
                   CASE WHEN g % 2 = 0 THEN 'material_master' ELSE 'business_partner' END, 'MARA',
                   'MATNR=' || lpad(((i * 7919 + g * 104729) % ({N} / 2))::text, 18, '0'),
                   jsonb_build_object('MARA.F' || g, NULL)
              FROM generate_series(1, {CHECKS}) g, generate_series(1, {N} / {CHECKS}) i
            ON CONFLICT DO NOTHING"""), {"v": vid, "t": tid})
        c.execute(text("""
            INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status,
                                       first_seen_version, last_seen_version)
            SELECT fr.tenant_id, :s, fr.module, fr.check_id, fr.record_key, 'MARA', f.severity, 'open', fr.version_id,
                   fr.version_id
              FROM finding_records fr JOIN findings f USING (version_id, check_id)
             WHERE fr.version_id = CAST(:v AS uuid)"""), {"v": vid, "s": sid})
        c.execute(text("ANALYZE finding_records; ANALYZE record_issues; ANALYZE findings"))
    seed_s = time.perf_counter() - t0
    from api.services import worklist
    t0 = time.perf_counter()
    with Session(owner) as s:
        stats = worklist.build(s, tid, vid)
    build_s = time.perf_counter() - t0
    with owner.begin() as c:
        c.execute(text("ANALYZE work_records; ANALYZE work_groups"))
    print(f"\nseed {seed_s:.0f}s  build {build_s:.0f}s  {stats}")
    yield owner, tid, vid, stats
    with owner.begin() as c:
        for t in ("work_records", "work_groups", "record_issue_events", "record_issues", "finding_records", "findings",
                  "analysis_versions"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})


@pytest.mark.anyio
async def test_every_worklist_read_is_fast_at_scale(seeded, monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    owner, tid, vid, stats = seeded
    assert stats["records"] > N / 10
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": str(uuid.uuid4()), "email": "s@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    await api_deps.engine.dispose()
    timings, budgets = {}, {}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async def timed(name, path, budget=BUDGET_MS, **params):
            await client.get(path, params={"version_id": vid, **params}, headers=HEADERS)  # warm
            t0 = time.perf_counter()
            r = await client.get(path, params={"version_id": vid, **params}, headers=HEADERS)
            timings[name] = (time.perf_counter() - t0) * 1000
            budgets[name] = budget
            assert r.status_code == 200, r.text
            return r.json()

        await timed("summary", "/api/v1/work/summary")
        await timed("groups", "/api/v1/work/groups")
        first = await timed("records", "/api/v1/work/records")
        await timed("records page 2", "/api/v1/work/records", after=first["next"])
        await timed("records of a check", "/api/v1/work/records", check_id="C007")
        await timed("records of an object", "/api/v1/work/records", module="business_partner", severity="high")
        key = first["items"][0]["record_key"]
        await timed("record panel", f"/api/v1/work/records/{first['items'][0]['module']}/{key}")
        await timed("search by key", "/api/v1/work/search", q=key)
        await timed("search by value", "/api/v1/work/search", q=key.split("=")[1].lstrip("0")[:6])
        from api.services import work_analytics
        work_analytics._cache.clear()
        for name in ("burndown", "time-to-fix", "throughput", "recurrence", "root-causes", "proposal-quality", "run-change"):
            path = f"/api/v1/work/analytics/{name}"
            t0 = time.perf_counter()  # the first, uncached answer
            r = await client.get(path, params={"version_id": vid}, headers=HEADERS)
            assert r.status_code == 200, r.text
            timings[f"analytics {name} (first)"] = (time.perf_counter() - t0) * 1000
            budgets[f"analytics {name} (first)"] = ANALYTICS_FIRST_MS
            await timed(f"analytics {name}", path, budget=ANALYTICS_BUDGET_MS)
    print("\n" + "\n".join(f"{k:24s} {v:7.0f} ms" for k, v in timings.items()))
    slow = {k: round(v) for k, v in timings.items() if v > budgets[k]}
    assert not slow, f"over budget (ms): {slow}"
