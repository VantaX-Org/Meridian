"""Master data change requests: create, update the draft, validate, submit, list, read with its history, decide,
cancel, comment, attach, retry and the export load file (api/services/change_requests.py for the lifecycle).

Permissions: mdm.write proposes (create, update, validate, submit, cancel one's own, attach, retry); mdm.read reads and
comments; approve decides a step, and the workflow engine then checks that the caller is an approver of it (assignee
rule, delegation, quorum, never the requester unless the step allows it). The administrator (manage_workflows) may
cancel any request.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import change_requests as crs
from api.services import workflow
from api.services.rbac import current_user_id, current_user_label, require_permission

router = APIRouter(prefix="/api/v1/change-requests", tags=["change-requests"])
logger = logging.getLogger("meridian.change_requests")

Kind = Literal["create", "change"]
Obj = Literal["material", "customer", "vendor", "business_partner"]


class RequestCreate(BaseModel):
    kind: Kind
    object: Obj
    target_system_id: Optional[uuid.UUID] = None
    object_key: Optional[str] = Field(None, max_length=500, description="change: the record, e.g. MATNR=...|WERKS=...")
    title: Optional[str] = Field(None, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict, max_length=500, description="TABLE.FIELD: proposed value")


class RequestUpdate(BaseModel):
    target_system_id: Optional[uuid.UUID] = None
    object_key: Optional[str] = Field(None, max_length=500)
    title: Optional[str] = Field(None, max_length=200)
    payload: Optional[dict[str, Any]] = Field(None, max_length=500)


class RequestOut(BaseModel):
    id: str
    kind: str
    object: str
    target_system_id: Optional[str] = None
    object_key: Optional[str] = None
    title: Optional[str] = None
    payload: dict[str, Any]
    status: str
    requester_id: Optional[str] = None
    requester_label: Optional[str] = None
    workflow_instance_id: Optional[str] = None
    precheck: Optional[dict[str, Any]] = None
    validated_at: Optional[datetime] = None
    sap_key: Optional[str] = None
    sap_result: Optional[dict[str, Any]] = None
    sap_phase: Optional[str] = None
    sap_attempts: int = 0
    delivery: Optional[str] = None
    has_export: bool = False
    reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class RequestList(BaseModel):
    items: list[RequestOut]


class RequestDetail(BaseModel):
    request: RequestOut
    workflow: Optional[dict[str, Any]] = None
    history: list[dict[str, Any]] = []
    comments: list[dict[str, Any]] = []
    attachments: list[dict[str, Any]] = []


class PrecheckOut(BaseModel):
    problems: list[str] = []
    rules_run: int = 0
    failures: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    checked_at: Optional[str] = None


class DecideBody(BaseModel):
    decision: Literal["approve", "reject"]
    comment: Optional[str] = Field(None, max_length=4000)
    task_id: Optional[uuid.UUID] = None


class CommentBody(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class AttachmentBody(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: Optional[str] = Field(None, max_length=120)
    size_bytes: Optional[int] = Field(None, ge=0)
    sha256: Optional[str] = Field(None, pattern=r"^[0-9a-f]{64}$")
    storage_key: Optional[str] = Field(None, max_length=500)


class CancelBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=2000)


class RetryBody(BaseModel):
    checked_in_sap: bool = Field(False, description="the record is not in SAP: an attempt that reached the commit "
                                                    "may be retried")


def _err(e: Exception) -> HTTPException:
    if isinstance(e, (crs.RequestError, workflow.WorkflowError)):
        return HTTPException(status_code=e.status, detail=e.detail)
    raise e


def _uid(request: Request) -> str:
    uid = current_user_id(request)
    if not uid:
        raise HTTPException(status_code=403, detail="Sign in to work on change requests.")
    return uid


async def _load(db: AsyncSession, tenant: Tenant, cr_id: uuid.UUID, lock: bool = False) -> dict:
    await _rls(db, tenant)
    try:
        return await db.run_sync(lambda s: crs.load(s, str(tenant.id), str(cr_id), lock))
    except crs.RequestError as e:
        raise _err(e)


def _own(cr: dict, uid: str) -> None:
    if cr["requester_id"] != uid:
        raise HTTPException(status_code=403, detail="Only the requester changes this request.")


def _problems(obj: str, kind: str, payload: dict, object_key: Optional[str]) -> None:
    problems = crs.check_payload(obj, kind, payload, object_key)
    if problems:
        raise HTTPException(status_code=422, detail={"detail": "The proposal is not valid.", "problems": problems})


async def _system_ok(db: AsyncSession, tenant: Tenant, system_id: Optional[uuid.UUID]) -> None:
    if system_id and not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                                           {"s": str(system_id), "t": str(tenant.id)})).first():
        raise HTTPException(status_code=404, detail="SAP system not found")


async def _precheck(db: AsyncSession, tenant: Tenant, cr: dict) -> dict:
    """Rules on the proposal (a worker thread: the check engine is CPU work) and likely duplicates."""
    from sap.bapi_writeback import parse_key

    tid = str(tenant.id)
    overrides, authored = await db.run_sync(lambda s: crs.governance(s))
    rules = await asyncio.to_thread(crs.rule_results, tid, cr["object"], cr["payload"], cr.get("object_key"),
                                    overrides, authored)
    key_field = crs.KEY_FIELD[cr["object"]][1]
    exclude = parse_key(cr.get("object_key") or "").get(key_field)
    dups = await db.run_sync(lambda s: crs.duplicates(s, tid, cr["object"], cr["payload"], exclude))
    return {**rules, "duplicates": dups, "checked_at": datetime.now(timezone.utc).isoformat()}


def _queue(tenant: Tenant, cr: dict) -> None:
    """Hand a request in status creating to the worker (after the commit). A queue failure leaves it creating; POST
    /retry hands it over again."""
    if cr["status"] != "creating":
        return
    try:
        from workers.tasks.change_requests import write_to_sap
        write_to_sap.delay(str(tenant.id), cr["id"])
    except Exception as e:  # noqa: BLE001 - the request is stored; the queue is retried by hand
        logger.error("change request %s not queued: %s", cr["id"], type(e).__name__)


@router.post("", response_model=RequestOut, dependencies=[Depends(require_permission("mdm.write"))])
async def create_request(body: RequestCreate, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> RequestOut:
    """A draft request. The proposal is checked for fields SAP has; the rules run at validate and submit."""
    uid = _uid(request)
    _problems(body.object, body.kind, body.payload, body.object_key)
    await _rls(db, tenant)
    await _system_ok(db, tenant, body.target_system_id)
    cid = (await db.execute(text(
        "INSERT INTO change_requests (tenant_id, kind, object, target_system_id, object_key, title, payload, "
        "requester_id, requester_label) VALUES (:t, :k, :o, CAST(:s AS uuid), :key, :title, CAST(:p AS jsonb), "
        "CAST(:u AS uuid), :l) RETURNING id::text"),
        {"t": str(tenant.id), "k": body.kind, "o": body.object,
         "s": str(body.target_system_id) if body.target_system_id else None, "key": body.object_key,
         "title": body.title, "p": json.dumps(crs.normalise(body.payload), default=str), "u": uid,
         "l": current_user_label()})).scalar()
    await db.run_sync(lambda s: workflow.event(s, str(tenant.id), crs.KIND, cid, "drafted", to_status="draft",
                                               actor_id=uid, actor_label=current_user_label()))
    cr = await _load(db, tenant, uuid.UUID(cid))
    await db.commit()
    return RequestOut(**cr)


@router.patch("/{request_id}", response_model=RequestOut, dependencies=[Depends(require_permission("mdm.write"))])
async def update_request(request_id: uuid.UUID, body: RequestUpdate, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> RequestOut:
    """Edit a draft (its requester only). The last validation no longer holds and is cleared."""
    uid = _uid(request)
    cr = await _load(db, tenant, request_id, lock=True)
    _own(cr, uid)
    if cr["status"] not in crs.EDITABLE:
        raise HTTPException(status_code=409, detail=f"The request is {cr['status']}; only a draft is edited.")
    payload = crs.normalise(body.payload) if body.payload is not None else cr["payload"]
    key = body.object_key if body.object_key is not None else cr["object_key"]
    _problems(cr["object"], cr["kind"], payload, key)
    await _system_ok(db, tenant, body.target_system_id)
    await db.execute(text(
        "UPDATE change_requests SET payload = CAST(:p AS jsonb), object_key = :k, title = COALESCE(:ti, title), "
        "target_system_id = COALESCE(CAST(:s AS uuid), target_system_id), precheck = NULL, validated_at = NULL, "
        "updated_at = now() WHERE id = :i AND tenant_id = :t"),
        {"p": json.dumps(payload, default=str), "k": key, "ti": body.title,
         "s": str(body.target_system_id) if body.target_system_id else None, "i": str(request_id),
         "t": str(tenant.id)})
    await db.run_sync(lambda s: workflow.event(s, str(tenant.id), crs.KIND, cr["id"], "edited", actor_id=uid,
                                               actor_label=current_user_label(),
                                               detail={"fields": sorted(payload)}))
    out = await _load(db, tenant, request_id)
    await db.commit()
    return RequestOut(**out)


@router.post("/{request_id}/validate", response_model=PrecheckOut,
             dependencies=[Depends(require_permission("mdm.write"))])
async def validate_request(request_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> PrecheckOut:
    """Which of Meridian's rules the proposed record would fail, and which master records it may duplicate."""
    cr = await _load(db, tenant, request_id)
    problems = crs.check_payload(cr["object"], cr["kind"], cr["payload"], cr["object_key"])
    if problems:
        return PrecheckOut(problems=problems)
    pc = await _precheck(db, tenant, cr)
    if cr["status"] == "draft":
        await db.execute(text("UPDATE change_requests SET precheck = CAST(:p AS jsonb), validated_at = now() "
                              "WHERE id = :i AND tenant_id = :t"),
                         {"p": json.dumps(pc, default=str), "i": str(request_id), "t": str(tenant.id)})
        await db.run_sync(lambda s: workflow.event(
            s, str(tenant.id), crs.KIND, cr["id"], "validated", actor_id=current_user_id(request),
            actor_label=current_user_label(), detail={"failures": len(pc["failures"]),
                                                      "duplicates": len(pc["duplicates"])}))
        await db.commit()
    return PrecheckOut(**pc)


@router.post("/{request_id}/submit", response_model=RequestDetail,
             dependencies=[Depends(require_permission("mdm.write"))])
async def submit_request(request_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> RequestDetail:
    """Validate once more and hand the request to the tenant's change request workflow."""
    uid = _uid(request)
    cr = await _load(db, tenant, request_id, lock=True)
    _own(cr, uid)
    if cr["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"The request is {cr['status']}; only a draft is submitted.")
    _problems(cr["object"], cr["kind"], cr["payload"], cr["object_key"])
    pc = await _precheck(db, tenant, cr)
    tid, label = str(tenant.id), current_user_label()

    def go(s):
        classes = workflow.policy_classes(s, tid, sorted(crs.normalise(cr["payload"])))
        cur = crs.transition(s, tid, cr, "submitted", uid, label, precheck=pc, validated_at=datetime.now(timezone.utc),
                             submitted_at=datetime.now(timezone.utc))
        inst = workflow.start(s, tid, crs.KIND, cr["id"], uid, label, crs.facts(cur, pc, classes))
        return crs.transition(s, tid, cur, "in_approval", uid, label, workflow_instance_id=inst["id"])
    try:
        await db.run_sync(go)
    except (crs.RequestError, workflow.WorkflowError) as e:
        await db.rollback()
        raise _err(e)
    await db.commit()
    return await get_request(request_id, db, tenant)


async def decide(db: AsyncSession, tenant: Tenant, request: Request, cr_id: str, task_id: Optional[str],
                 decision: str, comment: Optional[str], actions: set[str]) -> RequestDetail:
    """Decide a step of the request's approval and follow the outcome (shared with POST /workflows/tasks/{id}/decide)."""
    from api.config import settings

    if decision == "reject" and not (comment or "").strip():
        raise HTTPException(status_code=422, detail="Say why you reject it.")
    uid, label, tid = current_user_id(request), current_user_label(), str(tenant.id)
    cr = await _load(db, tenant, uuid.UUID(cr_id), lock=True)
    if cr["status"] != "in_approval" or not cr["workflow_instance_id"]:
        raise HTTPException(status_code=409, detail=f"The request is {cr['status']}; there is nothing to decide.")

    def go(s):
        tk = task_id or (workflow.pending_task(s, tid, cr["workflow_instance_id"]) or {}).get("id")
        if not tk:
            raise workflow.WorkflowError(409, "No step of this approval is waiting for a decision.")
        owner = s.execute(text("SELECT instance_id::text FROM workflow_tasks WHERE id = CAST(:k AS uuid) "
                               "AND tenant_id = CAST(:t AS uuid)"), {"k": tk, "t": tid}).scalar()
        if owner != cr["workflow_instance_id"]:
            raise workflow.WorkflowError(404, "Approval step not found on this request.")
        res = workflow.decide(s, tid, tk, uid, label, decision, comment, actions)
        return crs.on_decided(s, tid, cr, res, uid, label, comment, bool(settings.live_writeback_enabled))
    try:
        out = await db.run_sync(go)
    except (crs.RequestError, workflow.WorkflowError) as e:
        await db.rollback()
        raise _err(e)
    await db.commit()
    _queue(tenant, out)
    return await get_request(uuid.UUID(cr_id), db, tenant)


@router.post("/{request_id}/decide", response_model=RequestDetail)
async def decide_request(request_id: uuid.UUID, body: DecideBody, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                         role: str = Depends(require_permission("approve"))) -> RequestDetail:
    """Approve or reject the step waiting (or ``task_id``). A rejection says why."""
    from api.routes.workflows import _caller_actions

    actions = await _caller_actions(request, db, tenant, role)
    return await decide(db, tenant, request, str(request_id), str(body.task_id) if body.task_id else None,
                        body.decision, body.comment, actions)


@router.post("/{request_id}/cancel", response_model=RequestOut)
async def cancel_request(request_id: uuid.UUID, body: CancelBody, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                         role: str = Depends(require_permission("mdm.write"))) -> RequestOut:
    """Withdraw a request not yet in SAP: its requester, or the administrator. Its approval in progress ends."""
    from api.services.rbac import has_permission

    uid, label, tid = _uid(request), current_user_label(), str(tenant.id)
    cr = await _load(db, tenant, request_id, lock=True)
    if cr["requester_id"] != uid and not has_permission(role, "manage_workflows"):
        raise HTTPException(status_code=403, detail="Only the requester or an administrator cancels this request.")
    if cr["status"] not in crs.CANCELLABLE:
        raise HTTPException(status_code=409, detail=f"The request is {cr['status']}; it can no longer be cancelled.")

    def go(s):
        workflow.close(s, tid, crs.KIND, cr["id"], "cancelled", uid, label, body.reason)
        return crs.transition(s, tid, cr, "cancelled", uid, label, body.reason,
                              completed_at=datetime.now(timezone.utc))
    out = await db.run_sync(go)
    await db.commit()
    return RequestOut(**out)


@router.post("/{request_id}/retry", response_model=RequestOut, dependencies=[Depends(require_permission("mdm.write"))])
async def retry_request(request_id: uuid.UUID, body: RetryBody, request: Request,
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> RequestOut:
    """Send a failed request (or one whose worker was never queued) to SAP again. One whose last attempt reached the
    commit is sent again only once someone has checked in SAP that the record is not there."""
    from api.config import settings

    uid, label, tid = _uid(request), current_user_label(), str(tenant.id)
    cr = await _load(db, tenant, request_id, lock=True)
    if cr["status"] not in ("failed", "creating"):
        raise HTTPException(status_code=409, detail=f"The request is {cr['status']}; only a failed request is retried.")
    if not settings.live_writeback_enabled:
        raise HTTPException(status_code=409, detail=crs.LIVE_OFF)
    if cr["sap_phase"] in ("committing", "committed") and not cr["sap_key"] and not body.checked_in_sap:
        raise HTTPException(status_code=409, detail="The last attempt reached the commit; check in SAP that the record "
                                                    "is not there, then retry with checked_in_sap.")
    if cr["status"] == "failed":
        cr = await db.run_sync(lambda s: crs.transition(s, tid, cr, "creating", uid, label, "Retried",
                                                        event="retried", sap_phase=None, completed_at=None))
    else:
        await db.execute(text("UPDATE change_requests SET sap_phase = NULL WHERE id = :i AND tenant_id = :t"),
                         {"i": cr["id"], "t": tid})
    await db.commit()
    _queue(tenant, cr)
    return RequestOut(**await _load(db, tenant, request_id))


@router.post("/{request_id}/comments", dependencies=[Depends(require_permission("mdm.read"))])
async def add_comment(request_id: uuid.UUID, body: CommentBody, request: Request,
                      db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    uid, label, tid = _uid(request), current_user_label(), str(tenant.id)
    cr = await _load(db, tenant, request_id)
    text_ = body.body.strip()
    if not text_:
        raise HTTPException(status_code=422, detail="Write a comment.")
    cid = (await db.execute(text(
        "INSERT INTO change_request_comments (tenant_id, request_id, author_id, author_label, body) VALUES "
        "(:t, :r, CAST(:u AS uuid), :l, :b) RETURNING id::text"),
        {"t": tid, "r": cr["id"], "u": uid, "l": label, "b": text_})).scalar()

    def go(s):
        workflow.event(s, tid, crs.KIND, cr["id"], "commented", actor_id=uid, actor_label=label,
                       detail={"comment_id": cid})
        if cr["requester_id"] and cr["requester_id"] != uid:
            workflow._notify(s, tid, cr["requester_id"], f"Comment on {crs.title_of(cr)}", text_[:500],
                             workflow.link_of(crs.KIND, cr["id"]))
    await db.run_sync(go)
    await db.commit()
    return {"id": cid, "request_id": cr["id"], "author_label": label, "body": text_}


@router.post("/{request_id}/attachments", dependencies=[Depends(require_permission("mdm.write"))])
async def add_attachment(request_id: uuid.UUID, body: AttachmentBody, request: Request,
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """Record a file attached to the request (its metadata; the file itself is stored by the upload service)."""
    uid, label, tid = _uid(request), current_user_label(), str(tenant.id)
    cr = await _load(db, tenant, request_id)
    if cr["status"] in ("created", "cancelled", "rejected"):
        raise HTTPException(status_code=409, detail=f"The request is {cr['status']}; nothing more is attached.")
    aid = (await db.execute(text(
        "INSERT INTO change_request_attachments (tenant_id, request_id, filename, content_type, size_bytes, sha256, "
        "storage_key, uploaded_by, uploaded_by_label) VALUES (:t, :r, :f, :c, :sz, :h, :k, CAST(:u AS uuid), :l) "
        "RETURNING id::text"),
        {"t": tid, "r": cr["id"], "f": body.filename, "c": body.content_type, "sz": body.size_bytes, "h": body.sha256,
         "k": body.storage_key, "u": uid, "l": label})).scalar()
    await db.run_sync(lambda s: workflow.event(s, tid, crs.KIND, cr["id"], "attached", actor_id=uid, actor_label=label,
                                               detail={"attachment_id": aid, "filename": body.filename}))
    await db.commit()
    return {"id": aid, "request_id": cr["id"], "filename": body.filename}


@router.get("", response_model=RequestList)
async def list_requests(
    request: Request,
    view: Literal["mine", "to_approve", "all"] = Query("mine"),
    status: Optional[str] = Query(None, max_length=20),
    object: Optional[Obj] = None,
    kind: Optional[Kind] = None,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("mdm.read")),
) -> RequestList:
    """Mine (I requested), to approve (a step waits for me) or all, newest first, with filters."""
    await _rls(db, tenant)
    uid, tid = current_user_id(request), str(tenant.id)
    where = ["tenant_id = :t"]
    p: dict[str, Any] = {"t": tid, "n": limit}
    if view == "mine":
        where.append("requester_id = CAST(:u AS uuid)")
        p["u"] = uid
    if view == "to_approve":
        where.append("status = 'in_approval'")
    for col, val in (("status", status), ("object", object), ("kind", kind)):
        if val:
            where.append(f"{col} = :{col}")
            p[col] = val
    rows = [dict(r) for r in (await db.execute(text(
        f"SELECT {crs.COLS} FROM change_requests WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT :n"),
        p)).mappings().all()]
    if view == "to_approve":
        from api.routes.workflows import _caller_actions

        actions = await _caller_actions(request, db, tenant, role)

        def mine(s, cr):
            task = workflow.pending_task(s, tid, cr["workflow_instance_id"]) if cr["workflow_instance_id"] else None
            if not task or not uid:
                return False
            inst = {"id": cr["workflow_instance_id"], "requester_id": cr["requester_id"]}
            return workflow.eligibility(s, tid, inst, task, uid, actions)[0]
        rows = [cr for cr in rows if await db.run_sync(lambda s, cr=cr: mine(s, cr))]
    return RequestList(items=[RequestOut(**r) for r in rows])


@router.get("/{request_id}", response_model=RequestDetail, dependencies=[Depends(require_permission("mdm.read"))])
async def get_request(request_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> RequestDetail:
    """The request with its approval (steps, votes), its history, comments and attachments."""
    cr = await _load(db, tenant, request_id)
    tid = str(tenant.id)

    def more(s):
        wf = workflow.view(s, tid, cr["workflow_instance_id"]) if cr["workflow_instance_id"] else None
        hist = workflow.history(s, tid, crs.KIND, cr["id"])
        comments = [dict(r) for r in s.execute(text(
            "SELECT id::text, author_id::text, author_label, body, created_at FROM change_request_comments "
            "WHERE tenant_id = CAST(:t AS uuid) AND request_id = CAST(:r AS uuid) ORDER BY created_at"),
            {"t": tid, "r": cr["id"]}).mappings()]
        files = [dict(r) for r in s.execute(text(
            "SELECT id::text, filename, content_type, size_bytes, sha256, storage_key, uploaded_by_label, created_at "
            "FROM change_request_attachments WHERE tenant_id = CAST(:t AS uuid) AND request_id = CAST(:r AS uuid) "
            "ORDER BY created_at"), {"t": tid, "r": cr["id"]}).mappings()]
        return wf, hist, comments, files
    wf, hist, comments, files = await db.run_sync(more)
    return RequestDetail(request=RequestOut(**cr), workflow=wf, history=hist, comments=comments, attachments=files)


@router.get("/{request_id}/export", dependencies=[Depends(require_permission("mdm.read"))])
async def export_request(request_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> Response:
    """The load file of a request that goes to SAP by file, with the reason it does."""
    await _rls(db, tenant)
    doc = (await db.execute(text("SELECT export FROM change_requests WHERE id = :i AND tenant_id = :t"),
                            {"i": str(request_id), "t": str(tenant.id)})).scalar()
    if doc is None:
        raise HTTPException(status_code=404, detail="This request has no export load file.")
    return Response(content=json.dumps(doc, indent=2, default=str), media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename=change_request_{request_id}.json"})
