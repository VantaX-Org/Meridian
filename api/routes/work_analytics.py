"""The lead's analytics over the fix work (api/services/work_analytics.py).

  GET /work/analytics/burndown          open issues per day (90 days), per run, projected finish
  GET /work/analytics/time-to-fix       median and p90 days to fix, by object, rule (top 20) and severity
  GET /work/analytics/throughput        decisions per day and person (30 days), open workload per assignee
  GET /work/analytics/recurrence        issues that came back after a fix, by rule and by system (top 20)
  GET /work/analytics/root-causes       the run's failing records by company code, plant, sales org, ...
  GET /work/analytics/proposal-quality  per proposal source: proposed, approved, exported, fixed, still failing
  GET /work/analytics/run-change        per object: new, fixed, still failing since the previous run

All tenant-scoped (RLS), `view` permission, optional `module`; the run-bound ones take `version_id` and fall
back to the latest finished run, or with `scope=current` read the current state: every object at the latest
complete run of its lineage, each from its own run (api/services/current_state.py). An empty tenant answers 200
with empty lists.
"""
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import work_analytics as wa
from api.services.current_state import current_pairs
from api.services.rbac import require_permission
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/work/analytics", tags=["work-analytics"])

_MODULE = Query(None, max_length=100, pattern=r"^[a-z0-9_]+$")
Scope = Literal["run", "current"]


# Response shapes, as api/services/work_analytics.py builds them. The scope=current answers add scope and
# version_ids (or compared); a single-run answer leaves them null.

class BurndownDay(BaseModel):
    day: str
    open: int
    opened: int
    closed: int


class BurndownRun(BaseModel):
    version_id: str
    label: str | None = None
    run_at: str | None = None
    issues: int
    open_records: int | None = None


class BurndownOut(BaseModel):
    version_id: str | None = None
    scope: str | None = None
    version_ids: list[str] | None = None
    today: str
    days: list[BurndownDay]
    open_now: int
    open_records: int | None = None
    fixed_7d: int
    pace_per_day: float
    pace_window_days: int
    projected_finish: str | None = None
    runs: list[BurndownRun]


class FixStat(BaseModel):
    fixed: int
    median_days: float | None = None
    p90_days: float | None = None


class FixByObject(FixStat):
    module: str | None = None


class FixByCheck(FixStat):
    check_id: str | None = None
    module: str | None = None


class FixBySeverity(FixStat):
    severity: str | None = None


class TimeToFixOut(BaseModel):
    window_days: int
    overall: FixStat
    by_object: list[FixByObject]
    by_check: list[FixByCheck]
    by_severity: list[FixBySeverity]


class ThroughputDay(BaseModel):
    day: str
    total: int
    by_person: dict[str, int]


class ThroughputPerson(BaseModel):
    person: str
    user_id: str | None = None
    total: int
    accept: int
    edit: int
    not_an_issue: int
    accept_risk: int
    approve: int


class Workload(BaseModel):
    assignee_id: str | None = None
    name: str | None = None
    email: str | None = None
    open: int
    critical: int
    overdue: int


class ThroughputOut(BaseModel):
    window_days: int
    days: list[ThroughputDay]
    totals: dict[str, int]  # accept, edit, not_an_issue, accept_risk, approve, total
    people: list[ThroughputPerson]
    workload: list[Workload]


class RecurrenceTotals(BaseModel):
    issues: int
    reopened: int
    reopens: int
    rate_pct: float


class RecurrenceCheck(RecurrenceTotals):
    check_id: str | None = None
    module: str | None = None


class RecurrenceSystem(RecurrenceTotals):
    scope: str | None = None
    name: str | None = None
    version_id: str | None = None


class RecurrenceOut(BaseModel):
    totals: RecurrenceTotals
    by_check: list[RecurrenceCheck]
    by_system: list[RecurrenceSystem]


class RootValue(BaseModel):
    value: str
    records: int
    issues: int
    open: int
    critical: int
    share_pct: float


class RootDimension(BaseModel):
    field: str
    label: str
    records: int
    values: int
    top: list[RootValue]


class RootCausesOut(BaseModel):
    version_id: str | None = None
    scope: str | None = None
    version_ids: list[str] | None = None
    source: str | None = None
    total_records: int
    dimensions: list[RootDimension]


class ProposalSource(BaseModel):
    source: str | None = None
    proposed: int
    approved: int
    exported: int
    fixed: int
    still_failing: int
    approval_rate_pct: float | None = None
    fix_rate_pct: float | None = None


class ProposalQualityOut(BaseModel):
    sources: list[ProposalSource]
    totals: dict[str, int]  # proposed, approved, exported, fixed, still_failing


class FlippedRule(BaseModel):
    check_id: str
    severity: str | None = None
    new: int


class RecoveredRule(BaseModel):
    check_id: str


class RuleFlips(BaseModel):
    newly_failing: list[FlippedRule]
    recovered: list[RecoveredRule]
    newly_failing_total: int
    recovered_total: int


class ChangeObject(BaseModel):
    module: str
    new: int
    fixed: int
    still_failing: int
    not_comparable_checks: int
    rules: RuleFlips


class PreviousRun(BaseModel):
    version_id: str
    label: str | None = None
    run_at: str | None = None


class ComparedRun(BaseModel):
    version_id: str
    previous: PreviousRun


class ChangeTotals(BaseModel):
    new: int
    fixed: int
    still_failing: int


class RunChangeOut(BaseModel):
    version_id: str | None = None
    scope: str | None = None
    previous: PreviousRun | None = None
    compared: list[ComparedRun] | None = None
    objects: list[ChangeObject]
    totals: ChangeTotals
    not_comparable_checks: int
_SCOPE = Query("run", description="current: every object at the latest complete run of its lineage; "
                                  "exclusive with version_id")


async def _pairs(db: AsyncSession, tenant: Tenant, version_id: uuid.UUID | None, module: str | None) -> list[dict]:
    if version_id is not None:
        raise HTTPException(status_code=422, detail="version_id and scope=current are exclusive")
    return await current_pairs(db, tenant.id, module)


async def _run(db: AsyncSession, tenant: Tenant, version_id: uuid.UUID | None, module: str | None) -> str | None:
    """The requested run (404 when it is not this tenant's), else the latest finished one, else None."""
    if not version_id:
        return await latest_run(db, tenant.id, module=module)
    if not (await db.execute(text("SELECT 1 FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t"),
                             {"v": str(version_id), "t": str(tenant.id)})).first():
        raise HTTPException(status_code=404, detail="Run not found.")
    return str(version_id)


@router.get("/burndown", response_model=BurndownOut)
async def burndown(
    version_id: uuid.UUID | None = None,
    module: str | None = _MODULE,
    scope: Scope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    if scope == "current":
        return await wa.burndown_current(db, tenant.id, await _pairs(db, tenant, version_id, module), module)
    return await wa.burndown(db, tenant.id, await _run(db, tenant, version_id, module), module)


@router.get("/time-to-fix", response_model=TimeToFixOut)
async def time_to_fix(
    module: str | None = _MODULE,
    days: int = Query(180, ge=7, le=730, description="issues fixed in the last N days"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.time_to_fix(db, tenant.id, module, days)


@router.get("/throughput", response_model=ThroughputOut)
async def throughput(
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.throughput(db, tenant.id, module)


@router.get("/recurrence", response_model=RecurrenceOut)
async def recurrence(
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.recurrence(db, tenant.id, module)


@router.get("/root-causes", response_model=RootCausesOut)
async def root_causes(
    version_id: uuid.UUID | None = None,
    module: str | None = _MODULE,
    scope: Scope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    if scope == "current":
        return await wa.root_causes_current(db, tenant.id, await _pairs(db, tenant, version_id, module), module)
    return await wa.root_causes(db, tenant.id, await _run(db, tenant, version_id, module), module)


@router.get("/proposal-quality", response_model=ProposalQualityOut)
async def proposal_quality(
    module: str | None = _MODULE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    return await wa.proposal_quality(db, tenant.id, module)


@router.get("/run-change", response_model=RunChangeOut)
async def run_change(
    version_id: uuid.UUID | None = None,
    module: str | None = _MODULE,
    scope: Scope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    if scope == "current":
        return await wa.run_change_current(db, tenant.id, await _pairs(db, tenant, version_id, module), module)
    return await wa.run_change(db, tenant.id, await _run(db, tenant, version_id, module), module)
