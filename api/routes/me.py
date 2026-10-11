"""Current-user permissions and access requests (RBAC wave 13)."""

import uuid
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import (
    ACTIONS, RESOURCES, EffectivePermissions, _get_user_role, actions_for, current_user_id,
    dev_role_override, effective_permissions, has_permission, require_permission, resource_matrix, write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["rbac"])


@router.get("/me/permissions")
async def my_permissions(
    request: Request,
    system_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> EffectivePermissions:
    """Resolved permissions of the signed-in user; ?system_id=&module= narrows to grants covering it."""
    uid = current_user_id(request)
    if not uid and not dev_role_override(request):
        raise HTTPException(status_code=401, detail="Authentication required")
    role = await _get_user_role(tenant, db, request)
    return await effective_permissions(db, tenant.id, uid, role, system_id, module,
                                       narrowed=system_id is not None or module is not None)


class AccessRequestBody(BaseModel):
    resource: str
    action: str
    system_id: Optional[uuid.UUID] = None
    module: Optional[str] = None
    reason: Optional[str] = Field(default=None, max_length=2000)


class DecideBody(BaseModel):
    decision: Literal["granted", "declined"]
    reason: Optional[str] = Field(default=None, max_length=2000)
    role_key: Optional[str] = None  # when granting: also create this grant at the request's scope


_COLS = "id, user_id, resource, action, system_id, module, reason, status, decided_by, decided_at, created_at"


class AccessRequestOut(BaseModel):
    id: str
    user_id: str
    resource: str
    action: str
    system_id: Optional[str] = None
    module: Optional[str] = None
    reason: Optional[str] = None
    status: str
    decided_by: Optional[str] = None
    decided_at: Optional[str] = None
    created_at: str


def _iso(v: Optional[datetime]) -> Optional[str]:
    return v.isoformat() if v else None


def _str(v: Optional[uuid.UUID]) -> Optional[str]:
    return str(v) if v else None


def _row(r: Row) -> AccessRequestOut:
    m = r._mapping
    return AccessRequestOut(
        id=str(m["id"]), user_id=str(m["user_id"]), resource=m["resource"], action=m["action"],
        system_id=_str(m["system_id"]), module=m["module"], reason=m["reason"], status=m["status"],
        decided_by=_str(m["decided_by"]), decided_at=_iso(m["decided_at"]), created_at=m["created_at"].isoformat())


@router.post("/access-requests", status_code=201, dependencies=[Depends(require_permission("view"))])
async def create_access_request(
    body: AccessRequestBody, request: Request,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
) -> AccessRequestOut:
    if body.resource not in RESOURCES or body.action not in ACTIONS:
        raise HTTPException(status_code=422, detail="Unknown resource or action")
    uid = current_user_id(request)
    if not uid:
        raise HTTPException(status_code=403, detail="Authentication required")
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant.id)}'"))
    row = await db.execute(
        text(f"INSERT INTO access_requests (tenant_id, user_id, resource, action, system_id, module, reason) "
             f"VALUES (:t, :u, :r, :a, :s, :m, :why) RETURNING {_COLS}"),
        {"t": str(tenant.id), "u": uid, "r": body.resource, "a": body.action,
         "s": str(body.system_id) if body.system_id else None, "m": body.module, "why": body.reason},
    )
    out = _row(row.fetchone())
    await write_audit(db, tenant.id, request, "access_request.create", "access_request", out.id, None,
                      out.model_dump())
    await db.commit()
    return out


@router.get("/access-requests", dependencies=[Depends(require_permission("view"))])
async def list_access_requests(
    request: Request, status: Optional[Literal["open", "granted", "declined"]] = None,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
) -> list[AccessRequestOut]:
    """Admins (manage_users) see every request; everyone else only their own."""
    role = await _get_user_role(tenant, db, request)
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant.id)}'"))
    where, params = "tenant_id = :t", {"t": str(tenant.id)}
    if not has_permission(role, "manage_users"):
        where += " AND user_id = :u"
        uid = current_user_id(request)
        if not uid:
            return []
        params["u"] = uid
    if status:
        where += " AND status = :st"
        params["st"] = status
    rows = await db.execute(text(f"SELECT {_COLS} FROM access_requests WHERE {where} ORDER BY created_at DESC"),
                            params)
    return [_row(r) for r in rows.fetchall()]


@router.post("/access-requests/{request_id}/decide", dependencies=[Depends(require_permission("manage_users"))])
async def decide_access_request(
    request_id: uuid.UUID, body: DecideBody, request: Request,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
) -> AccessRequestOut:
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant.id)}'"))
    cur = await db.execute(
        text(f"SELECT {_COLS} FROM access_requests WHERE id = :i AND tenant_id = :t FOR UPDATE"),
        {"i": str(request_id), "t": str(tenant.id)})
    before_row = cur.fetchone()
    if not before_row:
        raise HTTPException(status_code=404, detail="Access request not found")
    before = _row(before_row)
    if before.status != "open":
        raise HTTPException(status_code=409, detail="Already decided")
    actor = current_user_id(request)
    if actor and actor == before.user_id:
        raise HTTPException(status_code=403, detail="You cannot decide your own access request")
    if body.decision == "granted" and body.role_key:
        # The role must confer what was asked for; insert_grant then applies the caller ceiling.
        if not resource_matrix(await actions_for(body.role_key, tenant.id, db)).get(before.resource, {}).get(
                before.action):
            raise HTTPException(status_code=422,
                                detail=f"{body.role_key} does not grant {before.action} on {before.resource}")
        from api.routes.roles import insert_grant  # local: avoids an import cycle with roles
        await insert_grant(db, tenant, request, before.user_id, body.role_key,
                           uuid.UUID(before.system_id) if before.system_id else None, before.module)
    row = await db.execute(
        text(f"UPDATE access_requests SET status = :st, decided_by = :d, decided_at = now(), "
             f"reason = COALESCE(:why, reason) WHERE id = :i AND tenant_id = :t RETURNING {_COLS}"),
        {"st": body.decision, "d": actor, "why": body.reason, "i": str(request_id), "t": str(tenant.id)})
    after = _row(row.fetchone())
    await write_audit(db, tenant.id, request, "access_request.decide", "access_request",
                      str(request_id), before.model_dump(), after.model_dump())
    await db.commit()
    return after
