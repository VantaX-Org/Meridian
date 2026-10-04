"""Fix simulation (what-if): queue a simulation on a stored version, read its result.

The worker patches a copy of the version's extracted frames and re-runs the checks;
nothing is written to SAP, to the extraction or to findings. Progress streams over
/api/v1/jobs/events (kind ``simulation``); the result expires after a day.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import jobs
from api.services.rbac import require_permission
from api.services.task_progress import _redis_client

router = APIRouter(prefix="/api/v1/simulations", tags=["simulation"])

_FIELD = re.compile(r"^[A-Z0-9_/]+\.[A-Z0-9_/]+$")
_MAX_MAP = 5000


class RuleFix(BaseModel):
    check_id: str = Field(min_length=1, max_length=128)
    fix_value: Optional[str | dict[str, str]] = None  # overrides the rule's own fix_value


class SimulationRequest(BaseModel):
    version_id: uuid.UUID
    value_maps: dict[str, dict[str, str]] = Field(default_factory=dict)  # TABLE.FIELD -> {old: new, __blank__: new}
    rule_fixes: list[RuleFix] = Field(default_factory=list, max_length=500)
    batch_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    modules: Optional[list[str]] = None
    all_rule_fixes: bool = False  # every failing rule with a fix_value / single-option suggestion
    rank: bool = True

    @field_validator("value_maps")
    @classmethod
    def _maps(cls, v: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
        for field, mapping in v.items():
            if not _FIELD.match(field):
                raise ValueError(f"value_maps key must be TABLE.FIELD, got {field!r}")
            if len(mapping) > _MAX_MAP:
                raise ValueError(f"value map for {field} exceeds {_MAX_MAP} entries")
        return v


class SimulationQueued(BaseModel):
    simulation_id: str
    job_id: str
    status: str


@router.post("", status_code=202, response_model=SimulationQueued,
             dependencies=[Depends(require_permission("analyse"))])
async def create_simulation(body: SimulationRequest, db: AsyncSession = Depends(get_db),
                            tenant: Tenant = Depends(get_tenant)) -> SimulationQueued:
    from workers.tasks.run_simulation import run_simulation

    if not (body.value_maps or body.rule_fixes or body.batch_ids or body.all_rule_fixes):
        raise HTTPException(status_code=422, detail="Give at least one value map, rule fix or batch.")
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant.id)})
    row = (await db.execute(text("SELECT metadata->>'dataset_path', metadata->>'system_id', label "
                                 "FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                            {"v": body.version_id, "t": tenant.id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    if not row[0]:
        raise HTTPException(status_code=409, detail="This version has no stored dataset to simulate on.")
    sid = str(uuid.uuid4())
    jobs.start_job(str(tenant.id), sid, "simulation", f"Fix simulation{f' · {row[2]}' if row[2] else ''}",
                   status="queued", version_id=str(body.version_id), system_id=row[1])
    run_simulation.delay(str(tenant.id), sid, str(body.version_id), body.model_dump(mode="json"))
    return SimulationQueued(simulation_id=sid, job_id=sid, status="queued")


@router.get("/{simulation_id}", dependencies=[Depends(require_permission("view"))])
async def get_simulation(simulation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant)) -> dict:
    """The stored result; while running, the job's progress; 404 once expired."""
    from workers.tasks.run_simulation import result_key

    client = _redis_client()
    raw = client.get(result_key(str(tenant.id), str(simulation_id))) if client is not None else None
    if raw:
        return json.loads(raw)
    job = jobs.get_job(str(tenant.id), str(simulation_id))
    if job and job.get("kind") == "simulation":
        return {"simulation_id": str(simulation_id), "status": job["status"], "job": job}
    raise HTTPException(status_code=404, detail="Simulation not found or expired")
