"""Configurable approval workflows (migration 119): definitions, deterministic evaluation, tasks and their decisions.

A definition is a list of steps for one object kind (``fix_batch`` or ``change_request``):

  {"steps": [
     {"name": "Four-eyes approval",
      "assignee": {"rule": "role", "action": "approve"},       # who may decide (see ASSIGNEE_RULES)
      "fallback": {"rule": "users", "users": ["<uuid>"]},       # optional: when the rule resolves nobody
      "quorum": "any",                                          # any one of them, or all of them
      "when": [{"fact": "value_at_risk", "op": "gt", "value": 10000}],   # all must hold; {"any": [...]} for an or
      "sla_hours": 48, "escalate": true,                        # past due: the escalation chain is told, level by level
      "requester_may_approve": false}],                         # never by default
   "notify_requester": true,                                    # tell the requester the outcome
   "distinct_approvers": true}                                  # one person decides at most one step of an instance

Evaluation is deterministic: when an instance starts, every step's conditions are evaluated against the object's facts
(FACTS) and the steps that do not apply are recorded as skipped with the reason. The applying steps run in order: one is
pending at a time, the others wait. A step is approved when its quorum is met, and the next one becomes pending; a
rejection ends the instance. An instance keeps the definition version it started on: a new version or a new active
definition applies to instances started afterwards only.

Who may decide a pending step: a user the assignee rule resolved to when the step became pending, the delegate of one
of them while their out-of-office delegation is active (api/services/delegation.py; the vote then counts for the person
away), a person the escalation chain reached, or, for a role rule naming an action, anyone holding that action at the
time (the caller's permission, checked by the route). The requester never decides unless the step allows it, and with
``distinct_approvers`` nobody approves two steps of one instance.

Every transition is written to workflow_events (and audit_log), queued as a webhook event (``workflow.*``) and, for
the people concerned, an inbox notification. Logs and webhooks carry ids, names and numbers, never a field value.

Everything here is synchronous (a Session, app.tenant_id set by the caller, who commits): a route calls it through
``AsyncSession.run_sync``, the SLA sweep from a Celery worker.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import text

logger = logging.getLogger("meridian.workflow")

OBJECT_KINDS: tuple[str, ...] = ("fix_batch", "change_request")
ASSIGNEE_RULES: tuple[str, ...] = ("role", "users", "data_owner", "manager")
OPS: tuple[str, ...] = ("eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "contains_any", "exists",
                        "not_exists")
# The facts a condition may test, per object (built by the routes: api/routes/remediation.py batch_facts and
# api/services/change_requests.py facts).
FACTS: dict[str, str] = {
    "object_kind": "fix_batch or change_request",
    "kind": "change requests: create or change",
    "object": "change requests: material, customer, vendor or business_partner",
    "modules": "the Meridian objects touched (material_master, business_partner, ...)",
    "fields": "the SAP fields touched, as TABLE.FIELD",
    "policy_classes": "the applied policy classes touched: the pack (gxp, sox, gdpr) and pack:class",
    "value_at_risk": "fix batches: the value at risk of its records (currency of the cost model)",
    "records": "fix batches: the number of records",
    "target_system_id": "change requests: the SAP system it is for",
    "rule_failures": "change requests: Meridian rules the proposed record fails",
    "critical_failures": "change requests: critical rules the proposed record fails",
    "duplicates": "change requests: likely duplicates found among the master records",
}
INSTANCE_DONE = ("approved", "rejected", "cancelled", "withdrawn")
EVENTS = ("workflow.started", "workflow.step_waiting", "workflow.step_decided", "workflow.escalated",
          "workflow.completed")
MAX_STEPS = 10


class WorkflowError(Exception):
    """A refused transition: ``status`` is the HTTP status a route answers with, ``detail`` a sentence."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ── the definition format ─────────────────────────────────────────────────────


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fact: str = Field(max_length=60)
    op: Literal["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "contains_any", "exists",
                "not_exists"]
    value: Any = None

    @field_validator("fact")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in FACTS:
            raise ValueError(f"unknown fact {v!r}; one of {', '.join(FACTS)}")
        return v


class AnyOf(BaseModel):
    model_config = ConfigDict(extra="forbid")
    any: list[Condition] = Field(min_length=1, max_length=20)


class Assignee(BaseModel):
    """role: holders of ``action`` (a permission) or of one of ``roles`` (role keys); users: the named users;
    data_owner: the owner of the object (data_owners) or the steward of each field touched (glossary); manager: the
    requester's manager (users.manager_id) when known."""
    model_config = ConfigDict(extra="forbid")
    rule: Literal["role", "users", "data_owner", "manager"]
    action: Optional[str] = Field(None, max_length=60)
    roles: list[str] = Field(default_factory=list, max_length=20)
    users: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    of: Literal["object", "field"] = "object"


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    assignee: Assignee
    fallback: Optional[Assignee] = None
    quorum: Literal["any", "all"] = "any"
    when: list[Union[Condition, AnyOf]] = Field(default_factory=list, max_length=20)
    sla_hours: Optional[float] = Field(None, gt=0, le=8760)
    escalate: bool = True
    requester_may_approve: bool = False


class Definition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    steps: list[Step] = Field(min_length=1, max_length=MAX_STEPS)
    notify_requester: bool = True
    distinct_approvers: bool = True


def _rule_problems(a: Assignee, where: str) -> list[str]:
    from api.services.rbac import ALL_ACTIONS, VALID_ROLES

    out: list[str] = []
    if a.rule == "role":
        if not a.action and not a.roles:
            out.append(f"{where}: a role rule names a permission (action) or role keys (roles).")
        if a.action and a.action not in ALL_ACTIONS:
            out.append(f"{where}: {a.action!r} is not a permission.")
        bad = [r for r in a.roles if r not in VALID_ROLES and not r.startswith("custom:")]
        if bad:
            out.append(f"{where}: {', '.join(bad)} is not a role.")
    if a.rule == "users" and not a.users:
        out.append(f"{where}: name at least one user.")
    return out


def validate_definition(doc: Any) -> list[str]:
    """Problems with a definition document, as sentences; empty when it is valid."""
    try:
        d = Definition.model_validate(doc)
    except ValidationError as e:
        return [f"{'.'.join(str(p) for p in err['loc']) or 'definition'}: {err['msg']}" for err in e.errors()]
    out: list[str] = []
    for i, s in enumerate(d.steps):
        out += _rule_problems(s.assignee, f"Step {i + 1} ({s.name}) assignee")
        if s.fallback:
            out += _rule_problems(s.fallback, f"Step {i + 1} ({s.name}) fallback")
        for c in _flat(s.when):
            if c.op in ("in", "not_in", "contains_any") and not isinstance(c.value, list):
                out.append(f"Step {i + 1} ({s.name}): {c.op} takes a list of values.")
            if c.op in ("gt", "gte", "lt", "lte") and not isinstance(c.value, (int, float)):
                out.append(f"Step {i + 1} ({s.name}): {c.op} takes a number.")
    if not any(not s.when for s in d.steps):
        out.append("At least one step must have no condition, so every request is approved by a person.")
    names = [s.name for s in d.steps]
    if len(set(names)) != len(names):
        out.append("Step names must be unique.")
    return out


def parse(doc: Any) -> Definition:
    return Definition.model_validate(doc)


def _flat(when: list) -> list[Condition]:
    out: list[Condition] = []
    for c in when:
        out += c.any if isinstance(c, AnyOf) else [c]
    return out


_FOUR_EYES = {"name": "Four-eyes approval", "assignee": {"rule": "role", "action": "approve"}, "quorum": "any",
              "requester_may_approve": False, "escalate": True}
# Today's fixed approval as a definition: one step, anyone holding approve except the requester (migration 119 seeds
# the same documents). Fix batches never told their creator the outcome, so the batch default does not either.
DEFAULTS: dict[str, tuple[str, str, dict]] = {
    "fix_batch": ("default-fix-batch", "Four-eyes approval of fix batches",
                  {"steps": [_FOUR_EYES], "notify_requester": False, "distinct_approvers": True}),
    "change_request": ("default-change-request", "Four-eyes approval of change requests",
                       {"steps": [_FOUR_EYES], "notify_requester": True, "distinct_approvers": True}),
}


# ── conditions ────────────────────────────────────────────────────────────────


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None and not isinstance(v, bool) else None
    except (TypeError, ValueError):
        return None


def _eq(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(a) == float(b)
    return str(a).strip().lower() == str(b).strip().lower() if a is not None and b is not None else a is b


def holds(cond: Union[Condition, AnyOf], facts: dict[str, Any]) -> bool:
    """Whether one condition holds for the facts. A missing fact satisfies only ``not_exists`` (and ``ne``,
    ``not_in``)."""
    if isinstance(cond, AnyOf):
        return any(holds(c, facts) for c in cond.any)
    v, op, want = facts.get(cond.fact), cond.op, cond.value
    present = v is not None and v != [] and v != ""
    if op == "exists":
        return present
    if op == "not_exists":
        return not present
    items = v if isinstance(v, list) else [v] if present else []
    if op in ("gt", "gte", "lt", "lte"):
        a, b = _num(v), _num(want)
        if a is None or b is None:
            return False
        return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
    if op == "eq":
        return present and (any(_eq(x, want) for x in items) if isinstance(v, list) else _eq(v, want))
    if op == "ne":
        return not (present and (any(_eq(x, want) for x in items) if isinstance(v, list) else _eq(v, want)))
    wants = want if isinstance(want, list) else [want]
    if op == "in":
        return any(_eq(x, w) for x in items for w in wants)
    if op == "not_in":
        return not any(_eq(x, w) for x in items for w in wants)
    if op == "contains":
        return any(_eq(x, want) for x in items)
    if op == "contains_any":
        return any(_eq(x, w) for x in items for w in wants)
    return False


def _describe(c: Union[Condition, AnyOf]) -> str:
    if isinstance(c, AnyOf):
        return " or ".join(_describe(x) for x in c.any)
    return f"{c.fact} {c.op}" + ("" if c.op in ("exists", "not_exists") else f" {json.dumps(c.value, default=str)}")


def plan(defn: Definition, facts: dict[str, Any]) -> list[dict[str, Any]]:
    """Per step, in order: whether it applies to these facts and, when not, which condition failed."""
    out = []
    for i, s in enumerate(defn.steps):
        failed = next((c for c in s.when if not holds(c, facts)), None)
        out.append({"index": i, "name": s.name, "applies": failed is None,
                    "reason": None if failed is None else f"Condition not met: {_describe(failed)}"})
    return out


def policy_classes(session, tid: str, fields: list[str]) -> list[str]:
    """The tenant's applied policy classes (policy_field_classes, migration 113) naming any of ``fields``: each as its
    pack ("gxp") and as "pack:class" ("gxp:batch_identity"), sorted."""
    wanted = sorted({str(f).upper() for f in fields if f})
    if not wanted:
        return []
    rows = session.execute(text(
        "SELECT pack_id, class_id FROM policy_field_classes WHERE tenant_id = CAST(:t AS uuid) "
        "AND EXISTS (SELECT 1 FROM unnest(fields) f WHERE upper(f) = ANY(:w))"), {"t": tid, "w": wanted}).fetchall()
    return sorted({r[0] for r in rows} | {f"{r[0]}:{r[1]}" for r in rows})


# ── who decides ───────────────────────────────────────────────────────────────


def _active(session, tid: str, ids: list[str]) -> list[str]:
    ids = sorted({str(i) for i in ids if i})
    if not ids:
        return []
    return [r[0] for r in session.execute(text(
        "SELECT id::text FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active AND id = ANY(CAST(:ids AS uuid[])) "
        "ORDER BY id"), {"t": tid, "ids": ids}).fetchall()]


def resolve(session, tid: str, a: Assignee, facts: dict[str, Any], requester: Optional[str]) -> list[str]:
    """The active users of the tenant an assignee rule names for these facts, sorted (deterministic)."""
    from api.services.rbac import ACTIVE_GRANT_SQL, PERSONA_ALIAS, active_users_holding_sync

    if a.rule == "users":
        return _active(session, tid, [str(u) for u in a.users])
    if a.rule == "manager":
        if not requester:
            return []
        m = session.execute(text("SELECT manager_id::text FROM users WHERE tenant_id = CAST(:t AS uuid) "
                                 "AND id = CAST(:u AS uuid)"), {"t": tid, "u": requester}).scalar()
        return _active(session, tid, [m] if m else [])
    if a.rule == "data_owner":
        if a.of == "field":
            fields = [str(f).upper() for f in facts.get("fields") or []]
            rows = session.execute(text(
                "SELECT data_steward_id::text FROM glossary_terms WHERE tenant_id = CAST(:t AS uuid) "
                "AND data_steward_id IS NOT NULL AND upper(sap_table || '.' || sap_field) = ANY(:f)"),
                {"t": tid, "f": fields}).fetchall() if fields else []
        else:
            rows = session.execute(text(
                "SELECT COALESCE(owner_user_id, steward_user_id)::text FROM data_owners WHERE tenant_id = CAST(:t AS uuid) "
                "AND kind = 'object' AND ref = ANY(:m)"), {"t": tid, "m": list(facts.get("modules") or [])}).fetchall()
        return _active(session, tid, [r[0] for r in rows if r[0]])
    # role
    everyone = [r[0] for r in session.execute(text(
        "SELECT id::text FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active"), {"t": tid}).fetchall()]
    found: set[str] = set()
    if a.action:
        found |= active_users_holding_sync(session, tid, everyone, a.action)
    if a.roles:
        keys = set(a.roles) | {PERSONA_ALIAS[r] for r in a.roles if r in PERSONA_ALIAS} | {
            p for p, legacy in PERSONA_ALIAS.items() if legacy in a.roles}
        found |= {r[0] for r in session.execute(text(
            f"SELECT u.id::text FROM users u WHERE u.tenant_id = CAST(:t AS uuid) AND u.is_active AND (u.role = ANY(:k) "
            f"OR EXISTS (SELECT 1 FROM user_role_scopes s WHERE s.tenant_id = u.tenant_id AND s.user_id = u.id "
            f"AND s.system_id IS NULL AND s.module IS NULL AND s.role_key = ANY(:k) AND {ACTIVE_GRANT_SQL}))"),
            {"t": tid, "k": sorted(keys)}).fetchall()}
    return sorted(found)


def assignees(session, tid: str, step: Step, facts: dict[str, Any], requester: Optional[str]) -> tuple[list[str], str]:
    """(users who may decide the step, a note on how they were found). The requester is left out unless the step
    allows them; an empty rule falls to the step's fallback, then to everyone holding approve."""
    def drop(ids: list[str]) -> list[str]:
        return [u for u in ids if step.requester_may_approve or u != requester]

    users = drop(resolve(session, tid, step.assignee, facts, requester))
    if users:
        return users, f"{step.assignee.rule} rule"
    if step.fallback:
        users = drop(resolve(session, tid, step.fallback, facts, requester))
        if users:
            return users, f"{step.assignee.rule} rule named nobody; fallback {step.fallback.rule} rule"
    users = drop(resolve(session, tid, Assignee(rule="role", action="approve"), facts, requester))
    return users, f"{step.assignee.rule} rule named nobody; anyone holding approve may decide"


# ── definitions ───────────────────────────────────────────────────────────────


_DEF_COLS = ("id::text AS id, key, name, description, object_kind, version, active, definition, created_by_label, "
             "created_at, activated_at, activated_by_label")


def ensure_default(session, tid: str, kind: str) -> None:
    """Seed the default four-eyes definition of ``kind`` for a tenant that has no definition of it yet."""
    key, name, doc = DEFAULTS[kind]
    session.execute(text(
        "INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, definition, "
        "created_by_label, activated_at, activated_by_label) SELECT CAST(:t AS uuid), :k, :n, :o, 1, "
        "NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE tenant_id = CAST(:t AS uuid) AND object_kind = :o "
        "AND active), CAST(:d AS jsonb), 'system', now(), 'system' "
        "WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE tenant_id = CAST(:t AS uuid) AND key = :k) "
        "ON CONFLICT DO NOTHING"), {"t": tid, "k": key, "n": name, "o": kind, "d": json.dumps(doc)})


def active_definition(session, tid: str, kind: str) -> dict:
    row = session.execute(text(f"SELECT {_DEF_COLS} FROM workflow_definitions WHERE tenant_id = CAST(:t AS uuid) "
                               f"AND object_kind = :o AND active"), {"t": tid, "o": kind}).mappings().first()
    if row is None:
        ensure_default(session, tid, kind)
        row = session.execute(text(f"SELECT {_DEF_COLS} FROM workflow_definitions WHERE tenant_id = CAST(:t AS uuid) "
                                   f"AND object_kind = :o AND active"), {"t": tid, "o": kind}).mappings().first()
    if row is None:  # every definition of the kind exists but none is active: the default rules
        key, name, doc = DEFAULTS[kind]
        row = session.execute(text(f"SELECT {_DEF_COLS} FROM workflow_definitions WHERE tenant_id = CAST(:t AS uuid) "
                                   f"AND key = :k ORDER BY version DESC LIMIT 1"), {"t": tid, "k": key}).mappings().first()
    if row is None:
        raise WorkflowError(409, f"No workflow is active for {kind.replace('_', ' ')}s.")
    return dict(row)


# ── trail, notifications, webhooks ────────────────────────────────────────────


def event(session, tid: str, kind: str, object_id: str, action: str, *, instance_id: Optional[str] = None,
          task_id: Optional[str] = None, from_status: Optional[str] = None, to_status: Optional[str] = None,
          actor_id: Optional[str] = None, actor_label: Optional[str] = None, detail: Optional[dict] = None) -> None:
    """One row of the trail, plus the same as an audit_log row (best effort: a failed audit row never costs the
    transition, which workflow_events already holds)."""
    p = {"t": tid, "k": kind, "o": str(object_id), "i": instance_id, "tk": task_id, "a": action, "f": from_status,
         "to": to_status, "u": _uuid_or_none(actor_id), "l": actor_label or "system",
         "d": json.dumps(detail, default=str) if detail is not None else None}
    session.execute(text(
        "INSERT INTO workflow_events (tenant_id, object_kind, object_id, instance_id, task_id, action, from_status, "
        "to_status, actor_id, actor_label, detail, created_at) VALUES (CAST(:t AS uuid), :k, :o, CAST(:i AS uuid), "
        "CAST(:tk AS uuid), :a, :f, :to, CAST(:u AS uuid), :l, CAST(:d AS jsonb), clock_timestamp())"), p)
    try:
        with session.begin_nested():
            session.execute(text(
                "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, "
                "path, status_code, before_json, after_json) SELECT CAST(:t AS uuid), "
                "(SELECT id FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = CAST(:t AS uuid)), :l, :aa, :k, :o, "
                "'EVENT', 'workflow', 200, CAST(:b AS jsonb), CAST(:af AS jsonb)"),
                {**p, "aa": f"{kind}.{action}", "b": json.dumps({"status": from_status}) if from_status else None,
                 "af": json.dumps({"status": to_status, "instance_id": instance_id, "task_id": task_id,
                                   **(detail or {})}, default=str)})
    except Exception as e:  # noqa: BLE001 - the trail above is the record
        logger.warning("workflow audit row not written: %s", type(e).__name__)


def _uuid_or_none(v: Any) -> Optional[str]:
    if not v:
        return None
    try:
        return str(uuid.UUID(str(v)))
    except (ValueError, TypeError):
        return None


def _webhook(session, tid: str, name: str, data: dict) -> None:
    from api.services import webhooks
    webhooks.emit_safe(session, tid, name, data)


def link_of(kind: str, object_id: str) -> str:
    from api.services.collab import link_for
    if kind == "change_request":
        return f"/requests?open=request:{object_id}"
    return link_for("batch" if kind == "fix_batch" else kind, str(object_id))


def _notify(session, tid: str, user_id: str, title: str, body: str, link: str) -> None:
    from api.services.notifications import create_notification_sync
    try:
        with session.begin_nested():
            create_notification_sync(tid, user_id, "approval", title, body, link, session)
    except Exception as e:  # noqa: BLE001 - a user row that vanished never blocks the decision
        logger.warning("workflow notification not written: %s", type(e).__name__)


def _label(facts: dict) -> str:
    return str(facts.get("title") or facts.get("object_kind") or "request")


def flush_notifications(session, tid: str, instance_id: str) -> int:
    """Tell the deciders of every pending step not told yet (the delegate of one who is away hears too)."""
    inst = _instance(session, tid, instance_id)
    rows = session.execute(text(
        "SELECT id::text, step_name, assigned_users, due_at FROM workflow_tasks WHERE tenant_id = CAST(:t AS uuid) "
        "AND instance_id = CAST(:i AS uuid) AND status = 'pending' AND notified_at IS NULL"),
        {"t": tid, "i": instance_id}).fetchall()
    n = 0
    for tk, step, users, due in rows:
        title = f"{step}: {_label(inst['facts'])} waits for your approval"
        body = f"You are an approver of the step {step}." + (f" Due {due.isoformat()}." if due else "")
        for u in users or []:
            _notify(session, tid, str(u), title, body, link_of(inst["object_kind"], inst["object_id"]))
            n += 1
        session.execute(text("UPDATE workflow_tasks SET notified_at = now() WHERE id = CAST(:k AS uuid) "
                             "AND tenant_id = CAST(:t AS uuid)"), {"k": tk, "t": tid})
    return n


# ── instances ─────────────────────────────────────────────────────────────────


_INST_COLS = ("id::text AS id, definition_id::text AS definition_id, definition_key, definition_version, object_kind, "
              "object_id, status, requester_id::text AS requester_id, requester_label, facts, started_at, completed_at")


def task_cols(alias: str = "") -> str:
    """The workflow_tasks columns as the engine reads them (``alias``: the table alias in a join)."""
    p = f"{alias}." if alias else ""
    return (f"{p}id::text AS id, {p}instance_id::text AS instance_id, {p}step_index, {p}step_name, {p}assignee_rule, "
            f"{p}assigned_users, {p}assignee_note, {p}quorum, {p}requester_may_approve, {p}status, {p}skip_reason, "
            f"{p}sla_hours, {p}escalate, {p}due_at, {p}escalation_level, {p}escalated_to, {p}votes, "
            f"{p}decided_by::text AS decided_by, {p}decided_by_label, {p}on_behalf_of::text AS on_behalf_of, "
            f"{p}decision, {p}comment, {p}activated_at, {p}notified_at, {p}decided_at")


_TASK_COLS = task_cols()


def _instance(session, tid: str, instance_id: str) -> dict:
    row = session.execute(text(f"SELECT {_INST_COLS} FROM workflow_instances WHERE id = CAST(:i AS uuid) "
                               f"AND tenant_id = CAST(:t AS uuid)"), {"i": instance_id, "t": tid}).mappings().first()
    if row is None:
        raise WorkflowError(404, "Workflow not found.")
    return dict(row)


def _task_out(r: Any) -> dict:
    d = dict(r)
    d["assigned_users"] = [str(u) for u in d.get("assigned_users") or []]
    d["escalated_to"] = [str(u) for u in d.get("escalated_to") or []]
    return d


def tasks_of(session, tid: str, instance_id: str) -> list[dict]:
    return [_task_out(r) for r in session.execute(text(
        f"SELECT {_TASK_COLS} FROM workflow_tasks WHERE tenant_id = CAST(:t AS uuid) AND instance_id = CAST(:i AS uuid) "
        f"ORDER BY step_index"), {"t": tid, "i": instance_id}).mappings().all()]


def open_instance(session, tid: str, kind: str, object_id: str) -> Optional[dict]:
    row = session.execute(text(f"SELECT {_INST_COLS} FROM workflow_instances WHERE tenant_id = CAST(:t AS uuid) "
                               f"AND object_kind = :k AND object_id = :o AND status = 'in_progress'"),
                          {"t": tid, "k": kind, "o": str(object_id)}).mappings().first()
    return dict(row) if row else None


def latest_instance(session, tid: str, kind: str, object_id: str) -> Optional[dict]:
    row = session.execute(text(f"SELECT {_INST_COLS} FROM workflow_instances WHERE tenant_id = CAST(:t AS uuid) "
                               f"AND object_kind = :k AND object_id = :o ORDER BY started_at DESC, id LIMIT 1"),
                          {"t": tid, "k": kind, "o": str(object_id)}).mappings().first()
    return dict(row) if row else None


def view(session, tid: str, instance_id: str) -> dict:
    """An instance with its steps, for the screens."""
    return {**_instance(session, tid, instance_id), "tasks": tasks_of(session, tid, instance_id)}


def _wh_base(inst: dict) -> dict:
    return {"instance_id": inst["id"], "object_kind": inst["object_kind"], "object_id": str(inst["object_id"]),
            "workflow": inst["definition_key"], "version": inst["definition_version"]}


def _activate(session, tid: str, inst: dict, defn: Definition, task: dict) -> None:
    step = defn.steps[task["step_index"]]
    users, note = assignees(session, tid, step, inst["facts"], inst["requester_id"])
    due = datetime.now(timezone.utc) + timedelta(hours=step.sla_hours) if step.sla_hours else None
    session.execute(text(
        "UPDATE workflow_tasks SET status = 'pending', assigned_users = CAST(:u AS uuid[]), assignee_note = :n, "
        "due_at = :due, activated_at = now() WHERE id = CAST(:k AS uuid) AND tenant_id = CAST(:t AS uuid)"),
        {"u": users, "n": note, "due": due, "k": task["id"], "t": tid})
    event(session, tid, inst["object_kind"], inst["object_id"], "step_waiting", instance_id=inst["id"],
          task_id=task["id"], from_status="waiting", to_status="pending",
          detail={"step": step.name, "assignees": len(users), "note": note})
    _webhook(session, tid, "workflow.step_waiting", {**_wh_base(inst), "step": step.name,
                                                      "step_index": task["step_index"], "assignees": len(users),
                                                      "due_at": due.isoformat() if due else None})


def start(session, tid: str, kind: str, object_id: str, requester_id: Optional[str], requester_label: Optional[str],
          facts: dict[str, Any], *, notify: bool = True) -> dict:
    """Start the tenant's active workflow over an object. Returns the instance with its steps. Refused (409) while
    another instance of the object is in progress."""
    if kind not in OBJECT_KINDS:
        raise WorkflowError(422, f"Unknown object kind {kind}.")
    if open_instance(session, tid, kind, object_id):
        raise WorkflowError(409, "An approval of this object is already in progress.")
    d = active_definition(session, tid, kind)
    defn = parse(d["definition"])
    facts = {**facts, "object_kind": kind}
    steps = plan(defn, facts)
    if not any(s["applies"] for s in steps):  # validation forbids it; an old row must not approve unseen
        raise WorkflowError(409, "No step of the active workflow applies to this request; nothing can approve it.")
    iid = session.execute(text(
        "INSERT INTO workflow_instances (tenant_id, definition_id, definition_key, definition_version, object_kind, "
        "object_id, requester_id, requester_label, facts) VALUES (CAST(:t AS uuid), CAST(:d AS uuid), :k, :v, :o, :oid, "
        "CAST(:r AS uuid), :rl, CAST(:f AS jsonb)) RETURNING id::text"),
        {"t": tid, "d": d["id"], "k": d["key"], "v": d["version"], "o": kind, "oid": str(object_id),
         "r": _uuid_or_none(requester_id), "rl": requester_label, "f": json.dumps(facts, default=str)}).scalar()
    inst = _instance(session, tid, iid)
    for s, step in zip(steps, defn.steps):
        session.execute(text(
            "INSERT INTO workflow_tasks (tenant_id, instance_id, step_index, step_name, assignee_rule, quorum, "
            "requester_may_approve, status, skip_reason, sla_hours, escalate) VALUES (CAST(:t AS uuid), CAST(:i AS uuid), "
            ":x, :n, CAST(:r AS jsonb), :q, :rma, :st, :why, :sla, :esc)"),
            {"t": tid, "i": iid, "x": s["index"], "n": step.name,
             "r": json.dumps({"assignee": step.assignee.model_dump(mode="json"),
                              "fallback": step.fallback.model_dump(mode="json") if step.fallback else None}),
             "q": step.quorum, "rma": step.requester_may_approve, "st": "waiting" if s["applies"] else "skipped",
             "why": s["reason"], "sla": step.sla_hours, "esc": step.escalate})
    event(session, tid, kind, object_id, "started", instance_id=iid, to_status="in_progress", actor_id=requester_id,
          actor_label=requester_label, detail={"workflow": d["key"], "version": d["version"],
                                               "skipped": [s["name"] for s in steps if not s["applies"]]})
    for s in steps:
        if not s["applies"]:
            event(session, tid, kind, object_id, "step_skipped", instance_id=iid, to_status="skipped",
                  detail={"step": s["name"], "reason": s["reason"]})
    _webhook(session, tid, "workflow.started", {**_wh_base(inst), "steps": sum(1 for s in steps if s["applies"]),
                                                "skipped": sum(1 for s in steps if not s["applies"])})
    _advance(session, tid, inst, defn)
    if notify:
        flush_notifications(session, tid, iid)
    return view(session, tid, iid)


def _advance(session, tid: str, inst: dict, defn: Definition) -> str:
    """Make the next waiting step pending, or approve the instance when none is left. Returns the instance status."""
    nxt = session.execute(text(f"SELECT {_TASK_COLS} FROM workflow_tasks WHERE tenant_id = CAST(:t AS uuid) "
                               f"AND instance_id = CAST(:i AS uuid) AND status IN ('waiting', 'pending') "
                               f"ORDER BY step_index LIMIT 1"), {"t": tid, "i": inst["id"]}).mappings().first()
    if nxt is not None:
        if nxt["status"] == "waiting":
            _activate(session, tid, inst, defn, dict(nxt))
        return "in_progress"
    _finish(session, tid, inst, defn, "approved", None, None)
    return "approved"


def _finish(session, tid: str, inst: dict, defn: Definition, status: str, actor_id: Optional[str],
            actor_label: Optional[str], note: Optional[str] = None) -> None:
    session.execute(text("UPDATE workflow_instances SET status = :s, completed_at = now() WHERE id = CAST(:i AS uuid) "
                         "AND tenant_id = CAST(:t AS uuid)"), {"s": status, "i": inst["id"], "t": tid})
    if status != "approved":
        session.execute(text("UPDATE workflow_tasks SET status = 'cancelled' WHERE instance_id = CAST(:i AS uuid) "
                             "AND tenant_id = CAST(:t AS uuid) AND status IN ('waiting', 'pending')"),
                        {"i": inst["id"], "t": tid})
    event(session, tid, inst["object_kind"], inst["object_id"], status, instance_id=inst["id"],
          from_status="in_progress", to_status=status, actor_id=actor_id, actor_label=actor_label,
          detail={"note": note} if note else None)
    _webhook(session, tid, "workflow.completed", {**_wh_base(inst), "status": status})
    if defn.notify_requester and inst.get("requester_id") and inst["requester_id"] != actor_id:
        words = {"approved": "was approved", "rejected": "was rejected", "cancelled": "was cancelled",
                 "withdrawn": "was withdrawn"}[status]
        _notify(session, tid, inst["requester_id"], f"{_label(inst['facts'])} {words}",
                f"The approval of {_label(inst['facts'])} {words}." + (f" {note}" if note else ""),
                link_of(inst["object_kind"], inst["object_id"]))


def _delegators(session, tid: str, user_id: str) -> list[str]:
    """The people ``user_id`` stands in for today (active delegations to them)."""
    from api.services.delegation import ACTIVE_SQL, utc_today
    return [r[0] for r in session.execute(text(
        f"SELECT d.from_user_id::text FROM delegations d WHERE d.tenant_id = CAST(:t AS uuid) "
        f"AND d.to_user_id = CAST(:u AS uuid) AND {ACTIVE_SQL} ORDER BY d.created_at"),
        {"t": tid, "u": user_id, "today": utc_today()}).fetchall()]


def eligibility(session, tid: str, inst: dict, task: dict, user_id: str, caller_actions: set[str],
                caller_roles: set[str] | None = None) -> tuple[bool, Optional[str], str]:
    """(may decide, the person away it decides for or None, why not). Pure reads."""
    requester = inst.get("requester_id")
    if user_id == requester and not task["requester_may_approve"]:
        return False, None, "The requester cannot decide this step."
    voted = {v.get("user_id") for v in task["votes"] or []} | {v.get("on_behalf_of") for v in task["votes"] or []}
    if user_id in voted:
        return False, None, "You have already decided this step."
    assigned = set(task["assigned_users"]) | set(task["escalated_to"])
    if user_id in assigned:
        return True, None, ""
    for away in _delegators(session, tid, user_id):
        if away in assigned and away not in voted:
            if away == requester and not task["requester_may_approve"]:
                continue
            return True, away, ""
    rule = (task["assignee_rule"] or {}).get("assignee") or {}
    if rule.get("rule") == "role":
        if rule.get("action") and rule["action"] in caller_actions:
            return True, None, ""
        if caller_roles and set(rule.get("roles") or []) & caller_roles:
            return True, None, ""
    return False, None, "You are not an approver of this step."


def decide(session, tid: str, task_id: str, user_id: Optional[str], user_label: Optional[str], decision: str,
           comment: Optional[str], caller_actions: set[str], caller_roles: set[str] | None = None,
           *, notify: bool = True) -> dict:
    """Approve or reject the pending step ``task_id``. Returns {instance, task, status, completed}."""
    if decision not in ("approve", "reject"):
        raise WorkflowError(422, "The decision is approve or reject.")
    if not user_id:
        raise WorkflowError(403, "Sign in to decide.")
    row = session.execute(text(f"SELECT {_TASK_COLS} FROM workflow_tasks WHERE id = CAST(:k AS uuid) "
                               f"AND tenant_id = CAST(:t AS uuid) FOR UPDATE"), {"k": task_id, "t": tid}).mappings().first()
    if row is None:
        raise WorkflowError(404, "Approval step not found.")
    task = _task_out(row)
    inst = _instance(session, tid, task["instance_id"])
    if inst["status"] != "in_progress" or task["status"] != "pending":
        raise WorkflowError(409, f"This step is {task['status'] if inst['status'] == 'in_progress' else inst['status']}"
                                 "; it can no longer be decided.")
    d = session.execute(text("SELECT definition FROM workflow_definitions WHERE id = CAST(:d AS uuid) "
                             "AND tenant_id = CAST(:t AS uuid)"), {"d": inst["definition_id"], "t": tid}).scalar()
    defn = parse(d)
    if defn.distinct_approvers and decision == "approve":
        other = session.execute(text(
            "SELECT 1 FROM workflow_tasks WHERE instance_id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid) "
            "AND id <> CAST(:k AS uuid) AND (decided_by = CAST(:u AS uuid) OR votes @> CAST(:v AS jsonb)) LIMIT 1"),
            {"i": inst["id"], "t": tid, "k": task_id, "u": user_id,
             "v": json.dumps([{"user_id": user_id, "decision": "approve"}])}).first()
        if other:
            raise WorkflowError(403, "You approved another step of this request; a different person decides this one.")
    ok, away, why = eligibility(session, tid, inst, task, str(user_id), caller_actions, caller_roles)
    if not ok:
        raise WorkflowError(403, why)
    vote = {"user_id": str(user_id), "label": user_label, "decision": decision, "comment": comment,
            "on_behalf_of": away, "at": datetime.now(timezone.utc).isoformat()}
    votes = [*task["votes"], vote]
    detail = {"step": task["step_name"], "decision": decision, "on_behalf_of": away}
    if decision == "reject":
        status = "rejected"
    elif task["quorum"] == "all":
        need = {u for u in task["assigned_users"] if task["requester_may_approve"] or u != inst["requester_id"]}
        have = {v["user_id"] for v in votes if v["decision"] == "approve"} | {
            v["on_behalf_of"] for v in votes if v["decision"] == "approve" and v.get("on_behalf_of")}
        status = "approved" if need <= have else "pending"
        detail["remaining"] = len(need - have)
    else:
        status = "approved"
    session.execute(text(
        "UPDATE workflow_tasks SET votes = CAST(:v AS jsonb), status = :s, "
        "decided_by = CASE WHEN :s <> 'pending' THEN CAST(:u AS uuid) END, "
        "decided_by_label = CASE WHEN :s <> 'pending' THEN CAST(:l AS text) END, "
        "on_behalf_of = CASE WHEN :s <> 'pending' THEN CAST(:a AS uuid) END, "
        "decision = CASE WHEN :s <> 'pending' THEN CAST(:dc AS text) END, "
        "comment = CASE WHEN :s <> 'pending' THEN CAST(:c AS text) ELSE comment END, "
        "decided_at = CASE WHEN :s <> 'pending' THEN now() END "
        "WHERE id = CAST(:k AS uuid) AND tenant_id = CAST(:t AS uuid)"),
        {"v": json.dumps(votes), "s": status, "u": user_id, "l": user_label, "a": away, "dc": decision,
         "c": comment, "k": task_id, "t": tid})
    action = "vote" if status == "pending" else "step_approved" if status == "approved" else "step_rejected"
    event(session, tid, inst["object_kind"], inst["object_id"], action, instance_id=inst["id"], task_id=task_id,
          from_status="pending", to_status=status, actor_id=user_id, actor_label=user_label,
          detail={**detail, "comment": comment} if comment else detail)
    _webhook(session, tid, "workflow.step_decided", {**_wh_base(inst), "step": task["step_name"],
                                                      "step_index": task["step_index"], "decision": decision,
                                                      "status": status, "decided_by": user_label})
    if status == "rejected":
        _finish(session, tid, inst, defn, "rejected", user_id, user_label, comment)
        out = "rejected"
    elif status == "approved":
        out = _advance(session, tid, inst, defn)
    else:
        out = "in_progress"
    if notify:
        flush_notifications(session, tid, inst["id"])
    return {"instance": view(session, tid, inst["id"]), "task_id": task_id, "status": out,
            "completed": out in INSTANCE_DONE}


def pending_task(session, tid: str, instance_id: str) -> Optional[dict]:
    row = session.execute(text(f"SELECT {_TASK_COLS} FROM workflow_tasks WHERE tenant_id = CAST(:t AS uuid) "
                               f"AND instance_id = CAST(:i AS uuid) AND status = 'pending' ORDER BY step_index LIMIT 1"),
                          {"t": tid, "i": instance_id}).mappings().first()
    return _task_out(row) if row else None


def decide_object(session, tid: str, kind: str, object_id: str, requester_id: Optional[str],
                  requester_label: Optional[str], facts: dict, user_id: Optional[str], user_label: Optional[str],
                  decision: str, comment: Optional[str], caller_actions: set[str]) -> dict:
    """Decide the pending step of an object's approval, starting the approval first when none is in progress (a fix
    batch starts its approval at its first decision). The deciders of a step still pending afterwards are told."""
    inst = open_instance(session, tid, kind, object_id)
    if inst is None:
        inst = start(session, tid, kind, object_id, requester_id, requester_label, facts, notify=False)
    task = pending_task(session, tid, inst["id"])
    if task is None:  # cannot happen for an instance in progress; refuse rather than approve unseen
        raise WorkflowError(409, "No step of this approval is waiting for a decision.")
    return decide(session, tid, task["id"], user_id, user_label, decision, comment, caller_actions)


def close(session, tid: str, kind: str, object_id: str, status: str, actor_id: Optional[str],
          actor_label: Optional[str], note: Optional[str] = None) -> Optional[str]:
    """End the object's approval in progress (cancelled, or withdrawn when the object went back to its author).
    With nothing in progress, an approved instance is withdrawn when ``status`` is withdrawn (an approved fix batch
    sent back). Returns the instance id touched, or None."""
    inst = open_instance(session, tid, kind, object_id)
    if inst is None and status == "withdrawn":
        last = latest_instance(session, tid, kind, object_id)
        inst = last if last and last["status"] == "approved" else None
        if inst is not None:
            session.execute(text("UPDATE workflow_instances SET status = 'withdrawn', completed_at = now() "
                                 "WHERE id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                            {"i": inst["id"], "t": tid})
            event(session, tid, kind, object_id, "withdrawn", instance_id=inst["id"], from_status="approved",
                  to_status="withdrawn", actor_id=actor_id, actor_label=actor_label,
                  detail={"note": note} if note else None)
            _webhook(session, tid, "workflow.completed", {**_wh_base(inst), "status": "withdrawn"})
            return inst["id"]
    if inst is None:
        return None
    d = session.execute(text("SELECT definition FROM workflow_definitions WHERE id = CAST(:d AS uuid)"),
                        {"d": inst["definition_id"]}).scalar()
    _finish(session, tid, inst, parse(d), status, actor_id, actor_label, note)
    return inst["id"]


def reinstate(session, tid: str, kind: str, object_id: str, actor_id: Optional[str], actor_label: Optional[str]) -> bool:
    """An undo put the object back to approved: its last withdrawn approval counts again."""
    last = latest_instance(session, tid, kind, object_id)
    if last is None or last["status"] != "withdrawn":
        return False
    session.execute(text("UPDATE workflow_instances SET status = 'approved' WHERE id = CAST(:i AS uuid) "
                         "AND tenant_id = CAST(:t AS uuid)"), {"i": last["id"], "t": tid})
    event(session, tid, kind, object_id, "reinstated", instance_id=last["id"], from_status="withdrawn",
          to_status="approved", actor_id=actor_id, actor_label=actor_label)
    return True


def history(session, tid: str, kind: str, object_id: str) -> list[dict]:
    rows = session.execute(text(
        "SELECT id::text, instance_id::text, task_id::text, action, from_status, to_status, actor_id::text, actor_label, "
        "detail, created_at FROM workflow_events WHERE tenant_id = CAST(:t AS uuid) AND object_kind = :k "
        "AND object_id = :o ORDER BY created_at, id"), {"t": tid, "k": kind, "o": str(object_id)}).mappings().all()
    return [dict(r) for r in rows]


# ── the dry run (validate endpoint) ───────────────────────────────────────────


def dry_run(session, tid: str, doc: dict, facts: dict[str, Any], requester: Optional[str]) -> list[dict]:
    """Which steps would apply to these facts, and to whom (id and name), in order. Writes nothing."""
    defn = parse(doc)
    out = []
    names: dict[str, str] = {}
    for s, step in zip(plan(defn, facts), defn.steps):
        users, note = assignees(session, tid, step, facts, requester) if s["applies"] else ([], None)
        if users:
            names.update({r[0]: r[1] for r in session.execute(text(
                "SELECT id::text, COALESCE(NULLIF(name, ''), email) FROM users WHERE tenant_id = CAST(:t AS uuid) "
                "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": tid, "ids": users}).fetchall()})
        out.append({**s, "quorum": step.quorum, "sla_hours": step.sla_hours,
                    "requester_may_approve": step.requester_may_approve, "assignee_note": note,
                    "assignees": [{"id": u, "name": names.get(u, u)} for u in users]})
    return out


# ── SLA: past-due steps climb the escalation chain ────────────────────────────


def sla_sweep(session, tid: str, now: Optional[datetime] = None) -> dict[str, int]:
    """Every pending step past its due time: each level of the tenant's escalation chain (api/services/escalation.py)
    fires once when the step is ``after_minutes`` past due; the person it reaches is told and may decide the step.
    Without a chain the step's deciders are told once that it is overdue. Idempotent (the level reached is stored)."""
    from api.services.escalation import load_chain, target_of
    from api.services.triage import load_settings

    now = now or datetime.now(timezone.utc)
    rows = session.execute(text(f"SELECT {_TASK_COLS}, overdue_notified_at FROM workflow_tasks "
                                f"WHERE tenant_id = CAST(:t AS uuid) AND status = 'pending' AND escalate "
                                f"AND due_at IS NOT NULL AND due_at <= :now FOR UPDATE SKIP LOCKED"),
                           {"t": tid, "now": now}).mappings().all()
    if not rows:
        return {}
    chain = load_chain(session, tid)
    fallback = load_settings(session, tid)["fallback"]
    out = {"escalated": 0, "overdue": 0}
    for r in rows:
        task = _task_out(r)
        inst = _instance(session, tid, task["instance_id"])
        late = (now - r["due_at"]).total_seconds() / 60
        if not chain:
            if r["overdue_notified_at"] is None:
                for u in task["assigned_users"]:
                    _notify(session, tid, u, f"Overdue: {task['step_name']} for {_label(inst['facts'])}",
                            "This approval step is past its due time.", link_of(inst["object_kind"], inst["object_id"]))
                session.execute(text("UPDATE workflow_tasks SET overdue_notified_at = :n WHERE id = CAST(:k AS uuid)"),
                                {"n": now, "k": task["id"]})
                event(session, tid, inst["object_kind"], inst["object_id"], "overdue", instance_id=inst["id"],
                      task_id=task["id"], detail={"step": task["step_name"]})
                out["overdue"] += 1
            continue
        for step in chain:
            if step["level"] <= task["escalation_level"] or late < step["after_minutes"]:
                continue
            who = target_of(step, None, {}, fallback)
            reached = sorted(set(task["escalated_to"]) | ({who} if who else set()))
            session.execute(text("UPDATE workflow_tasks SET escalation_level = :l, escalated_to = CAST(:e AS uuid[]) "
                                 "WHERE id = CAST(:k AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                            {"l": step["level"], "e": reached, "k": task["id"], "t": tid})
            task["escalation_level"], task["escalated_to"] = step["level"], reached
            if who:
                _notify(session, tid, who, f"Escalation level {step['level']}: {task['step_name']} for "
                                           f"{_label(inst['facts'])}",
                        f"This approval step passed its due time by {step['after_minutes']} minutes or more. "
                        "You may decide it.", link_of(inst["object_kind"], inst["object_id"]))
            event(session, tid, inst["object_kind"], inst["object_id"], "escalated", instance_id=inst["id"],
                  task_id=task["id"], detail={"step": task["step_name"], "level": step["level"], "to": who})
            _webhook(session, tid, "workflow.escalated", {**_wh_base(inst), "step": task["step_name"],
                                                           "level": step["level"]})
            out["escalated"] += 1
    return {k: v for k, v in out.items() if v}
