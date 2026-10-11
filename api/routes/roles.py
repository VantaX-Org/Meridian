"""Roles, custom-role matrices and per-user scoped grants (RBAC wave 13)."""

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import (
    ACTIONS, BUILTIN_NAMES, PERMISSIONS, PERSONA_ROLES, RESOURCES, VALID_ROLES, _get_user_role,
    current_user_id, effective_permissions, has_permission, permissions_for, require_permission,
    resource_matrix, write_audit,
)

router = APIRouter(prefix="/api/v1", tags=["rbac"])

_LEGACY = set(PERMISSIONS) - set(PERSONA_ROLES) - {"analyst", "auditor", "viewer"}
_SLUG = re.compile(r"[^a-z0-9]+")


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


async def _custom_role(db: AsyncSession, tenant: Tenant, key: str) -> Optional[Row]:
    row = await db.execute(
        text("SELECT id, key, name, description, built_in, cloned_from FROM roles "
             "WHERE tenant_id = :t AND key = :k"), {"t": str(tenant.id), "k": key})
    return row.fetchone()


async def _role_pairs(db: AsyncSession, tenant: Tenant, key: str) -> set[tuple[str, str]]:
    if key in VALID_ROLES:
        return _matrix_pairs(set(permissions_for(key)))
    role = await _custom_role(db, tenant, key)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    rows = await db.execute(text("SELECT resource, action FROM role_permissions WHERE role_id = :r"),
                            {"r": str(role[0])})
    return {(r[0], r[1]) for r in rows.fetchall()}


async def insert_grant(db: AsyncSession, tenant_id: uuid.UUID, user_id: str, role_key: str,
                       system_id: Optional[uuid.UUID], module: Optional[str],
                       granted_by: Optional[str]) -> dict[str, Optional[str]]:
    """Validate and insert one grant (idempotent); caller commits."""
    if role_key not in VALID_ROLES:
        r = await db.execute(text("SELECT 1 FROM roles WHERE tenant_id = :t AND key = :k"),
                             {"t": str(tenant_id), "k": role_key})
        if not r.fetchone():
            raise HTTPException(status_code=400, detail=f"Invalid role: {role_key}")
    if not (await db.execute(text("SELECT 1 FROM users WHERE id = :u AND tenant_id = :t"),
                             {"u": user_id, "t": str(tenant_id)})).fetchone():
        raise HTTPException(status_code=404, detail="User not found")
    if system_id and not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                                           {"s": str(system_id), "t": str(tenant_id)})).fetchone():
        raise HTTPException(status_code=404, detail="System not found")
    params = {"t": str(tenant_id), "u": user_id, "k": role_key,
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
                 "VALUES (:t, :u, :k, CAST(:s AS uuid), :m, :g) RETURNING id"), {**params, "g": granted_by})
        gid = ins.fetchone()[0]
    return {"id": str(gid), "user_id": user_id, "role_key": role_key,
            "system_id": params["s"], "module": module}


# ── Roles ────────────────────────────────────────────────────────────────────


@router.get("/roles", dependencies=[Depends(require_permission("manage_users", resource="users"))])
async def list_roles(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> list[dict]:
    await _rls(db, tenant)
    counts = {r[0]: r[1] for r in (await db.execute(
        text("SELECT role_key, COUNT(DISTINCT user_id) FROM user_role_scopes WHERE tenant_id = :t "
             "GROUP BY role_key"), {"t": str(tenant.id)})).fetchall()}
    out: list[dict] = [{"key": k, "name": BUILTIN_NAMES.get(k, k), "built_in": True, "legacy": k in _LEGACY,
                        "users": counts.get(k, 0)} for k in sorted(VALID_ROLES)]
    for r in (await db.execute(
            text("SELECT key, name, description, cloned_from, updated_at FROM roles WHERE tenant_id = :t "
                 "ORDER BY key"), {"t": str(tenant.id)})).fetchall():
        out.append({"key": r[0], "name": r[1], "description": r[2], "built_in": False, "legacy": False,
                    "cloned_from": r[3], "updated_at": r[4].isoformat(), "users": counts.get(r[0], 0)})
    return out


@router.post("/roles", status_code=201, dependencies=[Depends(require_permission("manage_users"))])
async def clone_role(body: CloneRoleBody, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    slug = _SLUG.sub("-", body.name.lower()).strip("-")
    if not slug:
        raise HTTPException(status_code=422, detail="Name must contain letters or digits")
    key = f"custom:{slug}"
    if key in VALID_ROLES or await _custom_role(db, tenant, key):
        raise HTTPException(status_code=409, detail="A role with this key already exists")
    pairs = await _role_pairs(db, tenant, body.cloned_from)
    row = await db.execute(
        text("INSERT INTO roles (tenant_id, key, name, description, built_in, cloned_from, created_by) "
             "VALUES (:t, :k, :n, :d, false, :c, :u) RETURNING id"),
        {"t": str(tenant.id), "k": key, "n": body.name, "d": body.description, "c": body.cloned_from,
         "u": current_user_id(request)})
    rid = row.fetchone()[0]
    for res, act in sorted(pairs):
        await db.execute(text("INSERT INTO role_permissions (role_id, resource, action) VALUES (:r, :x, :a)"),
                         {"r": str(rid), "x": res, "a": act})
    out = {"key": key, "name": body.name, "description": body.description, "built_in": False,
           "cloned_from": body.cloned_from}
    await write_audit(db, tenant.id, request, "role.create", "role", key, None,
                      {**out, "permissions": sorted(map(list, pairs))})
    await db.commit()
    return out


@router.put("/roles/{key}", dependencies=[Depends(require_permission("manage_users"))])
async def update_role(key: str, body: UpdateRoleBody, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    role = await _custom_role(db, tenant, key)
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
    return {"key": key, **after, "built_in": False}


@router.delete("/roles/{key}", dependencies=[Depends(require_permission("manage_users"))])
async def delete_role(key: str, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    role = await _custom_role(db, tenant, key)
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")
    in_use = (await db.execute(
        text("SELECT (SELECT COUNT(*) FROM user_role_scopes WHERE tenant_id = :t AND role_key = :k) + "
             "(SELECT COUNT(*) FROM users WHERE tenant_id = :t AND role = :k)"),
        {"t": str(tenant.id), "k": key})).scalar_one()
    if in_use:
        raise HTTPException(status_code=409, detail="Role is still held by users")
    before = {"name": role[2], "permissions": sorted(map(list, await _role_pairs(db, tenant, key)))}
    await db.execute(text("DELETE FROM roles WHERE id = :i AND tenant_id = :t"),
                     {"i": str(role[0]), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "role.delete", "role", key, before, None)
    await db.commit()
    return {"key": key, "status": "deleted"}


def _matrix(pairs: set[tuple[str, str]]) -> dict[str, dict[str, bool]]:
    return {r: {a: (r, a) in pairs for a in ACTIONS} for r in RESOURCES}


@router.get("/roles/{key}/permissions", dependencies=[Depends(require_permission("manage_users"))])
async def get_role_permissions(key: str, db: AsyncSession = Depends(get_db),
                               tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    return {"key": key, "built_in": key in VALID_ROLES, "matrix": _matrix(await _role_pairs(db, tenant, key))}


@router.put("/roles/{key}/permissions", dependencies=[Depends(require_permission("manage_users"))])
async def put_role_permissions(key: str, body: PermissionsBody, request: Request,
                               db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """Replace a custom role's matrix. Built-ins are read-only (clone first)."""
    await _rls(db, tenant)
    if key in VALID_ROLES:
        raise HTTPException(status_code=409, detail="Built-in roles are read-only; clone to edit")
    role = await _custom_role(db, tenant, key)
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")
    new = _check_pairs(body.permissions)
    before = await _role_pairs(db, tenant, key)
    await db.execute(text("DELETE FROM role_permissions WHERE role_id = :r"), {"r": str(role[0])})
    for res, act in sorted(new):
        await db.execute(text("INSERT INTO role_permissions (role_id, resource, action) VALUES (:r, :x, :a)"),
                         {"r": str(role[0]), "x": res, "a": act})
    await db.execute(text("UPDATE roles SET updated_at = now() WHERE id = :i AND tenant_id = :t"),
                     {"i": str(role[0]), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "role.update", "role", key,
                      {"permissions": sorted(map(list, before))}, {"permissions": sorted(map(list, new))})
    await db.commit()
    return {"key": key, "built_in": False, "matrix": _matrix(new)}


# ── Grants ───────────────────────────────────────────────────────────────────


@router.get("/users/{user_id}/grants", dependencies=[Depends(require_permission("manage_users"))])
async def list_grants(user_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> list[dict]:
    await _rls(db, tenant)
    rows = await db.execute(
        text("SELECT id, role_key, system_id, module, granted_by, created_at FROM user_role_scopes "
             "WHERE tenant_id = :t AND user_id = :u ORDER BY created_at"),
        {"t": str(tenant.id), "u": str(user_id)})
    return [{"id": str(r[0]), "role_key": r[1], "system_id": str(r[2]) if r[2] else None, "module": r[3],
             "granted_by": str(r[4]) if r[4] else None, "created_at": r[5].isoformat()} for r in rows.fetchall()]


@router.post("/users/{user_id}/grants", status_code=201,
             dependencies=[Depends(require_permission("manage_users"))])
async def add_grant(user_id: uuid.UUID, body: GrantBody, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    out = await insert_grant(db, tenant.id, str(user_id), body.role_key, body.system_id, body.module,
                             current_user_id(request))
    await write_audit(db, tenant.id, request, "grant.create", "user", str(user_id), None, out)
    await db.commit()
    return out


@router.delete("/users/{user_id}/grants/{grant_id}", dependencies=[Depends(require_permission("manage_users"))])
async def delete_grant(user_id: uuid.UUID, grant_id: uuid.UUID, request: Request,
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    row = await db.execute(
        text("DELETE FROM user_role_scopes WHERE id = :g AND user_id = :u AND tenant_id = :t "
             "RETURNING role_key, system_id, module"),
        {"g": str(grant_id), "u": str(user_id), "t": str(tenant.id)})
    gone = row.fetchone()
    if not gone:
        raise HTTPException(status_code=404, detail="Grant not found")
    await write_audit(db, tenant.id, request, "grant.delete", "user", str(user_id),
                      {"role_key": gone[0], "system_id": str(gone[1]) if gone[1] else None, "module": gone[2]},
                      None)
    await db.commit()
    return {"id": str(grant_id), "status": "deleted"}


@router.get("/users/{user_id}/effective", dependencies=[Depends(require_permission("view"))])
async def user_effective(user_id: uuid.UUID, request: Request, system_id: Optional[uuid.UUID] = None,
                         module: Optional[str] = None, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict:
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
