"""SCIM administration (admin only: manage_system, since a SCIM token can provision any mapped role).

* ``GET  /api/v1/admin/scim/token``  whether a token is live, its public prefix and when it was made and last used.
* ``POST /api/v1/admin/scim/token``  ``{"action": "rotate"}`` (the default; also creates the first token) revokes
  any live token and returns a new one, once; ``{"action": "revoke"}`` revokes the live token.
* ``GET  /api/v1/admin/scim/group-roles``  the group displayName -> role map, with each group's member count.
* ``PUT  /api/v1/admin/scim/group-roles``  replace the map; every user in a SCIM group is re-synced at once.

The token is never logged or audited; audit rows carry its prefix only.
"""
from __future__ import annotations

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import (
    BUILTIN_NAMES,
    current_user_id,
    require_permission,
    write_audit,
)
from api.services.scim import new_token, sync_roles, valid_role
from api.services.tenant_settings import set_rls

router = APIRouter(prefix="/api/v1/admin/scim", tags=["scim-admin"],
                   dependencies=[Depends(require_permission("manage_system"))])

MAX_MAPPINGS = 200


class TokenAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["rotate", "revoke"] = "rotate"


class TokenStatus(BaseModel):
    configured: bool
    token_prefix: Optional[str] = None
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None
    base_url: str


class TokenIssued(TokenStatus):
    token: str


class Mapping(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group: str = Field(min_length=1, max_length=256)
    role: str = Field(min_length=1, max_length=120)


class MappingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mappings: list[Mapping] = Field(default_factory=list, max_length=MAX_MAPPINGS)


class MappingOut(BaseModel):
    group: str
    role: str
    role_name: str
    group_exists: bool
    members: int


class MappingsOut(BaseModel):
    mappings: list[MappingOut]
    resynced_users: Optional[int] = None


def _base(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/scim/v2"


async def _status(db: AsyncSession, tenant: Tenant, request: Request) -> TokenStatus:
    row = (await db.execute(text("SELECT token_prefix, created_at, last_used_at FROM scim_tokens "
                                 "WHERE tenant_id = :t AND revoked_at IS NULL"), {"t": str(tenant.id)})).fetchone()
    if not row:
        return TokenStatus(configured=False, base_url=_base(request))
    return TokenStatus(configured=True, token_prefix=f"mscim_{row[0][:8]}...{row[0][-4:]}",
                       created_at=row[1].isoformat(), last_used_at=row[2].isoformat() if row[2] else None,
                       base_url=_base(request))


@router.get("/token")
async def token_status(request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> TokenStatus:
    await set_rls(db, tenant.id)
    return await _status(db, tenant, request)


@router.post("/token", response_model=None)
async def token_action(request: Request, response: Response, body: Optional[TokenAction] = None,
                       db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> TokenIssued | TokenStatus:
    action = (body or TokenAction()).action
    await set_rls(db, tenant.id)
    before = await _status(db, tenant, request)
    revoked = (await db.execute(text("UPDATE scim_tokens SET revoked_at = now() WHERE tenant_id = :t "
                                     "AND revoked_at IS NULL RETURNING token_prefix"), {"t": str(tenant.id)})).fetchall()
    if action == "revoke":
        if not revoked:
            raise HTTPException(status_code=404, detail="There is no SCIM token to revoke")
        await write_audit(db, tenant.id, request, "scim.token.revoke", "scim_token", revoked[0][0][:12],
                          before.model_dump(), {"configured": False})
        await db.commit()
        await set_rls(db, tenant.id)
        return await _status(db, tenant, request)
    token, prefix, digest = new_token(tenant.id)
    me = current_user_id(request)
    by = None
    if me:
        try:
            uuid.UUID(str(me))
            by = me if (await db.execute(text("SELECT 1 FROM users WHERE id = :u AND tenant_id = :t"),
                                         {"u": str(me), "t": str(tenant.id)})).fetchone() else None
        except ValueError:
            by = None
    await db.execute(text("INSERT INTO scim_tokens (tenant_id, token_prefix, token_hash, created_by) "
                          "VALUES (:t, :p, :h, :b)"), {"t": str(tenant.id), "p": prefix, "h": digest, "b": by})
    after = await _status(db, tenant, request)
    await write_audit(db, tenant.id, request, "scim.token.rotate" if revoked else "scim.token.create", "scim_token",
                      prefix[:12], before.model_dump(), after.model_dump())
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return TokenIssued(**after.model_dump(), token=token)


async def _mappings(db: AsyncSession, tenant: Tenant) -> list[MappingOut]:
    rows = (await db.execute(text(
        "SELECT m.display_name, m.role_key, r.name, g.id IS NOT NULL, "
        "       (SELECT count(*) FROM scim_group_members gm WHERE gm.group_id = g.id AND gm.tenant_id = m.tenant_id) "
        "  FROM scim_group_role_map m "
        "  LEFT JOIN scim_groups g ON g.tenant_id = m.tenant_id AND lower(g.display_name) = m.group_key "
        "  LEFT JOIN roles r ON r.tenant_id = m.tenant_id AND r.key = m.role_key "
        " WHERE m.tenant_id = :t ORDER BY m.group_key"), {"t": str(tenant.id)})).fetchall()
    return [MappingOut(group=g, role=k, role_name=n or BUILTIN_NAMES.get(k, k), group_exists=bool(e), members=int(c or 0))
            for g, k, n, e, c in rows]


@router.get("/group-roles")
async def get_group_roles(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> MappingsOut:
    await set_rls(db, tenant.id)
    return MappingsOut(mappings=await _mappings(db, tenant))


@router.put("/group-roles")
async def put_group_roles(body: MappingsIn, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> MappingsOut:
    """Replace the map. One role per group (names compare case-insensitively); roles must exist and not be
    legacy. Every user in any SCIM group, or holding a SCIM-managed role, is re-synced in the same transaction."""
    await set_rls(db, tenant.id)
    seen: dict[str, Mapping] = {}
    for m in body.mappings:
        key = " ".join(m.group.split()).lower()
        if not key:
            raise HTTPException(status_code=422, detail="Name each group")
        if key in seen:
            raise HTTPException(status_code=422, detail=f"The group {m.group} is mapped twice")
        if not await valid_role(db, tenant.id, m.role):
            raise HTTPException(status_code=422, detail=f"Unknown or retired role: {m.role}")
        seen[key] = m
    before = [m.model_dump() for m in await _mappings(db, tenant)]
    await db.execute(text("DELETE FROM scim_group_role_map WHERE tenant_id = :t"), {"t": str(tenant.id)})
    for key, m in seen.items():
        await db.execute(text("INSERT INTO scim_group_role_map (tenant_id, group_key, display_name, role_key) "
                              "VALUES (:t, :k, :n, :r)"),
                         {"t": str(tenant.id), "k": key, "n": " ".join(m.group.split()), "r": m.role})
    users = [str(r[0]) for r in (await db.execute(text(
        "SELECT user_id FROM scim_group_members WHERE tenant_id = :t UNION "
        "SELECT user_id FROM scim_users WHERE tenant_id = :t AND cardinality(managed_roles) > 0"),
        {"t": str(tenant.id)})).fetchall()]
    changes = await sync_roles(db, tenant.id, users)
    after = await _mappings(db, tenant)
    await write_audit(db, tenant.id, request, "scim.group_roles.update", "scim_group_role_map", str(tenant.id),
                      {"mappings": before}, {"mappings": [m.model_dump() for m in after], "role_changes": changes})
    await db.commit()
    return MappingsOut(mappings=after, resynced_users=len(changes))
