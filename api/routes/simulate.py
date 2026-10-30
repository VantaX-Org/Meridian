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

router = APIRouter(prefix="/api/v1/simulate", tags=["fix-simulation"])


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
    wave_id: str = Field(description="Migration wave id.")
    name: str = Field(description="Wave name.")
    open: bool = Field(description="True when the wave's readiness gate would open.")
    reasons: list[str] = Field(description="Sentences naming what still holds the gate shut.")


class StateOut(BaseModel):
    score: float | None = Field(None, description="Data quality score (0 to 100) after the critical caps.")
    raw_score: float | None = Field(None, description="Weighted dimension score before the critical caps.")
    cap_level: int | None = Field(None, description="The cap applied (85 for one critical breach, 70 for two or more), or null.")
    breaches: list[str] = Field(description="Check ids of critical rules over tolerance.")
    dimensions: dict[str, float] = Field(description="Score per DAMA dimension (completeness, accuracy, consistency, timeliness, uniqueness, validity).")
    verdict: str | None = Field(None, description="Readiness verdict: go, at_risk or no_go.")
    features_blocked: int = Field(description="SAP features the config impact model marks blocked.")
    features_degraded: int = Field(description="SAP features the config impact model marks degraded.")
    wave_gate: list[GateOut] = Field(description="Readiness gates of the waves that include this object.")


class DeltaOut(BaseModel):
    score: float | None = Field(None, description="Change in score (after minus before).")
    raw_score: float | None = Field(None, description="Change in the uncapped score.")
    breaches_cleared: list[str] = Field(description="Critical rules the fix brings under tolerance.")
    features_blocked: int = Field(description="Change in blocked features.")
    features_degraded: int = Field(description="Change in degraded features.")
    verdict_changed: bool = Field(description="True when the verdict differs after the fix.")
    gates_opened: list[str] = Field(description="Wave ids whose gate opens after the fix.")


class SentenceOut(BaseModel):
    held_under_85: int = Field(description="Objects held under 85 by a critical cap.")
    objects: int = Field(description="Objects in the landscape.")
    critical_over_tolerance: int = Field(description="Critical rules over tolerance across the landscape.")
    release_if_fixed: list[str] = Field(description="Objects the fix would release from their cap.")
    released: int = Field(description="Count of objects released.")


class LandscapeDeltaOut(BaseModel):
    before: SentenceOut = Field(description="Landscape sentence before the fix.")
    after: SentenceOut = Field(description="Landscape sentence after the fix.")


class SimulateOut(BaseModel):
    module: str = Field(description="Object (module id) simulated.")
    run_id: str = Field(description="Run the simulation starts from.")
    run_at: datetime | None = Field(None, description="When that run finished.")
    system_id: str | None = Field(None, description="SAP system of the run.")
    before: StateOut = Field(description="The object's state in the run.")
    after: StateOut = Field(description="The object's state if the selected rules, records or batches were fixed.")
    delta: DeltaOut = Field(description="After minus before.")
    method: dict = Field(description="How the simulation was computed (deterministic, record level).")
    landscape: LandscapeDeltaOut | None = Field(None, description="The landscape sentence before and after, when the landscape is read.")


class TopRuleOut(BaseModel):
    check_id: str = Field(description="Rule id.")
    severity: str = Field(description="Rule severity: critical, high, medium or low.")
    failing: int = Field(description="Records failing the rule in the run.")
    after_score: float | None = Field(None, description="Object score if this rule alone were fixed.")
    delta: float | None = Field(None, description="Score gain if this rule alone were fixed.")
    after_verdict: str | None = Field(None, description="Verdict if this rule alone were fixed.")
    breach_cleared: bool = Field(description="True when fixing this rule clears a critical breach.")


class TopOut(BaseModel):
    module: str = Field(description="Object (module id).")
    run_id: str = Field(description="Run the ranking reads.")
    score: float | None = Field(None, description="Object score in that run.")
    rules: list[TopRuleOut] = Field(description="Rules ranked by the score gain of fixing each alone.")


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
    land = await get_landscape(scope="current", run=None, sort="position", db=db, tenant=tenant)
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
