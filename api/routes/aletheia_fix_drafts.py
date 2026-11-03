"""Aletheia verified fixes: draft, list, approve and reject AI-drafted ``auto_fix`` specs.

A draft is verified in-process (api/services/fix_drafter.py) and stored as a pending tenant setting. It does nothing
until a steward approves it; approval is audited, and ``checks.overrides`` then merges the steps onto the rule.
Reads need ``view``; every write needs ``manage_rules``.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _rls
from api.routes.rule_authoring import _dictionary, _latest
from api.services import fix_drafter as fd
from api.services.rbac import current_user_id, require_permission, write_audit

router = APIRouter(prefix="/api/v1/aletheia/fix-drafts", tags=["aletheia"])


class DraftIn(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    rule_id: str = Field(min_length=1, max_length=64)
    system_id: Optional[str] = None
    use_llm: bool = True


class DecisionIn(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)


class MaskCount(BaseModel):
    mask: str
    count: int


class LengthCount(BaseModel):
    length: int
    count: int


class Shape(BaseModel):
    total_failing: int
    blank: int
    masks: list[MaskCount]
    other_masks: int
    lengths: list[LengthCount]
    case: dict[str, int]
    leading_ws: int
    trailing_ws: int
    inner_ws: int
    legend: dict[str, str]


class Verification(BaseModel):
    failing: int
    fixed: int
    rejected: int
    still_failing: int
    touched_passing: int
    broken: int


class FixDraft(BaseModel):
    rule_id: str
    module: Optional[str] = None
    field: str
    rule_text: Optional[str] = None
    field_text: Optional[str] = None
    status: str  # pending | approved | rejected | none
    source: Optional[str] = None  # llm | deterministic
    steps: list[dict[str, Any]]
    confidence: Optional[str] = None
    shape: Shape
    verification: Optional[Verification] = None
    errors: list[str] = []
    llm_tried: bool = False
    drafted_at: Optional[str] = None
    decided_at: Optional[str] = None
    decided_by: Optional[str] = None
    note: Optional[str] = None


class FixDraftList(BaseModel):
    drafts: list[FixDraft]


class ModuleCoverage(BaseModel):
    module: str
    rules: int
    with_fix: int


class Coverage(BaseModel):
    modules: list[ModuleCoverage]


@router.get("/coverage", response_model=Coverage, dependencies=[Depends(require_permission("view"))])
async def coverage():
    """Rules per module and how many carry an auto_fix: the fix-coverage chart."""
    return {"modules": await run_in_threadpool(fd.coverage)}


@router.get("", response_model=FixDraftList, dependencies=[Depends(require_permission("view"))])
async def list_drafts(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    return {"drafts": await fd.list_all(db, tenant.id)}


@router.post("", response_model=FixDraft)
async def create_draft(body: DraftIn, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    """Draft and verify a fix for one rule. Stored as pending when something verifies; never applied."""
    from api.routes.mining import field_text
    from api.services.remediation import _rule_frame, module_rules
    rule = module_rules(body.module).get(body.rule_id)
    if not rule or not rule.get("field") or not rule.get("check_class"):
        raise HTTPException(status_code=404, detail="Unknown rule.")
    if "auto_fix" in rule or "fix_value" in rule:
        raise HTTPException(status_code=409, detail="This rule already has a fix.")
    await _rls(db, tenant)
    latest = await _latest(db, tenant, body.module, body.system_id)
    meta = (latest[1] or {}) if latest else {}
    if not meta.get("dataset_path"):
        raise HTTPException(status_code=409, detail="No extraction to draft against.")
    d = await _dictionary(db, meta)

    def work() -> dict:
        from checks.runner import REGISTRY, rule_columns
        from workers.dataset import load_dataset
        frames = load_dataset(meta["dataset_path"], d, [body.module], set(rule_columns(rule)))[0]
        built = _rule_frame(frames, rule, rule["field"], rule.get("grain"))
        if built is None:
            raise HTTPException(status_code=409, detail="The rule's field is not in the extraction.")
        df = built[0].reset_index(drop=True)
        return fd.draft(rule, df, REGISTRY[rule["check_class"]](rule).evaluate, str(tenant.id),
                        use_llm=body.use_llm, refs=frames.frames)

    doc = await run_in_threadpool(work)
    doc.update(module=body.module, rule_text=rule.get("message"), field_text=field_text(rule["field"], body.module))
    if doc["status"] == "pending":
        await fd.save(db, tenant.id, current_user_id(request), body.rule_id, doc)
        await write_audit(db, tenant.id, request, "fix_draft.create", "rule", body.rule_id, None,
                          {"source": doc["source"], "steps": doc["steps"], "verification": doc["verification"]})
        await db.commit()
    return doc


async def _decide(rule_id: str, status: str, body: DecisionIn, request: Request, db: AsyncSession, tenant: Tenant) -> dict:
    from datetime import datetime, timezone
    await _rls(db, tenant)
    doc = await fd.load(db, tenant.id, rule_id)
    if not doc:
        raise HTTPException(status_code=404, detail="No draft for this rule.")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=409, detail="The draft is already decided.")
    after = {**doc, "status": status, "note": body.note,
             "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "decided_by": str(current_user_id(request) or "")}
    await fd.save(db, tenant.id, current_user_id(request), rule_id, after)
    await write_audit(db, tenant.id, request, f"fix_draft.{status}", "rule", rule_id, {"status": doc["status"]},
                      {"status": status, "steps": doc["steps"], "note": body.note})
    await db.commit()
    return after


@router.post("/{rule_id}/approve", response_model=FixDraft)
async def approve(rule_id: str, body: DecisionIn, request: Request, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    return await _decide(rule_id, "approved", body, request, db, tenant)


@router.post("/{rule_id}/reject", response_model=FixDraft)
async def reject(rule_id: str, body: DecisionIn, request: Request, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant), _perm: str = Depends(require_permission("manage_rules"))):
    return await _decide(rule_id, "rejected", body, request, db, tenant)
