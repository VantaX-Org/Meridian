"""Jobs: what is running and what just finished, for every task type, plus one
live stream. See api/services/jobs.py for the shape."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from api.deps import Tenant, get_tenant
from api.routes.events import _subscribe_redis
from api.services import jobs
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"], dependencies=[Depends(require_permission("view"))])


@router.get("")
async def list_jobs(active: bool = Query(False, description="Only queued and running jobs"),
                    limit: int = Query(50, ge=1, le=200), tenant: Tenant = Depends(get_tenant)):
    return {"jobs": jobs.list_jobs(str(tenant.id), active_only=active, limit=limit)}


@router.get("/events")
async def stream_jobs(tenant: Tenant = Depends(get_tenant)):
    """SSE: one ``job`` event per registry write (full job object). Never closes on its own."""
    return StreamingResponse(_subscribe_redis(f"events:{tenant.id}:jobs"), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


@router.get("/{job_id}")
async def get_job(job_id: str, tenant: Tenant = Depends(get_tenant)):
    job = jobs.get_job(str(tenant.id), job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job
