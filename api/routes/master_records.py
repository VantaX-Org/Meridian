"""Master records (golden records) API routes.

Endpoints:
  GET  /master-records           — list with domain/status filters, paginated
  GET  /master-records/{id}      — detail (strips ai_recommendation unless view_ai_confidence)
  POST /master-records/{id}/promote  — requires approve permission
  POST /master-records/{id}/writeback — requires apply permission
  GET  /master-records/{id}/history  — immutable audit trail
"""

import copy
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission, has_permission, _get_user_role

router = APIRouter(prefix="/api/v1", tags=["master-records"])
logger = logging.getLogger("meridian.master_records")


# ── Response models ───────────────────────────────────────────────────────────


class SourceContribution(BaseModel):
    value: object = None
    source_system: str
    extracted_at: str
    confidence: float
    ai_recommendation: Optional[str] = None
    ai_confidence: Optional[float] = None
    ai_reasoning: Optional[str] = None


class MasterRecordSummary(BaseModel):
    id: str
    domain: str
    sap_object_key: str
    overall_confidence: float
    status: str
    source_count: int
    pending_issues: int
    promoted_at: Optional[str] = None
    created_at: str
    updated_at: str


class MasterRecordDetail(BaseModel):
    id: str
    domain: str
    sap_object_key: str
    golden_fields: dict
    source_contributions: dict
    overall_confidence: float
    status: str
    promoted_at: Optional[str] = None
    promoted_by: Optional[str] = None
    created_at: str
    updated_at: str


class MasterRecordListResponse(BaseModel):
    records: list[MasterRecordSummary]
    total: int
    page: int
    per_page: int


class HistoryEntry(BaseModel):
    id: str
    changed_at: str
    changed_by: Optional[str] = None
    change_type: str
    previous_fields: Optional[dict] = None
    new_fields: Optional[dict] = None
    ai_was_involved: bool
    ai_recommendation_accepted: Optional[bool] = None


class PromoteRequest(BaseModel):
    ai_recommendation_accepted: Optional[bool] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/master-records", response_model=MasterRecordListResponse)
async def list_master_records(
    domain: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    min_confidence: Optional[float] = Query(None),
    max_confidence: Optional[float] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    # Build WHERE clauses
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": tenant_id}

    if domain:
        conditions.append("domain = :domain")
        params["domain"] = domain
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if min_confidence is not None:
        conditions.append("overall_confidence >= :min_conf")
        params["min_conf"] = min_confidence
    if max_confidence is not None:
        conditions.append("overall_confidence <= :max_conf")
        params["max_conf"] = max_confidence

    where = " AND ".join(conditions)

    # Count total
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM master_records WHERE {where}"),
        params,
    )
    total = count_result.scalar() or 0

    # Fetch page
    offset = (page - 1) * per_page
    params["limit"] = per_page
    params["offset"] = offset

    result = await db.execute(
        text(f"""
            SELECT id, domain, sap_object_key, overall_confidence, status,
                   source_contributions, golden_fields,
                   promoted_at, created_at, updated_at
            FROM master_records
            WHERE {where}
            ORDER BY updated_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )

    records = []
    for row in result.fetchall():
        source_contributions = row[5] or {}
        golden_fields = row[6] or {}

        # Count unique source systems
        sources = set()
        for contrib in source_contributions.values():
            if isinstance(contrib, dict) and "source_system" in contrib:
                sources.add(contrib["source_system"])

        # Count fields with AI recommendations (pending issues)
        pending = sum(
            1
            for contrib in source_contributions.values()
            if isinstance(contrib, dict) and contrib.get("ai_recommendation")
        )

        records.append(MasterRecordSummary(
            id=str(row[0]),
            domain=row[1],
            sap_object_key=row[2],
            overall_confidence=float(row[3]),
            status=row[4],
            source_count=len(sources),
            pending_issues=pending,
            promoted_at=row[7].isoformat() if row[7] else None,
            created_at=row[8].isoformat(),
            updated_at=row[9].isoformat(),
        ))

    return MasterRecordListResponse(
        records=records, total=total, page=page, per_page=per_page
    )


@router.get("/master-records/{record_id}", response_model=MasterRecordDetail)
async def get_master_record(
    record_id: str,
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    result = await db.execute(
        text("""
            SELECT id, domain, sap_object_key, golden_fields, source_contributions,
                   overall_confidence, status, promoted_at, promoted_by,
                   created_at, updated_at
            FROM master_records
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": record_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Master record not found")

    source_contributions = copy.deepcopy(row[4] or {})

    # Strip AI recommendation fields unless caller has view_ai_confidence permission
    if not has_permission(role, "view_ai_confidence"):
        for field_name in source_contributions:
            contrib = source_contributions[field_name]
            if isinstance(contrib, dict):
                contrib.pop("ai_recommendation", None)
                contrib.pop("ai_confidence", None)
                contrib.pop("ai_reasoning", None)

    return MasterRecordDetail(
        id=str(row[0]),
        domain=row[1],
        sap_object_key=row[2],
        golden_fields=row[3] or {},
        source_contributions=source_contributions,
        overall_confidence=float(row[5]),
        status=row[6],
        promoted_at=row[7].isoformat() if row[7] else None,
        promoted_by=str(row[8]) if row[8] else None,
        created_at=row[9].isoformat(),
        updated_at=row[10].isoformat(),
    )


@router.post("/master-records/{record_id}/promote")
async def promote_master_record(
    record_id: str,
    request: Request,
    body: PromoteRequest = PromoteRequest(),
    role: str = Depends(require_permission("approve")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Promote a master record to golden status. Requires approve permission."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    # Load current record
    result = await db.execute(
        text("""
            SELECT id, status, golden_fields, source_contributions, domain, sap_object_key
            FROM master_records
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": record_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Master record not found")

    current_status = row[1]
    if current_status == "golden":
        raise HTTPException(status_code=409, detail="Record is already golden")
    if current_status == "superseded":
        raise HTTPException(status_code=409, detail="Cannot promote a superseded record")

    now = datetime.now(timezone.utc)
    # Attribute the promotion to the authenticated user (golden-record audit
    # trail must name the real approver, not a random UUID).
    user_id = getattr(request.state, "local_user_id", None)
    if not user_id:
        raise HTTPException(status_code=403, detail="Authentication required")
    user_id = str(user_id)

    # Check if AI was involved in any field
    source_contributions = row[3] or {}
    ai_was_involved = any(
        isinstance(c, dict) and c.get("ai_recommendation")
        for c in source_contributions.values()
    )

    # Update status to golden
    await db.execute(
        text("""
            UPDATE master_records
            SET status = 'golden', promoted_at = :now, promoted_by = :user_id, updated_at = :now
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": record_id, "tid": tenant_id, "now": now, "user_id": user_id},
    )

    # Log to history
    await db.execute(
        text("""
            INSERT INTO master_record_history (
                id, tenant_id, master_record_id, changed_at, changed_by,
                change_type, previous_fields, new_fields,
                ai_was_involved, ai_recommendation_accepted
            ) VALUES (
                gen_random_uuid(), :tid, :rid, :now, :user_id,
                'promoted', :prev::jsonb, :new::jsonb,
                :ai, :ai_accepted
            )
        """),
        {
            "tid": tenant_id,
            "rid": record_id,
            "now": now,
            "user_id": user_id,
            "prev": _json_dumps(row[2] or {}),
            "new": _json_dumps(row[2] or {}),
            "ai": ai_was_involved,
            "ai_accepted": body.ai_recommendation_accepted,
        },
    )

    await db.commit()
    logger.info(f"Master record {record_id} promoted to golden by {user_id}")

    # ── Impact propagation: queue related domain records for steward review ──
    record_domain = row[4]
    record_key = row[5]

    related_result = await db.execute(
        text("""
            SELECT DISTINCT
                CASE WHEN from_domain = :domain AND from_key = :key
                     THEN to_domain ELSE from_domain END AS related_domain,
                CASE WHEN from_domain = :domain AND from_key = :key
                     THEN to_key ELSE from_key END AS related_key,
                id AS relationship_id
            FROM record_relationships
            WHERE tenant_id = :tid
              AND active = true
              AND (
                  (from_domain = :domain AND from_key = :key)
                  OR (to_domain = :domain AND to_key = :key)
              )
        """),
        {"tid": tenant_id, "domain": record_domain, "key": record_key},
    )

    queued_count = 0
    for rel_row in related_result.fetchall():
        related_domain = rel_row[0]
        related_key = rel_row[1]
        relationship_id = rel_row[2]

        # Find the master_record id for the related record (if it exists)
        mr_result = await db.execute(
            text("""
                SELECT id FROM master_records
                WHERE tenant_id = :tid AND domain = :related_domain AND sap_object_key = :related_key
                LIMIT 1
            """),
            {"tid": tenant_id, "related_domain": related_domain, "related_key": related_key},
        )
        mr_row = mr_result.fetchone()
        source_id = str(mr_row[0]) if mr_row else str(relationship_id)

        await db.execute(
            text("""
                INSERT INTO stewardship_queue (
                    id, tenant_id, item_type, source_id, domain, priority, status
                ) VALUES (
                    gen_random_uuid(), :tid, 'golden_record_review', :source_id,
                    :related_domain, 2, 'open'
                )
            """),
            {
                "tid": tenant_id,
                "source_id": source_id,
                "related_domain": related_domain,
            },
        )
        queued_count += 1

    if queued_count > 0:
        await db.commit()
        logger.info(
            f"Impact propagation: queued {queued_count} stewardship items "
            f"for related domains after promoting {record_id}"
        )

    return {"status": "golden", "promoted_at": now.isoformat(), "related_reviews_queued": queued_count}


@router.post("/master-records/{record_id}/writeback")
async def writeback_master_record(
    record_id: str,
    role: str = Depends(require_permission("apply")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Trigger write-back for a golden record. Requires apply permission.
    Delegates to existing writeback.py 4-eyes flow.
    """
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    result = await db.execute(
        text("""
            SELECT id, status, golden_fields, domain
            FROM master_records
            WHERE id = :id AND tenant_id = :tid
        """),
        {"id": record_id, "tid": tenant_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Master record not found")

    if row[1] != "golden":
        raise HTTPException(
            status_code=400,
            detail="Only golden records can be written back — promote first"
        )

    # Return the golden fields for the existing writeback flow to process
    return {
        "record_id": str(row[0]),
        "domain": row[3],
        "golden_fields": row[2] or {},
        "message": "Use POST /api/v1/writeback with these fields to initiate 4-eyes write-back",
    }


@router.get("/master-records/{record_id}/history", response_model=list[HistoryEntry])
async def get_master_record_history(
    record_id: str,
    role: str = Depends(require_permission("view")),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Get immutable audit trail for a master record."""
    tenant_id = str(tenant.id)
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

    # Verify the record exists
    exists = await db.execute(
        text("SELECT 1 FROM master_records WHERE id = :id AND tenant_id = :tid"),
        {"id": record_id, "tid": tenant_id},
    )
    if not exists.scalar():
        raise HTTPException(status_code=404, detail="Master record not found")

    result = await db.execute(
        text("""
            SELECT id, changed_at, changed_by, change_type,
                   previous_fields, new_fields,
                   ai_was_involved, ai_recommendation_accepted
            FROM master_record_history
            WHERE master_record_id = :rid AND tenant_id = :tid
            ORDER BY changed_at DESC
        """),
        {"rid": record_id, "tid": tenant_id},
    )

    entries = []
    for row in result.fetchall():
        entries.append(HistoryEntry(
            id=str(row[0]),
            changed_at=row[1].isoformat(),
            changed_by=str(row[2]) if row[2] else None,
            change_type=row[3],
            previous_fields=row[4],
            new_fields=row[5],
            ai_was_involved=row[6],
            ai_recommendation_accepted=row[7],
        ))

    return entries


def _json_dumps(obj: dict) -> str:
    import json
    return json.dumps(obj, default=str)
