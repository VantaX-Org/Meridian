"""Migration readiness API — source system → target (S/4HANA) transfer analysis.

source_to_destination gap-analyses the source system's analysed data (record
grain) against a connected target system's live dictionary + configuration,
or — before the target exists — the SAP S/4HANA standard dictionary.
Load files contain only records without blocking gaps.

Deterministic throughout — no LLM. Values shown are the customer's own data
inside the customer's deployment.
"""

import datetime
import io
import logging
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook, csv_response
from api.services.migration.post_load import NO_TARGET_ANALYSIS
from api.services.rbac import Scope, current_user_id, require_permission, require_scope, scope_from_path, write_audit

logger = logging.getLogger("meridian.migration")

router = APIRouter(prefix="/api/v1/migration", tags=["migration"])

_VALID_MODES = ("source_to_source", "source_to_destination", "s4_dry_run")
_LIST_TREND_POINTS = 12  # sparkline points shown per wave in the wave list


# ── Pydantic ──────────────────────────────────────────────────────────────────


class AnalyzeBody(BaseModel):
    mode: str
    source_system_id: Optional[str] = None
    source_version_id: Optional[str] = None   # default: latest analysis of the source system
    dest_system_id: Optional[str] = None      # connected target (live DDIC + config)
    target_release: str = "s4hana"            # used when no target system is connected
    modules: list[str] = []


class FieldMapUpdate(BaseModel):
    dest_table: Optional[str] = None
    dest_field: Optional[str] = None
    transform_note: Optional[str] = None
    is_confirmed: Optional[bool] = None
    value_map: Optional[bool] = None


class FieldMapCreate(BaseModel):
    module: str
    dest_system_type: str
    source_field: str                # TABLE.FIELD in the source
    dest_table: Optional[str] = None  # NULL target ⇒ intentionally not migrated
    dest_field: Optional[str] = None
    value_map: bool = False
    transform_note: Optional[str] = None


class SeedBody(BaseModel):
    module: str
    dest_system_type: str = "s4hana"
    source_system_id: Optional[str] = None
    source_version_id: Optional[str] = None


class ValueMapEntry(BaseModel):
    source_value: str
    target_value: str
    note: Optional[str] = None


class ValueMapUpsert(BaseModel):
    module: str
    target_field: str   # TABLE.FIELD in the target
    entries: list[ValueMapEntry]


Stage = Literal["plan", "mock1", "mock2", "dress", "cutover"]


class WaveCreate(BaseModel):
    name: str
    source_system_id: Optional[uuid.UUID] = None
    target_system_id: Optional[uuid.UUID] = None
    target_release: str = "s4hana"
    modules: list[str] = []
    target_date: Optional[datetime.date] = None
    stage: Stage = "plan"
    min_readiness: float = 95.0
    min_dqs: Optional[float] = None


#  migration_waves columns that are NOT NULL (db/migrations/versions/068_migration_waves.py).
# An explicit null for one of these is a client error (422), not a DB constraint violation (500).
_WAVE_NON_NULLABLE = frozenset({"name", "target_release", "modules", "stage", "min_readiness"})


class WaveUpdate(BaseModel):
    name: Optional[str] = None
    source_system_id: Optional[uuid.UUID] = None
    target_system_id: Optional[uuid.UUID] = None
    target_release: Optional[str] = None
    modules: Optional[list[str]] = None
    target_date: Optional[datetime.date] = None
    stage: Optional[Stage] = None
    min_readiness: Optional[float] = None
    min_dqs: Optional[float] = None

    @model_validator(mode="before")
    @classmethod
    def _reject_null_for_non_nullable(cls, data):
        if isinstance(data, dict):
            nulled = [k for k in _WAVE_NON_NULLABLE if k in data and data[k] is None]
            if nulled:
                raise ValueError(f"Cannot be null: {', '.join(sorted(nulled))}")
        return data


# Columns update_wave may write. Keep in step with WaveUpdate.
_WAVE_EDITABLE = frozenset(WaveUpdate.model_fields)


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def _row(r) -> dict:
    return dict(r._mapping)


async def _load_system(db: AsyncSession, tenant_id, system_id: str):
    r = await db.execute(
        text("SELECT id, system_type, name, health_status FROM sap_systems "
             "WHERE id = :sid AND tenant_id = :tid"),
        {"sid": system_id, "tid": str(tenant_id)},
    )
    return r.fetchone()


# ── POST /migration/analyze ───────────────────────────────────────────────────


@router.post("/analyze")
async def start_migration(
    body: AnalyzeBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    if body.mode not in _VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Unknown mode: {body.mode}")
    if body.mode == "s4_dry_run" and body.dest_system_id:
        raise HTTPException(status_code=400, detail="s4_dry_run does not take a destination system.")
    if not body.modules:
        raise HTTPException(status_code=400, detail="At least one module is required.")
    from api.middleware.licence import enforce_licensed_modules

    enforce_licensed_modules(request, body.modules)

    await _set_rls(db, tenant.id)

    if not body.source_system_id and not body.source_version_id:
        raise HTTPException(status_code=400, detail="A source system or a source analysis version is required.")
    if body.source_system_id and not await _load_system(db, tenant.id, body.source_system_id):
        raise HTTPException(status_code=404, detail="Source system not found.")

    dest_id = None
    if body.mode == "source_to_destination" and body.dest_system_id:
        if body.dest_system_id == body.source_system_id:
            raise HTTPException(status_code=400, detail="Destination must differ from the source system.")
        if not await _load_system(db, tenant.id, body.dest_system_id):
            raise HTTPException(status_code=404, detail="Destination system not found.")
        dest_id = body.dest_system_id
    if body.mode == "source_to_destination" and not dest_id:
        from sap.ddic import RELEASE_FOR_SYSTEM
        if body.target_release not in ("s4hana", "ecc6") and body.target_release not in RELEASE_FOR_SYSTEM:
            raise HTTPException(status_code=400, detail=f"Unknown target release '{body.target_release}'.")

    return await _enqueue_run(db, tenant.id, current_user_id(request), body.mode, body.source_system_id, dest_id,
                              body.modules, body.source_version_id, body.target_release)


async def _enqueue_run(db: AsyncSession, tenant_id: uuid.UUID, user_id: Optional[str], mode: str,
                       src: Optional[str], dest: Optional[str], modules: list[str],
                       source_version_id: Optional[str], target_release: str,
                       wave_id: Optional[str] = None) -> dict:
    if src and not dest and mode == "source_to_destination":
        dest = (await db.execute(text("SELECT target_system_id::text FROM sap_systems "
                                      "WHERE id = CAST(:s AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                                 {"s": src, "t": str(tenant_id)})).scalar()  # default to the source's assigned target
    run_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO migration_runs
                (id, tenant_id, mode, source_system_id, dest_system_id, modules, status, requested_by, wave_id)
            VALUES (:id, :tid, :mode, :src, :dst, :mods, 'queued', :uid, :wid)
        """),
        {"id": run_id, "tid": str(tenant_id), "mode": mode, "src": src, "dst": dest, "mods": modules,
         "uid": user_id, "wid": wave_id},
    )
    await db.commit()

    from workers.tasks.run_migration import run_migration
    task = run_migration.delay(str(tenant_id), run_id, mode, src, dest, modules, source_version_id, target_release)
    await db.execute(text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"), {"tid": task.id, "rid": run_id})
    await db.commit()
    return {"run_id": run_id, "task_id": task.id, "status": "queued", "mode": mode, "modules": modules}


# ── Runs ──────────────────────────────────────────────────────────────────────


@router.get("/runs")
async def list_runs(
    status: Optional[str] = None,
    mode: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    where = "tenant_id = :tid"
    params: dict = {"tid": str(tenant.id)}
    if status:
        where += " AND status = :st"
        params["st"] = status
    if mode:
        where += " AND mode = :mode"
        params["mode"] = mode
    r = await db.execute(
        text(f"""
            SELECT id, mode, source_system_id, dest_system_id, source_version_id, target_release,
                   target_connected, modules, status, readiness_verdict, readiness_score, critical_count,
                   records_total, records_blocked, error_detail, created_at, completed_at
            FROM migration_runs WHERE {where}
            ORDER BY created_at DESC LIMIT 100
        """),
        params,
    )
    return {"runs": [_row(x) for x in r.fetchall()]}


@router.get("/runs/{run_id}")
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Run header, per-module verdicts and gap counts by type/severity."""
    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT * FROM migration_runs WHERE id = :rid"), {"rid": run_id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    agg = await db.execute(
        text("""
            SELECT module, gap_type, severity, grounded, COUNT(*) AS n,
                   COUNT(DISTINCT record_key) AS records, COUNT(DISTINCT field) AS fields
            FROM migration_gap_findings WHERE run_id = :rid
            GROUP BY module, gap_type, severity, grounded
            ORDER BY module, CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                     WHEN 'medium' THEN 2 ELSE 3 END, gap_type
        """),
        {"rid": run_id},
    )
    breakdown = [_row(x) for x in agg.fetchall()]
    structural = (await db.execute(text(_STRUCTURAL_SQL), {"rid": run_id})).scalar()
    return {"run": _row(run), "gap_breakdown": breakdown, "structural_critical": int(structural or 0)}


# Per-record load-ready/load-fail status, aggregated from migration_gap_findings. Only records
# that carry at least one gap appear here — clean records are counted, not listed (see
# gap_summary[module].records - blocked_records on the run row).
_RECORDS_BASE_SQL = """
    SELECT module, object_type AS source_table, record_key,
           CASE WHEN bool_or(severity IN ('critical','high')) THEN 'load_fail' ELSE 'load_ready' END AS status,
           array_agg(detail ORDER BY severity) FILTER (WHERE severity IN ('critical','high')) AS reasons
    FROM migration_gap_findings
    WHERE run_id = :rid AND tenant_id = :t AND record_key IS NOT NULL
      AND (CAST(:module AS text) IS NULL OR module = :module)
    GROUP BY module, object_type, record_key
    HAVING (CAST(:status AS text) IS NULL
            OR (CASE WHEN bool_or(severity IN ('critical','high')) THEN 'load_fail' ELSE 'load_ready' END) = :status)
"""


@router.get("/runs/{run_id}/records")
async def run_records(
    run_id: uuid.UUID,
    status: Optional[str] = None,
    module: Optional[str] = None,
    limit: int = Query(200, le=1000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT id FROM migration_runs WHERE id = :rid AND tenant_id = :t"),
                            {"rid": run_id, "t": tenant.id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    params = {"rid": run_id, "t": str(tenant.id), "module": module, "status": status}
    total = (await db.execute(text(f"SELECT COUNT(*) FROM ({_RECORDS_BASE_SQL}) s"), params)).scalar()
    rows = await db.execute(
        text(f"{_RECORDS_BASE_SQL} ORDER BY status, module, record_key LIMIT :limit OFFSET :offset"),
        {**params, "limit": limit, "offset": offset},
    )
    return {"total": int(total or 0), "rows": [_row(x) for x in rows.fetchall()]}


# ── Post-load reconciliation ──────────────────────────────────────────────────


class ReconcileStarted(BaseModel):
    reconciliation_id: uuid.UUID
    task_id: Optional[str] = None
    status: str


class ModuleScores(BaseModel):
    module: str
    source: Optional[float] = None
    projected: Optional[float] = None
    actual: Optional[float] = None        # None when the target has no completed analysis; never estimated
    actual_reason: Optional[str] = None
    reasons: list[dict] = []


class ReconciliationPrevious(BaseModel):
    created_at: datetime.datetime
    summary: dict = {}                     # counts only


class ReconciliationOut(BaseModel):
    reconciliation_id: uuid.UUID
    run_id: uuid.UUID
    status: str
    error_detail: Optional[str] = None
    target_system_id: Optional[uuid.UUID] = None
    target_version_id: Optional[uuid.UUID] = None
    target_synced_at: Optional[datetime.datetime] = None
    created_at: datetime.datetime
    completed_at: Optional[datetime.datetime] = None
    stale: bool = False                    # a newer target extraction exists than the one compared
    latest_target_synced_at: Optional[datetime.datetime] = None
    record_cap: Optional[int] = None
    summary: dict = {}
    tables: list[dict] = []
    scores: list[ModuleScores] = []
    automatic: bool = False                # started by a finished target analysis, not by a person
    needs_target_extraction: bool = False  # it failed because the target system has not been extracted and analysed
    previous: Optional[ReconciliationPrevious] = None   # the reconciliation before this one, when it finished


class ReconciliationRecord(BaseModel):
    kind: str
    key: str
    source_record: Optional[str] = None
    field: Optional[str] = None
    expected: Optional[str] = None
    found: Optional[str] = None
    withheld: bool = False                 # a personal field: it differs, its values are not kept


class ReconciliationRecordsPage(BaseModel):
    table: Optional[str] = None
    kind: Optional[str] = None
    total: int
    capped: bool
    record_cap: Optional[int] = None
    rows: list[ReconciliationRecord]


_RECON_COLS = ("id, run_id, status, error_detail, target_system_id, target_version_id, target_synced_at, "
               "created_at, completed_at, record_cap, summary, tables, scores, auto_started")


async def _latest_reconciliation(db: AsyncSession, tenant_id: uuid.UUID, run_id: uuid.UUID, cols: str):
    run = (await db.execute(text("SELECT id FROM migration_runs WHERE id = :rid AND tenant_id = :t"),
                            {"rid": run_id, "t": str(tenant_id)})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    row = (await db.execute(
        text(f"SELECT {cols} FROM migration_reconciliations WHERE run_id = :rid AND tenant_id = :t "
             "ORDER BY created_at DESC LIMIT 1"), {"rid": run_id, "t": str(tenant_id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="This run has not been reconciled.")
    return row


@router.post("/runs/{run_id}/reconcile", response_model=ReconcileStarted)
async def start_reconciliation(
    run_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    """Compare the records the load files carried with the target system's latest extraction."""
    import json

    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT id, status, dest_system_id FROM migration_runs "
                                 "WHERE id = :rid AND tenant_id = :t"),
                            {"rid": run_id, "t": str(tenant.id)})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if run.status not in ("analysed", "exported"):
        raise HTTPException(status_code=409, detail="The run has not finished analysing.")
    if not run.dest_system_id:
        raise HTTPException(status_code=409, detail="The run has no target system to reconcile against.")
    busy = (await db.execute(text("SELECT 1 FROM migration_reconciliations WHERE run_id = :rid "
                                  "AND status IN ('queued','running') AND created_at > now() - interval '2 hours'"),
                             {"rid": run_id})).fetchone()
    if busy:
        raise HTTPException(status_code=409, detail="A reconciliation of this run is already running.")
    rec_id = uuid.uuid4()
    uid = current_user_id(request)
    await db.execute(text("INSERT INTO migration_reconciliations (id, tenant_id, run_id, status, requested_by) "
                          "VALUES (:id, :t, :rid, 'queued', :u)"),
                     {"id": rec_id, "t": str(tenant.id), "rid": run_id, "u": uid})
    await db.commit()
    from workers.tasks.run_reconciliation import run_reconciliation
    try:
        task = run_reconciliation.delay(str(tenant.id), str(rec_id))
    except Exception:
        await db.execute(text("UPDATE migration_reconciliations SET status = 'failed', completed_at = now(), "
                              "error_detail = 'The task queue could not be reached.' WHERE id = :id"), {"id": rec_id})
        await db.commit()
        raise HTTPException(status_code=503, detail="The task queue could not be reached. Try again shortly.")
    await db.execute(text("UPDATE migration_reconciliations SET task_id = :task WHERE id = :id"),
                     {"task": task.id, "id": rec_id})
    await db.execute(text("""
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path,
                               status_code, before_json, after_json)
        VALUES (:t, :u, :e, 'reconcile', 'migration_run', :r, 'POST', :p, 200, NULL, CAST(:a AS jsonb))"""),
        {"t": str(tenant.id), "u": uid, "e": current_user_label(), "r": str(run_id), "p": request.url.path,
         "a": json.dumps({"reconciliation_id": str(rec_id), "target_system_id": str(run.dest_system_id)})})
    await db.commit()
    return ReconcileStarted(reconciliation_id=rec_id, task_id=task.id, status="queued")


async def _audit(db: AsyncSession, tenant: Tenant, request: Request, action: str, run_id: uuid.UUID,
                 status_code: int, after: dict) -> None:
    import json

    from api.services.rbac import current_user_label

    await db.execute(text("""
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path,
                               status_code, before_json, after_json)
        VALUES (:t, :u, :e, :act, 'migration_run', :r, :m, :p, :sc, NULL, CAST(:a AS jsonb))"""),
        {"t": str(tenant.id), "u": current_user_id(request), "e": current_user_label(), "act": action,
         "r": str(run_id), "m": request.method, "p": request.url.path, "sc": status_code, "a": json.dumps(after)})


@router.post("/runs/{run_id}/extract-target", status_code=202)
async def extract_target(
    run_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("trigger_sync", scope=scope_from_path)),
):
    """Extract and analyse the run's modules from its target system, so a reconciliation has something to compare.

    Reads whole business objects, not only the tables the load files carry: the extraction path has no per-table
    restriction. Starts now or not at all: a running extraction on the system is never queued behind or interrupted.
    A reconciliation that failed for want of this extraction starts again by itself when the analysis completes.
    """
    from api.middleware.licence import enforce_licensed_modules
    from api.services import jobs
    from sap.extraction_plan import MODULES_BY_SYSTEM
    from workers.tasks.run_extraction import run_extraction

    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT id, modules, dest_system_id FROM migration_runs "
                                 "WHERE id = :rid AND tenant_id = :t"),
                            {"rid": run_id, "t": str(tenant.id)})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if not run.dest_system_id:
        raise HTTPException(status_code=409, detail="The run has no target system to extract.")
    system = await _load_system(db, tenant.id, str(run.dest_system_id))
    if not system:
        raise HTTPException(status_code=404, detail="The target system was not found.")
    modules = [m for m in run.modules or [] if m in MODULES_BY_SYSTEM.get(system.system_type, [])]
    if not modules:
        raise HTTPException(status_code=409, detail="None of the run's objects can be extracted from the target system.")
    enforce_licensed_modules(request, modules)
    try:
        active = jobs.list_jobs(str(tenant.id), active_only=True, limit=200, strict=True)
    except Exception:
        raise HTTPException(status_code=503, detail="The job registry could not be read. Try again shortly.")
    if any(j.get("kind") == "extraction" and str(j.get("system_id")) == str(run.dest_system_id) for j in active):
        raise HTTPException(status_code=409, detail="An extraction on the target system is already running.")
    version_id = str(uuid.uuid4())
    jobs.start_job(str(tenant.id), f"dl-{version_id}", "extraction", f"Target for run: {', '.join(modules)}",
                   status="queued", system_id=str(run.dest_system_id), modules=modules, version_id=version_id,
                   retry={"via": "extract", "body": {"system_id": str(run.dest_system_id), "modules": modules,
                                                     "include_config": False, "sync_type": "data"}})
    try:
        task = run_extraction.delay(str(tenant.id), str(run.dest_system_id), modules, False, "data", None, True,
                                    None, version_id)
    except Exception:
        jobs.finish_job(str(tenant.id), f"dl-{version_id}", "failed")
        raise HTTPException(status_code=503, detail="The task queue could not be reached. Try again shortly.")
    jobs.set_task_ids(str(tenant.id), f"dl-{version_id}", [str(getattr(task, "id", ""))])
    await _audit(db, tenant, request, "extract_target", run_id, 202,
                 {"job_id": f"dl-{version_id}", "target_system_id": str(run.dest_system_id), "modules": modules})
    await db.commit()
    return {"job_id": f"dl-{version_id}", "version_id": version_id, "status": "queued", "modules": modules}


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(
    run_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    """Delete a run with its gaps, load files and reconciliations (database cascade) and its parquet copies."""
    from starlette.concurrency import run_in_threadpool

    from api.config import settings
    from api.services import purge
    from api.services.migration import snapshot

    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT status, mode, wave_id FROM migration_runs WHERE id = :rid AND tenant_id = :t"),
                            {"rid": run_id, "t": str(tenant.id)})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if run.status in ("queued", "running"):
        raise HTTPException(status_code=409, detail="The run is still running. Delete it when it has finished.")
    if (await db.execute(text("SELECT 1 FROM migration_reconciliations WHERE run_id = :rid AND tenant_id = :t "
                              "AND status IN ('queued', 'running') LIMIT 1"),
                         {"rid": run_id, "t": str(tenant.id)})).first():
        raise HTTPException(status_code=409, detail="A reconciliation of the run is in progress. Delete it when that has finished.")
    # the wave list, cockpit and workbook read a wave's latest run: deleting it would change what was signed off
    if run.wave_id and (await db.execute(text("SELECT 1 FROM migration_waves WHERE id = :w AND tenant_id = :t "
                                              "AND signed_off_at IS NOT NULL"),
                                         {"w": run.wave_id, "t": str(tenant.id)})).first():
        raise HTTPException(status_code=409, detail="The run belongs to a signed-off wave and is kept as its evidence.")
    # the parquet copies hold record values: if they cannot be removed, keep the run so the delete can be retried
    _, errors = await run_in_threadpool(purge._delete_storage, {
        "prefixes": [(settings.minio_bucket_uploads, snapshot.run_prefix(tenant.id, run_id))], "objects": []})
    if errors:
        raise HTTPException(status_code=502, detail="The stored copies of the load files could not be removed. Try again shortly.")
    await db.execute(text("DELETE FROM migration_runs WHERE id = :rid AND tenant_id = :t"),
                     {"rid": run_id, "t": str(tenant.id)})
    await _audit(db, tenant, request, "delete", run_id, 204, {"mode": run.mode, "status": run.status})
    await db.commit()


@router.get("/runs/{run_id}/reconciliation", response_model=ReconciliationOut)
async def get_reconciliation(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Latest reconciliation of the run: per-table counts, three DQS sides, and whether it is stale."""
    await _set_rls(db, tenant.id)
    r = _row(await _latest_reconciliation(db, tenant.id, run_id, _RECON_COLS))
    latest = None
    if r["target_system_id"]:
        latest = (await db.execute(
            text("SELECT max(run_at) FROM analysis_versions WHERE tenant_id = :t AND metadata->>'system_id' = :sid "
                 "AND position('complete' in status) > 0 AND metadata->>'dataset_path' IS NOT NULL"),
            {"t": str(tenant.id), "sid": str(r["target_system_id"])})).scalar()
    prev = (await db.execute(
        text("SELECT created_at, summary FROM migration_reconciliations WHERE run_id = :rid AND tenant_id = :t "
             "AND status = 'done' AND created_at < :c ORDER BY created_at DESC LIMIT 1"),
        {"rid": run_id, "t": str(tenant.id), "c": r["created_at"]})).fetchone()
    counts = ("tables", "comparable", "expected", "found", "missing", "unexpected", "differing_fields")
    return ReconciliationOut(
        automatic=bool(r["auto_started"]),
        needs_target_extraction=bool(r["status"] == "failed" and r["error_detail"] == NO_TARGET_ANALYSIS),
        previous=ReconciliationPrevious(created_at=prev.created_at, summary={
            k: v for k, v in (prev.summary or {}).items() if k in counts}) if prev else None,
        reconciliation_id=r["id"], run_id=r["run_id"], status=r["status"], error_detail=r["error_detail"],
        target_system_id=r["target_system_id"], target_version_id=r["target_version_id"],
        target_synced_at=r["target_synced_at"], created_at=r["created_at"], completed_at=r["completed_at"],
        stale=bool(r["status"] == "done" and latest and r["target_synced_at"] and latest > r["target_synced_at"]),
        latest_target_synced_at=latest, record_cap=r["record_cap"], summary=r["summary"] or {},
        tables=r["tables"] or [], scores=(r["scores"] or {}).get("modules", []))


@router.get("/runs/{run_id}/reconciliation/records", response_model=ReconciliationRecordsPage)
async def get_reconciliation_records(
    run_id: uuid.UUID,
    table: Optional[str] = None,
    kind: Optional[Literal["missing", "differing", "unexpected"]] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Missing, differing and unexpected records of the latest reconciliation. Each table keeps at most record_cap
    rows per kind; the totals in the table summary are not capped."""
    await _set_rls(db, tenant.id)
    r = await _latest_reconciliation(db, tenant.id, run_id, "records, tables, record_cap")
    rows = [x for t, rs in (r.records or {}).items() if table in (None, t) for x in rs
            if kind in (None, x["kind"])]
    capped = any(tt.get("capped") for tt in (r.tables or []) if table in (None, tt["table"]))
    return ReconciliationRecordsPage(table=table, kind=kind, total=len(rows), capped=capped,
                                     record_cap=r.record_cap, rows=rows[offset:offset + limit])


@router.get("/runs/{run_id}/reconciliation/export")
async def export_reconciliation(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export", scope=scope_from_path)),
):
    """Per-table counts, per-field match counts and the capped record rows, as XLSX."""
    await _set_rls(db, tenant.id)
    r = await _latest_reconciliation(db, tenant.id, run_id, "status, tables, records, record_cap")
    if r.status != "done":
        raise HTTPException(status_code=409, detail="The reconciliation has not completed.")
    tables = r.tables or []
    count_cols = ("expected", "found", "missing", "unexpected")
    fields = [{"table": t["table"], **f} for t in tables for f in t["fields"]]
    recs = [{"table": t, **x, **({"expected": "Withheld", "found": "Withheld"} if x.get("withheld") else {})}
            for t, rs in (r.records or {}).items() for x in rs]
    data = build_workbook(
        tenant_name=tenant.name, run_label=None, run_id=str(run_id), title="Post-load reconciliation",
        sheets=[
            SheetSpec(title="Tables", note=f"Record rows are capped at {r.record_cap} per table and kind.",
                      columns=[ColumnSpec(key="table", header="Table", kind="mono"),
                               ColumnSpec(key="description", header="Description"),
                               ColumnSpec(key="reason", header="Not comparable because"),
                               *[ColumnSpec(key=k, header=k.title(), kind="int") for k in count_cols]],
                      rows=tables),
            SheetSpec(title="Fields",
                      columns=[ColumnSpec(key="table", header="Table", kind="mono"),
                               ColumnSpec(key="field", header="Field", kind="mono"),
                               ColumnSpec(key="description", header="Description"),
                               *[ColumnSpec(key=k, header=k.title(), kind="int")
                                 for k in ("compared", "matched", "differing")]],
                      rows=fields),
            SheetSpec(title="Records",
                      columns=[ColumnSpec(key=k, header=k.replace("_", " ").title(),
                                          kind="mono" if k in ("table", "key", "source_record", "field") else "text")
                               for k in ("table", "kind", "key", "source_record", "field", "expected", "found")],
                      rows=recs),
        ])
    return _stream(data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                   f"post_load_reconciliation_{run_id}.xlsx")


@router.get("/runs/{run_id}/dry-run/{fmt}")
async def dry_run_report(
    run_id: uuid.UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export", scope=scope_from_path)),
):
    """Summary + per-rule + failing-record export for one s4_dry_run run."""
    import asyncio
    from collections import Counter

    import pandas as pd

    from api.services.migration import load_sim
    from api.services.migration.export import to_xlsx
    from api.services import pdf_reports

    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=404, detail="Unknown report format.")
    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT * FROM migration_runs WHERE id = :rid AND tenant_id = :t"),
                            {"rid": run_id, "t": tenant.id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if run.mode != "s4_dry_run" or run.status != "analysed":
        raise HTTPException(status_code=409, detail="This report is only available for an analysed s4_dry_run run.")

    gap_summary = run.gap_summary or {}
    summary_df = pd.DataFrame([
        {"module": m, "records": d.get("records"), "blocked_records": d.get("blocked_records"),
         "verdict": d.get("verdict"), "score": d.get("score")}
        for m, d in gap_summary.items()
    ])

    rule_counts: Counter[str] = Counter()
    for d in gap_summary.values():
        for rid_, cnt in (d.get("s4_load") or {}).items():
            rule_counts[rid_] += cnt
    rules_meta = load_sim.rules()
    rule_rows = [
        {"rule_id": rid_, "area": rules_meta[rid_].area if rid_ in rules_meta else "",
         "severity": rules_meta[rid_].severity if rid_ in rules_meta else "",
         "reason": rules_meta[rid_].reason if rid_ in rules_meta else "", "records": cnt}
        for rid_, cnt in sorted(rule_counts.items())
    ]
    rule_df = pd.DataFrame(rule_rows)

    cap = 100_000  # the xlsx holds the whole list in memory; the PDF shows the first 500
    fail_raw = (await db.execute(
        text(f"{_RECORDS_BASE_SQL} ORDER BY module, record_key LIMIT :cap"),
        {"rid": run_id, "t": str(tenant.id), "module": None, "status": "load_fail", "cap": cap + 1},
    )).fetchall()
    truncated = len(fail_raw) > cap
    fail_raw = fail_raw[:cap]
    fail_rows = [
        {"module": r.module, "source_table": r.source_table, "record_key": r.record_key,
         "reasons": "; ".join(r.reasons or [])}
        for r in fail_raw
    ]
    fail_df = pd.DataFrame(fail_rows)

    name = f"s4_dry_run_{run_id}"
    if fmt == "xlsx":
        sheets = {"Summary": summary_df, "Load fail": fail_df, "By rule": rule_df}
        if truncated:
            sheets["Note"] = pd.DataFrame([{"note": f"Load fail list truncated to the first {cap:,} records; "
                                                    "use the records API for the rest."}])
        content = to_xlsx(sheets, sanitize_formulas=True)
        return _stream(content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx")

    ctx = {
        "title": "S/4 load dry run", "eyebrow": "S/4 load dry run", "scope_label": tenant.name,
        "generated_at": run.completed_at, "meta": [("Verdict", run.readiness_verdict or "—")],
        "tenant": tenant.name,
        "run": {"id": str(run_id), "completed_at": run.completed_at, "verdict": run.readiness_verdict,
                "score": run.readiness_score},
        "modules": [{"module": m, **{k: d.get(k) for k in ("records", "blocked_records", "verdict", "score")}}
                    for m, d in gap_summary.items()],
        "by_rule": rule_rows,
        "fails": fail_rows[:500],
    }
    pdf = await asyncio.to_thread(pdf_reports.render, "s4_dry_run.html", ctx)
    return _stream(pdf, "application/pdf", f"{name}.pdf")


# ── Waves ─────────────────────────────────────────────────────────────────────


_WAVE_COLS = ("id, name, source_system_id, target_system_id, target_release, modules, target_date, stage, "
              "min_readiness, min_dqs, signed_off_by, signed_off_at, created_at, updated_at")


async def _load_wave(db: AsyncSession, tenant_id: uuid.UUID, wave_id: uuid.UUID):
    row = (await db.execute(text(f"SELECT {_WAVE_COLS} FROM migration_waves WHERE id = :w AND tenant_id = :t"),
                            {"w": str(wave_id), "t": str(tenant_id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Wave not found.")
    return row


async def _check_systems(db: AsyncSession, tenant_id: uuid.UUID, src: Optional[uuid.UUID],
                         dst: Optional[uuid.UUID]) -> None:
    if src and dst and src == dst:
        raise HTTPException(status_code=400, detail="Target must differ from the source system.")
    for sid in (src, dst):
        if sid and not await _load_system(db, tenant_id, str(sid)):
            raise HTTPException(status_code=404, detail="System not found.")


@router.get("/waves")
async def list_waves(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    rows = await db.execute(text(f"""
        SELECT w.{_WAVE_COLS.replace(', ', ', w.')},
               last.id AS last_run_id, last.gap_summary AS last_gap_summary,
               last.source_version_id AS last_version_id,
               last.readiness_score AS last_score, last.completed_at AS last_completed_at,
               COALESCE(trend.scores, '{{}}') AS trend
          FROM migration_waves w
          LEFT JOIN LATERAL (
                SELECT id, gap_summary, source_version_id, readiness_score, completed_at FROM migration_runs
                 WHERE wave_id = w.id AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1) last ON true
          LEFT JOIN LATERAL (
                SELECT array_agg(readiness_score ORDER BY completed_at) AS scores FROM (
                    SELECT readiness_score, completed_at FROM migration_runs
                     WHERE wave_id = w.id AND status = 'analysed' AND readiness_score IS NOT NULL
                     ORDER BY completed_at DESC LIMIT {_LIST_TREND_POINTS}) t) trend ON true
         WHERE w.tenant_id = :t
         ORDER BY w.target_date NULLS LAST, w.name
    """), {"t": str(tenant.id)})
    from api.services.migration.cockpit import list_wave_verdicts

    waves = [_row(r) for r in rows.fetchall()]
    # The list's verdict is the cockpit's: one definition (the wave's thresholds over its latest run), not the
    # engine's own run verdict, which the cockpit does not show.
    await list_wave_verdicts(db, str(tenant.id), waves)
    return {"waves": waves}


@router.post("/waves")
async def create_wave(
    body: WaveCreate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    await _check_systems(db, tenant.id, body.source_system_id, body.target_system_id)
    if (await db.execute(text("SELECT 1 FROM migration_waves WHERE tenant_id = :t AND name = :n"),
                         {"t": str(tenant.id), "n": body.name})).scalar():
        raise HTTPException(status_code=409, detail=f"A wave named '{body.name}' already exists.")
    row = (await db.execute(text(f"""
        INSERT INTO migration_waves (tenant_id, name, source_system_id, target_system_id, target_release, modules,
                                     target_date, stage, min_readiness, min_dqs)
        VALUES (:t, :name, :src, :dst, :rel, :mods, :date, :stage, :minr, :mind)
        RETURNING {_WAVE_COLS}
    """), {"t": str(tenant.id), "name": body.name,
           "src": str(body.source_system_id) if body.source_system_id else None,
           "dst": str(body.target_system_id) if body.target_system_id else None,
           "rel": body.target_release, "mods": body.modules, "date": body.target_date, "stage": body.stage,
           "minr": body.min_readiness, "mind": body.min_dqs})).fetchone()
    await db.commit()
    return _row(row)


@router.patch("/waves/{wave_id}")
async def update_wave(
    wave_id: uuid.UUID,
    body: WaveUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    current = await _load_wave(db, tenant.id, wave_id)
    changes = body.model_dump(exclude_unset=True)
    for f in ("source_system_id", "target_system_id"):  # a new system must itself be in the caller's scope
        if changes.get(f):
            await require_scope(request, db, tenant, "analyse", Scope(changes[f], None))
    await _check_systems(db, tenant.id, changes.get("source_system_id", current.source_system_id),
                         changes.get("target_system_id", current.target_system_id))
    params = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in changes.items()}
    unknown = params.keys() - _WAVE_EDITABLE
    if unknown:  # never interpolate a column name that is not on the allow-list
        raise HTTPException(status_code=400, detail=f"Not editable: {', '.join(sorted(unknown))}")
    sets = "".join(f"{k} = :{k}, " for k in params)
    # any edit invalidates a sign-off: what was signed is no longer what is planned
    try:
        row = (await db.execute(text(f"""
            UPDATE migration_waves SET {sets}signed_off_by = NULL, signed_off_at = NULL, updated_at = now()
             WHERE id = :w AND tenant_id = :t RETURNING {_WAVE_COLS}
        """), {**params, "w": str(wave_id), "t": str(tenant.id)})).fetchone()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A wave named '{params.get('name')}' already exists.")
    await db.commit()
    return _row(row)


@router.delete("/waves/{wave_id}", status_code=204)
async def delete_wave(
    wave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    await _load_wave(db, tenant.id, wave_id)
    await db.execute(text("DELETE FROM migration_waves WHERE id = :w AND tenant_id = :t"),
                     {"w": str(wave_id), "t": str(tenant.id)})
    await db.commit()


@router.post("/waves/{wave_id}/run")
async def run_wave(
    wave_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if not w.source_system_id or not w.modules:
        raise HTTPException(status_code=400, detail="Set a source system and at least one module first.")
    return await _enqueue_run(db, tenant.id, current_user_id(request), "source_to_destination",
                              str(w.source_system_id), str(w.target_system_id) if w.target_system_id else None,
                              list(w.modules), None, w.target_release, str(wave_id))


@router.get("/waves/{wave_id}/cockpit")
async def wave_cockpit(
    wave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    from api.services.migration.cockpit import load_cockpit

    await _set_rls(db, tenant.id)
    return await load_cockpit(db, str(tenant.id), await _load_wave(db, tenant.id, wave_id))


_NOT_GO = {"no_go": "no-go", "at_risk": "at risk"}


def signoff_refusal(cockpit: dict) -> dict:
    """The 409 body of a refused sign-off (F18): the sentence, the wave's verdict and one reason per object that is
    not go, with what holds it (blocking gaps, records blocked, the score against the wave's threshold) and where to
    open it, so the screen lists them instead of a toast."""
    from api.services import app_links

    th = cockpit.get("threshold")
    reasons = []
    for o in cockpit.get("objects") or []:
        if o["verdict"] == "go":
            continue
        why = []
        if o.get("score") is None and o["verdict"] == "no_go":
            why.append("not analysed for this wave")
        if o.get("blocker_count"):
            why.append(f"{o['blocker_count']} blocking gaps")
        if o.get("records_blocked"):
            why.append(f"{o['records_blocked']} records blocked")
        if th is not None and o.get("dqs") is not None and o["dqs"] < th:
            why.append(f"score {o['dqs']:.1f} under the wave's threshold {th:.1f}")
        reason = "; ".join(why) or "conditional fixes needed"
        reasons.append({"module": o["module"], "label": o["label"], "verdict": o["verdict"], "reason": reason,
                        "sentence": f"{o['label']} is {_NOT_GO.get(o['verdict'], o['verdict'])}: {reason}.",
                        "blocker_count": o.get("blocker_count") or 0, "records_blocked": o.get("records_blocked") or 0,
                        "score": o.get("score"), "dqs": o.get("dqs"), "threshold": th,
                        "href": app_links.object_page(o["module"], "readiness")})
    return {"detail": "Only a wave with a go verdict can be signed off.", "verdict": cockpit["verdict"],
            "reasons": reasons}


@router.post("/waves/{wave_id}/signoff")
async def signoff_wave(
    wave_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve", scope=scope_from_path)),
):
    import json

    from api.services.migration.cockpit import load_cockpit
    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if w.signed_off_at:
        raise HTTPException(status_code=409, detail="This wave is already signed off.")
    cockpit = await load_cockpit(db, str(tenant.id), w)
    if cockpit["verdict"] != "go":
        raise HTTPException(status_code=409, detail=signoff_refusal(cockpit))
    uid = current_user_id(request)
    row = (await db.execute(text(f"""
        UPDATE migration_waves SET signed_off_by = :u, signed_off_at = now(), updated_at = now()
         WHERE id = :w AND tenant_id = :t RETURNING {_WAVE_COLS}"""),
        {"u": uid, "w": str(wave_id), "t": str(tenant.id)})).fetchone()

    def snap(r) -> dict:
        return {"stage": r.stage, "signed_off_by": str(r.signed_off_by) if r.signed_off_by else None,
                "signed_off_at": r.signed_off_at.isoformat() if r.signed_off_at else None,
                "verdict": cockpit["verdict"], "score": cockpit["score"]}

    await db.execute(text("""
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path,
                               status_code, before_json, after_json)
        VALUES (:t, :u, :e, 'signoff', 'migration_wave', :w, 'POST', :p, 200,
                CAST(:b AS jsonb), CAST(:a AS jsonb))"""),
        {"t": str(tenant.id), "u": uid, "e": current_user_label(), "w": str(wave_id), "p": request.url.path,
         "b": json.dumps(snap(w)), "a": json.dumps(snap(row))})
    await db.commit()
    return _row(row)


class FixBatchBody(BaseModel):
    module: str
    gap_type: str
    field: Optional[str] = None


@router.get("/waves/{wave_id}/report.{fmt}")
async def wave_report(
    wave_id: uuid.UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export", scope=scope_from_path)),
):
    import asyncio

    import pandas as pd

    from api.services.branded_xlsx import guard_frame
    from api.services.migration.cockpit import load_cockpit, readiness_report_context, readiness_report_sheets
    from api.services.pdf_reports import render

    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=404, detail="Unknown report format.")
    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    cockpit = await load_cockpit(db, str(tenant.id), w)
    name = f"migration_readiness_{w.name.replace(' ', '_')}"
    if fmt == "pdf":
        pdf = await asyncio.to_thread(render, "migration_readiness_report.html",
                                      readiness_report_context(cockpit, tenant.name, None))
        return _stream(pdf, "application/pdf", f"{name}.pdf")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for sheet, df in readiness_report_sheets(cockpit).items():
            guard_frame(df).to_excel(xw, sheet_name=sheet, index=False)
    return _stream(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx")


@router.get("/runs/{run_id}/realignment.{fmt}")
async def realignment_report(
    run_id: uuid.UUID,
    fmt: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export", scope=scope_from_path)),
):
    import asyncio

    import pandas as pd

    from api.services.branded_xlsx import guard_frame
    from api.services.config_pairing import realignment_context, realignment_sheets
    from api.services.pdf_reports import render

    if fmt not in ("xlsx", "pdf"):
        raise HTTPException(status_code=404, detail="Unknown report format.")
    await _set_rls(db, tenant.id)
    run, unmapped, applied = await db.run_sync(lambda s: realignment_sheets(s, str(run_id)))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    name = f"config_realignment_{run_id}"
    if fmt == "pdf":
        pdf = await asyncio.to_thread(render, "config_realignment_report.html",
                                      realignment_context(run, unmapped, applied, tenant.name))
        return _stream(pdf, "application/pdf", f"{name}.pdf")
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        guard_frame(unmapped).to_excel(xw, sheet_name="Unmapped values", index=False)
        guard_frame(applied).to_excel(xw, sheet_name="Applied mappings", index=False)
    return _stream(buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{name}.xlsx")


@router.post("/waves/{wave_id}/blockers/fix-batch")
async def blocker_fix_batch(
    wave_id: uuid.UUID,
    body: FixBatchBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("apply", scope=scope_from_path)),
):
    """Draft a cleaning batch for the open DQ issues on the records one blocker affects.
    Migration and DQ share the record-key format (checks/base.record_keys), so (module, record_key) joins."""
    from api.services import remediation
    from api.services.migration import object_label
    from api.services.rbac import current_user_label

    await _set_rls(db, tenant.id)
    w = await _load_wave(db, tenant.id, wave_id)
    if not w.source_system_id:
        raise HTTPException(status_code=400, detail="This wave has no source system.")
    run_id = (await db.execute(text("SELECT id FROM migration_runs WHERE tenant_id = :t AND wave_id = :w "
                                    "AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1"),
                               {"t": str(tenant.id), "w": str(wave_id)})).scalar()
    if run_id is None:
        raise HTTPException(status_code=404, detail="This wave has not been analysed yet.")
    # record_issues.scope is the source system id (or 'upload') — without this filter, a tenant
    # with another scope holding the same record key would leak those issues into this batch.
    scope = str(w.source_system_id)
    rows = (await db.execute(text("""
        SELECT ri.id AS issue_id, ri.scope, ri.module, ri.check_id, ri.record_key, ri.grain,
               ri.last_seen_version, f.details->>'field_checked' AS field
          FROM record_issues ri
          LEFT JOIN findings f ON f.version_id = ri.last_seen_version AND f.check_id = ri.check_id
         WHERE ri.tenant_id = :t AND ri.scope = :scope AND ri.module = :m AND ri.status IN ('open', 'in_progress')
           AND ri.record_key IN (
                SELECT DISTINCT record_key FROM migration_gap_findings
                 WHERE run_id = :r AND module = :m AND gap_type = :g
                   AND field IS NOT DISTINCT FROM :fld AND record_key IS NOT NULL)
         ORDER BY ri.record_key
         LIMIT 50001"""),
        {"t": str(tenant.id), "scope": scope, "m": body.module, "r": str(run_id), "g": body.gap_type,
         "fld": body.field})).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="No open data quality issues match these records. "
                                                    "Fix the mapping in the Mapping tab.")
    if len(rows) > 50_000:
        raise HTTPException(status_code=400, detail="More than 50000 records; fix this blocker in parts.")
    issues = [dict(r._mapping) for r in rows]
    name = f"{w.name}: {object_label(body.module)} {body.gap_type} {body.field or ''}".rstrip()
    uid, label = current_user_id(request), current_user_label()
    out = await db.run_sync(lambda s: remediation.draft_batch(s, str(tenant.id), name, body.model_dump_json(),
                                                              issues, uid, label))
    from api.services import handoff_notices  # the owners of its objects are told it waits (inbox and email)
    mails = await db.run_sync(lambda s: handoff_notices.batch_waiting(s, str(tenant.id), str(out["id"])))
    await db.commit()
    handoff_notices.dispatch(mails)
    return out


# Critical gaps with no record key hit every record (missing/obsolete target field) → export gate.
_STRUCTURAL_SQL = ("SELECT COUNT(*) FROM migration_gap_findings WHERE run_id = :rid "
                   "AND severity = 'critical' AND record_key IS NULL")

_FINDING_COLS = ("module, source_table, record_key, source_field, source_value, dest_table, field AS target_field, "
                 "target_value, gap_type, severity, detail, provenance, grounded")


def _findings_where(run_id, module, gap_type, severity, grounded, search) -> tuple[str, dict]:
    where, params = ["run_id = :rid"], {"rid": run_id}
    for col, val in (("module", module), ("gap_type", gap_type), ("severity", severity)):
        if val:
            where.append(f"{col} = :{col}")
            params[col] = val
    if grounded is not None:
        where.append("grounded = :grounded")
        params["grounded"] = grounded
    if search:
        where.append("(record_key ILIKE :q OR field ILIKE :q OR source_field ILIKE :q OR source_value ILIKE :q)")
        params["q"] = f"%{search}%"
    return " AND ".join(where), params


@router.get("/runs/{run_id}/findings")
async def run_findings(
    run_id: uuid.UUID,
    module: Optional[str] = None,
    gap_type: Optional[str] = None,
    severity: Optional[str] = None,
    grounded: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    where, params = _findings_where(run_id, module, gap_type, severity, grounded, search)
    total = (await db.execute(text(f"SELECT COUNT(*) FROM migration_gap_findings WHERE {where}"), params)).scalar()
    rows = await db.execute(
        text(f"""
            SELECT {_FINDING_COLS} FROM migration_gap_findings WHERE {where}
            ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                     gap_type, record_key NULLS FIRST
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    return {"total": int(total or 0), "items": [_row(x) for x in rows.fetchall()]}


@router.get("/runs/{run_id}/findings/export", dependencies=[Depends(require_permission("export"))])
async def export_findings(
    run_id: uuid.UUID,
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    module: Optional[str] = None,
    gap_type: Optional[str] = None,
    severity: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export", scope=scope_from_path)),
):
    """Every gap of a run (the remediation work list), as CSV or XLSX."""
    await _set_rls(db, tenant.id)
    where, params = _findings_where(run_id, module, gap_type, severity, None, None)
    rows = (await db.execute(text(f"SELECT {_FINDING_COLS} FROM migration_gap_findings WHERE {where}"), params)).fetchall()
    dicts = [_row(x) for x in rows]
    keys = list(dicts[0].keys()) if dicts else [
        "module", "source_table", "record_key", "source_field", "source_value", "dest_table",
        "target_field", "target_value", "gap_type", "severity", "detail", "provenance", "grounded",
    ]
    columns = [
        ColumnSpec(key=k, header=k, kind="mono" if k in ("record_key", "source_table", "dest_table") else "text")
        for k in keys
    ]
    if format == "csv":
        return csv_response(dicts, columns, "migration-gaps", str(run_id))
    data = build_workbook(
        tenant_name=tenant.name,
        run_label=None,
        run_id=str(run_id),
        title="Migration gap findings export",
        sheets=[SheetSpec(title="Gap findings", columns=columns, rows=dicts)],
    )
    return _stream(data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                   f"migration_gaps_{run_id}.xlsx")


@router.get("/runs/{run_id}/value-candidates")
async def value_candidates(
    run_id: uuid.UUID,
    target_field: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Distinct source values that still need a target value mapping (with record counts)."""
    await _set_rls(db, tenant.id)
    rows = await db.execute(
        text("SELECT source_value, COUNT(*) FROM migration_gap_findings WHERE run_id = :rid AND field = :tf "
             "AND gap_type = 'value_unmapped' GROUP BY source_value ORDER BY COUNT(*) DESC"),
        {"rid": run_id, "tf": target_field},
    )
    return {"target_field": target_field, "values": [{"source_value": v, "records": n} for v, n in rows.fetchall()]}


# ── Load files (ready records only) ───────────────────────────────────────────


@router.get("/export/{run_id}/{export_format}")
async def export_migration(
    run_id: uuid.UUID,
    export_format: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("export", scope=scope_from_path)),
):
    """Target load files (one sheet/CSV per target table) for records without blocking gaps."""
    if export_format not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="Load files are produced as csv (zip) or xlsx.")
    await _set_rls(db, tenant.id)
    run = (await db.execute(text("SELECT * FROM migration_runs WHERE id = :rid"), {"rid": run_id})).fetchone()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    if run.status not in ("analysed", "exported"):
        raise HTTPException(status_code=409, detail="The run has not finished analysing.")
    structural = (await db.execute(text(_STRUCTURAL_SQL), {"rid": run_id})).scalar()
    if structural:
        raise HTTPException(status_code=409, detail=(
            f"Export blocked — {structural} structural critical gap(s) (missing/obsolete target fields). "
            "Fix the field map and re-analyse."))
    from starlette.concurrency import run_in_threadpool
    from api.services.migration.export import load_run_tables, to_csv_zip, to_xlsx
    from workers.db import get_sync_engine, tenant_session
    from sqlalchemy.orm import Session

    def _build():
        with Session(get_sync_engine()) as s:
            s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
            held: dict = {}
            return load_run_tables(s, run, held)[0], held

    tables, held = await run_in_threadpool(_build)
    if not tables:
        raise HTTPException(status_code=404, detail="No transfer-ready records to export.")
    total = sum(len(t) for t in tables.values())
    content = to_xlsx(tables) if export_format == "xlsx" else to_csv_zip(tables)
    fname = f"migration_{run_id}.{'xlsx' if export_format == 'xlsx' else 'zip'}"
    # What was handed over is kept for post-load reconciliation. A storage failure never fails the export: the
    # row records the error, and reconciliation then rebuilds from the current mappings and says so.
    from api.services.migration import snapshot
    export_id = uuid.uuid4()
    snap: dict = {"pre": None, "sha": None, "at": None, "err": None}
    try:
        snap["pre"], snap["sha"] = await run_in_threadpool(snapshot.write, tenant.id, run_id, export_id, tables, held)
        snap["at"] = datetime.datetime.now(datetime.timezone.utc)
    except Exception as e:
        logger.warning("migration export snapshot failed: %s", e)
        snap["err"] = f"{type(e).__name__}: {e}"[:500]
    await db.execute(
        text("INSERT INTO migration_export_files (id, tenant_id, run_id, export_format, record_count, filename, "
             "exported_by, snapshot_prefix, snapshot_sha256, snapshot_at, snapshot_error) "
             "VALUES (:id, :tid, :rid, :fmt, :cnt, :fn, :uid, :pre, :sha, :at, :err)"),
        {"id": export_id, "tid": str(tenant.id), "rid": run_id, "fmt": export_format, "cnt": total, "fn": fname,
         "uid": current_user_id(request), **snap},
    )
    await db.execute(text("UPDATE migration_runs SET status = 'exported' WHERE id = :rid"), {"rid": run_id})
    await db.commit()
    if snap["pre"]:
        def _prune() -> None:
            with tenant_session(get_sync_engine(), tenant.id) as s:
                snapshot.prune(s, tenant.id, run_id)
                s.commit()

        try:
            await run_in_threadpool(_prune)
        except Exception as e:  # housekeeping only: the file is built and recorded, so the export still succeeds
            logger.warning("Pruning old export copies failed for run %s: %s", run_id, e)
    media = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if export_format == "xlsx"
             else "application/zip")
    return _stream(content, media, fname)


def _stream(data: bytes, media_type: str, filename: str) -> StreamingResponse:
    # filename is often built from free user text (e.g. a wave name); outside this allow-list a
    # character can break the header (';', '"') or fail latin-1 encoding (em dash, accents) -> 500.
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", filename)
    return StreamingResponse(
        io.BytesIO(data), media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={safe_name}"},
    )


# ── Target workbook (the new system's own load format) ────────────────────────
MAX_WORKBOOK_BYTES = 25 * 1024 * 1024


async def _read_workbook(file: UploadFile) -> bytes:
    data = await file.read(MAX_WORKBOOK_BYTES + 1)
    if len(data) > MAX_WORKBOOK_BYTES:
        raise HTTPException(status_code=413, detail="The workbook is larger than 25 MB.")
    return data


def _learned_pending(meta: dict, dictionary) -> dict:
    """Map each learned property to True when the last run asked for it and the tenant did not return it.

    Such a property will never arrive, so it is reported as missing from the system rather than waiting for a run.
    """
    absent = {(c.get("table", "").split("\u2190")[0], n) for c in meta.get("coverage") or []
              for n in c.get("unavailable_fields") or []}
    out = {}
    for tn, t in dictionary.tables.items():
        for f in t.fields.values():
            if f.provenance != "workbook":
                continue
            gone = (tn, f.name) in absent
            if "." in (f.source or ""):
                out[f.source.split(".", 1)[1]] = gone
            elif not f.source:  # an SAP field learned from DD03L, headed FIELD, TABLE-FIELD or TABLE.FIELD
                out |= {f.name: gone, f"{tn}-{f.name}": gone, f"{tn}.{f.name}": gone}
    return out


def _mark_learned(report: dict, pending: dict, unresolved: Optional[dict] = None) -> tuple[int, int]:
    """Flag unmapped columns that the next run fills, or that the system does not hold. Returns both counts.

    `unresolved` is the DD03L outcome per column id (workbook.learn_sap): no table is not in the system, several
    tables are listed as candidates and left for a person to choose."""
    from api.services.migration.workbook import _camel

    waiting = missing = 0
    for sheet in report["sheets"]:
        for col in sheet["unmapped"]:
            gone = pending.get(col["id"], pending.get(_camel(col["id"])))  # job-code was learned as jobCode
            tables = (unresolved or {}).get(col["id"])
            if tables is not None and gone is None:
                gone = True if not tables else None
                if len(tables) > 1:
                    col["candidates"] = tables
            col["learned"] = gone is False
            col["not_in_system"] = gone is True
            waiting += col["learned"]
            missing += col["not_in_system"]
    return waiting, missing


def _fill_workbook(tenant_id, version_id: str, data: bytes, filename: str = "") -> tuple:
    """Parse an uploaded workbook and fill it from one finished run. Nothing is stored."""
    from api.services.migration import workbook as wb
    from api.services.connectivity_manager import ConnectivityManager
    from api.services.source_design import dictionary_for, store_learned
    from checks.field_status_rules import conversions_for
    from checks.frames import tables_of
    from checks.runner import get_required_columns
    from sap.extraction_plan import ABAP_SYSTEM_TYPES
    from workers.dataset import load_dataset
    from workers.db import get_sync_engine, tenant_session
    from workers.tasks.run_migration import load_value_maps

    try:
        book = wb.parse_workbook(data, filename)
    except wb.WorkbookError as e:
        raise HTTPException(status_code=400, detail=str(e))
    with tenant_session(get_sync_engine(), tenant_id) as s:
        row = s.execute(text("SELECT status, metadata FROM analysis_versions WHERE CAST(id AS text) = :v AND tenant_id = :t"),
                        {"v": version_id.lower(), "t": str(tenant_id)}).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Run not found.")
        meta = row[1] or {}
        if "complete" not in (row[0] or "") or not meta.get("dataset_path"):
            raise HTTPException(status_code=409, detail="This run has not finished, so it holds no data to export.")
        system_id = meta.get("system_id")
        dictionary = dictionary_for(s, system_id)
        # Columns the dictionary does not carry yet are learned for this system, so the next run extracts them.
        learned = wb.learn(book, dictionary) if system_id else {}
        unresolved: dict = {}
        stype = s.execute(text("SELECT system_type FROM sap_systems WHERE id = :sid"),
                          {"sid": system_id}).scalar() if system_id else None
        if stype in ABAP_SYSTEM_TYPES:  # ECC and S/4HANA: unknown SAP columns are checked against DD03L
            scope = {t for m in meta.get("modules") or [] for t in tables_of(get_required_columns(m))}
            try:
                sap_learned, unresolved = wb.learn_sap(
                    book, dictionary, scope, lambda ts, fs: ConnectivityManager(s, str(tenant_id)).dd03l_fields(
                        str(system_id), ts, fs))
            except Exception as e:  # noqa: BLE001 - any RFC failure; the system cannot be reached: nothing is learned, the export goes on
                logger.warning(f"DD03L lookup failed for system {system_id}: {e}")
                sap_learned = {}
            for table, fields in sap_learned.items():
                learned[table] = {**learned.get(table, {}), **fields}
        if learned:
            store_learned(s, str(system_id), learned)
            s.commit()
            dictionary = dictionary_for(s, system_id)
        pending = _learned_pending(meta, dictionary)
        needed = wb.tables_needed(book, dictionary)
        no_match = HTTPException(status_code=422, detail="Nothing in this run matches the sheets in this workbook.")
        if not needed:
            raise no_match
        try:
            frames = load_dataset(meta["dataset_path"], dictionary, None,
                                  conversions=conversions_for(s, system_id), tables=needed)[0]
        except ValueError as e:
            if not str(e).startswith("No table parquet files"):  # a storage fault must not read as "no match"
                raise
            raise no_match
        # A module's own map is a complete list, so a value it leaves out has no target. A configuration map only
        # renames the values it knows.
        config = load_value_maps(s, "config", system_id)
        maps = {t: dict(vm) for t, vm in config.items()}
        for module in meta.get("modules") or []:
            for target, vm in load_value_maps(s, module, system_id).items():
                maps.setdefault(target, {}).update(vm)
        strict = {t for t, vm in maps.items() if vm.keys() - config.get(t, {}).keys()}
    tabs, report = wb.fill(book, frames, maps, strict)
    waiting, missing = _mark_learned(report, pending, unresolved)
    report["learned"] = {"new": sum(len(f) for f in learned.values()), "waiting": waiting, "missing": missing,
                         "system_id": system_id, "modules": meta.get("modules") or []}
    return book, tabs, report


@router.post("/target-workbook/{version_id}/check")
async def check_target_workbook(
    version_id: str, file: UploadFile = File(...), tenant: Tenant = Depends(get_tenant),
    _=Depends(require_permission("export", scope=scope_from_path)),
):
    """What this run can fill in the uploaded workbook, before anything is exported."""
    from starlette.concurrency import run_in_threadpool
    from api.services.migration.workbook import HELD_SAMPLE

    _, _, report = await run_in_threadpool(_fill_workbook, tenant.id, version_id, await _read_workbook(file),
                                           file.filename or "")
    return {**report, "held": report["held"][:HELD_SAMPLE], "held_total": len(report["held"])}


@router.post("/target-workbook/{version_id}/export")
async def export_target_workbook(
    version_id: str, request: Request, file: UploadFile = File(...),
    export_format: Literal["xlsx", "csv", "source"] = Query("xlsx", alias="format"),
    tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db),
    _=Depends(require_permission("export", scope=scope_from_path)),
):
    """The run's data in the workbook's own columns, with every row held back named beside it and why.

    `source` writes the upload's own layout, ready for its load tool. Held rows then travel in a separate file."""
    import pandas as pd
    from starlette.concurrency import run_in_threadpool
    from api.services.branded_xlsx import guard_frame
    from api.services.migration import workbook as wb
    from api.services.migration.export import to_csv_zip, to_xlsx
    from api.services.migration.workbook_formats import media_type

    data = await _read_workbook(file)

    def _build() -> tuple[bytes, str, dict]:
        book, tabs, report = _fill_workbook(tenant.id, version_id, data, file.filename or "")
        if not tabs:
            raise HTTPException(status_code=422, detail="Nothing in this run matches the sheets in this workbook.")
        # Record keys are source values, so held rows take the formula guard; load tabs stay exact.
        held = guard_frame(pd.DataFrame(report["held"])) if report["held"] else None
        if export_format == "source":
            if not report["format"]["same"]:
                raise HTTPException(status_code=422, detail="This workbook defines fields but has no load layout to "
                                                            "fill. Export it as Excel or CSV files instead.")
            held_csv = None if held is None else held.to_csv(index=False).encode("utf-8-sig")
            return *wb.same_format(book, tabs, held_csv), report["summary"]
        if held is not None:
            tabs[wb.HELD_BACK_TAB] = held
        return ((to_xlsx(tabs), "xlsx", report["summary"]) if export_format == "xlsx"
                else (to_csv_zip(tabs), "zip", report["summary"]))

    content, ext, summary = await run_in_threadpool(_build)
    await _set_rls(db, tenant.id)
    await write_audit(db, tenant.id, request, "migration.target_workbook.export", "analysis_version", version_id,
                      None, {"format": export_format, **summary})
    await db.commit()
    # Not _stream: a StreamingResponse after an uploaded body trips BaseHTTPMiddleware ("Unexpected message received").
    name = f"target_workbook_{version_id}.{ext}"
    return Response(content, media_type=media_type(ext),
                    headers={"Content-Disposition": f"attachment; filename={name}"})


# ── Field map ─────────────────────────────────────────────────────────────────


@router.get("/field-map")
async def get_field_map(
    module: str = Query(...),
    dest_system_type: str = Query("s4hana"),
    source_system_type: str = Query("ecc"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    """Mappings with source and target field definitions side by side."""
    from sap.ddic import dictionary_for_system

    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("""
            SELECT id, module, source_field, dest_system_type, dest_table, dest_field, value_map, origin,
                   transform_note, is_confirmed
            FROM transfer_field_mappings
            WHERE module = :m AND dest_system_type = :dst
            ORDER BY source_field, dest_table, dest_field
        """),
        {"m": module, "dst": dest_system_type},
    )
    src_d, tgt_d = dictionary_for_system(source_system_type), dictionary_for_system(dest_system_type)

    def _def(d, q):
        f = d.resolve(q) if q else None
        return None if f is None else {"type": f.type, "length": f.length, "decimals": f.decimals,
                                       "check_table": f.check_table, "description": f.description}
    out = []
    for x in r.fetchall():
        row = _row(x)
        tgt = f"{row['dest_table']}.{row['dest_field']}" if row["dest_table"] and row["dest_field"] else None
        out.append({**row, "source_def": _def(src_d, row["source_field"]), "target_def": _def(tgt_d, tgt)})
    return {"mappings": out}


@router.post("/field-map")
async def create_field_map(
    body: FieldMapCreate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    r = await db.execute(
        text("""
            INSERT INTO transfer_field_mappings
                (id, tenant_id, module, source_field, dest_system_type, dest_table, dest_field, value_map,
                 origin, transform_note, is_confirmed)
            VALUES (gen_random_uuid(), :tid, :m, :sf, :dst, :dt, :df, :vm, 'steward', :note, true)
            ON CONFLICT DO NOTHING RETURNING id
        """),
        {"tid": str(tenant.id), "m": body.module, "sf": body.source_field.upper(), "dst": body.dest_system_type,
         "dt": (body.dest_table or "").upper() or None, "df": (body.dest_field or "").upper() or None,
         "vm": body.value_map, "note": body.transform_note},
    )
    row = r.fetchone()
    await db.commit()
    if not row:
        raise HTTPException(status_code=409, detail="This source → target mapping already exists.")
    return {"id": str(row[0])}


@router.put("/field-map/{mapping_id}")
async def update_field_map(
    mapping_id: uuid.UUID,
    body: FieldMapUpdate,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    sets, params = [], {"id": mapping_id}
    for col in ("dest_table", "dest_field", "transform_note", "is_confirmed", "value_map"):
        val = getattr(body, col)
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = val.upper() if col in ("dest_table", "dest_field") and val else val
    if not sets:
        raise HTTPException(status_code=400, detail="No fields to update.")
    sets += ["updated_at = now()", "origin = 'steward'"]
    r = await db.execute(
        text(f"UPDATE transfer_field_mappings SET {', '.join(sets)} WHERE id = :id RETURNING id"), params)
    if not r.fetchone():
        raise HTTPException(status_code=404, detail="Mapping not found.")
    await db.commit()
    return {"id": str(mapping_id), "updated": True}


@router.delete("/field-map/{mapping_id}")
async def delete_field_map(
    mapping_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    await db.execute(text("DELETE FROM transfer_field_mappings WHERE id = :id"), {"id": mapping_id})
    await db.commit()
    return {"deleted": True}


@router.post("/field-map/seed")
async def seed_field_map(
    body: SeedBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    """Seed the map from the source data actually held: identity where the target
    has the field, plus the SAP-standard conversions (CVI business partner, SD
    status). Existing steward mappings are kept."""
    from starlette.concurrency import run_in_threadpool
    from sqlalchemy.orm import Session
    from workers.db import get_sync_engine

    await _set_rls(db, tenant.id)

    def _seed():
        from api.services.migration.engine import seed_mappings
        from api.services.source_design import dictionary_for
        from sap.ddic import dictionary_for_system
        from workers.dataset import load_dataset
        from workers.tasks.run_migration import module_source_tables, resolve_source_version, save_seed
        with Session(get_sync_engine()) as s:
            s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant.id)})
            vid, meta = resolve_source_version(s, body.source_system_id, body.source_version_id)
            if not vid or not meta.get("dataset_path"):
                return None
            src_d = dictionary_for(s, body.source_system_id or meta.get("system_id"))
            from checks.field_status_rules import conversions_for
            frames, _, _, _ = load_dataset(meta["dataset_path"], src_d, [body.module],
                                           conversions=conversions_for(s, body.source_system_id or meta.get("system_id")))
            tables = module_source_tables(body.module, frames)
            tgt_d = dictionary_for_system(body.dest_system_type)
            seed = seed_mappings({t: list(frames.frames[t].columns) for t in tables}, src_d, tgt_d)
            save_seed(s, str(tenant.id), body.module, body.dest_system_type, seed)
            s.commit()
            return len(seed)

    n = await run_in_threadpool(_seed)
    if n is None:
        raise HTTPException(status_code=409, detail="No analysed source dataset — extract or upload the source first.")
    return {"seeded": n, "module": body.module, "dest_system_type": body.dest_system_type}


# ── Value map ─────────────────────────────────────────────────────────────────


@router.get("/value-map")
async def get_value_map(
    module: str,
    target_field: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    where, params = "module = :m AND status IN ('confirmed', 'proposed')", {"m": module}
    if target_field:
        where += " AND target_field = :tf"
        params["tf"] = target_field
    rows = await db.execute(text(f"SELECT id, target_field, source_value, target_value, note, updated_at, status, "
                                 f"proposed_by::text AS proposed_by, decided_by::text AS decided_by "
                                 f"FROM transfer_value_mappings WHERE {where} ORDER BY target_field, source_value"),
                            params)
    return {"entries": [_row(x) for x in rows.fetchall()]}


@router.put("/value-map")
async def upsert_value_map(
    body: ValueMapUpsert,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    # Saving an entry is a proposal. It only feeds a load after a different user approves it
    # through /value-map/{id}/decision, so one person can never both make and check a mapping.
    _role: str = Depends(require_permission("analyse", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    uid = current_user_id(request)
    for e in body.entries:
        await db.execute(
            text("""
                INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value,
                                                     note, updated_by, updated_at, status, proposed_by)
                VALUES (gen_random_uuid(), :tid, :m, :tf, :sv, :tv, :note, :uid, now(), 'proposed', :uid)
                ON CONFLICT ON CONSTRAINT uq_transfer_value_mappings_scope
                DO UPDATE SET target_value = EXCLUDED.target_value, note = EXCLUDED.note,
                              updated_by = EXCLUDED.updated_by, updated_at = now(), status = 'proposed',
                              proposed_by = EXCLUDED.proposed_by, decided_by = NULL, decided_at = NULL
            """),
            {"tid": str(tenant.id), "m": body.module, "tf": body.target_field.upper(), "sv": e.source_value,
             "tv": e.target_value, "note": e.note, "uid": uid},
        )
    await write_audit(db, tenant.id, request, "value_map.propose", "value_map", body.target_field.upper(), None,
                      {"module": body.module, "entries": len(body.entries)})
    await db.commit()
    return {"saved": len(body.entries), "status": "proposed"}


class ValueMapDecision(BaseModel):
    decision: Literal["approve", "reject"]


@router.post("/value-map/{entry_id}/decision")
async def decide_value_map(
    entry_id: uuid.UUID,
    body: ValueMapDecision,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    r = (await db.execute(text("SELECT status, proposed_by::text, target_field, source_value, target_value "
                               "FROM transfer_value_mappings WHERE id = :id FOR UPDATE"), {"id": entry_id})).fetchone()
    if r is None:
        raise HTTPException(status_code=404, detail="Value map entry not found")
    if r[0] != "proposed":
        raise HTTPException(status_code=409, detail="Only a proposed entry can be decided")
    me = current_user_id(request)
    if me is None or (r[1] is not None and str(r[1]) == str(me)):
        raise HTTPException(status_code=403, detail="A different user must approve this value map entry")
    new = "confirmed" if body.decision == "approve" else "rejected"
    await db.execute(text("UPDATE transfer_value_mappings SET status = :s, decided_by = :u, decided_at = now(), "
                          "updated_at = now() WHERE id = :id"), {"s": new, "u": me, "id": entry_id})
    await write_audit(db, tenant.id, request, f"value_map.{body.decision}", "value_map", str(entry_id),
                      {"status": r[0]}, {"status": new, "target_field": r[2], "source_value": r[3],
                                         "target_value": r[4]})
    await db.commit()
    return {"id": str(entry_id), "status": new}


@router.delete("/value-map/{entry_id}")
async def delete_value_map(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("approve", scope=scope_from_path)),
):
    await _set_rls(db, tenant.id)
    await db.execute(text("DELETE FROM transfer_value_mappings WHERE id = :id"), {"id": entry_id})
    await db.commit()
    return {"deleted": True}
