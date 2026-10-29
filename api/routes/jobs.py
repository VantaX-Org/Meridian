"""Jobs: what is running and what just finished, for every task type, plus one
live stream and a retry for failed jobs. See api/services/jobs.py for the shape."""

import asyncio
import json
import logging
import uuid
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.events import _subscribe_redis
from api.services import jobs
from api.services.rbac import (
    Scope, _as_uuid, current_user_id, current_user_label, require_permission, require_scope, write_audit,
)

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"], dependencies=[Depends(require_permission("view"))])

logger = logging.getLogger("meridian.jobs")

CANNOT_RETRY = "This kind of job cannot be retried; start it again from its page"


@router.get("")
async def list_jobs(active: bool = Query(False, description="Only queued and running jobs"),
                    limit: int = Query(50, ge=1, le=200), tenant: Tenant = Depends(get_tenant)):
    from api.services.run_prediction import with_queue_positions

    listed = jobs.list_jobs(str(tenant.id), active_only=active, limit=limit)
    # queue_position on every queued job: 1 + the tenant's queued jobs registered before it
    if active or len(listed) < limit:
        return {"jobs": with_queue_positions(listed)}
    queued = with_queue_positions(jobs.list_jobs(str(tenant.id), active_only=True, limit=200))
    pos = {j["id"]: j.get("queue_position") for j in queued}
    return {"jobs": [{**j, "queue_position": pos.get(j["id"])} if j.get("status") == "queued" else j for j in listed]}


@router.get("/events")
async def stream_jobs(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """SSE: one ``job`` event per registry write (full job object). Never closes on its own.

    The router's permission check borrowed a DB session from ``get_db``; FastAPI would keep it
    (and its pooled connection) until the stream ends, and a few open tabs then exhaust the
    pool. ``db`` here is that same per-request session: close it before streaming, so the
    stream holds Redis only."""
    await db.close()
    return StreamingResponse(_subscribe_redis(f"events:{tenant.id}:jobs"), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


@router.get("/{job_id}")
async def get_job(job_id: str, tenant: Tenant = Depends(get_tenant)):
    job = jobs.get_job(str(tenant.id), job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.get("status") == "queued":
        from api.services.run_prediction import with_queue_positions
        pos = {j["id"]: j.get("queue_position") for j in
               with_queue_positions(jobs.list_jobs(str(tenant.id), active_only=True, limit=200))}
        job = {**job, "queue_position": pos.get(job["id"])}
    return job


# ── Retry: start a failed job again through the endpoint that started it ──────────────────

Dispatch = Callable[[dict, Request, AsyncSession, Tenant], Awaitable[Any]]


async def _extraction(job: dict, request: Request, db: AsyncSession, tenant: Tenant) -> Any:
    """The start request the route recorded on the job (api/routes/system_objects.py, connectivity.py)."""
    retry = job["retry"]
    if retry["via"] == "downloads":
        from api.routes.system_objects import DownloadBody, start_download
        return await start_download(uuid.UUID(job["system_id"]), DownloadBody(**retry["body"]), request, db, tenant)
    from api.routes.connectivity import ExtractModuleRequest, extract_modules
    return await extract_modules(ExtractModuleRequest(**retry["body"]), request, db, tenant)


async def _analysis(job: dict, request: Request, db: AsyncSession, tenant: Tenant) -> Any:
    from api.routes.versions import AnalyseOptions, analyse_version
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(tenant.id)})
    kept = (await db.execute(text("SELECT metadata->'analysis_options' FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                             {"v": job["version_id"], "t": str(tenant.id)})).scalar()  # a limited run is retried as limited
    return await analyse_version(job["version_id"], db, tenant, AnalyseOptions(**kept) if kept else None)


async def _config_load(job: dict, request: Request, db: AsyncSession, tenant: Tenant) -> Any:
    from api.routes.connectivity import ConfigLoadRequest, start_config_load
    return await start_config_load(ConfigLoadRequest(system_id=job["system_id"]), db, tenant)


async def _process_discovery(job: dict, request: Request, db: AsyncSession, tenant: Tenant) -> Any:
    """The same L1s again. A run stored as incremental re-derives its window from the watermark, as the
    start does; a full run's window_from is the period the caller asked for."""
    from api.routes.process_discovery import RunRequest, _rls, start_runs

    await _rls(db, tenant)
    runs = (await db.execute(text(
        "SELECT l1, mode, window_from FROM process_discovery_runs "
        "WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[])) "
        "ORDER BY array_position(CAST(:ids AS uuid[]), id)"),
        {"t": str(tenant.id), "ids": job.get("run_ids") or []})).fetchall()
    if not runs:
        raise HTTPException(status_code=422, detail=CANNOT_RETRY)
    full = [r.window_from for r in runs if r.mode == "full"]
    body = RunRequest(l1s=[r.l1 for r in runs],
                      mode="incremental" if any(r.mode == "incremental" for r in runs) else "full",
                      period_from=full[0] if full else None)
    return await start_runs(job["system_id"], body, request, tenant, db)


# kind -> (the permission its start endpoint requires, how to start it again)
RETRY: dict[str, tuple[str, Dispatch]] = {
    "extraction": ("trigger_sync", _extraction),
    "analysis": ("analyse", _analysis),
    "config_load": ("trigger_sync", _config_load),
    "process_discovery": ("run_process_discovery", _process_discovery),
}


def _retryable(job: dict) -> bool:
    kind = job.get("kind")
    if kind == "analysis":
        return bool(job.get("version_id"))
    if kind == "extraction":  # only a download its start route recorded, not one a process discovery chained
        return bool(job.get("retry")) and bool(job.get("system_id"))
    return kind in RETRY and bool(job.get("system_id"))


@router.post("/{job_id}/retry", status_code=202)
async def retry_job(job_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                    db: AsyncSession = Depends(get_db)):
    """Start a failed job again through the endpoint that started it, with the permission that endpoint requires
    at the job's system. Returns that endpoint's answer. Each start makes a new job, except an analysis, which
    keeps its version's id."""
    job = jobs.get_job(str(tenant.id), job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.get("status") != "failed":
        raise HTTPException(409, "Only a failed job can be retried")
    if not _retryable(job):
        raise HTTPException(422, CANNOT_RETRY)
    action, dispatch = RETRY[job["kind"]]
    await require_scope(request, db, tenant, action, Scope(_as_uuid(job.get("system_id")), None))
    return await dispatch(job, request, db, tenant)


# ── Cancel: stop a queued or running job ──────────────────────────────────────────────────

def _revoke(task_ids: list[str]) -> bool:
    """Revoke the Celery tasks behind a job and terminate those already running. False when the broker could not be
    told (the job is still marked cancelled: its later progress writes are dropped)."""
    try:
        from workers.celery_app import celery_app
        celery_app.control.revoke(task_ids, terminate=True, signal="SIGTERM")
        return True
    except Exception as exc:
        logger.warning("revoke %s failed: %s", task_ids, type(exc).__name__)
        return False


@router.post("/{job_id}/cancel", dependencies=[Depends(require_permission("manage_settings"))])
async def cancel_job(job_id: str, request: Request, tenant: Tenant = Depends(get_tenant),
                     db: AsyncSession = Depends(get_db)):
    """Cancel a queued or running job: revoke its Celery tasks (terminating a running one), mark it ``cancelled`` with who
    and when, and publish it on the jobs stream. An analysis or upload also ends its version as ``failed`` with
    ``metadata.cancelled``, so the run can be started again. 404 for an unknown job, 409 once it has finished."""
    job = jobs.get_job(str(tenant.id), job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.get("status") not in jobs.ACTIVE:
        raise HTTPException(409, "This job has already finished")
    task_ids = [t for t in job.get("task_ids") or [] if isinstance(t, str)]
    revoked = await asyncio.to_thread(_revoke, task_ids) if task_ids else False
    saved = jobs.mark_cancelled(str(tenant.id), job_id, by=current_user_id(request), by_label=current_user_label())
    if saved is None:
        raise HTTPException(503, "The job registry is not reachable")
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(tenant.id)})
    version_id = job.get("version_id")
    if job.get("kind") in ("analysis", "upload") and _as_uuid(version_id):
        await db.execute(text(
            "UPDATE analysis_versions SET status = 'failed', metadata = COALESCE(metadata, '{}'::jsonb) "
            "|| jsonb_build_object('cancelled', CAST(:c AS jsonb)) "
            "WHERE id = :v AND tenant_id = :t AND status IN ('pending', 'running')"),
            {"v": version_id, "t": str(tenant.id),
             "c": json.dumps({"by": saved["cancelled_by"], "by_label": saved["cancelled_by_label"],
                              "at": saved["cancelled_at"]})})
    await write_audit(db, tenant.id, request, "job.cancel", "job", job_id,
                      {"status": job.get("status"), "kind": job.get("kind"), "label": job.get("label")},
                      {"status": "cancelled", "kind": job.get("kind"), "tasks_revoked": revoked if task_ids else None})
    await db.commit()
    return {**saved, "tasks_revoked": revoked if task_ids else None}
