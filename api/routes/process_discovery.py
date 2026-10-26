"""As-is process discovery: catalogue, runs, mined views and Signavio export (spec §5.3).

Reads go through RLS (``_rls``). Mined views with filters re-mine the system's current event log in SQL
(``mining.mine_case_type``); without filters they read what the run stored. Exports write their own audit row,
as ``api/routes/process_export.py`` does, because GET is not covered by the audit middleware.

Every figure is per L1. Invoice events appear in both PTP and R2R, so nothing here adds event counts or
automation rates across L1s. ``sample_case_ids`` are SAP document keys for authorized users; they are never
passed to an LLM (this module calls none).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Iterable, Literal, NamedTuple, Optional, Sequence, Union
from zoneinfo import ZoneInfo

from celery import chain
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, BeforeValidator, JsonValue, field_validator
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from api.deps import Tenant, get_db, get_tenant
from api.middleware.audit import _insert_audit_row
from api.middleware.licence import enforce_licensed_modules
from api.models.process_model import L1, L2, L3, L4, L5, ProcessModelDocument
from api.routes.objects import FINISHED as _FINISHED_RUNS
from api.routes.process_designer import _invalid, _reference, _rls
from api.services import jobs
from api.services.bpmn_export import BpmnExportError, ExportMeta, export_node, export_zip, landscape_counts
from api.services.process_discovery import L1S, L1S_BY_SYSTEM, MODULE_OF, licence_modules, primary_case_type, reason
from api.services.process_discovery.builders import builder
from api.services.process_discovery.events import DEFAULT_TZ
from api.services.process_discovery.filters import ProcessFilter, case_filter_sql
from api.services.process_discovery.generate import EDGE_THRESHOLD, generate, reference_model
from api.services.process_discovery.mining import END as MINED_END
from api.services.process_discovery.mining import (CACHE_TTL, CASE_TYPES_SQL, OTHER_HASH, CaseTypeResult, MiningResult,
                                                   Scope, Variant, cache_key, mine_case_type)
from api.services.process_model_validator import validate_document
from api.services.rbac import Scope as RbacScope
from api.services.rbac import require_permission, require_scope, scope_from_path
from api.services.task_progress import _redis_client
from sap.process_definitions import reference_document

logger = logging.getLogger("meridian.process_discovery")
DISPATCH_ERROR = "Could not queue the discovery job"
router = APIRouter(prefix="/api/v1/process-discovery", tags=["process-discovery"])

VIEW = [Depends(require_permission("view", scope=scope_from_path))]
EXPORT = [Depends(require_permission("export_process", scope=scope_from_path))]

OVERLAP_DAYS = 14  # spec §8.2 step 3: incremental scope starts at watermark - 14 days

RUN_COLS = ("id, l1, mode, status, coverage, window_from, window_to, watermark, extraction_version_id, job_id, "
            "filters, stats, error, started_at, finished_at")

UuidStr = Annotated[str, BeforeValidator(str)]
Parent = Union[L1, L2, L3, L4]
Child = Union[L2, L3, L4, L5]


# --- request and response models ------------------------------------------------------------------------------


class RunRequest(BaseModel):
    l1s: list[str]
    mode: Literal["full", "incremental"] = "full"
    period_from: Optional[date] = None

    @field_validator("l1s")
    @classmethod
    def _known(cls, v: list[str]) -> list[str]:
        bad = [x for x in v if x not in L1S]
        if bad or not v:
            raise ValueError(f"unknown L1: {', '.join(bad) or '(none)'}")
        return sorted(set(v))


class RunStarted(BaseModel):
    job_id: Optional[str]
    run_ids: list[str]


class RunSummary(BaseModel):
    id: UuidStr
    l1: str
    mode: str
    status: str
    coverage: str
    window_from: Optional[date] = None
    window_to: Optional[date] = None
    watermark: Optional[datetime] = None
    extraction_version_id: Optional[UuidStr] = None
    job_id: Optional[str] = None
    filters: dict[str, JsonValue] = {}
    stats: dict[str, JsonValue] = {}
    error: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None


class RunDetail(RunSummary):
    system_id: UuidStr
    system_type: str


class RunRecord(RunDetail):
    """A run with what the views need to mine it; never returned as is."""
    tz: str
    model: Optional[dict[str, JsonValue]] = None


class TableStat(BaseModel):
    rows: int = 0
    partial: bool = True


class ConformanceStat(BaseModel):
    fitness: Optional[float] = None


class ThroughputStat(BaseModel):
    median_seconds: Optional[float] = None


class RunStats(BaseModel):
    """The part of ``process_discovery_runs.stats`` the catalogue reads (spec §3.6)."""
    case_types: dict[str, int] = {}
    variants: Optional[int] = None
    throughput: ThroughputStat = ThroughputStat()
    automation_rate: Optional[float] = None
    conformance: ConformanceStat = ConformanceStat()
    tables: dict[str, TableStat] = {}


class SourceTable(BaseModel):
    table: str
    rows: int
    partial: bool


RunStatus = Literal["queued", "waiting", "extracting", "building", "mining", "completed", "failed"]


class LastRun(BaseModel):
    """The latest completed run of an L1: the card's data. Newer runs are ``in_progress`` / ``failed``."""
    id: str
    status: RunStatus
    finished_at: Optional[datetime]
    cases: Optional[int]
    variants: Optional[int] = None
    median_seconds: Optional[float] = None
    automation_rate: Optional[float] = None
    fitness: Optional[float]


class RunRef(BaseModel):
    """A run newer than the last completed one (in flight, or failed): shown beside the last good result."""
    id: str
    status: RunStatus
    job_id: Optional[str] = None
    error: Optional[str] = None


class CatalogueEntry(BaseModel):
    l1: str
    name: str
    coverage: str
    reason: Optional[str]
    last_run: Optional[LastRun]
    in_progress: Optional[RunRef] = None  # the active run, so the UI can say "refreshing" over the last result
    failed: Optional[RunRef] = None       # the newest run, when it failed after the last completed one
    dq_defects: Optional[int] = None      # failing findings on the DQ modules this process touches; None: no mapping or no DQ run
    dq_version_id: Optional[str] = None   # the analysis_versions id dq_defects was counted from; None: no DQ run
    sources: list[SourceTable]


class NodeStats(BaseModel):
    id: str
    name: str
    source: str
    observed: bool
    case_count: int
    share: float
    median_seconds: Optional[float]
    fitness: Optional[float]
    dq_defects: Optional[int] = None  # failing findings on the DQ modules this node maps to; None: no mapping or no DQ run
    dq_version_id: Optional[str] = None  # the analysis_versions id dq_defects was counted from; None: no DQ run


class DfgEdge(BaseModel):
    source: str
    target: str
    count: int
    median_seconds: float | None = None


class DfgResponse(BaseModel):
    level: int
    node: NodeStats
    nodes: list[NodeStats]
    edges: list[DfgEdge]
    edge_threshold: float
    cached: bool = False


class _DfgCacheEntry(BaseModel):
    """What the flow cache stores: the graph WITHOUT dq_defects, plus each node's DQ modules, so a hit
    re-applies fresh defect counts instead of serving ones up to CACHE_TTL old."""
    dfg: DfgResponse
    modules: dict[str, list[str]]


def _no_none_list(v: Optional[Sequence[str]]) -> list[str]:
    return list(v or [])


class VariantOut(BaseModel):
    hash: str
    activities: list[str]
    case_count: int
    share: float
    median_seconds: Optional[float] = None
    p90_seconds: Optional[float] = None
    fitness: Optional[float] = None
    sample_case_ids: Annotated[list[str], BeforeValidator(_no_none_list)] = []


class VariantPage(BaseModel):
    case_type: str
    total: int
    items: list[VariantOut]


class ConformanceStep(BaseModel):
    activity: str
    step_fitness: Optional[float]
    out_of_order: float


class HappyPath(BaseModel):
    activities: list[str]
    case_count: int
    share: float
    fitness: Optional[float]


class ExtraActivity(BaseModel):
    """An activity the cases perform that the reference mapping does not name (spec §3.5 "extra")."""
    activity: str
    cases: int
    share: float


class ConformanceResponse(BaseModel):
    case_type: str
    fitness: Optional[float]
    missing: dict[str, float]
    steps: list[ConformanceStep]
    extra: list[ExtraActivity] = []
    happy_path: HappyPath = HappyPath(activities=[], case_count=0, share=0.0, fitness=None)


class CaseRow(BaseModel):
    case_id: str
    first_ts: datetime
    last_ts: datetime
    events: int
    variant: str


class CasePage(BaseModel):
    case_type: str
    total: int
    items: list[CaseRow]


class CaseEvent(BaseModel):
    activity: str
    l5_id: Optional[str] = None
    ts: datetime
    ts_precision: str
    seq: int
    resource: Optional[str] = None
    automated: Optional[bool] = None
    doc_type: Optional[str] = None
    org: JsonValue = None
    object_refs: JsonValue = None
    attributes: JsonValue = None
    source_table: str


class CaseEvents(BaseModel):
    case_type: str
    case_id: str
    events: list[CaseEvent]


# --- lookups --------------------------------------------------------------------------------------------------


def _id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid id")


def _summary(r: Row) -> RunSummary:
    return RunSummary.model_validate(dict(r._mapping))


async def _system(db: AsyncSession, tenant: Tenant, system_id: str) -> tuple[str, str]:
    await _rls(db, tenant)
    row = (await db.execute(text("SELECT system_type, timezone FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                            {"s": system_id, "t": str(tenant.id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="System not found")
    return row[0], row[1] or DEFAULT_TZ


async def _run(db: AsyncSession, tenant: Tenant, run_id: str) -> RunRecord:
    await _rls(db, tenant)
    row = (await db.execute(text(f"SELECT {RUN_COLS}, system_id, model FROM process_discovery_runs "
                                 "WHERE id = :id AND tenant_id = :t"), {"id": _id(run_id), "t": str(tenant.id)})
           ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    system_type, tz = await _system(db, tenant, str(row.system_id))
    return RunRecord.model_validate({**dict(row._mapping), "system_type": system_type, "tz": tz})


def _scope(tenant: Tenant, run: RunRecord) -> Scope:
    return Scope(str(tenant.id), run.system_id, run.l1, run.tz)


def _filter(request: Request, run: RunRecord) -> tuple[ProcessFilter, str]:
    try:
        flt = ProcessFilter.from_query(request.query_params)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return flt, flt.case_type or primary_case_type(run.l1, run.system_type)


async def _mine(db: AsyncSession, tenant: Tenant, run: RunRecord, flt: ProcessFilter,
                case_type: str) -> CaseTypeResult:
    mapping = builder(run.l1).MAPPING
    return await db.run_sync(lambda s: mine_case_type(s, _scope(tenant, run), case_type, flt, mapping))


async def _document(db: AsyncSession, tenant: Tenant, run: RunRecord, flt: ProcessFilter) -> ProcessModelDocument:
    """The run's stored model, or one generated from the current event log under ``flt``."""
    if run.model is None:
        raise HTTPException(status_code=409, detail="Run has no model yet")
    if flt == ProcessFilter():
        return ProcessModelDocument.model_validate(run.model)
    base = await _reference(db, tenant)
    scope, mapping = _scope(tenant, run), builder(run.l1).MAPPING
    primary = primary_case_type(run.l1, run.system_type)

    def build(s: Session) -> ProcessModelDocument:
        types = [flt.case_type] if flt.case_type else [r[0] for r in s.execute(text(CASE_TYPES_SQL),
                                                                                  scope.params(""))]
        mined = MiningResult(run.l1, primary, {ct: mine_case_type(s, scope, ct, flt, mapping) for ct in types})
        if not any(r.cases for r in mined.by_type.values()):
            return reference_model(base, run.l1, run.system_type)
        return generate(base, mined, mapping, system_type=run.system_type).document

    await _rls(db, tenant)
    return await db.run_sync(build)


# --- DQ defects per process ---------------------------------------------------------------------------------


class DqCounts(NamedTuple):
    version_id: str
    by_module: dict[str, int]


async def _defects_by_module(db: AsyncSession, tenant: Tenant, system_id: str) -> Optional[DqCounts]:
    """The system's newest finished analysis id and its {DQ module: failing findings}, or None when it has none.
    Two tenant-scoped queries per request (newest run, then one GROUP BY over its findings), however many
    processes or nodes read it; the findings scan uses ix_findings_tenant_version."""
    await _rls(db, tenant)
    args = {"t": str(tenant.id), "s": system_id, "done": list(_FINISHED_RUNS)}
    version = (await db.execute(text(
        "SELECT id FROM analysis_versions WHERE tenant_id = :t AND metadata->>'system_id' = :s "
        "AND status = ANY(:done) ORDER BY run_at DESC LIMIT 1"), args)).scalar()
    if version is None:
        return None
    rows = (await db.execute(text(
        "SELECT module, count(*) FROM findings WHERE tenant_id = :t AND version_id = :v AND affected_count > 0 "
        "GROUP BY module"), {"t": args["t"], "v": version})).fetchall()
    return DqCounts(str(version), {m: n for m, n in rows})


def _defects(defects: Optional[dict[str, int]], modules: Iterable[str]) -> Optional[int]:
    """Sum over the distinct mapped modules; None when nothing maps or there is no DQ run (never a fabricated 0)."""
    mods = set(modules)
    return None if defects is None or not mods else sum(defects.get(m, 0) for m in mods)


def _node_modules(node: Union[L1, L2, L3, L4, L5]) -> set[str]:
    """DQ modules of a node: an L1's declared modules, an L5's rule modules, otherwise the union below it."""
    if isinstance(node, L5):
        return set(node.rule_modules)
    if isinstance(node, L1):
        return set(node.modules) | {m for c in node.l2 for m in _node_modules(c)}
    kids: Sequence[Union[L2, L3, L4, L5]] = (node.l3 if isinstance(node, L2) else node.l4 if isinstance(node, L3)
                                              else node.activities)
    return {m for c in kids for m in _node_modules(c)}


# --- catalogue and runs ---------------------------------------------------------------------------------------


@router.get("/systems/{system_id}/catalogue", dependencies=VIEW, response_model=list[CatalogueEntry])
async def catalogue(system_id: str, tenant: Tenant = Depends(get_tenant),
                    db: AsyncSession = Depends(get_db)) -> list[CatalogueEntry]:
    system_type, _ = await _system(db, tenant, _id(system_id))
    params = {"t": str(tenant.id), "s": _id(system_id)}
    # Latest completed run per L1 is the data; the newest run of any status only tells whether it is refreshing.
    done = {r.l1: _summary(r) for r in (await db.execute(text(f"""
        SELECT DISTINCT ON (l1) {RUN_COLS} FROM process_discovery_runs
        WHERE tenant_id = :t AND system_id = :s AND status = 'completed'
        ORDER BY l1, started_at DESC, id DESC"""), params)).fetchall()}
    newest = {r.l1: _summary(r) for r in (await db.execute(text(f"""
        SELECT DISTINCT ON (l1) {RUN_COLS} FROM process_discovery_runs
        WHERE tenant_id = :t AND system_id = :s ORDER BY l1, started_at DESC, id DESC"""), params)).fetchall()}
    ref_l1 = {x.id: x for x in reference_document().l1}
    names = {k: v.name for k, v in ref_l1.items()}
    defects = await _defects_by_module(db, tenant, _id(system_id))
    out: list[CatalogueEntry] = []
    for l1 in L1S:
        r, n = done.get(l1), newest.get(l1)
        stats = RunStats.model_validate(r.stats) if r else RunStats()
        ref = None if n is None or n.status == "completed" else RunRef(
            id=n.id, status=n.status, job_id=n.job_id, error=n.error)
        out.append(CatalogueEntry(
            l1=l1, name=names.get(l1, l1),
            dq_defects=_defects(defects and defects.by_module, _node_modules(ref_l1[l1]) if l1 in ref_l1 else ()),
            dq_version_id=defects and defects.version_id,
            coverage=r.coverage if r else "reference",
            reason=reason(l1, system_type),
            last_run=None if r is None else LastRun(
                id=r.id, status=r.status, finished_at=r.finished_at,
                cases=stats.case_types.get(primary_case_type(l1, system_type)), variants=stats.variants,
                median_seconds=stats.throughput.median_seconds, automation_rate=stats.automation_rate,
                fitness=stats.conformance.fitness),
            in_progress=ref if ref and ref.status != "failed" else None,
            failed=ref if ref and ref.status == "failed" else None,
            sources=[SourceTable(table=t, rows=v.rows, partial=v.partial) for t, v in sorted(stats.tables.items())]))
    return out


@router.post("/systems/{system_id}/runs", dependencies=[Depends(require_permission("run_process_discovery", scope=scope_from_path))],
             response_model=RunStarted)
async def start_runs(system_id: str, body: RunRequest, request: Request, tenant: Tenant = Depends(get_tenant),
                     db: AsyncSession = Depends(get_db)) -> RunStarted:
    from workers.tasks.run_extraction import run_extraction
    from workers.tasks.run_process_discovery import (
        LOCK_TTL, PURPOSE, abort_runs, discover_process, lock_key, release_lock)

    system_id = _id(system_id)
    system_type, tz = await _system(db, tenant, system_id)
    # the entitlement boundary for module data entering the system, as on /extract: only the L1s that extract
    # an L1 runs when the tenant holds any DQ module whose tables its event log reads
    licensed = getattr(request.state, "licensed_modules", None)
    if licensed is not None and "*" not in licensed:
        for l1 in body.l1s:
            mods = licence_modules(l1, system_type) if l1 in L1S_BY_SYSTEM.get(system_type, ()) else ()
            if mods and not any(m in licensed for m in mods):
                enforce_licensed_modules(request, list(mods))
    client = _redis_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Job queue unavailable")
    tid = str(tenant.id)
    token = uuid.uuid4().hex
    if not client.set(lock_key(tid, system_id), token, nx=True, ex=LOCK_TTL):
        raise HTTPException(status_code=409, detail="A process discovery run is already active for this system")
    try:
        sourced = [l1 for l1 in body.l1s if l1 in L1S_BY_SYSTEM.get(system_type, ())]
        today = datetime.now(ZoneInfo(tz)).date()
        window: dict[str, Optional[date]] = {}
        for l1 in sourced:
            wm: Optional[datetime] = None
            if body.mode == "incremental":
                wm = (await db.execute(text(
                    "SELECT max(watermark) FROM process_discovery_runs WHERE tenant_id = :t AND system_id = :s "
                    "AND l1 = :l1 AND status = 'completed'"), {"t": tid, "s": system_id, "l1": l1})).scalar()
            window[l1] = (wm.astimezone(ZoneInfo(tz)).date() - timedelta(days=OVERLAP_DAYS)) if wm \
                else body.period_from
        version_id = str(uuid.uuid4()) if sourced else None
        run_ids: list[str] = []
        base = await _reference(db, tenant) if len(sourced) < len(body.l1s) else None
        for l1 in body.l1s:
            rid = str(uuid.uuid4())
            run_ids.append(rid)
            mode = body.mode if l1 in sourced and window.get(l1) and body.mode == "incremental" else "full"
            args: dict[str, object] = {
                "id": rid, "t": tid, "s": system_id, "l1": l1, "mode": mode, "wf": window.get(l1), "wt": today,
                "u": getattr(request.state, "local_user_id", None)}
            if l1 in sourced:
                await db.execute(text(
                    "INSERT INTO process_discovery_runs (id, tenant_id, system_id, l1, mode, status, window_from, "
                    "window_to, created_by) VALUES (:id, :t, :s, :l1, :mode, 'queued', :wf, :wt, :u)"), args)
            elif base is not None:  # spec §8.1 step 4: no source on this system type, completes as reference
                model = reference_model(base, l1, system_type)
                await db.execute(text(
                    "INSERT INTO process_discovery_runs (id, tenant_id, system_id, l1, mode, status, coverage, "
                    "window_to, stats, model, created_by, finished_at) VALUES (:id, :t, :s, :l1, :mode, "
                    "'completed', 'reference', :wt, CAST(:stats AS jsonb), CAST(:model AS jsonb), :u, now())"),
                    {**args, "stats": json.dumps({"reason": reason(l1, system_type)}),
                     "model": model.model_dump_json()})
        job_id = f"pd-{run_ids[0]}"
        await db.execute(text("UPDATE process_discovery_runs SET job_id = :j "
                              "WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[]))"),
                         {"j": job_id, "ids": run_ids, "t": tid})
        await db.commit()
    except BaseException:
        release_lock(tid, system_id, token)
        raise

    queued = [r for r, l1 in zip(run_ids, body.l1s) if l1 in sourced]
    if not queued:
        release_lock(tid, system_id, token)
        return RunStarted(job_id=None, run_ids=run_ids)
    starts = [w for w in window.values() if w]
    scope = {"date_from": min(starts).isoformat(), "date_to": today.isoformat()} if starts else None
    try:
        jobs.start_job(tid, job_id, "process_discovery", f"Process discovery: {', '.join(sourced)}",
                       system_id=system_id, run_ids=queued, version_id=version_id)
        jobs.update_job(tid, job_id, stage="extraction", percent=0, message="Extracting event tables")
        chain(run_extraction.si(tid, system_id, [MODULE_OF[l1] for l1 in sourced], include_config=False,
                                sync_type="data", scope=scope, analyse=False, label="Process discovery",
                                version_id=version_id, purpose=PURPOSE),
              discover_process.si(tid, system_id, queued, version_id, token)).apply_async(
            link_error=abort_runs.si(tid, system_id, queued, version_id, token))
    except Exception:  # broker down: free the lock and fail the queued runs so the UI is not stuck
        logger.exception("Process discovery dispatch failed for %s", job_id)
        release_lock(tid, system_id, token)
        await _rls(db, tenant)
        await db.execute(text("UPDATE process_discovery_runs SET status = 'failed', error = :e, finished_at = now() "
                              "WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[])) AND status = 'queued'"),
                         {"e": DISPATCH_ERROR, "t": tid, "ids": queued})
        await db.commit()
        try:
            jobs.finish_job(tid, job_id, "failed", error=DISPATCH_ERROR)
        except Exception:
            logger.exception("Could not close job %s", job_id)
        raise HTTPException(status_code=503, detail="Job queue unavailable") from None
    return RunStarted(job_id=job_id, run_ids=run_ids)


@router.get("/systems/{system_id}/runs", dependencies=VIEW, response_model=list[RunSummary])
async def list_runs(system_id: str, l1: Optional[str] = None, limit: int = Query(50, ge=1, le=200),
                    tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> list[RunSummary]:
    await _rls(db, tenant)
    rows = await db.execute(text(f"""
        SELECT {RUN_COLS} FROM process_discovery_runs WHERE tenant_id = :t AND system_id = :s
          AND (CAST(:l1 AS text) IS NULL OR l1 = :l1) ORDER BY started_at DESC, l1, id LIMIT :n"""),
        {"t": str(tenant.id), "s": _id(system_id), "l1": l1, "n": limit})
    return [_summary(r) for r in rows]


@router.get("/runs/{run_id}", dependencies=VIEW, response_model=RunDetail)
async def get_run(run_id: str, tenant: Tenant = Depends(get_tenant),
                  db: AsyncSession = Depends(get_db)) -> RunDetail:
    return RunDetail.model_validate(await _run(db, tenant, run_id), from_attributes=True)


@router.get("/runs/{run_id}/model", dependencies=VIEW, response_model=ProcessModelDocument)
async def get_model(run_id: str, tenant: Tenant = Depends(get_tenant),
                    db: AsyncSession = Depends(get_db)) -> ProcessModelDocument:
    run = await _run(db, tenant, run_id)
    return await _document(db, tenant, run, ProcessFilter())


# --- mined views ----------------------------------------------------------------------------------------------


def _children(doc: ProcessModelDocument, node_id: Optional[str]) -> tuple[int, Parent, Sequence[Child]]:
    """(level of the children, parent, children) for an L1-L4 parent; the L1 when ``node_id`` is None."""
    for l1 in doc.l1:
        if node_id in (None, l1.id):
            return 2, l1, l1.l2
        for l2 in l1.l2:
            if l2.id == node_id:
                return 3, l2, l2.l3
            for l3 in l2.l3:
                if l3.id == node_id:
                    return 4, l3, l3.l4
                for l4 in l3.l4:
                    if l4.id == node_id:
                        return 5, l4, l4.activities
    raise HTTPException(status_code=404, detail="Node not found")


def _stats(node: Union[Parent, Child]) -> NodeStats:
    d = node.discovery
    return NodeStats(id=node.id, name=node.name, source=node.source, observed=bool(d and d.observed),
                     case_count=d.case_count if d else 0, share=d.share if d else 0.0,
                     median_seconds=d.median_seconds if d else None, fitness=d.fitness if d else None,
                     dq_defects=None)  # filled per request by _apply_defects, never cached


def _apply_defects(dfg: DfgResponse, modules: dict[str, list[str]],
                   defects: Optional[DqCounts]) -> DfgResponse:
    def one(n: NodeStats) -> NodeStats:
        return n.model_copy(update={"dq_defects": _defects(defects and defects.by_module, modules.get(n.id, ())),
                                    "dq_version_id": defects and defects.version_id})
    return dfg.model_copy(update={"node": one(dfg.node), "nodes": [one(n) for n in dfg.nodes]})


def _check_level(level: Optional[int], actual: int, parent_id: str) -> None:
    if level is not None and level != actual:
        raise HTTPException(status_code=422, detail=f"Children of {parent_id} are level {actual}")


def _edges(parent: Parent, kids: Sequence[Child], all_edges: bool) -> list[DfgEdge]:
    """As-is edges between ``kids`` with their median wait: pruned by ``landscape_counts`` (the export's edges) or,
    with ``all_edges``, every mined edge (the flow view's "All edges" toggle, spec 7.3). L4 parents have none."""
    if isinstance(parent, L4):
        return []
    seen = [k for k in kids if not isinstance(k, L5) and k.discovery is not None and k.discovery.observed]

    def end(target: str) -> str:
        return "END" if target == MINED_END else target

    wait = {(k.id, end(e.target)): e.median_seconds for k in seen if k.discovery for e in k.discovery.edges}
    if all_edges:
        raw = [("START", k.id, k.discovery.entry_count) for k in seen if k.discovery and k.discovery.entry_count]
        raw += [(k.id, end(e.target), e.count) for k in seen if k.discovery for e in k.discovery.edges]
    else:
        raw = landscape_counts(parent, seen) or []
    return [DfgEdge(source=s, target=t, count=n, median_seconds=wait.get((s, t))) for s, t, n in raw]


@router.get("/runs/{run_id}/dfg", dependencies=VIEW, response_model=DfgResponse)
async def dfg(run_id: str, request: Request, level: Optional[int] = Query(None, ge=2, le=5),
              node_id: Optional[str] = None, all_edges: bool = False, tenant: Tenant = Depends(get_tenant),
              db: AsyncSession = Depends(get_db)) -> DfgResponse:
    """Nodes and as-is edges between the children of ``node_id`` (default: the L1), pruned as in the export,
    so the flow view and the Signavio file draw the same edges. Edges exist for L1-L3 parents; the flow
    inside an L4 is its diagram."""
    run = await _run(db, tenant, run_id)
    flt, _ = _filter(request, run)
    client = _redis_client() if flt != ProcessFilter() else None
    key = f"{cache_key(_scope(tenant, run), flt, run.id)}:{node_id or ''}:{int(all_edges)}"
    defects = await _defects_by_module(db, tenant, run.system_id)  # one lookup shared by every node, never cached
    if client is not None and (hit := client.get(key)):
        try:
            entry = _DfgCacheEntry.model_validate_json(hit)
        except ValueError:  # an entry from before dq_defects existed: treat as a miss
            entry = None
        if entry is not None:
            _check_level(level, entry.dfg.level, entry.dfg.node.id)  # a cache hit must not skip the level validation
            return _apply_defects(entry.dfg, entry.modules, defects).model_copy(update={"cached": True})
    doc = await _document(db, tenant, run, flt)
    lvl, parent, kids = _children(doc, node_id)
    _check_level(level, lvl, parent.id)
    out = DfgResponse(level=lvl, node=_stats(parent), nodes=[_stats(k) for k in kids],
                      edges=_edges(parent, kids, all_edges), edge_threshold=EDGE_THRESHOLD)
    modules = {n.id: sorted(_node_modules(n)) for n in [parent, *kids]}
    if client is not None:
        client.setex(key, CACHE_TTL, _DfgCacheEntry(dfg=out, modules=modules).model_dump_json())
    return _apply_defects(out, modules, defects)


def _variant(v: Variant) -> VariantOut:
    return VariantOut(hash=v.hash, activities=list(v.activities), case_count=v.case_count, share=v.share,
                      median_seconds=v.median_seconds, p90_seconds=v.p90_seconds, fitness=v.fitness,
                      sample_case_ids=list(v.sample_case_ids))


@router.get("/runs/{run_id}/variants", dependencies=VIEW, response_model=VariantPage)
async def variants(run_id: str, request: Request, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                   tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> VariantPage:
    run = await _run(db, tenant, run_id)
    flt, ct = _filter(request, run)
    page = await _variants(db, tenant, run, flt, ct, limit, offset)
    # sample case ids are SAP document keys: the case explorer's permission, not the viewer's
    try:
        await require_scope(request, db, tenant, "export_process", RbacScope(uuid.UUID(run.system_id)))
    except HTTPException:
        for item in page.items:
            item.sample_case_ids = []
    return page


async def _variants(db: AsyncSession, tenant: Tenant, run: RunRecord, flt: ProcessFilter, ct: str, limit: int,
                    offset: int) -> VariantPage:
    if flt.model_copy(update={"case_type": None}) == ProcessFilter():
        rows = (await db.execute(text("""
            SELECT variant_hash AS hash, activities, case_count, share, median_seconds, p90_seconds, fitness,
                   sample_case_ids, count(*) OVER () AS total
            FROM process_discovery_variants WHERE tenant_id = :t AND run_id = :r AND case_type = :ct
            ORDER BY variant_hash = :other, case_count DESC, variant_hash LIMIT :n OFFSET :o"""),
            {"t": str(tenant.id), "r": run.id, "ct": ct, "n": limit, "o": offset, "other": OTHER_HASH})).fetchall()
        return VariantPage(case_type=ct, total=rows[0].total if rows else 0,
                           items=[VariantOut.model_validate(dict(r._mapping)) for r in rows])
    mined = (await _mine(db, tenant, run, flt, ct)).stored()
    return VariantPage(case_type=ct, total=len(mined), items=[_variant(v) for v in mined[offset:offset + limit]])


@router.get("/runs/{run_id}/conformance", dependencies=VIEW, response_model=ConformanceResponse)
async def conformance(run_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                      db: AsyncSession = Depends(get_db)) -> ConformanceResponse:
    run = await _run(db, tenant, run_id)
    flt, ct = _filter(request, run)
    mined = await _mine(db, tenant, run, flt, ct)
    c = mined.conformance
    steps = sorted(set(c.step_fitness) | set(c.out_of_order))
    hp = mined.happy_path()
    return ConformanceResponse(
        case_type=ct, fitness=c.fitness, missing=c.missing,
        steps=[ConformanceStep(activity=a, step_fitness=c.step_fitness.get(a),
                               out_of_order=c.out_of_order.get(a, 0.0)) for a in steps],
        extra=_extra(c.extra, mined.cases),
        happy_path=HappyPath(**hp))


def _extra(extra: dict[str, int], cases: int) -> list[ExtraActivity]:
    """Activities outside the reference mapping, most cases first, each with its share of the view's cases."""
    return [ExtraActivity(activity=a, cases=n, share=round(n / cases, 4) if cases else 0.0)
            for a, n in sorted(extra.items(), key=lambda kv: (-kv[1], kv[0]))]


CASES_SQL = """
WITH f AS (SELECT case_id FROM process_events WHERE tenant_id = :t AND system_id = :s AND l1 = :l1
           AND case_type = :ct GROUP BY case_id HAVING {having}),
c AS (SELECT case_id, min(ts) AS first_ts, max(ts) AS last_ts, count(*) AS events,
             md5(string_agg(activity, '>' ORDER BY ts, seq, id)) AS variant,
             bool_or(activity = :act) AS has_act
      FROM process_events JOIN f USING (case_id)
      WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct GROUP BY case_id)
SELECT case_id, first_ts, last_ts, events, variant, count(*) OVER () AS total FROM c
WHERE (CAST(:act AS text) IS NULL OR has_act) AND (CAST(:variant AS text) IS NULL OR variant = :variant)
ORDER BY first_ts DESC, case_id LIMIT :n OFFSET :o"""


@router.get("/runs/{run_id}/cases", dependencies=EXPORT, response_model=CasePage)
async def cases(run_id: str, request: Request, activity: Optional[str] = None, variant: Optional[str] = None,
                limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> CasePage:
    run = await _run(db, tenant, run_id)
    flt, ct = _filter(request, run)
    having, p = case_filter_sql(flt, run.tz)
    rows = (await db.execute(text(CASES_SQL.format(having=having)), {
        **_scope(tenant, run).params(ct), **p, "act": activity, "variant": variant, "n": limit, "o": offset})
            ).fetchall()
    return CasePage(case_type=ct, total=rows[0].total if rows else 0,
                    items=[CaseRow.model_validate(dict(r._mapping)) for r in rows])


@router.get("/runs/{run_id}/cases/{case_id:path}", dependencies=EXPORT,  # PTP case ids are "EBELN/EBELP"
            response_model=CaseEvents)
async def case_events(run_id: str, case_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                      db: AsyncSession = Depends(get_db)) -> CaseEvents:
    run = await _run(db, tenant, run_id)
    _, ct = _filter(request, run)
    rows = await db.execute(text("""
        SELECT activity, l5_id, ts, ts_precision, seq, resource, automated, doc_type, org, object_refs,
               attributes, source_table FROM process_events
        WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct AND case_id = :c
        ORDER BY ts, seq, id"""), {**_scope(tenant, run).params(ct), "c": case_id})
    events = [CaseEvent.model_validate(dict(r._mapping)) for r in rows]
    if not events:
        raise HTTPException(status_code=404, detail="Case not found")
    return CaseEvents(case_type=ct, case_id=case_id, events=events)


# --- export ---------------------------------------------------------------------------------------------------


async def _export(request: Request, tenant: Tenant, db: AsyncSession, run_id: str,
                  node_id: Optional[str]) -> Response:
    run = await _run(db, tenant, run_id)
    flt, _ = _filter(request, run)
    doc = await _document(db, tenant, run, flt)
    result = validate_document(doc)
    if result.errors:
        return _invalid(result.errors)
    now = datetime.now(timezone.utc)
    filters = json.loads(flt.model_dump_json())
    meta: ExportMeta = {"model_id": None, "name": f"{run.l1} as-is", "version_no": 1,
            "exported_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "app_version": request.app.version,
            "discovery": {"run_id": run.id, "edge_threshold": EDGE_THRESHOLD,
                          "window": {"from": str(run.window_from) if run.window_from else None,
                                     "to": str(run.window_to) if run.window_to else None},
                          "filters": filters}}
    try:
        data = export_zip(doc, None, meta)  # validates the whole package once, also for one-node downloads
        if node_id:
            fname, data = export_node(doc, node_id, None, meta)
    except KeyError:
        raise HTTPException(status_code=404, detail="Node not found")
    except BpmnExportError as e:
        logger.error("process discovery export failed validation: %s", e.errors)
        return JSONResponse(status_code=500, content={"detail": "Export failed validation"})
    if not node_id:
        fname = f"meridian-asis-{run.l1}-{now:%Y%m%d}.zip"
    await asyncio.to_thread(_insert_audit_row, {
        "tenant_id": tenant.id,
        "actor_user_id": getattr(request.state, "local_user_id", None),
        "actor_email": getattr(request.state, "local_user_email", None),
        "action": "process_discovery.export", "entity_type": "process_discovery_run", "entity_id": run.id,
        "method": "GET", "path": request.url.path, "status_code": 200,
        "ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
        "before_json": {"run_id": run.id, "l1": run.l1, "node_id": node_id, "filters": filters},
        "after_json": None})
    return Response(content=data, media_type="application/xml" if node_id else "application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/runs/{run_id}/export/signavio", dependencies=EXPORT, response_class=Response)
async def export_signavio(run_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                          db: AsyncSession = Depends(get_db)) -> Response:
    return await _export(request, tenant, db, run_id, None)


@router.get("/runs/{run_id}/export/bpmn/{node_id}", dependencies=EXPORT, response_class=Response)
async def export_bpmn(run_id: str, node_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                      db: AsyncSession = Depends(get_db)) -> Response:
    return await _export(request, tenant, db, run_id, node_id)
