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
from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response
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
    run_id: Optional[str] = None
    objects: list[ObjectSummaryOut]


# Finished runs, as api/routes/versions.py's _DONE minus 'failed': run_agents.py and
# ai_enrich_report.py move a run past 'complete' once checks are in, so the newest
# finished run is often not status = 'complete'.
_FINISHED = ("complete", "partial", "agents_complete", "agents_failed", "ai_enriched")


async def _resolve_run(db: AsyncSession, tenant: Tenant, run: str) -> Optional[str]:
    """Resolve the literal `run=latest` to the tenant's newest finished run (None
    when the tenant has none — an empty tenant is not an error), otherwise
    validate the value as a run id."""
    if run == "latest":
        row = (await db.execute(text(
            "SELECT id::text FROM analysis_versions WHERE tenant_id = :t AND status = ANY(:done) "
            "ORDER BY run_at DESC LIMIT 1"
        ), {"t": str(tenant.id), "done": list(_FINISHED)})).fetchone()
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


@router.get("", response_model=ObjectsListOut, dependencies=[Depends(require_permission("view"))])
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


_OBJECTS_EXPORT_COLUMNS = [
    ColumnSpec("module", "Module"),
    ColumnSpec("label", "Label"),
    ColumnSpec("composite_score", "Composite score"),
    ColumnSpec("readiness", "Readiness"),
    ColumnSpec("failing_checks", "Failing checks", kind="int"),
    ColumnSpec("affected_records", "Affected records", kind="int"),
]


@router.get("/export", dependencies=[Depends(require_permission("export"))])
async def export_objects(run: str = Query(..., alias="run"),
                         format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
                         db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every object (module) summary for one run, as CSV or XLSX — same rows as GET /objects."""
    body = await list_objects(run=run, db=db, tenant=tenant)
    rows = body["objects"]
    if format == "csv":
        import csv
        import io as io_mod

        from fastapi.responses import StreamingResponse

        buf = io_mod.StringIO()
        writer = csv.DictWriter(buf, fieldnames=[c.key for c in _OBJECTS_EXPORT_COLUMNS])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=objects.csv"})
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
    dimension_scores: dict[str, float]
    rules: list[ObjectRuleOut]


@router.get("/{module}", response_model=ObjectDetailOut, dependencies=[Depends(require_permission("view"))])
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


_OBJECT_RULES_EXPORT_COLUMNS = [
    ColumnSpec("check_id", "Check ID", kind="mono"),
    ColumnSpec("severity", "Severity"),
    ColumnSpec("dimension", "Dimension"),
    ColumnSpec("affected_count", "Affected", kind="int"),
    ColumnSpec("total_count", "Total", kind="int"),
    ColumnSpec("pass_rate", "Pass rate", kind="pct", scale=100.0),
]


@router.get("/{module}/export", dependencies=[Depends(require_permission("export"))])
async def export_object(module: str, run: uuid.UUID = Query(..., alias="run"),
                        format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Every rule result for one object (module) in one run, as CSV or XLSX."""
    body = await get_object(module=module, run=run, db=db, tenant=tenant)
    rows = body["rules"]
    if format == "csv":
        import csv
        import io as io_mod

        from fastapi.responses import StreamingResponse

        buf = io_mod.StringIO()
        writer = csv.DictWriter(buf, fieldnames=[c.key for c in _OBJECT_RULES_EXPORT_COLUMNS])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f"attachment; filename={module}_rules.csv"})
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=str(run),
        run_id=str(run),
        title=f"{body['label']} rules export",
        sheets=[SheetSpec(title="Rules", columns=_OBJECT_RULES_EXPORT_COLUMNS, rows=rows)],
    )
    return xlsx_response(data, xlsx_filename(f"object-{module}", str(run)))
