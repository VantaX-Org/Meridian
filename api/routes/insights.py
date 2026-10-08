"""GET endpoints backing the /insights/* pages (spec 8). All computation is
deterministic — no LLM calls anywhere in this module."""
import uuid
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.insights_readiness import build_readiness_grid
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


@router.get("/readiness", dependencies=[Depends(require_permission("view"))])
async def get_readiness(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    thresholds = (await db.execute(
        text("SELECT alert_thresholds FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).scalar() or {}
    waves = thresholds.get("readiness_waves") or {}
    dqs_threshold = thresholds.get("readiness_dqs_threshold", 70)
    if not waves:
        raise HTTPException(409, "No readiness_waves configured — set them under Settings > Alert Thresholds")

    # module_results: migration_runs.gap_summary, JSONB keyed by module (ModuleResult-shaped,
    # see workers/tasks/run_migration.py's _finish()). Explicit version_id picks the run whose
    # source_version_id matches it; otherwise take this tenant's latest analysed run.
    run_row = (await db.execute(
        text("""
            SELECT gap_summary, source_version_id FROM migration_runs
            WHERE tenant_id = :t AND status = 'analysed'
              AND (CAST(:vid AS uuid) IS NULL OR source_version_id = :vid)
            ORDER BY completed_at DESC LIMIT 1
        """),
        {"t": str(tenant.id), "vid": str(version_id) if version_id else None},
    )).fetchone()
    gap_summary = (run_row[0] if run_row else {}) or {}
    resolved_version_id = run_row[1] if run_row else version_id
    module_results = {
        module: SimpleNamespace(verdict=data.get("verdict"), blocked_records=data.get("blocked_records", 0))
        for module, data in gap_summary.items()
    }

    # dqs_by_module: analysis_versions.dqs_summary, JSONB keyed by module, scoped to the same
    # resolved_version_id so both lookups agree on "which run" (same pattern as
    # api/routes/system_objects.py's system_versions/trends handlers).
    dqs_summary = {}
    if resolved_version_id:
        dqs_row = (await db.execute(
            text("SELECT dqs_summary FROM analysis_versions WHERE id = :vid AND tenant_id = :t"),
            {"vid": str(resolved_version_id), "t": str(tenant.id)},
        )).fetchone()
        dqs_summary = (dqs_row[0] if dqs_row else {}) or {}
    dqs_by_module = {m: (d or {}).get("composite_score") for m, d in dqs_summary.items()}

    cells = build_readiness_grid(module_results, dqs_by_module, waves, dqs_threshold)
    return {
        "version_id": str(resolved_version_id) if resolved_version_id else None,
        "threshold": dqs_threshold,
        "cells": [c.__dict__ for c in cells],
    }
