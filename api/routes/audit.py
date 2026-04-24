"""Audit log API — read-only access to general mutation audit_log rows.

Mutations are appended automatically by api.middleware.audit. This route
is the admin-facing viewer. Admin role (manage_users permission) required.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["audit"])


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


@router.get("/audit")
async def list_audit_entries(
    actor_user_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    method: Optional[str] = Query(None),
    since: Optional[str] = Query(
        None, description="ISO-8601 timestamp — return entries at or after this time"
    ),
    until: Optional[str] = Query(
        None, description="ISO-8601 timestamp — return entries at or before this time"
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    """List audit log entries for this tenant, newest first."""
    await _set_rls(db, tenant.id)

    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}

    if actor_user_id:
        conditions.append("actor_user_id = :actor")
        params["actor"] = actor_user_id
    if entity_type:
        conditions.append("entity_type = :etype")
        params["etype"] = entity_type
    if entity_id:
        conditions.append("entity_id = :eid")
        params["eid"] = entity_id
    if action:
        conditions.append("action = :action")
        params["action"] = action
    if method:
        conditions.append("method = :method")
        params["method"] = method.upper()
    if since:
        conditions.append("created_at >= :since")
        params["since"] = since
    if until:
        conditions.append("created_at <= :until")
        params["until"] = until

    where_clause = " AND ".join(conditions)

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM audit_log WHERE {where_clause}"),
        params,
    )
    total = count_result.scalar() or 0

    params["limit"] = limit
    params["offset"] = offset
    result = await db.execute(
        text(
            f"""
            SELECT id, actor_user_id, actor_email, action, entity_type,
                   entity_id, method, path, status_code, ip, user_agent,
                   before_json, after_json, created_at
            FROM audit_log
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )
    entries = []
    for row in result.fetchall():
        d = dict(row._mapping)
        if d.get("id"):
            d["id"] = str(d["id"])
        if d.get("actor_user_id"):
            d["actor_user_id"] = str(d["actor_user_id"])
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        entries.append(d)

    return {"entries": entries, "total": total, "limit": limit, "offset": offset}


@router.get("/audit/summary")
async def audit_summary(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    """Counts grouped by action + entity_type for the last 30 days.
    Used by the Admin overview tile."""
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text(
            """
            SELECT action, entity_type, COUNT(*) AS count
            FROM audit_log
            WHERE tenant_id = :tid
              AND created_at >= now() - interval '30 days'
            GROUP BY action, entity_type
            ORDER BY count DESC
            LIMIT 50
            """
        ),
        {"tid": str(tenant.id)},
    )
    rows = [dict(r._mapping) for r in result.fetchall()]
    return {"summary": rows}
