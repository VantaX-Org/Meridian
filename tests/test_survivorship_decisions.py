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
        self.entry, self.decisions, self.commits, self.log = entry, [], 0, []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.log.append((sql, params))
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

    async def _audit(db, tid, request, action, etype, eid, before, after):
        st.audits_written.append((tid, action, etype, eid, before, after))

    st.audits_written, st.user = [], str(uuid.uuid4())
    monkeypatch.setattr(mdm_merge, "set_overrides", _set_overrides)
    monkeypatch.setattr(route, "write_audit", _audit)
    monkeypatch.setattr(route, "current_user_id", lambda request=None: st.user)
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


URL = "/api/v1/aletheia/survivorship/decision"


def test_proposed_pick_is_not_applied_until_approved(env):
    env.db.entry = {**_entry(applied=False), "proposed_by": str(uuid.uuid4())}
    out = route.summarise([("customer_master", "K1", "NAME1", env.db.entry)], 10)
    assert out["counts"] == {"proposed": 1, "approved": 0, "rejected": 0, "auto_applied": 0}
    assert out["picks"][0]["state"] == "pending" and out["picks"][0]["applied"] is False
    assert env.overrides == []  # nothing pinned before a steward acts
    assert env.c.post(URL, json={**OBJ, "decision": "accept"}).status_code == 200
    assert env.overrides[0][0] == {"NAME1": "Synthetic Co"}


def test_counts_cover_proposed_approved_rejected_and_auto_applied():
    at = datetime(2026, 11, 4, tzinfo=timezone.utc)
    rows = [("customer_master", "K1", "NAME1", _entry(applied=False)),
            ("customer_master", "K2", "NAME1", _entry(applied=False), "accept", "SYS_A", None, None, "u", at),
            ("customer_master", "K3", "NAME1", _entry(applied=False), "reject", "SYS_A", None, "wrong", "u", at),
            ("customer_master", "K4", "NAME1", _entry(applied=True))]
    out = route.summarise(rows, 10)
    assert out["counts"] == {"proposed": 1, "approved": 1, "rejected": 1, "auto_applied": 1}
    rej = out["picks"][2]
    assert (rej["state"], rej["note"], rej["decided_by"], rej["decided_at"]) == ("rejected", "wrong", "u", at.isoformat())


def test_reject_needs_a_reason_and_leaves_golden_value(env):
    env.db.entry = _entry(applied=False)
    assert env.c.post(URL, json={**OBJ, "decision": "reject"}).status_code == 422
    assert env.c.post(URL, json={**OBJ, "decision": "reject", "note": "   "}).status_code == 422
    r = env.c.post(URL, json={**OBJ, "decision": "reject", "note": "Looks like a trade name, not the legal name"})
    assert r.status_code == 200 and env.overrides == []
    d = env.db.decisions[0]
    assert d["dec"] == "reject" and d["note"].startswith("Looks like") and d["u"] == env.user


def test_reject_of_already_applied_pick_is_409(env):
    r = env.c.post(URL, json={**OBJ, "decision": "reject", "note": "x"})
    assert r.status_code == 409 and env.db.decisions == []


def test_four_eyes_blocks_the_user_who_triggered_the_run(env):
    env.db.entry = {**_entry(applied=False), "proposed_by": env.user}
    for body in ({"decision": "accept"}, {"decision": "reject", "note": "x"}):
        r = env.c.post(URL, json={**OBJ, **body})
        assert r.status_code == 403
    assert env.db.decisions == [] and env.overrides == [] and env.audits_written == []


def test_four_eyes_allows_a_different_user_and_unknown_run_user(env):
    env.db.entry = {**_entry(applied=False), "proposed_by": str(uuid.uuid4())}
    assert env.c.post(URL, json={**OBJ, "decision": "accept"}).status_code == 200
    env.db.entry = _entry(applied=False)  # run had no user context (scheduled ingest)
    assert env.c.post(URL, json={**OBJ, "decision": "accept"}).status_code == 200


def test_decision_writes_audit_entry_with_approver_context_and_no_value(env):
    env.db.entry = _entry(applied=False)
    env.c.post(URL, json={**OBJ, "decision": "reject", "note": "wrong entity"})
    tid, action, etype, eid, before, after = env.audits_written[0]
    assert (action, etype, eid) == ("survivorship.reject", "survivorship_pick", "customer_master:K1:NAME1")
    assert before["state"] == "proposed" and after["note"] == "wrong entity" and "Synthetic" not in str(env.audits_written)


def test_approver_role_can_decide_analyst_cannot(env):
    env.db.entry = _entry(applied=False)
    assert env.c.post(URL, json={**OBJ, "decision": "accept"}, headers={"X-User-Role": "approver"}).status_code == 200
    assert env.c.post(URL, json={**OBJ, "decision": "accept"}, headers={"X-User-Role": "analyst"}).status_code == 403


def test_bulk_approve_reports_failures_and_commits_once(env):
    env.db.entry = {**_entry(applied=False), "proposed_by": env.user}  # four eyes blocks this caller
    pick = {k: OBJ[k] for k in ("domain", "sap_object_key", "field")}
    r = env.c.post(URL + "/bulk", json={"picks": [pick]})
    assert r.status_code == 200 and r.json()["approved"] == 0 and "different user" in r.json()["failed"][0]["detail"]
    env.db.entry = _entry(applied=False)
    r = env.c.post(URL + "/bulk", json={"picks": [pick, {**pick, "sap_object_key": "K2"}]})
    assert r.json()["approved"] == 2 and len(env.db.decisions) == 2 and env.db.commits == 2
    assert env.c.post(URL + "/bulk", json={"picks": []}).status_code == 422


def test_decision_queries_are_scoped_to_the_callers_tenant(env):
    env.db.entry = _entry(applied=False)
    env.c.post(URL, json={**OBJ, "decision": "accept"})
    tids = {p["tid"] for sql, p in env.db.log if p}
    assert len(tids) == 1  # only the caller's tenant id is ever bound
    assert all("tenant_id" in sql for sql, p in env.db.log if "master_records" in sql or "survivorship_decisions" in sql)
    assert env.audits_written[0][0] != uuid.UUID(int=0) and str(env.audits_written[0][0]) in tids


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
@pytest.mark.parametrize("required,applied,golden", [(None, False, "Alpha"), (False, True, "Beta"), (True, False, "Alpha")])
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
