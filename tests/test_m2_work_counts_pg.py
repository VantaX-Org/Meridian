"""work_counts (migration 108): open work pre-aggregated per run, object, status, system, severity and assignee,
against a real Postgres.

Seed: tests/m2_seed.py. After every kind of change to work_records (a decision, a group's accept-all, a batch's
approve, send-back and export, a reassignment, an undo, a re-score, a run deleted with its rows) work_counts equals a
live count of work_records, and /work/summary, the landscape cells, the object receipt and People answer exactly what
the live queries they replaced answer. The nightly reconcile finds an injected drift, reports it with the numbers and
repairs it. The landscape and summary are cached per tenant in Redis and a decision invalidates them; another tenant's
counts and cache entries are never touched or read.
"""
from __future__ import annotations

import logging
import os
import shutil
import socket
import subprocess
import time
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from tests.m2_client import headers, make_client
from tests.m2_seed import R1, R2, R3, seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

OPEN = ("to_fix", "proposed", "approved", "sent")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture
def s(owner):
    return seed_m2(owner)


@pytest.fixture(scope="module")
def redis_port():
    """A throwaway redis-server for the cache tests (skipped when the binary is not installed)."""
    exe = shutil.which("redis-server")
    if not exe:
        pytest.skip("redis-server not installed")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    proc = subprocess.Popen([exe, "--port", str(port), "--save", "", "--appendonly", "no", "--bind", "127.0.0.1"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import redis
    for _ in range(50):
        try:
            redis.Redis(port=port).ping()
            break
        except redis.ConnectionError:
            time.sleep(0.1)
    yield port
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture
def no_redis(monkeypatch):
    from api.middleware import cache
    monkeypatch.setattr(cache, "_redis_client", None)
    monkeypatch.setattr(cache, "get_redis", lambda: None)


@pytest.fixture
def with_redis(monkeypatch, redis_port):
    import redis

    from api.middleware import cache
    client = redis.Redis(port=redis_port, decode_responses=True)
    client.flushdb()
    monkeypatch.setattr(cache, "_redis_client", client)
    return client


def q(owner, sql, **p):
    with owner.begin() as c:
        res = c.execute(text(sql), p)
        return res.fetchall() if res.returns_rows else []


def build(owner, s) -> None:
    """The run's work list as a run builds it (work_groups + work_records from its finding_records), so decisions
    recompute real rows."""
    from api.services import worklist
    with Session(owner) as session:
        worklist.build(session, s["tid"], s["run"])


def status(owner, run: str, key: str) -> str:
    return q(owner, "SELECT status FROM work_records WHERE version_id = :v AND record_key = :k", v=run, k=key)[0][0]


async def start(monkeypatch, s, sub=None):
    deps, client = make_client(monkeypatch, s["tid"], *([sub] if sub else []))
    await deps.engine.dispose()
    return client


# ── The live queries work_counts replaced: the oracle ─────────────────────────────────────────────────────────────

def _pairs(owner, tid: str) -> list[dict]:
    from api.services.current_state import CURRENT_PAIRS_SQL
    return [{"module": m, "version_id": v} for m, v in q(owner, CURRENT_PAIRS_SQL, t=tid, m=None)]


def live_summary(owner, tid: str, sel, **f) -> tuple[list[dict], dict]:
    """(objects, totals) of GET /work/summary as it was computed before migration 108: every figure from work_records."""
    from api.deps import Tenant
    from api.routes.work import _records_where

    tenant = Tenant(uuid.UUID(tid), "T", [])
    owhere, p = _records_where(tenant, sel, None, f.get("module"), f.get("check_id"), f.get("severity"), "all", None,
                               None, None, None, None, f.get("system"))
    rows = q(owner, f"""
        SELECT w.module, w.version_id::text AS version_id, w.status, count(*) AS records, sum(w.issues) AS issues,
               count(*) FILTER (WHERE w.sev_rank = 0) AS critical, count(*) FILTER (WHERE w.proposed > 0) AS proposed,
               count(*) FILTER (WHERE w.due_at < now()) AS overdue
          FROM work_records w WHERE {' AND '.join(owhere)} GROUP BY w.module, w.version_id, w.status""", **p)
    objects: dict[str, dict] = {}
    for r in rows:
        o = objects.setdefault(r.module, {"module": r.module, "version_id": r.version_id, "records": 0, "open": 0,
                                          "issues": 0, "critical": 0, "proposed": 0, "overdue": 0, "statuses": {}})
        o["records"] += r.records
        o["statuses"][r.status] = r.records
        if r.status in OPEN:
            o["open"] += r.records
            o["issues"] += int(r.issues or 0)
            o["critical"] += r.critical
            o["proposed"] += r.proposed
            o["overdue"] += r.overdue
    out = sorted(objects.values(), key=lambda o: (-o["critical"], -o["open"], o["module"]))
    totals = {k: sum(o[k] for o in out) for k in ("records", "open", "issues", "critical", "proposed", "overdue")}
    if any(v is not None for v in f.values()):
        where, fp = _records_where(tenant, sel, None, f.get("module"), f.get("check_id"), f.get("severity"),
                                   f.get("status") or "open", None, None, None, None, None, f.get("system"))
        t = q(owner, f"""
            SELECT count(*) AS records, COALESCE(sum(w.issues), 0) AS issues,
                   count(*) FILTER (WHERE w.sev_rank = 0) AS critical, count(*) FILTER (WHERE w.proposed > 0) AS proposed,
                   count(*) FILTER (WHERE w.due_at < now()) AS overdue
              FROM work_records w WHERE {' AND '.join(where)}""", **fp)[0]
        totals = {"records": t.records, "open": t.records, "issues": int(t.issues), "critical": t.critical,
                  "proposed": t.proposed, "overdue": t.overdue}
    return out, totals


def assert_no_drift(owner, tid: str) -> None:
    from api.services import work_counts
    with Session(owner) as session:
        session.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        assert work_counts.drift(session, tid) == []


async def assert_readers_match(owner, s, client, label: str) -> None:
    """work_counts equals a live count, and every reader switched to it answers what the live query answers."""
    from api.routes.work import _Rows

    tid = s["tid"]
    assert_no_drift(owner, tid)
    filter_sets = ({}, {"severity": "critical"}, {"severity": "blocking", "status": "to_fix"}, {"system": s["ecc"]},
                   {"module": "material_master", "status": "all"}, {"status": "proposed"},
                   {"check_id": "MM014"})  # check_id: record-level, the live path on both sides
    for scope in ("run", "current"):
        for f in filter_sets:
            api = (await client.get("/api/v1/work/summary", headers=headers(), params={"scope": scope, **f})).json()
            sel = _Rows(api["version_id"], None, None) if scope == "run" else _Rows(None, None, _pairs(owner, tid))
            objects, totals = live_summary(owner, tid, sel, **{k: f.get(k) for k in
                                                               ("module", "check_id", "severity", "status", "system")})
            assert (api["objects"], api["totals"]) == (objects, totals), (label, scope, f)

    land = (await client.get("/api/v1/landscape", headers=headers())).json()
    measured = 0
    for c in land["cells"]:
        if c["open_work"] is None:
            continue
        live = q(owner, "SELECT count(*) FROM work_records WHERE tenant_id = :t AND version_id = :v AND module = :m "
                        "AND status = ANY(:open)", t=tid, v=c["run_id"], m=c["module"], open=list(OPEN))[0][0]
        assert c["open_work"] == live, (label, c["module"])
        measured += 1
    assert measured, label

    rec = (await client.get("/api/v1/objects/material_master/receipt", headers=headers())).json()
    live = q(owner, "SELECT count(*) FROM work_records WHERE tenant_id = :t AND version_id = :v AND module = 'material_master' "
                    "AND status = ANY(:open)", t=tid, v=rec["run_id"], open=list(OPEN))[0][0]
    assert rec["open_work"] == live, label

    pairs = _pairs(owner, tid)
    people = (await client.get("/api/v1/people", headers=headers())).json()["people"]
    for person in people:
        n, late = q(owner, """
            SELECT count(*), count(*) FILTER (WHERE w.due_at < now()) FROM work_records w
             WHERE w.tenant_id = :t AND w.assigned_to = CAST(:u AS uuid) AND w.status = ANY(:open)
               AND (w.module, w.version_id) IN (SELECT m, v FROM unnest(CAST(:pm AS text[]), CAST(:pv AS uuid[])) x(m, v))""",
                    t=tid, u=person["id"], open=list(OPEN), pm=[p["module"] for p in pairs],
                    pv=[p["version_id"] for p in pairs])[0]
        assert (person["open_work"], person["overdue"]) == (n, late), (label, person["name"])


# ── Tests ──────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_counts_equal_the_live_query_after_every_kind_of_change(s, owner, monkeypatch, no_redis):
    from api.services import work_counts, worklist

    tid, run = s["tid"], s["run"]
    # price MM014 so value at risk is exercised; build the run's work list (work_groups + work_records from its
    # finding_records, as a run does), then rebuild the tenant's counts with the backfill
    q(owner, "UPDATE findings SET cost_at_risk = 1234.5 WHERE version_id = :v AND check_id = 'MM014'", v=run)
    with Session(owner) as session:
        worklist.build(session, tid, run)
    with Session(owner) as session:
        session.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        assert work_counts.backfill(session, tid) > 0
        session.commit()
    stored = q(owner, "SELECT sum(value_at_risk_sum) FROM work_counts WHERE tenant_id = :t", t=tid)[0][0]
    assert stored and float(stored) > 0

    client = await start(monkeypatch, s)
    async with client:
        await assert_readers_match(owner, s, client, "seeded")

        d = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R1, "check_id": "MM014", "action": "edit", "value": "PC"},
            {"module": "material_master", "record_key": R3, "check_id": "MM014", "action": "not_an_issue", "note": "Legacy"}]})
        assert d.status_code == 200, d.text
        assert status(owner, run, R3) == "not_an_issue"  # R1 still fails MM031: to_fix
        await assert_readers_match(owner, s, client, "decide")

        a = await client.post("/api/v1/work/groups/MM014/accept-all", headers=headers())
        assert a.status_code == 200, a.text
        assert status(owner, run, R2) == "proposed"
        await assert_readers_match(owner, s, client, "accept-all")
        draft = q(owner, "SELECT id::text FROM remediation_batches WHERE tenant_id = :t AND status = 'draft' "
                         "AND created_by = CAST(:u AS uuid)", t=tid, u="00000000-0000-0000-0000-0000000000b7")[0][0]

    other = await start(monkeypatch, s, s["cara"])
    async with other:  # four eyes: someone else approves, sends back, approves again and exports
        ap = await other.post(f"/api/v1/remediation/batches/{draft}/approve", headers=headers())
        assert ap.status_code == 200, ap.text
        assert status(owner, run, R2) == "approved"
        await assert_readers_match(owner, s, other, "approve")
        sb = await other.post(f"/api/v1/remediation/batches/{draft}/send-back", headers=headers(), json={"note": "Check"})
        assert sb.status_code == 200, sb.text
        assert status(owner, run, R2) == "proposed"
        await assert_readers_match(owner, s, other, "send-back")
        assert (await other.post(f"/api/v1/remediation/batches/{draft}/approve", headers=headers())).status_code == 200
        # send: what POST .../export does to the work rows (its streamed file does not pass the full app's middleware
        # under the in-process test transport): the batch is exported and its records' work rows recomputed
        with Session(owner) as session:
            session.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
            session.execute(text("UPDATE remediation_batches SET status = 'exported', exported_at = now() WHERE id = :b"),
                            {"b": draft})
            worklist.refresh_batch(session, tid, draft)
            session.commit()
        assert q(owner, "SELECT count(*) FROM work_records WHERE tenant_id = :t AND status = 'sent'", t=tid)[0][0] > 0
        await assert_readers_match(owner, s, other, "export (sent)")

        ra = await other.post(f"/api/v1/remediation/batches/{draft}/reassign", headers=headers(),
                              json={"assignee_id": s["cara"]})
        assert ra.status_code == 200, ra.text
        assert q(owner, "SELECT count(*) FROM work_records WHERE tenant_id = :t AND assigned_to = CAST(:c AS uuid)",
                 t=tid, c=s["cara"])[0][0] > 0
        await assert_readers_match(owner, s, other, "reassign")
        u = await other.post("/api/v1/actions/undo", headers=headers(), json={"action_id": ra.json()["action_id"]})
        assert u.status_code == 200, u.text
        await assert_readers_match(owner, s, other, "undo")

        # a re-score: the run's work list rebuilt from its findings (delete + insert per object)
        with Session(owner) as session:
            worklist.build(session, tid, run)
        await assert_readers_match(owner, s, other, "re-score")

    # a run deleted with its work rows (ON DELETE CASCADE): its counts go with it, nothing is written for it
    q(owner, "INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, issues, sev_rank, checks, status) "
             "SELECT tenant_id, CAST(:mid AS uuid), scope, module, record_key, issues, sev_rank, checks, status "
             "FROM work_records WHERE version_id = :v", mid=s["run_mid"], v=run)
    assert q(owner, "SELECT sum(count) FROM work_counts WHERE version_id = :v", v=s["run_mid"])[0][0] > 0
    assert_no_drift(owner, tid)
    q(owner, "DELETE FROM analysis_versions WHERE id = :v", v=s["run_mid"])
    assert q(owner, "SELECT count(*) FROM work_counts WHERE version_id = :v", v=s["run_mid"])[0][0] == 0
    assert_no_drift(owner, tid)


def test_trigger_keeps_counts_under_row_level_security(s, owner):
    """The realistic writer: a role without BYPASSRLS, with app.tenant_id set, updating work_records."""
    tid = s["tid"]
    with owner.begin() as c:
        c.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wc_probe') "
                       "THEN CREATE ROLE wc_probe NOLOGIN; END IF; END $$"))
        c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON work_records, work_counts TO wc_probe"))
        c.execute(text("GRANT SELECT ON findings TO wc_probe"))
    with owner.begin() as c:
        c.execute(text("SET LOCAL ROLE wc_probe"))
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        n = c.execute(text("UPDATE work_records SET status = 'not_an_issue' WHERE version_id = :v AND record_key = :k"),
                      {"v": s["run"], "k": R2}).rowcount
        assert n == 1
        tenants = {r[0] for r in c.execute(text("SELECT DISTINCT tenant_id::text FROM work_counts"))}
        assert tenants == {tid}  # RLS: this tenant's slices only
    assert_no_drift(owner, tid)


def test_reconcile_reports_and_repairs_an_injected_drift(s, owner, caplog):
    from api.services import work_counts

    tid = s["tid"]
    assert_no_drift(owner, tid)
    sid, n = q(owner, "SELECT id, count FROM work_counts WHERE tenant_id = :t AND status = 'to_fix' ORDER BY id LIMIT 1",
               t=tid)[0]
    q(owner, "UPDATE work_counts SET count = count + 5 WHERE id = :i", i=sid)  # behind the triggers' back
    gone = q(owner, "DELETE FROM work_counts WHERE tenant_id = :t AND status <> 'to_fix' RETURNING count", t=tid)
    with caplog.at_level(logging.WARNING, logger="meridian.work_counts"), Session(owner) as session:
        found = work_counts.reconcile(session, tid, repair=True)
    assert len(found) == 1 + len(gone)
    bumped = next(d for d in found if d["stored_count"] == n + 5)
    assert bumped["live_count"] == n and bumped["status"] == "to_fix"
    assert all(d["stored_count"] == 0 and d["live_count"] > 0 for d in found if d is not bumped)
    text_ = caplog.text
    assert "work_counts drift" in text_ and f"count live {n} stored {n + 5}" in text_ and "work_counts repaired" in text_
    assert_no_drift(owner, tid)
    with Session(owner) as session:  # idempotent: a second pass finds nothing
        assert work_counts.reconcile(session, tid) == []


@pytest.mark.anyio
async def test_summary_and_landscape_cached_then_invalidated_by_a_decision(s, owner, monkeypatch, with_redis):
    from api.routes import landscape, work

    calls = {"summary": 0, "landscape": 0}
    real_summary, real_landscape = work._summary, landscape._landscape

    async def counting_summary(*a, **k):
        calls["summary"] += 1
        return await real_summary(*a, **k)

    async def counting_landscape(*a, **k):
        calls["landscape"] += 1
        return await real_landscape(*a, **k)

    build(owner, s)
    monkeypatch.setattr(work, "_summary", counting_summary)
    monkeypatch.setattr(landscape, "_landscape", counting_landscape)
    client = await start(monkeypatch, s)
    async with client:
        first = (await client.get("/api/v1/work/summary", headers=headers())).json()
        again = (await client.get("/api/v1/work/summary", headers=headers())).json()
        land1 = (await client.get("/api/v1/landscape", headers=headers())).json()
        land2 = (await client.get("/api/v1/landscape", headers=headers())).json()
        assert first == again and land1 == land2
        assert calls == {"summary": 1, "landscape": 1}  # the second reads were the cached ones
        # another filter set is another key
        await client.get("/api/v1/work/summary", headers=headers(), params={"severity": "critical"})
        assert calls["summary"] == 2
        keys = with_redis.keys(f"meridian:cache:work:{s['tid']}:*")
        assert len(keys) == 3 and all(k.startswith(f"meridian:cache:work:{s['tid']}:") for k in keys)
        assert with_redis.ttl(keys[0]) <= 30

        d = await client.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R3, "check_id": "MM014", "action": "not_an_issue", "note": "x"}]})
        assert d.status_code == 200, d.text
        after = (await client.get("/api/v1/work/summary", headers=headers())).json()
        land3 = (await client.get("/api/v1/landscape", headers=headers())).json()
        assert calls == {"summary": 3, "landscape": 2}  # invalidated at once by the decision's commit
        mm = next(o for o in after["objects"] if o["module"] == "material_master")
        mm0 = next(o for o in first["objects"] if o["module"] == "material_master")
        assert mm["open"] == mm0["open"] - 1 and mm["statuses"].get("not_an_issue", 0) == mm0["statuses"].get("not_an_issue", 0) + 1
        cell = next(c for c in land3["cells"] if c["module"] == "material_master" and c["run_id"] == s["run"])
        cell0 = next(c for c in land1["cells"] if c["module"] == "material_master" and c["run_id"] == s["run"])
        assert cell["open_work"] == cell0["open_work"] - 1


@pytest.mark.anyio
async def test_tenant_isolation_of_counts_and_cache(owner, monkeypatch, with_redis):
    from api.routes import work

    a, b = seed_m2(owner), seed_m2(owner)
    build(owner, a)
    build(owner, b)
    before_b = q(owner, "SELECT module, status, severity, count FROM work_counts WHERE tenant_id = :t ORDER BY 1, 2, 3",
                 t=b["tid"])
    gen_b = with_redis.get(f"meridian:cache:gen:{b['tid']}")

    client_b = await start(monkeypatch, b)
    async with client_b:
        body_b = (await client_b.get("/api/v1/work/summary", headers=headers())).json()

    calls = []
    real = work._summary

    async def counting(*args, **kw):
        calls.append(1)
        return await real(*args, **kw)

    monkeypatch.setattr(work, "_summary", counting)
    client_a = await start(monkeypatch, a)
    async with client_a:
        body_a = (await client_a.get("/api/v1/work/summary", headers=headers())).json()
        assert calls == [1]  # tenant A never reads tenant B's cached body
        assert body_a["version_id"] == a["run"] and body_b["version_id"] == b["run"]
        d = await client_a.post("/api/v1/work/decide", headers=headers(), json={"items": [
            {"module": "material_master", "record_key": R1, "check_id": "MM014", "action": "edit", "value": "PC"}]})
        assert d.status_code == 200, d.text

    # A's decision changed A's counts and bumped A's generation only
    assert with_redis.get(f"meridian:cache:gen:{b['tid']}") == gen_b
    assert with_redis.get(f"meridian:cache:gen:{a['tid']}") not in (None, gen_b)
    assert q(owner, "SELECT module, status, severity, count FROM work_counts WHERE tenant_id = :t ORDER BY 1, 2, 3",
             t=b["tid"]) == before_b
    assert_no_drift(owner, a["tid"])
    assert_no_drift(owner, b["tid"])

    monkeypatch.setattr(work, "_summary", real)
    client_b = await start(monkeypatch, b)
    async with client_b:  # B still served from its own entry, unchanged
        assert (await client_b.get("/api/v1/work/summary", headers=headers())).json() == body_b
