"""Object explorer list — api/routes/objects.py.

GET /api/v1/objects composes the per-module scores already written to
analysis_versions.dqs_summary by run_checks.py with a failing-check count
from findings, for one run. No new scoring logic — see api/services/scoring.py
for tier()/scoring_config(), which this reuses unchanged.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
from api.services.rbac import require_permission, scope_from_path
from api.services.scoring import DEFAULT_THRESHOLDS, scoring_config, tier

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
    # Optional enrichments (all backward compatible; None / [] when there is no source)
    blocking_rule_id: Optional[str] = None    # check_id of the highest-severity failing rule, ties: most records failing
    blocking_rule_name: Optional[str] = None  # that rule's title from the tenant's rules table, when it has one
    trend: list[float] = []                   # composite score of the last <=8 runs of the same system, oldest first
    worst_dimension: Optional[str] = None     # measured DAMA dimension with the lowest score
    owner: Optional[str] = None               # data_owners (kind 'object', ref = module) owner's name
    # measured DAMA dimension scores from the run summary (coverage 0 = not measured, omitted); {} when there is none
    dimension_scores: dict[str, float] = {}


class ObjectsListOut(BaseModel):
    run_id: Optional[str] = None
    objects: list[ObjectSummaryOut]
    blocking_findings_total: int = 0  # failing critical and high findings in the run
    # the tenant's DQS bands {target, warning, critical}, for the score rings
    thresholds: dict[str, float] = DEFAULT_THRESHOLDS


# Finished runs, as api/routes/versions.py's _DONE minus 'failed': run_agents.py and
# ai_enrich_report.py move a run past 'complete' once checks are in, so the newest
# finished run is often not status = 'complete'.
FINISHED = ("complete", "partial", "agents_complete", "agents_failed", "ai_enriched")


async def _resolve_run(db: AsyncSession, tenant: Tenant, run: str) -> Optional[str]:
    """Resolve the literal `run=latest` to the tenant's newest finished run (None
    when the tenant has none — an empty tenant is not an error), otherwise
    validate the value as a run id."""
    if run == "latest":
        row = (await db.execute(text(
            "SELECT id::text FROM analysis_versions WHERE tenant_id = :t AND status = ANY(:done) "
            "ORDER BY run_at DESC LIMIT 1"
        ), {"t": str(tenant.id), "done": list(FINISHED)})).fetchone()
        return row[0] if row else None
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
    names: dict[str, str] = {}
    if block:
        names = {r[0]: r[1] for r in (await db.execute(text(
            "SELECT DISTINCT ON (split_part(name, ':', 1)) split_part(name, ':', 1), trim(substr(name, strpos(name, ':') + 1)) "
            "FROM rules WHERE tenant_id = :t AND split_part(name, ':', 1) = ANY(:ids) AND strpos(name, ':') > 0 "
            "ORDER BY split_part(name, ':', 1), module"
        ), {"t": t["t"], "ids": [r[1] for r in block]})).fetchall()}
    blocking = {r[0]: (r[1], names.get(r[1])) for r in block}
    owners = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT d.ref, u.name FROM data_owners d JOIN users u ON u.id = d.owner_user_id "
        "WHERE d.tenant_id = :t AND d.kind = 'object'"), {"t": t["t"]})).fetchall()}
    # same system = same metadata.system_id ('upload' when absent), as api/routes/versions.py scopes runs
    trend_rows = (await db.execute(text(
        "SELECT dqs_summary FROM analysis_versions v WHERE v.tenant_id = :t AND v.status = ANY(:done) "
        "AND COALESCE(v.metadata->>'system_id', 'upload') = "
        "(SELECT COALESCE(c.metadata->>'system_id', 'upload') FROM analysis_versions c WHERE c.id = :v AND c.tenant_id = :t) "
        "AND v.run_at <= (SELECT c.run_at FROM analysis_versions c WHERE c.id = :v AND c.tenant_id = :t) "
        "ORDER BY v.run_at DESC LIMIT :n"), {**t, "done": list(FINISHED), "n": _TREND_RUNS})).fetchall()
    return blocking, owners, [r[0] or {} for r in reversed(trend_rows)], blocking_total


@router.get("", response_model=ObjectsListOut, dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def list_objects(run: str = Query(..., alias="run"),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    run_id = await _resolve_run(db, tenant, run)
    if run_id is None:
        return {"run_id": None, "objects": []}
    summary, thresholds = await _version_summary(db, tenant, run_id)

    rows = (await db.execute(text(
        "SELECT module, count(*) AS failing, coalesce(sum(affected_count), 0) AS affected "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND affected_count > 0 "
        "GROUP BY module"
    ), {"v": run_id, "t": str(tenant.id)})).fetchall()
    by_module = {r[0]: (r[1], r[2]) for r in rows}

    blocking, owners, history, blocking_total = await _enrichments(db, tenant, run_id)

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
            "blocking_rule_id": blocking.get(module, (None, None))[0],
            "blocking_rule_name": blocking.get(module, (None, None))[1],
            "trend": [float(h[module]["composite_score"]) for h in history
                      if isinstance(h.get(module), dict) and h[module].get("composite_score") is not None],
            "worst_dimension": _worst_dimension(mod_summary),
            "owner": owners.get(module),
            "dimension_scores": _measured_dimensions(mod_summary),
        })
    return {"run_id": run_id, "objects": objects, "thresholds": thresholds,
            "blocking_findings_total": blocking_total}


_OBJECTS_EXPORT_COLUMNS = [
    ColumnSpec("module", "Module"),
    ColumnSpec("label", "Label"),
    ColumnSpec("composite_score", "Composite score", kind="money"),
    ColumnSpec("readiness", "Readiness"),
    ColumnSpec("failing_checks", "Failing checks", kind="int"),
    ColumnSpec("affected_records", "Affected records", kind="int"),
]


@router.get("/export", dependencies=[Depends(require_permission("export", scope=scope_from_path))])
async def export_objects(run: str = Query(..., alias="run"),
                         format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every object (module) summary for one run, as CSV or XLSX — same rows as GET /objects."""
    body = await list_objects(run=run, db=db, tenant=tenant)
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
    dimension_scores: dict[str, float]
    rules: list[ObjectRuleOut]


@router.get("/{module}", response_model=ObjectDetailOut, dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def get_object(module: str, run: uuid.UUID = Query(..., alias="run"),
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    summary, thresholds = await _version_summary(db, tenant, str(run))
    mod_summary = summary.get(module) or {}
    score = mod_summary.get("composite_score")

    rows = (await db.execute(text(
        "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate "
        "FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "ORDER BY affected_count DESC"
    ), {"v": str(run), "t": str(tenant.id), "m": module})).fetchall()
    if not rows and not mod_summary:
        raise HTTPException(404, "Object not found for this run")
    failing = [r for r in rows if r[3] > 0]  # same definition as list_objects
    return {
        "module": module,
        "label": _label(module),
        "composite_score": score,
        "readiness": tier(score, thresholds) if score is not None else None,
        "failing_checks": len(failing),
        "affected_records": sum(r[3] for r in failing),
        "dimension_scores": {d: v for d, v in (mod_summary.get("dimension_scores") or {}).items()
                             if (mod_summary.get("dimension_coverage") or {}).get(d) != 0},  # coverage 0: not measured
        "rules": [
            {"check_id": r[0], "severity": r[1], "dimension": r[2], "affected_count": r[3],
             "total_count": r[4], "pass_rate": float(r[5]) if r[5] is not None else None}
            for r in rows
        ],
    }


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
