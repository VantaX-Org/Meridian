"""Learned monitor routes: list, steward actions (RBAC, tenant scope, audit) and explain. The database is a scripted fake."""

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import learned_monitors as route

NOW = datetime(2026, 3, 1, tzinfo=timezone.utc)
BID, VID, RID = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


def brk(status="open"):
    return (BID, VID, 7, "material_master", "fail_rate_jump", "fail_rate", "MM014", "high", 3.0, 7.0, 5.0, 30.0, 6,
            [RID], "mad", status, None, None, None, None, None, None, NOW, NOW)


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    def scalar(self):
        return self.rows[0][0] if self.rows else None


class _DB:
    def __init__(self, rows=(), missing=False):
        self.rows, self.missing, self.sql, self.committed = list(rows), missing, [], False

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params or {}))
        if "FROM learned_monitor_breaks b" in q:
            return _Res([] if self.missing else self.rows)
        if "SELECT id::text, run_number, run_at FROM analysis_versions" in q:
            return _Res([(RID, 3, NOW)])
        return _Res([])

    async def commit(self):
        self.committed = True


def _client(monkeypatch, db, tenant=None):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    audits = []

    async def names(*_a):
        return {"MM014": "Base unit not valid"}

    async def audit(*a, **_k):
        audits.append(a[3:])

    monkeypatch.setattr(route, "rule_names", names)
    monkeypatch.setattr(route, "write_audit", audit)
    api = FastAPI()
    api.include_router(route.router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: tenant or Tenant(uuid.uuid4(), "D", [])
    c = TestClient(api)
    c.audits = audits
    return c


ADMIN, VIEWER = {"X-User-Role": "admin"}, {"X-User-Role": "viewer"}
URL = f"/api/v1/aletheia/monitors/{BID}"


def test_acknowledge_is_scoped_audited_and_committed(monkeypatch):
    db, tenant = _DB([brk()]), Tenant(uuid.uuid4(), "D", [])
    c = _client(monkeypatch, db, tenant)
    r = c.post(f"{URL}/acknowledge", json={"note": "seen"}, headers=ADMIN)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["subject_description"] == "Base unit not valid" and j["explanation"]["source"] == "template"
    assert [x["role"] for x in j["citations"]] == ["baseline", "current"] and j["citations"][0]["run_number"] == 3
    upd = [p for q, p in db.sql if q.lstrip().startswith("UPDATE learned_monitor_breaks")][0]
    assert upd["t"] == str(tenant.id) and upd["s"] == "acknowledged" and db.committed
    assert c.audits[0][0] == "learned_monitor.acknowledge" and c.audits[0][2] == BID
    assert all(p.get("t") == str(tenant.id) for q, p in db.sql if "learned_monitor_breaks" in q and "t" in p)


def test_expected_and_snooze_carry_their_effect(monkeypatch):
    db = _DB([brk()])
    c = _client(monkeypatch, db)
    assert c.post(f"{URL}/expected", json={"effect": "accept"}, headers=ADMIN).status_code == 200
    assert c.post(f"{URL}/snooze", json={"days": 14}, headers=ADMIN).status_code == 200
    ups = [p for q, p in db.sql if q.lstrip().startswith("UPDATE learned_monitor_breaks")]
    assert (ups[0]["s"], ups[0]["e"]) == ("expected", "accept") and ups[1]["s"] == "snoozed" and ups[1]["u"] > NOW
    assert [a[0] for a in c.audits] == ["learned_monitor.expected", "learned_monitor.snooze"]


def test_viewer_cannot_decide_and_nothing_is_written(monkeypatch):
    db = _DB([brk()])
    c = _client(monkeypatch, db)
    for path, body in (("acknowledge", {}), ("expected", {"effect": "exclude"}), ("snooze", {"days": 3})):
        assert c.post(f"{URL}/{path}", json=body, headers=VIEWER).status_code == 403
    assert not db.committed and not c.audits and not db.sql


def test_unknown_break_is_404_and_bad_input_422(monkeypatch):
    c = _client(monkeypatch, _DB(missing=True))
    assert c.post(f"{URL}/acknowledge", json={}, headers=ADMIN).status_code == 404
    assert c.post(f"{URL}/snooze", json={"days": 0}, headers=ADMIN).status_code == 422
    assert c.post(f"{URL}/expected", json={"effect": "nope"}, headers=ADMIN).status_code == 422


def test_snooze_past_its_time_reads_as_open(monkeypatch):
    row = list(brk("snoozed"))
    row[17] = datetime(2026, 2, 1, tzinfo=timezone.utc)
    c = _client(monkeypatch, _DB([tuple(row)]))
    assert c.post(f"{URL}/acknowledge", json={}, headers=ADMIN).json()["status"] == "open"


def test_explain_falls_back_to_the_template_and_sends_no_values(monkeypatch):
    seen = []
    monkeypatch.setattr(route.lm, "ai_sentences", lambda f, label: seen.append(f) or None)
    db = _DB([brk()])
    r = _client(monkeypatch, db).post(f"{URL}/explain", headers=VIEWER)
    assert r.status_code == 200 and r.json()["explanation"]["source"] == "template"
    assert set(seen[0]) == {"kind", "metric", "subject", "description", "observed", "expected_low", "expected_high",
                            "median", "baseline_runs", "method"}
    assert any(q.lstrip().startswith("UPDATE learned_monitor_breaks SET explanation") for q, _ in db.sql) and db.committed


def test_list_with_no_run_is_empty(monkeypatch):
    r = _client(monkeypatch, _DB()).get("/api/v1/aletheia/monitors", headers=VIEWER)
    assert r.status_code == 200 and r.json()["breaks"] == [] and r.json()["min_runs"] == 5
