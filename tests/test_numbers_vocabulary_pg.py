"""One quantity, one count, wherever it is shown (frontend/lib/help/glossary.ts defines the words).

- GET /findings/aggregate without ``version_id`` (Home's "failing rules" and "rule failures") reads the current state
  as the objects list does: each object once, from the newest of the lineages' latest runs that measured it. It used
  to read every finding of every lineage's latest run, so accounts payable read from a system and also uploaded
  counted twice: Home said 343,209 rule failures beside an objects list summing to 343,176. GET /findings without a
  run reads the same set.
- GET /work/summary with a filter counts what GET /work/records lists for the same filter (Fix work's tiles said
  "25,712 records, these filters" above an empty "Mine" list when the two disagreed).

Tenant ``a``: accounts payable read from a system (older) and uploaded (newer). Tenant ``b``: one run of its own.
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
USER = "00000000-0000-0000-0000-0000000000b7"
T0 = datetime(2026, 10, 2, 5, tzinfo=timezone.utc)


def _summary(critical: int, high: int) -> dict:
    return {"composite_score": 70.0, "critical_count": critical, "high_count": high, "medium_count": 0, "low_count": 0}


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    a, b, system = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    ids = {k: str(uuid.uuid4()) for k in ("sys_ap", "up_ap", "up_mm", "b_ap")}
    with engine.begin() as c:
        for t in (a, b):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})

        def run(name, tid, minutes, metadata, summary):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:id, :t, :l, 'complete', :r, CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                      {"id": ids[name], "t": tid, "l": name, "r": T0 + timedelta(minutes=minutes),
                       "m": json.dumps(metadata), "q": json.dumps(summary)})

        def finding(name, tid, module, check, severity, affected):
            c.execute(text("""
                INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                      total_count, pass_rate, details)
                VALUES (:v, :t, :m, :c, :s, 'completeness', :n, 1000, :p, '{}'::jsonb)"""),
                      {"v": ids[name], "t": tid, "m": module, "c": check, "s": severity, "n": affected,
                       "p": 100.0 - affected / 10})

        # The system run measured accounts payable on 2 October: 2 failing rules, 33 rule failures.
        run("sys_ap", a, 0, {"system_id": system, "modules": ["accounts_payable"]}, {"accounts_payable": _summary(2, 0)})
        finding("sys_ap", a, "accounts_payable", "AP016", "critical", 30)
        finding("sys_ap", a, "accounts_payable", "AP083", "critical", 3)
        # The upload measured it again later: it is the current state's accounts payable.
        run("up_ap", a, 60, {"modules": ["accounts_payable"]}, {"accounts_payable": _summary(1, 1)})
        finding("up_ap", a, "accounts_payable", "AP016", "critical", 100)
        finding("up_ap", a, "accounts_payable", "AP020", "high", 50)
        finding("up_ap", a, "accounts_payable", "AP021", "high", 0)  # evaluated and passing: not a failing rule
        run("up_mm", a, 30, {"modules": ["material_master"]}, {"material_master": _summary(0, 1)})
        finding("up_mm", a, "material_master", "MM014", "high", 7)
        run("b_ap", b, 90, {"modules": ["accounts_payable"]}, {"accounts_payable": _summary(1, 0)})
        finding("b_ap", b, "accounts_payable", "AP016", "critical", 999)
    yield a, b, ids
    with engine.begin() as c:
        for tbl in ("findings", "analysis_versions"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": a, "b": b})
    engine.dispose()


@pytest.fixture
def get(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    async def go(tid: str, path: str, **params) -> dict:
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
            "sub": USER, "email": "dev@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(path, params=params, headers=HEADERS)
        assert r.status_code == 200, (path, r.text)
        return r.json()
    return go


@pytest.mark.anyio
async def test_current_state_aggregate_counts_each_object_once_as_the_objects_list(tenants, get):
    a, b, ids = tenants
    agg = await get(a, "/api/v1/findings/aggregate")
    # Accounts payable from the upload only (the newer run), material master from its own run; never the system run.
    assert sorted(agg["version_ids"]) == sorted([ids["up_ap"], ids["up_mm"]])
    assert agg["total"] == 3  # failing rules: AP016, AP020, MM014
    assert agg["affected_records"] == 157  # rule failures: 100 + 50 + 7, not + 33 from the superseded system run
    by = {m["module"]: m for m in agg["by_module"]}
    assert (by["accounts_payable"]["findings"], by["accounts_payable"]["affected"]) == (2, 150)
    assert set(agg["dqs"]["modules"]) == {"accounts_payable", "material_master"}
    # The same numbers as the objects list, summed over each object's own run.
    listed = [await get(a, "/api/v1/objects", run=ids[r]) for r in ("up_ap", "up_mm")]
    objects = [o for body in listed for o in body["objects"]]
    assert sum(o["failing_checks"] for o in objects) == agg["total"]
    assert sum(o["affected_records"] for o in objects) == agg["affected_records"]
    # GET /findings without a run reads the same set.
    rows = await get(a, "/api/v1/findings", limit=100)
    assert {(f["version_id"], f["check_id"]) for f in rows["findings"] if f["affected_count"] > 0} == {
        (ids["up_ap"], "AP016"), (ids["up_ap"], "AP020"), (ids["up_mm"], "MM014")}
    # Tenant isolation: b sees its own run only, a's runs are not in its current state.
    other = await get(b, "/api/v1/findings/aggregate")
    assert (other["version_ids"], other["total"], other["affected_records"]) == ([ids["b_ap"]], 1, 999)
