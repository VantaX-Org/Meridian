"""AI-assisted rule authoring: describe a rule, get validated YAML, dry-run it, save a draft.

Drafts land in ai_proposed_rules with status 'draft' (domain ``dq_rule:<module>``)
for the rule lifecycle to promote; nothing here changes the shipped rule files.
"""

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.record_issues import _row, _rls
from api.services import rule_authoring as ra
from api.services.rbac import current_user_label, require_permission

router = APIRouter(prefix="/api/v1/rule-authoring", tags=["rule-authoring"])

_DONE = "status NOT IN ('pending', 'queued', 'running', 'failed')"


class Describe(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=5, max_length=2000)
    system_id: Optional[uuid.UUID] = None


class RuleIn(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    rule_yaml: str = Field(min_length=1, max_length=20_000)
    system_id: Optional[uuid.UUID] = None
    rationale: Optional[str] = Field(None, max_length=2000)


async def _latest(db: AsyncSession, tenant: Tenant, module: str, system_id) -> Optional[tuple]:
    await _rls(db, tenant)
    return (await db.execute(text(f"""
        SELECT id, metadata FROM analysis_versions
         WHERE tenant_id = :tid AND {_DONE} AND metadata->'modules' @> to_jsonb(CAST(:m AS text))
           AND (CAST(:sid AS text) IS NULL OR metadata->>'system_id' = CAST(:sid AS text))
         ORDER BY run_at DESC LIMIT 1"""),
        {"tid": str(tenant.id), "m": module, "sid": str(system_id) if system_id else None})).fetchone()


async def _dictionary(db: AsyncSession, meta: Optional[dict]):
    from api.services.source_design import dictionary_for
    sid = (meta or {}).get("system_id")
    return await db.run_sync(lambda s: dictionary_for(s, sid))


async def _validated(db, tenant, body: RuleIn):
    latest = await _latest(db, tenant, body.module, body.system_id)
    d = await _dictionary(db, latest[1] if latest else None)
    rule, errors = ra.validate_rule_yaml(body.rule_yaml, body.module, d)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})
    return rule, latest, d


@router.post("/generate")
async def generate(
    body: Describe,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("manage_rules")),
):
    """Plain English to rule YAML. The LLM gets field metadata and aggregate profile stats only."""
    from llm.provider import AI_UNAVAILABLE_MSG, is_llm_disabled
    if is_llm_disabled():
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_MSG)
    latest = await _latest(db, tenant, body.module, body.system_id)
    profiles = {}
    if latest:
        rows = await db.execute(text("SELECT table_name, field, stats FROM field_profiles "
                                     "WHERE version_id = :v AND module = :m"), {"v": latest[0], "m": body.module})
        profiles = {f"{r.table_name}.{r.field}": r.stats for r in rows.fetchall()}
    d = await _dictionary(db, latest[1] if latest else None)
    ctx = ra.prompt_context(body.module, profiles, d)
    if not ctx["fields"]:
        raise HTTPException(status_code=400, detail=f"No fields known for module {body.module}.")
    out = await run_in_threadpool(ra.generate, str(tenant.id), body.description, ctx)
    if out is None:
        raise HTTPException(status_code=503, detail=AI_UNAVAILABLE_MSG)
    rule, errors = ra.validate_rule_yaml(out, body.module, d)
    return {"rule_yaml": out, "rule": rule, "valid": not errors, "errors": errors}


@router.post("/dry-run")
async def dry_run(
    body: RuleIn,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("manage_rules")),
):
    """Run the rule against the module's latest extraction. Computed locally; sample values masked."""
    rule, latest, d = await _validated(db, tenant, body)
    if not latest or not (latest[1] or {}).get("dataset_path"):
        raise HTTPException(status_code=404, detail="No extraction of this module to test against.")
    from workers.dataset import load_dataset
    from checks.runner import rule_columns
    try:
        # ponytail: loads the dataset per request; cache frames per version if authors iterate a lot
        frames = (await run_in_threadpool(load_dataset, latest[1]["dataset_path"], d, [body.module],
                                          set(rule_columns(rule))))[0]
    except Exception:
        raise HTTPException(status_code=404, detail="The latest extraction could not be read.")
    return {"version_id": str(latest[0]), **(await run_in_threadpool(ra.dry_run, rule, frames))}


@router.post("/drafts")
async def save_draft(
    body: RuleIn,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("manage_rules")),
):
    rule, _, _ = await _validated(db, tenant, body)
    row = (await db.execute(text("""
        INSERT INTO ai_proposed_rules (tenant_id, domain, proposed_rule, rationale, status)
        VALUES (:tid, :domain, CAST(:rule AS jsonb), :why, 'draft') RETURNING id
    """), {"tid": str(tenant.id), "domain": f"dq_rule:{body.module}", "rule": json.dumps(rule, default=str),
           "why": body.rationale or f"AI-assisted draft by {current_user_label()}"})).fetchone()
    await db.commit()
    return {"id": str(row[0]), "status": "draft", "rule": rule}


@router.get("/drafts")
async def list_drafts(
    module: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("manage_rules")),
):
    await _rls(db, tenant)
    rows = await db.execute(text(
        "SELECT id, domain, proposed_rule, rationale, status, created_at FROM ai_proposed_rules "
        "WHERE tenant_id = :tid AND domain LIKE 'dq_rule:%' AND (CAST(:d AS text) IS NULL OR domain = CAST(:d AS text)) "
        "ORDER BY created_at DESC"), {"tid": str(tenant.id), "d": f"dq_rule:{module}" if module else None})
    return {"items": [_row(r) for r in rows.fetchall()]}
