"""The approval workflow engine (api/services/workflow.py): conditions, quorum, SLA escalation, delegation, requester
exclusion, versioning, and the default four-eyes workflow reproducing today's fix batch approval.

The pure parts (conditions, validation, the plan) need no database; the rest runs on Postgres
(MERIDIAN_TEST_DB_URL), as the superuser, with app.tenant_id set as the routes set it.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import workflow as wf
from tests import workflow_seed as seed

needs_pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


# ── conditions and validation (no database) ─────────────────────────────────


def _c(fact, op, value=None):
    return wf.Condition(fact=fact, op=op, value=value)


def test_conditions_are_deterministic_and_a_missing_fact_never_matches():
    facts = {"value_at_risk": 12500.0, "fields": ["MARA.MATKL", "MCH1.CHARG"], "policy_classes": ["gxp",
             "gxp:batch_identity"], "object": "material", "duplicates": 0}
    assert wf.holds(_c("value_at_risk", "gt", 10000), facts)
    assert not wf.holds(_c("value_at_risk", "lte", 10000), facts)
    assert wf.holds(_c("policy_classes", "contains", "gxp"), facts)
    assert wf.holds(_c("policy_classes", "contains_any", ["sox", "GxP"]), facts)
    assert not wf.holds(_c("policy_classes", "contains", "sox"), facts)
    assert wf.holds(_c("object", "in", ["material", "customer"]), facts)
    assert wf.holds(_c("object", "not_in", ["vendor"]), facts)
    assert wf.holds(_c("fields", "contains", "mara.matkl"), facts)  # SAP names compare case-insensitively
    assert not wf.holds(_c("duplicates", "gt", 0), facts) and wf.holds(_c("duplicates", "exists"), facts)
    # a fact the object does not have: no comparison holds, not_exists does
    assert not wf.holds(_c("records", "gt", -1), facts) and wf.holds(_c("records", "not_exists"), facts)
    assert wf.holds(wf.AnyOf(any=[_c("records", "gt", 1), _c("object", "eq", "material")]), facts)


def test_validation_explains_every_problem():
    assert wf.validate_definition(wf.DEFAULTS["fix_batch"][2]) == []
    bad = {"steps": [{"name": "GxP", "assignee": {"rule": "users"}, "when": [{"fact": "colour", "op": "eq"}]}]}
    problems = wf.validate_definition(bad)
    assert any("unknown fact" in p for p in problems)
    only_conditional = {"steps": [{"name": "Big", "assignee": {"rule": "role", "action": "approve"},
                                   "when": [{"fact": "value_at_risk", "op": "gt", "value": 1}]}]}
    assert wf.validate_definition(only_conditional) == [
        "At least one step must have no condition, so every request is approved by a person."]
    assert "name at least one user" in " ".join(wf.validate_definition(
        {"steps": [{"name": "A", "assignee": {"rule": "users"}}]}))
    assert "is not a permission" in " ".join(wf.validate_definition(
        {"steps": [{"name": "A", "assignee": {"rule": "role", "action": "fly"}}]}))
    assert wf.validate_definition({"steps": [{"name": "A", "assignee": {"rule": "role", "action": "approve"},
                                              "when": [{"fact": "value_at_risk", "op": "gt", "value": "lots"}]},
                                             {"name": "B", "assignee": {"rule": "manager"}}]}) == [
        "Step 1 (A): gt takes a number."]


def test_the_plan_names_the_condition_that_skipped_a_step():
    d = wf.parse({"steps": [
        {"name": "Four eyes", "assignee": {"rule": "role", "action": "approve"}},
        {"name": "Finance", "assignee": {"rule": "role", "roles": ["programme_lead"]},
         "when": [{"fact": "value_at_risk", "op": "gt", "value": 10000}]}]})
    small, big = wf.plan(d, {"value_at_risk": 50}), wf.plan(d, {"value_at_risk": 50000})
    assert [s["applies"] for s in small] == [True, False]
    assert small[1]["reason"] == "Condition not met: value_at_risk gt 10000"
    assert [s["applies"] for s in big] == [True, True]


# ── the engine on Postgres ───────────────────────────────────────────────────


@pytest.fixture
def world():
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    yield eng, w
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


def _session(eng, tid) -> Session:
    s = Session(eng)
    s.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
    return s


def _define(s, tid, doc, kind="change_request", key=None, activate=True) -> str:
    assert wf.validate_definition(doc) == [], wf.validate_definition(doc)
    key = key or f"wf-{uuid.uuid4().hex[:8]}"
    v = s.execute(text("SELECT COALESCE(max(version), 0) + 1 FROM workflow_definitions WHERE tenant_id = :t "
                       "AND key = :k"), {"t": tid, "k": key}).scalar()
    if activate:
        s.execute(text("UPDATE workflow_definitions SET active = false WHERE tenant_id = :t AND object_kind = :o"),
                  {"t": tid, "o": kind})
    return s.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, "
                          "definition) VALUES (:t, :k, :k, :o, :v, :a, CAST(:d AS jsonb)) RETURNING id::text"),
                     {"t": tid, "k": key, "o": kind, "v": v, "a": activate, "d": json.dumps(doc)}).scalar()


def _start(s, w, facts=None, oid=None):
    return wf.start(s, w["tid"], "change_request", oid or str(uuid.uuid4()), w["requester"], "requester@example.com",
                    {"title": "Change request", **(facts or {})})


def _pending(inst):
    return [t for t in inst["tasks"] if t["status"] == "pending"]


def _notes(s, tid, user):
    return [r[0] for r in s.execute(text("SELECT title FROM notifications WHERE tenant_id = :t AND user_id = :u "
                                         "ORDER BY created_at"), {"t": tid, "u": user}).fetchall()]


TWO_STEP = {"steps": [
    {"name": "Data owner", "assignee": {"rule": "users", "users": []}, "quorum": "any"},
    {"name": "Finance", "assignee": {"rule": "role", "roles": ["programme_lead"]},
     "when": [{"fact": "value_at_risk", "op": "gt", "value": 10000}]}]}


@needs_pg
def test_conditions_decide_which_steps_run_and_each_transition_is_recorded(world):
    eng, w = world
    tid = w["tid"]
    doc = json.loads(json.dumps(TWO_STEP))
    doc["steps"][0]["assignee"]["users"] = [w["alice"]]
    with _session(eng, tid) as s:
        hook = s.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/w', "
                              "'whsec_test_secret_123', ARRAY['workflow.*']) RETURNING id"), {"t": tid}).scalar()
        star = s.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/s', "
                              "'whsec_test_secret_123', ARRAY['*']) RETURNING id"), {"t": tid}).scalar()
        _define(s, tid, doc)
        small = _start(s, w, {"value_at_risk": 500})
        assert [t["status"] for t in small["tasks"]] == ["pending", "skipped"]
        assert small["tasks"][1]["skip_reason"] == "Condition not met: value_at_risk gt 10000"
        assert small["tasks"][0]["assigned_users"] == [w["alice"]]
        assert _notes(s, tid, w["alice"]) == ["Data owner: Change request waits for your approval"]
        done = wf.decide(s, tid, small["tasks"][0]["id"], w["alice"], "alice@example.com", "approve", "ok", set())
        assert done["status"] == "approved" and done["completed"]
        assert _notes(s, tid, w["requester"]) == ["Change request was approved"]

        big = _start(s, w, {"value_at_risk": 50000})
        assert [t["status"] for t in big["tasks"]] == ["pending", "waiting"]
        r = wf.decide(s, tid, _pending(big)[0]["id"], w["alice"], "alice", "approve", None, set())
        assert r["status"] == "in_progress"
        fin = _pending(r["instance"])[0]
        assert fin["step_name"] == "Finance" and fin["assigned_users"] == [w["boss"]]
        assert _notes(s, tid, w["boss"]) == ["Finance: Change request waits for your approval"]
        assert wf.decide(s, tid, fin["id"], w["boss"], "boss", "approve", None, set())["status"] == "approved"

        actions = [e["action"] for e in wf.history(s, tid, "change_request", big["object_id"])]
        assert actions == ["started", "step_waiting", "step_approved", "step_waiting", "step_approved", "approved"]
        audit = s.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND entity_id = :o "
                               "AND action LIKE 'change_request.%'"), {"t": tid, "o": big["object_id"]}).scalar()
        assert audit == len(actions)
        by_hook = dict(s.execute(text("SELECT webhook_id, count(*) FROM webhook_deliveries WHERE tenant_id = :t "
                                      "GROUP BY webhook_id"), {"t": tid}).fetchall())
        # the step events reach the hook that names workflow.*, never the wildcard one made for the older events
        assert by_hook.get(hook) and star not in by_hook
        s.commit()


@needs_pg
def test_quorum_all_needs_every_assignee_and_a_rejection_ends_it(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        _define(s, tid, {"steps": [{"name": "Both owners", "quorum": "all",
                                    "assignee": {"rule": "users", "users": [w["alice"], w["bob"]]}}]})
        inst = _start(s, w)
        task = _pending(inst)[0]
        r = wf.decide(s, tid, task["id"], w["alice"], "alice", "approve", None, set())
        assert r["status"] == "in_progress" and _pending(r["instance"])[0]["id"] == task["id"]
        with pytest.raises(wf.WorkflowError) as again:
            wf.decide(s, tid, task["id"], w["alice"], "alice", "approve", None, set())
        assert again.value.status == 403 and "already decided" in again.value.detail
        assert wf.decide(s, tid, task["id"], w["bob"], "bob", "approve", None, set())["status"] == "approved"

        inst2 = _start(s, w)
        r = wf.decide(s, tid, _pending(inst2)[0]["id"], w["bob"], "bob", "reject", "Wrong plant", set())
        assert r["status"] == "rejected" and r["instance"]["tasks"][0]["comment"] == "Wrong plant"
        assert _notes(s, tid, w["requester"])[-1] == "Change request was rejected"
        s.rollback()


@needs_pg
def test_requester_is_excluded_unless_the_step_allows_it(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        wf.ensure_default(s, tid, "change_request")
        inst = _start(s, w)
        task = _pending(inst)[0]
        assert w["requester"] not in task["assigned_users"] and w["alice"] in task["assigned_users"]
        with pytest.raises(wf.WorkflowError) as own:
            wf.decide(s, tid, task["id"], w["requester"], "requester", "approve", None, {"approve"})
        assert own.value.status == 403 and own.value.detail == "The requester cannot decide this step."
        # a viewer holds no approve: not an approver of a role step
        with pytest.raises(wf.WorkflowError) as viewer:
            wf.decide(s, tid, task["id"], w["dave"], "dave", "approve", None, {"view"})
        assert viewer.value.detail == "You are not an approver of this step."

        _define(s, tid, {"steps": [{"name": "Self", "assignee": {"rule": "users", "users": [w["requester"]]},
                                    "requester_may_approve": True}]})
        mine = _start(s, w)
        assert wf.decide(s, tid, _pending(mine)[0]["id"], w["requester"], "r", "approve", None, set())["status"] == \
            "approved"
        s.rollback()


@needs_pg
def test_distinct_approvers_across_steps(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        _define(s, tid, {"steps": [{"name": "One", "assignee": {"rule": "users", "users": [w["alice"], w["bob"]]}},
                                   {"name": "Two", "assignee": {"rule": "users", "users": [w["alice"], w["bob"]]}}]})
        inst = _start(s, w)
        r = wf.decide(s, tid, _pending(inst)[0]["id"], w["alice"], "alice", "approve", None, set())
        with pytest.raises(wf.WorkflowError) as twice:
            wf.decide(s, tid, _pending(r["instance"])[0]["id"], w["alice"], "alice", "approve", None, set())
        assert "different person" in twice.value.detail
        assert wf.decide(s, tid, _pending(r["instance"])[0]["id"], w["bob"], "bob", "approve", None, set())[
            "status"] == "approved"
        s.rollback()


@needs_pg
def test_delegate_of_an_assignee_away_decides_for_them(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        today = date.today()
        s.execute(text("INSERT INTO delegations (tenant_id, from_user_id, to_user_id, starts_on, ends_on, created_by) "
                       "VALUES (:t, :a, :c, :s, :e, 'test')"),
                  {"t": tid, "a": w["alice"], "c": w["carol"], "s": today - timedelta(days=1), "e": today + timedelta(days=1)})
        _define(s, tid, {"steps": [{"name": "Owner", "assignee": {"rule": "users", "users": [w["alice"]]}}]})
        inst = _start(s, w)
        # out of office: the delegate hears too, and may decide for the person away
        assert _notes(s, tid, w["carol"]) == ["For Alice: Owner: Change request waits for your approval"]
        r = wf.decide(s, tid, _pending(inst)[0]["id"], w["carol"], "carol", "approve", None, set())
        t = r["instance"]["tasks"][0]
        assert r["status"] == "approved" and t["decided_by"] == w["carol"] and t["on_behalf_of"] == w["alice"]
        # the delegation ended: carol is nobody's stand-in any more
        s.execute(text("UPDATE delegations SET revoked_at = now() WHERE tenant_id = :t"), {"t": tid})
        inst2 = _start(s, w)
        with pytest.raises(wf.WorkflowError):
            wf.decide(s, tid, _pending(inst2)[0]["id"], w["carol"], "carol", "approve", None, set())
        s.rollback()


@needs_pg
def test_assignee_rules_data_owner_field_steward_and_manager(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        s.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) VALUES (:t, 'object', "
                       "'material_master', :u)"), {"t": tid, "u": w["bob"]})
        s.execute(text("INSERT INTO glossary_terms (tenant_id, domain, sap_table, sap_field, technical_name, "
                       "business_name, data_steward_id) VALUES (:t, 'material', 'MARA', 'MATKL', 'MATKL', "
                       "'Material group', :u)"), {"t": tid, "u": w["carol"]})
        s.execute(text("UPDATE users SET manager_id = :m WHERE id = :u"), {"m": w["boss"], "u": w["requester"]})
        facts = {"modules": ["material_master"], "fields": ["MARA.MATKL"]}
        get = lambda a: wf.resolve(s, tid, wf.Assignee(**a), facts, w["requester"])  # noqa: E731
        assert get({"rule": "data_owner"}) == [w["bob"]]
        assert get({"rule": "data_owner", "of": "field"}) == [w["carol"]]
        assert get({"rule": "manager"}) == [w["boss"]]
        assert set(get({"rule": "role", "action": "approve"})) == {
            w["requester"], w["alice"], w["bob"], w["carol"], w["boss"], w["admin"]}
        # nobody named: the fallback, then anyone holding approve
        step = wf.Step(name="X", assignee=wf.Assignee(rule="data_owner"),
                       fallback=wf.Assignee(rule="users", users=[uuid.UUID(w["alice"])]))
        users, note = wf.assignees(s, tid, step, {"modules": ["fi_gl"]}, w["requester"])
        assert users == [w["alice"]] and "fallback" in note
        s.rollback()


@needs_pg
def test_sla_escalation_climbs_the_chain_once_per_level(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        s.execute(text("INSERT INTO escalation_steps (tenant_id, level, after_minutes, target, user_id) VALUES "
                       "(:t, 1, 0, 'user', :c), (:t, 2, 120, 'user', :b)"), {"t": tid, "c": w["carol"], "b": w["boss"]})
        _define(s, tid, {"steps": [{"name": "Owner", "sla_hours": 4,
                                    "assignee": {"rule": "users", "users": [w["alice"]]}}]})
        inst = _start(s, w)
        task = _pending(inst)[0]
        due = datetime.fromisoformat(str(task["due_at"])) if isinstance(task["due_at"], str) else task["due_at"]
        assert timedelta(hours=3, minutes=59) < due - datetime.now(timezone.utc) <= timedelta(hours=4)
        assert wf.sla_sweep(s, tid) == {}  # not due yet
        later = due + timedelta(minutes=30)
        assert wf.sla_sweep(s, tid, later) == {"escalated": 1}
        assert wf.sla_sweep(s, tid, later) == {}  # each level once
        assert _notes(s, tid, w["carol"])[-1].startswith("Escalation level 1: Owner")
        assert wf.sla_sweep(s, tid, due + timedelta(hours=3)) == {"escalated": 1}
        assert _notes(s, tid, w["boss"])[-1].startswith("Escalation level 2: Owner")
        # whoever the chain reached may decide the step
        r = wf.decide(s, tid, task["id"], w["carol"], "carol", "approve", None, set())
        assert r["status"] == "approved"
        assert "escalated" in [e["action"] for e in wf.history(s, tid, "change_request", inst["object_id"])]
        s.rollback()


@needs_pg
def test_without_a_chain_an_overdue_step_is_told_to_its_deciders_once(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        _define(s, tid, {"steps": [{"name": "Owner", "sla_hours": 1, "assignee": {"rule": "users", "users": [w["bob"]]}}]})
        _start(s, w)
        later = datetime.now(timezone.utc) + timedelta(hours=2)
        assert wf.sla_sweep(s, tid, later) == {"overdue": 1} and wf.sla_sweep(s, tid, later) == {}
        assert _notes(s, tid, w["bob"])[-1] == "Overdue: Owner for Change request"
        s.rollback()


@needs_pg
def test_an_instance_keeps_the_version_it_started_on(world):
    eng, w = world
    tid = w["tid"]
    with _session(eng, tid) as s:
        _define(s, tid, {"steps": [{"name": "V1 owner", "assignee": {"rule": "users", "users": [w["alice"]]}}]},
                key="materials")
        old = _start(s, w)
        _define(s, tid, {"steps": [{"name": "V2 owner", "assignee": {"rule": "users", "users": [w["bob"]]}},
                                   {"name": "V2 finance", "assignee": {"rule": "users", "users": [w["boss"]]}}]},
                key="materials")
        new = _start(s, w)
        assert (old["definition_version"], new["definition_version"]) == (1, 2)
        assert [t["step_name"] for t in old["tasks"]] == ["V1 owner"]
        r = wf.decide(s, tid, _pending(old)[0]["id"], w["alice"], "alice", "approve", None, set())
        assert r["status"] == "approved"  # finished on version 1 although version 2 is active
        assert [t["step_name"] for t in new["tasks"]] == ["V2 owner", "V2 finance"]
        with pytest.raises(wf.WorkflowError) as busy:
            wf.start(s, tid, "change_request", new["object_id"], w["requester"], "r", {})
        assert busy.value.status == 409
        s.rollback()


@needs_pg
def test_dry_run_names_the_steps_and_people_and_writes_nothing(world):
    eng, w = world
    tid = w["tid"]
    doc = json.loads(json.dumps(TWO_STEP))
    doc["steps"][0]["assignee"]["users"] = [w["alice"]]
    with _session(eng, tid) as s:
        before = s.execute(text("SELECT count(*) FROM workflow_instances WHERE tenant_id = :t"), {"t": tid}).scalar()
        out = wf.dry_run(s, tid, doc, {"value_at_risk": 20000}, w["requester"])
        assert [(x["name"], x["applies"], [a["name"] for a in x["assignees"]]) for x in out] == [
            ("Data owner", True, ["Alice"]), ("Finance", True, ["Boss"])]
        assert s.execute(text("SELECT count(*) FROM workflow_instances WHERE tenant_id = :t"), {"t": tid}).scalar() == before
        s.rollback()
