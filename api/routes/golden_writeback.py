"""Golden-record write-back to SAP: preview, simulate, request approval, approve/reject, status.

  GET  /master-records/{id}/writeback/preview                 target systems + per-field support (view)
  GET  /master-records/{id}/writeback/requests                this record's requests, newest first (view)
  POST /master-records/{id}/writeback/requests                start one: simulate first (apply)
  POST /master-records/{id}/writeback/requests/{rid}/submit   simulated -> waiting for approval (apply)
  POST /master-records/{id}/writeback/approve | /reject       four-eyes decision (approve)

The approval is also an inbox task (stewardship_queue item_type 'golden_writeback', source_id =
the golden record); resolving it there calls the same decision (api/routes/stewardship.py).
The worker (workers/tasks/run_golden_writeback.py) does every SAP read and write.
"""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.writeback import _require_user
from api.services import golden_writeback as gw
from api.services.rbac import require_permission, scope_from_path

router = APIRouter(prefix="/api/v1", tags=["master-records"])
logger = logging.getLogger("meridian.golden_writeback")


def _uuid_or_404(value: str, what: str) -> str:
    """A malformed id names nothing: 404, not a 500 from the uuid cast in Postgres."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found") from None


async def _record(db: AsyncSession, tenant_id: str, record_id: str) -> dict:
    record_id = _uuid_or_404(record_id, "Master record")
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tenant_id})
    row = (await db.execute(text(
        "SELECT id, domain, sap_object_key, golden_fields, source_contributions, status "
        "FROM master_records WHERE id = :id AND tenant_id = :t"), {"id": record_id, "t": tenant_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Master record not found")
    return {"id": str(row[0]), "domain": row[1], "sap_object_key": row[2], "golden_fields": row[3] or {},
            "source_contributions": row[4] or {}, "status": row[5]}


@router.get("/master-records/{record_id}/writeback/preview")
async def writeback_preview(
    record_id: str,
    role: str = Depends(require_permission("view", scope=scope_from_path)),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """Target systems (by source system), which fields each can take and how. Never contacts SAP."""
    rec = await _record(db, str(tenant.id), record_id)
    return await gw.build_preview(db, str(tenant.id), rec)


@router.get("/master-records/{record_id}/writeback/requests")
async def list_writeback_requests(
    record_id: str,
    role: str = Depends(require_permission("view", scope=scope_from_path)),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    await _record(db, str(tenant.id), record_id)
    rows = (await db.execute(text(
        f"SELECT {gw.REQUEST_COLUMNS} FROM golden_writeback_requests WHERE tenant_id = :t AND master_record_id = :r "
        "ORDER BY created_at DESC LIMIT 10"), {"t": str(tenant.id), "r": record_id})).fetchall()
    return {"requests": [gw.request_out(r) for r in rows]}


@router.post("/master-records/{record_id}/writeback/requests", status_code=202)
async def create_writeback_request(
    record_id: str,
    request: Request,
    role: str = Depends(require_permission("apply", scope=scope_from_path)),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """Start a write-back: plan the targets now, simulate (read and diff) in the worker."""
    tid = str(tenant.id)
    user = _require_user(request)
    rec = await _record(db, tid, record_id)
    if rec["status"] != "golden":
        raise HTTPException(status_code=400, detail="Only golden records can be written back — promote first")
    preview = await gw.build_preview(db, tid, rec)
    if not preview["writeback_supported"]:
        raise HTTPException(status_code=422, detail=preview["message"])
    busy = (await db.execute(text(
        "SELECT status FROM golden_writeback_requests WHERE tenant_id = :t AND master_record_id = :r "
        "AND status IN ('pending_approval', 'approved', 'applying') LIMIT 1"), {"t": tid, "r": record_id})).scalar()
    if busy:
        raise HTTPException(status_code=409, detail=f"A write-back of this record is already {busy.replace('_', ' ')}.")
    # An earlier simulation that was never submitted is superseded by this one.
    await db.execute(text(
        "UPDATE golden_writeback_requests SET status = 'cancelled', updated_at = now() WHERE tenant_id = :t "
        "AND master_record_id = :r AND status IN ('simulating', 'simulated', 'simulation_failed')"),
        {"t": tid, "r": record_id})
    row = (await db.execute(text(
        "INSERT INTO golden_writeback_requests (tenant_id, master_record_id, status, requested_by, golden_snapshot, "
        f"targets) VALUES (:t, :r, 'simulating', :u, CAST(:g AS jsonb), CAST(:tg AS jsonb)) RETURNING {gw.REQUEST_COLUMNS}"),
        {"t": tid, "r": record_id, "u": user, "g": json.dumps(rec["golden_fields"], default=str),
         "tg": json.dumps(preview["targets"], default=str)})).fetchone()
    await gw.audit(db, tid, user, "golden_writeback.requested", str(row[0]),
                   {"master_record_id": record_id, "targets": [t["system_id"] for t in preview["targets"]]},
                   request.url.path)
    await db.commit()
    gw.enqueue(str(row[0]), tid, "simulate")
    return gw.request_out(row)


@router.post("/master-records/{record_id}/writeback/requests/{request_id}/submit")
async def submit_writeback_request(
    record_id: str,
    request_id: str,
    request: Request,
    role: str = Depends(require_permission("apply", scope=scope_from_path)),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """Send a simulated write-back for approval: an inbox task for a second person."""
    tid = str(tenant.id)
    user = _require_user(request)
    rec = await _record(db, tid, record_id)
    request_id = _uuid_or_404(request_id, "Write-back request")
    row = (await db.execute(text(
        f"SELECT {gw.REQUEST_COLUMNS} FROM golden_writeback_requests WHERE id = :id AND tenant_id = :t "
        "AND master_record_id = :r FOR UPDATE"), {"id": request_id, "t": tid, "r": record_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Write-back request not found")
    if row[2] != "simulated":
        raise HTTPException(status_code=409, detail=f"This write-back is {row[2].replace('_', ' ')}, not simulated.")
    if row[3] != user:
        raise HTTPException(status_code=403, detail="Only the user who simulated this write-back can submit it")
    if not gw.summarise(row[6] or []).get("would_change"):
        raise HTTPException(status_code=409, detail="The simulation found nothing to change in SAP.")
    busy = (await db.execute(text(
        "SELECT status FROM golden_writeback_requests WHERE tenant_id = :t AND master_record_id = :r AND id <> :id "
        "AND status IN ('pending_approval', 'approved', 'applying') LIMIT 1"),
        {"t": tid, "r": record_id, "id": request_id})).scalar()
    if busy:
        raise HTTPException(status_code=409, detail=f"A write-back of this record is already {busy.replace('_', ' ')}.")
    try:
        await db.execute(text(
            "UPDATE golden_writeback_requests SET status = 'pending_approval', updated_at = now() "
            "WHERE id = :id AND tenant_id = :t AND status = 'simulated'"), {"id": request_id, "t": tid})
    except IntegrityError:  # a concurrent submit won the one open slot (uq_golden_writeback_open)
        await db.rollback()
        raise HTTPException(status_code=409, detail="A write-back of this record is already waiting or running.") \
            from None
    await db.execute(text(
        "INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, status, sla_hours, due_at) "
        "VALUES (gen_random_uuid(), :t, 'golden_writeback', :r, :d, 2, 'open', 24, now() + interval '24 hours')"),
        {"t": tid, "r": record_id, "d": rec["domain"]})
    await gw.audit(db, tid, user, "golden_writeback.submitted", request_id, {"master_record_id": record_id},
                   request.url.path)
    await db.commit()
    row = (await db.execute(text(
        f"SELECT {gw.REQUEST_COLUMNS} FROM golden_writeback_requests WHERE id = :id AND tenant_id = :t"),
        {"id": request_id, "t": tid})).fetchone()
    return gw.request_out(row)


async def _decide(record_id: str, action: str, request: Request, db: AsyncSession, tenant: Tenant) -> dict:
    tid = str(tenant.id)
    user = _require_user(request)
    await _record(db, tid, record_id)
    try:
        rid = await gw.decide(db, tid, record_id, action, user)
    except gw.DecisionError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detail) from None
    await db.commit()
    if action == "approve":
        gw.enqueue(rid, tid, "apply")
    row = (await db.execute(text(
        f"SELECT {gw.REQUEST_COLUMNS} FROM golden_writeback_requests WHERE id = :id AND tenant_id = :t"),
        {"id": rid, "t": tid})).fetchone()
    return gw.request_out(row)


@router.post("/master-records/{record_id}/writeback/approve")
async def approve_writeback_request(
    record_id: str,
    request: Request,
    role: str = Depends(require_permission("approve", scope=scope_from_path)),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    """Second person approves: the worker then writes the approved changes to SAP."""
    return await _decide(record_id, "approve", request, db, tenant)


@router.post("/master-records/{record_id}/writeback/reject")
async def reject_writeback_request(
    record_id: str,
    request: Request,
    role: str = Depends(require_permission("approve", scope=scope_from_path)),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> dict:
    return await _decide(record_id, "reject", request, db, tenant)
