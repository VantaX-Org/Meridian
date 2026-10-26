"""Jobs: what is running and what just finished, for every task type, plus one
live stream and a retry for failed jobs. See api/services/jobs.py for the shape."""

import uuid
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.events import _subscribe_redis
from api.services import jobs
from api.services.rbac import Scope, _as_uuid, require_permission, require_scope

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"], dependencies=[Depends(require_permission("view"))])

CANNOT_RETRY = "This kind of job cannot be retried; start it again from its page"


@router.get("")
async def list_jobs(active: bool = Query(False, description="Only queued and running jobs"),
                    limit: int = Query(50, ge=1, le=200), tenant: Tenant = Depends(get_tenant)):
    return {"jobs": jobs.list_jobs(str(tenant.id), active_only=active, limit=limit)}


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
    from api.routes.versions import analyse_version
    return await analyse_version(job["version_id"], db, tenant)


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
