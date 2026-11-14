"""Object explorer list — api/routes/objects.py.

GET /api/v1/objects composes the per-module scores already written to
analysis_versions.dqs_summary by run_checks.py with a failing-check count
from findings, for one run. No new scoring logic — see api/services/scoring.py
for tier()/scoring_config(), which this reuses unchanged.
"""
import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from api.services import compare_sets, cycle_state, object_monitor, work_counts
from api.services.paging import page_meta, sort_items
from api.services.run_context import latest_run
from api.services.run_lineage import lineage_sql

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.branded_xlsx import (
    ColumnSpec,
    SheetSpec,
    build_workbook,
    csv_response,
    xlsx_filename,
    xlsx_response,
)
from api.routes import sync_trigger
from api.routes.sync_trigger import module_label
from api.services.rbac import require_permission, scope_from_path
from api.services.scoring import (DEFAULT_THRESHOLDS, critical_over_tolerance, effective_weights,
                                  scoring_config, tier)
from api.services.version_status import FINISHED
from api.services.cost_model_meta import CostModelOut, meta_of as cost_model_meta
from api.services.not_found import require_object
from api.middleware.licence import licensed_module
from checks.cost import effective as effective_cost_model

router = APIRouter(prefix="/api/v1/objects", tags=["objects"], dependencies=[Depends(licensed_module())])


def _label(module: str) -> str:
    """The module's display name from MODULE_LABELS (the same names as frontend/lib/format.ts formatModuleName);
    an unknown id is sentence-cased. The list, detail and CSV/XLSX exports all take their label from here."""
    return module_label(module)


class ObjectSummaryOut(BaseModel):
    module: str
    label: str
    composite_score: Optional[float] = None
    raw_score: Optional[float] = None         # the measured score before the critical cap (dqs_summary raw_score)
    # the measured score to rank by: raw_score, else composite_score when nothing caps it
    measured_score: Optional[float] = None
    capped: bool = False                      # a critical failure holds composite_score at its cap
    readiness: Optional[str] = None
    failing_checks: int
    affected_records: int
    critical_checks: int = 0                  # failing checks of severity critical (same definition as failing_checks)
    high_checks: int = 0                      # failing checks of severity high
    # Optional enrichments (all backward compatible; None / [] when there is no source)
    blocking_rule_id: Optional[str] = None    # check_id of the highest-severity failing rule, ties: most records failing
    blocking_rule_name: Optional[str] = None  # that rule's title from the tenant's rules table, when it has one
    trend: list[float] = []                   # composite score of the last <=8 runs of the same system, oldest first
    worst_dimension: Optional[str] = None     # measured DAMA dimension with the lowest score
    owner: Optional[str] = None               # data_owners (kind 'object', ref = module) owner's name
    # measured DAMA dimension scores from the run summary (coverage 0 = not measured, omitted); {} when there is none
    dimension_scores: dict[str, float] = {}
    # where the object stands in the clean cycle (api/services/cycle_state.py); None when the run has no lineage
    cycle: Optional[dict] = None


class ObjectsListOut(BaseModel):
    run_id: Optional[str] = None
    sort: str = "-measured"                   # the order of ``objects``: -measured (default), measured or module
    objects: list[ObjectSummaryOut]
    blocking_findings_total: int = 0  # failing critical and high findings in the run
    # the tenant's DQS bands {target, warning, critical}, for the score rings
    thresholds: dict[str, float] = DEFAULT_THRESHOLDS


# Finished runs, as api/routes/versions.py's _DONE minus 'failed': run_agents.py and
# ai_enrich_report.py move a run past 'complete' once checks are in, so the newest
# finished run is often not status = 'complete'.


async def _resolve_run(db: AsyncSession, tenant: Tenant, run: str) -> Optional[str]:
    """Resolve the literal `run=latest` to the tenant's newest finished run (None
    when the tenant has none — an empty tenant is not an error), otherwise
    validate the value as a run id."""
    if run == "latest":
        return await latest_run(db, tenant.id)
    try:
        uuid.UUID(run)
    except ValueError:
        raise HTTPException(422, "run must be a version id or 'latest'")
    return run


async def _version_summary(db: AsyncSession, tenant: Tenant, run_id: str) -> tuple[dict, dict]:
    """(dqs_summary of the run, tenant scoring thresholds); 404 when the run is not this tenant's."""
    version = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": run_id, "t": str(tenant.id)})).fetchone()
    if not version:
        raise HTTPException(404, "Run not found")
    raw_scoring = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                    {"t": str(tenant.id)})).scalar() or {}
    return version[0] or {}, scoring_config(raw_scoring)["thresholds"]


def _worst_dimension(mod_summary: dict) -> Optional[str]:
    coverage = mod_summary.get("dimension_coverage") or {}
    scores = {d: v for d, v in (mod_summary.get("dimension_scores") or {}).items()
              if v is not None and coverage.get(d) != 0}  # coverage 0: not measured
    return min(scores, key=lambda d: scores[d]) if scores else None


def _measured_dimensions(mod_summary: dict) -> dict[str, float]:
    coverage = mod_summary.get("dimension_coverage") or {}
    return {d: v for d, v in (mod_summary.get("dimension_scores") or {}).items()
            if v is not None and coverage.get(d) != 0}


def breach_ids(mod_summary: dict) -> list[str]:
    """check_ids of the failing critical rules over tolerance, from dqs_summary ``critical_breaches``
    ("MM014: 5.9% of MARA rows" -> "MM014"). [] for a summary stored before breaches were recorded."""
    out: list[str] = []
    for b in mod_summary.get("critical_breaches") or []:
        cid = str(b).split(":", 1)[0].strip()
        if cid and cid not in out:
            out.append(cid)
    return out


def cap_level_of(mod_summary: dict) -> Optional[int]:
    """The ceiling a critical failure holds the score at (85 for one rule over tolerance, 70 for two or more,
    api/services/scoring.py _cap); None when the score is not capped."""
    if not mod_summary.get("capped"):
        return None
    return 70 if critical_over_tolerance(mod_summary) >= 2 else 85


def records_checked_of(mod_summary: dict, widest_population: Optional[int] = None) -> Optional[int]:
    """Records the run checked for an object: the driving object's record count the run stored (clean_records),
    else ``widest_population`` (the largest rule population in the run's findings); None when neither exists."""
    n = (mod_summary.get("clean_records") or {}).get("records")
    if isinstance(n, (int, float)) and not isinstance(n, bool) and n > 0:
        return int(n)
    return widest_population if widest_population else None


async def rule_names(db: AsyncSession, tenant: Tenant, check_ids: list[str]) -> dict[str, str]:
    """{check_id: title} from the tenant's rules table (names are stored as "MM014: Base unit not valid")."""
    if not check_ids:
        return {}
    return {r[0]: r[1] for r in (await db.execute(text(
        "SELECT DISTINCT ON (split_part(name, ':', 1)) split_part(name, ':', 1), trim(substr(name, strpos(name, ':') + 1)) "
        "FROM rules WHERE tenant_id = :t AND split_part(name, ':', 1) = ANY(:ids) AND strpos(name, ':') > 0 "
        "ORDER BY split_part(name, ':', 1), module"
    ), {"t": str(tenant.id), "ids": check_ids})).fetchall()}


_SEVERITY_RANK = ("critical", "high", "medium", "low")
# One definition of "blocking" for the list: used by the per-object blocking rule and the list total.
BLOCKING_SEVERITIES: tuple[str, ...] = ("critical", "high")
_TREND_RUNS = 8


async def _enrichments(db: AsyncSession, tenant: Tenant, run_id: str) -> tuple[dict[str, tuple[str, Optional[str]]], dict[str, str], list[dict], int]:
    """Four tenant-scoped queries for the whole list, none per object:
    blocking rule per module (DISTINCT ON over the run's failing critical and high findings, one pass), their names (one rules lookup),
    owners (one data_owners join) and the last 8 runs' summaries of this run's system (8 rows).
    Returns (blocking {module: (check_id, name)}, owners {module: name}, trend rows, failing critical and high findings total)."""
    t = {"t": str(tenant.id), "v": run_id}
    block = (await db.execute(text(
        "SELECT DISTINCT ON (module) module, check_id FROM findings "
        "WHERE version_id = :v AND tenant_id = :t AND affected_count > 0 AND severity = ANY(:blocking) "
        "ORDER BY module, array_position(CAST(:rank AS text[]), severity) NULLS LAST, affected_count DESC, check_id"
    ), {**t, "rank": list(_SEVERITY_RANK), "blocking": list(BLOCKING_SEVERITIES)})).fetchall()
    blocking_total = (await db.execute(text(
        "SELECT count(*) FROM findings WHERE version_id = :v AND tenant_id = :t "
        "AND affected_count > 0 AND severity = ANY(:blocking)"), {**t, "blocking": list(BLOCKING_SEVERITIES)})).scalar() or 0
    names = await rule_names(db, tenant, [r[1] for r in block])
    blocking = {r[0]: (r[1], names.get(r[1])) for r in block}
    owners = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT d.ref, u.name FROM data_owners d JOIN users u ON u.id = d.owner_user_id "
        "WHERE d.tenant_id = :t AND d.kind = 'object'"), {"t": t["t"]})).fetchall()}
    # same lineage (the system, or uploads of the same objects), as api/routes/versions.py scopes runs
    trend_rows = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions v WHERE v.tenant_id = :t AND v.status = ANY(:done) "
        f"AND {lineage_sql('v')} = "
        f"(SELECT {lineage_sql('c')} FROM analysis_versions c WHERE c.id = :v AND c.tenant_id = :t) "
        "AND v.run_at <= (SELECT c.run_at FROM analysis_versions c WHERE c.id = :v AND c.tenant_id = :t) "
        "ORDER BY v.run_at DESC LIMIT :n"), {**t, "done": list(FINISHED), "n": _TREND_RUNS})).fetchall()
    return blocking, owners, [r[0] or {} for r in reversed(trend_rows)], blocking_total


@router.get("", response_model=ObjectsListOut, dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def list_objects(run: str = Query(..., alias="run"),
                       sort: Literal["-measured", "measured", "module"] = Query(
                           "-measured", description="ranked by the measured score before the critical cap "
                           "(-measured: highest first, the default; measured: lowest first), or by module id"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    run_id = await _resolve_run(db, tenant, run)
    if run_id is None:
        return {"run_id": None, "sort": sort, "objects": []}
    summary, thresholds = await _version_summary(db, tenant, run_id)

    rows = (await db.execute(text(
        "SELECT module, count(*) AS failing, coalesce(sum(affected_count), 0) AS affected, "
        "count(*) FILTER (WHERE severity = 'critical') AS crit, count(*) FILTER (WHERE severity = 'high') AS high "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND affected_count > 0 "
        "GROUP BY module"
    ), {"v": run_id, "t": str(tenant.id)})).fetchall()
    by_module = {r[0]: (r[1], r[2], r[3], r[4]) for r in rows}

    blocking, owners, history, blocking_total = await _enrichments(db, tenant, run_id)

    modules = sorted(set(summary.keys()) | set(by_module.keys()))
    scope = (await db.execute(text(f"SELECT {lineage_sql()} FROM analysis_versions WHERE id = :v"), {"v": run_id})).scalar()
    cycles = await cycle_state.cycles_for(db, tenant.id, scope) if scope else {}
    objects = []
    for module in modules:
        mod_summary = summary.get(module) or {}
        score = mod_summary.get("composite_score")
        failing, affected, crit, high = by_module.get(module, (0, 0, 0, 0))
        objects.append({
            "module": module,
            "label": _label(module),
            "composite_score": score,
            "raw_score": mod_summary.get("raw_score"),
            "measured_score": measured_of(mod_summary),
            "capped": bool(mod_summary.get("capped")),
            "readiness": tier(score, thresholds) if score is not None else None,
            "failing_checks": failing,
            "affected_records": affected,
            "critical_checks": crit,
            "high_checks": high,
            "blocking_rule_id": blocking.get(module, (None, None))[0],
            "blocking_rule_name": blocking.get(module, (None, None))[1],
            "trend": [float(h[module]["composite_score"]) for h in history
                      if isinstance(h.get(module), dict) and h[module].get("composite_score") is not None],
            "worst_dimension": _worst_dimension(mod_summary),
            "owner": owners.get(module),
            "dimension_scores": _measured_dimensions(mod_summary),
            "cycle": cycles.get(module),
        })
    if sort != "module":
        objects = sort_by_measured(objects, descending=sort == "-measured")
    return {"run_id": run_id, "sort": sort, "objects": objects, "thresholds": thresholds,
            "blocking_findings_total": blocking_total}


def measured_of(m: dict) -> Optional[float]:
    """The measured score before the critical cap: raw_score, else the score itself (nothing capped it)."""
    raw = m.get("raw_score")
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)
    score = m.get("composite_score")
    return float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else None


def sort_by_measured(items: list[dict], descending: bool, key: str = "measured_score") -> list[dict]:
    """Rank by the measured score (the capped score flattens ranking at 85 / 70); unmeasured last, stable ties."""
    have = [i for i in items if i.get(key) is not None]
    none = [i for i in items if i.get(key) is None]
    return sorted(have, key=lambda i: i[key], reverse=descending) + none


class MonitorCadenceOut(BaseModel):
    cron: Optional[str] = None             # sync_profiles.schedule_cron; None: checked by hand
    active: Optional[bool] = None          # False: paused; None: no sync profile (an upload, or never scheduled)
    interval_seconds: Optional[int] = None  # the longest gap between runs in the tenant time zone; None: manual
    profile_id: Optional[str] = None


class MonitorBaselineOut(BaseModel):
    kind: Optional[Literal["pinned", "previous"]] = None  # None: the object has fewer than two runs
    version_id: Optional[str] = None
    run_at: Optional[datetime] = None


class NewlyFailingRuleOut(BaseModel):
    check_id: str
    severity: Optional[str] = None
    new: int = 0  # records failing now


class RecoveredRuleOut(BaseModel):
    check_id: str


class MonitorDriftOut(BaseModel):
    new_failing: int = 0                    # records failing now that passed in the baseline
    recovered: int = 0                      # records that failed in the baseline and pass now
    newly_failing_rules: list[NewlyFailingRuleOut] = []   # worst severity first, at most 50
    recovered_rules: list[RecoveredRuleOut] = []       # at most 50
    newly_failing_rule_count: int = 0       # the uncapped totals
    recovered_rule_count: int = 0


class ObjectMonitorOut(BaseModel):
    module: str
    system_id: Optional[str] = None
    last_run_at: Optional[datetime] = None
    last_version_id: Optional[str] = None
    trigger: Optional[str] = None           # scheduled, manual, recheck or upload; None for runs before it was stamped
    requested_by_label: Optional[str] = None
    cadence: MonitorCadenceOut
    next_run_at: Optional[datetime] = None
    freshness: Literal["fresh", "due", "stale", "failed", "paused", "manual"]
    baseline: MonitorBaselineOut
    drift: MonitorDriftOut


class ObjectsMonitorOut(BaseModel):
    objects: list[ObjectMonitorOut]


@router.get("/monitor", response_model=ObjectsMonitorOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def monitor_objects(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Cadence, freshness, trigger, baseline and drift of every object of the current state, one row each."""
    await _rls(db, tenant)
    return {"objects": await object_monitor.for_current_state(db, tenant.id)}


class PortfolioRowOut(BaseModel):
    module: str
    label: str
    version_id: str
    run_at: Optional[datetime] = None
    system_id: Optional[str] = None
    composite_score: Optional[float] = None
    raw_score: Optional[float] = None
    measured_score: Optional[float] = None
    capped: bool = False
    readiness: Optional[str] = None           # tier against the default bands; the objects list uses the tenant's
    step: Optional[str] = None                # cycle.step, for sorting and filtering
    cycle: Optional[dict] = None
    run_number: Optional[int] = None
    owner: Optional[str] = None               # the object's data owner (data_owners), None when unassigned
    trend: list[float] = []                   # composite score of the lineage's last 8 finished runs, oldest first
    previous_score: Optional[float] = None    # composite score of the run before this one, for the delta
    new_issues: int = 0                       # records failing now and never before (against the monitor baseline)
    regressed: int = 0                        # records failing now that were fixed in an earlier run
    resolved: int = 0                         # records failing in the baseline that pass now
    freshness: Optional[str] = None           # object monitor freshness: fresh, due, stale, failed, paused, manual


class PortfolioOut(BaseModel):
    objects: list[PortfolioRowOut]
    total: int
    limit: int
    offset: int
    next_offset: Optional[int] = None


_PORTFOLIO_SORTS = ("module", "measured_score", "composite_score", "run_at", "step", "system_id", "new_issues",
                    "regressed", "resolved")
_PORTFOLIO_TREND_SQL = (f"SELECT dqs_summary FROM analysis_versions v WHERE v.tenant_id = CAST(:t AS uuid) "
                        f"AND v.status = ANY(:done) AND {lineage_sql('v')} = :s ORDER BY v.run_at DESC LIMIT :n")
_PORTFOLIO_RUNS_SQL = ("SELECT id::text AS id, run_at, run_number, dqs_summary, " + lineage_sql() + " AS scope, "
                       "metadata->>'system_id' AS system_id "
                       "FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))")


@router.get("/portfolio", response_model=PortfolioOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def portfolio(sort: str = Query("module", description="module, measured_score, composite_score, run_at, step, system_id, new_issues, "
                                      "regressed or resolved; "
                                      "a leading - sorts descending"),
                    q: Optional[str] = Query(None, description="Part of the module id or label"),
                    readiness: Optional[str] = Query(None),
                    step: Optional[Literal["pull", "clean", "upload", "score", "compare"]] = Query(None),
                    system_id: Optional[str] = Query(None), owner: Optional[str] = Query(None),
                    limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every object of the current state, each at its own newest run, with its cycle step. Paged and sorted on the
    server, so a tenant with hundreds of objects never sends them all."""
    from api.services.current_state import current_pairs, run_ids

    await _rls(db, tenant)
    pairs = await current_pairs(db, tenant.id)
    ids = run_ids(pairs)
    runs = {r["id"]: r for r in (await db.execute(text(_PORTFOLIO_RUNS_SQL), {"t": str(tenant.id), "ids": ids})).mappings()} if ids else {}
    thresholds = DEFAULT_THRESHOLDS
    cycles: dict[str, dict] = {}
    trends: dict[str, list[dict]] = {}
    for scope in {r["scope"] for r in runs.values()}:
        cycles[scope] = await cycle_state.cycles_for(db, tenant.id, scope)
        trends[scope] = [r[0] or {} for r in reversed((await db.execute(text(_PORTFOLIO_TREND_SQL), {
            "t": str(tenant.id), "s": scope, "done": list(FINISHED), "n": _TREND_RUNS})).fetchall())]
    owners = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT d.ref, u.name FROM data_owners d JOIN users u ON u.id = d.owner_user_id "
        "WHERE d.tenant_id = :t AND d.kind = 'object'"), {"t": str(tenant.id)})).fetchall()}
    drift: dict[str, dict] = {}
    for row in await object_monitor.for_current_state(db, tenant.id):
        res = await _drift_counts(db, row)
        drift[row["module"]] = {"freshness": row["freshness"], "resolved": row["drift"]["recovered"],
                                **({"new_issues": res["totals"]["new"], "regressed": res["totals"]["regressed"],
                                    "resolved": res["totals"]["resolved"]} if res else {})}
    items = []
    for pr in pairs:
        run = runs.get(pr["version_id"])
        if not run:
            continue
        m = (run["dqs_summary"] or {}).get(pr["module"]) or {}
        score = m.get("composite_score")
        cyc = cycles.get(run["scope"], {}).get(pr["module"])
        items.append({"module": pr["module"], "label": _label(pr["module"]), "version_id": pr["version_id"],
                      "run_at": run["run_at"], "system_id": run["system_id"], "composite_score": score,
                      "raw_score": m.get("raw_score"), "measured_score": measured_of(m), "capped": bool(m.get("capped")),
                      "readiness": tier(score, thresholds) if score is not None else None,
                      "cycle": cyc, "step": cyc["step"] if cyc else None, "run_number": run["run_number"],
                      "owner": owners.get(pr["module"]), **_trend_of(trends.get(run["scope"], []), pr["module"]),
                      **drift.get(pr["module"], {})})
    if system_id:
        items = [i for i in items if i["system_id"] == system_id]
    if owner:
        items = [i for i in items if i["owner"] == owner]
    if q:
        items = [i for i in items if q.lower() in i["module"].lower() or q.lower() in i["label"].lower()]
    if readiness:
        items = [i for i in items if i["readiness"] == readiness]
    if step:
        items = [i for i in items if i["step"] == step]
    items = sort_items(items, sort, _PORTFOLIO_SORTS, "module")
    return {"objects": items[offset:offset + limit], **page_meta(len(items), limit, offset)}


def _trend_of(history: list[dict], module: str) -> dict:
    """{trend, previous_score} of one object from its lineage's run summaries, oldest first."""
    pts = [float(h[module]["composite_score"]) for h in history
           if isinstance(h.get(module), dict) and h[module].get("composite_score") is not None]
    return {"trend": pts, "previous_score": pts[-2] if len(pts) > 1 else None}


async def _drift_counts(db: AsyncSession, row: dict) -> Optional[dict]:
    """New, regressed and resolved records of one monitor row against its baseline; None when nothing is new."""
    base = row["baseline"].get("version_id")
    if not base or not row["drift"]["new_failing"]:
        return None
    scope = str((await db.execute(text(f"SELECT {lineage_sql()} FROM analysis_versions WHERE id = :v"),
                                  {"v": row["last_version_id"]})).scalar())
    earlier = await compare_sets.earlier_runs(db, scope, base)
    return await compare_sets.counts(db, base, row["last_version_id"], earlier)


class BulkStartIn(BaseModel):
    module_ids: list[str]


@router.post("/portfolio/start", response_model=sync_trigger.TriggerResponse,
             dependencies=[Depends(require_permission("trigger_sync"))])
async def portfolio_start(body: BulkStartIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Re-run the checks of many objects at once: the sync trigger's rules, one call. At most 200 objects."""
    if not 1 <= len(body.module_ids) <= 200:
        raise HTTPException(422, "Give 1 to 200 objects.")
    return await sync_trigger.trigger_modules(sync_trigger.TriggerRequest(module_ids=body.module_ids), tenant.id, db)


class FeedItemOut(BaseModel):
    module: str
    label: str
    check_id: str
    change: Literal["new", "regressed"]
    records: int
    reason: Optional[str] = None
    version_id: str
    baseline_version_id: str
    detected_at: Optional[datetime] = None
    severity: Optional[str] = None      # findings.severity of the check in this run; None when the run has no such row
    owner: Optional[str] = None         # the object's data owner (data_owners), None when unassigned


class FeedRunOut(BaseModel):
    version_id: str
    resolved: int                       # records failing in the baseline and passing in this run (compare_sets)


class FeedOut(BaseModel):
    items: list[FeedItemOut]
    runs: list[FeedRunOut] = []         # every run with new findings, not only the page's
    total: int
    limit: int
    offset: int
    next_offset: Optional[int] = None


def _feed_rows(row: dict, res: dict, severities: dict[str, str], owner: Optional[str]) -> tuple[list[dict], int]:
    """The feed items of one monitor row from its drift counts, and the run's resolved record total."""
    base = row["baseline"]["version_id"]
    items = [{"module": row["module"], "label": _label(row["module"]), "check_id": c["check_id"], "change": kind,
              "records": c[kind], "reason": c["reason"], "version_id": row["last_version_id"],
              "baseline_version_id": base, "detected_at": row["last_run_at"],
              "severity": severities.get(c["check_id"]), "owner": owner}
             for c in res["checks"] for kind in ("new", "regressed") if c[kind]]
    return items, int(res["totals"]["resolved"])


@router.get("/monitor/feed", response_model=FeedOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def monitor_feed(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                       module: Optional[str] = Query(None),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """New and regressed issues across objects since each object's baseline, newest run first, most records first.
    Objects whose drift shows nothing new are not classified."""
    await _rls(db, tenant)
    owners = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT d.ref, u.name FROM data_owners d JOIN users u ON u.id = d.owner_user_id "
        "WHERE d.tenant_id = :t AND d.kind = 'object'"), {"t": str(tenant.id)})).fetchall()}
    items: list[dict] = []
    runs: list[dict] = []
    for row in await object_monitor.for_current_state(db, tenant.id, module):
        res = await _drift_counts(db, row)
        if not res:
            continue
        sev = {r[0]: r[1] for r in (await db.execute(text(
            "SELECT check_id, severity FROM findings WHERE tenant_id = :t AND version_id = :v"),
            {"t": str(tenant.id), "v": row["last_version_id"]})).fetchall()}
        got, resolved = _feed_rows(row, res, sev, owners.get(row["module"]))
        items += got
        runs.append({"version_id": str(row["last_version_id"]), "resolved": resolved})
    items.sort(key=lambda i: (-(i["detected_at"].timestamp() if i["detected_at"] else 0), -i["records"], i["module"], i["check_id"]))
    return {"items": items[offset:offset + limit], "runs": runs, **page_meta(len(items), limit, offset)}


_OBJECTS_EXPORT_COLUMNS = [
    ColumnSpec("module", "Module"),
    ColumnSpec("label", "Label"),
    ColumnSpec("composite_score", "Composite score", kind="money"),
    ColumnSpec("readiness", "Readiness"),
    ColumnSpec("failing_checks", "Failing checks", kind="int"),
    # summed over the failing rules (a record failing two rules counts twice): rule failures, not records
    ColumnSpec("affected_records", "Rule failures", kind="int"),
]


@router.get("/export", dependencies=[Depends(require_permission("export", scope=scope_from_path))])
async def export_objects(run: str = Query(..., alias="run"),
                         format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every object (module) summary for one run, as CSV or XLSX — same rows as GET /objects."""
    body = await list_objects(run=run, sort="module", db=db, tenant=tenant)
    rows = body["objects"]
    if format == "csv":
        return csv_response(rows, _OBJECTS_EXPORT_COLUMNS, "objects", body["run_id"])
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=body["run_id"],
        run_id=body["run_id"],
        title="Objects export",
        sheets=[SheetSpec(title="Objects", columns=_OBJECTS_EXPORT_COLUMNS, rows=rows)],
    )
    return xlsx_response(data, xlsx_filename("objects", body["run_id"]))


CAP_RULE = "85 at one critical rule over tolerance, 70 at two or more"  # api/services/scoring.py _cap
# The same rule as stable codes for a client to translate (PO-3): CAP_RULE stays for compatibility.
CAP_RULE_CODE = "critical_cap"
CAP_LEVELS: tuple[dict, ...] = ({"min_critical_over_tolerance": 1, "cap": 85},
                                {"min_critical_over_tolerance": 2, "cap": 70})


def cap_rule_detail(mod_summary: dict) -> dict:
    """The cap rule as codes: its levels, how many critical rules are over tolerance, and the cap applied."""
    return {"code": CAP_RULE_CODE, "levels": [dict(lv) for lv in CAP_LEVELS],
            "critical_over_tolerance": critical_over_tolerance(mod_summary),
            "applied_cap": cap_level_of(mod_summary)}


class CapLevelOut(BaseModel):
    min_critical_over_tolerance: int
    cap: int


class CapRuleOut(BaseModel):
    code: str                                  # "critical_cap"
    levels: list[CapLevelOut]                  # 85 at one critical rule over tolerance, 70 at two or more
    critical_over_tolerance: int               # in this run
    applied_cap: Optional[int] = None          # the cap holding the score, None when not capped


class FormulaTermOut(BaseModel):
    dimension_id: str                          # completeness | accuracy | consistency | timeliness | uniqueness | validity
    weight: float


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
    failing_checks: int
    affected_records: int
    capped: bool = False
    raw_score: Optional[float] = None  # the measured score before the cap
    measured_score: Optional[float] = None  # raw_score, else composite_score when nothing caps it
    cap_reason: Optional[str] = None         # English sentence, kept for compatibility
    cap_rule_detail: Optional[CapRuleOut] = None  # the cap as codes: levels, rules over tolerance, cap applied
    breaches: list[str] = []                 # check_ids of the critical rules over tolerance (codes for cap_reason)
    dimension_scores: dict[str, float]
    rules: list[ObjectRuleOut]


@router.get("/{module}", response_model=ObjectDetailOut, dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def get_object(module: str, run: uuid.UUID = Query(..., alias="run"),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    await require_object(db, tenant.id, module)
    summary, thresholds = await _version_summary(db, tenant, str(run))
    mod_summary = summary.get(module) or {}
    score = mod_summary.get("composite_score")

    rows = (await db.execute(text(
        "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "ORDER BY affected_count DESC"
    ), {"v": str(run), "t": str(tenant.id), "m": module})).fetchall()
    if not rows and not mod_summary:
        raise HTTPException(404, f"{_label(module)} has no result in this run.")
    failing = [r for r in rows if r[3] > 0]  # same definition as list_objects
    return {
        "module": module,
        "label": _label(module),
        "composite_score": score,
        "readiness": tier(score, thresholds) if score is not None else None,
        "failing_checks": len(failing),
        "affected_records": sum(r[3] for r in failing),
        # the score's cap as dqs_summary records it, so the explainer can say why the score stops where it does
        "capped": bool(mod_summary.get("capped")),
        "cap_reason": mod_summary.get("cap_reason"),
        "cap_rule_detail": cap_rule_detail(mod_summary), "breaches": breach_ids(mod_summary),
        "raw_score": mod_summary.get("raw_score"),
        "measured_score": measured_of(mod_summary),
        "dimension_scores": {d: v for d, v in (mod_summary.get("dimension_scores") or {}).items()
                             if (mod_summary.get("dimension_coverage") or {}).get(d) != 0},  # coverage 0: not measured
        "rules": [
            {"check_id": r[0], "severity": r[1], "dimension": r[2], "affected_count": r[3],
             "total_count": r[4], "pass_rate": float(r[5]) if r[5] is not None else None}
            for r in rows
        ],
    }


_DIMENSION_ORDER = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")
_DIMENSION_SHORT = {"completeness": "C", "accuracy": "A", "consistency": "Cs", "timeliness": "T",
                    "uniqueness": "U", "validity": "V"}
class ReceiptDimensionOut(BaseModel):
    key: str
    dimension_id: str                         # the stable id to translate (same as key); ``label`` is English
    label: str
    weight: Optional[float] = None            # share of the score over the measured dimensions (sums to 1)
    score: float
    points: Optional[float] = None            # score x weight, one decimal
    rules_measured: Optional[int] = None      # rules that backed the dimension's score (dqs_summary dimension_coverage)
    records_checked: Optional[int] = None     # the largest rule population among the dimension's rules in the run
    coverage: Optional[float] = None          # not stored per dimension: always null


class ReceiptBreachOut(BaseModel):
    check_id: str
    name: Optional[str] = None
    failing: Optional[int] = None
    pct: Optional[float] = None
    tolerance_rows: float
    tolerance_pct: float


class ReceiptToleranceOut(BaseModel):
    pct: float
    rows: float


class ReceiptContractBreachOut(BaseModel):
    contract_id: str
    name: Optional[str] = None
    enforce: bool = False
    metric: str                               # score | critical_breaches | a dimension
    threshold: Optional[float] = None
    actual: Optional[float] = None


class ReceiptPolicyBreachOut(BaseModel):
    pack_id: str
    class_id: str
    label: str
    authority: str
    rules: list[str]                          # the class's critical rules failing in this run


class ObjectReceiptOut(BaseModel):
    module: str
    label: str
    run_id: str
    run_at: Optional[datetime] = None
    records_checked: Optional[int] = None
    rules_measured: Optional[int] = None
    coverage: Optional[float] = None
    low_confidence: bool = False
    weights: dict[str, float]
    dimensions: list[ReceiptDimensionOut]
    weighted: Optional[float] = None          # sum of points; equal to ``measured`` whenever it can be reproduced
    measured: Optional[float] = None          # the score before the critical cap
    cap_level: Optional[int] = None
    capped: bool = False
    score: Optional[float] = None
    breaches: list[ReceiptBreachOut]
    tolerance: ReceiptToleranceOut
    formula: str
    formula_terms: list[FormulaTermOut] = []  # the formula as (dimension id, weight) pairs, in formula order
    severity_weights: dict[str, float]
    cap_rule: str                             # English sentence, kept for compatibility
    cap_rule_detail: Optional[CapRuleOut] = None  # the same rule as codes and thresholds
    value_at_risk: Optional[float] = None
    currency: str
    # whether value_at_risk is priced by the tenant's own cost model or by the shipped defaults
    cost_model: Optional[CostModelOut] = None
    cost_model_source: Optional[str] = None  # cost_model.source, flat for the status strip and money cells
    features_blocked: Optional[int] = None
    features_degraded: Optional[int] = None
    open_work: Optional[int] = None
    # data contracts covering the object that this run breaches (api/services/contract_enforcement.py)
    contract_breaches: list[ReceiptContractBreachOut] = []
    # applied policy-pack classes with a failing critical rule of this object in this run (api/services/policy_packs.py)
    policy_breaches: int = 0
    policy_breach_classes: list[ReceiptPolicyBreachOut] = []


def reweigh(mod_summary: dict, configured: dict[str, float]) -> tuple[dict[str, float], Optional[float], Optional[float], bool]:
    """(share per measured dimension, weighted, measured, reproduced): the score re-weighted over the measured
    dimensions exactly as scoring._composite does (weights of the dimensions that have rules, rescaled to 1).
    The run's own stored ``weights`` win over the tenant's current ones. ``weighted`` is the one-decimal sum;
    ``measured`` equals it when the stored ``raw_score`` agrees (``reproduced``), else it is the stored
    ``raw_score`` and ``weighted`` is None -- never a made-up row."""
    dims = _measured_dimensions(mod_summary)
    raw = mod_summary.get("raw_score")
    stored = {d: w for d, w in (mod_summary.get("weights") or {}).items()
              if isinstance(w, (int, float)) and not isinstance(w, bool) and w > 0}
    base = stored if dims and all(d in stored for d in dims) else configured
    total = sum(base.get(d, 0.0) for d in dims)
    if not dims or total <= 0:
        return {}, None, raw, False
    shares = {d: base.get(d, 0.0) / total for d in dims}
    weighted = round(sum(dims[d] * shares[d] for d in dims), 1)
    if raw is not None and abs(weighted - raw) > 0.1:  # the stored summary cannot reproduce its own score
        return shares, None, raw, False
    return shares, weighted, weighted, True


@router.get("/{module}/receipt", response_model=ObjectReceiptOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def get_object_receipt(module: str, run: Optional[uuid.UUID] = Query(None, alias="run"),
                             db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """How one object's score was reached in one run (default: the object's latest): per-dimension points,
    the re-weighted total, the critical cap and the rules over tolerance that trigger it."""
    await _rls(db, tenant)
    await require_object(db, tenant.id, module)
    run_id = str(run) if run else await latest_run(db, tenant.id, module=module)
    if run_id is None:
        raise HTTPException(404, f"{_label(module)} has not been measured in any run yet.")
    summary, _thresholds = await _version_summary(db, tenant, run_id)
    mod_summary = summary.get(module) or {}
    if not mod_summary:
        raise HTTPException(404, f"{_label(module)} has no result in this run.")
    t = {"t": str(tenant.id), "v": run_id, "m": module}
    tenant_row = (await db.execute(text("SELECT dqs_weights, cost_model FROM tenants WHERE id = :t"),
                                   {"t": t["t"]})).fetchone()
    raw_cfg = (tenant_row[0] if tenant_row else None) or {}
    cfg = scoring_config(raw_cfg)
    configured = effective_weights(raw_cfg)
    cost_model = tenant_row[1] if tenant_row and isinstance(tenant_row[1], dict) else None
    currency = str(effective_cost_model(cost_model)["currency"])
    run_at = (await db.execute(text("SELECT run_at FROM analysis_versions WHERE id = :v AND tenant_id = :t"), t)).scalar()

    dim_rows = (await db.execute(text(
        "SELECT dimension, max(total_count) FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "GROUP BY dimension"), t)).fetchall()
    population = {r[0]: int(r[1]) for r in dim_rows if r[1]}
    measured_dims = _measured_dimensions(mod_summary)
    shares, weighted, measured, reproduced = reweigh(mod_summary, configured)
    coverage_n = mod_summary.get("dimension_coverage") or {}
    dimensions = [{
        "key": d, "dimension_id": d, "label": d.capitalize(),
        "weight": round(shares[d], 4) if reproduced else None,
        "score": measured_dims[d],
        "points": round(measured_dims[d] * shares[d], 1) if reproduced else None,
        "rules_measured": coverage_n.get(d) if isinstance(coverage_n.get(d), int) else None,
        "records_checked": population.get(d),
        "coverage": None,
    } for d in _DIMENSION_ORDER if d in measured_dims]

    ids = breach_ids(mod_summary)
    tol = cfg["critical_tolerance"]
    found = {r[0]: r for r in (await db.execute(text(
        "SELECT check_id, affected_count, total_count FROM findings WHERE version_id = :v AND tenant_id = :t "
        "AND module = :m AND check_id = ANY(:ids)"), {**t, "ids": ids})).fetchall()} if ids else {}
    names = await rule_names(db, tenant, ids)
    breaches = [{
        "check_id": cid, "name": names.get(cid),
        "failing": int(found[cid][1]) if cid in found else None,
        "pct": (round(found[cid][1] / found[cid][2] * 100, 2) if cid in found and found[cid][2] else None),
        "tolerance_rows": tol["rows"], "tolerance_pct": tol["pct"],
    } for cid in ids]

    value_at_risk = (await db.execute(text(
        "SELECT sum(cost_at_risk) FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "AND affected_count > 0"), t)).scalar()
    own_checks = {r[0] for r in (await db.execute(text(
        "SELECT check_id FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m"), t)).fetchall()}
    impact = (await db.execute(text(
        "SELECT status, blocking_findings FROM config_impact_results WHERE version_id = :v AND tenant_id = :t "
        "AND status IN ('blocked', 'degraded')"), t)).fetchall()

    def _touches(blocking: object) -> bool:
        items = blocking if isinstance(blocking, list) else []
        return any((i.get("check_id") if isinstance(i, dict) else i) in own_checks for i in items)

    built = (await db.execute(text("SELECT metadata ? 'worklist_built_at' FROM analysis_versions "
                                   "WHERE id = :v AND tenant_id = :t"), t)).scalar()
    open_work = await work_counts.open_count(db, t["t"], t["v"], module) if built else None  # migration 108

    from api.services import contract_enforcement as ce
    contract_breaches = [{k: b[k] for k in ("contract_id", "name", "enforce", "metric", "threshold", "actual")}
                         for b in ce.breaches_of(await ce.active(db, t["t"]), {module: mod_summary}, [module])]

    from api.services import policy_packs
    policy = (await policy_packs.breaches(db, t["t"], [run_id], module)).get((run_id, module), [])

    w = {d: round(configured[d], 4) for d in _DIMENSION_ORDER}
    formula = "DQS = " + " + ".join(f"{w[d]:.2f} × {_DIMENSION_SHORT[d]}" for d in _DIMENSION_ORDER)
    coverage = mod_summary.get("coverage")
    return {
        "module": module, "label": _label(module), "run_id": run_id, "run_at": run_at,
        "records_checked": records_checked_of(mod_summary, max(population.values()) if population else None),
        "rules_measured": mod_summary.get("total_checks"),
        "coverage": coverage if isinstance(coverage, (int, float)) else None,
        "low_confidence": bool(mod_summary.get("low_confidence")),
        "weights": w, "dimensions": dimensions, "weighted": weighted, "measured": measured,
        "cap_level": cap_level_of(mod_summary), "capped": bool(mod_summary.get("capped")),
        "score": mod_summary.get("composite_score"),
        "breaches": breaches, "tolerance": {"pct": tol["pct"], "rows": tol["rows"]},
        "formula": formula, "formula_terms": [{"dimension_id": d, "weight": w[d]} for d in _DIMENSION_ORDER],
        "severity_weights": cfg["severity_weights"], "cap_rule": CAP_RULE,
        "cap_rule_detail": cap_rule_detail(mod_summary),
        "value_at_risk": float(value_at_risk) if value_at_risk is not None else None, "currency": currency,
        "cost_model": cost_model_meta(cost_model),
        "cost_model_source": cost_model_meta(cost_model)["source"],
        "features_blocked": sum(1 for r in impact if r[0] == "blocked" and _touches(r[1])),
        "features_degraded": sum(1 for r in impact if r[0] == "degraded" and _touches(r[1])),
        "open_work": int(open_work) if open_work is not None else None,
        "contract_breaches": contract_breaches,
        "policy_breaches": len(policy), "policy_breach_classes": policy,
    }


@router.get("/{module}/monitor", response_model=ObjectMonitorOut,
            dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def monitor_object(module: str, run: Optional[uuid.UUID] = Query(None, alias="run"),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """One object's monitor: at run ``run``, else at its own latest run."""
    await _rls(db, tenant)
    await require_object(db, tenant.id, module)
    row = await object_monitor.for_module(db, tenant.id, module, str(run) if run else None)
    if row is None:
        raise HTTPException(404, f"{_label(module)} has not been measured in any run yet.")
    return row


_OBJECT_RULES_EXPORT_COLUMNS = [
    ColumnSpec("check_id", "Check ID", kind="mono"),
    ColumnSpec("severity", "Severity"),
    ColumnSpec("dimension", "Dimension"),
    ColumnSpec("affected_count", "Affected", kind="int"),
    ColumnSpec("total_count", "Total", kind="int"),
    ColumnSpec("pass_rate", "Pass rate", kind="pct", scale=1.0),
]

_OBJECT_DIMENSIONS_EXPORT_COLUMNS = [
    ColumnSpec("dimension", "Dimension"),
    ColumnSpec("score", "Score", kind="money"),
]


@router.get("/{module}/export", dependencies=[Depends(require_permission("export", scope=scope_from_path))])
async def export_object(module: str, run: uuid.UUID = Query(..., alias="run"),
                        format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every rule result for one object (module) in one run, as CSV or XLSX."""
    body = await get_object(module=module, run=run, db=db, tenant=tenant)
    rows = body["rules"]
    if format == "csv":
        return csv_response(rows, _OBJECT_RULES_EXPORT_COLUMNS, f"object-{module}", str(run))
    dimension_rows = [
        {"dimension": dim, "score": score} for dim, score in sorted(body["dimension_scores"].items())
    ]
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=str(run),
        run_id=str(run),
        title=f"{body['label']} rules export",
        sheets=[
            SheetSpec(title="Dimensions", columns=_OBJECT_DIMENSIONS_EXPORT_COLUMNS, rows=dimension_rows),
            SheetSpec(title="Rules", columns=_OBJECT_RULES_EXPORT_COLUMNS, rows=rows),
        ],
    )
    return xlsx_response(data, xlsx_filename(f"object-{module}", str(run)))
