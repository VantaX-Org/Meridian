"""POST /api/v1/rules/impact-dry-run: the effect of enabling, editing or adding a rule, before a steward does it.

Runs the rule read-only over the object's latest stored extraction (never SAP, nothing written to findings) and
returns records evaluated and failing, the failure rate, the projected object score, the failing values by shape
and, for an edit, the records newly failing and newly passing against the current rule. Service:
api/services/rule_impact.py. Permission: manage_rules, as every other rule edit.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.routes.rule_authoring import _dictionary
from api.services import rule_impact as ri
from api.services import simulate_fix as sf
from api.services.rbac import Scope, require_permission, require_scope

router = APIRouter(prefix="/api/v1/rules", tags=["rules"])


class ImpactBody(BaseModel):
    module: str = Field(min_length=1, max_length=100, description="Object (module id) whose latest extraction is used.")
    system_id: Optional[uuid.UUID] = Field(None, description="SAP system of the extraction; latest anywhere if omitted.")
    run_id: Optional[uuid.UUID] = Field(None, description="Run to read; the latest finished run if omitted.")
    rule_id: Optional[str] = Field(None, max_length=100, description="Existing rule, enabled or not. Omit for a new rule.")
    rule: Optional[dict[str, Any]] = Field(None, description="Draft in the rule schema: the whole rule when rule_id is "
                                           "omitted, else the fields to change on the existing rule.")
    row_cap: int = Field(ri.DEFAULT_ROW_CAP, ge=1000, le=ri.MAX_ROW_CAP, description="Rows evaluated per table.")


class ImpactRowCap(BaseModel):
    cap: int
    sampled: bool
    tables_cut: dict[str, int]  # table -> its full row count, for each table cut to the cap
    note: str


class ImpactSample(BaseModel):
    records_evaluated: int
    records_failing: int


class ImpactShape(BaseModel):
    shape: str
    count: int


class ImpactDqs(BaseModel):
    before: Optional[float] = None
    after: Optional[float] = None
    delta: Optional[float] = None
    breaches_before: list[str]
    breaches_after: list[str]


class ImpactDelta(BaseModel):
    current_failing: int
    newly_failing: int
    newly_passing: int
    unchanged_failing: int
    basis: str


class ImpactOut(BaseModel):
    module: str
    run_id: str
    rule_id: str | int
    mode: str  # new | edit
    rule: dict[str, Any]  # field, message, check_class, severity, dimension (as the draft gave them) and field_text
    evaluated: bool
    reason: Optional[str] = None
    row_cap: ImpactRowCap
    sample: Optional[ImpactSample] = None
    records_evaluated: Optional[int] = None
    records_failing: Optional[int] = None
    failure_rate: Optional[float] = None
    failing_shapes: Optional[list[ImpactShape]] = None
    dqs: Optional[ImpactDqs] = None
    delta: Optional[ImpactDelta] = None


def _load_frames(meta: dict, dictionary, rule: dict):
    from checks.runner import rule_columns
    from workers.dataset import load_dataset
    return load_dataset(meta["dataset_path"], dictionary, [rule["module"]] if rule.get("module") else None,
                        set(rule_columns(rule)))[0]


@router.post("/impact-dry-run", response_model=ImpactOut, response_model_exclude_unset=True, dependencies=[Depends(require_permission("manage_rules"))])
async def impact_dry_run(body: ImpactBody, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)):
    """Read-only impact of a rule on the object's latest extraction. Writes nothing."""
    from checks.lifecycle import shipped_rules

    await _rls(db, tenant)
    await require_scope(request, db, tenant, "manage_rules", Scope(body.system_id, body.module))
    current = None
    if body.rule_id:
        found = shipped_rules().get(body.rule_id)
        if not found:
            raise HTTPException(status_code=404, detail="Unknown rule")
        current = found[0]
        rule = {**current, **(body.rule or {}), "id": body.rule_id}
    elif body.rule:
        rule = {**body.rule}
        if not rule.get("id"):
            raise HTTPException(status_code=422, detail="A new rule needs an id")
    else:
        raise HTTPException(status_code=422, detail="Name a rule_id or give a draft rule")
    run = await sf.load_object_run(db, str(tenant.id), body.module, str(body.run_id) if body.run_id else None,
                                   str(body.system_id) if body.system_id else None)
    if run is None:
        raise HTTPException(status_code=404, detail="No finished run of this object to test against")
    meta = (await db.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                             {"v": run.run_id, "t": str(tenant.id)})).scalar() or {}
    if not meta.get("dataset_path"):
        raise HTTPException(status_code=404, detail="This run has no stored extraction")
    dictionary = await _dictionary(db, meta)
    errors = ri.validate(rule, body.module, dictionary)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})
    try:
        frames = await run_in_threadpool(_load_frames, meta, dictionary, rule)
    except Exception:
        raise HTTPException(status_code=404, detail="The stored extraction could not be read")
    return await run_in_threadpool(ri.dry_run, run, frames, rule, current, body.row_cap)
