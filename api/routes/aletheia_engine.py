"""Meridian's Aletheia engine sidecar: its status for Administration, and what it learned from the run trend for
Insights. Both answer 200 when the engine is off; the body says why (api/services/aletheia_engine.py)."""
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.insights import _agg
from sqlalchemy import text

from api.services import aletheia_cleaning as cleaning
from api.services import aletheia_engine as engine
from api.services import aletheia_foresight as foresight
from api.services import aletheia_reason as reasoning
from api.services import insights_aggregate as agg
from api.services.rbac import require_permission
from api.services.scoring import scoring_config

router = APIRouter(tags=["aletheia"])


# Fields read from the engine's own JSON are typed Any: the engine, not Meridian, decides their type.
class EngineLicence(BaseModel):
    valid: bool
    licensed: bool
    reason: Any = None
    deployment: Any = None
    expires: str | None = None
    max_tenants: Any = None


class EngineStatus(BaseModel):
    configured: bool
    live: bool
    token_set: bool
    tenant: str
    version: Any = None
    licence: EngineLicence | None = None
    usage: Any = None


class EngineRange(BaseModel):
    metric: str
    mean: Any = None
    low: Any = None
    high: Any = None
    n: Any = None
    latest: float | None = None
    outside: bool


class EngineLink(BaseModel):
    source: Any = None
    target: Any = None
    lag: Any = None
    correlation: Any = None


class EngineDrivers(BaseModel):
    """available False plus a reason when the engine cannot be used; runs, ranges and links when it can."""
    lineage: str
    labels: dict[str, str]
    available: bool
    reason: str | None = None
    runs: int | None = None
    ranges: list[EngineRange] | None = None
    links: list[EngineLink] | None = None


@router.get("/api/v1/aletheia/engine", response_model=EngineStatus, dependencies=[Depends(require_permission("view"))])
async def get_engine_status():
    return await run_in_threadpool(engine.status)


@router.get("/api/v1/insights/engine-drivers", response_model=EngineDrivers, response_model_exclude_unset=True,
            dependencies=[Depends(require_permission("view"))])
async def get_engine_drivers(version_id: Optional[uuid.UUID] = None, system_id: Optional[str] = None,
                             limit: int = Query(12, ge=3, le=50),
                             db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    trend = await _agg(db, tenant, agg.trends, version_id and str(version_id), system_id, limit)
    out = await run_in_threadpool(engine.learn_trend, trend["runs"])
    return {"lineage": trend["lineage"], "labels": engine.METRICS, **out}


class Evidence(BaseModel):
    """What a result was computed from, how, and how sure it is (0..100, None when the method has no single figure)."""
    inputs: list[str]
    method: str
    confidence: int | None = None
    runs: int | None = None
    first_run: str | None = None
    last_run: str | None = None


class BandPoint(BaseModel):
    date: str | None = None
    point: float
    low: float
    high: float


class GoLive(BaseModel):
    status: str  # reached | projected | not_converging | beyond_horizon
    projected: str | None = None
    earliest: str | None = None
    latest: str | None = None


class Projection(BaseModel):
    available: bool
    reason: str | None = None  # too_few_runs | undated
    latest: float | None = None
    slope_per_30d: float | None = None
    next: BandPoint | None = None
    go_live: GoLive | None = None
    band: list[BandPoint] | None = None
    evidence: Evidence


class NormalRange(BaseModel):
    mean: Any = None
    low: Any = None
    high: Any = None
    n: Any = None
    latest: float | None = None
    outside: bool | None = None


class Surprise(BaseModel):
    metric: Any = None
    version_id: str | None = None
    label: str | None = None
    run_at: str | None = None
    expected: Any = None
    observed: Any = None
    z: Any = None
    severity: str


class EngineLayer(BaseModel):
    available: bool
    reason: str | None = None
    normal: NormalRange | None = None
    surprises: list[Surprise]
    methodology: list[str]
    evidence: Evidence


class ForesightRun(BaseModel):
    version_id: str | None = None
    label: str | None = None
    run_at: str | None = None
    composite: float | None = None


class Foresight(BaseModel):
    lineage: str
    labels: dict[str, str]
    target: float
    target_source: str  # query | tenant
    runs: list[ForesightRun]
    projection: Projection
    engine: EngineLayer


@router.get("/api/v1/aletheia/foresight", response_model=Foresight,
            dependencies=[Depends(require_permission("view"))])
async def get_foresight(version_id: Optional[uuid.UUID] = None, system_id: Optional[str] = None,
                        limit: int = Query(12, ge=3, le=50), target: Optional[float] = Query(None, ge=0, le=100),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Composite projection with a 95% band and a go-live date, plus what the Aletheia engine learned from the same
    run trend. The projection is deterministic and answers without the engine."""
    source = "query"
    if target is None:
        row = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :tid"),
                                {"tid": str(tenant.id)})).fetchone()
        target = float(scoring_config((row[0] if row else None) or {})["thresholds"]["target"])
        source = "tenant"
    trend = await _agg(db, tenant, agg.trends, version_id and str(version_id), system_id, limit)
    out = await run_in_threadpool(foresight.foresight, trend["runs"], target)
    return {"lineage": trend["lineage"], "labels": engine.METRICS, "target_source": source, **out}


class Anomaly(BaseModel):
    metric: str
    version_id: str | None = None
    label: str | None = None
    run_at: str | None = None
    expected: Any = None
    observed: Any = None
    z: Any = None
    severity: str


class CausalRisk(BaseModel):
    kind: str  # rule | dimension
    driver: str
    name: str
    change: Any = None
    effect: Any = None  # composite points the driver explains
    confidence: int


class ReasonLayer(BaseModel):
    available: bool
    reason: str | None = None
    anomalies: list[Any]
    risks: list[Any]
    evidence: Evidence


class ReasonDeterministic(BaseModel):
    available: bool
    reason: str | None = None
    anomalies: list[Anomaly]
    risks: list[CausalRisk]
    anomaly_evidence: Evidence
    risk_evidence: Evidence


class Reason(BaseModel):
    lineage: str
    labels: dict[str, str]
    runs: list[ForesightRun]
    deterministic: ReasonDeterministic
    engine: ReasonLayer


@router.get("/api/v1/aletheia/reason", response_model=Reason, dependencies=[Depends(require_permission("view"))])
async def get_reason(version_id: Optional[uuid.UUID] = None, system_id: Optional[str] = None,
                     limit: int = Query(12, ge=3, le=50), db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)):
    """Anomalies and causal risks over the run history: a z-score and driver ranking that answer without the engine,
    plus the engine's own reasoning layer. Only scores and per-rule counts leave Meridian, never record values."""
    data = await _agg(db, tenant, reasoning.load, version_id and str(version_id), system_id, limit)
    out = await run_in_threadpool(reasoning.reason, data["runs"], data["rules"], data["rule_names"])
    return {"lineage": data["lineage"], "labels": engine.METRICS, **out}


class CleaningPattern(BaseModel):
    """Pattern counts of a rule's listed failing values; never a value."""
    listed: int
    blank: int
    masks: list[dict[str, Any]]
    leading_ws: int
    trailing_ws: int
    inner_ws: int
    case: dict[str, int]


class CleaningSuggestion(BaseModel):
    value: str
    source: str  # fix_draft | value_fix_map | rule_auto_fix
    covered: int
    base: int
    confidence: int
    evidence: str


class CleaningItem(BaseModel):
    rule: str
    message: str
    field: str
    field_label: str
    severity: str
    dimension: str
    check_class: str | None = None
    affected: int
    total: int
    pass_rate: float | None = None
    kind: str  # auto | fill | pick | review
    explanation: str
    pattern: CleaningPattern | None = None
    suggestion: CleaningSuggestion | None = None


class CleaningBatch(BaseModel):
    id: str
    kind: str
    field: str
    field_label: str
    rules: list[str]
    affected: int
    suggested: int
    instruction: str
    evidence: str


class RuleChange(BaseModel):
    rule: str
    before: int
    after: int


class CleaningChanges(BaseModel):
    available: bool
    previous: dict[str, Any] | None = None
    new: list[RuleChange]
    resolved: list[RuleChange]
    worse: list[RuleChange]
    better: list[RuleChange]
    narrative: str


class RuleRange(BaseModel):
    rule: str
    mean: Any = None
    low: Any = None
    high: Any = None
    n: Any = None
    latest: float
    outside: bool


class CleaningEngine(BaseModel):
    available: bool
    reason: str | None = None
    runs: int
    ranges: list[RuleRange]
    evidence: Evidence


class CleaningPlan(BaseModel):
    version_id: str
    run_label: str | None = None
    module: str
    items: list[CleaningItem]
    batches: list[CleaningBatch]
    changes: CleaningChanges
    engine: CleaningEngine


@router.get("/api/v1/aletheia/cleaning-plan", response_model=CleaningPlan,
            dependencies=[Depends(require_permission("view"))])
async def get_cleaning_plan(module: str, version_id: Optional[uuid.UUID] = None, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)):
    """Why each failing rule of one object fails, the fix Meridian can suggest with confidence and evidence, the fix
    batches, and what changed since the previous run. Failing values are reduced to pattern counts in Meridian; the
    engine is sent per-rule failure counts only."""
    from api.services.pdf_reports import _modules
    from api.services.run_context import latest_run

    if module not in _modules():
        raise HTTPException(status_code=422, detail=f"Unknown module: {module}")
    vid = str(version_id) if version_id else await latest_run(db, tenant.id, module=module)
    if not vid:
        raise HTTPException(status_code=404, detail="No run of this object yet.")
    data = await _agg(db, tenant, cleaning.load, str(vid), module)
    return await run_in_threadpool(cleaning.build, data)
