"""Analysis progress endpoint — frontend poll target for the progress bar.

Returns a rich progress payload combining live Redis updates from the Celery
workers with the authoritative status column on analysis_versions. Callers
always get a consistent shape even if Redis is unavailable.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.task_progress import TOTAL_STEPS, get_task_progress
from db.schema import AnalysisVersion

router = APIRouter(prefix="/api/v1", tags=["analysis"])
logger = logging.getLogger("meridian.analysis_status")


# Terminal DB states mapped to overall status values for the frontend.
DB_STATUS_OVERALL: dict[str, str] = {
    "pending": "queued",
    "queued": "queued",
    "running": "processing",
    "complete": "completed",           # checks done, deterministic report ready
    "agents_running": "completed",     # user has results, agents enriching in background
    "agents_complete": "completed",
    "failed": "failed",
    "agents_failed": "completed",      # agents failed but deterministic report is valid
    "ai_enriching": "completed",       # background AI enrichment in progress
    "ai_enriched": "completed",        # background AI enrichment finished
}

# Fallback mapping when Redis has nothing cached. Keeps the progress bar moving
# even if the worker never wrote a Redis entry (e.g. Redis outage).
DB_STATUS_STEP: dict[str, tuple[str, int]] = {
    "pending": ("Queued for analysis", 1),
    "queued": ("Queued for analysis", 1),
    "running": ("Running data quality checks", 3),
    "complete": ("Analysis complete", 6),
    "agents_running": ("Analysis complete — AI insights generating", 6),
    "agents_complete": ("Analysis complete", 6),
    "failed": ("Analysis failed", 3),
    "agents_failed": ("Analysis complete", 6),
    "ai_enriching": ("Analysis complete — AI enriching", 6),
    "ai_enriched": ("Analysis complete", 6),
}


class ProgressPayload(BaseModel):
    current_step: str
    step_number: int
    total_steps: int
    rows_processed: int
    total_rows: int
    percent_complete: int


class AnalysisStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: ProgressPayload
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    db_status: str


def _build_progress_from_redis(payload: dict) -> ProgressPayload:
    return ProgressPayload(
        current_step=str(payload.get("current_step") or ""),
        step_number=int(payload.get("step_number") or 0),
        total_steps=int(payload.get("total_steps") or TOTAL_STEPS),
        rows_processed=int(payload.get("rows_processed") or 0),
        total_rows=int(payload.get("total_rows") or 0),
        percent_complete=int(payload.get("percent_complete") or 0),
    )


def _build_progress_from_db(db_status: str) -> ProgressPayload:
    step_name, step_num = DB_STATUS_STEP.get(db_status, (db_status, 0))
    percent = 0
    if db_status == "agents_complete":
        percent = 100
    elif step_num:
        percent = min(99, int((step_num / TOTAL_STEPS) * 100))
    return ProgressPayload(
        current_step=step_name,
        step_number=step_num,
        total_steps=TOTAL_STEPS,
        rows_processed=0,
        total_rows=0,
        percent_complete=percent,
    )


@router.get(
    "/analysis/status/{version_id}",
    response_model=AnalysisStatusResponse,
)
async def get_analysis_status(
    version_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> AnalysisStatusResponse:
    """Return live progress + terminal result for an analysis run.

    Frontend polls this every ~2s while an upload is being processed. The
    response is always immediately available — this endpoint never blocks
    waiting on the Celery task.
    """
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    try:
        vid = uuid.UUID(version_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid version_id") from exc

    result = await db.execute(
        select(AnalysisVersion).where(
            AnalysisVersion.id == vid,
            AnalysisVersion.tenant_id == tenant.id,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    db_status = version.status or "pending"
    overall = DB_STATUS_OVERALL.get(db_status, "processing")

    live = get_task_progress(version_id)
    progress = (
        _build_progress_from_redis(live) if live else _build_progress_from_db(db_status)
    )

    # Terminal states: prefer DB truth for status/result, keep latest rich
    # progress info if Redis still has it (for step counts etc.).
    result_payload: Optional[dict[str, Any]] = None
    error_payload: Optional[str] = None

    if overall == "completed":
        progress.percent_complete = 100
        progress.step_number = progress.step_number or TOTAL_STEPS
        progress.current_step = progress.current_step or "Analysis complete"
        result_payload = {
            "version_id": str(version.id),
            "status": db_status,
            "dqs_summary": version.dqs_summary,
            "metadata": version.metadata_,
        }
    elif overall == "failed":
        if live and live.get("error"):
            error_payload = str(live["error"])
        else:
            error_payload = f"Analysis ended with status '{db_status}'"
        if not progress.current_step:
            progress.current_step = "Analysis failed"

    return AnalysisStatusResponse(
        task_id=str(version.id),
        status=overall,
        progress=progress,
        result=result_payload,
        error=error_payload,
        db_status=db_status,
    )
