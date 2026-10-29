"""GET /api/v1/versions/{version_id}/changes: how each data table of an extraction was read and what changed since
the previous one (extraction_changes, api/services/delta_extraction.py). Counts only, never values."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission, scope_from_path

router = APIRouter(prefix="/api/v1", tags=["versions"])


@router.get("/versions/{version_id}/changes",
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def version_changes(version_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    t = str(tenant.id)
    meta = (await db.execute(text("SELECT metadata->'delta' FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                             {"v": str(version_id), "t": t})).fetchone()
    if meta is None:
        raise HTTPException(status_code=404, detail="Version not found")
    rows = [dict(r) for r in (await db.execute(text("""
        SELECT table_name AS table, mode, rows_read, rows_total, inserted, updated, deleted, unchanged, duration_s
          FROM extraction_changes WHERE tenant_id = :t AND version_id = :v ORDER BY table_name"""),
        {"t": t, "v": str(version_id)})).mappings().all()]
    compared = [r for r in rows if r["inserted"] is not None]
    total = {k: sum(int(r[k] or 0) for r in compared) for k in ("inserted", "updated", "deleted", "unchanged")}
    return {"version_id": str(version_id), "delta": meta[0], "tables": rows,
            "totals": {"rows_read": sum(int(r["rows_read"]) for r in rows),
                       "rows_total": sum(int(r["rows_total"] or 0) for r in rows),
                       **({**total, "changed": total["inserted"] + total["updated"] + total["deleted"]} if compared
                          else {"inserted": None, "updated": None, "deleted": None, "unchanged": None, "changed": None})}}
