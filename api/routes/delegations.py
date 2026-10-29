"""Out of office: delegations (migration 104, api/services/delegation.py).

GET    /api/v1/delegations/mine     {away: [...], covering: [...]}: the caller's own delegations and the ones they
                                    cover, with state (scheduled, active, ended, revoked); what the banners read
GET    /api/v1/delegations          every delegation of the tenant (manage_users)
POST   /api/v1/delegations          {to_user_id, starts_on, ends_on, reason?, from_user_id?}: from_user_id defaults to
                                    the caller; setting someone else's needs manage_users
DELETE /api/v1/delegations/{id}     revoke (the person away, the delegate's administrator, or a user administrator)

The delegate must be an active user of the tenant and, when the person away may approve, may approve too: a delegation
never hands approvals to someone who cannot give them. Two delegations of one person may not overlap. Audited.
"""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import delegation
from api.services.rbac import (
    _get_user_role,
    active_users_holding_sync,
    current_user_id,
    has_permission,
    require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1/delegations", tags=["delegations"], dependencies=[Depends(require_permission("view"))])

_COLS = ("d.id::text AS id, d.from_user_id::text AS from_user_id, d.to_user_id::text AS to_user_id, d.starts_on, "
         "d.ends_on, d.reason, d.created_by, d.created_at, d.revoked_at, COALESCE(f.name, f.email) AS from_name, "
         "COALESCE(t.name, t.email) AS to_name")
_FROM = "FROM delegations d JOIN users f ON f.id = d.from_user_id JOIN users t ON t.id = d.to_user_id"


class DelegationIn(BaseModel):
    to_user_id: uuid.UUID
    starts_on: date
    ends_on: date
    reason: str | None = Field(None, max_length=500)
    from_user_id: uuid.UUID | None = None


def _out(r, today: date) -> dict:
    d = dict(r)
    return {**d, "starts_on": d["starts_on"].isoformat(), "ends_on": d["ends_on"].isoformat(),
            "state": delegation.state_of(d, today)}


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)})
    return str(tenant.id)


@router.get("/mine")
async def mine(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    me = current_user_id(request)
    if not me:
        return {"away": [], "covering": []}
    t = await _rls(db, tenant)
    today = delegation.utc_today()
    rows = (await db.execute(text(f"SELECT {_COLS} {_FROM} WHERE d.tenant_id = CAST(:t AS uuid) "
                                  "AND (d.from_user_id = CAST(:u AS uuid) OR d.to_user_id = CAST(:u AS uuid)) "
                                  "AND d.revoked_at IS NULL AND d.ends_on >= CAST(:today AS date) ORDER BY d.starts_on"),
                            {"t": t, "u": me, "today": today})).mappings().all()
    out = [_out(r, today) for r in rows]
    return {"away": [d for d in out if d["from_user_id"] == me], "covering": [d for d in out if d["to_user_id"] == me]}


@router.get("", dependencies=[Depends(require_permission("manage_users"))])
async def all_delegations(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    t = await _rls(db, tenant)
    today = delegation.utc_today()
    rows = (await db.execute(text(f"SELECT {_COLS} {_FROM} WHERE d.tenant_id = CAST(:t AS uuid) "
                                  "ORDER BY d.starts_on DESC LIMIT 500"), {"t": t})).mappings().all()
    return {"delegations": [_out(r, today) for r in rows]}


@router.post("", status_code=201)
async def create(body: DelegationIn, request: Request, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant)):
    me = current_user_id(request)
    if not me:
        raise HTTPException(status_code=401, detail="Sign in to set an out-of-office delegation.")
    who = str(body.from_user_id or me)
    role = await _get_user_role(tenant, db, request)
    if who != me and not has_permission(role, "manage_users"):
        raise HTTPException(status_code=403, detail="Only a user administrator sets out of office for someone else.")
    if body.ends_on < body.starts_on:
        raise HTTPException(status_code=422, detail="The last day comes before the first.")
    if body.ends_on < delegation.utc_today():
        raise HTTPException(status_code=422, detail="Those dates are in the past.")
    if str(body.to_user_id) == who:
        raise HTTPException(status_code=422, detail="Choose someone else to cover.")
    t = await _rls(db, tenant)
    to = str(body.to_user_id)
    held = await db.run_sync(lambda s: active_users_holding_sync(s, t, [who, to], "approve"))
    exists = (await db.execute(text("SELECT count(*) FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
                                    "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": t, "ids": [who, to]})).scalar()
    if exists != 2:
        raise HTTPException(status_code=404, detail="Both people must be active users of this tenant.")
    if who in held and to not in held:
        raise HTTPException(status_code=422, detail="The person covering cannot approve, so approvals would stall. "
                                                    "Choose someone who may approve.")
    overlap = (await db.execute(text("SELECT 1 FROM delegations WHERE tenant_id = CAST(:t AS uuid) "
                                     "AND from_user_id = CAST(:u AS uuid) AND revoked_at IS NULL "
                                     "AND starts_on <= :e AND ends_on >= :s LIMIT 1"),
                                {"t": t, "u": who, "s": body.starts_on, "e": body.ends_on})).scalar()
    if overlap:
        raise HTTPException(status_code=409, detail="An out-of-office delegation already covers some of those days.")
    row = (await db.execute(text("""
        INSERT INTO delegations (tenant_id, from_user_id, to_user_id, starts_on, ends_on, reason, created_by)
        VALUES (CAST(:t AS uuid), CAST(:f AS uuid), CAST(:to AS uuid), :s, :e, :r, :by) RETURNING id::text"""),
        {"t": t, "f": who, "to": to, "s": body.starts_on, "e": body.ends_on, "r": body.reason, "by": me})).scalar()
    await write_audit(db, tenant.id, request, "delegation.create", "delegation", row, None,
                      {"from": who, "to": to, "starts_on": body.starts_on.isoformat(), "ends_on": body.ends_on.isoformat()})
    await db.commit()
    got = (await db.execute(text(f"SELECT {_COLS} {_FROM} WHERE d.id = CAST(:i AS uuid) AND d.tenant_id = CAST(:t AS uuid)"),
                            {"i": row, "t": t})).mappings().one()
    return _out(got, delegation.utc_today())


@router.delete("/{delegation_id}", status_code=204)
async def revoke(delegation_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                 tenant: Tenant = Depends(get_tenant)):
    me = current_user_id(request)
    t = await _rls(db, tenant)
    row = (await db.execute(text("SELECT from_user_id::text, to_user_id::text FROM delegations WHERE id = :i "
                                 "AND tenant_id = CAST(:t AS uuid) AND revoked_at IS NULL"),
                            {"i": delegation_id, "t": t})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Delegation not found")
    if me not in (row[0], row[1]) and not has_permission(await _get_user_role(tenant, db, request), "manage_users"):
        raise HTTPException(status_code=403, detail="Only the two people involved or a user administrator can end it.")
    await db.execute(text("UPDATE delegations SET revoked_at = now() WHERE id = :i AND tenant_id = CAST(:t AS uuid)"),
                     {"i": delegation_id, "t": t})
    await write_audit(db, tenant.id, request, "delegation.revoke", "delegation", str(delegation_id), None, None)
    await db.commit()
    return Response(status_code=204)
