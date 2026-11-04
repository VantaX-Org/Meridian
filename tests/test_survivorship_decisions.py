"""Steward decisions on verified AI survivorship picks: accept, override of an offered candidate only, rates.

No Postgres: a fake session answers the two statements the decision route runs, and set_overrides (covered by
the merge tests) is recorded instead of run.
"""
import json
import time
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.middleware import audit as audit_mw
from api.routes import aletheia_survivorship as route
from api.services import golden_record_engine as engine
from api.services import mdm_merge

OBJ = {"domain": "customer_master", "sap_object_key": "K1", "field": "NAME1"}


def _entry(applied=True, with_candidates=True):
    e = {"value": "Synthetic Co", "source_system": "SYS_A", "ai_recommendation": "SYS_A", "ai_confidence": 0.9,
         "ai_verification": {"verified": True, "checks": []}, "ai_applied": applied}
    if with_candidates:
        e["ai_candidates"] = [{"source_system": "SYS_A", "value": "Synthetic Co"},
                              {"source_system": "SYS_B", "value": "Synthetic Company Ltd"},
                              {"source_system": "SYS_C", "value": ""}]
    return e


class FakeDB:
    def __init__(self, entry):
        self.entry, self.decisions, self.commits = entry, [], 0

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "FROM master_records" in sql:
            row = SimpleNamespace(id=uuid.uuid4(), entry=self.entry)
            return SimpleNamespace(first=lambda: row if self.entry is not None else None)
        if "INSERT INTO survivorship_decisions" in sql:
            self.decisions.append(params)
        return SimpleNamespace()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    st = SimpleNamespace(db=FakeDB(_entry()), overrides=[], audits=[])

    async def _set_overrides(db, tid, gid, overrides, uid, reason):
        st.overrides.append((overrides, reason))
        return {}

    async def _rls(db, tenant):
        return None

    monkeypatch.setattr(mdm_merge, "set_overrides", _set_overrides)
    monkeypatch.setattr(route, "_rls", _rls)
    monkeypatch.setattr(audit_mw, "_insert_audit_row", st.audits.append)
    app = FastAPI()
    app.add_middleware(audit_mw.AuditMiddleware)
    app.include_router(route.router)

    async def _db():
        yield st.db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    with TestClient(app, headers={"X-User-Role": "steward"}) as c:
        st.c = c
        yield st


def test_accept_applied_pick_records_decision_and_leaves_value(env):
    r = env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "accept"})
    assert r.status_code == 200 and r.json()["new_source"] == "SYS_A"
    assert env.overrides == []  # already the golden value
    d = env.db.decisions[0]
    assert (d["dec"], d["p"], d["n"]) == ("accept", "SYS_A", "SYS_A") and env.db.commits == 1


def test_accept_of_held_back_pick_applies_it_through_set_overrides(env):
    env.db.entry = _entry(applied=False)
    r = env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "accept"})
    assert r.status_code == 200 and env.overrides[0][0] == {"NAME1": "Synthetic Co"}


def test_override_to_offered_candidate_changes_value_through_set_overrides(env):
    r = env.c.post("/api/v1/aletheia/survivorship/decision",
                   json={**OBJ, "decision": "override", "source_system": "SYS_B", "reason_code": "stale_value"})
    assert r.status_code == 200
    assert env.overrides[0][0] == {"NAME1": "Synthetic Company Ltd"}
    d = env.db.decisions[0]
    assert (d["dec"], d["p"], d["n"], d["rc"]) == ("override", "SYS_A", "SYS_B", "stale_value")


@pytest.mark.parametrize("body", [
    {"decision": "override", "source_system": "SYS_Z"},  # not offered
    {"decision": "override", "source_system": "Free text value"},
    {"decision": "override"},  # no source
    {"decision": "override", "source_system": "SYS_A"},  # same as the pick
])
def test_override_outside_offered_candidates_is_rejected(env, body):
    r = env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, **body})
    assert r.status_code == 409 and env.overrides == [] and env.db.decisions == []


def test_bad_reason_code_is_422(env):
    r = env.c.post("/api/v1/aletheia/survivorship/decision",
                   json={**OBJ, "decision": "override", "source_system": "SYS_B", "reason_code": "because"})
    assert r.status_code == 422


def test_pick_without_stored_candidates_or_missing_pick_is_409(env):
    env.db.entry = _entry(with_candidates=False)
    assert env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "accept"}).status_code == 409
    env.db.entry = None
    assert env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "accept"}).status_code == 409


def test_viewer_is_denied(env):
    r = env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "accept"},
                   headers={"X-User-Role": "viewer"})
    assert r.status_code == 403 and env.db.decisions == []


def test_audit_row_written_for_decision(env):
    env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "accept"})
    for _ in range(40):
        if env.audits:
            break
        time.sleep(0.05)
    assert env.audits and env.audits[0]["path"] == "/api/v1/aletheia/survivorship/decision"
    assert env.audits[0]["action"] == "decision" and env.audits[0]["method"] == "POST"


def test_failed_decision_writes_no_audit_row(env):
    env.c.post("/api/v1/aletheia/survivorship/decision", json={**OBJ, "decision": "override", "source_system": "NOPE"})
    time.sleep(0.2)
    assert env.audits == []


def test_summary_exposes_shapes_not_values_and_state():
    out = route.summarise([("customer_master", "K1", "NAME1", _entry(), "override", "SYS_B", "stale_value")], 10)
    p = out["picks"][0]
    assert p["state"] == "overridden" and p["decided_source"] == "SYS_B" and p["applied"] is True
    assert [c["source_system"] for c in p["candidates"]] == ["SYS_A", "SYS_B", "SYS_C"]
    assert [c["picked"] for c in p["candidates"]] == [True, False, False] and p["candidates"][2]["blank"]
    assert "Synthetic" not in str(out)


def test_accuracy_rates_by_object_field_and_week():
    t = lambda d: datetime(2026, 10, d, 12, tzinfo=timezone.utc)  # noqa: E731  (Mon 5th, Wed 14th)
    dec = [("customer_master", "NAME1", "accept", t(5)), ("customer_master", "NAME1", "accept", t(7)),
           ("customer_master", "STRAS", "override", t(7)), ("material_master", "MAKTX", "accept", t(14))]
    out = route.accuracy(dec, [("customer_master", "NAME1"), ("material_master", "MAKTX")])
    assert (out["accepted"], out["overridden"], out["pending"]) == (3, 1, 2)
    assert out["acceptance_rate"] == 0.75 and out["override_rate"] == 0.25
    obj = {r["domain"]: r for r in out["by_object"]}
    assert obj["customer_master"]["acceptance_rate"] == 0.6667 and obj["customer_master"]["pending"] == 1
    fld = {(r["domain"], r["field"]): r for r in out["by_field"]}
    assert fld[("customer_master", "STRAS")]["override_rate"] == 1.0
    assert [(w["week"], w["accepted"], w["overridden"]) for w in out["by_week"]] == [
        ("2026-10-05", 3 - 1, 1), ("2026-10-12", 1, 0)]


def test_accuracy_with_no_decisions_has_null_rates():
    out = route.accuracy([], [("customer_master", "NAME1")])
    assert out["acceptance_rate"] is None and out["pending"] == 1 and out["by_week"] == []


def test_accuracy_route_counts_only_undecided_picks_with_candidates(env, monkeypatch):
    when = datetime(2026, 10, 5, tzinfo=timezone.utc)
    pick = lambda key, dec, e: ("customer_master", key, "NAME1", e, dec, None, None)  # noqa: E731

    class DB:
        async def execute(self, stmt, params=None):
            sql = str(stmt)
            rows = ([("customer_master", "NAME1", "accept", when)] if "FROM survivorship_decisions" in sql and "SELECT domain" in sql
                    else [pick("K1", None, _entry()), pick("K2", "accept", _entry()), pick("K3", None, _entry(with_candidates=False))])
            return SimpleNamespace(fetchall=lambda: rows)

    env.db = DB()
    r = env.c.get("/api/v1/aletheia/survivorship/accuracy")
    j = r.json()
    assert r.status_code == 200 and j["pending"] == 1 and j["accepted"] == 1
    assert {c["code"] for c in j["reason_codes"]} == set(route.REASON_CODES)


class _EngineDB:
    """Answers the tenant setting and records the master record insert; everything else finds nothing."""

    def __init__(self, required):
        self.required, self.insert = required, None

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if "FROM tenant_settings" in sql:
            return SimpleNamespace(fetchone=lambda: ({"required": self.required},) if self.required is not None else None)
        if "INSERT INTO master_records" in sql:
            self.insert = params
        return SimpleNamespace(fetchall=lambda: [], fetchone=lambda: None)

    async def commit(self):
        pass


class _Undecided:
    def __init__(self, **kw):
        pass

    def evaluate(self, contributions):
        return None


def _ai(**kw):
    return {"recommended_value_source": "SYS_B", "confidence": 0.9, "reasoning": "r",
            "verification": {"verified": True, "checks": []}}


@pytest.mark.asyncio
@pytest.mark.parametrize("required,applied,golden", [(None, True, "Beta"), (False, True, "Beta"), (True, False, "Alpha")])
async def test_engine_approval_policy_holds_proved_pick_and_stores_candidates(monkeypatch, required, applied, golden):
    monkeypatch.setattr(engine, "SurvivorshipChain", _Undecided)
    monkeypatch.setattr(engine, "propose_field_winner", _ai)
    # SYS_A is the newest, so when the pick is held back the most_recent fallback gives Alpha
    recs = [{"source_system": "SYS_A", "extracted_at": "2026-02-01T00:00:00+00:00", "fields": {"NAME1": "Alpha"}},
            {"source_system": "SYS_B", "extracted_at": "2026-01-01T00:00:00+00:00", "fields": {"NAME1": "Beta"}}]
    db = _EngineDB(required)
    assert await engine.process_sync_batch(db, str(uuid.uuid4()), "customer_master", "K1", recs, use_ai=True)
    entry = json.loads(db.insert["source_contributions"])["NAME1"]
    assert entry["ai_applied"] is applied and entry["ai_recommendation"] == "SYS_B"
    assert [c["source_system"] for c in entry["ai_candidates"]] == ["SYS_A", "SYS_B"]
    assert json.loads(db.insert["golden_fields"])["NAME1"] == golden
