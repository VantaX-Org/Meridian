"""Triage engine + routes against a real Postgres (RLS enforced, non-superuser role).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
Covers: rule order / team round-robin / fallback, idempotent auto-assign, SLA start,
on_track -> at_risk -> breached with one notification per event, escalation to the team
lead / fallback owner, pause on waiting + resume shifting deadlines, the beat sweep being
a no-op on a second run, and the queue / bulk / metrics routes over asyncpg.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_triage_app"


@pytest.fixture(scope="module")
def engines():
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
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {ROLE}"))
    owner.dispose()


def _tenant(owner, users: list[str], inactive: tuple[str, ...] = ()) -> tuple[str, dict[str, str], str]:
    """Tenant + named users + one analysis version. Returns (tid, {name: user id}, version id)."""
    from sqlalchemy import text

    tid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    ids = {n: str(uuid.uuid4()) for n in users}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Triage')"), {"t": tid})
        for n, i in ids.items():
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                           "VALUES (:i, :t, :e, :n, 'steward', :a)"),
                      {"i": i, "t": tid, "e": f"{n}-{i[:8]}@example.test", "n": n, "a": n not in inactive})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
    return tid, ids, vid


def _issue(c, tid, vid, check_id, key, severity="high", module="accounts_payable", status="open") -> str:
    from sqlalchemy import text

    return str(c.execute(text(
        "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status, "
        "first_seen_version, last_seen_version) VALUES (:t, 'sys', :m, :c, :k, 'LFA1', :s, :st, :v, :v) "
        "RETURNING id"), {"t": tid, "m": module, "c": check_id, "k": key, "s": severity, "st": status,
                          "v": vid}).scalar())


def _session(app, tid):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    s = Session(app)
    s.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
    return s


def _rows(app, tid, sql, **p):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return c.execute(text(sql), p).fetchall()


def test_assign_sla_escalate_pause(engines):
    from sqlalchemy import text

    from api.services import triage

    owner, app = engines
    tid, u, vid = _tenant(owner, ["a", "b", "crit", "lead", "fb", "gone"], inactive=("gone",))
    other, _, ovid = _tenant(owner, ["x"])

    with _session(app, tid) as s:
        team = str(s.execute(text("INSERT INTO triage_teams (tenant_id, name, lead_user_id, strategy) "
                                  "VALUES (:t, 'AP', :l, 'round_robin') RETURNING id"),
                             {"t": tid, "l": u["lead"]}).scalar())
        for m in ("a", "b", "gone"):
            s.execute(text("INSERT INTO triage_team_members (tenant_id, team_id, user_id) VALUES (:t, :tm, :u)"),
                      {"t": tid, "tm": team, "u": u[m]})
        # order matters: the critical rule sits first, so critical AP items never reach the team
        for pos, (name, match, user, tm) in enumerate([
                ("critical", '{"severity": ["critical"]}', u["crit"], None),
                ("ap team", '{"module": ["accounts_payable"]}', None, team),
                ("plant P9", '{"plant": ["P9"]}', u["gone"], None)]):
            s.execute(text("INSERT INTO assignment_rules (tenant_id, name, position, match, assign_user_id, "
                           "assign_team_id) VALUES (:t, :n, :p, CAST(:m AS jsonb), :u, :tm)"),
                      {"t": tid, "n": name, "p": pos, "m": match, "u": user, "tm": tm})
        s.execute(text("INSERT INTO triage_settings (tenant_id, fallback_user_id) VALUES (:t, :f)"),
                  {"t": tid, "f": u["fb"]})
        s.execute(text("INSERT INTO sla_policies (tenant_id, severity, ack_minutes, resolve_minutes, at_risk_pct) "
                       "VALUES (:t, 'high', NULL, 600, 80), (:t, 'critical', 30, 120, 50)"), {"t": tid})
        crit = _issue(s, tid, vid, "AP-1", "BUKRS=1000|LIFNR=1", severity="critical")
        ap = [_issue(s, tid, vid, "AP-2", f"BUKRS=1000|LIFNR={i}") for i in (2, 3, 4)]
        mm = _issue(s, tid, vid, "MM-1", "WERKS=P9|MATNR=1", module="material_master")
        other_mm = _issue(s, tid, vid, "MM-2", "MATNR=2", module="material_master", severity="low")
        done = _issue(s, tid, vid, "AP-3", "LIFNR=9", status="resolved")
        q = str(s.execute(text("INSERT INTO stewardship_queue (tenant_id, item_type, source_id, domain, priority) "
                               "VALUES (:t, 'merge_review', :src, 'business_partner', 2) RETURNING id"),
                          {"t": tid, "src": str(uuid.uuid4())}).scalar())
        s.commit()
    with _session(app, other) as s:
        foreign = _issue(s, other, ovid, "AP-2", "LIFNR=1")
        s.commit()

    # 1. auto-assign: rule order, round robin over active members, inactive target -> fallback
    with _session(app, tid) as s:
        assert triage.auto_assign(s, tid) == {"issue": 6, "queue": 1}
        s.commit()
    with _session(app, tid) as s:
        assert triage.auto_assign(s, tid) == {"issue": 0, "queue": 0}  # idempotent
        s.commit()
    got = {str(r.id): (str(r.assigned_to) if r.assigned_to else None, r.assigned_team_id is not None)
           for r in _rows(app, tid, "SELECT id, assigned_to, assigned_team_id FROM record_issues")}
    assert got[crit] == (u["crit"], False)
    picks = [got[i][0] for i in ap]  # round robin over members sorted by id; inactive "gone" skipped
    assert all(got[i][1] for i in ap) and picks[0] == picks[2] != picks[1] and set(picks) == {u["a"], u["b"]}
    assert got[mm] == (u["fb"], False) and got[other_mm] == (u["fb"], False)
    assert got[done] == (None, False)
    assert _rows(app, tid, "SELECT assigned_to::text FROM stewardship_queue")[0][0] == u["fb"]
    assert _rows(app, tid, "SELECT rr_cursor FROM triage_teams")[0][0] == 3
    notes = {r.note for r in _rows(app, tid, "SELECT note FROM record_issue_events WHERE action = 'assign'")}
    assert notes == {"auto-assigned by rule: critical", "auto-assigned by rule: ap team",
                     "auto-assigned by rule: plant P9"} | {"auto-assigned to fallback owner"}
    assert _rows(app, other, "SELECT assigned_to FROM record_issues WHERE id = :i", i=foreign)[0][0] is None

    # 2. SLA clocks start from the assignment time, per policy; default policy for 'low'
    with _session(app, tid) as s:
        assert triage.apply_sla(s, tid) == {"issue": 6, "queue": 1}
        assert triage.apply_sla(s, tid) == {"issue": 0, "queue": 0}
        s.commit()
    r = _rows(app, tid, "SELECT assigned_at, sla_started_at, due_at, risk_at, ack_due_at, sla_state "
                        "FROM record_issues WHERE id = :i", i=crit)[0]
    assert r.sla_started_at == r.assigned_at and r.sla_state == "on_track"
    assert (r.due_at - r.sla_started_at, r.risk_at - r.sla_started_at, r.ack_due_at - r.sla_started_at) == \
        (timedelta(minutes=120), timedelta(minutes=60), timedelta(minutes=30))
    low = _rows(app, tid, "SELECT due_at - sla_started_at, sla_policy_id FROM record_issues WHERE id = :i",
                i=other_mm)[0]
    assert low[0] == timedelta(minutes=triage.DEFAULT_POLICIES["low"]["resolve_minutes"]) and low[1] is None

    # 3. state transitions; every event notifies exactly once
    def age(item, minutes):
        with owner.begin() as c:
            c.execute(text("UPDATE record_issues SET sla_started_at = sla_started_at - make_interval(mins => :m), "
                           "due_at = due_at - make_interval(mins => :m), risk_at = risk_at - make_interval(mins => :m), "
                           "ack_due_at = ack_due_at - make_interval(mins => :m), "
                           "ack_risk_at = ack_risk_at - make_interval(mins => :m) WHERE id = :i"),
                      {"m": minutes, "i": item})

    def sweep():
        with _session(app, tid) as s:
            out = triage.run_tenant(s, tid)
            s.commit()
        return out

    def notifs():
        return sorted((r.type, r.user_id) for r in _rows(app, tid, "SELECT type, user_id::text FROM notifications"))

    sweep()
    assert notifs() == []
    age(ap[0], 500)  # 500 of 600 min: past the 80 % risk point
    out = sweep()
    assert out["notified"]["issue:at_risk"] == 1
    assert notifs() == [("sla_at_risk", picks[0])]
    sweep()
    assert notifs() == [("sla_at_risk", picks[0])]  # second sweep: nothing new
    age(ap[0], 200)  # breached -> owner + team lead
    sweep()
    assert notifs() == sorted([("sla_at_risk", picks[0]), ("sla_breached", picks[0]), ("sla_breached", u["lead"])])
    assert _rows(app, tid, "SELECT sla_state FROM record_issues WHERE id = :i", i=ap[0])[0][0] == "breached"
    age(crit, 40)  # ack window (30) passed; resolve risk (60) not yet
    sweep()
    st = _rows(app, tid, "SELECT sla_state, sla_notified FROM record_issues WHERE id = :i", i=crit)[0]
    assert st.sla_state == "breached" and st.sla_notified == ["ack_breached"]
    # no team: escalation goes to the fallback owner
    assert ("sla_ack_breached", u["fb"]) in notifs() and ("sla_ack_breached", u["crit"]) in notifs()
    ev = _rows(app, tid, "SELECT action, to_value FROM record_issue_events WHERE issue_id = :i "
                         "AND action LIKE 'sla_%' ORDER BY created_at", i=ap[0])
    assert [(e.action, e.to_value) for e in ev] == [("sla_at_risk", None), ("sla_breached", u["lead"])]

    # 4. pause while waiting on SAP; resume moves deadlines by the paused time
    with _session(app, tid) as s:
        s.execute(text("UPDATE record_issues SET status = 'waiting_sap' WHERE id = :i"), {"i": ap[1]})
        assert triage.sync_pause(s, tid, "issue", [ap[1]]) == {"paused": 1, "resumed": 0}
        s.commit()
    before = _rows(app, tid, "SELECT due_at, sla_paused_at FROM record_issues WHERE id = :i", i=ap[1])[0]
    with owner.begin() as c:  # paused for two hours
        c.execute(text("UPDATE record_issues SET sla_paused_at = sla_paused_at - interval '2 hours' WHERE id = :i"),
                  {"i": ap[1]})
    age(ap[1], 0)
    with owner.begin() as c:  # while paused the item would be overdue, but the sweep leaves it alone
        c.execute(text("UPDATE record_issues SET due_at = now() - interval '1 minute' WHERE id = :i"), {"i": ap[1]})
    sweep()
    assert _rows(app, tid, "SELECT sla_state FROM record_issues WHERE id = :i", i=ap[1])[0][0] == "on_track"
    with owner.begin() as c:
        c.execute(text("UPDATE record_issues SET due_at = :d WHERE id = :i"), {"d": before.due_at, "i": ap[1]})
    with _session(app, tid) as s:
        s.execute(text("UPDATE record_issues SET status = 'in_progress' WHERE id = :i"), {"i": ap[1]})
        assert triage.sync_pause(s, tid, "issue", [ap[1]]) == {"paused": 0, "resumed": 1}
        s.commit()
    after = _rows(app, tid, "SELECT due_at, sla_paused_at FROM record_issues WHERE id = :i", i=ap[1])[0]
    assert after.sla_paused_at is None
    assert abs((after.due_at - before.due_at) - timedelta(hours=2)) < timedelta(seconds=5)

    # 5. the whole beat sweep is a no-op once settled
    out = sweep()
    assert out["assigned"] == {"issue": 0, "queue": 0} and out["sla_started"] == {"issue": 0, "queue": 0}
    assert not any(out["notified"].values())
    # the other tenant saw none of it
    assert _rows(app, other, "SELECT COUNT(*) FROM notifications")[0][0] == 0


def test_auto_assign_owner_order(engines):
    from sqlalchemy import text

    from api.services import triage

    owner, app = engines
    tid, u, vid = _tenant(owner, ["rule_owner", "obj_steward", "gloss", "fb", "gone"], inactive=("gone",))
    with _session(app, tid) as s:
        for kind, ref, own, stw in (("rule", "AP-9", u["rule_owner"], None),
                                    ("object", "accounts_payable", None, u["obj_steward"]),
                                    ("object", "material_master", u["gone"], None)):
            s.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id, steward_user_id) "
                           "VALUES (:t, :k, :r, :o, :s)"), {"t": tid, "k": kind, "r": ref, "o": own, "s": stw})
        term = s.execute(text(
            "INSERT INTO glossary_terms (tenant_id, domain, sap_table, sap_field, technical_name, business_name, "
            "data_steward_id) VALUES (:t, 'fi_gl', 'SKA1', 'SAKNR', 'SKA1.SAKNR', 'G/L account', :g) RETURNING id"),
            {"t": tid, "g": u["gloss"]}).scalar()
        s.execute(text("INSERT INTO glossary_term_rules (tenant_id, term_id, rule_id, domain) "
                       "VALUES (:t, :term, 'GL-1', 'fi_gl')"), {"t": tid, "term": term})
        s.execute(text("INSERT INTO triage_settings (tenant_id, fallback_user_id) VALUES (:t, :f)"),
                  {"t": tid, "f": u["fb"]})
        for check, module in (("AP-9", "accounts_payable"), ("AP-8", "accounts_payable"),
                              ("GL-1", "fi_gl"), ("MM-1", "material_master")):
            _issue(s, tid, vid, check, f"KEY={check}", module=module)
        s.commit()

    with _session(app, tid) as s:
        assert triage.auto_assign(s, tid)["issue"] == 4
        s.commit()
    got = dict(_rows(app, tid, "SELECT check_id, assigned_to::text FROM record_issues "
                               "WHERE tenant_id = CAST(:t AS uuid)", t=tid))
    assert got == {"AP-9": u["rule_owner"],   # rule owner beats the object steward
                   "AP-8": u["obj_steward"],  # object steward
                   "GL-1": u["gloss"],        # glossary steward of the rule's term
                   "MM-1": u["fb"]}           # object owner inactive → fallback
    notes = sorted(r[0] for r in _rows(app, tid, "SELECT note FROM record_issue_events "
                                                 "WHERE tenant_id = CAST(:t AS uuid) AND action = 'assign'", t=tid))
    assert notes == ["auto-assigned to data owner"] * 3 + ["auto-assigned to fallback owner"]

    # A tenant with owners but no rules and no fallback is still routed.
    t2, u2, v2 = _tenant(owner, ["own"])
    with _session(app, t2) as s:
        s.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) "
                       "VALUES (:t, 'object', 'accounts_payable', :o)"), {"t": t2, "o": u2["own"]})
        _issue(s, t2, v2, "AP-2", "LIFNR=1")
        s.commit()
    with _session(app, t2) as s:
        assert triage.auto_assign(s, t2)["issue"] == 1
        s.commit()


def test_routes(engines):
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.triage import router

    owner, app_eng = engines
    tid, u, vid = _tenant(owner, ["a", "b", "lead"])
    with _session(app_eng, tid) as s:
        ids = [_issue(s, tid, vid, "AP-2", f"LIFNR={i}", severity=sev)
               for i, sev in enumerate(("critical", "high", "low", "medium"))]
        s.commit()

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "Triage", [])
    base = "/api/v1/triage"

    def total(q):
        return sum(q[b]["count"] for b in ("overdue", "due_today", "later"))

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            admin, steward, analyst = ({"X-User-Role": r} for r in ("admin", "steward", "analyst"))
            # config: analyst can read, not write; steward manages rules, admin manages settings
            assert (await c.post(f"{base}/teams", headers=analyst, json={"name": "AP"})).status_code == 403
            team = (await c.post(f"{base}/teams", headers=steward, json={
                "name": "AP", "strategy": "least_loaded", "lead_user_id": u["lead"],
                "member_ids": [u["a"], u["b"]]})).json()
            assert sorted(team["member_ids"]) == sorted([u["a"], u["b"]])
            bad = await c.post(f"{base}/teams", headers=steward,
                               json={"name": "X", "member_ids": [str(uuid.uuid4())]})
            assert bad.status_code == 422
            # renaming: own name is fine, another team's name is 409, an explicit null is 422
            ap = f"{base}/teams/{team['id']}"
            other = (await c.post(f"{base}/teams", headers=steward, json={"name": "AR"})).json()
            assert (await c.patch(ap, headers=steward, json={"name": "AP"})).status_code == 200
            assert (await c.patch(ap, headers=steward, json={"name": "AR"})).status_code == 409
            assert (await c.patch(ap, headers=steward, json={"name": None})).status_code == 422
            assert (await c.delete(f"{base}/teams/{other['id']}", headers=steward)).status_code == 204
            r1 = (await c.post(f"{base}/rules", headers=steward, json={
                "name": "all to AP", "assign_team_id": team["id"]})).json()
            r0 = (await c.post(f"{base}/rules", headers=steward, json={
                "name": "critical to lead", "match": {"severity": ["critical"]}, "assign_user_id": u["lead"],
                "position": 0})).json()
            rules = (await c.get(f"{base}/rules", headers=analyst)).json()
            assert [r["id"] for r in rules] == [r0["id"], r1["id"]]
            rules = (await c.post(f"{base}/rules/reorder", headers=steward, json={"ids": [r1["id"], r0["id"]]})).json()
            assert [r["position"] for r in rules] == [0, 1] and rules[0]["id"] == r1["id"]
            assert (await c.post(f"{base}/rules/reorder", headers=steward,
                                 json={"ids": [r1["id"]]})).status_code == 422
            await c.post(f"{base}/rules/reorder", headers=steward, json={"ids": [r0["id"], r1["id"]]})
            pol = await c.put(f"{base}/sla-policies", headers=steward, json={
                "severity": "high", "resolve_minutes": 240, "ack_minutes": 60})
            assert pol.status_code == 200
            again = (await c.put(f"{base}/sla-policies", headers=steward, json={
                "severity": "high", "resolve_minutes": 300})).json()
            assert again["id"] == pol.json()["id"] and again["resolve_minutes"] == 300
            pols = (await c.get(f"{base}/sla-policies", headers=analyst)).json()
            assert {p["severity"]: p["is_default"] for p in pols if p["module"] is None} == \
                {"critical": True, "high": False, "medium": True, "low": True}
            assert (await c.put(f"{base}/settings", headers=steward, json={})).status_code == 403
            st = await c.put(f"{base}/settings", headers=admin, json={
                "timezone": "Africa/Johannesburg", "work_days": [1, 2, 3, 4, 5], "holidays": ["2026-12-25"]})
            assert st.status_code == 200
            assert (await c.get(f"{base}/settings", headers=analyst)).json()["timezone"] == "Africa/Johannesburg"

            # the sweep assigns: critical -> lead, the rest split least-loaded over a / b
            with _session(app_eng, tid) as s:
                from api.services import triage
                assert triage.run_tenant(s, tid)["assigned"]["issue"] == 4
                s.commit()
            q = (await c.get(f"{base}/queue", headers=analyst, params={"assignee": "all"})).json()
            assert total(q) == 4 and q["overdue"]["count"] == 0
            later = q["later"]["items"]  # high (300 min) may land in due_today depending on the clock
            assert [i["severity"] for i in later] == [s for s in ("critical", "high", "medium", "low")
                                                      if s in {i["severity"] for i in later}]  # priority order
            crit = next(i for b in ("due_today", "later") for i in q[b]["items"] if i["severity"] == "critical")
            assert crit["assigned_to"] == u["lead"]
            team_q = (await c.get(f"{base}/queue", headers=analyst,
                                  params={"assignee": f"team:{team['id']}"})).json()
            assert total(team_q) == 3
            assert (await c.get(f"{base}/queue", headers=analyst)).status_code == 400  # no signed-in user
            assert (await c.get(f"{base}/queue", headers=analyst,
                                params={"assignee": "nope"})).status_code == 422

            # bulk: analyst may not; snooze hides, priority reorders, wait pauses, resume restarts
            body = {"kind": "issue", "ids": ids[1:2], "action": "snooze", "reason": "vendor on leave",
                    "until": (datetime.now(UTC) + timedelta(days=2)).isoformat()}
            assert (await c.post(f"{base}/bulk", headers=analyst, json=body)).status_code == 403
            assert (await c.post(f"{base}/bulk", headers=steward, json=body)).json()["updated"] == 1
            q = (await c.get(f"{base}/queue", headers=analyst, params={"assignee": "all"})).json()
            assert total(q) == 3
            q = (await c.get(f"{base}/queue", headers=analyst,
                             params={"assignee": "all", "include_snoozed": "true"})).json()
            assert total(q) == 4
            pr = await c.post(f"{base}/bulk", headers=steward, json={
                "kind": "issue", "ids": ids[2:3], "action": "priority", "priority": 1})
            assert pr.json()["updated"] == 1
            q = (await c.get(f"{base}/queue", headers=analyst, params={"assignee": "all"})).json()
            pos = {i["id"]: (b, n) for b in ("due_today", "later") for n, i in enumerate(q[b]["items"])}
            assert pos[ids[2]][1] == 0 or pos[ids[2]] == ("later", 1)  # priority 1 jumps the bucket
            ack = await c.post(f"{base}/bulk", headers=steward, json={
                "kind": "issue", "ids": ids, "action": "acknowledge"})
            assert ack.json()["updated"] == 4
            w = (await c.post(f"{base}/bulk", headers=steward, json={
                "kind": "issue", "ids": ids[3:], "action": "wait", "waiting": "waiting_requester"})).json()
            assert w["updated"] == 1 and w["sla"] == {"paused": 1, "resumed": 0}
            rs = (await c.post(f"{base}/bulk", headers=steward, json={
                "kind": "issue", "ids": ids[3:], "action": "resume"})).json()
            assert rs["updated"] == 1 and rs["sla"]["resumed"] == 1
            # reassign to a user; plain assign does not steal assigned items
            ra = await c.post(f"{base}/bulk", headers=steward, json={
                "kind": "issue", "ids": ids[1:3], "action": "assign", "user_id": u["lead"]})
            assert ra.json()["updated"] == 0
            ra = await c.post(f"{base}/bulk", headers=steward, json={
                "kind": "issue", "ids": ids[1:3], "action": "reassign", "user_id": u["lead"]})
            assert ra.json()["updated"] == 2
            mine = (await c.get(f"{base}/queue", headers=analyst,
                                params={"assignee": u["lead"], "include_snoozed": "true"})).json()
            assert total(mine) == 3

            with app_eng.begin() as conn:
                conn.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
                acts = conn.execute(text("SELECT action, COUNT(*) FROM record_issue_events GROUP BY 1")).fetchall()
                assert dict(acts) == {"assign": 6, "snooze": 1, "priority": 1, "acknowledge": 4, "status": 2}
                # resolve one late, one in time, for the metrics
                conn.execute(text("UPDATE record_issues SET status = 'resolved', resolved_at = due_at + "
                                  "interval '1 hour' WHERE id = :i"), {"i": ids[0]})
                conn.execute(text("UPDATE record_issues SET status = 'resolved', resolved_at = now() WHERE id = :i"),
                             {"i": ids[3]})
            m = (await c.get(f"{base}/metrics", headers=analyst)).json()
            assert m["resolved_total"] == 2 and m["resolved_in_sla"] == 1 and m["sla_attainment_pct"] == 50.0
            assert m["breach_count"] == 1 and m["unassigned"] == 0
            assert {o["user_id"]: o["open"] for o in m["backlog_by_owner"]} == {u["lead"]: 2}
            assert m["mtta_hours"] is not None and m["mttr_hours"] is not None
            assert len(m["weekly"]) >= 8 and sum(w["opened"] for w in m["weekly"]) == 4

            # deleting a team drops its rule; deleting a rule compacts positions
            assert (await c.delete(f"{base}/teams/{team['id']}", headers=steward)).status_code == 204
            assert [r["id"] for r in (await c.get(f"{base}/rules", headers=analyst)).json()] == [r0["id"]]

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
