"""Approval workflows: definitions (list, read, create, new version, activate, validate) and the steps waiting.

The administrator (manage_workflows) creates, versions and activates definitions; everyone who may view reads them and
may dry-run one (validate). A decision on a step needs approve and is checked by the engine (api/services/workflow.py):
the assignee rule, delegation, quorum and the requester exclusion. A fix batch step is decided through the batch's own
approve and send-back (api/routes/remediation.py), so the batch follows; this route forwards to them.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import workflow
from api.services.rbac import (
    Scope, current_user_id, current_user_label, dev_role_override, effective_actions, permissions_for,
    require_permission, viewing_as,
)

router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])

ObjectKind = Literal["fix_batch", "change_request"]


class DefinitionOut(BaseModel):
    id: str
    key: str
    name: str
    description: Optional[str] = None
    object_kind: str
    version: int
    active: bool
    definition: dict[str, Any]
    created_by_label: Optional[str] = None
    created_at: datetime
    activated_at: Optional[datetime] = None
    activated_by_label: Optional[str] = None


class DefinitionList(BaseModel):
    items: list[DefinitionOut]


class DefinitionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    key: Optional[str] = Field(None, min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    description: Optional[str] = Field(None, max_length=2000)
    object_kind: ObjectKind
    definition: dict[str, Any]
    activate: bool = False


class VersionCreate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    definition: dict[str, Any]
    activate: bool = False


class ValidateBody(BaseModel):
    """A definition (or a stored one by id) and a sample: ``facts`` as workflow.FACTS names them, and/or a
    ``payload`` of SAP fields (TABLE.FIELD: value) from which the fields and policy classes touched are read."""
    definition: Optional[dict[str, Any]] = None
    definition_id: Optional[uuid.UUID] = None
    object_kind: ObjectKind = "change_request"
    facts: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict, max_length=500)
    requester_id: Optional[uuid.UUID] = None


class StepPreview(BaseModel):
    index: int
    name: str
    applies: bool
    reason: Optional[str] = None
    quorum: str
    sla_hours: Optional[float] = None
    requester_may_approve: bool
    assignee_note: Optional[str] = None
    assignees: list[dict[str, str]] = []


class ValidateOut(BaseModel):
    valid: bool
    problems: list[str]
    facts: dict[str, Any] = {}
    steps: list[StepPreview] = []


class FactsOut(BaseModel):
    facts: dict[str, str]
    ops: list[str]
    assignee_rules: list[str]
    object_kinds: list[str]


class TaskOut(BaseModel):
    id: str
    instance_id: str
    step_index: int
    step_name: str
    status: str
    quorum: str
    assigned_users: list[str]
    assignee_note: Optional[str] = None
    due_at: Optional[datetime] = None
    escalation_level: int = 0
    activated_at: Optional[datetime] = None
    object_kind: str
    object_id: str
    title: Optional[str] = None
    requester_label: Optional[str] = None
    may_decide: bool = False
    on_behalf_of: Optional[str] = None


class TaskList(BaseModel):
    items: list[TaskOut]


class Decision(BaseModel):
    decision: Literal["approve", "reject"]
    comment: Optional[str] = Field(None, max_length=4000)


class ManagerBody(BaseModel):
    manager_id: Optional[uuid.UUID] = None


def _err(e: workflow.WorkflowError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.detail)


async def _definition(db: AsyncSession, tenant: Tenant, def_id: uuid.UUID) -> dict:
    row = (await db.execute(text(f"SELECT {workflow._DEF_COLS} FROM workflow_definitions WHERE id = :i "
                                 f"AND tenant_id = :t"), {"i": str(def_id), "t": str(tenant.id)})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    return dict(row)


def _check(doc: dict[str, Any]) -> None:
    problems = workflow.validate_definition(doc)
    if problems:
        raise HTTPException(status_code=422, detail={"detail": "The definition is not valid.", "problems": problems})


async def _audit(db: AsyncSession, tenant: Tenant, request: Request, action: str, d: dict, before: dict | None) -> None:
    from api.services.rbac import write_audit
    await write_audit(db, tenant.id, request, action, "workflow_definition", str(d["id"]), before,
                      {"key": d["key"], "version": d["version"], "active": d["active"], "object_kind": d["object_kind"]})


async def _activate(db: AsyncSession, tenant: Tenant, d: dict) -> None:
    await db.execute(text("UPDATE workflow_definitions SET active = false WHERE tenant_id = :t AND object_kind = :o "
                          "AND active AND id <> :i"), {"t": str(tenant.id), "o": d["object_kind"], "i": d["id"]})
    await db.execute(text("UPDATE workflow_definitions SET active = true, activated_at = now(), activated_by_label = :l "
                          "WHERE id = :i AND tenant_id = :t"), {"l": current_user_label(), "i": d["id"],
                                                                 "t": str(tenant.id)})


@router.get("/facts", response_model=FactsOut, dependencies=[Depends(require_permission("view"))])
async def list_facts() -> FactsOut:
    """What a condition may test, its operators and the assignee rules (for the definition editor)."""
    return FactsOut(facts=workflow.FACTS, ops=list(workflow.OPS), assignee_rules=list(workflow.ASSIGNEE_RULES),
                    object_kinds=list(workflow.OBJECT_KINDS))


@router.get("/definitions", response_model=DefinitionList, dependencies=[Depends(require_permission("view"))])
async def list_definitions(
    object_kind: Optional[ObjectKind] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> DefinitionList:
    """Every version of every definition, newest first; the active one per object kind is marked."""
    await _rls(db, tenant)
    for k in workflow.OBJECT_KINDS:
        await db.run_sync(lambda s, k=k: workflow.ensure_default(s, str(tenant.id), k))
    await db.commit()
    await _rls(db, tenant)
    rows = (await db.execute(text(
        f"SELECT {workflow._DEF_COLS} FROM workflow_definitions WHERE tenant_id = :t "
        f"AND (CAST(:o AS text) IS NULL OR object_kind = :o) ORDER BY object_kind, key, version DESC"),
        {"t": str(tenant.id), "o": object_kind})).mappings().all()
    return DefinitionList(items=[DefinitionOut(**r) for r in rows])


@router.get("/definitions/{definition_id}", response_model=DefinitionOut,
            dependencies=[Depends(require_permission("view"))])
async def get_definition(definition_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> DefinitionOut:
    await _rls(db, tenant)
    return DefinitionOut(**await _definition(db, tenant, definition_id))


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "workflow"


@router.post("/definitions", response_model=DefinitionOut,
             dependencies=[Depends(require_permission("manage_workflows"))])
async def create_definition(body: DefinitionCreate, request: Request, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> DefinitionOut:
    """Version 1 of a new workflow. Active only when asked (``activate``); instances already started keep theirs."""
    _check(body.definition)
    await _rls(db, tenant)
    key = body.key or _slug(body.name)
    if (await db.execute(text("SELECT 1 FROM workflow_definitions WHERE tenant_id = :t AND key = :k"),
                         {"t": str(tenant.id), "k": key})).first():
        raise HTTPException(status_code=409, detail=f"A workflow with the key {key} exists; add a version to it.")
    did = (await db.execute(text(
        "INSERT INTO workflow_definitions (tenant_id, key, name, description, object_kind, version, definition, "
        "created_by, created_by_label) VALUES (:t, :k, :n, :ds, :o, 1, CAST(:d AS jsonb), CAST(:u AS uuid), :l) "
        "RETURNING id::text"),
        {"t": str(tenant.id), "k": key, "n": body.name, "ds": body.description, "o": body.object_kind,
         "d": workflow.parse(body.definition).model_dump_json(), "u": workflow._uuid_or_none(current_user_id(request)),
         "l": current_user_label()})).scalar()
    d = await _definition(db, tenant, uuid.UUID(did))
    if body.activate:
        await _activate(db, tenant, d)
        d = await _definition(db, tenant, uuid.UUID(did))
    await _audit(db, tenant, request, "workflow_definition.create", d, None)
    await db.commit()
    return DefinitionOut(**d)


@router.post("/definitions/{definition_id}/versions", response_model=DefinitionOut,
             dependencies=[Depends(require_permission("manage_workflows"))])
async def new_version(definition_id: uuid.UUID, body: VersionCreate, request: Request,
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> DefinitionOut:
    """The next version of the workflow the definition belongs to (inactive unless ``activate``)."""
    _check(body.definition)
    await _rls(db, tenant)
    base = await _definition(db, tenant, definition_id)
    nxt = (await db.execute(text("SELECT COALESCE(max(version), 0) + 1 FROM workflow_definitions WHERE tenant_id = :t "
                                 "AND key = :k"), {"t": str(tenant.id), "k": base["key"]})).scalar()
    did = (await db.execute(text(
        "INSERT INTO workflow_definitions (tenant_id, key, name, description, object_kind, version, definition, "
        "created_by, created_by_label) VALUES (:t, :k, :n, :ds, :o, :v, CAST(:d AS jsonb), CAST(:u AS uuid), :l) "
        "RETURNING id::text"),
        {"t": str(tenant.id), "k": base["key"], "n": body.name or base["name"],
         "ds": body.description if body.description is not None else base["description"], "o": base["object_kind"],
         "v": nxt, "d": workflow.parse(body.definition).model_dump_json(),
         "u": workflow._uuid_or_none(current_user_id(request)), "l": current_user_label()})).scalar()
    d = await _definition(db, tenant, uuid.UUID(did))
    if body.activate:
        await _activate(db, tenant, d)
        d = await _definition(db, tenant, uuid.UUID(did))
    await _audit(db, tenant, request, "workflow_definition.version", d, {"version": base["version"]})
    await db.commit()
    return DefinitionOut(**d)


@router.post("/definitions/{definition_id}/activate", response_model=DefinitionOut,
             dependencies=[Depends(require_permission("manage_workflows"))])
async def activate_definition(definition_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                              tenant: Tenant = Depends(get_tenant)) -> DefinitionOut:
    """Make this version the one new approvals of its object kind start on. Approvals in progress keep theirs."""
    await _rls(db, tenant)
    d = await _definition(db, tenant, definition_id)
    _check(d["definition"])
    before = (await db.execute(text("SELECT id::text FROM workflow_definitions WHERE tenant_id = :t AND object_kind = :o "
                                    "AND active"), {"t": str(tenant.id), "o": d["object_kind"]})).scalar()
    await _activate(db, tenant, d)
    d = await _definition(db, tenant, definition_id)
    await _audit(db, tenant, request, "workflow_definition.activate", d, {"active_id": before})
    await db.commit()
    return DefinitionOut(**d)


@router.post("/definitions/validate", response_model=ValidateOut, dependencies=[Depends(require_permission("view"))])
async def validate_definition(body: ValidateBody, db: AsyncSession = Depends(get_db),
                              tenant: Tenant = Depends(get_tenant)) -> ValidateOut:
    """Dry run: the problems of a definition, and for a sample which steps would apply and to whom. Writes nothing."""
    await _rls(db, tenant)
    doc = body.definition
    if doc is None:
        if body.definition_id is None:
            raise HTTPException(status_code=422, detail="Give a definition or a definition_id.")
        doc = (await _definition(db, tenant, body.definition_id))["definition"]
    problems = workflow.validate_definition(doc)
    if problems:
        return ValidateOut(valid=False, problems=problems)
    facts: dict[str, Any] = {"object_kind": body.object_kind, **body.facts}
    if body.payload:
        fields = sorted({str(k).upper() for k in body.payload})
        facts.setdefault("fields", fields)
        facts.setdefault("policy_classes",
                         await db.run_sync(lambda s: workflow.policy_classes(s, str(tenant.id), fields)))
    requester = str(body.requester_id) if body.requester_id else None
    steps = await db.run_sync(lambda s: workflow.dry_run(s, str(tenant.id), doc, facts, requester))
    return ValidateOut(valid=True, problems=[], facts=facts, steps=[StepPreview(**x) for x in steps])


async def _caller_actions(request: Request, db: AsyncSession, tenant: Tenant, role: str) -> set[str]:
    uid = getattr(request.state, "local_user_id", None)
    if dev_role_override(request) is not None or viewing_as(request) or not uid:
        return set(permissions_for(role))
    return await effective_actions(db, tenant.id, str(uid), role, Scope())


@router.get("/tasks", response_model=TaskList)
async def list_tasks(
    request: Request,
    scope: Literal["mine", "all"] = Query("mine"),
    object_kind: Optional[ObjectKind] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
) -> TaskList:
    """Approval steps waiting for a decision: those the caller may decide (mine), or every one (all)."""
    await _rls(db, tenant)
    uid = current_user_id(request)
    actions = await _caller_actions(request, db, tenant, role)
    rows = (await db.execute(text(
        f"SELECT {workflow.task_cols('t')}, i.object_kind, i.object_id, i.facts->>'title' AS title, i.requester_label, "
        "i.requester_id::text AS requester_id "
        "FROM workflow_tasks t JOIN workflow_instances i ON i.id = t.instance_id AND i.tenant_id = t.tenant_id "
        "WHERE t.tenant_id = :t AND t.status = 'pending' AND i.status = 'in_progress' "
        "AND (CAST(:o AS text) IS NULL OR i.object_kind = :o) ORDER BY t.due_at NULLS LAST, t.activated_at LIMIT 500"),
        {"t": str(tenant.id), "o": object_kind})).mappings().all()
    out: list[TaskOut] = []
    for r in rows:
        task = workflow._task_out(r)
        ok, away = False, None
        if uid:
            inst = {"id": task["instance_id"], "requester_id": r["requester_id"]}
            ok, away, _ = await db.run_sync(lambda s, task=task, inst=inst: workflow.eligibility(
                s, str(tenant.id), inst, task, str(uid), actions))
        if scope == "mine" and not ok:
            continue
        out.append(TaskOut(**{**{k: task[k] for k in TaskOut.model_fields if k in task},
                              "may_decide": ok, "on_behalf_of": away}))
    return TaskList(items=out)


@router.get("/instances/{instance_id}", dependencies=[Depends(require_permission("view"))])
async def get_instance(instance_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> dict:
    """An approval with its steps and its trail."""
    await _rls(db, tenant)
    try:
        inst = await db.run_sync(lambda s: workflow.view(s, str(tenant.id), str(instance_id)))
    except workflow.WorkflowError as e:
        raise _err(e)
    inst["history"] = await db.run_sync(lambda s: workflow.history(s, str(tenant.id), inst["object_kind"],
                                                                    inst["object_id"]))
    return inst


@router.post("/tasks/{task_id}/decide")
async def decide_task(
    task_id: uuid.UUID,
    body: Decision,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("approve")),
) -> dict:
    """Approve or reject a waiting step. A rejection says why. A fix batch step goes through the batch's approve (or,
    rejected, its send-back), so the batch follows the decision."""
    if body.decision == "reject" and not (body.comment or "").strip():
        raise HTTPException(status_code=422, detail="Say why you reject it.")
    await _rls(db, tenant)
    row = (await db.execute(text(
        "SELECT i.object_kind, i.object_id FROM workflow_tasks t JOIN workflow_instances i ON i.id = t.instance_id "
        "WHERE t.id = :k AND t.tenant_id = :t"), {"k": str(task_id), "t": str(tenant.id)})).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Approval step not found.")
    kind, oid = row
    if kind == "fix_batch":
        from api.routes import remediation
        if body.decision == "approve":
            return await remediation.approve_batch(uuid.UUID(oid), request, db, tenant, role)
        return await remediation.send_back_batch(uuid.UUID(oid), remediation.SendBack(note=body.comment or ""),
                                                 request, db, tenant, role)
    actions = await _caller_actions(request, db, tenant, role)
    uid, label = current_user_id(request), current_user_label()
    try:
        res = await db.run_sync(lambda s: workflow.decide(s, str(tenant.id), str(task_id), uid, label, body.decision,
                                                          body.comment, actions))
    except workflow.WorkflowError as e:
        raise _err(e)
    await db.commit()
    return res
