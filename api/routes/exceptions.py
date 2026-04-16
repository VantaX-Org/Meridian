"""Exception management API routes — 13 endpoints."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.exception_engine import ExceptionBillingCalculator
from api.services.rbac import has_permission, require_permission

router = APIRouter(prefix="/api/v1", tags=["exceptions"])


# ── Pydantic models ──────────────────────────────────────────────────────────


class CreateExceptionBody(BaseModel):
    type: str
    category: str
    severity: str
    title: str
    description: str
    affected_records: Optional[dict] = None
    object_type: Optional[str] = None


class AssignBody(BaseModel):
    user_id: str
    user_name: str = "Unknown"


class EscalateBody(BaseModel):
    reason: str
    tier: Optional[int] = None


class ResolveBody(BaseModel):
    resolution_type: str
    resolution_notes: str
    root_cause_category: str


class CommentBody(BaseModel):
    text: str
    user_name: str = "system"


class CreateRuleBody(BaseModel):
    name: str
    description: str
    rule_type: str
    object_type: str
    condition: str
    severity: str
    auto_assign_to: Optional[str] = None


class UpdateRuleBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rule_type: Optional[str] = None
    object_type: Optional[str] = None
    condition: Optional[str] = None
    severity: Optional[str] = None
    auto_assign_to: Optional[str] = None
    is_active: Optional[bool] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


# SLA durations by severity
_SLA_HOURS = {"critical": 8, "high": 24, "medium": 72, "low": 168}


# ── 1. GET /api/v1/exceptions — paginated list ──────────────────────────────


@router.get("/exceptions")
async def list_exceptions(
    request: Request,
    type: Optional[str] = None,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    assigned_to: Optional[str] = None,
    category: Optional[str] = None,
    include_queue_status: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if type:
        conditions.append("type = :type")
        params["type"] = type
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if severity:
        conditions.append("severity = :severity")
        params["severity"] = severity
    if assigned_to:
        conditions.append("assigned_to = :assigned_to")
        params["assigned_to"] = assigned_to
    if category:
        conditions.append("category = :category")
        params["category"] = category

    where = " AND ".join(conditions)

    # Count
    count_result = await db.execute(
        text(f"SELECT count(*) FROM exceptions WHERE {where}"), params
    )
    total = count_result.scalar() or 0

    # Fetch page
    offset = (page - 1) * per_page
    params["limit"] = per_page
    params["offset"] = offset

    result = await db.execute(
        text(f"""
            SELECT id, tenant_id, type, category, severity, status, title, description,
                   source_system, source_reference, affected_records, estimated_impact_zar,
                   assigned_to, escalation_tier, sla_deadline, root_cause_category,
                   resolution_type, resolution_notes, linked_finding_id, linked_cleaning_id,
                   billing_tier, created_at, resolved_at, closed_at
            FROM exceptions WHERE {where}
            ORDER BY sla_deadline ASC NULLS LAST, created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.fetchall()
    exceptions = [_row_to_dict(r) for r in rows]

    # Optionally enrich with stewardship_queue status
    if include_queue_status and exceptions:
        user_role = getattr(request.state, 'user_role', 'viewer')
        can_see_ai = has_permission(user_role, 'view_ai_confidence')

        exc_ids = [str(e["id"]) for e in exceptions]
        queue_result = await db.execute(
            text("""
                SELECT source_id, status, ai_recommendation
                FROM stewardship_queue
                WHERE tenant_id = :tid
                  AND item_type = 'exception'
                  AND source_id = ANY(:ids)
            """),
            {"tid": str(tenant.id), "ids": exc_ids},
        )
        queue_map = {str(r[0]): {"status": r[1], "ai_recommendation": r[2]} for r in queue_result.fetchall()}

        for exc in exceptions:
            queue_row = queue_map.get(str(exc["id"]))
            exc["queue_status"] = queue_row["status"] if queue_row else None
            exc["ai_recommendation"] = (
                queue_row["ai_recommendation"] if (queue_row and can_see_ai) else None
            )

    return {
        "exceptions": exceptions,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


# ── 2. GET /api/v1/exceptions/{id} — detail with comments ───────────────────


@router.get("/exceptions/{exception_id}")
async def get_exception(
    exception_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM exceptions WHERE id = :eid AND tenant_id = :tid"),
        {"eid": exception_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Exception not found")

    exc = _row_to_dict(row)

    # Load comments
    comments_result = await db.execute(
        text("""
            SELECT id, exception_id, user_id, user_name, text, created_at
            FROM exception_comments
            WHERE exception_id = :eid AND tenant_id = :tid
            ORDER BY created_at ASC
        """),
        {"eid": exception_id, "tid": str(tenant.id)},
    )
    exc["comments"] = [_row_to_dict(c) for c in comments_result.fetchall()]

    # Load linked finding if present
    if exc.get("linked_finding_id"):
        fr = await db.execute(
            text("SELECT id, module, check_id, severity, dimension, pass_rate FROM findings WHERE id = :fid"),
            {"fid": str(exc["linked_finding_id"])},
        )
        linked = fr.fetchone()
        exc["linked_finding"] = _row_to_dict(linked) if linked else None

    # Load linked cleaning if present
    if exc.get("linked_cleaning_id"):
        cr = await db.execute(
            text("SELECT id, object_type, record_key, status, confidence FROM cleaning_queue WHERE id = :cid"),
            {"cid": str(exc["linked_cleaning_id"])},
        )
        linked = cr.fetchone()
        exc["linked_cleaning"] = _row_to_dict(linked) if linked else None

    return exc


# ── 3. POST /api/v1/exceptions — create manually ────────────────────────────


@router.post("/exceptions", status_code=201)
async def create_exception(
    body: CreateExceptionBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    new_id = str(uuid.uuid4())
    sla_hours = _SLA_HOURS.get(body.severity, 72)
    sla_deadline = datetime.now(timezone.utc) + timedelta(hours=sla_hours)

    await db.execute(
        text("""
            INSERT INTO exceptions (id, tenant_id, type, category, severity, status,
                title, description, affected_records, escalation_tier, sla_deadline, created_at)
            VALUES (:id, :tid, :type, :category, :severity, 'open',
                :title, :description, CAST(:affected_records AS jsonb), 1, :sla_deadline, now())
        """),
        {
            "id": new_id,
            "tid": str(tenant.id),
            "type": body.type,
            "category": body.category,
            "severity": body.severity,
            "title": body.title,
            "description": body.description,
            "affected_records": json.dumps(body.affected_records) if body.affected_records else None,
            "sla_deadline": sla_deadline,
        },
    )
    await db.commit()

    return {"id": new_id, "status": "open"}


# ── 4. PUT /api/v1/exceptions/{id}/assign ────────────────────────────────────


@router.put("/exceptions/{exception_id}/assign")
async def assign_exception(
    exception_id: str,
    body: AssignBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("UPDATE exceptions SET assigned_to = :uid, status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END WHERE id = :eid AND tenant_id = :tid RETURNING id"),
        {"uid": body.user_id, "eid": exception_id, "tid": str(tenant.id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Exception not found")

    # Add comment
    await db.execute(
        text("""
            INSERT INTO exception_comments (id, exception_id, tenant_id, user_name, text, created_at)
            VALUES (gen_random_uuid(), :eid, :tid, 'system', :txt, now())
        """),
        {"eid": exception_id, "tid": str(tenant.id), "txt": f"Assigned to {body.user_name}"},
    )
    await db.commit()

    return {"id": exception_id, "assigned_to": body.user_id}


# ── 5. PUT /api/v1/exceptions/{id}/escalate ──────────────────────────────────


@router.put("/exceptions/{exception_id}/escalate")
async def escalate_exception(
    exception_id: str,
    body: EscalateBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    # Get current tier
    result = await db.execute(
        text("SELECT escalation_tier, severity FROM exceptions WHERE id = :eid AND tenant_id = :tid"),
        {"eid": exception_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Exception not found")

    current_tier = row[0]
    severity = row[1]
    new_tier = body.tier if body.tier else min(current_tier + 1, 4)

    # Recalculate SLA — halve remaining time on escalation
    sla_hours = max(1, _SLA_HOURS.get(severity, 72) // (2 ** (new_tier - 1)))
    new_sla = datetime.now(timezone.utc) + timedelta(hours=sla_hours)

    await db.execute(
        text("""
            UPDATE exceptions SET escalation_tier = :tier, sla_deadline = :sla
            WHERE id = :eid AND tenant_id = :tid
        """),
        {"tier": new_tier, "sla": new_sla, "eid": exception_id, "tid": str(tenant.id)},
    )

    await db.execute(
        text("""
            INSERT INTO exception_comments (id, exception_id, tenant_id, user_name, text, created_at)
            VALUES (gen_random_uuid(), :eid, :tid, 'system', :txt, now())
        """),
        {"eid": exception_id, "tid": str(tenant.id), "txt": f"Escalated to tier {new_tier}: {body.reason}"},
    )
    await db.commit()

    return {"id": exception_id, "escalation_tier": new_tier, "sla_deadline": new_sla.isoformat()}


# ── 6. PUT /api/v1/exceptions/{id}/resolve ───────────────────────────────────


@router.put("/exceptions/{exception_id}/resolve")
async def resolve_exception(
    exception_id: str,
    body: ResolveBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve")),
):
    await _set_rls(db, tenant.id)

    # Map resolution_type to billing_tier
    billing_map = {
        "auto_resolved": 1, "auto-resolved": 1,
        "steward": 2, "steward_resolved": 2,
        "dedup": 3, "complex": 3,
        "custom_rule": 4, "custom": 4,
    }
    billing_tier = billing_map.get(body.resolution_type, 2)

    result = await db.execute(
        text("""
            UPDATE exceptions SET status = 'resolved', resolved_at = now(),
                resolution_type = :rtype, resolution_notes = :rnotes,
                root_cause_category = :rcc, billing_tier = :bt
            WHERE id = :eid AND tenant_id = :tid RETURNING id
        """),
        {
            "rtype": body.resolution_type,
            "rnotes": body.resolution_notes,
            "rcc": body.root_cause_category,
            "bt": billing_tier,
            "eid": exception_id,
            "tid": str(tenant.id),
        },
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Exception not found")

    await db.commit()
    return {"id": exception_id, "status": "resolved", "billing_tier": billing_tier}


# ── 7. POST /api/v1/exceptions/{id}/comment ─────────────────────────────────


@router.post("/exceptions/{exception_id}/comment")
async def add_comment(
    exception_id: str,
    body: CommentBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    # Verify exception exists
    check = await db.execute(
        text("SELECT id FROM exceptions WHERE id = :eid AND tenant_id = :tid"),
        {"eid": exception_id, "tid": str(tenant.id)},
    )
    if not check.fetchone():
        raise HTTPException(status_code=404, detail="Exception not found")

    await db.execute(
        text("""
            INSERT INTO exception_comments (id, exception_id, tenant_id, user_name, text, created_at)
            VALUES (gen_random_uuid(), :eid, :tid, :uname, :txt, now())
        """),
        {"eid": exception_id, "tid": str(tenant.id), "uname": body.user_name, "txt": body.text},
    )
    await db.commit()

    # Return updated comment list
    result = await db.execute(
        text("""
            SELECT id, exception_id, user_id, user_name, text, created_at
            FROM exception_comments
            WHERE exception_id = :eid AND tenant_id = :tid
            ORDER BY created_at ASC
        """),
        {"eid": exception_id, "tid": str(tenant.id)},
    )
    return {"comments": [_row_to_dict(r) for r in result.fetchall()]}


# ── 8. GET /api/v1/exceptions/sap-monitor — last 24h ────────────────────────


@router.get("/exceptions/sap-monitor")
async def get_sap_monitor(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT * FROM exceptions
            WHERE tenant_id = :tid AND type = 'sap_transaction'
                AND created_at > now() - interval '24 hours'
            ORDER BY severity DESC, created_at DESC
        """),
        {"tid": str(tenant.id)},
    )
    rows = result.fetchall()

    # Group by category
    by_category: dict[str, list] = {}
    for r in rows:
        d = _row_to_dict(r)
        cat = d.get("category", "other")
        by_category.setdefault(cat, []).append(d)

    return {"exceptions": [_row_to_dict(r) for r in rows], "by_category": by_category}


# ── 9. GET /api/v1/exceptions/rules — list all rules ────────────────────────


@router.get("/exceptions/rules")
async def list_rules(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("SELECT * FROM exception_rules WHERE tenant_id = :tid ORDER BY created_at DESC"),
        {"tid": str(tenant.id)},
    )
    return {"rules": [_row_to_dict(r) for r in result.fetchall()]}


# ── 10. POST /api/v1/exceptions/rules — create rule ─────────────────────────


@router.post("/exceptions/rules", status_code=201)
async def create_rule(
    body: CreateRuleBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    new_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO exception_rules (id, tenant_id, name, description, rule_type,
                object_type, condition, severity, auto_assign_to, is_active, created_at)
            VALUES (:id, :tid, :name, :desc, :rt, :ot, :cond, :sev, :aat, false, now())
        """),
        {
            "id": new_id,
            "tid": str(tenant.id),
            "name": body.name,
            "desc": body.description,
            "rt": body.rule_type,
            "ot": body.object_type,
            "cond": body.condition,
            "sev": body.severity,
            "aat": body.auto_assign_to,
        },
    )
    await db.commit()
    return {"id": new_id, "is_active": False}


# ── 11. PUT /api/v1/exceptions/rules/{id} — update rule ─────────────────────


@router.put("/exceptions/rules/{rule_id}")
async def update_rule(
    rule_id: str,
    body: UpdateRuleBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    # Explicit whitelist: body field name → SQL column name
    _ALLOWED_RULE_UPDATE_FIELDS: dict[str, str] = {
        "name": "name",
        "description": "description",
        "rule_type": "rule_type",
        "object_type": "object_type",
        "condition": "condition",
        "severity": "severity",
        "auto_assign_to": "auto_assign_to",
    }

    updates = []
    params: dict = {"rid": rule_id, "tid": str(tenant.id)}

    for body_field, col_name in _ALLOWED_RULE_UPDATE_FIELDS.items():
        val = getattr(body, body_field, None)
        if val is not None:
            updates.append(f"{col_name} = :{body_field}")
            params[body_field] = val

    if body.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = body.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(updates)
    result = await db.execute(
        text(f"UPDATE exception_rules SET {set_clause} WHERE id = :rid AND tenant_id = :tid RETURNING id"),
        params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Rule not found")

    await db.commit()

    # Return updated rule
    row = await db.execute(
        text("SELECT * FROM exception_rules WHERE id = :rid AND tenant_id = :tid"),
        {"rid": rule_id, "tid": str(tenant.id)},
    )
    return _row_to_dict(row.fetchone())


# ── 12. GET /api/v1/exceptions/metrics — KPIs ───────────────────────────────


@router.get("/exceptions/metrics")
async def get_metrics(
    period: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    # Open count
    open_r = await db.execute(
        text("SELECT count(*) FROM exceptions WHERE tenant_id = :tid AND status IN ('open', 'investigating', 'pending_approval')"),
        {"tid": tid},
    )
    open_count = open_r.scalar() or 0

    # Resolved count (this week)
    resolved_r = await db.execute(
        text("SELECT count(*) FROM exceptions WHERE tenant_id = :tid AND status = 'resolved' AND resolved_at > now() - interval '7 days'"),
        {"tid": tid},
    )
    resolved_count = resolved_r.scalar() or 0

    # Average resolution hours
    avg_r = await db.execute(
        text("""
            SELECT avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
            FROM exceptions WHERE tenant_id = :tid AND status IN ('resolved', 'verified', 'closed')
                AND resolved_at IS NOT NULL
        """),
        {"tid": tid},
    )
    avg_hours = avg_r.scalar()
    avg_resolution_hours = round(float(avg_hours), 1) if avg_hours else 0

    # SLA compliance
    sla_total = await db.execute(
        text("""
            SELECT count(*) FROM exceptions
            WHERE tenant_id = :tid AND status IN ('resolved', 'verified', 'closed')
                AND resolved_at IS NOT NULL AND sla_deadline IS NOT NULL
        """),
        {"tid": tid},
    )
    sla_met = await db.execute(
        text("""
            SELECT count(*) FROM exceptions
            WHERE tenant_id = :tid AND status IN ('resolved', 'verified', 'closed')
                AND resolved_at IS NOT NULL AND sla_deadline IS NOT NULL
                AND resolved_at <= sla_deadline
        """),
        {"tid": tid},
    )
    total_sla = sla_total.scalar() or 0
    met_sla = sla_met.scalar() or 0
    sla_compliance_pct = round((met_sla / total_sla) * 100, 1) if total_sla > 0 else 100.0

    # By type
    type_r = await db.execute(
        text("SELECT type, count(*) as cnt FROM exceptions WHERE tenant_id = :tid GROUP BY type"),
        {"tid": tid},
    )
    by_type = {r[0]: r[1] for r in type_r.fetchall()}

    # By severity
    sev_r = await db.execute(
        text("SELECT severity, count(*) as cnt FROM exceptions WHERE tenant_id = :tid GROUP BY severity"),
        {"tid": tid},
    )
    by_severity = {r[0]: r[1] for r in sev_r.fetchall()}

    # Overdue SLA count
    overdue_r = await db.execute(
        text("""
            SELECT count(*) FROM exceptions
            WHERE tenant_id = :tid AND status IN ('open', 'investigating', 'pending_approval')
                AND sla_deadline IS NOT NULL AND sla_deadline < now()
        """),
        {"tid": tid},
    )
    overdue_count = overdue_r.scalar() or 0

    return {
        "open_count": open_count,
        "resolved_count": resolved_count,
        "avg_resolution_hours": avg_resolution_hours,
        "sla_compliance_pct": sla_compliance_pct,
        "overdue_count": overdue_count,
        "by_type": by_type,
        "by_severity": by_severity,
    }


# ── 13. GET /api/v1/exceptions/billing — billing for period ─────────────────


@router.get("/exceptions/billing")
async def get_billing(
    period: str = Query(..., description="YYYY-MM format"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)
    tid = str(tenant.id)

    # Check for existing billing record
    existing = await db.execute(
        text("SELECT * FROM exception_billing WHERE tenant_id = :tid AND period = :period"),
        {"tid": tid, "period": period},
    )
    row = existing.fetchone()
    if row:
        return _row_to_dict(row)

    # Compute from resolved exceptions in that period
    result = await db.execute(
        text("""
            SELECT billing_tier FROM exceptions
            WHERE tenant_id = :tid AND status IN ('resolved', 'verified', 'closed')
                AND to_char(resolved_at, 'YYYY-MM') = :period
                AND billing_tier IS NOT NULL
        """),
        {"tid": tid, "period": period},
    )
    exceptions = [{"billing_tier": r[0]} for r in result.fetchall()]

    calculator = ExceptionBillingCalculator()
    billing = calculator.calculate_billing(exceptions, period)
    billing["tenant_id"] = tid

    # Upsert billing record
    await db.execute(
        text("""
            INSERT INTO exception_billing (id, tenant_id, period, tier1_count, tier2_count,
                tier3_count, tier4_count, tier1_amount, tier2_amount, tier3_amount, tier4_amount,
                base_fee, total_amount, created_at)
            VALUES (gen_random_uuid(), :tid, :period, :t1c, :t2c, :t3c, :t4c,
                :t1a, :t2a, :t3a, :t4a, :base, :total, now())
            ON CONFLICT (tenant_id, period) DO UPDATE SET
                tier1_count = :t1c, tier2_count = :t2c, tier3_count = :t3c, tier4_count = :t4c,
                tier1_amount = :t1a, tier2_amount = :t2a, tier3_amount = :t3a, tier4_amount = :t4a,
                total_amount = :total
        """),
        {
            "tid": tid,
            "period": period,
            "t1c": billing["tier1_count"],
            "t2c": billing["tier2_count"],
            "t3c": billing["tier3_count"],
            "t4c": billing["tier4_count"],
            "t1a": billing["tier1_amount"],
            "t2a": billing["tier2_amount"],
            "t3a": billing["tier3_amount"],
            "t4a": billing["tier4_amount"],
            "base": billing["base_fee"],
            "total": billing["total_amount"],
        },
    )
    await db.commit()

    return billing
