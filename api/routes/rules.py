"""Rules API — read-only list/detail endpoints for the customer-side rules viewer.

Rules are managed centrally in Meridian HQ and pushed via the licence manifest.
Customer admins can view rules but cannot create, edit, or delete them.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["rules"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))


# ── GET /api/v1/rules ─────────────────────────────────────────────────────────


@router.get("/rules")
async def list_rules(
    category: Optional[str] = Query(None, description="Filter by category: ecc, successfactors, warehouse"),
    module: Optional[str] = Query(None, description="Filter by module name"),
    severity: Optional[str] = Query(None, description="Filter by severity: critical, high, medium, low, info"),
    enabled: Optional[bool] = Query(None, description="Filter by enabled status"),
    search: Optional[str] = Query(None, description="Text search across name and description"),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List all rules for this tenant. Admin role required."""
    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if category:
        conditions.append("category = :category")
        params["category"] = category

    if module:
        conditions.append("module = :module")
        params["module"] = module

    if severity:
        conditions.append("severity = :severity")
        params["severity"] = severity

    if enabled is not None:
        conditions.append("enabled = :enabled")
        params["enabled"] = enabled

    if search:
        conditions.append("(name ILIKE :search OR description ILIKE :search)")
        params["search"] = f"%{search}%"

    where_clause = " AND ".join(conditions)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM rules WHERE {where_clause}"),
        params,
    )
    total = count_result.scalar() or 0

    params["limit"] = limit
    params["offset"] = offset
    result = await db.execute(
        text(f"""
            SELECT id, name, description, module, category, severity,
                   enabled, conditions, thresholds, tags, source_yaml, source,
                   created_at, updated_at
            FROM rules
            WHERE {where_clause}
            ORDER BY category, module, name
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rules = [_row_to_dict(r) for r in result.fetchall()]

    # Serialise UUIDs and datetimes for JSON response
    for rule in rules:
        if rule.get("id"):
            rule["id"] = str(rule["id"])
        for dt_field in ("created_at", "updated_at"):
            if rule.get(dt_field):
                rule[dt_field] = rule[dt_field].isoformat()

    return {"rules": rules, "total": total, "limit": limit, "offset": offset}


# ── GET /api/v1/rules/summary ─────────────────────────────────────────────────


@router.get("/rules/summary")
async def rules_summary(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return rule counts grouped by category and severity."""
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT category, severity, enabled,
                   COUNT(*) AS count
            FROM rules
            WHERE tenant_id = :tid
            GROUP BY category, severity, enabled
            ORDER BY category, severity
        """),
        {"tid": str(tenant.id)},
    )
    rows = [_row_to_dict(r) for r in result.fetchall()]
    return {"summary": rows}


# ── GET /api/v1/rules/{rule_id} ───────────────────────────────────────────────


@router.get("/rules/{rule_id}")
async def get_rule(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return a single rule by ID."""
    await _set_rls(db, tenant.id)

    try:
        uid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rule ID")

    result = await db.execute(
        text("""
            SELECT id, name, description, module, category, severity,
                   enabled, conditions, thresholds, tags, source_yaml, source,
                   created_at, updated_at
            FROM rules
            WHERE id = :rid AND tenant_id = :tid
        """),
        {"rid": str(uid), "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule = _row_to_dict(row)
    rule["id"] = str(rule["id"])
    for dt_field in ("created_at", "updated_at"):
        if rule.get(dt_field):
            rule[dt_field] = rule[dt_field].isoformat()

    return rule
