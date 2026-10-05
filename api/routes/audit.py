"""Audit log API — read-only access to general mutation audit_log rows.

Mutations are appended automatically by api.middleware.audit. This route
is the admin-facing viewer. Admin role (manage_users permission) required.
"""

import csv
import io
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["audit"])


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


_COLUMNS = ("id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
            "status_code, ip, user_agent, before_json, after_json, created_at")
_EXPORT_MAX = 100_000
_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def _filters(tenant: Tenant, actor_user_id, entity_type, entity_id, action, method, since, until) -> tuple[str, dict]:
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}
    for value, clause, key in (
        (actor_user_id, "actor_user_id = :actor", "actor"),
        (entity_type, "entity_type = :etype", "etype"),
        (entity_id, "entity_id = :eid", "eid"),
        (action, "action = :action", "action"),
        (method.upper() if method else None, "method = :method", "method"),
        (since, "created_at >= :since", "since"),
        (until, "created_at <= :until", "until"),
    ):
        if value:
            conditions.append(clause)
            params[key] = value
    return " AND ".join(conditions), params


def _entry(row) -> dict:
    d = dict(row._mapping)
    for k in ("id", "actor_user_id"):
        if d.get(k):
            d[k] = str(d[k])
    if d.get("created_at"):
        d["created_at"] = d["created_at"].isoformat()
    return d


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
    where_clause, params = _filters(tenant, actor_user_id, entity_type, entity_id, action, method, since, until)

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
            SELECT {_COLUMNS}
            FROM audit_log
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )
    entries = [_entry(row) for row in result.fetchall()]

    return {"entries": entries, "total": total, "limit": limit, "offset": offset}


def _csv_cell(value) -> str:
    if value is None:
        return ""
    s = value if isinstance(value, str) else json.dumps(value, default=str) if isinstance(value, (dict, list)) else str(value)
    return "'" + s if s.startswith(_FORMULA) else s  # spreadsheet formula injection


@router.get("/audit/export")
async def export_audit_entries(
    actor_user_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    method: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    """Audit log as CSV for auditors and SIEM import, oldest first, same filters as /audit.
    Capped at 100,000 rows; narrow with since/until for longer histories."""
    await _set_rls(db, tenant.id)
    where_clause, params = _filters(tenant, actor_user_id, entity_type, entity_id, action, method, since, until)
    params["limit"] = _EXPORT_MAX
    result = await db.execute(
        text(f"SELECT {_COLUMNS} FROM audit_log WHERE {where_clause} ORDER BY created_at LIMIT :limit"),
        params,
    )
    buf = io.StringIO()
    out = csv.writer(buf)
    cols = [c.strip() for c in _COLUMNS.split(",")]
    out.writerow(cols)
    for row in result.fetchall():
        d = _entry(row)
        out.writerow([_csv_cell(d.get(c)) for c in cols])
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit_log.csv"'},
    )


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
