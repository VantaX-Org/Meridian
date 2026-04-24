"""Stewardship workbench API endpoints.

GET  /api/v1/stewardship                — list queue items with filters
GET  /api/v1/stewardship/{id}           — single queue item with source context
PUT  /api/v1/stewardship/{id}/assign    — assign to a steward
PUT  /api/v1/stewardship/{id}/resolve   — resolve (approve/reject) an item
PUT  /api/v1/stewardship/{id}/escalate  — escalate an item
POST /api/v1/stewardship/bulk-approve   — bulk approve high-confidence items
GET  /api/v1/stewardship/metrics        — steward productivity metrics
"""

import uuid as uuid_mod
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import has_permission, require_permission

router = APIRouter(prefix="/api/v1", tags=["stewardship"])

# Enforce UUID format on {item_id} params so FastAPI doesn't match literal
# routes like /stewardship/metrics or /stewardship/bulk-approve through
# the UUID-typed handler (which would 500 inside asyncpg's bind step).
_UUID_RE = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


# ── Request/Response models ──────────────────────────────────────────────────


class QueueItemOut(BaseModel):
    id: str
    tenant_id: str
    item_type: str
    source_id: str
    domain: str
    priority: int
    due_at: Optional[str] = None
    assigned_to: Optional[str] = None
    status: str
    sla_hours: Optional[int] = None
    created_at: str
    updated_at: str
    ai_recommendation: Optional[str] = None
    ai_confidence: Optional[float] = None


class QueueListResponse(BaseModel):
    items: list[QueueItemOut]
    total: int


class AssignBody(BaseModel):
    user_id: str


class ResolveBody(BaseModel):
    action: str = Field(..., description="approve | reject")
    notes: Optional[str] = None


class BulkApproveBody(BaseModel):
    item_ids: list[str]
    min_confidence: float = Field(0.85, ge=0.0, le=1.0)


class BulkApproveResponse(BaseModel):
    approved: int
    history_rows_created: int


class MetricsResponse(BaseModel):
    items_by_type: dict[str, int]
    items_by_status: dict[str, int]
    avg_resolution_hours_by_type: dict[str, float]
    backlog_total: int
    sla_compliance_rate: float
    ai_acceptance_rate: Optional[float] = None
    steward_breakdown: Optional[list[dict]] = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _row_to_item(row) -> QueueItemOut:
    """Convert a database row to a QueueItemOut, respecting column order."""
    return QueueItemOut(
        id=str(row[0]),
        tenant_id=str(row[1]),
        item_type=row[2],
        source_id=str(row[3]),
        domain=row[4],
        priority=row[5],
        due_at=row[6].isoformat() if row[6] else None,
        assigned_to=str(row[7]) if row[7] else None,
        status=row[8],
        sla_hours=row[9],
        created_at=row[10].isoformat() if row[10] else "",
        updated_at=row[11].isoformat() if row[11] else "",
        ai_recommendation=row[12],
        ai_confidence=float(row[13]) if row[13] is not None else None,
    )


QUEUE_COLUMNS = (
    "id, tenant_id, item_type, source_id, domain, priority, due_at, "
    "assigned_to, status, sla_hours, created_at, updated_at, "
    "ai_recommendation, ai_confidence"
)


async def _resolve_user_id(db: AsyncSession, tenant: Tenant, request: Request) -> str:
    # Use local auth user ID if available, else generate dev user
    local_user_id = getattr(request.state, "local_user_id", None)
    if local_user_id:
        return str(local_user_id)
    return str(uuid_mod.uuid5(uuid_mod.NAMESPACE_DNS, f"dev-user-{tenant.id}"))


async def _get_user_role(db: AsyncSession, tenant: Tenant, request: Request) -> str:
    """Resolve user role for fine-grained access checks."""
    role_header = request.headers.get("x-user-role")
    if role_header:
        return role_header
    # Use local auth user ID to look up role
    local_user_id = getattr(request.state, "local_user_id", None)
    if local_user_id:
        result = await db.execute(
            text("SELECT role FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": local_user_id, "tid": str(tenant.id)},
        )
        row = result.fetchone()
        if row:
            return row[0]
    return "analyst"


# ── GET /stewardship — list with filters ─────────────────────────────────────


@router.get("/stewardship", response_model=QueueListResponse)
async def list_queue_items(
    request: Request,
    item_type: Optional[str] = None,
    domain: Optional[str] = None,
    status: str = "open",
    assigned_to: Optional[str] = None,
    priority: Optional[int] = None,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    """List stewardship queue items with optional filters."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    role = await _get_user_role(db, tenant, request)

    where_clauses = ["sq.tenant_id = :tid", "sq.status = :status"]
    params: dict = {"tid": str(tenant.id), "status": status}

    if item_type:
        where_clauses.append("sq.item_type = :item_type")
        params["item_type"] = item_type
    if domain:
        where_clauses.append("sq.domain = :domain")
        params["domain"] = domain
    if assigned_to:
        where_clauses.append("sq.assigned_to = :assigned_to")
        params["assigned_to"] = assigned_to
    if priority is not None:
        where_clauses.append("sq.priority = :priority")
        params["priority"] = priority

    where_sql = " AND ".join(where_clauses)

    # Strip AI fields for users without view_ai_confidence permission
    if has_permission(role, "view_ai_confidence"):
        select_cols = QUEUE_COLUMNS
    else:
        select_cols = QUEUE_COLUMNS.replace("ai_recommendation", "NULL as ai_recommendation").replace(
            "ai_confidence", "NULL as ai_confidence"
        )

    # Count total
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM stewardship_queue sq WHERE {where_sql}"),
        params,
    )
    total = count_result.scalar() or 0

    # Fetch page
    result = await db.execute(
        text(
            f"SELECT {select_cols} FROM stewardship_queue sq "
            f"WHERE {where_sql} "
            f"ORDER BY sq.priority ASC, sq.due_at ASC NULLS LAST "
            f"LIMIT :limit OFFSET :offset"
        ),
        {**params, "limit": limit, "offset": offset},
    )
    rows = result.fetchall()

    return QueueListResponse(
        items=[_row_to_item(r) for r in rows],
        total=total,
    )


# ── GET /stewardship/metrics ─────────────────────────────────────────────────


@router.get("/stewardship/metrics", response_model=MetricsResponse)
async def get_stewardship_metrics(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    """Steward productivity dashboard metrics.

    ai_reviewer sees AI Acceptance Rate and proposed rules count,
    but NOT individual steward breakdown.
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    tid = str(tenant.id)

    role = await _get_user_role(db, tenant, request)

    # Items by type
    result = await db.execute(
        text("SELECT item_type, COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid GROUP BY item_type"),
        {"tid": tid},
    )
    items_by_type = {r[0]: r[1] for r in result.fetchall()}

    # Items by status
    result = await db.execute(
        text("SELECT status, COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid GROUP BY status"),
        {"tid": tid},
    )
    items_by_status = {r[0]: r[1] for r in result.fetchall()}

    # Backlog
    result = await db.execute(
        text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :tid AND status IN ('open', 'in_progress')"),
        {"tid": tid},
    )
    backlog_total = result.scalar() or 0

    # Avg resolution time by type
    result = await db.execute(
        text("""
            SELECT item_type,
                AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_hours
            FROM stewardship_queue
            WHERE tenant_id = :tid AND status = 'resolved'
            GROUP BY item_type
        """),
        {"tid": tid},
    )
    avg_resolution = {r[0]: round(float(r[1]), 1) for r in result.fetchall()}

    # SLA compliance rate
    result = await db.execute(
        text("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'resolved' AND (due_at IS NULL OR updated_at <= due_at)) as on_time,
                COUNT(*) FILTER (WHERE status = 'resolved') as total_resolved
            FROM stewardship_queue
            WHERE tenant_id = :tid
        """),
        {"tid": tid},
    )
    sla_row = result.fetchone()
    on_time = sla_row[0] or 0 if sla_row else 0
    total_resolved = sla_row[1] or 0 if sla_row else 0
    sla_compliance = round(on_time / total_resolved, 3) if total_resolved > 0 else 1.0

    # AI Acceptance Rate — visible to admin, steward, ai_reviewer
    ai_acceptance_rate = None
    if has_permission(role, "view_ai_confidence"):
        result = await db.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE ai_recommendation IS NOT NULL) as with_ai,
                    COUNT(*) FILTER (WHERE ai_recommendation IS NOT NULL AND status = 'resolved') as ai_followed
                FROM stewardship_queue
                WHERE tenant_id = :tid
            """),
            {"tid": tid},
        )
        ai_row = result.fetchone()
        with_ai = ai_row[0] or 0 if ai_row else 0
        ai_followed = ai_row[1] or 0 if ai_row else 0
        ai_acceptance_rate = round(ai_followed / with_ai, 3) if with_ai > 0 else None

    # Steward breakdown — NOT visible to ai_reviewer
    steward_breakdown = None
    if role in ("admin", "steward") and role != "ai_reviewer":
        result = await db.execute(
            text("""
                SELECT
                    COALESCE(u.name, sq.assigned_to::text, 'Unassigned') as steward_name,
                    COUNT(*) FILTER (WHERE sq.status = 'resolved') as resolved,
                    COUNT(*) as total,
                    AVG(EXTRACT(EPOCH FROM (sq.updated_at - sq.created_at)) / 3600)
                        FILTER (WHERE sq.status = 'resolved') as avg_hours
                FROM stewardship_queue sq
                LEFT JOIN users u ON u.id = sq.assigned_to
                WHERE sq.tenant_id = :tid
                  AND sq.created_at >= now() - interval '30 days'
                GROUP BY COALESCE(u.name, sq.assigned_to::text, 'Unassigned')
                ORDER BY resolved DESC
            """),
            {"tid": tid},
        )
        steward_breakdown = [
            {
                "steward_name": r[0],
                "resolved": r[1],
                "total": r[2],
                "avg_resolution_hours": round(float(r[3]), 1) if r[3] else None,
            }
            for r in result.fetchall()
        ]

    return MetricsResponse(
        items_by_type=items_by_type,
        items_by_status=items_by_status,
        avg_resolution_hours_by_type=avg_resolution,
        backlog_total=backlog_total,
        sla_compliance_rate=sla_compliance,
        ai_acceptance_rate=ai_acceptance_rate,
        steward_breakdown=steward_breakdown,
    )


# ── GET /stewardship/{id} — single item with context ────────────────────────


@router.get("/stewardship/{item_id}", response_model=QueueItemOut)
async def get_queue_item(
    item_id: Annotated[str, Path(pattern=_UUID_RE)],
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    role = await _get_user_role(db, tenant, request)
    if has_permission(role, "view_ai_confidence"):
        select_cols = QUEUE_COLUMNS
    else:
        select_cols = QUEUE_COLUMNS.replace("ai_recommendation", "NULL as ai_recommendation").replace(
            "ai_confidence", "NULL as ai_confidence"
        )

    result = await db.execute(
        text(f"SELECT {select_cols} FROM stewardship_queue sq WHERE sq.id = :id AND sq.tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Queue item not found")

    return _row_to_item(row)


# ── PUT /stewardship/{id}/assign ─────────────────────────────────────────────


@router.put("/stewardship/{item_id}/assign")
async def assign_queue_item(
    item_id: Annotated[str, Path(pattern=_UUID_RE)],
    body: AssignBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text("UPDATE stewardship_queue SET assigned_to = :uid, status = 'in_progress', updated_at = now() WHERE id = :id AND tenant_id = :tid RETURNING id"),
        {"uid": body.user_id, "id": item_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Queue item not found")

    await db.commit()
    return {"id": item_id, "status": "in_progress", "assigned_to": body.user_id}


# ── PUT /stewardship/{id}/resolve ────────────────────────────────────────────


@router.put("/stewardship/{item_id}/resolve")
async def resolve_queue_item(
    item_id: Annotated[str, Path(pattern=_UUID_RE)],
    body: ResolveBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    """Resolve a queue item — approve or reject.

    ai_reviewer role CANNOT resolve data actions (HTTP 403).
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    role = await _get_user_role(db, tenant, request)
    if role == "ai_reviewer":
        raise HTTPException(
            status_code=403,
            detail="AI Reviewer role cannot approve data actions. Contact a Steward or Admin.",
        )

    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")

    # Fetch the queue item
    result = await db.execute(
        text(f"SELECT {QUEUE_COLUMNS} FROM stewardship_queue WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Queue item not found")

    item = _row_to_item(row)
    user_id = await _resolve_user_id(db, tenant, request)

    # Apply the resolution to the source record
    await _apply_source_action(db, item, body.action, user_id, body.notes)

    # Mark queue item resolved
    await db.execute(
        text("UPDATE stewardship_queue SET status = 'resolved', updated_at = now() WHERE id = :id AND tenant_id = :tid"),
        {"id": item_id, "tid": str(tenant.id)},
    )

    await db.commit()
    return {"id": item_id, "status": "resolved", "action": body.action}


async def _apply_source_action(
    db: AsyncSession, item: QueueItemOut, action: str, user_id: str, notes: str | None
) -> None:
    """Apply the steward's decision to the source record."""
    if item.item_type == "merge_decision":
        if action == "approve":
            await db.execute(
                text("UPDATE match_scores SET reviewed_by = :uid, reviewed_at = now() WHERE id = :sid"),
                {"uid": user_id, "sid": item.source_id},
            )
        # reject leaves match_score unreviewed

    elif item.item_type == "golden_record_review":
        if action == "approve":
            await db.execute(
                text("UPDATE master_records SET status = 'golden', promoted_by = :uid, promoted_at = now() WHERE id = :sid"),
                {"uid": user_id, "sid": item.source_id},
            )
            # Create individual audit trail entry
            await db.execute(
                text("""
                    INSERT INTO master_record_history (id, tenant_id, master_record_id, action, changed_by, changed_at, details)
                    VALUES (gen_random_uuid(), :tid, :mid, 'promoted_via_workbench', :uid, now(), :details)
                """),
                {"tid": item.tenant_id, "mid": item.source_id, "uid": user_id, "details": f'{{"notes": "{notes or ""}"}}'},
            )
        elif action == "reject":
            await db.execute(
                text("UPDATE master_records SET status = 'candidate' WHERE id = :sid"),
                {"sid": item.source_id},
            )

    elif item.item_type == "exception":
        if action == "approve":
            await db.execute(
                text("UPDATE exceptions SET status = 'resolved', resolved_at = now(), resolution_notes = :notes WHERE id = :sid"),
                {"sid": item.source_id, "notes": notes or "Resolved via stewardship workbench"},
            )

    elif item.item_type == "writeback_approval":
        if action == "approve":
            await db.execute(
                text("UPDATE cleaning_queue SET status = 'applied', applied_at = now() WHERE id = :sid"),
                {"sid": item.source_id},
            )
        elif action == "reject":
            await db.execute(
                text("UPDATE cleaning_queue SET status = 'rejected' WHERE id = :sid"),
                {"sid": item.source_id},
            )

    elif item.item_type == "glossary_review":
        if action == "approve":
            await db.execute(
                text("UPDATE glossary_terms SET last_reviewed_at = now(), updated_at = now() WHERE id = :sid"),
                {"sid": item.source_id},
            )


# ── PUT /stewardship/{id}/escalate ───────────────────────────────────────────


@router.put("/stewardship/{item_id}/escalate")
async def escalate_queue_item(
    item_id: Annotated[str, Path(pattern=_UUID_RE)],
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view")),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text(
            "UPDATE stewardship_queue SET status = 'escalated', priority = GREATEST(priority - 1, 1), updated_at = now() "
            "WHERE id = :id AND tenant_id = :tid RETURNING id"
        ),
        {"id": item_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Queue item not found")

    await db.commit()
    return {"id": item_id, "status": "escalated"}


# ── POST /stewardship/bulk-approve ───────────────────────────────────────────


@router.post("/stewardship/bulk-approve", response_model=BulkApproveResponse)
async def bulk_approve(
    body: BulkApproveBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    """Bulk approve items above a confidence threshold.

    Creates individual audit trail entries for each item (not one bulk row).
    ai_reviewer role returns 403.
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    role = await _get_user_role(db, tenant, request)
    if role == "ai_reviewer":
        raise HTTPException(
            status_code=403,
            detail="AI Reviewer role cannot approve data actions. Contact a Steward or Admin.",
        )

    user_id = await _resolve_user_id(db, tenant, request)
    approved = 0
    history_rows = 0

    for iid in body.item_ids:
        result = await db.execute(
            text(f"SELECT {QUEUE_COLUMNS} FROM stewardship_queue WHERE id = :id AND tenant_id = :tid AND status IN ('open', 'in_progress')"),
            {"id": iid, "tid": str(tenant.id)},
        )
        row = result.fetchone()
        if not row:
            continue

        item = _row_to_item(row)

        # Only approve if above confidence threshold
        if item.ai_confidence is not None and item.ai_confidence < body.min_confidence:
            continue

        # Apply source action individually
        await _apply_source_action(db, item, "approve", user_id, "Bulk approved via stewardship workbench")
        approved += 1

        # Individual history row for golden_record_review items
        if item.item_type == "golden_record_review":
            history_rows += 1

        # Mark resolved
        await db.execute(
            text("UPDATE stewardship_queue SET status = 'resolved', updated_at = now() WHERE id = :id"),
            {"id": iid},
        )

    await db.commit()

    return BulkApproveResponse(approved=approved, history_rows_created=history_rows)


