"""GET endpoints backing the /insights/* pages (spec 8). All computation is
deterministic — no LLM calls anywhere in this module."""
import uuid
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.config_impact import get_config_impact
from api.routes.record_issues import _rls
from api.services.insights_impact import value_at_risk
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


@router.get("/impact", dependencies=[Depends(require_permission("view"))])
async def get_impact(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)

    # No explicit version — use this tenant's most recent analysis version that
    # actually has config_impact_results rows (same "latest" idea as readiness).
    if version_id is None:
        resolved = (await db.execute(
            text("""
                SELECT av.id FROM analysis_versions av
                WHERE av.tenant_id = :t AND EXISTS (
                    SELECT 1 FROM config_impact_results cir
                    WHERE cir.version_id = av.id AND cir.tenant_id = :t
                )
                ORDER BY av.run_at DESC LIMIT 1
            """),
            {"t": str(tenant.id)},
        )).scalar()
        if resolved is None:
            return {"version_id": None, "rows": []}
        version_id = resolved

    # features_value: tenant's own CostModel.features (api/routes/settings.py), ZAR per
    # blocked record. No numeric default exists in db/seeds/config_impact_rules.yaml, so a
    # feature the tenant hasn't priced is skipped rather than guessing a cost (deviation
    # from the brief's Step 3 "seeded default" — that field does not exist in the YAML).
    cost_model = (await db.execute(
        text("SELECT cost_model FROM tenants WHERE id = :t"),
        {"t": str(tenant.id)},
    )).scalar() or {}
    features_value = cost_model.get("features") or {}

    # Reuse the real config-impact handler instead of re-querying config_impact_results —
    # it is a plain async function, not special FastAPI-only wrapping, so it's callable directly.
    impact = await get_config_impact(str(version_id), db, tenant)

    rows = []
    for r in impact["results"]:
        v = features_value.get(r["feature"])
        if v is None:
            continue
        rows.append({
            "feature": r["feature"],
            "status": r["status"],
            "record_count": r["total_affected_records"],
            "value_per_record": v,
            "value_at_risk": value_at_risk(r["total_affected_records"], v),
            "causing_rules": r["blocking_findings"],
        })
    return {"version_id": str(version_id), "rows": rows}
