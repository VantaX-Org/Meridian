import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.services.rbac import require_permission
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import jobs
from api.services.branded_xlsx import (
    ROW_CAP,
    ColumnSpec,
    SheetSpec,
    build_workbook,
    csv_response,
    xlsx_filename,
    xlsx_response,
)
from db.schema import AnalysisVersion

router = APIRouter(prefix="/api/v1", tags=["versions"])
logger = logging.getLogger("meridian.versions")


class VersionResponse(BaseModel):
    id: str
    run_at: str
    label: Optional[str]
    status: str
    dqs_summary: Optional[dict]
    metadata: Optional[dict]


class PatchVersionRequest(BaseModel):
    label: str


def _version_to_response(v: AnalysisVersion) -> VersionResponse:
    return VersionResponse(
        id=str(v.id),
        run_at=v.run_at.isoformat() if v.run_at else "",
        label=v.label,
        status=v.status,
        dqs_summary=v.dqs_summary,
        metadata=v.metadata_,
    )


@router.get("/versions")
async def list_versions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    module: Optional[str] = Query(None),
    system_id: Optional[str] = Query(None, description="Only versions downloaded from this system"),
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    stmt = (
        select(AnalysisVersion)
        .where(AnalysisVersion.tenant_id == tenant.id)
        .order_by(AnalysisVersion.run_at.desc())
    )
    if not include_archived:
        stmt = stmt.where(AnalysisVersion.metadata_.op("->>")("archived").is_distinct_from("true"))
    if module:
        # Filter by module in metadata JSON
        stmt = stmt.where(
            AnalysisVersion.metadata_.op("->>")("modules").contains(module)
        )
    if system_id:
        stmt = stmt.where(AnalysisVersion.metadata_.op("->>")("system_id") == system_id)
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    versions = result.scalars().all()
    return {"versions": [_version_to_response(v) for v in versions]}


ARCHIVE_SQL = """
    UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"archived": true}'::jsonb
     WHERE tenant_id = :tid
       AND (status = ANY(:done) OR run_at < now() - interval '6 hours')  -- runs a restart left "running"
       AND COALESCE(metadata->>'archived', '') <> 'true'
       AND id NOT IN (SELECT id FROM analysis_versions WHERE tenant_id = :tid AND status = ANY(:done)
                       ORDER BY run_at DESC LIMIT :keep)
"""
RESTORE_SQL = ("UPDATE analysis_versions SET metadata = metadata - 'archived' "
               "WHERE tenant_id = :tid AND metadata->>'archived' = 'true'")
_DONE = ("complete", "partial", "agents_complete", "agents_failed", "ai_enriched", "failed")


@router.post("/versions/archive", dependencies=[Depends(require_permission("analyse"))])
async def archive_versions(
    keep_latest: int = Query(1, ge=0, le=100),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Hide finished runs from every list, keeping the newest ``keep_latest``.
    Nothing is deleted: findings, reports and history stay, and
    ``/versions/restore`` brings them back."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    res = await db.execute(text(ARCHIVE_SQL), {"tid": str(tenant.id), "done": list(_DONE), "keep": keep_latest})
    await db.commit()
    return {"archived": res.rowcount}


@router.post("/versions/restore", dependencies=[Depends(require_permission("analyse"))])
async def restore_versions(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    res = await db.execute(text(RESTORE_SQL), {"tid": str(tenant.id)})
    await db.commit()
    return {"restored": res.rowcount}


# a check changed state only when it ran cleanly in both versions
_CHECK_CHANGES_SQL = """
    SELECT f2.check_id, f2.module, f2.severity, f1.affected_count AS v1_affected, f2.affected_count AS v2_affected
      FROM findings f1
      JOIN findings f2 ON f2.check_id = f1.check_id AND f2.version_id = :v2
     WHERE f1.version_id = :v1
       AND f1.details->>'error' IS NULL AND f2.details->>'error' IS NULL
       AND (f1.affected_count > 0) <> (f2.affected_count > 0)
       AND (CAST(:module AS text) IS NULL OR f2.module = CAST(:module AS text))
     ORDER BY CASE f2.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              f2.check_id
"""


@router.get("/versions/compare")
async def compare_versions(
    v1: str = Query(...),
    v2: str = Query(...),
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Per-object DQS and dimension deltas (v2 − v1), and the checks that started
    or stopped failing between the two versions."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid1, vid2 = await _resolve_pair(db, v1, v2)
    found = {v.id: v for v in (await db.execute(
        select(AnalysisVersion).where(AnalysisVersion.id.in_([vid1, vid2]),
                                      AnalysisVersion.tenant_id == tenant.id))).scalars()}
    ver1, ver2 = found.get(vid1), found.get(vid2)
    if not ver1 or not ver2:
        raise HTTPException(status_code=404, detail="One or both versions not found")

    summary1 = ver1.dqs_summary or {}
    summary2 = ver2.dqs_summary or {}

    from api.services.pdf_reports import module_deltas

    delta = {m: d for m, d in module_deltas(summary1, summary2).items() if not module or m == module}

    rows = (await db.execute(text(_CHECK_CHANGES_SQL), {"v1": vid1, "v2": vid2, "module": module})).fetchall()
    changes = [{"check_id": r.check_id, "module": r.module, "severity": r.severity,
                "v1_affected": r.v1_affected, "v2_affected": r.v2_affected} for r in rows]
    return {
        "v1": _version_to_response(ver1),
        "v2": _version_to_response(ver2),
        "delta": delta,
        "checks": {
            "newly_failing": [c for c in changes if c["v2_affected"] > 0],
            "fixed": [c for c in changes if c["v1_affected"] > 0],
        },
    }


async def _scope_of(db: AsyncSession, vid: uuid.UUID) -> Optional[str]:
    row = (await db.execute(text("SELECT COALESCE(metadata->>'system_id', 'upload') FROM analysis_versions "
                                 "WHERE id = :v"), {"v": vid})).fetchone()
    return row[0] if row else None


async def _resolve_pair(db: AsyncSession, v1: Optional[str], v2: str) -> tuple[uuid.UUID, uuid.UUID]:
    """v1 defaults to the pinned baseline of v2's lineage, else the previous complete run."""
    vid2 = uuid.UUID(v2)
    scope = await _scope_of(db, vid2)
    if scope is None:
        raise HTTPException(status_code=404, detail="Version not found")
    if v1:
        vid1 = uuid.UUID(v1)
        scope1 = await _scope_of(db, vid1)
        if scope1 is None:
            raise HTTPException(status_code=404, detail="Version not found")
        if "upload" not in (scope1, scope) and scope1 != scope:
            raise HTTPException(status_code=400, detail="The versions belong to different systems.")
        return vid1, vid2
    row = (await db.execute(text("""
        SELECT id FROM analysis_versions
         WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND id <> :v2 AND status = 'complete'
           AND run_at <= (SELECT run_at FROM analysis_versions WHERE id = :v2)
         ORDER BY (metadata->>'baseline') = 'true' DESC NULLS LAST, run_at DESC LIMIT 1
    """), {"scope": scope, "v2": vid2})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No earlier run of this system to compare with.")
    return row[0], vid2


@router.get("/versions/compare/records")
async def compare_records(
    v2: str = Query(...),
    v1: Optional[str] = Query(None, description="Default: pinned baseline, else the previous run"),
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Per check: records newly failing, no longer failing, and still failing between two runs.

    ``comparable`` is false when the check did not run cleanly in both runs
    (skipped / errored) or a key list was truncated — those deltas are not
    conclusions about the data.
    """
    from api.services.record_issues import DIFF_SQL

    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid1, vid2 = await _resolve_pair(db, v1, v2)
    rows = (await db.execute(text(DIFF_SQL), {"v1": vid1, "v2": vid2})).fetchall()
    checks = []
    for r in rows:
        if module and r.module != module:
            continue
        checks.append({
            "check_id": r.check_id, "module": r.module, "severity": r.severity,
            "new": r.new, "resolved": r.resolved, "persisting": r.persisting,
            "comparable": bool(r.ran_v1 and r.ran_v2 and not r.truncated),
        })
    checks.sort(key=lambda c: (-c["new"], -c["persisting"], c["check_id"]))
    comparable = [c for c in checks if c["comparable"]]
    return {
        "v1": str(vid1), "v2": str(vid2),
        "totals": {k: sum(c[k] for c in comparable) for k in ("new", "resolved", "persisting")},
        "checks": checks,
    }


@router.get("/versions/compare/records/{check_id}")
async def compare_records_list(
    check_id: str,
    v2: str = Query(...),
    v1: Optional[str] = Query(None),
    change: str = Query("new", pattern="^(new|resolved|persisting)$"),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    from api.services.record_issues import diff_records_sql

    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid1, vid2 = await _resolve_pair(db, v1, v2)
    rows = await db.execute(text(diff_records_sql(change)), {
        "v1": vid1, "v2": vid2, "cid": check_id, "q": f"%{search}%" if search else None,
        "limit": limit, "offset": offset})
    return {"v1": str(vid1), "v2": str(vid2), "change": change, "record_keys": [r[0] for r in rows]}


@router.get("/versions/{version_id}/findings/{check_id}/records")
async def finding_records(
    version_id: uuid.UUID,
    check_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """The SAP records this check found failing in this version (finding_records): key plus
    the rule's column values (privacy-sensitive ones masked; null for runs before 054)."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    if await _scope_of(db, version_id) is None:
        raise HTTPException(status_code=404, detail="Version not found")
    p = {"v": version_id, "cid": check_id}
    total = (await db.execute(text("SELECT COUNT(*) FROM finding_records WHERE version_id = :v AND check_id = :cid"),
                              p)).scalar()
    rows = await db.execute(text("""
        SELECT record_key, grain, module, field_values FROM finding_records
         WHERE version_id = :v AND check_id = :cid
         ORDER BY record_key LIMIT :limit OFFSET :offset
    """), {**p, "limit": limit, "offset": offset})
    return {"version_id": str(version_id), "check_id": check_id, "total": int(total or 0),
            "records": [dict(r._mapping) for r in rows.fetchall()]}


@router.get("/versions/{version_id}/findings/{check_id}/root-cause")
async def finding_root_cause(
    version_id: uuid.UUID,
    check_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Who set this check's failing values, grouped by origin: an interface or batch user,
    a dialog transaction, or a migration load before go-live. The data comes from SAP change
    documents (workers/tasks/root_cause.py, after the analysis). The status is ``not_computed``
    until that task has run."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    if await _scope_of(db, version_id) is None:
        raise HTTPException(status_code=404, detail="Version not found")
    row = (await db.execute(text("""
        SELECT status, field, analysed, total, origins, summary, detail FROM finding_root_causes
         WHERE version_id = :v AND check_id = :cid AND tenant_id = :tid
         ORDER BY created_at DESC LIMIT 1
    """), {"v": version_id, "cid": check_id, "tid": str(tenant.id)})).fetchone()
    base = {"version_id": str(version_id), "check_id": check_id}
    if row is None:
        return {**base, "status": "not_computed", "field": None, "analysed": 0, "total": 0,
                "origins": [], "summary": "", "detail": ""}
    return {**base, **dict(row._mapping)}


_FINDING_RECORDS_BASE_COLUMNS = [
    ColumnSpec("record_key", "Record key", kind="mono"),
    ColumnSpec("grain", "Grain"),
    ColumnSpec("module", "Module"),
]


@router.get("/versions/{version_id}/findings/{check_id}/records/export",
           dependencies=[Depends(require_permission("export"))])
async def export_finding_records(
    version_id: uuid.UUID,
    check_id: str,
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Every SAP record this check found failing in this version, as CSV or XLSX.

    One column per field_values key (union across the fetched rows), not one
    JSON blob column, so each SAP field is independently sortable/filterable.
    """
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    if await _scope_of(db, version_id) is None:
        raise HTTPException(status_code=404, detail="Version not found")
    # Cap the source query at ROW_CAP + 1 so build_workbook's own truncation
    # detection fires and adds the cover note; the +1 row itself is never rendered.
    rows = await db.execute(text("""
        SELECT record_key, grain, module, field_values FROM finding_records
         WHERE version_id = :v AND check_id = :cid
         ORDER BY record_key LIMIT :limit
    """), {"v": version_id, "cid": check_id, "limit": ROW_CAP + 1})
    raw_rows = rows.fetchall()

    field_keys: list[str] = []
    seen = set()
    for r in raw_rows:
        for k in (r.field_values or {}):
            if k not in seen:
                seen.add(k)
                field_keys.append(k)

    columns = [*_FINDING_RECORDS_BASE_COLUMNS, *(ColumnSpec(k, k, kind="mono") for k in field_keys)]
    dicts = [
        {
            "record_key": r.record_key,
            "grain": r.grain,
            "module": r.module,
            **(r.field_values or {}),
        }
        for r in raw_rows
    ]
    if format == "csv":
        return csv_response(dicts, columns, f"records-{check_id}", str(version_id))
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=str(version_id),
        run_id=str(version_id),
        title=f"{check_id} failing records export",
        sheets=[SheetSpec(title="Records", columns=columns, rows=dicts)],
    )
    return xlsx_response(data, xlsx_filename(f"records-{check_id}", str(version_id)))


@router.post("/versions/{version_id}/analyse", status_code=202, dependencies=[Depends(require_permission("analyse"))])
async def analyse_version(version_id: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Run (or re-run, e.g. after a rule change) the analysis on a stored version's data."""
    from workers.tasks.run_checks import run_checks

    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    row = (await db.execute(text("SELECT status, metadata->>'dataset_path', metadata->>'system_id', label "
                                 "FROM analysis_versions WHERE id = :v"), {"v": vid})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    if not row[1]:
        raise HTTPException(status_code=409, detail="This version has no stored dataset to analyse.")
    if row[0] in ("pending", "running"):
        raise HTTPException(status_code=409, detail="An analysis of this version is already running.")
    await db.execute(text("UPDATE analysis_versions SET status = 'pending' WHERE id = :v"), {"v": vid})
    await db.commit()
    jobs.start_job(str(tenant.id), version_id, "analysis",
                   f"{'Analysis' if row[0] == 'extracted' else 'Re-analysis'}{f' · {row[3]}' if row[3] else ''}",
                   status="queued", progress_key=version_id, version_id=version_id, system_id=row[2])
    job = run_checks.delay(version_id, str(tenant.id), row[1], reanalyse=row[0] != "extracted")
    return {"version_id": version_id, "task_id": job.id, "job_id": version_id, "status": "pending"}


@router.post("/versions/{version_id}/baseline", dependencies=[Depends(require_permission("analyse"))])
async def pin_baseline(
    version_id: str,
    pinned: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Pin (or unpin) a run as the comparison baseline for its system; one baseline per system."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    scope = await _scope_of(db, vid)
    if scope is None:
        raise HTTPException(status_code=404, detail="Version not found")
    await db.execute(text("""
        UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) - 'baseline'
         WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND metadata ? 'baseline'
    """), {"scope": scope})
    if pinned:
        await db.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                              "|| '{\"baseline\": true}'::jsonb WHERE id = :v"), {"v": vid})
    await db.commit()
    return {"version_id": version_id, "baseline": pinned, "scope": scope}


@router.get("/versions/{version_id}")
async def get_version(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    vid = uuid.UUID(version_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid, AnalysisVersion.tenant_id == tenant.id
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    return _version_to_response(version)


@router.patch("/versions/{version_id}", dependencies=[Depends(require_permission("analyse"))])
async def patch_version(
    version_id: str,
    body: PatchVersionRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    vid = uuid.UUID(version_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid, AnalysisVersion.tenant_id == tenant.id
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    version.label = body.label
    await db.commit()
    await db.refresh(version)
    return _version_to_response(version)


@router.get("/versions/{version_id}/status")
async def get_version_status(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    vid = uuid.UUID(version_id)
    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid, AnalysisVersion.tenant_id == tenant.id
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    return {
        "version_id": str(version.id),
        "status": version.status,
        "run_at": version.run_at.isoformat() if version.run_at else "",
        "metadata": version.metadata_,
    }
