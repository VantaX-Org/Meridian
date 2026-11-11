"""Governance process analytics: cycle time, approval time, step dwell, SLA breaches and backlog of change requests.

The figures are computed by ``api.services.process_analytics`` from the tenant's own change requests created in the
window and the approval tasks of their workflows.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import process_analytics as pa
from api.services.rbac import require_permission, scope_from_path

router = APIRouter(prefix="/api/v1/governance", tags=["governance"])


class Spread(BaseModel):
    n: int
    median_hours: Optional[float] = None
    p90_hours: Optional[float] = None


class ObjectRow(BaseModel):
    object: str
    total: int
    open: int
    created: int
    rejected: int
    failed: int
    cancelled: int
    median_cycle_hours: Optional[float] = None
    p90_cycle_hours: Optional[float] = None


class Rates(BaseModel):
    closed: int
    rejection: Optional[float] = None
    failure: Optional[float] = None
    cancellation: Optional[float] = None


class Sla(BaseModel):
    with_sla: int
    breached: int
    rate: Optional[float] = None


class StepRow(BaseModel):
    step: str
    index: int
    tasks: int
    decided: int
    pending: int
    breached: int
    overdue_open: int
    median_dwell_hours: Optional[float] = None
    p90_dwell_hours: Optional[float] = None


class Aging(BaseModel):
    lt_1d: int
    d1_3: int
    d3_7: int
    gt_7d: int


class Week(BaseModel):
    week: str
    submitted: int
    created: int


class ProcessAnalyticsOut(BaseModel):
    days: int
    total: int
    by_status: dict[str, int]
    objects: list[ObjectRow]
    cycle: Spread
    approval: Spread
    rates: Rates
    sla: Sla
    steps: list[StepRow]
    bottleneck: Optional[str] = None
    aging: Aging
    weekly: list[Week]


_REQUESTS = text("""
    SELECT id::text AS id, object, kind, status, created_at, submitted_at, decided_at, completed_at,
           workflow_instance_id::text AS instance_id
      FROM change_requests
     WHERE tenant_id = :tid AND created_at >= now() - make_interval(days => :days)
""")

_TASKS = text("""
    SELECT t.instance_id::text AS instance_id, t.step_name, t.step_index, t.status,
           t.activated_at, t.decided_at, t.due_at, t.sla_hours
      FROM workflow_tasks t
     WHERE t.tenant_id = :tid AND t.instance_id::text = ANY(:ids)
""")


@router.get("/process-analytics", response_model=ProcessAnalyticsOut)
async def process_analytics(
    days: int = Query(90, ge=7, le=365),
    obj: Optional[str] = Query(None, alias="object", pattern="^(material|customer|vendor|business_partner)$"),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _role: str = Depends(require_permission("view", scope=scope_from_path)),
) -> ProcessAnalyticsOut:
    await _rls(db, tenant)
    requests = [dict(r) for r in (await db.execute(_REQUESTS, {"tid": str(tenant.id), "days": days})).mappings()]
    if obj:
        requests = [r for r in requests if r["object"] == obj]
    ids = sorted({r["instance_id"] for r in requests if r.get("instance_id")})
    tasks = []
    if ids:
        tasks = [dict(t) for t in (await db.execute(_TASKS, {"tid": str(tenant.id), "ids": ids})).mappings()]
    return ProcessAnalyticsOut(days=days, **pa.analyse(requests, tasks, datetime.now(timezone.utc)))
