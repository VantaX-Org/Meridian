"""Data collection: a steward asks a business owner to supply missing or wrong values, and the owner fills a form.

GET  /api/v1/data-requests/findings   the object's findings a request can cover; required-field-empty rules first
POST /api/v1/data-requests            create a request for chosen findings: one item per failing record and field
GET  /api/v1/data-requests            requests with progress; mine=true lists the signed-in owner's
GET  /api/v1/data-requests/{id}       one request with its form rows (owner or a user who may assign)
POST /api/v1/data-requests/{id}/submit  the owner's values, each checked then queued as a proposal in cleaning_queue

Approval and apply stay in the cleaning queue (POST /cleaning/approve, /cleaning/apply, four-eyes, audited);
progress is read from those proposals. Allowed values come from the rule's own list, else the SAP domain's fixed
values; length from the SAP field. Where neither is known the value is not checked beyond being non-blank.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.cache import mark_work_changed
from api.routes.cleaning import _create_audit
from api.routes.record_issues import _rls
from api.routes.work import _allowed_values, _shipped_rule
from api.services import fix_sheet as fs
from api.services.notifications import create_notification
from api.services.rbac import current_user_id, has_permission, require_permission

router = APIRouter(prefix="/api/v1/data-requests", tags=["data-collection"])

MAX_RECORDS = 500
MAX_ALLOWED_SHOWN = 50
_STATE_SQL = ("CASE WHEN i.queue_id IS NULL THEN 'open' WHEN q.status IN ('detected', 'recommended') THEN 'submitted' "
              "WHEN q.status IN ('approved', 'applied') THEN 'approved' ELSE 'rejected' END")


class FindingOption(BaseModel):
    check_id: str
    field: str
    field_label: Optional[str] = None
    failing: int
    required_empty: bool


class FindingOptions(BaseModel):
    version_id: Optional[str] = None
    module: str
    findings: list[FindingOption]


class CreateBody(BaseModel):
    version_id: Optional[uuid.UUID] = None
    module: str = Field(..., min_length=1, max_length=64)
    check_ids: list[str] = Field(..., min_length=1, max_length=50)
    owner_id: uuid.UUID
    due_date: date
    note: str = Field(..., min_length=1, max_length=2000)
    max_records: int = Field(100, ge=1, le=MAX_RECORDS)


class RequestSummary(BaseModel):
    id: str
    version_id: str
    module: str
    owner_id: str
    owner_name: Optional[str] = None
    due_date: str
    note: str
    created_at: str
    total: int
    open: int
    submitted: int
    approved: int
    rejected: int
    status: Literal["open", "submitted", "approved"]


class AllowedValue(BaseModel):
    value: str
    label: Optional[str] = None


class RequestItem(BaseModel):
    id: str
    check_id: str
    record_key: str
    field: str
    field_label: Optional[str] = None
    current_value: Optional[str] = None
    new_value: Optional[str] = None
    state: Literal["open", "submitted", "approved", "rejected"]
    max_length: Optional[int] = None
    allowed_values: Optional[list[AllowedValue]] = None


class RequestDetail(RequestSummary):
    items: list[RequestItem]


class Value(BaseModel):
    item_id: uuid.UUID
    value: str = Field(..., max_length=500)


class SubmitBody(BaseModel):
    values: list[Value] = Field(..., min_length=1, max_length=MAX_RECORDS)


class ItemError(BaseModel):
    item_id: str
    error: str


class SubmitOut(BaseModel):
    submitted: int
    errors: list[ItemError]


def check_value(value: str, max_length: Optional[int], allowed: Optional[list[dict]]) -> Optional[str]:
    """Why a value cannot be sent, else None: blank, longer than the SAP field, or not one of the allowed values."""
    v = value.strip()
    if not v:
        return "Enter a value"
    if max_length and len(v) > max_length:
        return f"At most {max_length} characters"
    if allowed and v not in {a["value"] for a in allowed}:
        return "Use one of the allowed values"
    return None


def field_rules(field: str, stored, module: str, check_id: str) -> tuple[Optional[int], Optional[list[dict]]]:
    """(max length, allowed values) for a field: the rule's list first, else the SAP domain's fixed values."""
    allowed = _allowed_values(stored, module, check_id, limit=None)
    length = None
    try:
        from sap.ddic import get_dictionary
        f = get_dictionary("ecc6").resolve(field)
    except Exception:  # an unknown dictionary or field only means no extra check
        f = None
    if f is not None:
        length = f.length or None
        fixed = f.allowed_values()
        if allowed is None and fixed:
            texts = {v.low: v.text for v in f.fixed_values}
            allowed = [{"value": v, "label": texts.get(v) or None} for v in sorted(fixed)]
    return length, allowed


def _status(total: int, approved: int, open_: int, rejected: int) -> str:
    if total and approved == total:
        return "approved"
    return "submitted" if total and open_ == 0 and rejected == 0 else "open"


def _summary(r) -> dict:
    return {"id": str(r["id"]), "version_id": str(r["version_id"]), "module": r["module"], "owner_id": str(r["owner_id"]),
            "owner_name": r["owner_name"], "due_date": r["due_date"].isoformat(), "note": r["note"],
            "created_at": r["created_at"].isoformat(), "total": r["total"], "open": r["open"],
            "submitted": r["submitted"], "approved": r["approved"], "rejected": r["rejected"],
            "status": _status(r["total"], r["approved"], r["open"], r["rejected"])}


_LIST = f"""
SELECT r.id, r.version_id, r.module, r.owner_id, r.due_date, r.note, r.created_at, u.name AS owner_name,
       count(i.id)::int AS total,
       (count(*) FILTER (WHERE {_STATE_SQL} = 'open' AND i.id IS NOT NULL))::int AS open,
       (count(*) FILTER (WHERE {_STATE_SQL} = 'submitted'))::int AS submitted,
       (count(*) FILTER (WHERE {_STATE_SQL} = 'approved'))::int AS approved,
       (count(*) FILTER (WHERE {_STATE_SQL} = 'rejected'))::int AS rejected
  FROM data_requests r
  LEFT JOIN users u ON u.id = r.owner_id AND u.tenant_id = r.tenant_id
  LEFT JOIN data_request_items i ON i.request_id = r.id AND i.tenant_id = r.tenant_id
  LEFT JOIN cleaning_queue q ON q.id = i.queue_id AND q.tenant_id = r.tenant_id
 WHERE r.tenant_id = :t AND (CAST(:owner AS uuid) IS NULL OR r.owner_id = CAST(:owner AS uuid))
   AND (CAST(:rid AS uuid) IS NULL OR r.id = CAST(:rid AS uuid))
 GROUP BY r.id, u.name ORDER BY r.due_date, r.created_at DESC LIMIT 200"""


async def _version(db: AsyncSession, tenant: Tenant, version_id: Optional[uuid.UUID], module: str) -> Optional[str]:
    if version_id:
        return str(version_id)
    from api.services.run_context import latest_run
    return await latest_run(db, tenant.id, None, module)


@router.get("/findings", response_model=FindingOptions)
async def request_findings(module: str = Query(..., min_length=1, max_length=64), version_id: Optional[uuid.UUID] = None,
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                           _role: str = Depends(require_permission("assign"))) -> FindingOptions:
    await _rls(db, tenant)
    vid = await _version(db, tenant, version_id, module)
    if vid is None:
        return FindingOptions(version_id=None, module=module, findings=[])
    rows = (await db.execute(text("""
        SELECT check_id, details->>'field_checked' AS field, affected_count FROM findings
         WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m AND finding_type = 'rule'
           AND affected_count > 0 AND details->>'field_checked' IS NOT NULL ORDER BY check_id"""),
        {"t": str(tenant.id), "v": vid, "m": module})).mappings().all()
    out = [FindingOption(check_id=r["check_id"], field=r["field"], field_label=fs.field_label(r["field"]),
                         failing=r["affected_count"],
                         required_empty=(r["check_id"].startswith("FS-") and r["check_id"].endswith("-REQ"))
                         or _shipped_rule(module, r["check_id"]).get("check_class") == "null_check") for r in rows]
    out.sort(key=lambda o: (not o.required_empty, o.check_id))
    return FindingOptions(version_id=vid, module=module, findings=out)


@router.post("", response_model=RequestSummary, status_code=201)
async def create_request(body: CreateBody, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant),
                         _role: str = Depends(require_permission("assign"))) -> RequestSummary:
    await _rls(db, tenant)
    t = str(tenant.id)
    if body.due_date < datetime.now(timezone.utc).date():
        raise HTTPException(status_code=422, detail="The due date is in the past")
    owner = (await db.execute(text("SELECT name, is_active FROM users WHERE id = :u AND tenant_id = :t"),
                              {"u": str(body.owner_id), "t": t})).first()
    if not owner or not owner[1]:
        raise HTTPException(status_code=422, detail="Choose an active user as the owner")
    vid = await _version(db, tenant, body.version_id, body.module)
    if vid is None:
        raise HTTPException(status_code=404, detail="No run for this object")
    rows = (await db.execute(text("""
        SELECT fr.check_id, fr.record_key, fr.field_values, f.details->>'field_checked' AS field
          FROM finding_records fr
          JOIN findings f ON f.tenant_id = fr.tenant_id AND f.version_id = fr.version_id AND f.check_id = fr.check_id
         WHERE fr.tenant_id = :t AND fr.version_id = CAST(:v AS uuid) AND fr.module = :m
           AND fr.check_id = ANY(CAST(:c AS text[])) AND f.details->>'field_checked' IS NOT NULL
         ORDER BY fr.check_id, fr.record_key LIMIT :n"""),
        {"t": t, "v": vid, "m": body.module, "c": body.check_ids, "n": body.max_records})).mappings().all()
    if not rows:
        raise HTTPException(status_code=422, detail="The chosen findings have no failing records with a field")
    rid = str(uuid.uuid4())
    await db.execute(text("""
        INSERT INTO data_requests (id, tenant_id, version_id, module, owner_id, created_by, due_date, note)
        VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:v AS uuid), :m, CAST(:o AS uuid), CAST(:by AS uuid), :due, :note)"""),
        {"id": rid, "t": t, "v": vid, "m": body.module, "o": str(body.owner_id), "by": current_user_id(request),
         "due": body.due_date, "note": body.note})
    seen: set[tuple[str, str]] = set()
    items = []
    for r in rows:
        key = (r["record_key"], r["field"])
        if key in seen:
            continue
        seen.add(key)
        fv = r["field_values"] or {}
        cur = fv[r["field"]] if r["field"] in fv else fv.get(r["field"].rpartition(".")[2])
        items.append({"id": str(uuid.uuid4()), "t": t, "r": rid, "c": r["check_id"], "k": r["record_key"],
                      "f": r["field"], "cur": None if cur is None else str(cur)})
    await db.execute(text("""
        INSERT INTO data_request_items (id, tenant_id, request_id, check_id, record_key, field, current_value)
        VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:r AS uuid), :c, :k, :f, :cur)"""), items)
    await create_notification(t, str(body.owner_id), "assignment", f"Data request: {body.module}",
                              body.note[:200], "/data-requests", db)
    await db.commit()
    head = (await db.execute(text(_LIST), {"t": t, "owner": None, "rid": rid})).mappings().first()
    return RequestSummary(**_summary(head))


@router.get("", response_model=list[RequestSummary])
async def list_requests(request: Request, mine: bool = False, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant),
                        role: str = Depends(require_permission("view"))) -> list[RequestSummary]:
    if not mine and not has_permission(role, "assign"):
        raise HTTPException(status_code=403, detail="Only a steward sees every request")
    await _rls(db, tenant)
    owner = current_user_id(request) if mine else None
    if mine and not owner:
        return []
    rows = (await db.execute(text(_LIST), {"t": str(tenant.id), "owner": owner, "rid": None})).mappings().all()
    return [RequestSummary(**_summary(r)) for r in rows]


async def _load(db: AsyncSession, tenant: Tenant, request: Request, role: str, rid: uuid.UUID) -> RequestDetail:
    await _rls(db, tenant)
    t = str(tenant.id)
    head = (await db.execute(text(_LIST), {"t": t, "owner": None, "rid": str(rid)})).mappings().first()
    if head is None:
        raise HTTPException(status_code=404, detail="No such request")
    if str(head["owner_id"]) != str(current_user_id(request)) and not has_permission(role, "assign"):
        raise HTTPException(status_code=403, detail="This request belongs to another owner")
    rows = (await db.execute(text(f"""
        SELECT i.id, i.check_id, i.record_key, i.field, i.current_value, i.new_value, {_STATE_SQL} AS state,
               COALESCE(NULLIF(f.rule_context->'valid_values_with_labels', 'null'::jsonb),
                        NULLIF(f.rule_context->'valid_values', 'null'::jsonb)) AS valid_values
          FROM data_request_items i
          LEFT JOIN cleaning_queue q ON q.id = i.queue_id AND q.tenant_id = i.tenant_id
          LEFT JOIN findings f ON f.tenant_id = i.tenant_id AND f.version_id = CAST(:v AS uuid) AND f.check_id = i.check_id
         WHERE i.tenant_id = :t AND i.request_id = CAST(:r AS uuid) ORDER BY i.check_id, i.record_key"""),
        {"t": t, "v": str(head["version_id"]), "r": str(rid)})).mappings().all()
    items = []
    for r in rows:
        length, allowed = field_rules(r["field"], r["valid_values"], head["module"], r["check_id"])
        items.append(RequestItem(
            id=str(r["id"]), check_id=r["check_id"], record_key=r["record_key"], field=r["field"],
            field_label=fs.field_label(r["field"]), current_value=r["current_value"], new_value=r["new_value"],
            state=r["state"], max_length=length,
            allowed_values=[AllowedValue(**a) for a in allowed[:MAX_ALLOWED_SHOWN]] if allowed else None))
    return RequestDetail(**_summary(head), items=items)


@router.get("/{request_id}", response_model=RequestDetail)
async def get_request(request_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant),
                      role: str = Depends(require_permission("view"))) -> RequestDetail:
    return await _load(db, tenant, request, role, request_id)


@router.post("/{request_id}/submit", response_model=SubmitOut)
async def submit_values(request_id: uuid.UUID, body: SubmitBody, request: Request, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant),
                        role: str = Depends(require_permission("view"))) -> SubmitOut:
    """The owner's values become cleaning_queue proposals (status detected) for a steward to approve and apply."""
    detail = await _load(db, tenant, request, role, request_id)
    if str(detail.owner_id) != str(current_user_id(request)):
        raise HTTPException(status_code=403, detail="Only the owner fills this request")
    t = str(tenant.id)
    by_id = {i.id: i for i in detail.items}
    errors: list[ItemError] = []
    done = 0
    for v in body.values:
        item = by_id.get(str(v.item_id))
        if item is None:
            errors.append(ItemError(item_id=str(v.item_id), error="Not part of this request"))
            continue
        if item.state in ("submitted", "approved"):
            errors.append(ItemError(item_id=item.id, error="Already submitted"))
            continue
        allowed = [a.model_dump() for a in item.allowed_values] if item.allowed_values else None
        why = check_value(v.value, item.max_length, allowed)
        if why:
            errors.append(ItemError(item_id=item.id, error=why))
            continue
        value = v.value.strip()
        qid = str(uuid.uuid4())
        before, after = {item.field: item.current_value}, {item.field: value}
        await db.execute(text("""
            INSERT INTO cleaning_queue (id, tenant_id, object_type, record_key, status, priority, record_data_before,
                record_data_after, version_id, check_id, field)
            VALUES (CAST(:id AS uuid), CAST(:t AS uuid), :obj, :k, 'detected', 50, CAST(:b AS jsonb), CAST(:a AS jsonb),
                CAST(:v AS uuid), :c, :f)"""),
            {"id": qid, "t": t, "obj": detail.module, "k": item.record_key, "b": json.dumps(before),
             "a": json.dumps(after), "v": detail.version_id, "c": item.check_id, "f": item.field})
        await db.execute(text("""
            UPDATE data_request_items SET new_value = :n, queue_id = CAST(:q AS uuid), submitted_at = now()
             WHERE id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid)"""),
            {"n": value, "q": qid, "i": item.id, "t": t})
        await _create_audit(db, tenant.id, qid, "proposed", item.record_key, detail.module,
                            data_before=before, data_after=after,
                            metadata={"source": "data_request", "request_id": str(request_id)})
        done += 1
    if done:
        creator = (await db.execute(text("SELECT created_by FROM data_requests WHERE id = CAST(:r AS uuid) AND tenant_id = :t"),
                                    {"r": str(request_id), "t": t})).scalar()
        if creator:
            await create_notification(t, str(creator), "assignment", f"Values sent for {detail.module}",
                                      f"{done} value(s) wait for your approval", "/data-requests", db)
        mark_work_changed(db, tenant.id)
    await db.commit()
    return SubmitOut(submitted=done, errors=errors)
