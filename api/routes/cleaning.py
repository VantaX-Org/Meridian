"""Cleaning engine API routes — 13 endpoints for cleaning queue + dedup."""

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["cleaning"])


# ── Pydantic models ──────────────────────────────────────────────────────────


class ApproveBody(BaseModel):
    notes: Optional[str] = None


class RejectBody(BaseModel):
    reason: str


class BulkApproveBody(BaseModel):
    rule_id: Optional[str] = None
    severity: Optional[str] = None
    max_count: int = 500


class ApplyBody(BaseModel):
    override_data: Optional[dict] = None


class DedupPreviewBody(BaseModel):
    record_key_a: str
    record_key_b: str
    object_type: str


class DedupMergeBody(BaseModel):
    candidate_id: str
    survivor_key: str
    field_overrides: Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))


async def _create_audit(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    queue_id: str,
    action: str,
    record_key: str,
    object_type: str,
    data_before: dict | None = None,
    data_after: dict | None = None,
    actor_name: str = "system",
    rule_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Insert audit record. Uses a savepoint so failures don't poison the session."""
    try:
        async with db.begin_nested():
            await db.execute(
                text("""
                    INSERT INTO cleaning_audit (id, tenant_id, queue_id, rule_id, action,
                        actor_name, record_key, object_type, data_before, data_after, metadata, created_at)
                    VALUES (gen_random_uuid(), :tenant_id, :queue_id, :rule_id, :action,
                        :actor_name, :record_key, :object_type,
                        CAST(:data_before AS jsonb), CAST(:data_after AS jsonb),
                        CAST(:metadata AS jsonb), now())
                """),
                {
                    "tenant_id": str(tenant_id),
                    "queue_id": queue_id,
                    "rule_id": rule_id,
                    "action": action,
                    "actor_name": actor_name,
                    "record_key": record_key,
                    "object_type": object_type,
                    "data_before": _json_dumps(data_before),
                    "data_after": _json_dumps(data_after),
                    "metadata": _json_dumps(metadata),
                },
            )
    except Exception:
        pass  # audit trail unavailable — continue without it


def _json_dumps(obj: dict | None) -> str:
    import json
    return json.dumps(obj) if obj else "{}"


def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy Row to dict."""
    return dict(row._mapping) if row else {}


# ── GET /api/v1/cleaning/queue ────────────────────────────────────────────────


@router.get("/cleaning/queue")
async def list_cleaning_queue(
    object_type: Optional[str] = None,
    status: Optional[str] = None,
    rule_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    where_clauses = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if object_type:
        where_clauses.append("object_type = :ot")
        params["ot"] = object_type
    if status:
        where_clauses.append("status = :st")
        params["st"] = status
    if rule_id:
        where_clauses.append("rule_id = :rid")
        params["rid"] = rule_id
    if assigned_to:
        where_clauses.append("assigned_to = :ato")
        params["ato"] = assigned_to

    where = " AND ".join(where_clauses)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM cleaning_queue WHERE {where}"), params
    )
    total = count_result.scalar()

    params["limit"] = per_page
    params["offset"] = (page - 1) * per_page

    result = await db.execute(
        text(f"""
            SELECT id, object_type, status, confidence, record_key, priority,
                   detected_at, applied_at, rollback_deadline, rule_id, batch_id,
                   version_id, merge_preview, record_data_before, record_data_after,
                   golden_record_id, golden_field_value
            FROM cleaning_queue
            WHERE {where}
            ORDER BY priority DESC, detected_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = []
    for r in result.fetchall():
        row = _row_to_dict(r)
        row['golden_record_exists'] = row.get('golden_record_id') is not None
        if row.get('golden_record_id') is not None:
            row['golden_record_id'] = str(row['golden_record_id'])
        items.append(row)

    return {"items": items, "total": total, "page": page, "per_page": per_page}


# ── GET /api/v1/cleaning/queue/{id} ──────────────────────────────────────────


@router.get("/cleaning/queue/{item_id}")
async def get_cleaning_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM cleaning_queue WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    item = result.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Last 10 audit entries — graceful fallback if table doesn't exist yet
    audit: list[dict] = []
    try:
        async with db.begin_nested():
            audit_result = await db.execute(
                text("""
                    SELECT id, action, actor_name, record_key, data_before, data_after, metadata, created_at
                    FROM cleaning_audit
                    WHERE queue_id = :qid AND tenant_id = :tid
                    ORDER BY created_at DESC LIMIT 10
                """),
                {"qid": item_id, "tid": str(tenant.id)},
            )
            audit = [_row_to_dict(r) for r in audit_result.fetchall()]
    except Exception:
        pass  # audit trail unavailable — continue without it

    row = _row_to_dict(item)
    row["golden_record_exists"] = row.get("golden_record_id") is not None
    if row.get("golden_record_id") is not None:
        row["golden_record_id"] = str(row["golden_record_id"])
    return {**row, "audit": audit}


# ── POST /api/v1/cleaning/approve/{id} ───────────────────────────────────────


@router.post("/cleaning/approve/{item_id}")
async def approve_cleaning_item(
    item_id: str,
    body: ApproveBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM cleaning_queue WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    item = result.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    row = _row_to_dict(item)
    await db.execute(
        text("""
            UPDATE cleaning_queue SET status = 'approved', approved_by = :approver
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": item_id, "tid": str(tenant.id), "approver": str(tenant.id)},
    )

    await _create_audit(
        db, tenant.id, item_id, "approved", row["record_key"], row["object_type"],
        data_before=row.get("record_data_before"),
        data_after=row.get("record_data_after"),
        metadata={"notes": body.notes} if body.notes else None,
    )
    await db.commit()

    return {"id": item_id, "status": "approved"}


# ── POST /api/v1/cleaning/reject/{id} ────────────────────────────────────────


@router.post("/cleaning/reject/{item_id}")
async def reject_cleaning_item(
    item_id: str,
    body: RejectBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM cleaning_queue WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    item = result.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    row = _row_to_dict(item)
    await db.execute(
        text("UPDATE cleaning_queue SET status = 'rejected' WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )

    await _create_audit(
        db, tenant.id, item_id, "rejected", row["record_key"], row["object_type"],
        metadata={"reason": body.reason},
    )
    await db.commit()

    return {"id": item_id, "status": "rejected"}


# ── POST /api/v1/cleaning/bulk-approve ───────────────────────────────────────


@router.post("/cleaning/bulk-approve")
async def bulk_approve(
    body: BulkApproveBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    await _set_rls(db, tenant.id)

    where = "cq.status = 'detected' AND cq.tenant_id = :tid"
    params: dict = {"tid": str(tenant.id), "max_count": body.max_count}

    # Only auto-approve items linked to rules with automation_level=auto
    where += """
        AND (cq.rule_id IS NULL OR EXISTS (
            SELECT 1 FROM cleaning_rules cr
            WHERE cr.id = cq.rule_id AND cr.automation_level = 'auto'
        ))
    """

    if body.rule_id:
        where += " AND cq.rule_id = :rid"
        params["rid"] = body.rule_id

    result = await db.execute(
        text(f"""
            UPDATE cleaning_queue cq SET status = 'approved', approved_by = :approver
            WHERE cq.id IN (
                SELECT id FROM cleaning_queue
                WHERE {where.replace('cq.', '')}
                ORDER BY priority DESC
                LIMIT :max_count
            )
            RETURNING cq.id
        """),
        {**params, "approver": str(tenant.id)},
    )
    approved_ids = [str(r[0]) for r in result.fetchall()]
    await db.commit()

    return {"approved_count": len(approved_ids), "skipped_count": 0}


# ── POST /api/v1/cleaning/apply/{id} ─────────────────────────────────────────


@router.post("/cleaning/apply/{item_id}")
async def apply_cleaning_item(
    item_id: str,
    body: ApplyBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("apply")),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM cleaning_queue WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    item = result.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    row = _row_to_dict(item)
    if row["status"] != "approved":
        raise HTTPException(status_code=400, detail="Item must be approved before applying")

    now = datetime.now(timezone.utc)
    deadline = now + timedelta(hours=72)

    # Apply override data if provided
    after_data = row.get("record_data_after") or {}
    if body.override_data:
        after_data.update(body.override_data)

    import json
    await db.execute(
        text("""
            UPDATE cleaning_queue
            SET status = 'applied', applied_at = :now, rollback_deadline = :deadline,
                record_data_after = CAST(:after AS jsonb)
            WHERE id = :id AND tenant_id = :tid
        """),
        {
            "id": item_id, "tid": str(tenant.id),
            "now": now, "deadline": deadline,
            "after": json.dumps(after_data),
        },
    )

    await _create_audit(
        db, tenant.id, item_id, "applied", row["record_key"], row["object_type"],
        data_before=row.get("record_data_before"),
        data_after=after_data,
    )
    await db.commit()

    return {"id": item_id, "status": "applied", "rollback_deadline": deadline.isoformat()}


# ── POST /api/v1/cleaning/rollback/{id} ──────────────────────────────────────


@router.post("/cleaning/rollback/{item_id}")
async def rollback_cleaning_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("apply")),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM cleaning_queue WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    item = result.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    row = _row_to_dict(item)
    if row["status"] != "applied":
        raise HTTPException(status_code=400, detail="Only applied items can be rolled back")

    now = datetime.now(timezone.utc)
    deadline = row.get("rollback_deadline")
    if deadline and now > deadline:
        raise HTTPException(status_code=400, detail="Rollback window has expired")

    # Swap before/after for rollback
    await db.execute(
        text("""
            UPDATE cleaning_queue
            SET status = 'rolled_back',
                record_data_after = record_data_before
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": item_id, "tid": str(tenant.id)},
    )

    await _create_audit(
        db, tenant.id, item_id, "rolled_back", row["record_key"], row["object_type"],
        data_before=row.get("record_data_after"),
        data_after=row.get("record_data_before"),
    )
    await db.commit()

    return {"id": item_id, "status": "rolled_back"}


# ── GET /api/v1/cleaning/export/{format} ─────────────────────────────────────


@router.get("/cleaning/export-options")
async def get_cleaning_export_options(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    """Return the object types and statuses actually present in this tenant's
    cleaning queue, along with row counts. Used by the export modal to build
    the dropdowns so the options always match what's exportable — no
    hardcoded lists.
    """
    await _set_rls(db, tenant.id)

    object_types_result = await db.execute(
        text("""
            SELECT object_type, COUNT(*) AS total
            FROM cleaning_queue
            WHERE tenant_id = :tid
            GROUP BY object_type
            ORDER BY object_type
        """),
        {"tid": str(tenant.id)},
    )
    object_types = [
        {"value": r[0], "count": int(r[1])} for r in object_types_result.fetchall()
    ]

    statuses_result = await db.execute(
        text("""
            SELECT status, COUNT(*) AS total
            FROM cleaning_queue
            WHERE tenant_id = :tid
            GROUP BY status
            ORDER BY status
        """),
        {"tid": str(tenant.id)},
    )
    statuses = [
        {"value": r[0], "count": int(r[1])} for r in statuses_result.fetchall()
    ]

    return {"object_types": object_types, "statuses": statuses}


@router.get("/cleaning/export/{export_format}")
async def export_cleaning_data(
    export_format: str,
    status: str = Query(..., description="Cleaning queue status to export"),
    object_type: Optional[str] = Query(
        None, description="Optional object type filter — omit to export across all object types"
    ),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    valid_formats = ("csv", "lsmw", "bapi", "idoc", "sf_csv", "xlsx")
    if export_format not in valid_formats:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {export_format}")

    await _set_rls(db, tenant.id)

    where = "status = :st AND tenant_id = :tid"
    params: dict = {"st": status, "tid": str(tenant.id)}
    if object_type:
        where += " AND object_type = :ot"
        params["ot"] = object_type

    result = await db.execute(
        text(f"""
            SELECT record_key, object_type, record_data_before, record_data_after
            FROM cleaning_queue WHERE {where}
            ORDER BY detected_at DESC
        """),
        params,
    )
    rows = result.fetchall()

    if not rows:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No cleaning items found with status='{status}'"
                + (f" and object_type='{object_type}'" if object_type else "")
                + ". Nothing to export."
            ),
        )

    # Group records by object_type so a mixed export preserves the right SAP
    # field mapping per row. When the caller specifies object_type the groups
    # collapse to a single entry.
    records_by_type: dict[str, list[dict]] = {}
    for r in rows:
        row = _row_to_dict(r)
        row_object_type = row.get("object_type")
        if not row_object_type:
            continue
        after = row.get("record_data_after") or row.get("record_data_before") or {}
        record = {k: v for k, v in after.items() if k not in ("issue", "error")}
        records_by_type.setdefault(row_object_type, []).append(record)

    if not records_by_type:
        raise HTTPException(
            status_code=404,
            detail="Cleaning items matched but none carried a usable object_type or record payload.",
        )

    from api.services.export_engine import ExportEngine
    engine = ExportEngine()

    # xlsx with multiple object types → one sheet per type. For a single type
    # this is still correct and produces one sheet named after that type.
    if export_format == "xlsx":
        content_bytes = engine.export_xlsx_multi(records_by_type)
        filename_suffix = object_type if object_type else "all"
        filename = f"cleaning_export_{status}_{filename_suffix}.xlsx"
        return StreamingResponse(
            io.BytesIO(content_bytes),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    format_dispatch = {
        "csv": engine.export_csv,
        "lsmw": engine.export_lsmw,
        "bapi": engine.export_bapi,
        "idoc": engine.export_idoc,
        "sf_csv": engine.export_sf_csv,
    }

    # Text formats concatenate groups with a separator between object types
    # when multiple are present. For a single type (the object_type filter
    # path) this produces a straight single-type export with no separator.
    segments: list[str] = []
    for ot, recs in records_by_type.items():
        header = f"# object_type={ot} count={len(recs)}"
        body = format_dispatch[export_format](recs, ot)
        if len(records_by_type) > 1:
            segments.append(f"{header}\n{body}")
        else:
            segments.append(body)
    content = "\n\n".join(segments)

    media_types = {
        "csv": "text/csv",
        "lsmw": "text/plain",
        "bapi": "application/json",
        "idoc": "application/json",
        "sf_csv": "text/csv",
    }
    extensions = {
        "csv": "csv",
        "lsmw": "txt",
        "bapi": "json",
        "idoc": "json",
        "sf_csv": "csv",
    }

    media_type = media_types[export_format]
    ext = extensions[export_format]
    filename_suffix = object_type if object_type else "all"
    filename = f"cleaning_export_{export_format}_{status}_{filename_suffix}.{ext}"

    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── GET /api/v1/cleaning/metrics ─────────────────────────────────────────────


@router.get("/cleaning/metrics")
async def get_cleaning_metrics(
    period_type: str = "daily",
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT * FROM cleaning_metrics
            WHERE tenant_id = :tid AND period_type = :pt
            ORDER BY period DESC LIMIT 90
        """),
        {"tid": str(tenant.id), "pt": period_type},
    )
    rows = [_row_to_dict(r) for r in result.fetchall()]

    # Compute totals
    totals = {
        "detected": sum(r.get("detected", 0) for r in rows),
        "recommended": sum(r.get("recommended", 0) for r in rows),
        "approved": sum(r.get("approved", 0) for r in rows),
        "rejected": sum(r.get("rejected", 0) for r in rows),
        "applied": sum(r.get("applied", 0) for r in rows),
        "verified": sum(r.get("verified", 0) for r in rows),
        "rolled_back": sum(r.get("rolled_back", 0) for r in rows),
        "auto_approved": sum(r.get("auto_approved", 0) for r in rows),
    }

    return {"metrics": rows, "totals": totals}


# ── GET /api/v1/cleaning/audit ────────────────────────────────────────────────


@router.get("/cleaning/audit")
async def list_cleaning_audit(
    queue_id: Optional[str] = None,
    action: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export")),
):
    await _set_rls(db, tenant.id)

    where_clauses = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if queue_id:
        where_clauses.append("queue_id = :qid")
        params["qid"] = queue_id
    if action:
        where_clauses.append("action = :act")
        params["act"] = action

    where = " AND ".join(where_clauses)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM cleaning_audit WHERE {where}"), params
    )
    total = count_result.scalar()

    params["limit"] = per_page
    params["offset"] = (page - 1) * per_page

    result = await db.execute(
        text(f"""
            SELECT * FROM cleaning_audit
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [_row_to_dict(r) for r in result.fetchall()]

    return {"items": items, "total": total, "page": page, "per_page": per_page}


# ── GET /api/v1/dedup/candidates/{object_type} ───────────────────────────────


@router.get("/dedup/candidates/{object_type}")
async def list_dedup_candidates(
    object_type: str,
    min_score: int = Query(default=60, ge=0, le=100),
    status: str = "pending",
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT * FROM dedup_candidates
            WHERE tenant_id = :tid AND object_type = :ot
                AND match_score >= :ms AND status = :st
            ORDER BY match_score DESC
        """),
        {"tid": str(tenant.id), "ot": object_type, "ms": min_score, "st": status},
    )
    items = [_row_to_dict(r) for r in result.fetchall()]

    return {"items": items, "total": len(items)}


# ── POST /api/v1/dedup/preview ────────────────────────────────────────────────


@router.post("/dedup/preview")
async def dedup_preview(
    body: DedupPreviewBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    # Find matching cleaning_queue items by record keys
    result_a = await db.execute(
        text("""
            SELECT record_data_before FROM cleaning_queue
            WHERE tenant_id = :tid AND record_key LIKE :key
            LIMIT 1
        """),
        {"tid": str(tenant.id), "key": f"%{body.record_key_a}%"},
    )
    result_b = await db.execute(
        text("""
            SELECT record_data_before FROM cleaning_queue
            WHERE tenant_id = :tid AND record_key LIKE :key
            LIMIT 1
        """),
        {"tid": str(tenant.id), "key": f"%{body.record_key_b}%"},
    )

    row_a = result_a.fetchone()
    row_b = result_b.fetchone()

    data_a = _row_to_dict(row_a).get("record_data_before", {}) if row_a else {}
    data_b = _row_to_dict(row_b).get("record_data_before", {}) if row_b else {}

    # Merge preview — for each field pick non-empty, longer value
    all_fields = set(list(data_a.keys()) + list(data_b.keys()))
    merge_preview: dict = {}
    for field in sorted(all_fields):
        val_a = str(data_a.get(field, "")) if data_a.get(field) else ""
        val_b = str(data_b.get(field, "")) if data_b.get(field) else ""
        survivor = val_a if len(val_a) >= len(val_b) else val_b
        merge_preview[field] = {"a": val_a, "b": val_b, "survivor": survivor}

    return {"merge_preview": merge_preview, "record_key_a": body.record_key_a, "record_key_b": body.record_key_b}


# ── POST /api/v1/dedup/merge ─────────────────────────────────────────────────


@router.post("/dedup/merge")
async def dedup_merge(
    body: DedupMergeBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM dedup_candidates WHERE id = :id AND tenant_id = :tid"),
        {"id": body.candidate_id, "tid": str(tenant.id)},
    )
    candidate = result.fetchone()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    row = _row_to_dict(candidate)

    now = datetime.now(timezone.utc)
    await db.execute(
        text("""
            UPDATE dedup_candidates
            SET status = 'merged', survivor_key = :sk, merged_at = :now, merged_by = :mb
            WHERE id = :id AND tenant_id = :tid
        """),
        {
            "id": body.candidate_id, "tid": str(tenant.id),
            "sk": body.survivor_key, "now": now, "mb": str(tenant.id),
        },
    )

    # Create audit entry via cleaning_queue link if one exists
    queue_key = f"{row.get('record_key_a')}|{row.get('record_key_b')}"
    queue_result = await db.execute(
        text("SELECT id FROM cleaning_queue WHERE record_key = :rk AND tenant_id = :tid LIMIT 1"),
        {"rk": queue_key, "tid": str(tenant.id)},
    )
    queue_row = queue_result.fetchone()
    if queue_row:
        queue_id = str(_row_to_dict(queue_row)["id"])
        await _create_audit(
            db, tenant.id, queue_id, "applied", queue_key, row.get("object_type", ""),
            metadata={"merge": True, "survivor_key": body.survivor_key, "field_overrides": body.field_overrides},
        )

    await db.commit()

    return {
        "id": body.candidate_id,
        "status": "merged",
        "survivor_key": body.survivor_key,
        "merged_at": now.isoformat(),
    }
