"""Per-object monitoring (api/services/object_monitor.py, GET /api/v1/objects/monitor and /{module}/monitor)
against a real Postgres.

One tenant, one system per scenario so every object has its own lineage and schedule (ages are relative to now):

  material_master   pinned     3 runs; run B (2 days ago) is the pinned baseline; daily, last run 2 h ago
  business_partner  auto       2 runs, no pin: the baseline is the previous run; hourly, last run 30 min ago
  accounts_receivable           rides in the auto run with no profile; 55 rules start failing (cap 50)
  fi_gl             one run    daily, 1 h ago: no baseline, no drift
  controlling       paused     profile switched off, run 5 days old: paused, never stale
  hcm               manual     no cron, run 10 days old: manual
  accounts_payable  failed     daily, run 3 days old, the latest sync run failed
  mm_purchasing     stale      daily, run 3 days old, sync completed
  sd_customer_master never run daily, next run 5 minutes ago, no run: due
  production_planning upload   no system: manual, trigger upload
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
USER = "00000000-0000-0000-0000-0000000000c7"
DAILY, HOURLY = "0 2 * * *", "0 * * * *"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def _version(c, tid, run_at, meta, modules, vid=None):
    vid = vid or str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, dqs_summary, metadata) "
                   "VALUES (:v, :t, 'complete', :at, CAST(:d AS jsonb), CAST(:m AS jsonb))"),
              {"v": vid, "t": tid, "at": run_at, "d": json.dumps({m: {"composite_score": 90} for m in modules}),
               "m": json.dumps(meta)})
    return vid


def _finding(c, tid, vid, module, check, severity, affected, keys=()):
    c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
                   "total_count, details) VALUES (:v, :t, :m, :c, :s, 'completeness', :n, 10, CAST('{}' AS jsonb))"),
              {"v": vid, "t": tid, "m": module, "c": check, "s": severity, "n": affected})
    for k in keys:
        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, record_key) "
                       "VALUES (:t, :v, :c, :m, :k)"), {"t": tid, "v": vid, "c": check, "m": module, "k": k})


def _system(c, tid, name, module, cron, active=True, next_run=None, sync_status=None):
    sid = str(uuid.uuid4())
    c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, :n)"), {"s": sid, "t": tid, "n": name})
    pid = str(uuid.uuid4())
    c.execute(text("INSERT INTO sync_profiles (id, tenant_id, system_id, domain, schedule_cron, active, next_run_at) "
                   "VALUES (:p, :t, :s, :d, :c, :a, :n)"),
              {"p": pid, "t": tid, "s": sid, "d": module, "c": cron, "a": active, "n": next_run})
    for status, ago in sync_status or ():  # oldest first
        c.execute(text("INSERT INTO sync_runs (tenant_id, profile_id, status, started_at) "
                       "VALUES (:t, :p, :st, now() - make_interval(hours => :h))"),
                  {"t": tid, "p": pid, "st": status, "h": ago})
    return sid, pid


@pytest.fixture
def seeded(owner):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    ago = lambda **kw: now - timedelta(**kw)
    out: dict = {"tid": tid}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        meta = lambda sid, m, **kw: {"system_id": sid, "modules": [m], **kw}

        # pinned: A (3 d) -> B (2 d, pinned) -> C (2 h)
        sid, pid = _system(c, tid, "ERP pinned", "material_master", DAILY, next_run=now + timedelta(hours=20),
                           sync_status=[("completed", 3)])
        a = _version(c, tid, ago(days=3), meta(sid, "material_master"), ["material_master"])
        b = _version(c, tid, ago(days=2), meta(sid, "material_master", baseline=True), ["material_master"])
        cv = _version(c, tid, ago(hours=2), meta(sid, "material_master", trigger="manual",
                                                 requested_by_label="lead@example.com"), ["material_master"])
        _finding(c, tid, a, "material_master", "MM001", "critical", 2, ["MATNR=1", "MATNR=2"])
        _finding(c, tid, a, "material_master", "MM005", "low", 1, ["MATNR=9"])
        _finding(c, tid, b, "material_master", "MM001", "critical", 1, ["MATNR=1"])
        _finding(c, tid, b, "material_master", "MM002", "medium", 1, ["MATNR=1"])
        _finding(c, tid, b, "material_master", "MM003", "high", 0)
        _finding(c, tid, cv, "material_master", "MM001", "critical", 2, ["MATNR=1", "MATNR=2"])
        _finding(c, tid, cv, "material_master", "MM002", "medium", 0)
        _finding(c, tid, cv, "material_master", "MM003", "high", 1, ["MATNR=5"])
        out["pinned"] = {"sid": sid, "a": a, "b": b, "c": cv}

        # auto: P (1 d) -> Q (30 min), no pin
        sid, _ = _system(c, tid, "BP auto", "business_partner", HOURLY, next_run=now + timedelta(minutes=30),
                         sync_status=[("completed", 1)])
        p = _version(c, tid, ago(days=1), meta(sid, "business_partner", trigger="scheduled"), ["business_partner"])
        q = _version(c, tid, ago(minutes=30), meta(sid, "business_partner", trigger="scheduled"), ["business_partner"])
        _finding(c, tid, p, "business_partner", "BP001", "high", 2, ["PARTNER=1", "PARTNER=2"])
        _finding(c, tid, p, "business_partner", "BP002", "low", 1, ["PARTNER=1"])
        _finding(c, tid, p, "business_partner", "BP003", "critical", 0)
        _finding(c, tid, q, "business_partner", "BP001", "high", 1, ["PARTNER=1"])
        _finding(c, tid, q, "business_partner", "BP002", "low", 0)
        _finding(c, tid, q, "business_partner", "BP003", "critical", 1, ["PARTNER=9"])
        for i in range(55):  # accounts_receivable: no profile; 55 rules fail now that did not before
            _finding(c, tid, q, "accounts_receivable", f"AR{i:03d}", "medium", 1)
        out["auto"] = {"sid": sid, "p": p, "q": q}

        sid, _ = _system(c, tid, "FI one run", "fi_gl", DAILY, next_run=now + timedelta(hours=20))
        out["one"] = {"sid": sid, "v": _version(c, tid, ago(hours=1), meta(sid, "fi_gl"), ["fi_gl"])}

        sid, _ = _system(c, tid, "CO paused", "controlling", DAILY, active=False)
        _version(c, tid, ago(days=5), meta(sid, "controlling"), ["controlling"])

        sid, _ = _system(c, tid, "HCM manual", "hcm", None)
        _version(c, tid, ago(days=10), meta(sid, "hcm"), ["hcm"])

        sid, _ = _system(c, tid, "AP failed", "accounts_payable", DAILY, next_run=now + timedelta(hours=5),
                         sync_status=[("completed", 80), ("failed", 2)])
        _version(c, tid, ago(days=3), meta(sid, "accounts_payable"), ["accounts_payable"])

        sid, _ = _system(c, tid, "MM stale", "mm_purchasing", DAILY, next_run=now + timedelta(hours=5),
                         sync_status=[("completed", 72)])
        _version(c, tid, ago(days=3), meta(sid, "mm_purchasing"), ["mm_purchasing"])

        _system(c, tid, "SD never run", "sd_customer_master", DAILY, next_run=now - timedelta(minutes=5))

        _version(c, tid, ago(hours=3), {"source": "upload", "modules": ["production_planning"]}, ["production_planning"])
    return out


@pytest.fixture
def client_for(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    def make(tid):
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                            lambda token, secret: {"sub": USER, "email": "lead@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return make


def _by_module(body):
    return {o["module"]: o for o in body["objects"]}


@pytest.mark.anyio
async def test_current_state_has_one_row_per_object(seeded, client_for):
    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/objects/monitor", headers=HEADERS)
    assert r.status_code == 200, r.text
    rows = r.json()["objects"]
    mods = [o["module"] for o in rows]
    assert mods == sorted(mods) and len(mods) == len(set(mods))
    assert set(mods) == {"material_master", "business_partner", "accounts_receivable", "fi_gl", "controlling", "hcm",
                         "accounts_payable", "mm_purchasing", "sd_customer_master", "production_planning"}
    assert {m: o["freshness"] for m, o in _by_module(r.json()).items()} == {
        "material_master": "fresh", "business_partner": "fresh", "accounts_receivable": "manual", "fi_gl": "fresh",
        "controlling": "paused", "hcm": "manual", "accounts_payable": "failed", "mm_purchasing": "stale",
        "sd_customer_master": "due", "production_planning": "manual"}


@pytest.mark.anyio
async def test_pinned_baseline_drift_trigger_and_cadence(seeded, client_for):
    s = seeded["pinned"]
    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/objects/material_master/monitor", headers=HEADERS)
        assert r.status_code == 200, r.text
        o = r.json()
        assert (o["module"], o["system_id"], o["last_version_id"]) == ("material_master", s["sid"], s["c"])
        assert (o["trigger"], o["requested_by_label"]) == ("manual", "lead@example.com")
        assert o["cadence"]["cron"] == DAILY and o["cadence"]["active"] is True and o["cadence"]["interval_seconds"] == 86400
        assert o["next_run_at"] is not None and o["freshness"] == "fresh"
        assert o["baseline"]["kind"] == "pinned" and o["baseline"]["version_id"] == s["b"]  # not the run before (A)
        d = o["drift"]
        # against B: MM001 key 2 and MM003 key 5 are new, MM002 key 1 is gone, MM001 key 1 persists
        assert (d["new_failing"], d["recovered"]) == (2, 1)
        assert d["newly_failing_rules"] == [{"check_id": "MM003", "severity": "high", "new": 1}]
        assert d["recovered_rules"] == [{"check_id": "MM002"}]
        assert (d["newly_failing_rule_count"], d["recovered_rule_count"]) == (1, 1)

        # an older run named: the pinned run B itself has no older pin, so its baseline is the run before it
        b = (await client.get("/api/v1/objects/material_master/monitor", params={"run": s["b"]}, headers=HEADERS)).json()
        assert b["last_version_id"] == s["b"] and b["baseline"] == {
            "kind": "previous", "version_id": s["a"], "run_at": b["baseline"]["run_at"]}

        assert (await client.get("/api/v1/objects/material_master/monitor", params={"run": str(uuid.uuid4())},
                                 headers=HEADERS)).status_code == 404
        assert (await client.get("/api/v1/objects/nothing_here/monitor", headers=HEADERS)).status_code == 404


@pytest.mark.anyio
async def test_auto_baseline_is_the_previous_run(seeded, client_for):
    s = seeded["auto"]
    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    async with client:
        o = (await client.get("/api/v1/objects/business_partner/monitor", headers=HEADERS)).json()
        assert o["baseline"]["kind"] == "previous" and o["baseline"]["version_id"] == s["p"]
        assert o["trigger"] == "scheduled" and o["requested_by_label"] is None
        assert o["cadence"]["interval_seconds"] == 3600 and o["freshness"] == "fresh"
        d = o["drift"]
        assert (d["new_failing"], d["recovered"]) == (1, 2)  # BP003 key 9 is new; BP001 key 2 and BP002 key 1 are gone
        assert d["newly_failing_rules"] == [{"check_id": "BP003", "severity": "critical", "new": 1}]
        assert d["recovered_rules"] == [{"check_id": "BP002"}]

        # 55 rules flipped: the lists stop at 50, the counts do not; no profile on the system's module: manual
        ar = (await client.get("/api/v1/objects/accounts_receivable/monitor", headers=HEADERS)).json()
        assert len(ar["drift"]["newly_failing_rules"]) == 50 and ar["drift"]["newly_failing_rule_count"] == 55
        assert ar["cadence"] == {"cron": None, "active": None, "interval_seconds": None, "profile_id": None}
        assert ar["freshness"] == "manual" and ar["system_id"] == s["sid"]


@pytest.mark.anyio
async def test_one_run_never_run_paused_manual_failed_stale_upload(seeded, client_for):
    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    async with client:
        get = lambda m: client.get(f"/api/v1/objects/{m}/monitor", headers=HEADERS)
        one = (await get("fi_gl")).json()
        assert one["baseline"] == {"kind": None, "version_id": None, "run_at": None}
        assert one["drift"] == {"new_failing": 0, "recovered": 0, "newly_failing_rules": [], "recovered_rules": [],
                                "newly_failing_rule_count": 0, "recovered_rule_count": 0}
        assert one["freshness"] == "fresh"

        paused = (await get("controlling")).json()
        assert paused["freshness"] == "paused" and paused["next_run_at"] is None and paused["cadence"]["active"] is False

        manual = (await get("hcm")).json()
        assert manual["freshness"] == "manual" and manual["cadence"]["cron"] is None
        assert manual["cadence"]["interval_seconds"] is None and manual["next_run_at"] is None and manual["last_run_at"]

        assert (await get("accounts_payable")).json()["freshness"] == "failed"  # wins over the 3-day age
        assert (await get("mm_purchasing")).json()["freshness"] == "stale"

        never = (await get("sd_customer_master")).json()
        assert never["freshness"] == "due" and never["last_run_at"] is None and never["last_version_id"] is None
        assert never["baseline"]["kind"] is None and never["cadence"]["cron"] == DAILY

        up = (await get("production_planning")).json()
        assert (up["trigger"], up["system_id"], up["freshness"]) == ("upload", None, "manual")


@pytest.mark.anyio
async def test_staleness_reads_the_tenant_time_zone(owner):
    """'09:00 daily' has a 25-hour gap in New York on the night its clocks go back: a run 37 hours old is fresh
    there (limit 37.5 h) and stale in UTC (limit 36 h)."""
    from sqlalchemy.ext.asyncio import create_async_engine

    from api.services import object_monitor

    tid = str(uuid.uuid4())
    now = datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc)
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        sid, _ = _system(c, tid, "tz", "fi_gl", "0 9 * * *")
        _version(c, tid, now - timedelta(hours=37), {"system_id": sid, "modules": ["fi_gl"]}, ["fi_gl"])
    eng = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async def read():
            async with eng.connect() as db:
                await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
                return (await object_monitor.for_module(db, tid, "fi_gl", now=now))["freshness"]

        assert await read() == "stale"  # no triage settings: UTC
        with owner.begin() as c:
            c.execute(text("INSERT INTO triage_settings (tenant_id, timezone) VALUES (:t, 'America/New_York')"), {"t": tid})
        assert await read() == "fresh"
    finally:
        await eng.dispose()


def test_monitor_status_lists_an_object_with_two_runs_and_no_pin(seeded, owner):
    from sqlalchemy.orm import Session

    from api.services import monitor

    with Session(owner) as s:
        rows = {m["scope"]: m for m in monitor.status(s)}
        auto, pinned = rows[seeded["auto"]["sid"]], rows[seeded["pinned"]["sid"]]
        assert (auto["baseline"]["kind"], auto["baseline"]["id"], auto["latest"]["id"]) == (
            "previous", seeded["auto"]["p"], seeded["auto"]["q"])
        assert auto["monitor"] is None
        assert (pinned["baseline"]["kind"], pinned["baseline"]["id"], pinned["latest"]["id"]) == (
            "pinned", seeded["pinned"]["b"], seeded["pinned"]["c"])
        assert seeded["one"]["sid"] not in rows  # one run: nothing to compare with

        # batch drafting stays pinned-only: the auto lineage has no pin, so check() does nothing and drafts nothing
        assert monitor.check(s, seeded["tid"], seeded["auto"]["q"], seeded["auto"]["sid"]) is None
        assert s.execute(text("SELECT count(*) FROM remediation_batches WHERE tenant_id = :t"),
                         {"t": seeded["tid"]}).scalar() == 0
