"""GET /api/v1/impact/money: per S/4 feature, its status, blocking rules and opportunity cost per month, the cost
since it was first blocked, and the waves or objects ranked by the value fixing them would unblock
(api/services/impact_money.py). Deterministic from config_impact_results and the tenant's cost model; the money is
null when the tenant has no cost model."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import impact_money
from api.services.rbac import Scope, require_permission, require_scope

router = APIRouter(prefix="/api/v1/impact", tags=["impact"])


@router.get("/money", dependencies=[Depends(require_permission("view"))])
async def get_money(request: Request, scope: Literal["wave", "object", "landscape"] = Query("landscape"),
                    id: str | None = Query(None, max_length=100),
                    as_of: datetime | None = Query(None, description="cost accrues up to this time (default now)"),
                    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    if scope != "landscape" and not id:
        raise HTTPException(status_code=422, detail=f"scope={scope} needs id")
    if scope == "wave":
        try:
            id = str(uuid.UUID(str(id)))
        except ValueError:
            raise HTTPException(status_code=422, detail="id must be a wave id")
    await _rls(db, tenant)
    if scope == "object":
        await require_scope(request, db, tenant, "view", Scope(None, id))
    try:
        return await impact_money.money(db, str(tenant.id), scope, id if scope != "landscape" else None, as_of)
    except LookupError:
        raise HTTPException(status_code=404, detail="Wave not found")
