"""Numbers that contradicted each other across pages, pinned at the API.

- GET /findings/aggregate counted every evaluated rule (passing ones are stored too, with affected_count 0), so a
  run page said "6 critical, 2 high" where the runs list (dqs_summary) said "4 critical, 0 high", and a system page
  said "Open findings 172" beside 29 failing rules. Its counts are failing rules only.
- GET /mining/{duplicates,anomalies,relationships}?scope=current: Insights › Duplicates opens on the current state,
  each object at its own latest run, never a superseded run's rows nor another tenant's.
- GET /rules: last_affected_count (the rules list ranks by it) comes from the rule's latest finding, per tenant.
- GET /insights/cleansing: the funnel's first step is distinct failing records (dqs_summary clean_records), not
  rule failures (a record counted once per rule it fails), so it sits under the records analysed.

Tenant ``a``: mm_old (superseded) and mm_new uploads of material master. Tenant ``b``: one material master run.
PG tests are skipped without MERIDIAN_TEST_DB_URL.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
T0 = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


def _summary(critical: int, high: int, failing_records: int) -> dict:
    return {"composite_score": 70.0, "critical_count": critical, "high_count": high, "medium_count": 0,
            "low_count": 0, "clean_records": {"driving_object": "MARA", "records": 100,
                                              "failing_records": failing_records, "unattributed_rules": [],
                                              "reason": None}}


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    ids = {k: str(uuid.uuid4()) for k in ("mm_old", "mm_new", "b_mm")}
    with engine.begin() as c:
        for t in (a, b):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})

        def run(name, tid, minutes, summary):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:id, :t, :l, 'complete', :r, CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                      {"id": ids[name], "t": tid, "l": name, "r": T0 + timedelta(minutes=minutes),
                       "m": json.dumps({"modules": ["material_master"]}),
                       "q": json.dumps({"material_master": summary})})

        def finding(name, tid, check, severity, affected, minutes):
            c.execute(text("""
                INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                      total_count, pass_rate, details, created_at)
                VALUES (:v, :t, 'material_master', :c, :s, 'completeness', :n, 100, :p, '{}'::jsonb, :at)"""),
                      {"v": ids[name], "t": tid, "c": check, "s": severity, "n": affected, "p": 100.0 - affected,
                       "at": T0 + timedelta(minutes=minutes)})

        def mined(name, tid, key):
            c.execute(text("INSERT INTO data_duplicates (tenant_id, version_id, module_id, record_a, record_b, match_score) "
                           "VALUES (:t, :v, 'material_master', :k, :k2, 0.97)"), {"t": tid, "v": ids[name], "k": key, "k2": key + "x"})
            c.execute(text("INSERT INTO data_anomalies (tenant_id, version_id, module_id, field_name, detection_method, severity) "
                           "VALUES (:t, :v, 'material_master', :k, 'z_score', 'high')"), {"t": tid, "v": ids[name], "k": key})
            c.execute(text("INSERT INTO data_relationships (tenant_id, version_id, module_id, field_a, field_b, "
                           "relationship_type, strength_score) VALUES (:t, :v, 'material_master', :k, 'B', 'dependency', 0.9)"),
                      {"t": tid, "v": ids[name], "k": key})

        run("mm_old", a, 0, _summary(1, 0, 9))
        finding("mm_old", a, "MM001", "critical", 50, 0)
        mined("mm_old", a, "OLD")
        # The current run: 2 critical and 1 high failing; 1 critical and 1 high passing (stored, affected 0).
        # 40 + 30 + 20 = 90 rule failures over 35 distinct failing records.
        run("mm_new", a, 60, _summary(2, 1, 35))
        finding("mm_new", a, "MM001", "critical", 40, 60)
        finding("mm_new", a, "MM002", "critical", 30, 60)
        finding("mm_new", a, "MM003", "high", 20, 60)
        finding("mm_new", a, "MM004", "critical", 0, 60)
        finding("mm_new", a, "MM005", "high", 0, 60)
        mined("mm_new", a, "NEW")
        run("b_mm", b, 30, _summary(1, 0, 5))
        finding("b_mm", b, "MM001", "critical", 5, 30)
        mined("b_mm", b, "B")
        for tid in (a, b):
            c.execute(text("INSERT INTO rules (tenant_id, name, module, category, severity) "
                           "VALUES (:t, 'MM001: Material type is mandatory', 'material_master', 'ecc', 'critical')"), {"t": tid})
    yield a, b, ids
    with engine.begin() as c:
        for tbl in ("data_duplicates", "data_anomalies", "data_relationships", "findings", "rules", "analysis_versions"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": a, "b": b})
    engine.dispose()


@pytest.fixture
def get(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    async def go(tid: str, path: str, status: int = 200, **params) -> dict | list:
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
            "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(path, params=params, headers=HEADERS)
        assert r.status_code == status, (path, r.text)
        return r.json()
    return go


@pytest.mark.anyio
async def test_aggregate_counts_failing_rules_as_the_runs_list_does(tenants, get):
    a, b, ids = tenants
    agg = await get(a, "/api/v1/findings/aggregate", version_id=ids["mm_new"])
    # dqs_summary (the runs list) says 2 critical, 1 high: the passing MM004 and MM005 are not findings.
    assert agg["severity"] == {"critical": 2, "high": 1, "medium": 0, "low": 0}
    assert agg["total"] == 3
    assert agg["affected_records"] == 90
    [m] = agg["by_module"]
    assert (m["findings"], m["critical"], m["high"]) == (3, 2, 1)
    # Pass rates still average every evaluated rule.
    assert m["avg_pass_rate"] == pytest.approx((60 + 70 + 80 + 100 + 100) / 5)
    # Tenant isolation: b's run is invisible to a, and a's to b.
    other = await get(b, "/api/v1/findings/aggregate", version_id=ids["mm_new"])
    assert other["total"] == 0


@pytest.mark.anyio
async def test_mining_current_state_reads_each_object_at_its_own_latest_run(tenants, get):
    a, b, ids = tenants
    for feed, key in (("duplicates", "record_a"), ("anomalies", "field_name"), ("relationships", "field_a")):
        rows = await get(a, f"/api/v1/mining/{feed}", scope="current", limit=500)
        assert [(r[key], r["version_id"]) for r in rows] == [("NEW", ids["mm_new"])], feed
        every = await get(a, f"/api/v1/mining/{feed}", limit=500)
        assert {r[key] for r in every} == {"OLD", "NEW"}, feed
        rows_b = await get(b, f"/api/v1/mining/{feed}", scope="current", limit=500)
        assert [r[key] for r in rows_b] == ["B"], feed
    await get(a, "/api/v1/mining/duplicates", 422, scope="current", version_id=ids["mm_new"])


@pytest.mark.anyio
async def test_rules_list_carries_the_latest_failing_records(tenants, get):
    a, b, _ = tenants
    body = await get(a, "/api/v1/rules", limit=1000)
    [rule] = [r for r in body["rules"] if r["name"].startswith("MM001")]
    # The newest finding (mm_new, 40 records), not the superseded run's 50 nor tenant b's 5.
    assert rule["last_affected_count"] == 40
    assert rule["last_pass_rate"] == 60.0
    body_b = await get(b, "/api/v1/rules", limit=1000)
    assert [r["last_affected_count"] for r in body_b["rules"] if r["name"].startswith("MM001")] == [5]


@pytest.mark.anyio
async def test_cleansing_funnel_starts_from_distinct_failing_records(tenants, get):
    a, _, ids = tenants
    body = await get(a, "/api/v1/insights/cleansing", version_id=ids["mm_new"])
    failing = next(s for s in body["steps"] if s["key"] == "failing")
    assert failing["records"] == 35  # distinct records, never the 90 rule failures
    assert [m["failing"] for m in body["by_module"]] == [35]
    current = await get(a, "/api/v1/insights/cleansing", scope="current")
    assert next(s for s in current["steps"] if s["key"] == "failing")["records"] == 35
