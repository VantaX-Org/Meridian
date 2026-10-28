"""The Action centre: GET /api/v1/attention and /attention/count.

The tenant's ranked list is built and cached by api/services/attention.py; this route filters it to what the
caller may act on (their effective actions at each item's scope) and applies the query filters.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import attention
from api.services.rbac import dev_role_override, require_permission

router = APIRouter(prefix="/api/v1/attention", tags=["attention"])


class AttentionItem(BaseModel):
    id: str
    kind: str
    tier: int
    severity: str
    title: str
    detail: str
    href: str
    action_label: str
    count: int
    object: Optional[str] = None
    system_id: Optional[str] = None
    system_name: Optional[str] = None
    module: Optional[str] = None
    since: Optional[str] = None
    required_action: str


class AttentionCounts(BaseModel):
    critical: int
    high: int
    medium: int
    low: int


class AttentionOut(BaseModel):
    items: list[AttentionItem]
    generated_at: str
    counts: AttentionCounts


class AttentionCountOut(AttentionCounts):
    top: Optional[AttentionItem] = None


async def _viewer_items(request: Request, db: AsyncSession, tenant: Tenant, role: str) -> tuple[str, list[dict]]:
    payload = await attention.cached_collect(db, tenant.id)
    uid = None if dev_role_override(request) is not None else getattr(request.state, "local_user_id", None)
    return payload["generated_at"], await attention.visible_to(db, tenant.id, uid, role, payload["items"])


@router.get("", response_model=AttentionOut)
async def list_attention(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    kinds: Optional[str] = Query(None, description="comma-separated kinds"),
    object_: Optional[str] = Query(None, alias="object", description="an object (module) id"),
    system_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
) -> AttentionOut:
    """What needs attention for the caller, ranked (tier, severity, count, age). ``counts`` cover every matching
    item, ``items`` the first ``limit``. At most 60 s old (``generated_at``)."""
    generated_at, items = await _viewer_items(request, db, tenant, role)
    wanted = {k.strip() for k in kinds.split(",") if k.strip()} if kinds else None
    items = [i for i in items
             if (wanted is None or i["kind"] in wanted) and (object_ is None or i["module"] == object_)
             and (system_id is None or i["system_id"] == system_id)]
    return AttentionOut(items=items[:limit], generated_at=generated_at, counts=AttentionCounts(**attention.counts(items)))


@router.get("/count", response_model=AttentionCountOut)
async def attention_count(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
) -> AttentionCountOut:
    """The Rail badge and the home verdict button: counts by severity and the top item, for the caller."""
    _, items = await _viewer_items(request, db, tenant, role)
    return AttentionCountOut(**attention.counts(items), top=AttentionItem(**items[0]) if items else None)
