"""Routes for triggering agent analysis runs."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from db.schema import AnalysisVersion

router = APIRouter(prefix="/api/v1", tags=["analyse"])
logger = logging.getLogger("meridian.analyse")


@router.post("/versions/{version_id}/run-agents")
async def run_agents_endpoint(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Manually trigger the LangGraph agent pipeline for a version."""
    await db.execute(text(f"SET app.tenant_id TO '{tenant.id}'"))
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

    from workers.tasks.run_agents import run_agents

    job = run_agents.delay(str(vid), str(tenant.id))

    return {
        "version_id": str(vid),
        "job_id": str(job.id),
        "status": "agents_enqueued",
    }
