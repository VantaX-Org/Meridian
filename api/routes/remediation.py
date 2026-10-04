"""Remediation batches — fix files for a human-controlled SAP load.

draft (steward edits proposed values) → approved (a second person) → exported
(Migration Cockpit staging XLSX/CSV or a generic LSMW / mass-change CSV).
Meridian never posts to SAP; see api/services/remediation.py.
"""

import io
import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
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
    return [_row(r) for r in rows.fetchall()]


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

    # current values come from each issue's latest extraction, read locally
    from api.services.source_design import dictionary_for
    from workers.dataset import load_dataset
    issues = [dict(r._mapping) for r in rows]
    items = []
    for vid in {i["last_seen_version"] for i in issues}:
        group = [i for i in issues if i["last_seen_version"] == vid]
        meta = (await db.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                                 {"v": vid})).scalar() or {}
        frames = None
        if meta.get("dataset_path"):
            dictionary = await db.run_sync(lambda s: dictionary_for(s, meta.get("system_id")))
            fields = {i["field"] for i in group if i["field"]}
            try:
                # ponytail: loads the version's dataset per request; move to a worker task if batches get slow
                frames = (await run_in_threadpool(load_dataset, meta["dataset_path"], dictionary,
                                                  sorted({i["module"] for i in group}), fields))[0]
            except Exception:
                frames = None  # dataset gone: current values stay blank
        items += remediation.build_items(group, frames)

    batch_id = uuid.uuid4()
    await db.execute(text("""
        INSERT INTO remediation_batches (id, tenant_id, name, filter, created_by, created_by_label)
        VALUES (:id, :tid, :name, CAST(:filter AS jsonb), CAST(:uid AS uuid), :label)
    """), {"id": batch_id, "tid": str(tenant.id), "name": body.name, "filter": f.model_dump_json(),
           "uid": current_user_id(request), "label": current_user_label()})
    for chunk in range(0, len(items), 1000):
        await db.execute(text("""
            INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key,
                                           grain, field, current_value, proposed_value, proposal_source)
            SELECT :tid, :bid, (x->>'issue_id')::uuid, x->>'scope', x->>'module', x->>'check_id', x->>'record_key',
                   x->>'grain', x->>'field', x->>'current_value', x->>'proposed_value', x->>'proposal_source'
              FROM jsonb_array_elements(CAST(:items AS jsonb)) x
            ON CONFLICT DO NOTHING
        """), {"tid": str(tenant.id), "bid": batch_id,
               "items": json.dumps(items[chunk:chunk + 1000], default=str)})
    await _event(db, tenant, batch_id, "created", request)
    await db.commit()
    return {"id": str(batch_id), "status": "draft", "items": len(items),
            "with_proposal": sum(1 for i in items if i["proposed_value"] is not None)}


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
               COUNT(i.id) FILTER (WHERE i.recon_status = 'fixed') AS fixed,
               COUNT(i.id) FILTER (WHERE i.recon_status = 'still_failing') AS still_failing
          FROM remediation_batches b LEFT JOIN remediation_items i ON i.batch_id = b.id
         WHERE b.tenant_id = :tid GROUP BY b.id ORDER BY b.created_at DESC
    """), {"tid": str(tenant.id)})
    return {"items": [_row(r) for r in rows.fetchall()]}


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
                          "updated_at = now() WHERE id = :id"),
                     {"v": body.proposed_value, "id": item_id,
                      "src": "manual" if body.proposed_value is None else "steward"})
    await db.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, action, "
                          "from_value, to_value) VALUES (:tid, :bid, :iid, CAST(:uid AS uuid), :label, 'proposed', "
                          ":old, :new)"),
                     {"tid": str(tenant.id), "bid": batch_id, "iid": item_id, "uid": current_user_id(request),
                      "label": current_user_label(), "old": old[0], "new": body.proposed_value})
    await db.commit()
    return {"id": str(item_id), "proposed_value": body.proposed_value}


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
