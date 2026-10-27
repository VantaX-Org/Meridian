"""POST /api/v1/assistant/ask: Ask Meridian, the in-app question box.

Answers are assembled from the figures the Insights, Fix work and Progress services compute, and carry those figures
as their proof (api/services/assistant.py). The model, when configured, only rewords facts it is given. Any signed-in user with view permission may ask; every read is scoped to the tenant.
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
    #: "current": score questions read the current state (every object at its latest run), as Home and Insights
    #: show it; ignored when ``version_id`` names a run
    scope: Optional[Literal["current"]] = None


class DataPoint(BaseModel):
    label: str
    value: Union[int, float]


class AnswerLink(BaseModel):
    label: str
    href: str


class CheckRef(BaseModel):
    """A rule check a fact speaks to; ``module`` is None when the fact names no object."""
    check_id: str
    module: Optional[str] = None


class Citation(CheckRef):
    """A check the answer rests on, linked to its failing records."""
    href: str


class Fact(BaseModel):
    """One figure the answer was assembled from."""
    statement: str
    value: Optional[float] = None
    source: str
    href: Optional[str] = None
    checks: list[CheckRef] = []


class AskAnswer(BaseModel):
    answer: str
    intent: str
    data: Optional[list[DataPoint]] = None
    chart: Optional[Literal["bar", "line"]] = None
    links: list[AnswerLink] = []
    #: the model reworded the assembled facts (``phrased``); kept as ``ai`` for older clients
    ai: bool = False
    phrased: bool = False
    version_id: Optional[str] = None
    facts: list[Fact] = []
    #: how much of the question the facts cover, 0 to 1
    coverage: float = 1.0
    #: every number in ``answer`` appears in ``facts``
    grounded: bool = True
    #: the checks the facts name, each linked to its failing records; empty when no fact speaks to a check
    citations: list[Citation] = []


@router.post("/ask", response_model=AskAnswer, dependencies=[Depends(require_permission("view"))])
async def ask(body: AskBody, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> AskAnswer:
    out = await assistant.ask(body.question, str(body.version_id) if body.version_id else None, body.module,
                              assistant.DbSources(db, tenant), str(tenant.id),
                              current=body.scope == "current" and body.version_id is None)
    return AskAnswer(**out)
