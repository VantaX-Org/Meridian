"""The lead's analytics over the fix work (api/services/work_analytics.py).

  GET /work/analytics/burndown          open issues per day (90 days), per run, projected finish
  GET /work/analytics/time-to-fix       median and p90 days to fix, by object, rule (top 20) and severity
  GET /work/analytics/throughput        decisions per day and person (30 days), open workload per assignee
  GET /work/analytics/recurrence        issues that came back after a fix, by rule and by system (top 20)
  GET /work/analytics/root-causes       the run's failing records by company code, plant, sales org, ...
  GET /work/analytics/proposal-quality  per proposal source: proposed, approved, exported, fixed, still failing
  GET /work/analytics/run-change        per object: new, fixed, still failing since the previous run

All tenant-scoped (RLS), `view` permission, optional `module`; the run-bound ones take `version_id` and fall
back to the latest finished run. An empty tenant answers 200 with empty lists.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import work_analytics as wa
from api.services.rbac import require_permission
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/work/analytics", tags=["work-analytics"])

_MODULE = Query(None, max_length=100, pattern=r"^[a-z0-9_]+$")


async def _run(db: AsyncSession, tenant: Tenant, version_id: uuid.UUID | None, module: str | None) -> str | None:
    """The requested run (404 when it is not this tenant's), else the latest finished one, else None."""
    if not version_id:
        return await latest_run(db, tenant.id, module=module)
    if not (await db.execute(text("SELECT 1 FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t"),
                             {"v": str(version_id), "t": str(tenant.id)})).first():
        raise HTTPException(status_code=404, detail="Run not found.")
    return str(version_id)


@router.get("/burndown")
async def burndown(
    version_id: uuid.UUID | None = None,
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.burndown(db, tenant.id, await _run(db, tenant, version_id, module), module)


@router.get("/time-to-fix")
async def time_to_fix(
    module: str | None = _MODULE,
    days: int = Query(180, ge=7, le=730, description="issues fixed in the last N days"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.time_to_fix(db, tenant.id, module, days)


@router.get("/throughput")
async def throughput(
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.throughput(db, tenant.id, module)


@router.get("/recurrence")
async def recurrence(
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.recurrence(db, tenant.id, module)


@router.get("/root-causes")
async def root_causes(
    version_id: uuid.UUID | None = None,
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.root_causes(db, tenant.id, await _run(db, tenant, version_id, module), module)


@router.get("/proposal-quality")
async def proposal_quality(
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.proposal_quality(db, tenant.id, module)


@router.get("/run-change")
async def run_change(
    version_id: uuid.UUID | None = None,
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.run_change(db, tenant.id, await _run(db, tenant, version_id, module), module)
