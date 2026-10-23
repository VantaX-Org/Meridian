"""POST /api/v1/assistant/ask: Ask Meridian, the in-app question box.

Answers come from the Insights services first (api/services/assistant.py); the LLM is only the fallback and sees
aggregated findings only. Any signed-in user with view permission may ask; every read is scoped to the tenant.
"""
import uuid
from typing import Annotated, Literal, Optional, Union

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import assistant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])


class AskBody(BaseModel):
    # stripped first, so a blank question is a 422 like an empty one
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    version_id: Optional[uuid.UUID] = None
    module: Optional[str] = Field(None, max_length=64)


class DataPoint(BaseModel):
    label: str
    value: Union[int, float]


class AnswerLink(BaseModel):
    label: str
    href: str


class AskAnswer(BaseModel):
    answer: str
    intent: str
    data: Optional[list[DataPoint]] = None
    chart: Optional[Literal["bar", "line"]] = None
    links: list[AnswerLink] = []
    ai: bool = False
    version_id: Optional[str] = None


@router.post("/ask", response_model=AskAnswer, dependencies=[Depends(require_permission("view"))])
async def ask(body: AskBody, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> AskAnswer:
    out = await assistant.ask(body.question, str(body.version_id) if body.version_id else None, body.module,
                              assistant.DbSources(db, tenant), str(tenant.id))
    return AskAnswer(**out)
