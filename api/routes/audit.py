"""Audit log API — read-only access to general mutation audit_log rows.

Mutations are appended automatically by api.middleware.audit. This route
is the admin-facing viewer. Admin role (manage_users permission) required.
"""

import csv
import io
import json
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.branded_xlsx import (
    ColumnSpec,
    SheetSpec,
    build_workbook,
    guard_formula_cell,
    xlsx_filename,
    xlsx_response,
)
from api.services.rbac import require_any_permission, require_permission

router = APIRouter(prefix="/api/v1", tags=["audit"])


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


_COLUMNS = ("id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
            "status_code, ip, user_agent, before_json, after_json, created_at")
_EXPORT_MAX = 100_000
# Rows fetched per round trip while streaming the CSV export (keyset paged on created_at, id).
_EXPORT_BATCH = 2_000


def _instant(value: Optional[str], name: str) -> Optional[datetime]:
    """An ISO-8601 since/until bound as a datetime, so the driver binds a timestamp, not text."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be an ISO-8601 timestamp") from None


def _filters(
    tenant: Tenant,
    actor_user_id: Optional[str],
    entity_type: Optional[str],
    entity_id: Optional[str],
    action: Optional[str],
    method: Optional[str],
    since: Optional[str],
    until: Optional[str],
    path_contains: Optional[str] = None,
) -> tuple[str, dict]:
    conditions = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}
    for value, clause, key in (
        (actor_user_id, "actor_user_id = :actor", "actor"),
        (entity_type, "entity_type = :etype", "etype"),
        (entity_id, "entity_id = :eid", "eid"),
        (action, "action = :action", "action"),
        (method.upper() if method else None, "method = :method", "method"),
        (_instant(since, "since"), "created_at >= :since", "since"),
        (_instant(until, "until"), "created_at <= :until", "until"),
    ):
        if value:
            conditions.append(clause)
            params[key] = value
    if path_contains:
        # Entities keyed by something other than a UUID/number (object names, material numbers)
        # have no entity_id, so the detail pages match on the request path instead.
        escaped = path_contains.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append("path ILIKE :pathlike ESCAPE '\\'")
        params["pathlike"] = f"%{escaped}%"
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
    path_contains: Optional[str] = Query(
        None, max_length=200, description="Substring of the request path (case-insensitive)"
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_any_permission("view_audit", "manage_users")),
):
    """List audit log entries for this tenant, newest first."""
    await _set_rls(db, tenant.id)
    where_clause, params = _filters(tenant, actor_user_id, entity_type, entity_id, action, method, since, until, path_contains)

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
    return guard_formula_cell(s)  # spreadsheet formula injection


def _csv_line(values: list) -> str:
    buf = io.StringIO()
    csv.writer(buf).writerow(values)
    return buf.getvalue()


async def _stream_csv(db: AsyncSession, where_clause: str, params: dict, cols: list[str]) -> AsyncIterator[str]:
    """The CSV a batch at a time: header, then rows oldest first, keyset paged on (created_at, id)
    so a 100,000-row export never sits in memory at once. Every cell goes through the formula guard."""
    yield _csv_line(cols)
    sent = 0
    after: Optional[tuple] = None
    while sent < _EXPORT_MAX:
        batch_params = {**params, "limit": min(_EXPORT_BATCH, _EXPORT_MAX - sent)}
        keyset = ""
        if after is not None:
            keyset = " AND (created_at, id) > (:after_ts, :after_id)"
            batch_params["after_ts"], batch_params["after_id"] = after
        result = await db.execute(
            text(f"SELECT {_COLUMNS} FROM audit_log WHERE {where_clause}{keyset} "
                 "ORDER BY created_at, id LIMIT :limit"),
            batch_params,
        )
        rows = result.fetchall()
        if not rows:
            return
        for row in rows:
            d = _entry(row)
            yield _csv_line([_csv_cell(d.get(c)) for c in cols])
        sent += len(rows)
        last = rows[-1]._mapping
        after = (last["created_at"], last["id"])
        if len(rows) < batch_params["limit"]:
            return


@router.get("/audit/export")
async def export_audit_entries(
    actor_user_id: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    method: Optional[str] = Query(None),
    since: Optional[str] = Query(None, description="ISO-8601 timestamp — from (inclusive)"),
    until: Optional[str] = Query(None, description="ISO-8601 timestamp — to (inclusive)"),
    path_contains: Optional[str] = Query(
        None, max_length=200, description="Substring of the request path (case-insensitive)"
    ),
    format: Literal["csv", "xlsx"] = Query("csv"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_any_permission("view_audit", "manage_users")),
):
    """Audit log as CSV or XLSX for auditors and SIEM import, oldest first, same filters as /audit
    (including the from/to window as since/until). CSV streams in batches; both formats are capped
    at 100,000 rows, so narrow with since/until for longer histories."""
    await _set_rls(db, tenant.id)
    where_clause, params = _filters(tenant, actor_user_id, entity_type, entity_id, action, method, since, until, path_contains)
    cols = [c.strip() for c in _COLUMNS.split(",")]

    if format == "csv":
        return StreamingResponse(
            _stream_csv(db, where_clause, params, cols),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="audit_log.csv"'},
        )

    params["limit"] = _EXPORT_MAX
    result = await db.execute(
        text(f"SELECT {_COLUMNS} FROM audit_log WHERE {where_clause} ORDER BY created_at, id LIMIT :limit"),
        params,
    )
    entries = [_entry(row) for row in result.fetchall()]
    sheet = SheetSpec(
        title="Audit log",
        columns=[ColumnSpec(key=c, header=c, kind="mono" if c.endswith("_id") or c == "id" else "text") for c in cols],
        rows=entries,
    )
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=None,
        run_id=None,
        title="Audit log export",
        sheets=[sheet],
    )
    return xlsx_response(data, xlsx_filename("audit-log", None))


@router.get("/audit/summary")
async def audit_summary(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_any_permission("view_audit", "manage_users")),
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
    # The exact count of every recorded event in the window: the kinds above are capped, so their sum can fall short.
    total = (await db.execute(
        text("SELECT COUNT(*) FROM audit_log WHERE tenant_id = :tid AND created_at >= now() - interval '30 days'"),
        {"tid": str(tenant.id)},
    )).scalar() or 0
    return {"summary": rows, "total": total}


class LlmAuditEntry(BaseModel):
    id: str
    service_name: str
    called_at: Optional[str] = None
    model_version: Optional[str] = None
    prompt_hash: Optional[str] = None
    token_count: Optional[int] = None
    latency_ms: Optional[int] = None
    success: Optional[bool] = None
    deterministic_hit: Optional[bool] = None
    skip_reason: Optional[str] = None


class LlmCacheSummary(BaseModel):
    service_name: str
    decisions: int
    deterministic: int


class LlmAuditOut(BaseModel):
    entries: list[LlmAuditEntry]
    total: int
    limit: int
    offset: int
    cache: list[LlmCacheSummary]


@router.get("/audit/llm", response_model=LlmAuditOut)
async def list_llm_audit(
    service_name: Optional[str] = Query(None),
    success: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_any_permission("view_audit", "manage_users")),
) -> LlmAuditOut:
    """LLM call audit (llm_audit_log, newest first, paged) plus a per-service
    summary of the persistent decision cache. Prompt text is never stored, only hashes."""
    await _set_rls(db, tenant.id)
    conds = ["tenant_id = :tid"]
    params: dict = {"tid": str(tenant.id)}
    if service_name:
        conds.append("service_name = :svc")
        params["svc"] = service_name
    if success is not None:
        conds.append("success = :ok")
        params["ok"] = success
    where = " AND ".join(conds)

    total = (await db.execute(text(f"SELECT COUNT(*) FROM llm_audit_log WHERE {where}"), params)).scalar() or 0
    rows = await db.execute(
        text(
            f"""
            SELECT id, service_name, called_at, model_version, prompt_hash, token_count,
                   latency_ms, success, deterministic_hit, skip_reason
            FROM llm_audit_log WHERE {where}
            ORDER BY called_at DESC LIMIT :limit OFFSET :offset
            """
        ),
        {**params, "limit": limit, "offset": offset},
    )
    entries = []
    for r in rows.fetchall():
        d = dict(r._mapping)
        d["id"] = str(d["id"])
        if d.get("called_at"):
            d["called_at"] = d["called_at"].isoformat()
        entries.append(d)

    cache = await db.execute(
        text(
            """
            SELECT service_name, COUNT(*) AS decisions,
                   COUNT(*) FILTER (WHERE deterministic_hit) AS deterministic
            FROM llm_decision_cache WHERE tenant_id = :tid
            GROUP BY service_name ORDER BY decisions DESC
            """
        ),
        {"tid": str(tenant.id)},
    )
    cache_summary = [dict(r._mapping) for r in cache.fetchall()]
    return LlmAuditOut(
        entries=[LlmAuditEntry(**e) for e in entries], total=total, limit=limit, offset=offset,
        cache=[LlmCacheSummary(**c) for c in cache_summary],
    )
