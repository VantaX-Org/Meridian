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


@router.get("", response_model=ObjectsListOut, dependencies=[Depends(require_permission("view"))])
async def list_objects(run: uuid.UUID = Query(..., alias="run"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    version = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": str(run), "t": str(tenant.id)})).fetchone()
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
    ), {"v": str(run), "t": str(tenant.id)})).fetchall()
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
    return {"run_id": str(run), "objects": objects}
