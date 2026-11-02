"""Shift routes: GET /shifts and POST /shifts/propose (draft rule from a null spike or unexpected code), plus the
service function that builds the rule. The database is a scripted fake: statements are answered by what they touch."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import aletheia_anomaly_rules as route
from api.services import anomaly_shifts as sh
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
MODULE = "accounts_payable"
ADMIN = {"X-User-Role": "admin"}
PROPOSE = "/api/v1/aletheia/anomaly-rules/shifts/propose"
BODY = {"table": "LFA1", "field": "LAND1", "kind": "unexpected_code"}
EXHAUSTIVE = {"rows": 1000, "masked": False, "distinct": 2, "top_values": [{"value": "DE", "count": 600}, {"value": "ZA", "count": 400}]}


def test_shift_rule_null_spike_and_codes():
    r, why = sh.shift_rule("null_spike", "LFA1.LAND1", "high", None)
    assert why is None and r["check_class"] == "null_check" and r["field"] == "LFA1.LAND1" and r["severity"] == "high"
    r, _ = sh.shift_rule("unexpected_code", "LFA1.LAND1", "medium", EXHAUSTIVE)
    assert r["check_class"] == "domain_value_check" and r["allowed_values"] == ["DE", "ZA"]


def test_shift_rule_refuses_a_cut_or_masked_baseline():
    cut = {**EXHAUSTIVE, "distinct": 40}
    for prev in (None, cut, {"masked": True, "top_values": None}):
        r, why = sh.shift_rule("unexpected_code", "LFA1.LAND1", "medium", prev)
        assert r is None and why


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _DB:
    """Answers by statement: ``shift`` (shift lookup / list), ``prev`` (profile stats), ``dup`` (existing draft)."""

    def __init__(self, shift=None, prev=None, dup=None, listing=()):
        self.shift, self.prev, self.dup, self.listing = shift, prev, dup, list(listing)
        self.sql: list[tuple[str, dict]] = []
        self.committed = False

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params or {}))
        if "INSERT INTO ai_proposed_rules" in q:
            return _Res([(uuid.UUID(int=7),)])
        if "FROM ai_proposed_rules" in q:
            return _Res([self.dup] if self.dup else [])
        if "FROM field_profiles" in q:
            return _Res([(self.prev,)] if self.prev else [])
        if "FROM field_shift_anomalies" in q and "s.prev_version_id::text FROM" in q:
            return _Res([self.shift] if self.shift else [])
        if "FROM field_shift_anomalies" in q:
            return _Res(self.listing)
        return _Res([])

    async def commit(self):
        self.committed = True


def _client(monkeypatch, db, tenant=None):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    async def latest(*_a):
        return (uuid.uuid4(), {})

    async def dictionary(*_a):
        return D

    monkeypatch.setattr(route.route, "_latest", latest)
    monkeypatch.setattr(route.route, "_dictionary", dictionary)
    api = FastAPI()
    api.include_router(route.router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: tenant or Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


SHIFT = (MODULE, "high", str(uuid.uuid4()))


def test_propose_unexpected_code_saves_a_pending_draft(monkeypatch):
    db = _DB(shift=SHIFT, prev=EXHAUSTIVE)
    tenant = Tenant(uuid.uuid4(), "D", [])
    r = _client(monkeypatch, db, tenant).post(PROPOSE, json=BODY, headers=ADMIN)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "draft" and j["created"] and j["rule"]["allowed_values"] == ["DE", "ZA"]
    ins = [p for q, p in db.sql if "INSERT INTO ai_proposed_rules" in q][0]
    assert ins["tid"] == str(tenant.id) and ins["d"] == f"dq_rule:{MODULE}" and db.committed
    # the shift is looked up for this tenant only
    assert [p["tid"] for q, p in db.sql if "FROM field_shift_anomalies" in q] == [str(tenant.id)]


def test_propose_null_spike_needs_no_baseline(monkeypatch):
    r = _client(monkeypatch, _DB(shift=SHIFT)).post(PROPOSE, json={**BODY, "kind": "null_spike"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["rule"]["check_class"] == "null_check"


def test_propose_is_idempotent_for_an_existing_draft(monkeypatch):
    db = _DB(shift=SHIFT, prev=EXHAUSTIVE, dup=(uuid.UUID(int=3),))
    j = _client(monkeypatch, db).post(PROPOSE, json=BODY, headers=ADMIN).json()
    assert j["id"] == str(uuid.UUID(int=3)) and j["created"] is False
    assert not any("INSERT INTO ai_proposed_rules" in q for q, _ in db.sql)


def test_propose_errors(monkeypatch):
    assert _client(monkeypatch, _DB()).post(PROPOSE, json=BODY, headers=ADMIN).status_code == 404
    assert _client(monkeypatch, _DB(shift=SHIFT, prev={**EXHAUSTIVE, "distinct": 40})).post(
        PROPOSE, json=BODY, headers=ADMIN).status_code == 422
    c = _client(monkeypatch, _DB(shift=SHIFT, prev=EXHAUSTIVE))
    assert c.post(PROPOSE, json={**BODY, "kind": "outlier"}, headers=ADMIN).status_code == 422
    assert c.post(PROPOSE, json=BODY, headers={"X-User-Role": "viewer"}).status_code == 403


def test_get_shifts_shapes_rows_and_is_tenant_scoped(monkeypatch):
    row = (str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), 12, 11, MODULE, "LFA1", "LAND1", "unexpected_code",
           "high", {"rows": 1000, "blank": 0, "blank_pct": 0.0, "distinct": 3}, {"rows": 990, "distinct": 2},
           [{"value": "XX", "count": 10}], "2026-10-30 04:12:00")
    db = _DB(listing=[row])
    tenant = Tenant(uuid.uuid4(), "D", [])
    r = _client(monkeypatch, db, tenant).get("/api/v1/aletheia/anomaly-rules/shifts", headers=ADMIN)
    assert r.status_code == 200, r.text
    (s,) = r.json()
    assert s["field"] == "LFA1.LAND1" and s["kind"] == "unexpected_code" and s["codes"] == [{"value": "XX", "count": 10}]
    assert s["run_number"] == 12 and s["current"]["distinct"] == 3 and s["previous"]["blank"] is None
    assert [p["tid"] for q, p in db.sql if "FROM field_shift_anomalies" in q] == [str(tenant.id)]


def test_get_shifts_rejects_a_bad_limit(monkeypatch):
    assert _client(monkeypatch, _DB()).get("/api/v1/aletheia/anomaly-rules/shifts?limit=0", headers=ADMIN).status_code == 422
