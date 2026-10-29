"""Balance work: propose and apply an even spread of open record issues across the people who fix them.

POST /api/v1/people/balance/plan    {by: owner|object|slice, module?, user_ids?} -> the plan (api/services/balance.py):
                                    before and after counts per person and the moves, nothing written
POST /api/v1/people/balance/apply   {by, module?, user_ids?, moves: [{from, to, issue_ids}]} -> {moved, action_id}

``user_ids`` narrows the people to balance between; by default they are the active users who may apply fixes
(the ``apply`` permission). Apply re-checks every issue is still open and still with the person the plan moves it
from (an issue that moved since is skipped and counted), writes an assign event per issue, recomputes the work rows,
and records one undo action: POST /api/v1/actions/undo puts every issue back within ten minutes. Needs ``assign``.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import attention, balance, undo, work_analytics, worklist
from api.services.rbac import active_users_holding_sync, require_permission

router = APIRouter(prefix="/api/v1/people/balance", tags=["people"], dependencies=[Depends(require_permission("assign"))])


class PlanIn(BaseModel):
    # owner: even counts; object: whole objects; slice: the steward the assignment template names per object and slice
    by: Literal["owner", "object", "slice"] = "owner"
    module: str | None = Field(None, max_length=64)
    user_ids: list[uuid.UUID] | None = Field(None, max_length=200)


class MoveIn(BaseModel):
    from_: uuid.UUID | None = Field(None, alias="from")
    to: uuid.UUID
    issue_ids: list[uuid.UUID] = Field(min_length=1, max_length=balance.MAX_MOVES)


class ApplyIn(PlanIn):
    moves: list[MoveIn] = Field(min_length=1, max_length=500)


async def _inputs(db: AsyncSession, tenant: Tenant, body: PlanIn) -> tuple[list[dict], list[str], dict[str, str]]:
    t = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": t})
    users = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT id::text, COALESCE(name, email) FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active"),
        {"t": t})).fetchall()}
    if body.user_ids:
        people = sorted({str(u) for u in body.user_ids} & set(users))
    else:
        people = sorted(await db.run_sync(lambda s: active_users_holding_sync(s, t, list(users), "apply")))
    rows = (await db.execute(text("""
        SELECT id::text AS id, module, record_key, assigned_to::text AS assigned_to FROM record_issues
         WHERE tenant_id = CAST(:t AS uuid) AND status IN ('open', 'in_progress')
           AND (CAST(:m AS text) IS NULL OR module = :m)"""), {"t": t, "m": body.module})).mappings().all()
    return [dict(r) for r in rows], people, users


async def _template_slices(db: AsyncSession, tenant: Tenant) -> tuple[dict, dict]:
    """(module, slice value) -> steward from steward_assignments, and module -> slice kind from the template."""
    from api.routes.stewardship_template import _template

    t = str(tenant.id)
    rows = (await db.execute(text("SELECT module, slice_value, steward_user_id::text FROM steward_assignments "
                                  "WHERE tenant_id = CAST(:t AS uuid) AND steward_user_id IS NOT NULL"), {"t": t})).fetchall()
    tmpl = (await _template(db, t))[0]
    kinds = {m: (o or {}).get("slice", "none") for m, o in (tmpl.get("objects") or {}).items()}
    return {(r[0], r[1]): r[2] for r in rows}, kinds


@router.post("/plan")
async def make_plan(body: PlanIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    items, people, names = await _inputs(db, tenant, body)
    if len(people) < 2:
        raise HTTPException(status_code=422, detail="Balancing needs at least two people who can fix records.")
    if body.by == "slice":
        out = balance.by_template(items, people, *await _template_slices(db, tenant))
    else:
        out = balance.plan(items, people, body.by)
    return {**out, "people": [{"id": p, "name": names.get(p, p)} for p in people]}


@router.post("/apply")
async def apply_plan(body: ApplyIn, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)):
    from api.routes.work import _event

    _items, people, _names = await _inputs(db, tenant, body)
    t = str(tenant.id)
    allowed = set(people)
    rec = undo.Recorder()
    moved, skipped, touched = 0, 0, []
    for m in body.moves:
        to = str(m.to)
        if to not in allowed:
            raise HTTPException(status_code=422, detail="A move hands work to someone outside the people balanced.")
        frm = str(m.from_) if m.from_ else None
        ids = [str(i) for i in m.issue_ids]
        still = [r[0] for r in (await db.execute(text("""
            SELECT id::text FROM record_issues WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))
               AND status IN ('open', 'in_progress') AND assigned_to IS NOT DISTINCT FROM CAST(:f AS uuid)"""),
            {"t": t, "ids": ids, "f": frm})).fetchall()]
        skipped += len(ids) - len(still)
        if not still:
            continue
        await rec.issue_rows(db, tenant, still)
        await db.execute(text("UPDATE record_issues SET assigned_to = CAST(:a AS uuid), assigned_at = now(), updated_at = now() "
                              "WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))"),
                         {"a": to, "t": t, "ids": still})
        await _event(db, tenant, request, still, "assign", frm, to, "Work balanced")
        moved += len(still)
        touched += still
    if touched:
        await db.run_sync(lambda s: worklist.refresh_issues(s, t, touched))
    action_id = await rec.save(db, tenant, request, "balance_work", {"by": body.by, "moved": moved})
    await db.commit()
    attention.invalidate(tenant.id)
    work_analytics.forget(tenant.id)
    return {"moved": moved, "skipped": skipped, "action_id": action_id}
