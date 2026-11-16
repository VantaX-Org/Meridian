"""POST /api/v1/assistant/ask: Ask Meridian, the in-app question box.

Answers are assembled from the figures the Insights, Fix work and Progress services compute, and carry those figures
as their proof (api/services/assistant.py). The model, when configured, only rewords facts it is given. Any signed-in user with view permission may ask; every read is scoped to the tenant.
"""
import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Literal, Optional, Union

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
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
    #: narrow the question to one rule check or one failing record (the key is never sent to the model)
    check_id: Optional[str] = Field(None, max_length=64, pattern=r"^[A-Za-z0-9_]+$")
    record_key: Optional[str] = Field(None, max_length=200)


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
    return AskAnswer(**await _answer(body, db, tenant))


async def _answer(body: AskBody, db: AsyncSession, tenant: Tenant) -> dict:
    return await assistant.ask(body.question, str(body.version_id) if body.version_id else None, body.module,
                               assistant.DbSources(db, tenant), str(tenant.id),
                               current=body.scope == "current" and body.version_id is None,
                               check_id=body.check_id, record_key=body.record_key)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/ask/stream", response_class=StreamingResponse, dependencies=[Depends(require_permission("view"))])
async def ask_stream(body: AskBody, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> StreamingResponse:
    """SSE: ``evidence`` (facts, citations, figures, links), then ``token`` events of the answer text, then ``done``
    with the full AskAnswer. # ponytail: the model's reword is checked for grounding as a whole, so the checked
    text is chunked rather than streamed token by token; stream tokens if grounding moves to a per-chunk check."""
    out = AskAnswer(**await _answer(body, db, tenant)).model_dump()
    await db.close()  # the answer is built; the stream holds no pooled connection

    async def gen() -> AsyncIterator[str]:
        yield _sse("evidence", {k: out[k] for k in ("intent", "version_id", "facts", "citations", "data", "chart",
                                                    "links", "coverage", "grounded")})
        for piece in assistant._chunks(out["answer"]):
            yield _sse("token", {"text": piece})
        yield _sse("done", out)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                      "X-Accel-Buffering": "no"})


class Suggestions(BaseModel):
    suggestions: list[str]


@router.get("/suggestions", response_model=Suggestions, dependencies=[Depends(require_permission("view"))])
async def get_suggestions(module: Optional[str] = Query(None, max_length=64), version_id: Optional[uuid.UUID] = None,
                          check_id: Optional[str] = Query(None, max_length=64, pattern=r"^[A-Za-z0-9_]+$"),
                          db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> Suggestions:
    return Suggestions(suggestions=await assistant.suggestions(
        assistant.DbSources(db, tenant), str(version_id) if version_id else None, module, check_id))
