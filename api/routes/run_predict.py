"""GET /api/v1/runs/predict?system_id=&modules=&delta=: how long a run will take, how many records it will check, what
it costs in the tenant's cost model and where it would queue. Deterministic, from the tenant's own past runs
(api/services/run_prediction.py); read-only, permission view, RLS."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import jobs, run_prediction as rp
from api.services.rbac import require_permission
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


class ObjectPredictionOut(BaseModel):
    module: str
    runs: int                                 # past runs the prediction reads (at most 8)
    records: Optional[int] = None             # median records checked
    seconds: Optional[float] = None           # median seconds per record x records
    seconds_low: Optional[float] = None       # 25th percentile rate x records (lowest rate under 4 runs)
    seconds_high: Optional[float] = None      # 75th percentile rate x records (highest rate under 4 runs)
    confidence: str                           # high | medium | low | none
    basis: str                                # full | delta | full (no delta run yet)


class TotalOut(BaseModel):
    records: Optional[int] = None
    seconds: Optional[float] = None
    seconds_low: Optional[float] = None
    seconds_high: Optional[float] = None
    confidence: str


class CostOut(BaseModel):
    amount: Optional[float] = None
    low: Optional[float] = None
    high: Optional[float] = None
    currency: str
    per_hour: Optional[float] = None
    per_million_records: Optional[float] = None


class QueueOut(BaseModel):
    broker: dict[str, int]                    # waiting tasks per Celery queue; empty when the broker is unreadable
    waiting: int
    running_jobs: int
    queued_jobs: int
    position: int                             # where a run started now would queue (1: next)


class PredictOut(BaseModel):
    system_id: Optional[str] = None
    modules: list[str]
    delta: bool
    objects: list[ObjectPredictionOut]
    total: TotalOut
    cost: Optional[CostOut] = None
    queue: QueueOut


_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}


@router.get("/predict", response_model=PredictOut, dependencies=[Depends(require_permission("view"))])
async def predict(system_id: Optional[uuid.UUID] = Query(None),
                  modules: Optional[str] = Query(None, max_length=2000, description="comma-separated objects; default "
                                                                                    "the objects of the latest run"),
                  delta: bool = Query(False, description="predict a delta extraction's run"),
                  db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    from checks.cost import effective as effective_cost_model

    await _rls(db, tenant)
    t = str(tenant.id)
    sid = str(system_id) if system_id else None
    if sid and not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                                     {"s": sid, "t": t})).scalar():
        raise HTTPException(status_code=404, detail="System not found")
    mods = [m.strip() for m in (modules or "").split(",") if m.strip()]
    if not mods:
        last = await latest_run(db, tenant.id, system_id=sid)
        if last:
            summ = (await db.execute(text("SELECT dqs_summary FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                     {"v": last, "t": t})).scalar()
            mods = sorted(k for k, v in (summ or {}).items() if isinstance(v, dict))
    objects = []
    for m in dict.fromkeys(mods):
        hist, basis = await rp.history(db, t, m, sid, delta)
        objects.append({"module": m, **{k: v for k, v in rp.predict_object(hist).items() if k != "seconds_per_record"},
                        "basis": basis})
    measured = [o for o in objects if o["seconds"] is not None]
    total = {"records": sum(o["records"] for o in measured) if measured else None,
             "seconds": round(sum(o["seconds"] for o in measured), 1) if measured else None,
             "seconds_low": round(sum(o["seconds_low"] for o in measured), 1) if measured else None,
             "seconds_high": round(sum(o["seconds_high"] for o in measured), 1) if measured else None,
             "confidence": min((o["confidence"] for o in objects), key=lambda c: _RANK[c], default="none")}

    model = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": t})).scalar()
    model = model if isinstance(model, dict) else {}
    run_cost = model.get("run_cost") if isinstance(model.get("run_cost"), dict) else None
    cost = None
    if run_cost and total["seconds"] is not None:
        cost = {"amount": rp.cost_of(run_cost, total["seconds"], total["records"]),
                "low": rp.cost_of(run_cost, total["seconds_low"], total["records"]),
                "high": rp.cost_of(run_cost, total["seconds_high"], total["records"]),
                "currency": str(effective_cost_model(model)["currency"]),
                "per_hour": run_cost.get("per_hour"), "per_million_records": run_cost.get("per_million_records")}

    broker = rp.queue_depth()
    active = jobs.list_jobs(t, active_only=True, limit=200)
    running = sum(1 for j in active if j.get("status") == "running")
    queued = sum(1 for j in active if j.get("status") == "queued")
    waiting = sum(broker.values())
    return {"system_id": sid, "modules": list(dict.fromkeys(mods)), "delta": delta, "objects": objects,
            "total": total, "cost": cost,
            "queue": {"broker": broker, "waiting": waiting, "running_jobs": running, "queued_jobs": queued,
                      "position": max(waiting, queued) + 1}}
