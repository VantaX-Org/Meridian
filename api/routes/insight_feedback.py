"""POST /insights/feedback: thumbs on the AI summary in the insight header."""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["insights"])


class InsightFeedbackBody(BaseModel):
    surface: str = Field(min_length=1, max_length=64, description="Route section the summary was shown on")
    run_id: Optional[str] = Field(None, max_length=64)
    vote: Literal["up", "down"]


class InsightFeedbackOut(BaseModel):
    id: str
    status: str


@router.post("/insights/feedback", response_model=InsightFeedbackOut, dependencies=[Depends(require_permission("view"))])
async def submit_insight_feedback(
    body: InsightFeedbackBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> InsightFeedbackOut:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    fid = str(uuid.uuid4())
    user_id = getattr(request.state, "local_user_id", None)
    await db.execute(
        text(
            "INSERT INTO insight_feedback (id, tenant_id, user_id, surface, run_id, vote) "
            "VALUES (:id, :tid, :uid, :surface, :run, :vote)"
        ),
        {"id": fid, "tid": str(tenant.id), "uid": str(user_id) if user_id else None,
         "surface": body.surface, "run": body.run_id, "vote": body.vote},
    )
    await db.commit()
    return InsightFeedbackOut(id=fid, status="recorded")
