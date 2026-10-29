import json
import logging
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from api.services.rbac import require_permission, scope_from_path
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import jobs
from api.services.run_lineage import lineage_sql
from api.services.version_status import ENDED, finished_sql
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


# Raw statuses the run ledger reads as "failed" (frontend/design/primitives/Status.tsx LIFECYCLE_ALIAS), so the
# server-side filter and the Status pill agree on which runs are failed.
FAILED_STATUSES: tuple[str, ...] = ("failed", "agents_failed", "error", "errored")


class VersionResponse(BaseModel):
    id: str
    run_at: str
    label: Optional[str]
    # 1-based within the lineage, and the run this one repeats (migration 093)
    run_number: Optional[int] = None
    parent_version_id: Optional[str] = None
    status: str
    dqs_summary: Optional[dict]
    metadata: Optional[dict]
    # open findings per severity ({critical, high, medium, low}) for the run; the list endpoint fills it, other callers leave None
    severity_counts: Optional[dict[str, int]] = None


class PatchVersionRequest(BaseModel):
    label: str


def _version_to_response(v: AnalysisVersion) -> VersionResponse:
    return VersionResponse(
        id=str(v.id),
        run_at=v.run_at.isoformat() if v.run_at else "",
        label=v.label,
        run_number=v.run_number,
        parent_version_id=str(v.parent_version_id) if v.parent_version_id else None,
        status=v.status,
        dqs_summary=v.dqs_summary,
        metadata=v.metadata_,
    )


@router.get("/versions")
async def list_versions(
    limit: int = Query(20, ge=1, le=1000,
                       description="Runs per page (default 20, up to 1000); `total` counts the whole filtered set"),
    offset: int = Query(0, ge=0),
    module: Optional[str] = Query(None),
    system_id: Optional[str] = Query(None, description="Only versions downloaded from this system"),
    include_archived: bool = Query(False),
    status: Optional[Literal["failed"]] = Query(
        None, description="`failed`: only runs that failed (status failed, agents_failed, error or errored)"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    stmt = (
        select(AnalysisVersion)
        .where(AnalysisVersion.tenant_id == tenant.id)
        .order_by(AnalysisVersion.run_at.desc())
    )
    # a process discovery download is not a data quality run
    stmt = stmt.where(AnalysisVersion.metadata_.op("->>")("purpose").is_distinct_from("process_discovery"))
    if not include_archived:
        stmt = stmt.where(AnalysisVersion.metadata_.op("->>")("archived").is_distinct_from("true"))
    if module:
        # Filter by module in metadata JSON
        stmt = stmt.where(
            AnalysisVersion.metadata_.op("->>")("modules").contains(module)
        )
    if system_id:
        stmt = stmt.where(AnalysisVersion.metadata_.op("->>")("system_id") == system_id)
    if status == "failed":
        stmt = stmt.where(AnalysisVersion.status.in_(FAILED_STATUSES))
    # total of the filtered set, so a capped list can say "N of total" instead of silently stopping
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar() or 0
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    versions = result.scalars().all()
    # one grouped query for the whole page of runs, none per run
    counts: dict[str, dict[str, int]] = {}
    if versions:
        rows = (await db.execute(text(
            "SELECT version_id, severity, count(*) FROM findings "
            "WHERE tenant_id = :t AND version_id = ANY(CAST(:ids AS uuid[])) AND affected_count > 0 "
            "GROUP BY version_id, severity"), {"t": str(tenant.id), "ids": [str(v.id) for v in versions]})).fetchall()
        for vid, sev, n in rows:
            counts.setdefault(str(vid), {})[sev] = n
    out = []
    for v in versions:
        r = _version_to_response(v)
        c = counts.get(str(v.id), {})
        r.severity_counts = {k: c.get(k, 0) for k in ("critical", "high", "medium", "low")}
        out.append(r)
    return {"versions": out, "total": total}


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
_DONE = ENDED  # finished or failed: both may be archived


@router.post("/versions/archive", dependencies=[Depends(require_permission("analyse", scope=scope_from_path))])
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


@router.post("/versions/restore", dependencies=[Depends(require_permission("analyse", scope=scope_from_path))])
async def restore_versions(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    res = await db.execute(text(RESTORE_SQL), {"tid": str(tenant.id)})
    await db.commit()
    return {"restored": res.rowcount}


# A rule that fails in both runs still changed when its failing records moved materially: by at least
# CHANGE_MIN_PERCENT per cent of the earlier count AND at least CHANGE_MIN_RECORDS records. Both bounds hold, so
# 2 -> 1 (a 50% move of one record) and 100,000 -> 100,500 (500 records, 0.5%) are noise, while
# 100 -> 50,000 is "worse" and 5,000 -> 4,000 is "better".
CHANGE_MIN_PERCENT = 10
CHANGE_MIN_RECORDS = 10

# A check is compared only when it ran cleanly in both versions. It is kept when its pass/fail flipped
# (newly failing, fixed) or when it failed in both and its failing records moved materially (worse, better).
_CHECK_CHANGES_SQL = """
    SELECT f2.check_id, f2.module, f2.severity, f1.affected_count AS v1_affected, f2.affected_count AS v2_affected,
           COALESCE(NULLIF(f2.details->>'message', ''), NULLIF(f1.details->>'message', ''), rn.title) AS message
      FROM findings f1
      JOIN findings f2 ON f2.check_id = f1.check_id AND f2.version_id = :v2 AND f2.tenant_id = CAST(:tid AS uuid)
      -- the rule's title from the tenant's rules ("AP203: Vendor has no ..."), for runs whose findings stored no message
      LEFT JOIN LATERAL (
          SELECT trim(substr(r.name, strpos(r.name, ':') + 1)) AS title
            FROM rules r
           WHERE r.tenant_id = CAST(:tid AS uuid) AND strpos(r.name, ':') > 0
             AND split_part(r.name, ':', 1) = f2.check_id
           ORDER BY (r.module = f2.module) DESC, r.module
           LIMIT 1
      ) rn ON true
     WHERE f1.version_id = :v1 AND f1.tenant_id = CAST(:tid AS uuid)
       AND f1.details->>'error' IS NULL AND f2.details->>'error' IS NULL
       AND ((f1.affected_count > 0) <> (f2.affected_count > 0)
            OR (f1.affected_count > 0 AND f2.affected_count > 0
                AND abs(f2.affected_count - f1.affected_count) >= CAST(:min_records AS integer)
                AND abs(CAST(f2.affected_count AS bigint) - f1.affected_count) * 100
                    >= CAST(:min_percent AS bigint) * f1.affected_count))
       AND (CAST(:module AS text) IS NULL OR f2.module = CAST(:module AS text))
     ORDER BY CASE f2.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              f2.check_id
"""


def change_kind(v1_affected: int, v2_affected: int) -> Optional[str]:
    """How a cleanly-run check moved between two runs: ``newly_failing``, ``fixed``, ``worse``, ``better``,
    or None when it did not change materially (the same rule as ``_CHECK_CHANGES_SQL``)."""
    if v1_affected == 0 and v2_affected > 0:
        return "newly_failing"
    if v1_affected > 0 and v2_affected == 0:
        return "fixed"
    if v1_affected > 0 and v2_affected > 0:
        moved = abs(v2_affected - v1_affected)
        if moved >= CHANGE_MIN_RECORDS and moved * 100 >= CHANGE_MIN_PERCENT * v1_affected:
            return "worse" if v2_affected > v1_affected else "better"
    return None


@router.get("/versions/compare")
async def compare_versions(
    v2: str = Query(...),
    v1: Optional[str] = Query(None, description="Default: pinned baseline, else the previous finished run"),
    module: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Per-object DQS and dimension deltas (v2 − v1), and the checks that started
    or stopped failing between the two versions (``newly_failing``, ``fixed``) or failed in both with
    materially more or fewer records (``worse``, ``better``; see ``CHANGE_MIN_PERCENT``). 404 ``{"reason": "no_baseline"}``
    when ``v1`` is omitted and the system has no earlier finished run."""
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

    rows = (await db.execute(text(_CHECK_CHANGES_SQL), {
        "v1": vid1, "v2": vid2, "tid": str(tenant.id), "module": module,
        "min_records": CHANGE_MIN_RECORDS, "min_percent": CHANGE_MIN_PERCENT})).fetchall()
    checks: dict[str, list[dict]] = {"newly_failing": [], "fixed": [], "worse": [], "better": []}
    for r in rows:
        kind = change_kind(r.v1_affected, r.v2_affected)
        if kind is not None:
            checks[kind].append({"check_id": r.check_id, "module": r.module, "severity": r.severity,
                                 "message": r.message, "v1_affected": r.v1_affected, "v2_affected": r.v2_affected})
    return {
        "v1": _version_to_response(ver1),
        "v2": _version_to_response(ver2),
        "delta": delta,
        "checks": checks,
    }


async def _scope_of(db: AsyncSession, vid: uuid.UUID) -> Optional[str]:
    """The run's lineage key (api/services/run_lineage.py): its system id, or ``upload:<sorted modules>``
    for an upload. None when the run does not exist."""
    row = (await db.execute(text(f"SELECT {lineage_sql()} FROM analysis_versions "
                                 "WHERE id = :v"), {"v": vid})).fetchone()
    return row[0] if row else None


def _is_upload(scope: str) -> bool:
    return scope == "upload" or scope.startswith("upload:")


NO_BASELINE = {"reason": "no_baseline", "message": "No earlier run of this system or uploaded object to compare with."}


async def _resolve_pair(db: AsyncSession, v1: Optional[str], v2: str) -> tuple[uuid.UUID, uuid.UUID]:
    """v1 defaults to the pinned baseline of v2's lineage, else the newest earlier finished run of it.
    A system run's lineage is its system; an upload's is the uploads of the same objects, so a
    controlling upload never defaults to a business_partner baseline.
    Raises 404 ``NO_BASELINE`` when there is none (also for the only upload of its objects)."""
    vid2 = uuid.UUID(v2)
    scope = await _scope_of(db, vid2)
    if scope is None:
        raise HTTPException(status_code=404, detail="Version not found")
    if v1:
        vid1 = uuid.UUID(v1)
        scope1 = await _scope_of(db, vid1)
        if scope1 is None:
            raise HTTPException(status_code=404, detail="Version not found")
        if not (_is_upload(scope1) or _is_upload(scope)) and scope1 != scope:
            raise HTTPException(status_code=400, detail="The versions belong to different systems.")
        return vid1, vid2
    row = (await db.execute(text(f"""
        SELECT id FROM analysis_versions
         WHERE {lineage_sql()} = :scope AND id <> :v2 AND {finished_sql()}
           AND run_at <= (SELECT run_at FROM analysis_versions WHERE id = :v2)
         ORDER BY (metadata->>'baseline') = 'true' DESC NULLS LAST, run_at DESC LIMIT 1
    """), {"scope": scope, "v2": vid2})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=NO_BASELINE)
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
    grain: Optional[str] = Query(None, description="Only records at this grain (e.g. MARA, MARC)"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """The SAP records this check found failing in this version (finding_records): key plus
    the rule's column values (privacy-sensitive ones masked; null for runs before 054)."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    if await _scope_of(db, version_id) is None:
        raise HTTPException(status_code=404, detail="Version not found")
    p = {"t": str(tenant.id), "v": version_id, "cid": check_id}
    where = "tenant_id = CAST(:t AS uuid) AND version_id = :v AND check_id = :cid"
    if grain:
        where += " AND grain = :grain"
        p["grain"] = grain
    total = (await db.execute(text(f"SELECT COUNT(*) FROM finding_records WHERE {where}"), p)).scalar()
    rows = await db.execute(text(f"""
        SELECT record_key, grain, module, field_values FROM finding_records
         WHERE {where}
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
           dependencies=[Depends(require_permission("export", scope=scope_from_path))])
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


class AnalyseOptions(BaseModel):
    """Optional body of POST /versions/{id}/analyse."""
    model_config = ConfigDict(extra="forbid")
    rule_set_id: Optional[str] = Field(None, min_length=1, max_length=120)
    modules: Optional[list[str]] = Field(None, min_length=1, max_length=100)


async def _analysis_options(db: AsyncSession, vid: uuid.UUID, tenant_id: uuid.UUID, body: Optional[AnalyseOptions]) -> Optional[dict]:
    """The options to store on the version ({rule_set_id?, modules?}), or None for a default run. 422 for a module
    the version does not hold."""
    if body is None or (body.rule_set_id is None and body.modules is None):
        return None
    out: dict = {}
    if body.rule_set_id is not None:
        out["rule_set_id"] = body.rule_set_id.strip()
    if body.modules is not None:
        held = (await db.execute(text("SELECT metadata->'modules' FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                 {"v": vid, "t": str(tenant_id)})).scalar() or []
        wanted = list(dict.fromkeys(body.modules))
        unknown = [m for m in wanted if m not in held]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Not modules of this version: {', '.join(unknown)}")
        out["modules"] = wanted
    return out


@router.post("/versions/{version_id}/analyse", status_code=202, dependencies=[Depends(require_permission("analyse", scope=scope_from_path))])
async def analyse_version(version_id: str, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                          body: Optional[AnalyseOptions] = Body(None)):
    """Run (or re-run, e.g. after a rule change) the analysis on a stored version's data.

    The optional body ``{rule_set_id?, modules?}`` limits the run: ``modules`` must be modules of the version and only
    those are checked; ``rule_set_id`` is recorded with the run (metadata.analysis_options). Without a body the run is
    exactly as before."""
    from workers.tasks.run_checks import run_checks

    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    # Extractions store the data under ``dataset_path``; uploads under ``parquet_path`` (api/routes/upload.py).
    row = (await db.execute(text("SELECT status, COALESCE(metadata->>'dataset_path', metadata->>'parquet_path'), "
                                 "metadata->>'system_id', label, metadata->>'purpose' "
                                 "FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                          {"v": vid, "t": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    if row[4] == "process_discovery":
        raise HTTPException(status_code=409, detail="This download belongs to a process discovery run.")
    if not row[1]:
        raise HTTPException(status_code=409, detail="This version has no stored dataset to analyse.")
    if row[0] in ("pending", "running"):
        raise HTTPException(status_code=409, detail="An analysis of this version is already running.")
    options = await _analysis_options(db, vid, tenant.id, body)
    if options is None:  # a default run clears the options an earlier limited run left
        await db.execute(text("UPDATE analysis_versions SET status = 'pending', "
                              "metadata = COALESCE(metadata, '{}'::jsonb) - 'analysis_options' WHERE id = :v AND tenant_id = :t"),
                         {"v": vid, "t": str(tenant.id)})
    else:
        await db.execute(text("UPDATE analysis_versions SET status = 'pending', metadata = COALESCE(metadata, '{}'::jsonb) "
                              "|| jsonb_build_object('analysis_options', CAST(:o AS jsonb)) WHERE id = :v AND tenant_id = :t"),
                         {"v": vid, "t": str(tenant.id), "o": json.dumps(options)})
    await db.commit()
    jobs.start_job(str(tenant.id), version_id, "analysis",
                   f"{'Analysis' if row[0] == 'extracted' else 'Re-analysis'}{f' | {row[3]}' if row[3] else ''}",
                   status="queued", progress_key=version_id, version_id=version_id, system_id=row[2])
    job = run_checks.delay(version_id, str(tenant.id), row[1], reanalyse=row[0] != "extracted")
    jobs.set_task_ids(str(tenant.id), version_id, [job.id])
    return {"version_id": version_id, "task_id": job.id, "job_id": version_id, "status": "pending"}


@router.post("/versions/{version_id}/baseline", dependencies=[Depends(require_permission("analyse", scope=scope_from_path))])
async def pin_baseline(
    version_id: str,
    pinned: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Pin (or unpin) a run as the comparison baseline for its lineage; one baseline per lineage
    (per system, or per set of uploaded objects)."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)
    scope = await _scope_of(db, vid)
    if scope is None:
        raise HTTPException(status_code=404, detail="Version not found")
    await db.execute(text(f"""
        UPDATE analysis_versions SET metadata = COALESCE(metadata, '{{}}'::jsonb) - 'baseline'
         WHERE {lineage_sql()} = :scope AND metadata ? 'baseline'
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


@router.patch("/versions/{version_id}", dependencies=[Depends(require_permission("analyse", scope=scope_from_path))])
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
