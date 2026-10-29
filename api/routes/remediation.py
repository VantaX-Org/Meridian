"""Remediation batches — fix files for a human-controlled SAP load.

draft (steward edits proposed values; a second person may bulk-accept the
high-confidence auto_fix proposals) → approved (a second person) → exported
(Migration Cockpit staging XLSX/CSV or a generic LSMW / mass-change CSV).
Meridian never posts to SAP; see api/services/remediation.py.
"""

import hashlib
import io
import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _row, _rls, _where
from api.services import attention, remediation, undo, worklist
from api.services.rbac import current_user_id, current_user_label, require_permission, scope_from_path

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
    # The records a steward ticked in the workbench: the batch holds only those.
    record_keys: Optional[list[str]] = Field(None, max_length=MAX_ITEMS)


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


_SEV_NAME = {0: "critical", 1: "high", 2: "medium", 3: "low"}  # work_records.sev_rank

_EXTRAS_SQL = """
    WITH recs AS (SELECT DISTINCT i.batch_id, i.scope, i.module, i.record_key FROM remediation_items i
                   WHERE i.tenant_id = CAST(:t AS uuid) AND i.batch_id = ANY(CAST(:ids AS uuid[]))),
         latest AS (SELECT DISTINCT ON (r.batch_id, r.scope, r.module, r.record_key)
                           r.batch_id, w.version_id, w.checks, w.sev_rank
                      FROM recs r
                      JOIN work_records w ON w.tenant_id = CAST(:t AS uuid) AND w.scope = r.scope AND w.module = r.module
                                         AND w.record_key = r.record_key
                      JOIN analysis_versions v ON v.id = w.version_id
                     ORDER BY r.batch_id, r.scope, r.module, r.record_key, v.run_at DESC, w.version_id)
    SELECT b.id::text AS id,
           (SELECT count(*) FROM recs r WHERE r.batch_id = b.id) AS records,
           (SELECT min(l.sev_rank) FROM latest l WHERE l.batch_id = b.id) AS top_rank,
           (SELECT array_agg(DISTINCT r.module) FROM recs r WHERE r.batch_id = b.id) AS modules,
           (SELECT sum(x.per) FROM latest l CROSS JOIN LATERAL (
                SELECT sum(f.cost_at_risk / f.affected_count) AS per
                  FROM unnest(l.checks) c
                  JOIN findings f ON f.tenant_id = CAST(:t AS uuid) AND f.version_id = l.version_id AND f.check_id = c
                 WHERE f.cost_at_risk IS NOT NULL AND f.affected_count > 0) x
             WHERE l.batch_id = b.id) AS value_at_risk,
           COALESCE(NULLIF(u.name, ''), b.created_by_label) AS steward_label
      FROM remediation_batches b LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
     WHERE b.tenant_id = CAST(:t AS uuid) AND b.id = ANY(CAST(:ids AS uuid[]))"""


async def _batch_extras(db: AsyncSession, tenant: Tenant, batches: list[dict]) -> dict[str, dict]:
    """Per batch (one read for all of them, no query per batch): ``records`` (distinct records with an item),
    ``value_at_risk`` (each record's attribution as the work API sums it: every failing check's cost at risk shared over
    the records it fails on, read from the record's latest work row; None when no check is priced), ``steward_label``
    (the creator's display name) and ``due_at`` (the batch's creation time plus the SLA policy of its highest severity,
    in business hours when the policy says so; None without a policy or a severity)."""
    if not batches:
        return {}
    from datetime import datetime

    from api.services import triage
    t = str(tenant.id)
    rows = {r["id"]: r for r in (await db.execute(text(_EXTRAS_SQL), {"t": t, "ids": [str(b["id"]) for b in batches]})).mappings().all()}
    pols = (await db.execute(text("SELECT severity, module, resolve_minutes, business_hours, at_risk_pct, ack_minutes FROM sla_policies "
                                  "WHERE tenant_id = CAST(:t AS uuid)"), {"t": t})).mappings().all()
    cal = None
    if any(p["business_hours"] for p in pols):
        st = (await db.execute(text("SELECT timezone, work_days, work_start, work_end, holidays FROM triage_settings "
                                    "WHERE tenant_id = CAST(:t AS uuid)"), {"t": t})).first()
        cal = triage.Calendar(st.timezone, tuple(st.work_days), st.work_start, st.work_end, frozenset(st.holidays)) if st \
            else triage.Calendar()
    out: dict[str, dict] = {}
    for b in batches:
        r = rows.get(str(b["id"]))
        sev = _SEV_NAME.get(r["top_rank"]) if r and r["top_rank"] is not None else None
        mods = set(r["modules"] or []) if r else set()
        fits = [p for p in pols if p["severity"] == sev and (p["module"] is None or p["module"] in mods)]
        pol = min(fits, key=lambda p: p["resolve_minutes"]) if fits else None
        created = b.get("created_at")
        if isinstance(created, str):
            created = datetime.fromisoformat(created)
        due = triage.deadlines(created, dict(pol), cal)["due_at"] if pol and created else None
        out[str(b["id"])] = {
            "records": int(r["records"]) if r else 0,
            "value_at_risk": round(float(r["value_at_risk"]), 2) if r and r["value_at_risk"] is not None else None,
            "due_at": due.isoformat() if due else None,
            "steward_label": r["steward_label"] if r else b.get("created_by_label"),
        }
    return out


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
    _perm: str = Depends(require_permission("apply", scope=scope_from_path)),
):
    """Batch from a filtered set of open record issues (same filters as the work list)."""
    f = body.filter
    await _rls(db, tenant)
    where, p = _where(f.status, f.module, f.check_id, f.severity, f.assigned_to, f.scope, f.search, request,
                      f.version_id)
    if f.issue_ids:
        where += " AND ri.id = ANY(:ids)"
        p["ids"] = [str(i) for i in f.issue_ids]
    if f.record_keys:
        where += " AND ri.record_key = ANY(:record_keys)"
        p["record_keys"] = f.record_keys
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
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), out["id"]))
    await db.commit()
    return out


class FromCleaning(BaseModel):
    """Approved cleaning items by id, or every approved item a run found (optionally of one kind,
    as the cleaning queue names it: a cleaning rule id, 'duplicate' or a field)."""
    name: str = Field(min_length=1, max_length=200)
    ids: Optional[list[uuid.UUID]] = Field(None, min_length=1, max_length=MAX_ITEMS)
    version_id: Optional[uuid.UUID] = None
    kind: Optional[str] = Field(None, max_length=200)


class FromSimulation(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    simulation_id: str = Field(min_length=1, max_length=100)


@router.post("/batches/from-cleaning")
async def create_batch_from_cleaning(
    body: FromCleaning,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply", scope=scope_from_path)),
):
    """Draft batch from approved cleaning items. Still needs a second person's approval before export."""
    if not body.ids and not body.version_id and not body.kind:
        raise HTTPException(status_code=422, detail="Give the cleaning item ids, the run they came from or their kind.")
    await _rls(db, tenant)
    where, p = "tenant_id = :tid AND status = 'approved'", {"tid": str(tenant.id)}
    if body.ids:
        where += " AND id = ANY(:ids)"
        p["ids"] = [str(i) for i in body.ids]
    if body.version_id:
        where += " AND version_id = :vid"
        p["vid"] = str(body.version_id)
    if body.kind:
        from api.routes.cleaning import kind_filter
        where += " AND " + kind_filter(body.kind, p)
    rows = (await db.execute(text(f"""
        SELECT id, object_type, rule_id, record_key, record_data_before, record_data_after FROM cleaning_queue
         WHERE {where} LIMIT {MAX_ITEMS + 1}
    """), p)).mappings().all()
    if len(rows) > MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"More than {MAX_ITEMS} approved items; draft one kind at a time.")
    items = remediation.items_from_cleaning([dict(r) for r in rows])
    if not items:
        raise HTTPException(status_code=400, detail="None of these cleaning items is approved with a changed value.")
    uid, label = current_user_id(request), current_user_label()
    filt = json.dumps({"source": "cleaning", "ids": sorted(str(r["id"]) for r in rows)})
    out = await db.run_sync(lambda s: remediation.store_batch(s, str(tenant.id), body.name, filt, items, uid, label))
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), out["id"]))
    await db.commit()
    return out


@router.post("/batches/from-simulation")
async def create_batch_from_simulation(
    body: FromSimulation,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply", scope=scope_from_path)),
):
    """Draft batch from a finished simulation's record fixes (Redis, 24 h)."""
    from api.services.task_progress import _redis_client
    from workers.tasks.run_simulation import result_key

    client = _redis_client()
    raw = client.get(result_key(str(tenant.id), body.simulation_id)) if client is not None else None
    doc = json.loads(raw) if raw else None
    if not doc or not doc.get("record_fixes"):
        raise HTTPException(status_code=404, detail="Simulation not found, expired, or it changed no records.")
    items = remediation.items_from_simulation(doc["record_fixes"])
    await _rls(db, tenant)
    uid, label = current_user_id(request), current_user_label()
    filt = json.dumps({"source": "simulation", "simulation_id": body.simulation_id})
    out = await db.run_sync(lambda s: remediation.store_batch(s, str(tenant.id), body.name, filt, items, uid, label))
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), out["id"]))
    await db.commit()
    return out


@router.get("/batches")
async def list_batches(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view", scope=scope_from_path)),
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
    items = [_row(r) for r in rows.fetchall()]
    extras = await _batch_extras(db, tenant, items)
    return {"items": [{**b, **extras[b["id"]]} for b in items]}


@router.get("/monitor")
async def monitor_status(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view", scope=scope_from_path)),
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
    _perm: str = Depends(require_permission("view", scope=scope_from_path)),
):
    b = await _batch(db, tenant, batch_id)
    return {"batch": {**b, **(await _batch_extras(db, tenant, [b]))[b["id"]]}, "items": await _items(db, batch_id)}


@router.get("/batches/{batch_id}/events")
async def batch_events(
    batch_id: uuid.UUID,
    item_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view", scope=scope_from_path)),
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
    _perm: str = Depends(require_permission("apply", scope=scope_from_path)),
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
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), batch_id))
    await db.commit()
    return {"id": str(item_id), "proposed_value": body.proposed_value}


@router.post("/batches/{batch_id}/accept-high-confidence")
async def accept_high_confidence(
    batch_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("approve", scope=scope_from_path)),
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
    _perm: str = Depends(require_permission("approve", scope=scope_from_path)),
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
    rec = undo.Recorder()
    rec.batch = await undo.batch_snapshot(db, tenant, batch_id, "approved")
    await db.execute(text("UPDATE remediation_batches SET status = 'approved', approved_by = CAST(:uid AS uuid), "
                          "approved_by_label = :label, approved_at = now() WHERE id = :id"),
                     {"uid": uid, "label": current_user_label(), "id": batch_id})
    await _event(db, tenant, batch_id, "approved", request)
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), batch_id))
    action_id = await rec.save(db, tenant, request, "approve_batch", {"batch_id": str(batch_id), "name": b["name"]})
    await db.commit()
    attention.invalidate(tenant.id)
    return {"id": str(batch_id), "status": "approved", "approved_by": current_user_label(), "action_id": action_id}


class Reassign(BaseModel):
    assignee_id: uuid.UUID


@router.post("/batches/{batch_id}/reassign")
async def reassign_batch(
    batch_id: uuid.UUID,
    body: Reassign,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("assign", scope=scope_from_path)),
):
    """Give every record in the batch to one person: what /work/decide's assign does to a record (its open issues get the
    assignee, an assign event each, the work rows are recomputed), for all the batch's records at once. Undoable through
    /actions/undo. ``reassigned`` counts the records that had an open issue to hand over."""
    from api.routes.work import _event

    b = await _batch(db, tenant, batch_id)
    t = str(tenant.id)
    if not (await db.execute(text("SELECT 1 FROM users WHERE id = :u AND tenant_id = CAST(:t AS uuid)"),
                             {"u": body.assignee_id, "t": t})).scalar():
        raise HTTPException(status_code=404, detail="Assignee not found.")
    rows = (await db.execute(text("""
        SELECT ri.id::text AS id, ri.scope, ri.module, ri.record_key
          FROM record_issues ri
         WHERE ri.tenant_id = CAST(:t AS uuid) AND ri.status IN ('open', 'in_progress')
           AND (ri.scope, ri.module, ri.record_key) IN (SELECT i.scope, i.module, i.record_key FROM remediation_items i
                                                          WHERE i.batch_id = :b AND i.tenant_id = CAST(:t AS uuid))"""),
                            {"t": t, "b": batch_id})).mappings().all()
    rec = undo.Recorder()  # no single scope: undo recomputes the work rows from the issues themselves
    ids = [r["id"] for r in rows]
    await rec.issue_rows(db, tenant, ids)
    if ids:
        await db.execute(text("UPDATE record_issues SET assigned_to = :a, assigned_at = now(), updated_at = now() "
                              "WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))"),
                         {"a": body.assignee_id, "t": t, "ids": ids})
        await _event(db, tenant, request, ids, "assign", None, str(body.assignee_id), f"Batch {b['name']} reassigned")
        await db.run_sync(lambda s: worklist.refresh_issues(s, t, ids))
    action_id = await rec.save(db, tenant, request, "reassign_batch",
                               {"batch_id": str(batch_id), "name": b["name"], "assignee_id": str(body.assignee_id)})
    await db.commit()
    attention.invalidate(tenant.id)
    from api.services import work_analytics
    work_analytics.forget(tenant.id)
    return {"batch_id": str(batch_id), "reassigned": len({(r["scope"], r["module"], r["record_key"]) for r in rows}),
            "action_id": action_id}


class SendBack(BaseModel):
    note: str = Field(min_length=1, max_length=4000, description="what the author has to change")


@router.post("/batches/{batch_id}/send-back")
async def send_back_batch(
    batch_id: uuid.UUID,
    body: SendBack,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("approve", scope=scope_from_path)),
):
    """An approver returns a batch to its author with a reason. An approved batch goes back to draft (its approval
    is withdrawn); a draft stays a draft and is marked returned in its filter. Not once it is exported, and not by
    the batch creator (four eyes)."""
    b = await _batch(db, tenant, batch_id)
    if b["status"] not in ("draft", "approved"):
        raise HTTPException(status_code=409, detail=f"Batch is already {b['status']}; it can no longer be sent back.")
    uid = current_user_id(request)
    if b["created_by"] and uid == b["created_by"]:
        raise HTTPException(status_code=403, detail="The batch creator cannot send it back.")
    note = body.note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="Say what the author has to change.")
    rec = undo.Recorder()
    rec.batch = await undo.batch_snapshot(db, tenant, batch_id, "draft")
    await db.execute(text("""
        UPDATE remediation_batches SET status = 'draft', approved_by = NULL, approved_by_label = NULL, approved_at = NULL,
               filter = COALESCE(filter, '{}'::jsonb) || jsonb_build_object('returned', jsonb_build_object(
                          'by', CAST(:label AS text), 'note', CAST(:note AS text), 'at', to_jsonb(now())))
         WHERE id = :id AND tenant_id = :tid"""),
        {"label": current_user_label(), "note": note, "id": batch_id, "tid": str(tenant.id)})
    await db.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, action, "
                          "from_value, to_value) VALUES (:tid, :bid, NULL, CAST(:uid AS uuid), :label, 'sent_back', "
                          ":frm, :note)"),
                     {"tid": str(tenant.id), "bid": batch_id, "uid": uid, "label": current_user_label(),
                      "frm": b["status"], "note": note})
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), batch_id))
    action_id = await rec.save(db, tenant, request, "send_back_batch",
                               {"batch_id": str(batch_id), "name": b["name"], "note": note})
    await db.commit()
    attention.invalidate(tenant.id)
    return {"id": str(batch_id), "status": "draft", "sent_back_by": current_user_label(), "action_id": action_id}


_MEDIA = {"csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "zip": "application/zip", "json": "application/json"}

ExportFormat = Literal["cockpit_xlsx", "cockpit_csv", "mass_change_csv",
                       "ltmc_xlsx", "mass_maintenance_zip", "mdg_cr_json"]


@router.post("/batches/{batch_id}/export")
async def export_batch(
    batch_id: uuid.UUID,
    request: Request,
    format: ExportFormat = Query("cockpit_xlsx"),
    cr_type: Optional[str] = Query(None, max_length=40, pattern=r"^[A-Z0-9_]+$",
                                   description="mdg_cr_json only: the change-request type"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("export", scope=scope_from_path)),
):
    """Approved batch as a load file. Items without a proposed value are left out."""
    b = await _batch(db, tenant, batch_id)
    if b["status"] == "draft":
        raise HTTPException(status_code=409, detail="Approve the batch before exporting it.")
    uid = current_user_id(request)
    if b["created_by"] and uid and uid == b["created_by"]:
        # the batch creator may never export it either, even once someone else has approved it
        raise HTTPException(status_code=403, detail="The batch creator cannot export it.")
    items = await _items(db, batch_id)
    from api.services import sap_packages
    from api.services.branded_xlsx import guard_frame
    if format == "mass_change_csv":
        # SAP load file: every column is reimported, so the narrowed guard (as kind="raw").
        mc = remediation.mass_change(items)
        data, ext = guard_frame(mc, mc.columns).to_csv(index=False).encode(), "csv"
    elif format == "mass_maintenance_zip":
        data, ext = sap_packages.mass_maintenance_zip(items), "zip"
    elif format == "mdg_cr_json":
        if not cr_type:
            raise HTTPException(status_code=422, detail="cr_type is required for mdg_cr_json")
        data, ext = sap_packages.mdg_change_request(
            items, batch_id=str(batch_id), batch_name=b["name"], cr_type=cr_type), "json"
    else:
        from sap.ddic import get_dictionary
        d = get_dictionary("s4hana")
        if format == "cockpit_csv":
            cc = remediation.cockpit_csv(items, d)
            data, ext = guard_frame(cc, cc.columns).to_csv(index=False).encode(), "csv"
        elif format == "ltmc_xlsx":
            data, ext = sap_packages.ltmc_workbook(items, d), "xlsx"
        else:
            from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook
            sheets_by_table = remediation.cockpit_sheets(items, d)
            sheet_specs = []
            for table, df in (sheets_by_table or {}).items():
                # kind="raw": narrowed formula guard (still blocks "=", "@", tab,
                # CR) that leaves a leading "-"/"+" on a negative quantity or
                # SAP code untouched, since this file is reimported into SAP
                # rather than opened by a human. See N3 in the re-review.
                columns = [ColumnSpec(col, col, kind="raw") for col in df.columns]
                sheet_specs.append(SheetSpec(title=table[:31], columns=columns, rows=df.to_dict("records")))
            if not sheet_specs:
                sheet_specs = [SheetSpec(title="EMPTY", columns=[], rows=[])]
            data = build_workbook(
                tenant_name=tenant.name,
                run_label=str(batch_id),
                run_id=str(batch_id),
                title="Remediation cockpit export",
                sheets=sheet_specs,
            )
            ext = "xlsx"
    digest = hashlib.sha256(data).hexdigest()
    if format == "cockpit_xlsx":
        from api.services.branded_xlsx import xlsx_filename
        filename = xlsx_filename(f"remediation-{format}", str(batch_id))
    else:
        filename = f"remediation_{batch_id}_{format}.{ext}"
    await db.execute(text("UPDATE remediation_batches SET status = 'exported', exported_at = now() WHERE id = :id"),
                     {"id": batch_id})
    await db.execute(text(
        "INSERT INTO export_packages (tenant_id, batch_id, format, filename, sha256, size_bytes, item_count, "
        "created_by, created_by_label, approved_by_label) VALUES (:tid, :bid, :fmt, :fn, :sha, :size, :cnt, "
        "CAST(:uid AS uuid), :label, :approved_label)"),
        {"tid": str(tenant.id), "bid": batch_id, "fmt": format, "fn": filename, "sha": digest, "size": len(data),
         "cnt": len(items), "uid": uid, "label": current_user_label(), "approved_label": b["approved_by_label"]})
    await _event(db, tenant, batch_id, "exported", request, to_value=format)
    await db.run_sync(lambda s: worklist.refresh_batch(s, str(tenant.id), batch_id))
    await db.commit()
    return StreamingResponse(io.BytesIO(data), media_type=_MEDIA[ext], headers={
        "Content-Disposition": f"attachment; filename={filename}",
        "X-Content-SHA256": digest,
        "Access-Control-Expose-Headers": "X-Content-SHA256"})


@router.get("/batches/{batch_id}/diff")
async def batch_diff_route(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Before/after per record, grouped — what this batch actually changes."""
    await _batch(db, tenant, batch_id)
    return {"records": remediation.batch_diff(await _items(db, batch_id))}


@router.get("/batches/{batch_id}/packages")
async def batch_packages(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Audit trail of every file exported for this batch: format, sha256, who, when."""
    await _batch(db, tenant, batch_id)
    rows = await db.execute(text(
        "SELECT id, format, filename, sha256, size_bytes, item_count, created_by_label, approved_by_label, "
        "created_at FROM export_packages WHERE batch_id = :bid ORDER BY created_at DESC"), {"bid": batch_id})
    return {"items": [_row(r) for r in rows.fetchall()]}
