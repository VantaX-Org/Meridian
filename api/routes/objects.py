"""Object explorer list — api/routes/objects.py.

GET /api/v1/objects composes the per-module scores already written to
analysis_versions.dqs_summary by run_checks.py with a failing-check count
from findings, for one run. No new scoring logic — see api/services/scoring.py
for tier()/scoring_config(), which this reuses unchanged.
"""
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission
from api.services.scoring import scoring_config, tier

router = APIRouter(prefix="/api/v1/objects", tags=["objects"])


def _label(module: str) -> str:
    """Match frontend/lib/format.ts:formatModuleName — title-case each underscore word."""
    return " ".join(w.capitalize() for w in module.split("_"))


class ObjectSummaryOut(BaseModel):
    module: str
    label: str
    composite_score: Optional[float] = None
    readiness: Optional[str] = None
    failing_checks: int
    affected_records: int


class ObjectsListOut(BaseModel):
    run_id: str
    objects: list[ObjectSummaryOut]


async def _resolve_run(db: AsyncSession, tenant: Tenant, run: str) -> str:
    """Resolve the literal `run=latest` to the tenant's newest completed run,
    otherwise pass the value through as-is (a run id)."""
    if run == "latest":
        row = (await db.execute(text(
            "SELECT id::text FROM analysis_versions WHERE tenant_id = :t AND status = 'complete' "
            "ORDER BY run_at DESC LIMIT 1"
        ), {"t": str(tenant.id)})).fetchone()
        if not row:
            raise HTTPException(404, "No completed run yet")
        return row[0]
    return run


@router.get("", response_model=ObjectsListOut, dependencies=[Depends(require_permission("view"))])
async def list_objects(run: str = Query(..., alias="run"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    run_id = await _resolve_run(db, tenant, run)
    version = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": run_id, "t": str(tenant.id)})).fetchone()
    if not version:
        raise HTTPException(404, "Run not found")
    summary = version[0] or {}
    raw_scoring = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                    {"t": str(tenant.id)})).scalar() or {}
    thresholds = scoring_config(raw_scoring)["thresholds"]

    rows = (await db.execute(text(
        "SELECT module, count(*) AS failing, coalesce(sum(affected_count), 0) AS affected "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND affected_count > 0 "
        "GROUP BY module"
    ), {"v": run_id, "t": str(tenant.id)})).fetchall()
    by_module = {r[0]: (r[1], r[2]) for r in rows}

    modules = sorted(set(summary.keys()) | set(by_module.keys()))
    objects = []
    for module in modules:
        mod_summary = summary.get(module) or {}
        score = mod_summary.get("composite_score")
        failing, affected = by_module.get(module, (0, 0))
        objects.append({
            "module": module,
            "label": _label(module),
            "composite_score": score,
            "readiness": tier(score, thresholds) if score is not None else None,
            "failing_checks": failing,
            "affected_records": affected,
        })
    return {"run_id": run_id, "objects": objects}


class ObjectRuleOut(BaseModel):
    check_id: str
    severity: str
    dimension: Optional[str] = None
    affected_count: int
    total_count: int
    pass_rate: Optional[float] = None


class ObjectDetailOut(BaseModel):
    module: str
    label: str
    composite_score: Optional[float] = None
    readiness: Optional[str] = None
    dimension_scores: dict[str, float]
    rules: list[ObjectRuleOut]


@router.get("/{module}", response_model=ObjectDetailOut, dependencies=[Depends(require_permission("view"))])
async def get_object(module: str, run: uuid.UUID = Query(..., alias="run"),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    version = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": str(run), "t": str(tenant.id)})).fetchone()
    if not version:
        raise HTTPException(404, "Run not found")
    mod_summary = (version[0] or {}).get(module) or {}
    raw_scoring = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                    {"t": str(tenant.id)})).scalar() or {}
    thresholds = scoring_config(raw_scoring)["thresholds"]
    score = mod_summary.get("composite_score")

    rows = (await db.execute(text(
        "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "ORDER BY affected_count DESC"
    ), {"v": str(run), "t": str(tenant.id), "m": module})).fetchall()
    if not rows and not mod_summary:
        raise HTTPException(404, "Object not found for this run")
    return {
        "module": module,
        "label": _label(module),
        "composite_score": score,
        "readiness": tier(score, thresholds) if score is not None else None,
        "dimension_scores": mod_summary.get("dimension_scores") or {},
        "rules": [
            {"check_id": r[0], "severity": r[1], "dimension": r[2], "affected_count": r[3],
             "total_count": r[4], "pass_rate": float(r[5]) if r[5] is not None else None}
            for r in rows
        ],
    }
