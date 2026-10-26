"""Routes for triggering agent analysis runs."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from api.services.rbac import require_permission
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from db.schema import AnalysisVersion

router = APIRouter(prefix="/api/v1", tags=["analyse"])
logger = logging.getLogger("meridian.analyse")


@router.post("/versions/{version_id}/run-agents", dependencies=[Depends(require_permission("analyse"))])
async def run_agents_endpoint(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Manually trigger the LangGraph agent pipeline for a version."""
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    vid = uuid.UUID(version_id)

    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid,
            AnalysisVersion.tenant_id == tenant.id,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if version.status not in ("complete", "agents_complete", "agents_failed"):
        raise HTTPException(
            status_code=409,
            detail=f"Version status is '{version.status}' — agents can only run after checks complete",
        )

    from api.services import jobs
    from api.services.task_progress import STEP_AI_INSIGHTS, TOTAL_STEPS, update_task_progress
    from workers.tasks.run_agents import run_agents

    # Register the job and seed progress before the worker starts, as POST /versions/{id}/analyse
    # does, so the run page's progress banner and the jobs tray show it the moment this returns.
    label = f"AI analysis{f' | {version.label}' if version.label else ''}"
    jobs.start_job(str(tenant.id), str(vid), "analysis", label, status="queued", progress_key=str(vid),
                   version_id=str(vid), system_id=(version.metadata_ or {}).get("system_id"))
    step_num, _ = STEP_AI_INSIGHTS
    update_task_progress(str(vid), status="queued", current_step="Waiting for worker to start AI insights",
                         step_number=step_num, total_steps=TOTAL_STEPS,
                         percent_complete=int(((step_num - 1) / TOTAL_STEPS) * 100))

    # force: a manual re-run repeats the pipeline even on an agents_complete run, which the
    # worker otherwise skips as a duplicate delivery.
    job = run_agents.delay(str(vid), str(tenant.id), force=True)

    return {
        "version_id": str(vid),
        "job_id": str(job.id),
        "status": "agents_enqueued",
    }
