"""scope=current on the screens that used to open on the newest run alone: Fix work (/work/*), Progress
(/work/analytics/*), Value at risk (/insights/impact, /insights/proven-cost) and the rail's Fix count
(/shell/counts). The current state is every object at the latest complete run of its lineage, each object once,
from its own run (api/services/current_state.py), the scope Home already shows. Also: owners are one definition
(Insights > Owners and Progress's open work per person count the same issues).

Tenant ``a``:
  mm_old  upload of material master, two records failing MM001 (superseded by mm_new)
  mm_new  upload of material master, MATNR=1 failing MM001
  ap      system run of accounts payable (the newest run), LIFNR=1 failing AP001
  running a newer run still analysing: never counted
Tenant ``b``: its own material master run, MATNR=9 failing MM001: never seen by ``a``.

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
from sqlalchemy.orm import Session

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
T0 = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
FEATURE = "Vendor Master Management"
OTHER = "Material Requirements Planning"


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    a, b, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    user = str(uuid.uuid4())
    ids = {k: str(uuid.uuid4()) for k in ("mm_old", "mm_new", "ap", "running", "b_mm")}
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, cost_model) VALUES (:id, :id, CAST(:cm AS jsonb))"),
                  {"id": a, "cm": json.dumps({"currency": "ZAR", "features": {FEATURE: 10.0, OTHER: 2.0}})})
        c.execute(text("INSERT INTO tenants (id, name, cost_model) VALUES (:id, :id, CAST(:cm AS jsonb))"),
                  {"id": b, "cm": json.dumps({"currency": "ZAR", "features": {FEATURE: 10.0}})})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'Sim steward', 'steward')"),
                  {"u": user, "t": a, "e": f"{a[:8]}-steward@example.com"})

        def run(name, tid, minutes, module, *, system=None, status="complete"):
            md = {"modules": [module], **({"system_id": system} if system else {})}
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:id, :t, :l, :s, :r, CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                      {"id": ids[name], "t": tid, "l": name, "s": status, "r": T0 + timedelta(minutes=minutes),
                       "m": json.dumps(md), "q": json.dumps({module: {"composite_score": 70.0}})})

        def fails(name, tid, module, check, keys, scope):
            c.execute(text("""
                INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                      total_count, details)
                VALUES (:v, :t, :m, :c, 'critical', 'completeness', :n, 10, CAST(:d AS jsonb))"""),
                      {"v": ids[name], "t": tid, "m": module, "c": check, "n": len(keys),
                       "d": json.dumps({"message": f"{check} fails", "field_checked": "T.F"})})
            for k in keys:
                c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                               "field_values) VALUES (:t, :v, :c, :m, 'T', :k, '{}'::jsonb)"),
                          {"t": tid, "v": ids[name], "c": check, "m": module, "k": k})
                c.execute(text("""
                    INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status,
                                               first_seen_version, last_seen_version)
                    VALUES (:t, :s, :m, :c, :k, 'T', 'critical', 'open', :v, :v)
                    ON CONFLICT DO NOTHING"""),
                          {"t": tid, "s": scope, "m": module, "c": check, "k": k, "v": ids[name]})

        def impact(name, tid, feature, n):
            c.execute(text("INSERT INTO config_impact_results (version_id, tenant_id, feature, system, status, "
                           "total_affected_records) VALUES (:v, :t, :f, 'ECC', 'blocked', :n)"),
                      {"v": ids[name], "t": tid, "f": feature, "n": n})

        run("mm_old", a, 0, "material_master")
        fails("mm_old", a, "material_master", "MM001", ["MATNR=1", "MATNR=2"], "upload")
        impact("mm_old", a, FEATURE, 999)
        run("mm_new", a, 60, "material_master")
        fails("mm_new", a, "material_master", "MM001", ["MATNR=1"], "upload")
        impact("mm_new", a, FEATURE, 3)
        run("ap", a, 120, "accounts_payable", system=sid)
        fails("ap", a, "accounts_payable", "AP001", ["LIFNR=1"], sid)
        impact("ap", a, OTHER, 4)
        run("running", a, 180, "accounts_payable", system=sid, status="running")
        run("b_mm", b, 30, "material_master")
        fails("b_mm", b, "material_master", "MM001", ["MATNR=9"], "upload")
        impact("b_mm", b, FEATURE, 777)
        # The steward owns the open material master issue.
        c.execute(text("UPDATE record_issues SET assigned_to = :u WHERE tenant_id = :t AND record_key = 'MATNR=1'"),
                  {"u": user, "t": a})
    from api.services import worklist
    with Session(engine) as s:
        for name, tid in (("mm_old", a), ("mm_new", a), ("ap", a), ("b_mm", b)):
            worklist.build(s, tid, ids[name])
    yield a, b, ids, user
    with engine.begin() as c:
        for tbl in ("work_records", "work_groups", "record_issue_events", "record_issues", "finding_records",
                    "config_impact_results", "findings", "analysis_versions", "users"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": a, "b": b})
    engine.dispose()


@pytest.fixture
def get(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    async def go(tid: str, path: str, status: int = 200, **params) -> dict:
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
async def test_fix_work_current_state_spans_every_object_at_its_own_run(tenants, get):
    a, b, ids, _ = tenants
    # The old default, the newest run, holds one object.
    one = await get(a, "/api/v1/work/summary")
    assert one["version_id"] == ids["ap"] and [o["module"] for o in one["objects"]] == ["accounts_payable"]

    s = await get(a, "/api/v1/work/summary", scope="current")
    assert s["mode"] == "current" and s["version_id"] is None and s["built"] and s["unbuilt"] == []
    assert {o["module"]: o["version_id"] for o in s["objects"]} == {
        "accounts_payable": ids["ap"], "material_master": ids["mm_new"]}
    assert s["totals"]["open"] == 2  # MATNR=2 lives only in the superseded run; tenant b's MATNR=9 never shows
    assert set(s["version_ids"]) == {ids["ap"], ids["mm_new"]}

    recs = await get(a, "/api/v1/work/records", scope="current")
    assert {(i["module"], i["record_key"], i["version_id"]) for i in recs["items"]} == {
        ("accounts_payable", "LIFNR=1", ids["ap"]), ("material_master", "MATNR=1", ids["mm_new"])}
    assert recs["total"] == 2

    groups = await get(a, "/api/v1/work/groups", scope="current")
    assert {(g["check_id"], g["version_id"]) for g in groups["groups"]} == {("AP001", ids["ap"]), ("MM001", ids["mm_new"])}

    found = await get(a, "/api/v1/work/search", scope="current", q="MATNR=")
    assert [(i["record_key"], i["version_id"]) for i in found["items"]] == [("MATNR=1", ids["mm_new"])]

    # A run and the current state are exclusive.
    await get(a, "/api/v1/work/summary", 422, scope="current", version_id=ids["ap"])
    # Tenant isolation: b's current state is its own run only.
    sb = await get(b, "/api/v1/work/records", scope="current")
    assert [(i["record_key"], i["version_id"]) for i in sb["items"]] == [("MATNR=9", ids["b_mm"])]


@pytest.mark.anyio
async def test_rail_fix_count_and_progress_read_the_current_state(tenants, get):
    a, b, ids, _ = tenants
    assert (await get(a, "/api/v1/shell/counts"))["fix"] == 2
    assert (await get(b, "/api/v1/shell/counts"))["fix"] == 1

    burn = await get(a, "/api/v1/work/analytics/burndown", scope="current")
    assert burn["scope"] == "current" and burn["open_records"] == 2 and burn["runs"] == []

    change = await get(a, "/api/v1/work/analytics/run-change", scope="current")
    # material master is compared with the run before its own (mm_old): MATNR=2 is gone; accounts payable has no earlier run
    assert [c["version_id"] for c in change["compared"]] == [ids["mm_new"]]
    assert change["previous"]["version_id"] == ids["mm_old"]
    assert [o["module"] for o in change["objects"]] == ["material_master"]

    roots = await get(a, "/api/v1/work/analytics/root-causes", scope="current")
    assert roots["scope"] == "current" and roots["total_records"] == 2
    await get(a, "/api/v1/work/analytics/burndown", 422, scope="current", version_id=ids["ap"])


@pytest.mark.anyio
async def test_value_at_risk_current_state_takes_each_feature_from_the_newest_run(tenants, get):
    a, b, ids, _ = tenants
    imp = await get(a, "/api/v1/insights/impact", scope="current")
    assert imp["scope"] == "current" and imp["version_ids"][0] == ids["ap"]
    rows = {r["feature"]: r for r in imp["rows"]}
    assert rows[FEATURE]["record_count"] == 3 and rows[FEATURE]["value_at_risk"] == 30.0  # mm_new, not mm_old's 999
    assert rows[OTHER]["record_count"] == 4
    # The old default (the newest run with impact rows) holds one feature.
    assert [r["feature"] for r in (await get(a, "/api/v1/insights/impact"))["rows"]] == [OTHER]

    cost = await get(a, "/api/v1/insights/proven-cost", scope="current")
    assert cost["scope"] == "current" and cost["currency"] == "ZAR"
    assert sum(x["value_at_risk"] for x in cost["value_at_risk_by_l1"]) == 38.0

    # The executive summary in current mode reads the same rows.
    ex = await get(a, "/api/v1/insights/exec", scope="current")
    assert {r["feature"] for r in ex["impact_rows"]} == {FEATURE, OTHER}

    assert [r["record_count"] for r in (await get(b, "/api/v1/insights/impact", scope="current"))["rows"]] == [777]


@pytest.mark.anyio
async def test_owners_and_open_work_per_person_count_the_same_issues(tenants, get):
    a, b, ids, user = tenants
    owners = (await get(a, "/api/v1/insights/owners"))["owners"]
    workload = (await get(a, "/api/v1/work/analytics/throughput"))["workload"]
    mine = [w for w in workload if w["assignee_id"] == user]
    assert len(owners) == 1 and owners[0]["user_id"] == user
    # Both surfaces name the owner the same way and count the same open issues.
    assert owners[0]["owner"] == mine[0]["name"] == "Sim steward"
    assert sum(owners[0]["open_by_severity"].values()) == mine[0]["open"] == 1
    assert (await get(b, "/api/v1/insights/owners"))["owners"] == []


@pytest.mark.anyio
async def test_current_state_groups_report_built_as_the_summary_does(tenants, get):
    """/work/groups with scope=current says built only while some run of the current state has its work list."""
    a, b, ids, _ = tenants
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as c:
        c.execute(text("UPDATE analysis_versions SET metadata = metadata - 'worklist_built_at' WHERE id = :v"),
                  {"v": ids["mm_new"]})
    assert (await get(a, "/api/v1/work/groups", scope="current"))["built"] is True  # ap still has its list
    with engine.begin() as c:
        c.execute(text("UPDATE analysis_versions SET metadata = metadata - 'worklist_built_at' WHERE id = :v"),
                  {"v": ids["ap"]})
    engine.dispose()
    assert (await get(a, "/api/v1/work/summary", scope="current"))["built"] is False
    assert (await get(a, "/api/v1/work/groups", scope="current"))["built"] is False


@pytest.mark.anyio
async def test_summary_totals_follow_the_record_filters(tenants, get):
    """The Fix work tiles: with /work/records' filters the summary totals count what the list shows, in the
    current state and for the tenant only; the objects stay unfiltered."""
    a, b, ids, user = tenants
    plain = await get(a, "/api/v1/work/summary", scope="current")
    assert plain["totals"]["open"] == 2
    mine = await get(a, "/api/v1/work/summary", scope="current", assigned=user)
    assert mine["totals"]["open"] == mine["totals"]["critical"] == 1 and len(mine["objects"]) == 2
    listed = await get(a, "/api/v1/work/records", scope="current", assigned=user)
    assert listed["total"] == mine["totals"]["open"]
    assert (await get(a, "/api/v1/work/summary", scope="current", severity="critical"))["totals"]["open"] == 2
    assert (await get(a, "/api/v1/work/summary", scope="current", severity="low"))["totals"]["open"] == 0
    assert (await get(a, "/api/v1/work/summary", scope="current", proposed="true"))["totals"]["open"] == 0
    assert (await get(a, "/api/v1/work/summary", scope="current", due="overdue"))["totals"]["open"] == 0
    from api.main import app  # the status filter: ``get`` takes ``status`` as the expected HTTP code
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/work/summary", params={"scope": "current", "status": "approved"}, headers=HEADERS)
        assert r.status_code == 200 and r.json()["totals"]["open"] == 0
        r = await client.get("/api/v1/work/summary", params={"scope": "current", "status": "all"}, headers=HEADERS)
        assert r.json()["totals"]["open"] == 2
    assert (await get(b, "/api/v1/work/summary", scope="current", severity="critical"))["totals"]["open"] == 1


@pytest.mark.anyio
async def test_current_state_fix_sheet_import_is_all_or_nothing(tenants, monkeypatch):
    """A current-state fix sheet spans runs; when one run's decisions fail (here: accept with no suggested value,
    409), no other run's decisions are kept either."""
    import io

    from openpyxl import Workbook

    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    a, b, ids, _ = tenants
    wb = Workbook()
    ws = wb.active
    ws.title = "Fix sheet"
    ws.append(["Object", "Record", "Check", "New value", "Decision", "Reason"])
    ws.append(["material_master", "MATNR=1", "MM001", "KG", None, None])  # valid: an edit in mm_new
    ws.append(["accounts_payable", "LIFNR=1", "AP001", None, "fix", None])  # invalid: nothing to accept in ap
    buf = io.BytesIO()
    wb.save(buf)

    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
        "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(a), "T", []))
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/v1/work/import", params={"scope": "current"}, headers=HEADERS,
                              files={"file": ("fix.xlsx", buf.getvalue(), "application/octet-stream")})
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as c:
        items = c.execute(text("SELECT count(*) FROM remediation_items WHERE tenant_id = :t"), {"t": a}).scalar()
        batches = c.execute(text("SELECT count(*) FROM remediation_batches WHERE tenant_id = :t"), {"t": a}).scalar()
        statuses = {k: s for k, s in c.execute(text(
            "SELECT record_key, status FROM record_issues WHERE tenant_id = :t AND record_key IN ('MATNR=1', 'LIFNR=1')"),
            {"t": a})}
        c.execute(text("DELETE FROM remediation_items WHERE tenant_id = :t"), {"t": a})
        c.execute(text("DELETE FROM remediation_batches WHERE tenant_id = :t"), {"t": a})
    engine.dispose()
    assert r.status_code == 409, r.text
    assert items == 0 and batches == 0
    assert set(statuses.values()) == {"open"}
