"""Roles, custom-role matrices and per-user scoped grants (RBAC wave 13).

Escalation guards (every write path routes through them):
- ceiling: a caller may only grant, clone or define a permission set that is a subset
  of their own effective permissions at that scope (legacy actions AND matrix pairs);
- nobody grants, alters or approves their own access;
- only platform_admin (or its legacy alias admin) may grant platform_admin.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import (
    ACTIONS, BUILTIN_NAMES, PERMISSIONS, PERSONA_ALIAS, PERSONA_ROLES, RESOURCES, VALID_ROLES,
    EffectivePermissions, Scope, _get_user_role, actions_for, current_user_id, dev_role_override,
    effective_actions, effective_permissions, has_permission, legacy_actions_for_pairs, permissions_for,
    require_permission,
    resource_matrix, user_grants, write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["rbac"])

_LEGACY = set(PERMISSIONS) - set(PERSONA_ROLES) - {"analyst", "auditor", "viewer"}
_SLUG = re.compile(r"[^a-z0-9]+")
_PLATFORM_ADMIN = {"platform_admin", PERSONA_ALIAS["platform_admin"]}


class Pair(BaseModel):
    resource: str
    action: str


class CloneRoleBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    cloned_from: str
    description: Optional[str] = None


class UpdateRoleBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None


class PermissionsBody(BaseModel):
    permissions: list[Pair]


class GrantBody(BaseModel):
    role_key: str
    system_id: Optional[uuid.UUID] = None
    module: Optional[str] = None


class RoleOut(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    built_in: bool
    legacy: bool = False
    cloned_from: Optional[str] = None
    updated_at: Optional[str] = None
    users: Optional[int] = None


class RoleDeleted(BaseModel):
    key: str
    status: str


class MatrixOut(BaseModel):
    key: str
    built_in: bool
    matrix: dict[str, dict[str, bool]]


class GrantOut(BaseModel):
    id: str
    role_key: str
    system_id: Optional[str] = None
    module: Optional[str] = None
    user_id: Optional[str] = None
    granted_by: Optional[str] = None
    created_at: Optional[str] = None


class GrantDeleted(BaseModel):
    id: str
    status: str


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant.id)}'"))


def _check_pairs(pairs: list[Pair]) -> set[tuple[str, str]]:
    out = {(p.resource, p.action) for p in pairs}
    bad = [p for p in out if p[0] not in RESOURCES or p[1] not in ACTIONS]
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown resource/action: {sorted(bad)[:3]}")
    return out


def _matrix_pairs(actions: set[str]) -> set[tuple[str, str]]:
    return {(r, a) for r, acts in resource_matrix(actions).items() for a, ok in acts.items() if ok}


async def _custom_role(db: AsyncSession, tenant_id: uuid.UUID, key: str) -> Optional[Row]:
    row = await db.execute(
        text("SELECT id, key, name, description, built_in, cloned_from FROM roles "
             "WHERE tenant_id = :t AND key = :k"), {"t": str(tenant_id), "k": key})
    return row.fetchone()


async def _role_pairs(db: AsyncSession, tenant_id: uuid.UUID, key: str) -> set[tuple[str, str]]:
    if key in VALID_ROLES:
        return _matrix_pairs(set(permissions_for(key)))
    role = await _custom_role(db, tenant_id, key)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    rows = await db.execute(text("SELECT resource, action FROM role_permissions WHERE role_id = :r"),
                            {"r": str(role[0])})
    return {(r[0], r[1]) for r in rows.fetchall()}


# ── Escalation guards ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Caller:
    user_id: Optional[str]
    actions: frozenset[str]
    platform_admin: bool


async def resolve_caller(db: AsyncSession, tenant: Tenant, request: Request, scope: Scope) -> Caller:
    """The acting user's effective legacy actions at `scope` (users.role + covering grants)."""
    role = await _get_user_role(tenant, db, request)
    uid = current_user_id(request)
    grant_uid = None if dev_role_override(request) else uid  # dev header: role only, as require_permission
    keys = {k for k, s in await user_grants(db, tenant.id, grant_uid, role) if s == Scope()}
    actions = await effective_actions(db, tenant.id, grant_uid, role, scope)
    return Caller(uid, frozenset(actions), bool(keys & _PLATFORM_ADMIN))


def _forbid_above(caller: Caller, actions: set[str], pairs: set[tuple[str, str]]) -> None:
    if not (actions <= caller.actions and pairs <= _matrix_pairs(set(caller.actions))):
        raise HTTPException(status_code=403, detail="Exceeds your own permissions")


async def enforce_ceiling(db: AsyncSession, tenant_id: uuid.UUID, caller: Caller, role_key: str) -> None:
    """403 unless `caller` may hand out (or take back) `role_key`."""
    if role_key == "platform_admin" and not caller.platform_admin:
        raise HTTPException(status_code=403, detail="Only a platform admin may grant platform_admin")
    _forbid_above(caller, await actions_for(role_key, tenant_id, db), await _role_pairs(db, tenant_id, role_key))


def forbid_self(caller: Caller, user_id: str) -> None:
    if caller.user_id and caller.user_id == str(user_id):
        raise HTTPException(status_code=403, detail="You cannot change your own access")


async def insert_grant(db: AsyncSession, tenant: Tenant, request: Request, user_id: str, role_key: str,
                       system_id: Optional[uuid.UUID], module: Optional[str]) -> GrantOut:
    """Validate, guard and insert one grant (idempotent); caller commits."""
    if role_key not in VALID_ROLES and not await _custom_role(db, tenant.id, role_key):
        raise HTTPException(status_code=400, detail=f"Invalid role: {role_key}")
    if not (await db.execute(text("SELECT 1 FROM users WHERE id = :u AND tenant_id = :t"),
                             {"u": user_id, "t": str(tenant.id)})).fetchone():
        raise HTTPException(status_code=404, detail="User not found")
    if system_id and not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                                           {"s": str(system_id), "t": str(tenant.id)})).fetchone():
        raise HTTPException(status_code=404, detail="System not found")
    caller = await resolve_caller(db, tenant, request, Scope(system_id, module))
    forbid_self(caller, user_id)
    await enforce_ceiling(db, tenant.id, caller, role_key)
    params = {"t": str(tenant.id), "u": user_id, "k": role_key,
              "s": str(system_id) if system_id else None, "m": module}
    existing = await db.execute(
        text("SELECT id FROM user_role_scopes WHERE tenant_id = :t AND user_id = :u AND role_key = :k "
             "AND system_id IS NOT DISTINCT FROM CAST(:s AS uuid) AND module IS NOT DISTINCT FROM :m"), params)
    row = existing.fetchone()
    if row:
        gid = row[0]
    else:
        ins = await db.execute(
            text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, system_id, module, granted_by) "
                 "VALUES (:t, :u, :k, CAST(:s AS uuid), :m, :g) RETURNING id"), {**params, "g": caller.user_id})
        gid = ins.scalar_one()
    return GrantOut(id=str(gid), user_id=user_id, role_key=role_key, system_id=params["s"], module=module)


# ── Roles ────────────────────────────────────────────────────────────────────


@router.get("/roles", dependencies=[Depends(require_permission("manage_users", resource="users"))])
async def list_roles(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> list[RoleOut]:
    await _rls(db, tenant)
    counts: dict[str, int] = {r[0]: r[1] for r in (await db.execute(
        text("SELECT role_key, COUNT(DISTINCT user_id) FROM user_role_scopes WHERE tenant_id = :t "
             "GROUP BY role_key"), {"t": str(tenant.id)})).fetchall()}
    out = [RoleOut(key=k, name=BUILTIN_NAMES.get(k, k), built_in=True, legacy=k in _LEGACY,
                   users=counts.get(k, 0)) for k in sorted(VALID_ROLES)]
    for r in (await db.execute(
            text("SELECT key, name, description, cloned_from, updated_at FROM roles WHERE tenant_id = :t "
                 "ORDER BY key"), {"t": str(tenant.id)})).fetchall():
        updated: datetime = r[4]
        out.append(RoleOut(key=r[0], name=r[1], description=r[2], built_in=False, cloned_from=r[3],
                           updated_at=updated.isoformat(), users=counts.get(r[0], 0)))
    return out


@router.post("/roles", status_code=201, dependencies=[Depends(require_permission("manage_users"))])
async def clone_role(body: CloneRoleBody, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> RoleOut:
    await _rls(db, tenant)
    slug = _SLUG.sub("-", body.name.lower()).strip("-")
    if not slug:
        raise HTTPException(status_code=422, detail="Name must contain letters or digits")
    key = f"custom:{slug}"
    if key in VALID_ROLES or await _custom_role(db, tenant.id, key):
        raise HTTPException(status_code=409, detail="A role with this key already exists")
    pairs = await _role_pairs(db, tenant.id, body.cloned_from)
    caller = await resolve_caller(db, tenant, request, Scope())
    _forbid_above(caller, await actions_for(body.cloned_from, tenant.id, db), pairs)
    row = await db.execute(
        text("INSERT INTO roles (tenant_id, key, name, description, built_in, cloned_from, created_by) "
             "VALUES (:t, :k, :n, :d, false, :c, :u) RETURNING id"),
        {"t": str(tenant.id), "k": key, "n": body.name, "d": body.description, "c": body.cloned_from,
         "u": caller.user_id})
    rid = row.scalar_one()
    for res, act in sorted(pairs):
        await db.execute(text("INSERT INTO role_permissions (role_id, resource, action) VALUES (:r, :x, :a)"),
                         {"r": str(rid), "x": res, "a": act})
    out = RoleOut(key=key, name=body.name, description=body.description, built_in=False,
                  cloned_from=body.cloned_from)
    await write_audit(db, tenant.id, request, "role.create", "role", key, None,
                      {**out.model_dump(exclude_none=True), "permissions": sorted(map(list, pairs))})
    await db.commit()
    return out


@router.put("/roles/{key}", dependencies=[Depends(require_permission("manage_users"))])
async def update_role(key: str, body: UpdateRoleBody, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> RoleOut:
    await _rls(db, tenant)
    role = await _custom_role(db, tenant.id, key)
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")
    before = {"name": role[2], "description": role[3]}
    after = {"name": body.name or role[2],
             "description": body.description if body.description is not None else role[3]}
    await db.execute(text("UPDATE roles SET name = :n, description = :d, updated_at = now() "
                          "WHERE id = :i AND tenant_id = :t"),
                     {"n": after["name"], "d": after["description"], "i": str(role[0]), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "role.update", "role", key, before, after)
    await db.commit()
    return RoleOut(key=key, name=after["name"], description=after["description"], built_in=False)


@router.delete("/roles/{key}", dependencies=[Depends(require_permission("manage_users"))])
async def delete_role(key: str, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> RoleDeleted:
    await _rls(db, tenant)
    role = await _custom_role(db, tenant.id, key)
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")
    in_use = (await db.execute(
        text("SELECT (SELECT COUNT(*) FROM user_role_scopes WHERE tenant_id = :t AND role_key = :k) + "
             "(SELECT COUNT(*) FROM users WHERE tenant_id = :t AND role = :k)"),
        {"t": str(tenant.id), "k": key})).scalar_one()
    if in_use:
        raise HTTPException(status_code=409, detail="Role is still held by users")
    before = {"name": role[2], "permissions": sorted(map(list, await _role_pairs(db, tenant.id, key)))}
    await db.execute(text("DELETE FROM roles WHERE id = :i AND tenant_id = :t"),
                     {"i": str(role[0]), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "role.delete", "role", key, before, None)
    await db.commit()
    return RoleDeleted(key=key, status="deleted")


def _matrix(pairs: set[tuple[str, str]]) -> dict[str, dict[str, bool]]:
    return {r: {a: (r, a) in pairs for a in ACTIONS} for r in RESOURCES}


@router.get("/roles/{key}/permissions", dependencies=[Depends(require_permission("manage_users"))])
async def get_role_permissions(key: str, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)) -> MatrixOut:
    await _rls(db, tenant)
    return MatrixOut(key=key, built_in=key in VALID_ROLES, matrix=_matrix(await _role_pairs(db, tenant.id, key)))


@router.put("/roles/{key}/permissions", dependencies=[Depends(require_permission("manage_users"))])
async def put_role_permissions(key: str, body: PermissionsBody, request: Request,
                               db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> MatrixOut:
    """Replace a custom role's matrix. Built-ins are read-only (clone first)."""
    await _rls(db, tenant)
    if key in VALID_ROLES:
        raise HTTPException(status_code=409, detail="Built-in roles are read-only; clone to edit")
    role = await _custom_role(db, tenant.id, key)
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")
    new = _check_pairs(body.permissions)
    _forbid_above(await resolve_caller(db, tenant, request, Scope()), legacy_actions_for_pairs(new), new)
    before = await _role_pairs(db, tenant.id, key)
    await db.execute(text("DELETE FROM role_permissions WHERE role_id = :r"), {"r": str(role[0])})
    for res, act in sorted(new):
        await db.execute(text("INSERT INTO role_permissions (role_id, resource, action) VALUES (:r, :x, :a)"),
                         {"r": str(role[0]), "x": res, "a": act})
    await db.execute(text("UPDATE roles SET updated_at = now() WHERE id = :i AND tenant_id = :t"),
                     {"i": str(role[0]), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "role.update", "role", key,
                      {"permissions": sorted(map(list, before))}, {"permissions": sorted(map(list, new))})
    await db.commit()
    return MatrixOut(key=key, built_in=False, matrix=_matrix(new))


# ── Grants ───────────────────────────────────────────────────────────────────


@router.get("/users/{user_id}/grants", dependencies=[Depends(require_permission("manage_users"))])
async def list_grants(user_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> list[GrantOut]:
    await _rls(db, tenant)
    rows = await db.execute(
        text("SELECT id, role_key, system_id, module, granted_by, created_at FROM user_role_scopes "
             "WHERE tenant_id = :t AND user_id = :u ORDER BY created_at"),
        {"t": str(tenant.id), "u": str(user_id)})
    return [GrantOut(id=str(r[0]), role_key=r[1], system_id=str(r[2]) if r[2] else None, module=r[3],
                     granted_by=str(r[4]) if r[4] else None, created_at=r[5].isoformat())
            for r in rows.fetchall()]


@router.post("/users/{user_id}/grants", status_code=201,
             dependencies=[Depends(require_permission("manage_users"))])
async def add_grant(user_id: uuid.UUID, body: GrantBody, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)) -> GrantOut:
    await _rls(db, tenant)
    out = await insert_grant(db, tenant, request, str(user_id), body.role_key, body.system_id, body.module)
    await write_audit(db, tenant.id, request, "grant.create", "user", str(user_id), None, out.model_dump())
    await db.commit()
    return out


@router.delete("/users/{user_id}/grants/{grant_id}", dependencies=[Depends(require_permission("manage_users"))])
async def delete_grant(user_id: uuid.UUID, grant_id: uuid.UUID, request: Request,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> GrantDeleted:
    await _rls(db, tenant)
    found = (await db.execute(
        text("SELECT s.role_key, s.system_id, s.module, u.role FROM user_role_scopes s "
             "JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id "
             "WHERE s.id = :g AND s.user_id = :u AND s.tenant_id = :t"),
        {"g": str(grant_id), "u": str(user_id), "t": str(tenant.id)})).fetchone()
    if not found:
        raise HTTPException(status_code=404, detail="Grant not found")
    key, system_id, module, users_role = found
    caller = await resolve_caller(db, tenant, request, Scope(system_id, module))
    forbid_self(caller, str(user_id))
    if system_id is None and module is None and key == users_role:
        # require_permission reads users.role first, so deleting its mirror would revoke nothing.
        raise HTTPException(status_code=409, detail="This grant mirrors the user's role; change the "
                                                    "user's role field (PUT /users/{id}) instead")
    await enforce_ceiling(db, tenant.id, caller, key)
    await db.execute(text("DELETE FROM user_role_scopes WHERE id = :g AND tenant_id = :t"),
                     {"g": str(grant_id), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "grant.delete", "user", str(user_id),
                      {"role_key": key, "system_id": str(system_id) if system_id else None, "module": module},
                      None)
    await db.commit()
    return GrantDeleted(id=str(grant_id), status="deleted")


@router.get("/users/{user_id}/effective", dependencies=[Depends(require_permission("view"))])
async def user_effective(user_id: uuid.UUID, request: Request, system_id: Optional[uuid.UUID] = None,
                         module: Optional[str] = None, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> EffectivePermissions:
    """Same shape as /me/permissions. manage_users, or the user themself."""
    caller_role = await _get_user_role(tenant, db, request)
    if not has_permission(caller_role, "manage_users") and current_user_id(request) != str(user_id):
        raise HTTPException(status_code=403, detail="Not permitted")
    await _rls(db, tenant)
    row = (await db.execute(text("SELECT role FROM users WHERE id = :u AND tenant_id = :t"),
                            {"u": str(user_id), "t": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return await effective_permissions(db, tenant.id, str(user_id), row[0], system_id, module,
                                       narrowed=system_id is not None or module is not None)
