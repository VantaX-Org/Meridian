"""Fix simulation on the stored run: POST /api/v1/simulate/fix and GET /api/v1/simulate/fix/top.

Recomputes an object's receipt with chosen failures treated as fixed (api/services/simulate_fix.py): the score, the
measured score before the cap, the cap, the breaches, the dimensions, the verdict, the S/4 features blocked and
degraded and each wave's gate, before and after, and the landscape sentence with the object's cell replaced.
Read-only, deterministic and not cached; scoped by the object (and the system when one is named).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.services import simulate_fix as sf
from api.services.rbac import Scope, require_permission, require_scope

router = APIRouter(prefix="/api/v1/simulate", tags=["simulate"])


class RecordRef(BaseModel):
    module: str = Field(min_length=1, max_length=100)
    record_key: str = Field(min_length=1, max_length=2000)


class SimulateBody(BaseModel):
    module: str = Field(min_length=1, max_length=100)
    system_id: uuid.UUID | None = None
    run_id: uuid.UUID | None = None
    rules: list[str] = Field(default_factory=list, max_length=500)
    records: list[RecordRef] = Field(default_factory=list, max_length=5000)
    batches: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class GateOut(BaseModel):
    wave_id: str
    name: str
    open: bool
    reasons: list[str]


class StateOut(BaseModel):
    score: float | None = None
    raw_score: float | None = None
    cap_level: int | None = None
    breaches: list[str]
    dimensions: dict[str, float]
    verdict: str | None = None
    features_blocked: int
    features_degraded: int
    wave_gate: list[GateOut]


class DeltaOut(BaseModel):
    score: float | None = None
    raw_score: float | None = None
    breaches_cleared: list[str]
    features_blocked: int
    features_degraded: int
    verdict_changed: bool
    gates_opened: list[str]


class SentenceOut(BaseModel):
    held_under_85: int
    objects: int
    critical_over_tolerance: int
    release_if_fixed: list[str]
    released: int


class LandscapeDeltaOut(BaseModel):
    before: SentenceOut
    after: SentenceOut


class SimulateOut(BaseModel):
    module: str
    run_id: str
    run_at: datetime | None = None
    system_id: str | None = None
    before: StateOut
    after: StateOut
    delta: DeltaOut
    method: dict
    landscape: LandscapeDeltaOut | None = None


class TopRuleOut(BaseModel):
    check_id: str
    severity: str
    failing: int
    after_score: float | None = None
    delta: float | None = None
    after_verdict: str | None = None
    breach_cleared: bool


class TopOut(BaseModel):
    module: str
    run_id: str
    score: float | None = None
    rules: list[TopRuleOut]


async def _object_run(request: Request, db: AsyncSession, tenant: Tenant, module: str,
                      system_id: uuid.UUID | None, run_id: uuid.UUID | None) -> sf.ObjectRun:
    await _rls(db, tenant)
    await require_scope(request, db, tenant, "view", Scope(system_id, module))
    run = await sf.load_object_run(db, str(tenant.id), module, str(run_id) if run_id else None,
                                   str(system_id) if system_id else None)
    if run is None:
        raise HTTPException(status_code=404, detail="Object not found for this run")
    if not system_id and run.system_id and sf.parse_uuid(run.system_id):  # a scoped grant must cover the run's system
        await require_scope(request, db, tenant, "view", Scope(uuid.UUID(run.system_id), module))
    return run


@router.post("/fix", response_model=SimulateOut, dependencies=[Depends(require_permission("view"))])
async def simulate_fix(body: SimulateBody, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)):
    """The object's receipt before and after the chosen rules, records and fix batches are treated as fixed."""
    from api.routes.landscape import get_landscape, sentence_of

    run = await _object_run(request, db, tenant, body.module, body.system_id, body.run_id)
    sel = sf.Selection(rules={r.strip() for r in body.rules if r.strip()},
                       records={r.record_key for r in body.records if r.module == body.module},
                       batch_keys=await sf.batch_selection(db, str(tenant.id), body.module, [str(b) for b in body.batches]))
    out = await sf.simulate(db, str(tenant.id), run, sel)
    land = await get_landscape(scope="current", run=None, db=db, tenant=tenant)
    cells = land["cells"]
    if any(c["module"] == run.module and c["run_id"] == run.run_id for c in cells):
        out["landscape"] = {"before": sentence_of(cells), "after": sf.sentence_after(cells, out)}
    return out


@router.get("/fix/top", response_model=TopOut, dependencies=[Depends(require_permission("view"))])
async def top_fixes(request: Request, module: str = Query(..., min_length=1, max_length=100),
                    system_id: uuid.UUID | None = Query(None), run_id: uuid.UUID | None = Query(None),
                    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The five failing rules whose fix moves the shown score most, each with its simulated after-score."""
    run = await _object_run(request, db, tenant, module, system_id, run_id)
    failing = [f for f in sf.rebuild(run.findings, module) if not f.passed and not f.error]
    rows = []
    before_score = None
    for f in failing:
        sim = await sf.simulate(db, str(tenant.id), run, sf.Selection(rules={f.check_id}))
        before_score = sim["before"]["score"]
        rows.append({"check_id": f.check_id, "severity": f.severity, "failing": f.affected_count,
                     "after_score": sim["after"]["score"], "delta": sim["delta"]["score"],
                     "after_verdict": sim["after"]["verdict"],
                     "breach_cleared": f.check_id in sim["delta"]["breaches_cleared"],
                     "_raw": sim["delta"]["raw_score"] or 0.0})
    rows.sort(key=lambda r: (-(r["delta"] or 0.0), -r["_raw"], -r["failing"], r["check_id"]))
    if before_score is None:
        before_score = sf.receipt_of([*sf.rebuild(run.findings, module)], run, {}, {}, [])["score"]
    return {"module": module, "run_id": run.run_id, "score": before_score,
            "rules": [{k: v for k, v in r.items() if k != "_raw"} for r in rows[:sf.TOP_RULES]]}
