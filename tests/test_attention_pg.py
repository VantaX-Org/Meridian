"""The Action centre (api/services/attention.py) against a real Postgres.

One tenant ("full") is seeded so that every kind fires exactly once, with its own system or object; a second tenant
("clean") has healthy, recent data and must produce nothing. Ages are relative to now. Redis is not needed: the
failed-job source is patched, the cache falls back to the process.

  connection        ERP prod unreachable (critical), Cloud HR degraded (medium), Plant OK healthy (absent)
  config_missing    Cloud HR has no configuration load; every other system has one
  config_drift      3 changes in the last 7 days on Plant OK, 1 change 30 days ago (not counted)
  regression        material_master: MM003 (high) newly failing against the previous run
  stale_object      mm_purchasing: daily, last run 3 days ago
  schedule_missed   fi_gl: next run 1 h ago, nothing running
  schedule_failed   accounts_payable: latest sync run failed
  (paused)          controlling: paused, failed, long overdue: nothing at all
  job_failed        two failed jobs in the last 24 h on Plant OK (a 3-day-old one is ignored)
  overdue_records   material_master: 3 to-fix records past due (a fixed one and a future one are not counted)
  object_no_go      business_partner: score 40, two critical/high rules failing
  approvals         one draft batch with an accepted item (+ one without, one approved: not counted), one golden request
  sla_breach        2 overdue open inbox items in material_master (a closed one is not counted)
  discovery_failed / fitness_drop   process discovery on ERP prod (ptp failed) and Plant OK (otc 92% -> 80%)
  rule_review       1 rule draft + 1 learned rule
  contract_breach   1 active contract whose latest check is not compliant
  access_requests / invites_pending / seats / grants_expiring / dormant_users
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api.services import attention
from tests.test_object_monitor_pg import DAILY, _finding, _system

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

NOW = datetime.now(timezone.utc)
ago = lambda **kw: NOW - timedelta(**kw)  # noqa: E731


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def run_version(c, tid, run_at, sid, module, score=90.0):
    vid = str(uuid.uuid4())
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, dqs_summary, metadata) "
                   "VALUES (:v, :t, 'complete', :at, CAST(:d AS jsonb), CAST(:m AS jsonb))"),
              {"v": vid, "t": tid, "at": run_at, "d": json.dumps({module: {"composite_score": score}}),
               "m": json.dumps({"system_id": sid, "modules": [module]})})
    return vid


def add_user(c, tid, name, role, **cols):
    uid = str(uuid.uuid4())
    c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active, password_hash, last_login, "
                   "invited_at, invite_status) VALUES (:i, :t, :e, :n, :r, true, :pw, :ll, :ia, :ist)"),
              {"i": uid, "t": tid, "e": f"{name}-{uid[:6]}@example.test", "n": name, "r": role,
               "pw": cols.get("pw", "x"), "ll": cols.get("last_login", NOW), "ia": cols.get("invited_at"),
               "ist": cols.get("invite_status")})
    return uid


def seed_full(owner) -> dict:
    tid = str(uuid.uuid4())
    out: dict = {"tid": tid}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})

        # people
        out["admin"] = add_user(c, tid, "admin", "admin")
        out["steward"] = add_user(c, tid, "steward", "viewer")  # scoped below
        out["viewer"] = add_user(c, tid, "viewer", "viewer")
        out["dormant"] = add_user(c, tid, "dormant", "analyst", last_login=ago(days=100))
        out["invitee"] = add_user(c, tid, "invitee", "analyst", pw=None, last_login=None, invited_at=ago(days=10),
                                  invite_status="sent")
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, module) "
                       "VALUES (:t, :u, 'steward', 'material_master')"), {"t": tid, "u": out["steward"]})
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, expires_at) "
                       "VALUES (:t, :u, 'analyst', :e)"), {"t": tid, "u": out["viewer"], "e": NOW + timedelta(days=5)})
        c.execute(text("INSERT INTO access_requests (tenant_id, user_id, resource, action) "
                       "VALUES (:t, :u, 'systems', 'edit')"), {"t": tid, "u": out["viewer"]})

        # connection health
        bad, _ = _system(c, tid, "ERP prod", "business_partner", None)
        c.execute(text("UPDATE sap_systems SET health_status = 'unreachable', last_health_check = :at WHERE id = :s"),
                  {"s": bad, "at": ago(minutes=20)})
        out["bad"] = bad
        hr, _ = _system(c, tid, "Cloud HR", "hcm", None)
        c.execute(text("UPDATE sap_systems SET health_status = 'degraded', last_health_check = :at WHERE id = :s"),
                  {"s": hr, "at": ago(minutes=5)})
        out["hr"] = hr

        # regression: MM003 (high) fails now, not before; daily schedule, fresh
        mm, _ = _system(c, tid, "Plant OK", "material_master", DAILY, sync_status=[("completed", 2)])
        c.execute(text("UPDATE sap_systems SET health_status = 'healthy' WHERE id = :s"), {"s": mm})
        prev = run_version(c, tid, ago(days=1), mm, "material_master")
        cur = run_version(c, tid, ago(hours=2), mm, "material_master")
        _finding(c, tid, prev, "material_master", "MM001", "critical", 1, ["MATNR=1"])
        _finding(c, tid, cur, "material_master", "MM001", "critical", 1, ["MATNR=1"])
        _finding(c, tid, cur, "material_master", "MM003", "high", 1, ["MATNR=5"])
        out.update(mm=mm, cur=cur)

        # work list of the current run: 3 overdue to-fix, 1 overdue fixed, 1 to-fix due tomorrow
        for i, (status, due) in enumerate([("to_fix", ago(days=2)), ("to_fix", ago(days=1)), ("proposed", ago(hours=1)),
                                           ("fixed", ago(days=3)), ("to_fix", NOW + timedelta(days=1))]):
            c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, issues, "
                           "sev_rank, checks, status, due_at) VALUES (:t, :v, 'material', 'material_master', :k, 1, 0, "
                           "ARRAY['MM001'], :s, :d)"), {"t": tid, "v": cur, "k": f"MATNR={i}", "s": status, "d": due})

        # stale, missed, failed, paused
        sid, _ = _system(c, tid, "MM stale", "mm_purchasing", DAILY, next_run=NOW + timedelta(hours=5),
                         sync_status=[("completed", 72)])
        run_version(c, tid, ago(days=3), sid, "mm_purchasing")
        sid, _ = _system(c, tid, "FI missed", "fi_gl", DAILY, next_run=ago(hours=1), sync_status=[("completed", 1)])
        run_version(c, tid, ago(hours=1), sid, "fi_gl")
        sid, _ = _system(c, tid, "AP failed", "accounts_payable", DAILY, next_run=NOW + timedelta(hours=5),
                         sync_status=[("completed", 80), ("failed", 2)])
        run_version(c, tid, ago(days=3), sid, "accounts_payable")
        sid, _ = _system(c, tid, "CO paused", "controlling", DAILY, active=False, next_run=ago(days=5),
                         sync_status=[("failed", 100)])
        run_version(c, tid, ago(days=5), sid, "controlling")

        # no-go: score 40, two critical/high rules failing (a medium one does not count)
        bp = run_version(c, tid, ago(hours=1), bad, "business_partner", score=40.0)
        for chk, sev in (("BP001", "critical"), ("BP002", "high"), ("BP003", "medium")):
            _finding(c, tid, bp, "business_partner", chk, sev, 3)

        # configuration: loaded everywhere but Cloud HR; drift on Plant OK
        loads = {}
        for sid in (bad, mm):
            loads[sid] = c.execute(text("INSERT INTO config_loads (tenant_id, system_id, system_type, status, "
                                        "finished_at) VALUES (:t, :s, 'ecc', 'completed', now()) RETURNING id"),
                                   {"t": tid, "s": sid}).scalar_one()
        for sid in [r[0] for r in c.execute(text("SELECT id::text FROM sap_systems WHERE tenant_id = :t AND id NOT IN "
                                                 "(:a, :b, :h)"), {"t": tid, "a": bad, "b": mm, "h": hr})]:
            c.execute(text("INSERT INTO config_loads (tenant_id, system_id, system_type, status, finished_at) "
                           "VALUES (:t, :s, 'ecc', 'completed', now())"), {"t": tid, "s": sid})
        for i, at in enumerate([ago(days=1), ago(days=2), ago(days=6), ago(days=30)]):
            c.execute(text("INSERT INTO config_drift_log (tenant_id, run_id, module, element_type, element_value, "
                           "change_type, detected_at) VALUES (:t, :r, 'fi_gl', 'tax_code', :v, 'changed', :at)"),
                      {"t": tid, "r": loads[mm], "v": f"V{i}", "at": at})

        # approvals: one that counts, one without an accepted item, one already approved; one golden write-back
        for status, accepted in (("draft", True), ("draft", False), ("approved", True)):
            bid = c.execute(text("INSERT INTO remediation_batches (tenant_id, name, status, created_by, created_at) "
                                 "VALUES (:t, 'b', :s, :u, :at) RETURNING id"),
                            {"t": tid, "s": status, "u": out["steward"], "at": ago(hours=3)}).scalar_one()
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, "
                            "accepted) VALUES (:t, :b, 'material', 'material_master', 'MM001', 'MATNR=1', :a)"),
                      {"t": tid, "b": bid, "a": accepted})
        mr = c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key) "
                            "VALUES (:t, 'material', 'M1') RETURNING id"), {"t": tid}).scalar_one()
        c.execute(text("INSERT INTO golden_writeback_requests (tenant_id, master_record_id, status, requested_by) "
                       "VALUES (:t, :m, 'pending_approval', :u)"), {"t": tid, "m": mr, "u": out["invitee"]})

        # inbox
        for status, due in (("open", ago(days=2)), ("escalated", ago(hours=5)), ("resolved", ago(days=9)),
                            ("open", NOW + timedelta(days=1))):
            c.execute(text("INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, status, due_at) "
                           "VALUES (:t, 'finding', gen_random_uuid(), 'material_master', :s, :d)"),
                      {"t": tid, "s": status, "d": due})

        # process discovery
        for l1, status, at, fit in (("ptp", "failed", ago(hours=4), None), ("otc", "completed", ago(days=2), 0.92),
                                    ("otc", "completed", ago(days=1), 0.80)):
            sysid = bad if l1 == "ptp" else mm
            c.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status, stats, "
                           "started_at) VALUES (:t, :s, :l, 'full', :st, CAST(:x AS jsonb), :at)"),
                      {"t": tid, "s": sysid, "l": l1, "st": status, "at": at,
                       "x": json.dumps({"conformance": {"fitness": fit}} if fit is not None else {})})

        # rules, contracts
        c.execute(text("INSERT INTO ai_proposed_rules (tenant_id, domain, proposed_rule, rationale, status) "
                       "VALUES (:t, 'dq_rule:material_master', '{}', 'draft', 'draft')"), {"t": tid})
        c.execute(text("INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, field, fingerprint, "
                       "body, confidence, support_rows, violations) VALUES (:t, 'material_master', 'format', 'MARA', "
                       "'MARA.MTART', 'fp1', '{}', 0.9, 100, 3)"), {"t": tid})
        k = c.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, status) "
                           "VALUES (:t, 'c', 'p', 'q', 'active') RETURNING id"), {"t": tid}).scalar_one()
        c.execute(text("INSERT INTO contract_compliance_history (tenant_id, contract_id, overall_compliant) "
                       "VALUES (:t, :k, true)"), {"t": tid, "k": k})
        c.execute(text("INSERT INTO contract_compliance_history (tenant_id, contract_id, overall_compliant, "
                       "recorded_at) VALUES (:t, :k, false, now() + interval '1 minute')"), {"t": tid, "k": k})
    return out


def seed_clean(owner) -> str:
    """Healthy: a fresh daily run with no regression, loaded configuration, nothing waiting."""
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        sid, _ = _system(c, tid, "Calm", "fi_gl", DAILY, next_run=NOW + timedelta(hours=20),
                         sync_status=[("completed", 1)])
        c.execute(text("UPDATE sap_systems SET health_status = 'healthy' WHERE id = :s"), {"s": sid})
        c.execute(text("INSERT INTO config_loads (tenant_id, system_id, system_type, status, finished_at) "
                       "VALUES (:t, :s, 'ecc', 'completed', now())"), {"t": tid, "s": sid})
        a = run_version(c, tid, ago(days=1), sid, "fi_gl")
        b = run_version(c, tid, ago(hours=1), sid, "fi_gl")
        for v in (a, b):
            _finding(c, tid, v, "fi_gl", "FI001", "high", 1, ["BELNR=1"])
        add_user(c, tid, "admin", "admin")
    return tid


def with_session(owner, fn):
    """Run ``fn(session)`` (an async callable) on a fresh async session of the test database."""
    async def go():
        eng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(eng, expire_on_commit=False)() as s:
                return await fn(s)
        finally:
            await eng.dispose()
    return asyncio.run(go())


@pytest.fixture
def stubs(monkeypatch):
    """Two failed jobs in the last 24 h on Plant OK; a 3-day-old failure, a running job and a failed one without a
    kind we track are ignored. A licence of 5 seats ending in 10 days."""
    from api.middleware import licence
    from api.services import jobs

    def fake(tenant_id, **_kw):
        return list(stubs.jobs)

    stubs.jobs = []
    monkeypatch.setattr(jobs, "list_jobs", fake)
    monkeypatch.setattr(licence, "_manifest_cache", {"valid": True, "seats": 5, "days_remaining": 10})
    attention._memo.clear()
    return stubs


@pytest.fixture
def full(owner, stubs):
    s = seed_full(owner)
    ts = NOW.timestamp()
    stubs.jobs = [
        {"id": "job-a", "kind": "extraction", "status": "failed", "system_id": s["mm"], "finished_at": ts - 3600},
        {"id": "job-b", "kind": "analysis", "status": "failed", "system_id": s["mm"], "finished_at": ts - 7200},
        {"id": "job-old", "kind": "extraction", "status": "failed", "system_id": s["mm"], "finished_at": ts - 3 * 86400},
        {"id": "job-run", "kind": "extraction", "status": "running", "system_id": s["mm"], "updated_at": ts},
        {"id": "job-sim", "kind": "simulation", "status": "failed", "system_id": s["mm"], "finished_at": ts - 60},
    ]
    return s


def collected(owner, tid):
    return with_session(owner, lambda s: attention.collect(s, tid, NOW))


def by_kind(items):
    out: dict[str, list] = {}
    for i in items:
        out.setdefault(i["kind"], []).append(i)
    return out


EXPECTED_KINDS = {
    "regression", "stale_object", "schedule_missed", "schedule_failed", "job_failed", "connection", "config_missing",
    "config_drift", "approvals", "sla_breach", "overdue_records", "object_no_go", "discovery_failed", "fitness_drop",
    "rule_review", "contract_breach", "access_requests", "invites_pending", "seats", "grants_expiring",
    "dormant_users"}


def test_every_kind_fires_from_its_fixture(owner, full):
    items = collected(owner, full["tid"])
    k = by_kind(items)
    assert set(k) == EXPECTED_KINDS  # all 21 implemented kinds, and nothing else
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids))  # one item per (kind, system, module)

    # connection: the unreachable system is critical and first-tier, the degraded one medium; the healthy one absent
    conn = {i["system_name"]: i for i in k["connection"]}
    assert set(conn) == {"ERP prod", "Cloud HR"}
    assert (conn["ERP prod"]["severity"], conn["ERP prod"]["tier"], conn["ERP prod"]["href"]) == (
        "critical", 1, f"/systems/{full['bad']}")
    assert (conn["Cloud HR"]["severity"], conn["Cloud HR"]["tier"]) == ("medium", 4)
    assert conn["ERP prod"]["title"] == "ERP prod cannot be reached"
    assert conn["ERP prod"]["required_action"] == "manage_systems"

    # regression: one rule, one record, opens Fix on exactly that rule
    (reg,) = k["regression"]
    assert (reg["module"], reg["object"], reg["count"], reg["severity"], reg["tier"]) == (
        "material_master", "Material master", 1, "critical", 1)
    assert reg["title"] == "1 rule regressed on Material master"
    assert reg["href"] == f"/fix?run={full['cur']}&module=material_master&check=MM003&st=to_fix"
    assert reg["system_id"] == full["mm"] and reg["system_name"] == "Plant OK" and reg["required_action"] == "apply"

    (stale,) = k["stale_object"]
    assert (stale["module"], stale["href"], stale["severity"]) == ("mm_purchasing", "/objects/mm_purchasing#monitor", "high")
    assert "3 days ago" in stale["detail"] and "daily" in stale["detail"]

    (missed,) = k["schedule_missed"]
    assert missed["module"] == "fi_gl" and missed["href"].endswith("?tab=health#schedules")
    (failed,) = k["schedule_failed"]
    assert failed["module"] == "accounts_payable" and failed["href"].startswith("/admin/jobs?job=")
    assert not any(i["module"] == "controlling" for i in items)  # paused: a decision, nothing raised

    (job,) = k["job_failed"]  # the two failures of the last 24 h; old, running and untracked kinds ignored
    assert (job["count"], job["system_id"], job["href"]) == (2, full["mm"], "/admin/jobs?job=job-a")
    assert job["required_action"] == "trigger_sync"

    (cm,) = k["config_missing"]
    assert cm["system_name"] == "Cloud HR" and cm["href"] == "/systems?config=not_loaded"
    (cd,) = k["config_drift"]
    assert (cd["count"], cd["system_id"], cd["href"]) == (3, full["mm"], f"/systems/{full['mm']}?tab=config")  # not the 30-day-old one

    (ap_batch,) = [i for i in k["approvals"] if i["module"]]
    (ap_gold,) = [i for i in k["approvals"] if not i["module"]]
    assert ap_batch["count"] == 1 and ap_batch["title"] == "1 fix batch is waiting for approval on Material master"
    assert ap_gold["count"] == 1 and ap_gold["href"] == "/inbox?kind=approvals"
    (sla,) = k["sla_breach"]
    assert (sla["count"], sla["module"], sla["href"], sla["required_action"]) == (2, "material_master", "/inbox?due=overdue", "assign")

    (od,) = k["overdue_records"]
    assert od["count"] == 3 and od["href"] == "/fix?module=material_master&due=overdue"
    (ng,) = k["object_no_go"]
    assert (ng["module"], ng["count"], ng["required_action"], ng["href"]) == ("business_partner", 2, "view", "/objects/business_partner")
    assert "40" in ng["detail"]

    (df,) = k["discovery_failed"]
    assert df["system_name"] == "ERP prod" and df["href"].startswith("/process/runs/") and "PTP" in df["detail"]
    (fd,) = k["fitness_drop"]
    assert fd["system_name"] == "Plant OK" and fd["href"] == f"/process/otc?system={full['mm']}"
    assert "92%" in fd["detail"] and "80%" in fd["detail"]

    assert k["rule_review"][0]["count"] == 2 and k["rule_review"][0]["href"] == "/rules/drafts?tab=ai"
    assert k["contract_breach"][0]["count"] == 1  # the latest check decides, not the older compliant one

    assert k["access_requests"][0]["count"] == 1 and k["access_requests"][0]["href"] == "/admin/roles?tab=requests"
    assert k["invites_pending"][0]["count"] == 1
    assert k["dormant_users"][0]["count"] == 1 and k["grants_expiring"][0]["count"] == 1
    seats = k["seats"][0]
    assert seats["severity"] == "high" and "5 of 5 seats" in seats["detail"] and "10 days" in seats["detail"]
    for admin_kind in ("access_requests", "invites_pending", "seats", "grants_expiring", "dormant_users"):
        assert k[admin_kind][0]["required_action"] == "manage_users" and k[admin_kind][0]["tier"] == 5
        assert k[admin_kind][0]["module"] is None and k[admin_kind][0]["system_id"] is None


def test_item_shape_and_plain_sentences(owner, full):
    items = collected(owner, full["tid"])
    keys = {"id", "kind", "tier", "severity", "title", "detail", "href", "action_label", "count", "object",
            "system_id", "system_name", "module", "since", "required_action"}
    for i in items:
        assert {k for k in i if not k.startswith("_")} == keys
        assert i["severity"] in attention.SEVERITIES and 1 <= i["tier"] <= 5 and i["count"] >= 1
        assert (i["title"][0].isupper() or i["title"][0].isdigit()) and not i["title"].endswith(".") and i["detail"].endswith(".")
        assert i["href"].startswith("/") and i["action_label"]
        assert "None" not in i["title"] + i["detail"] and "  " not in i["title"] + i["detail"]


def test_nothing_fires_on_healthy_data(owner, stubs, monkeypatch):
    from api.middleware import licence

    monkeypatch.setattr(licence, "_manifest_cache", {"valid": True, "seats": 50, "days_remaining": 200})
    assert collected(owner, seed_clean(owner)) == []


def test_ranking_is_tier_severity_count_then_age(owner, full):
    items = collected(owner, full["tid"])
    assert items == sorted(items, key=attention.rank_key)
    keys = [(i["tier"], attention.SEVERITIES.index(i["severity"])) for i in items]
    assert keys == sorted(keys)
    kinds = [i["kind"] for i in items]
    # tier 1: the critical ones first (more records first: the connection has 1, the regression 1; id breaks the tie
    # after age), then approvals (high); tier 2 before tier 3 before hygiene before admin
    t1 = [i for i in items if i["tier"] == 1]
    assert [i["kind"] for i in t1[:2]] == ["connection", "regression"] or [i["kind"] for i in t1[:2]] == ["regression", "connection"]
    assert {i["kind"] for i in t1[2:]} == {"approvals"}
    assert kinds.index("fitness_drop") > max(kinds.index(k) for k in ("connection", "regression", "approvals"))
    assert kinds.index("fitness_drop") < min(kinds.index(k) for k in ("stale_object", "schedule_missed", "job_failed"))
    assert kinds.index("access_requests") > kinds.index("object_no_go")
    assert items[-1]["tier"] == 5


def test_rank_key_orders_by_count_desc_then_oldest_first():
    mk = lambda id_, tier, sev, count, since: {"id": id_, "tier": tier, "severity": sev, "count": count, "since": since}  # noqa: E731
    shuffled = [mk("e", 3, "high", 1, None), mk("d", 3, "high", 5, "2026-01-02"), mk("c", 3, "high", 5, "2026-01-01"),
                mk("b", 3, "critical", 1, "2026-03-01"), mk("a", 2, "low", 1, "2026-03-01")]
    assert [i["id"] for i in sorted(shuffled, key=attention.rank_key)] == ["a", "b", "c", "d", "e"]


def test_cold_collect_fits_the_budget_and_cache_hit_is_fast(owner, full):
    async def go(s):
        await attention.collect(s, full["tid"])  # connection and plan warm-up; the timed call below is uncached
        t0 = time.perf_counter()
        first = await attention.cached_collect(s, full["tid"])
        cold = time.perf_counter() - t0
        t0 = time.perf_counter()
        again = await attention.cached_collect(s, full["tid"])
        return cold, time.perf_counter() - t0, first, again

    cold, hit, first, again = with_session(owner, go)
    assert len(first["items"]) >= 20
    assert again is first or again == first
    assert cold < 0.3, f"cold collect took {cold * 1000:.0f} ms"
    assert hit < 0.03, f"cache hit took {hit * 1000:.0f} ms"


def test_invalidate_drops_the_cached_list(owner, full):
    async def go(s):
        before = await attention.cached_collect(s, full["tid"])
        with owner.begin() as c:
            c.execute(text("UPDATE access_requests SET status = 'granted' WHERE tenant_id = :t"), {"t": full["tid"]})
        stale = await attention.cached_collect(s, full["tid"])  # inside the 60 s: unchanged
        attention.invalidate(full["tid"])
        fresh = await attention.cached_collect(s, full["tid"])
        return before, stale, fresh

    before, stale, fresh = with_session(owner, go)
    has = lambda p: any(i["kind"] == "access_requests" for i in p["items"])  # noqa: E731
    assert has(before) and has(stale) and not has(fresh)


def test_a_failing_source_is_skipped_not_raised(owner, full, monkeypatch):
    async def boom(c):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(attention, "_SOURCES", [("rules", boom), *[s for s in attention._SOURCES if s[0] != "rules"]])
    kinds = {i["kind"] for i in collected(owner, full["tid"])}
    assert "rule_review" not in kinds and "connection" in kinds and "access_requests" in kinds


def test_run_completion_and_other_signals_invalidate_the_cache():
    """The one-line calls exist where the signal is written (the behaviour of ``invalidate`` is tested above)."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel in ("workers/tasks/run_checks.py", "api/routes/remediation.py", "api/routes/me.py", "api/routes/systems.py",
                "api/services/connectivity_manager.py"):
        with open(os.path.join(root, rel), encoding="utf-8") as f:
            assert "attention" in f.read(), f"{rel} does not invalidate the attention cache"


class _FakeRedis:
    def __init__(self):
        self.d: dict[str, str] = {}

    def get(self, k):
        return self.d.get(k)

    def setex(self, k, ttl, v):
        assert ttl == 60
        self.d[k] = v

    def scan(self, cursor=0, match="*", count=100):
        import fnmatch
        return 0, [k for k in self.d if fnmatch.fnmatch(k, match)]

    def delete(self, *keys):
        for k in keys:
            self.d.pop(k, None)
        return len(keys)


def test_redis_cache_holds_the_tenant_list_for_60_seconds_and_invalidates(owner, full, monkeypatch):
    from api.middleware import cache

    fake = _FakeRedis()
    monkeypatch.setattr(attention, "get_redis", lambda: fake)
    monkeypatch.setattr(cache, "get_redis", lambda: fake)
    monkeypatch.setattr(attention, "_redis_down_until", 0.0)

    async def go(s):
        first = await attention.cached_collect(s, full["tid"])
        (key,) = fake.d
        assert key.startswith(f"meridian:cache:attention:{full['tid']}:")
        again = await attention.cached_collect(s, full["tid"])
        attention.invalidate(full["tid"])
        return first, again, dict(fake.d)

    first, again, after = with_session(owner, go)
    assert again == first and after == {}
