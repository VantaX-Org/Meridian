"""Run step history — api/routes/runs.py.

GET /api/v1/runs/{id}/steps returns the durable step-by-step history of one
analysis or sync run, written by workers/tasks/run_checks.py and
workers/tasks/run_sync.py via api/services/run_steps.py. Tenant-isolated via
RLS plus an explicit tenant_id filter.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.routes.versions import list_versions
from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


_RUNS_EXPORT_COLUMNS = [
    ColumnSpec("id", "Run ID", kind="mono"),
    ColumnSpec("run_at", "Run at"),
    ColumnSpec("label", "Label"),
    ColumnSpec("status", "Status"),
    ColumnSpec("system", "System"),
    ColumnSpec("finished_at", "Finished"),
    ColumnSpec("duration_ms", "Duration (ms)", kind="int"),
    ColumnSpec("baseline", "Baseline"),
]


@router.get("/export", dependencies=[Depends(require_permission("export"))])
async def export_runs(
    limit: int = Query(100, ge=1, le=100),
    module: Optional[str] = None,
    system_id: Optional[str] = None,
    include_archived: bool = False,
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Every run matching the same filters as GET /versions, as CSV or XLSX.

    ponytail: capped at 100 rows, the same page-size ceiling list_versions
    already enforces; add real pagination here if a tenant has >100 runs
    and needs them all in one file. A cover note flags the cap when hit.
    """
    body = await list_versions(limit=limit, offset=0, module=module, system_id=system_id,
                               include_archived=include_archived, db=db, tenant=tenant)
    versions = body["versions"]
    version_ids = [v.id for v in versions]
    agg: dict[str, dict] = {}
    if version_ids:
        agg_rows = (await db.execute(text(
            "SELECT version_id, MAX(finished_at) AS finished_at, SUM(duration_ms) AS duration_ms "
            "FROM analysis_run_steps WHERE version_id = ANY(CAST(:ids AS uuid[])) AND tenant_id = :t "
            "GROUP BY version_id"
        ), {"ids": version_ids, "t": str(tenant.id)})).fetchall()
        agg = {str(r[0]): {"finished_at": r[1], "duration_ms": r[2]} for r in agg_rows}
    rows = []
    for v in versions:
        meta = v.metadata or {}
        a = agg.get(v.id, {})
        rows.append({
            "id": v.id,
            "run_at": v.run_at,
            "label": v.label,
            "status": v.status,
            "system": meta.get("system_id") or "upload",
            "finished_at": a.get("finished_at").isoformat() if a.get("finished_at") else None,
            "duration_ms": a.get("duration_ms"),
            "baseline": bool(meta.get("baseline")),
        })
    note = f"Truncated to {limit:,} runs; narrow the filter to export the rest." if len(rows) >= limit else None
    if format == "csv":
        from api.services.branded_xlsx import csv_response
        return csv_response(rows, _RUNS_EXPORT_COLUMNS, "runs", None)
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=None,
        run_id=None,
        title="Runs export",
        sheets=[SheetSpec(title="Runs", columns=_RUNS_EXPORT_COLUMNS, rows=rows, note=note)],
    )
    return xlsx_response(data, xlsx_filename("runs", None))


class RunStepOut(BaseModel):
    step_number: int
    step_name: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    error_detail: Optional[str] = None


class RunStepsOut(BaseModel):
    version_id: str
    steps: list[RunStepOut]


@router.get("/{version_id}/steps", response_model=RunStepsOut,
            dependencies=[Depends(require_permission("view"))])
async def get_run_steps(version_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    exists = (await db.execute(text(
        "SELECT 1 FROM analysis_versions WHERE id = :v AND tenant_id = :t"
    ), {"v": str(version_id), "t": str(tenant.id)})).fetchone()
    if not exists:
        raise HTTPException(404, "Run not found")
    rows = (await db.execute(text(
        "SELECT step_number, step_name, status, started_at, finished_at, "
        "duration_ms, error_detail FROM analysis_run_steps "
        "WHERE version_id = :v AND tenant_id = :t ORDER BY step_number"
    ), {"v": str(version_id), "t": str(tenant.id)})).fetchall()
    return {
        "version_id": str(version_id),
        "steps": [
            {"step_number": r[0], "step_name": r[1], "status": r[2], "started_at": r[3],
             "finished_at": r[4], "duration_ms": r[5], "error_detail": r[6]}
            for r in rows
        ],
    }


_RUN_STEPS_EXPORT_COLUMNS = [
    ColumnSpec("step_number", "Step", kind="int"),
    ColumnSpec("step_name", "Step name"),
    ColumnSpec("status", "Status"),
    ColumnSpec("started_at", "Started", kind="datetime"),
    ColumnSpec("finished_at", "Finished", kind="datetime"),
    ColumnSpec("duration_ms", "Duration (ms)", kind="int"),
    ColumnSpec("error_detail", "Error"),
]


@router.get("/{version_id}/steps/export", dependencies=[Depends(require_permission("export"))])
async def export_run_steps(version_id: uuid.UUID, format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
                           db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The step-by-step history of one run, as CSV or XLSX."""
    body = await get_run_steps(version_id=version_id, db=db, tenant=tenant)
    rows = body["steps"]
    if format == "csv":
        from api.services.branded_xlsx import csv_response
        return csv_response(rows, _RUN_STEPS_EXPORT_COLUMNS, "run-steps", str(version_id))
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=str(version_id),
        run_id=str(version_id),
        title="Run steps export",
        sheets=[SheetSpec(title="Steps", columns=_RUN_STEPS_EXPORT_COLUMNS, rows=rows)],
    )
    return xlsx_response(data, xlsx_filename("run-steps", str(version_id)))
