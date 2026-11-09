"""Meridian's Aletheia engine sidecar: its status for Administration, and what it learned from the run trend for
Insights. Both answer 200 when the engine is off; the body says why (api/services/aletheia_engine.py)."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.insights import _agg
from api.services import aletheia_engine as engine
from api.services import insights_aggregate as agg
from api.services.rbac import require_permission

router = APIRouter(tags=["aletheia"])


@router.get("/api/v1/aletheia/engine", dependencies=[Depends(require_permission("view"))])
async def get_engine_status():
    return await run_in_threadpool(engine.status)


@router.get("/api/v1/insights/engine-drivers", dependencies=[Depends(require_permission("view"))])
async def get_engine_drivers(version_id: Optional[uuid.UUID] = None, system_id: Optional[str] = None,
                             limit: int = Query(12, ge=3, le=50),
                             db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    trend = await _agg(db, tenant, agg.trends, version_id and str(version_id), system_id, limit)
    out = await run_in_threadpool(engine.learn_trend, trend["runs"])
    return {"lineage": trend["lineage"], "labels": engine.METRICS, **out}
