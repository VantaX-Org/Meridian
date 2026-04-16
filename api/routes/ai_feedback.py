"""AI feedback and proposed rules review endpoints.

POST /ai/feedback — steward correction capture, triggers rule proposal after 10 corrections
GET /ai/proposed-rules — list pending proposed rules
POST /ai/proposed-rules/{id}/approve — promote to match_rules
POST /ai/proposed-rules/{id}/reject — reject proposal
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["ai-feedback"])


# ── Request/Response models ──────────────────────────────────────────────────


class AIFeedbackBody(BaseModel):
    queue_item_id: str
    steward_decision: str
    correction_reason: Optional[str] = None
    domain: str


class AIFeedbackResponse(BaseModel):
    id: str
    status: str


class ProposedRuleOut(BaseModel):
    id: str
    tenant_id: str
    domain: str
    proposed_rule: dict
    rationale: str
    supporting_correction_count: int
    status: str
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    created_at: str


class ProposedRulesListResponse(BaseModel):
    rules: list[ProposedRuleOut]
    total: int


class ApproveResponse(BaseModel):
    id: str
    status: str
    match_rule_id: str


class RejectResponse(BaseModel):
    id: str
    status: str


# ── POST /ai/feedback ───────────────────────────────────────────────────────


@router.post("/ai/feedback", response_model=AIFeedbackResponse)
async def submit_ai_feedback(
    body: AIFeedbackBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("ai_feedback")),
):
    """Record a steward's correction of an AI recommendation.

    When 10+ corrections accumulate for a domain in 7 days,
    enqueues the rule_proposal_task to generate new proposed rules.
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # Resolve steward user ID
    steward_id = await _resolve_user_id(db, tenant, request)

    # Look up the AI recommendation from the queue item (best-effort)
    ai_recommendation = await _get_ai_recommendation(db, body.queue_item_id)

    feedback_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO ai_feedback_log "
            "(id, tenant_id, queue_item_id, steward_id, ai_recommendation, "
            " steward_decision, correction_reason, domain) "
            "VALUES (:id, :tid, :qid, :sid, :ai_rec, :decision, :reason, :domain)"
        ),
        {
            "id": feedback_id,
            "tid": str(tenant.id),
            "qid": body.queue_item_id,
            "sid": steward_id,
            "ai_rec": ai_recommendation,
            "decision": body.steward_decision,
            "reason": body.correction_reason,
            "domain": body.domain,
        },
    )
    await db.commit()

    # Side effect: check if we should trigger rule proposal
    correction_count = await db.scalar(
        text(
            "SELECT COUNT(*) FROM ai_feedback_log "
            "WHERE tenant_id = :tid AND domain = :domain "
            "AND created_at >= now() - interval '7 days'"
        ),
        {"tid": str(tenant.id), "domain": body.domain},
    )

    if correction_count and correction_count >= 10:
        from workers.tasks.rule_proposal_task import rule_proposal_task
        rule_proposal_task.delay(str(tenant.id), body.domain)

    return AIFeedbackResponse(id=feedback_id, status="recorded")


# ── GET /ai/proposed-rules ───────────────────────────────────────────────────


@router.get("/ai/proposed-rules", response_model=ProposedRulesListResponse)
async def get_proposed_rules(
    status: str = "pending",
    domain: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("review_ai_rules")),
):
    """List AI-proposed rules for review."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    query = (
        "SELECT id, tenant_id, domain, proposed_rule, rationale, "
        "supporting_correction_count, status, reviewed_by, reviewed_at, created_at "
        "FROM ai_proposed_rules "
        "WHERE tenant_id = :tid AND status = :status"
    )
    params: dict = {"tid": str(tenant.id), "status": status}

    if domain:
        query += " AND domain = :domain"
        params["domain"] = domain

    query += " ORDER BY created_at DESC"

    result = await db.execute(text(query), params)
    rows = result.fetchall()

    rules = [
        ProposedRuleOut(
            id=str(r[0]),
            tenant_id=str(r[1]),
            domain=r[2],
            proposed_rule=r[3] if isinstance(r[3], dict) else {},
            rationale=r[4],
            supporting_correction_count=r[5],
            status=r[6],
            reviewed_by=str(r[7]) if r[7] else None,
            reviewed_at=r[8].isoformat() if r[8] else None,
            created_at=r[9].isoformat() if r[9] else "",
        )
        for r in rows
    ]

    return ProposedRulesListResponse(rules=rules, total=len(rules))


# ── POST /ai/proposed-rules/{id}/approve ─────────────────────────────────────


@router.post("/ai/proposed-rules/{rule_id}/approve", response_model=ApproveResponse)
async def approve_proposed_rule(
    rule_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("review_ai_rules")),
):
    """Approve a proposed rule — copies it to match_rules table."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # Load the proposed rule
    result = await db.execute(
        text(
            "SELECT id, domain, proposed_rule, status FROM ai_proposed_rules "
            "WHERE id = :id AND tenant_id = :tid"
        ),
        {"id": rule_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Proposed rule not found")
    if row[3] != "pending":
        raise HTTPException(status_code=400, detail=f"Rule is already {row[3]}")

    proposed = row[2] if isinstance(row[2], dict) else {}
    domain = row[1]

    # Copy to match_rules
    match_rule_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold) "
            "VALUES (:id, :tid, :domain, :field, :match_type, :weight, :threshold)"
        ),
        {
            "id": match_rule_id,
            "tid": str(tenant.id),
            "domain": domain,
            "field": proposed.get("field", ""),
            "match_type": proposed.get("match_type", "exact"),
            "weight": int(proposed.get("weight", 50)),
            "threshold": float(proposed.get("threshold", 0.8)),
        },
    )

    # Update proposed rule status
    reviewer_id = await _resolve_user_id(db, tenant, request)
    await db.execute(
        text(
            "UPDATE ai_proposed_rules "
            "SET status = 'approved', reviewed_by = :uid, reviewed_at = now() "
            "WHERE id = :id"
        ),
        {"id": rule_id, "uid": reviewer_id},
    )

    await db.commit()
    return ApproveResponse(id=rule_id, status="approved", match_rule_id=match_rule_id)


# ── POST /ai/proposed-rules/{id}/reject ──────────────────────────────────────


@router.post("/ai/proposed-rules/{rule_id}/reject", response_model=RejectResponse)
async def reject_proposed_rule(
    rule_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("review_ai_rules")),
):
    """Reject a proposed rule."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    result = await db.execute(
        text(
            "SELECT id, status FROM ai_proposed_rules "
            "WHERE id = :id AND tenant_id = :tid"
        ),
        {"id": rule_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Proposed rule not found")
    if row[1] != "pending":
        raise HTTPException(status_code=400, detail=f"Rule is already {row[1]}")

    reviewer_id = await _resolve_user_id(db, tenant, request)
    await db.execute(
        text(
            "UPDATE ai_proposed_rules "
            "SET status = 'rejected', reviewed_by = :uid, reviewed_at = now() "
            "WHERE id = :id"
        ),
        {"id": rule_id, "uid": reviewer_id},
    )

    await db.commit()
    return RejectResponse(id=rule_id, status="rejected")


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _resolve_user_id(db: AsyncSession, tenant: Tenant, request: Request) -> str:
    """Resolve current user ID from request context."""
    # Use local auth user ID if available
    local_user_id = getattr(request.state, "local_user_id", None)
    if local_user_id:
        return str(local_user_id)

    # Fallback: return a deterministic UUID for dev mode
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"dev-user-{tenant.id}"))


async def _get_ai_recommendation(db: AsyncSession, queue_item_id: str) -> str:
    """Look up what the AI recommended for this queue item (best-effort)."""
    try:
        result = await db.execute(
            text(
                "SELECT merge_preview FROM cleaning_queue WHERE id = :id"
            ),
            {"id": queue_item_id},
        )
        row = result.fetchone()
        if row and row[0]:
            return "auto_merge" if isinstance(row[0], dict) else "unknown"
    except Exception:
        pass
    return "unknown"
