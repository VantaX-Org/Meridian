"""Remediation batches — fix files for a human-controlled SAP load.

draft (steward edits proposed values; a second person may bulk-accept the
high-confidence auto_fix proposals) → approved (a second person) → exported
(Migration Cockpit staging XLSX/CSV or a generic LSMW / mass-change CSV).
Meridian never posts to SAP; see api/services/remediation.py.
"""

import io
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _row, _rls, _where
from api.services import remediation
from api.services.rbac import current_user_id, current_user_label, require_permission

router = APIRouter(prefix="/api/v1/remediation", tags=["remediation"])

MAX_ITEMS = 50_000


class BatchFilter(BaseModel):
    status: Optional[str] = None
    module: Optional[str] = None
    check_id: Optional[str] = None
    severity: Optional[str] = None
    assigned_to: Optional[str] = None
    scope: Optional[str] = None
    search: Optional[str] = None
    version_id: Optional[uuid.UUID] = None
    issue_ids: Optional[list[uuid.UUID]] = Field(None, max_length=MAX_ITEMS)


class BatchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    filter: BatchFilter = BatchFilter()


class ItemUpdate(BaseModel):
    proposed_value: Optional[str] = Field(None, max_length=4000)  # None = back to manual


async def _batch(db: AsyncSession, tenant: Tenant, batch_id: uuid.UUID) -> dict:
    await _rls(db, tenant)
    row = (await db.execute(text("SELECT * FROM remediation_batches WHERE id = :id AND tenant_id = :tid"),
                            {"id": batch_id, "tid": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _row(row)


async def _items(db: AsyncSession, batch_id) -> list[dict]:
    rows = await db.execute(text("SELECT * FROM remediation_items WHERE batch_id = :id "
                                 "ORDER BY module, check_id, record_key"), {"id": batch_id})
    return [{**(i := _row(r)), "auto_approvable": _auto_approvable(i)} for r in rows.fetchall()]


_auto_approvable = remediation.auto_approvable


async def _event(db, tenant, batch_id, action, request, item_ids=None, to_value=None):
    """One audit row per item (or one batch-level row when no items given)."""
    p = {"tid": str(tenant.id), "bid": str(batch_id), "action": action, "to": to_value,
         "uid": current_user_id(request), "label": current_user_label()}
    if item_ids is None:
        await db.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, "
                              "action, to_value) SELECT :tid, :bid, id, CAST(:uid AS uuid), :label, :action, :to "
                              "FROM remediation_items WHERE batch_id = :bid"), p)
    for iid in item_ids or ():
        await db.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, "
                              "action, to_value) VALUES (:tid, :bid, :iid, CAST(:uid AS uuid), :label, :action, :to)"),
                         {**p, "iid": str(iid)})


@router.post("/batches")
async def create_batch(
    body: BatchCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply")),
):
    """Batch from a filtered set of open record issues (same filters as the work list)."""
    f = body.filter
    await _rls(db, tenant)
    where, p = _where(f.status, f.module, f.check_id, f.severity, f.assigned_to, f.scope, f.search, request,
                      f.version_id)
    if f.issue_ids:
        where += " AND ri.id = ANY(:ids)"
        p["ids"] = [str(i) for i in f.issue_ids]
    rows = (await db.execute(text(f"""
        SELECT ri.id AS issue_id, ri.scope, ri.module, ri.check_id, ri.record_key, ri.grain,
               ri.last_seen_version, f.details->>'field_checked' AS field
          FROM record_issues ri
          LEFT JOIN findings f ON f.version_id = ri.last_seen_version AND f.check_id = ri.check_id
         WHERE {where} AND ri.status IN ('open', 'in_progress')
         LIMIT {MAX_ITEMS + 1}"""), p)).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="No open issues match this filter.")
    if len(rows) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"More than {MAX_ITEMS} records; narrow the filter.")

    issues = [dict(r._mapping) for r in rows]
    uid, label = current_user_id(request), current_user_label()
    out = await db.run_sync(lambda s: remediation.draft_batch(s, str(tenant.id), body.name, f.model_dump_json(),
                                                              issues, uid, label))
    await db.commit()
    return out


@router.get("/batches")
async def list_batches(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    rows = await db.execute(text("""
        SELECT b.*, COUNT(i.id) AS items,
               COUNT(i.id) FILTER (WHERE i.proposed_value IS NOT NULL) AS with_proposal,
               COUNT(i.id) FILTER (WHERE i.proposal_source = 'rule' AND i.confidence = 'high') AS auto_approvable,
               COUNT(i.id) FILTER (WHERE i.recon_status = 'fixed') AS fixed,
               COUNT(i.id) FILTER (WHERE i.recon_status = 'still_failing') AS still_failing
          FROM remediation_batches b LEFT JOIN remediation_items i ON i.batch_id = b.id
         WHERE b.tenant_id = :tid GROUP BY b.id ORDER BY b.created_at DESC
    """), {"tid": str(tenant.id)})
    return {"items": [_row(r) for r in rows.fetchall()]}


@router.get("/monitor")
async def monitor_status(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """Per system with a pinned baseline: its newest run compared with that baseline."""
    from api.services import monitor
    await _rls(db, tenant)
    return {"items": await db.run_sync(lambda s: monitor.status(s))}


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    return {"batch": await _batch(db, tenant, batch_id), "items": await _items(db, batch_id)}


@router.get("/batches/{batch_id}/events")
async def batch_events(
    batch_id: uuid.UUID,
    item_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """Per-record audit trail (all items, or one)."""
    await _batch(db, tenant, batch_id)
    rows = await db.execute(text(
        "SELECT item_id, action, from_value, to_value, user_label, version_id, created_at FROM remediation_events "
        "WHERE batch_id = :bid AND (CAST(:iid AS uuid) IS NULL OR item_id = CAST(:iid AS uuid)) ORDER BY created_at"),
        {"bid": batch_id, "iid": str(item_id) if item_id else None})
    return {"items": [_row(r) for r in rows.fetchall()]}


@router.patch("/batches/{batch_id}/items/{item_id}")
async def update_item(
    batch_id: uuid.UUID,
    item_id: uuid.UUID,
    body: ItemUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply")),
):
    """Steward enters (or clears) the proposed value. Draft batches only."""
    if (await _batch(db, tenant, batch_id))["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only draft batches can be edited.")
    old = (await db.execute(text("SELECT proposed_value FROM remediation_items WHERE id = :id AND batch_id = :bid"),
                            {"id": item_id, "bid": batch_id})).fetchone()
    if not old:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.execute(text("UPDATE remediation_items SET proposed_value = :v, proposal_source = :src, "
                          "confidence = NULL, accepted = false, updated_at = now() WHERE id = :id"),
                     {"v": body.proposed_value, "id": item_id,
                      "src": "manual" if body.proposed_value is None else "steward"})
    await db.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, action, "
                          "from_value, to_value) VALUES (:tid, :bid, :iid, CAST(:uid AS uuid), :label, 'proposed', "
                          ":old, :new)"),
                     {"tid": str(tenant.id), "bid": batch_id, "iid": item_id, "uid": current_user_id(request),
                      "label": current_user_label(), "old": old[0], "new": body.proposed_value})
    await db.commit()
    return {"id": str(item_id), "proposed_value": body.proposed_value}


@router.post("/batches/{batch_id}/accept-high-confidence")
async def accept_high_confidence(
    batch_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("approve")),
):
    """Accept every high-confidence rule proposal in a draft batch. Four eyes: not the batch creator."""
    b = await _batch(db, tenant, batch_id)
    if b["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Batch is already {b['status']}.")
    uid = current_user_id(request)
    if b["created_by"] and uid == b["created_by"]:
        raise HTTPException(status_code=403, detail="The batch creator cannot accept its proposals.")
    ids = [r[0] for r in (await db.execute(text(
        "UPDATE remediation_items SET accepted = true, updated_at = now() WHERE batch_id = :bid "
        "AND proposal_source = 'rule' AND confidence = 'high' AND proposed_value IS NOT NULL AND NOT accepted "
        "RETURNING id"), {"bid": batch_id})).fetchall()]
    await _event(db, tenant, batch_id, "accepted", request, item_ids=ids)
    await db.commit()
    return {"id": str(batch_id), "accepted": len(ids), "accepted_by": current_user_label()}


@router.post("/batches/{batch_id}/approve")
async def approve_batch(
    batch_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("approve")),
):
    """Four eyes: the approver must not be the person who built the batch."""
    b = await _batch(db, tenant, batch_id)
    if b["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Batch is already {b['status']}.")
    uid = current_user_id(request)
    if b["created_by"] and uid == b["created_by"]:
        raise HTTPException(status_code=403, detail="The batch creator cannot approve it.")
    if not b["created_by"] and uid and (await db.execute(text(
            "SELECT 1 FROM remediation_events WHERE batch_id = :bid AND action = 'accepted' "
            "AND user_id = CAST(:uid AS uuid) LIMIT 1"), {"bid": batch_id, "uid": uid})).first():
        # a monitor-drafted batch has no human creator: whoever accepted its proposals is the first pair of eyes
        raise HTTPException(status_code=403, detail="You accepted this batch's proposals; a second person must approve it.")
    await db.execute(text("UPDATE remediation_batches SET status = 'approved', approved_by = CAST(:uid AS uuid), "
                          "approved_by_label = :label, approved_at = now() WHERE id = :id"),
                     {"uid": uid, "label": current_user_label(), "id": batch_id})
    await _event(db, tenant, batch_id, "approved", request)
    await db.commit()
    return {"id": str(batch_id), "status": "approved", "approved_by": current_user_label()}


_MEDIA = {"csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


@router.post("/batches/{batch_id}/export")
async def export_batch(
    batch_id: uuid.UUID,
    request: Request,
    format: Literal["cockpit_xlsx", "cockpit_csv", "mass_change_csv"] = Query("cockpit_xlsx"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("export")),
):
    """Approved batch as a load file. Items without a proposed value are left out."""
    b = await _batch(db, tenant, batch_id)
    if b["status"] == "draft":
        raise HTTPException(status_code=409, detail="Approve the batch before exporting it.")
    items = await _items(db, batch_id)
    if format == "mass_change_csv":
        data, ext = remediation.mass_change(items).to_csv(index=False).encode(), "csv"
    else:
        from sap.ddic import get_dictionary
        d = get_dictionary("s4hana")
        if format == "cockpit_csv":
            data, ext = remediation.cockpit_csv(items, d).to_csv(index=False).encode(), "csv"
        else:
            buf = io.BytesIO()
            import pandas as pd
            with pd.ExcelWriter(buf, engine="openpyxl") as xw:
                sheets = remediation.cockpit_sheets(items, d) or {"EMPTY": pd.DataFrame()}
                for table, df in sheets.items():
                    df.to_excel(xw, sheet_name=table[:31], index=False)
                    for row in xw.sheets[table[:31]].iter_rows():
                        for cell in row:
                            if cell.data_type == "f":  # SAP values like "=A" stay text, never a formula
                                cell.data_type = "s"
            data, ext = buf.getvalue(), "xlsx"
    await db.execute(text("UPDATE remediation_batches SET status = 'exported', exported_at = now() WHERE id = :id"),
                     {"id": batch_id})
    await _event(db, tenant, batch_id, "exported", request, to_value=format)
    await db.commit()
    return StreamingResponse(io.BytesIO(data), media_type=_MEDIA[ext], headers={
        "Content-Disposition": f"attachment; filename=remediation_{batch_id}_{format}.{ext}"})
