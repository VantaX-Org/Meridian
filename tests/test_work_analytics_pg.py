"""The lead's work analytics (api/services/work_analytics.py, api/routes/work_analytics.py) against a real Postgres.

One system ("ERP prod") with two runs of material master and FI general ledger, ten and one days ago:

  issue  rule   record                  first seen  now                         notes
  I1     MM001  MATNR=1|WERKS=1000      -10         open, assigned, overdue
  I2     MM001  MATNR=2|WERKS=1000      -10         fixed -1                    9 days to fix
  I3     MM001  MATNR=3|WERKS=2000      -10         fixed -4                    6 days to fix
  I4     MM002  MATNR=1|WERKS=1000      -10         not an issue -3 (Ann)
  I5     MM001  MATNR=4|WERKS=2000      -40         open                        fixed -20, came back -1
  I6     MM003  MATNR=1|WERKS=1000      -1          open
  I7     GL001  BUKRS=1000|SAKNR=1      -1          open
  I8     GL002  BUKRS=2000|SAKNR=9      -30         fixed -2 (an upload)        28 days, came back twice

Days are UTC days counted back from today; every timestamp sits at noon so no assertion straddles midnight.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000b7"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def _today(c) -> date:
    return c.execute(text("SELECT (now() AT TIME ZONE 'UTC')::date")).scalar()


@pytest.fixture
def seeded(owner):
    tid, sid, v1, v2, assignee = (str(uuid.uuid4()) for _ in range(5))
    with owner.begin() as c:
        today = _today(c)
        at = lambda n: datetime.combine(today - timedelta(days=n), time(12), tzinfo=timezone.utc)
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'Ann Steward', 'admin')"),
                  {"u": assignee, "t": tid, "e": f"{tid[:8]}@example.com"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'ERP prod')"), {"s": sid, "t": tid})
        meta = json.dumps({"system_id": sid, "modules": ["material_master", "fi_gl"]})
        for vid, n in ((v1, 10), (v2, 1)):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata) "
                           "VALUES (:v, :t, 'complete', :at, CAST(:m AS jsonb))"), {"v": vid, "t": tid, "at": at(n), "m": meta})
        findings = [(v1, "material_master", "MM001", "critical", 3), (v1, "material_master", "MM002", "medium", 1),
                    (v2, "material_master", "MM001", "critical", 2), (v2, "material_master", "MM003", "high", 1),
                    (v2, "fi_gl", "GL001", "low", 1)]
        for vid, mod, chk, sev, n in findings:
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count, details) VALUES (:v, :t, :m, :c, :s, 'completeness', :n, 10, "
                           "CAST('{}' AS jsonb))"), {"v": vid, "t": tid, "m": mod, "c": chk, "s": sev, "n": n})
        records = [(v1, "material_master", "MM001", "MATNR=1|WERKS=1000"), (v1, "material_master", "MM001", "MATNR=2|WERKS=1000"),
                   (v1, "material_master", "MM001", "MATNR=3|WERKS=2000"), (v1, "material_master", "MM002", "MATNR=1|WERKS=1000"),
                   (v2, "material_master", "MM001", "MATNR=1|WERKS=1000"), (v2, "material_master", "MM001", "MATNR=4|WERKS=2000"),
                   (v2, "material_master", "MM003", "MATNR=1|WERKS=1000"), (v2, "fi_gl", "GL001", "BUKRS=1000|SAKNR=1")]
        for vid, mod, chk, key in records:
            c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, record_key) "
                           "VALUES (:t, :v, :c, :m, :k)"), {"t": tid, "v": vid, "c": chk, "m": mod, "k": key})
        # v2 has its work list built; v1 does not (root causes then read finding_records)
        c.execute(text("INSERT INTO work_groups (tenant_id, version_id, check_id, module, severity, sev_rank, records) "
                       "VALUES (:t, :v, 'MM001', 'material_master', 'critical', 0, 2)"), {"t": tid, "v": v2})
        c.execute(text("UPDATE analysis_versions SET metadata = metadata || '{\"worklist_built_at\": \"now\"}'::jsonb "
                       "WHERE id = :v"), {"v": v2})
        for mod, key, issues, rank, status in (("material_master", "MATNR=1|WERKS=1000", 2, 0, "to_fix"),
                                               ("material_master", "MATNR=4|WERKS=2000", 1, 0, "proposed"),
                                               ("fi_gl", "BUKRS=1000|SAKNR=1", 1, 3, "fixed")):
            c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, issues, sev_rank, "
                           "checks, status) VALUES (:t, :v, :s, :m, :k, :i, :r, ARRAY['x'], :st)"),
                      {"t": tid, "v": v2, "s": sid, "m": mod, "k": key, "i": issues, "r": rank, "st": status})
        issues = {
            "I1": (sid, "material_master", "MM001", "MATNR=1|WERKS=1000", "critical", "open", None, 10, None, 0),
            "I2": (sid, "material_master", "MM001", "MATNR=2|WERKS=1000", "critical", "resolved", "verified_fixed", 10, 1, 0),
            "I3": (sid, "material_master", "MM001", "MATNR=3|WERKS=2000", "critical", "resolved", "verified_fixed", 10, 4, 0),
            "I4": (sid, "material_master", "MM002", "MATNR=1|WERKS=1000", "medium", "accepted", "false_positive", 10, 3, 0),
            "I5": (sid, "material_master", "MM001", "MATNR=4|WERKS=2000", "critical", "open", None, 40, None, 1),
            "I6": (sid, "material_master", "MM003", "MATNR=1|WERKS=1000", "high", "open", None, 1, None, 0),
            "I7": (sid, "fi_gl", "GL001", "BUKRS=1000|SAKNR=1", "low", "open", None, 1, None, 0),
            "I8": ("upload", "fi_gl", "GL002", "BUKRS=2000|SAKNR=9", "low", "resolved", "verified_fixed", 30, 2, 2),
        }
        ids = {}
        for name, (scope, mod, chk, key, sev, st, res, seen, fixed, reopened) in issues.items():
            ids[name] = c.execute(text("""
                INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, resolution,
                                           first_seen_version, last_seen_version, first_seen_at, resolved_at,
                                           reopened_count, assigned_to, due_at)
                VALUES (:t, :sc, :m, :c, :k, :sev, :st, :res, :v1, :v2, :seen, :fixed, :reo, :who, :due)
                RETURNING id::text"""), {
                "t": tid, "sc": scope, "m": mod, "c": chk, "k": key, "sev": sev, "st": st, "res": res, "v1": v1, "v2": v2,
                "seen": at(seen), "fixed": at(fixed) if fixed is not None else None, "reo": reopened,
                "who": assignee if name == "I1" else None, "due": at(2) if name == "I1" else None}).scalar()
        events = [("I5", "system", "auto_resolved", None, "resolved", 20), ("I5", "system", "reopened", "resolved", "open", 1),
                  ("I4", "Ann", "status", None, "accepted", 3), ("I4", "system", "status", None, "accepted", 3),
                  ("I1", "Ann", "status", None, "accepted", 40)]  # the last one is outside the 30-day window
        for name, who, action, frm, to, n in events:
            c.execute(text("INSERT INTO record_issue_events (tenant_id, issue_id, user_label, action, from_value, to_value, "
                           "created_at) VALUES (:t, :i, :u, :a, :f, :to, :at)"),
                      {"t": tid, "i": ids[name], "u": who, "a": action, "f": frm, "to": to, "at": at(n)})
        batches = {"B": ("Ann", "draft", "worklist"), "C": ("Bob", "exported", "worklist"), "D": ("Dan", "approved", None)}
        bids = {}
        for b, (who, st, src) in batches.items():
            bids[b] = c.execute(text("INSERT INTO remediation_batches (tenant_id, name, status, filter, created_by_label) "
                                     "VALUES (:t, :n, :st, CAST(:f AS jsonb), :who) RETURNING id::text"),
                                {"t": tid, "n": b, "st": st, "f": json.dumps({"source": src} if src else {}), "who": who}).scalar()
        items = [("B", "I1", "material_master", "MM001", "MATNR=1|WERKS=1000", "EA", "rule", False, None, 2),
                 ("B", "I6", "material_master", "MM003", "MATNR=1|WERKS=1000", "X", "steward", False, None, 2),
                 ("B", "I5", "material_master", "MM001", "MATNR=4|WERKS=2000", None, "rule", False, None, 2),
                 ("C", "I7", "fi_gl", "GL001", "BUKRS=1000|SAKNR=1", "1000", "rule", True, "fixed", 5),
                 ("D", "I3", "material_master", "MM001", "MATNR=3|WERKS=2000", "KG", "cleaning", False, "still_failing", 6)]
        iids = {}
        for b, issue, mod, chk, key, val, src, acc, recon, n in items:
            iids[(b, chk)] = c.execute(text("""
                INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key,
                                               proposed_value, proposal_source, accepted, recon_status, updated_at)
                VALUES (:t, :b, :i, :sc, :m, :c, :k, :val, :src, :acc, :recon, :at) RETURNING id::text"""), {
                "t": tid, "b": bids[b], "i": ids[issue], "sc": sid, "m": mod, "c": chk, "k": key, "val": val,
                "src": src, "acc": acc, "recon": recon, "at": at(n)}).scalar()
        c.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_label, action, created_at) "
                       "VALUES (:t, :b, :i, 'Cara', 'approved', :at)"),
                  {"t": tid, "b": bids["C"], "i": iids[("C", "GL001")], "at": at(4)})
    yield {"tid": tid, "sid": sid, "v1": v1, "v2": v2, "today": today, "who": assignee}


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


async def _get(client, path, **params):
    r = await client.get(f"/api/v1/work/analytics{path}", params=params, headers=HEADERS)
    assert r.status_code == 200, r.text
    return r.json()


def test_projection_pace():
    from api.services.work_analytics import projection

    today = date(2026, 10, 25)
    assert projection(10, 38, today) == (1.0, date(2026, 11, 4))  # 28 closed net in 28 days, 10 left
    assert projection(5, 5, today) == (0.0, None)  # no net progress: no date
    assert projection(9, 2, today) == (-0.25, None)  # growing backlog: no date
    assert projection(0, 28, today) == (1.0, today)  # done


@pytest.mark.anyio
async def test_analytics_numbers(seeded, client_for):
    s = seeded
    deps, client = client_for(s["tid"])
    await deps.engine.dispose()
    today = s["today"]
    day = lambda n: (today - timedelta(days=n)).isoformat()
    async with client:
        b = await _get(client, "/burndown")
        assert b["version_id"] == s["v2"]  # the latest run when none is named
        series = {d["day"]: d["open"] for d in b["days"]}
        assert len(b["days"]) == 90 and b["days"][-1]["day"] == today.isoformat()
        assert [series[day(n)] for n in (41, 40, 30, 20, 10, 4, 3, 2, 1, 0)] == [0, 1, 2, 1, 5, 4, 3, 2, 4, 4]
        assert b["open_now"] == 4 and b["fixed_7d"] == 3 and b["open_records"] == 2
        assert {d["day"]: (d["opened"], d["closed"]) for d in b["days"]}[day(1)] == (3, 1)
        # 2 open 28 days ago, 4 now: the backlog grew, so there is no finish date
        assert b["pace_per_day"] == round(-2 / 28, 2) and b["projected_finish"] is None
        assert [(r["version_id"], r["issues"], r["open_records"]) for r in b["runs"]] == [(s["v1"], 4, None), (s["v2"], 4, 2)]
        gl = await _get(client, "/burndown", module="fi_gl")
        assert gl["open_now"] == 1 and gl["fixed_7d"] == 1 and [r["issues"] for r in gl["runs"]] == [0, 1]

        t = await _get(client, "/time-to-fix")
        assert t["overall"] == {"fixed": 3, "median_days": 9.0, "p90_days": 24.2}
        assert t["by_object"] == [{"module": "fi_gl", "fixed": 1, "median_days": 28.0, "p90_days": 28.0},
                                  {"module": "material_master", "fixed": 2, "median_days": 7.5, "p90_days": 8.7}]
        assert [(c["check_id"], c["median_days"]) for c in t["by_check"]] == [("GL002", 28.0), ("MM001", 7.5)]
        assert [(x["severity"], x["fixed"]) for x in t["by_severity"]] == [("critical", 2), ("low", 1)]
        assert (await _get(client, "/time-to-fix", days=7))["overall"]["fixed"] == 3

        tp = await _get(client, "/throughput")
        assert tp["totals"] == {"accept": 2, "edit": 1, "not_an_issue": 1, "accept_risk": 0, "approve": 1, "total": 5}
        assert [(p["person"], p["total"]) for p in tp["people"]] == [("Ann", 3), ("Bob", 1), ("Cara", 1)]
        assert tp["people"][0] == {"person": "Ann", "total": 3, "accept": 1, "edit": 1, "not_an_issue": 1,
                                        "accept_risk": 0, "approve": 0}
        by_day = {d["day"]: d for d in tp["days"]}
        assert len(tp["days"]) == 30 and by_day[day(2)]["by_person"] == {"Ann": 2} and by_day[day(4)]["total"] == 1
        assert tp["workload"] == [
            {"assignee_id": s["who"], "name": "Ann Steward", "email": f"{s['tid'][:8]}@example.com", "open": 1, "critical": 1, "overdue": 1},
            {"assignee_id": None, "name": None, "email": None, "open": 3, "critical": 1, "overdue": 0}]

        rc = await _get(client, "/recurrence")
        assert rc["totals"] == {"issues": 8, "reopened": 2, "reopens": 3, "rate_pct": 25.0}
        assert [(c["check_id"], c["reopened"], c["rate_pct"]) for c in rc["by_check"]] == [("GL002", 1, 100.0), ("MM001", 1, 25.0)]
        assert [(x["scope"], x["name"], x["issues"], x["rate_pct"]) for x in rc["by_system"]] == [
            ("upload", "Uploads", 1, 100.0), (s["sid"], "ERP prod", 7, 14.3)]

        roots = await _get(client, "/root-causes")
        assert roots["source"] == "work_records" and roots["total_records"] == 3
        dims = {d["field"]: d for d in roots["dimensions"]}
        assert list(dims) == ["BUKRS", "WERKS"] and dims["WERKS"]["label"] == "Plant"
        assert [(v["value"], v["records"], v["issues"], v["open"], v["critical"], v["share_pct"]) for v in dims["WERKS"]["top"]] == [
            ("1000", 1, 2, 1, 1, 33.3), ("2000", 1, 1, 1, 1, 33.3)]
        assert dims["BUKRS"]["top"] == [{"value": "1000", "records": 1, "issues": 1, "open": 0, "critical": 0, "share_pct": 33.3}]
        old = await _get(client, "/root-causes", version_id=s["v1"])  # no work list: read from finding_records
        assert old["source"] == "finding_records" and old["total_records"] == 3
        assert [(v["value"], v["records"], v["issues"]) for v in old["dimensions"][0]["top"]] == [("1000", 2, 3), ("2000", 1, 1)]

        pq = {r["source"]: r for r in (await _get(client, "/proposal-quality"))["sources"]}
        assert list(pq)[:5] == ["rule", "steward", "cleaning", "simulation", "manual"]
        assert pq["rule"] == {"source": "rule", "proposed": 2, "approved": 1, "exported": 1, "fixed": 1, "still_failing": 0,
                              "approval_rate_pct": 50.0, "fix_rate_pct": 100.0}
        assert (pq["steward"]["proposed"], pq["steward"]["approval_rate_pct"], pq["steward"]["fix_rate_pct"]) == (1, 0.0, None)
        assert (pq["cleaning"]["approved"], pq["cleaning"]["still_failing"], pq["cleaning"]["fix_rate_pct"]) == (1, 1, 0.0)
        assert pq["simulation"]["proposed"] == 0 and pq["simulation"]["approval_rate_pct"] is None

        ch = await _get(client, "/run-change")
        assert ch["previous"]["version_id"] == s["v1"]
        assert ch["objects"] == [
            {"module": "material_master", "new": 1, "fixed": 2, "still_failing": 1, "not_comparable_checks": 2},
            {"module": "fi_gl", "new": 0, "fixed": 0, "still_failing": 0, "not_comparable_checks": 1}]
        assert ch["totals"] == {"new": 1, "fixed": 2, "still_failing": 1} and ch["not_comparable_checks"] == 3
        first = await _get(client, "/run-change", version_id=s["v1"])  # the first run: nothing earlier
        assert first["previous"] is None and first["objects"] == []

        other = await client.get("/api/v1/work/analytics/run-change", params={"version_id": str(uuid.uuid4())}, headers=HEADERS)
        assert other.status_code == 404


@pytest.mark.anyio
async def test_empty_tenant_answers_empty(owner, client_for):
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        b = await _get(client, "/burndown")
        assert b["version_id"] is None and b["open_now"] == 0 and b["projected_finish"] is None and b["runs"] == []
        assert len(b["days"]) == 90 and all(d["open"] == 0 for d in b["days"])
        t = await _get(client, "/time-to-fix")
        assert t["overall"] == {"fixed": 0, "median_days": None, "p90_days": None} and t["by_object"] == []
        tp = await _get(client, "/throughput")
        assert tp["totals"]["total"] == 0 and tp["people"] == [] and tp["workload"] == []
        assert (await _get(client, "/recurrence"))["totals"] == {"issues": 0, "reopened": 0, "reopens": 0, "rate_pct": 0.0}
        assert (await _get(client, "/root-causes"))["dimensions"] == []
        assert (await _get(client, "/proposal-quality"))["totals"]["proposed"] == 0
        ch = await _get(client, "/run-change")
        assert ch["previous"] is None and ch["objects"] == []


@pytest.fixture(autouse=True)
def _fresh_analytics_cache():
    """Each test reads its own seeded data, never another test's cached answer."""
    from api.services import work_analytics
    work_analytics._cache.clear()
    yield
    work_analytics._cache.clear()
