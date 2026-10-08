"""Run step history — api/routes/runs.py.

GET /api/v1/runs/{id}/steps returns the durable step-by-step history of one
analysis or sync run, written by workers/tasks/run_checks.py and
workers/tasks/run_sync.py via api/services/run_steps.py. Tenant-isolated via
RLS plus an explicit tenant_id filter.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


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
