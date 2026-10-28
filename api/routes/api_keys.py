"""API keys for service accounts (Roles and access, API keys tab).

A key lets a scheduler or script call the API without a browser. It authenticates as a service user (a users row
with no password, marked by the reserved email domain) and so holds exactly that user's grants. Creating a key
creates the service user and its grants through roles.insert_grant, so the same guards apply as for a person:
nothing above the creator's own permissions, no legacy role, no self-grant. On top of that a key can never hold
administrator rights (manage_users or manage_system), so a key cannot mint keys or users.

The full key is returned once, by the create call, and is stored only as a SHA-256 digest. It is never logged or
audited. Every change writes an audit row through rbac.write_audit.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.roles import guard_user_access_change, insert_grant
from api.services.api_keys import (
    IS_SERVICE_EMAIL_SQL, is_service_email, key_status, new_key, service_email,
)
from api.services.rbac import (
    BUILTIN_NAMES, PERSONA_ALIAS, actions_for, current_user_id, recompute_users_role, require_permission,
    write_audit,
)

router = APIRouter(prefix="/api/v1/admin/api-keys", tags=["api-keys"])

NOT_ADMIN_DETAIL = "API keys cannot hold administrator rights. Choose a role without user or platform management."
NO_GRANTS_DETAIL = "Choose at least one role for the key."
_ADMIN_KEYS = {"platform_admin", "admin", *PERSONA_ALIAS.values()}
_ADMIN_ACTIONS = {"manage_users", "manage_system"}
MAX_GRANTS = 20


class KeyGrantIn(BaseModel):
    role_key: str
    system_id: Optional[uuid.UUID] = None
    module: Optional[str] = None


class CreateKeyBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    grants: list[KeyGrantIn] = Field(default_factory=list, max_length=MAX_GRANTS)
    # None: the key never expires.
    expires_at: Optional[datetime] = None
    # Add the key to an existing service account (its grants stay and any new ones are added).
    service_user_id: Optional[uuid.UUID] = None


class KeyGrantOut(BaseModel):
    id: str
    role_key: str
    role_name: str
    system_id: Optional[str] = None
    system_name: Optional[str] = None
    module: Optional[str] = None


class ApiKeyOut(BaseModel):
    id: str
    name: str
    key_prefix: str
    user_id: str
    status: str  # active | expired | revoked | suspended
    grants: list[KeyGrantOut]
    created_by: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: str
    expires_at: Optional[str] = None
    last_used_at: Optional[str] = None
    revoked_at: Optional[str] = None


class ApiKeyCreated(ApiKeyOut):
    # Shown once: only the digest of the secret is stored.
    key: str


class ApiKeyDeleted(BaseModel):
    id: str
    status: str


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant.id)}'"))


def _iso(v: Optional[datetime]) -> Optional[str]:
    return v.isoformat() if v else None


_SELECT = f"""
    SELECT k.id, k.name, k.key_prefix, k.user_id, k.created_by, cb.name AS created_by_name, k.created_at,
           k.expires_at, k.last_used_at, k.revoked_at, u.is_active, u.email
      FROM api_keys k
      JOIN users u ON u.id = k.user_id AND u.tenant_id = k.tenant_id
      LEFT JOIN users cb ON cb.id = k.created_by AND cb.tenant_id = k.tenant_id
     WHERE k.tenant_id = :t"""


async def _grants_of(db: AsyncSession, tenant_id: uuid.UUID, user_ids: list[str]) -> dict[str, list[KeyGrantOut]]:
    if not user_ids:
        return {}
    rows = await db.execute(text("""
        SELECT g.user_id, g.id, g.role_key, r.name, g.system_id, s.name, g.module
          FROM user_role_scopes g
          LEFT JOIN roles r ON r.tenant_id = g.tenant_id AND r.key = g.role_key
          LEFT JOIN sap_systems s ON s.tenant_id = g.tenant_id AND s.id = g.system_id
         WHERE g.tenant_id = :t AND g.user_id = ANY(CAST(:u AS uuid[])) AND (g.expires_at IS NULL OR g.expires_at > now())
         ORDER BY g.created_at, g.role_key"""), {"t": str(tenant_id), "u": user_ids})
    out: dict[str, list[KeyGrantOut]] = {}
    for uid, gid, key, custom, sid, sname, module in rows.fetchall():
        out.setdefault(str(uid), []).append(KeyGrantOut(
            id=str(gid), role_key=key, role_name=custom or BUILTIN_NAMES.get(key, key),
            system_id=str(sid) if sid else None, system_name=sname, module=module))
    return out


def _view(row: Any, grants: dict[str, list[KeyGrantOut]]) -> ApiKeyOut:
    return ApiKeyOut(
        id=str(row.id), name=row.name, key_prefix=row.key_prefix, user_id=str(row.user_id),
        status=key_status(row.revoked_at, row.expires_at, row.is_active),
        grants=grants.get(str(row.user_id), []),
        created_by=str(row.created_by) if row.created_by else None, created_by_name=row.created_by_name,
        created_at=row.created_at.isoformat(), expires_at=_iso(row.expires_at),
        last_used_at=_iso(row.last_used_at), revoked_at=_iso(row.revoked_at))


async def _load(db: AsyncSession, tenant: Tenant, key_id: uuid.UUID) -> Any:
    row = (await db.execute(text(_SELECT + " AND k.id = :k"), {"t": str(tenant.id), "k": str(key_id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="API key not found")
    return row


async def _forbid_admin(db: AsyncSession, tenant: Tenant, role_key: str) -> None:
    """422 for any role that carries administration: a key never manages users, roles or the platform."""
    if role_key in _ADMIN_KEYS or (_ADMIN_ACTIONS & await actions_for(role_key, tenant.id, db)):
        raise HTTPException(status_code=422, detail=NOT_ADMIN_DETAIL)


@router.get("", dependencies=[Depends(require_permission("manage_users", resource="users"))])
async def list_keys(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> list[ApiKeyOut]:
    """Every key, newest first. Never the secret or its digest."""
    await _rls(db, tenant)
    rows = (await db.execute(text(_SELECT + " ORDER BY k.created_at DESC"), {"t": str(tenant.id)})).fetchall()
    grants = await _grants_of(db, tenant.id, sorted({str(r.user_id) for r in rows}))
    return [_view(r, grants) for r in rows]


@router.post("", status_code=201, dependencies=[Depends(require_permission("manage_users"))])
async def create_key(body: CreateKeyBody, request: Request, response: Response, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> ApiKeyCreated:
    """Create a key (and, unless ``service_user_id`` is given, its service account with the chosen grants).
    The response carries the full key; it cannot be retrieved again."""
    await _rls(db, tenant)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name the key")
    expires_at = body.expires_at
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=422, detail="The expiry must be in the future")
    if not body.grants and not body.service_user_id:
        raise HTTPException(status_code=422, detail=NO_GRANTS_DETAIL)
    for g in body.grants:
        await _forbid_admin(db, tenant, g.role_key)

    key, prefix, key_hash = new_key()
    if body.service_user_id:
        user = (await db.execute(text("SELECT id, email FROM users WHERE id = :u AND tenant_id = :t"),
                                 {"u": str(body.service_user_id), "t": str(tenant.id)})).fetchone()
        if not user or not is_service_email(user.email):
            raise HTTPException(status_code=404, detail="Service account not found")
        user_id = str(user.id)
        # Reusing an account hands its existing grants to the new key: they must sit under the creator.
        await guard_user_access_change(db, tenant, request, user.id)
    else:
        user_id = str(uuid.uuid4())
        await db.execute(
            text("INSERT INTO users (id, tenant_id, email, name, role, is_active, must_change_password) "
                 "VALUES (:i, :t, :e, :n, 'viewer', true, false)"),
            {"i": user_id, "t": str(tenant.id), "e": service_email(prefix), "n": name})
    for g in body.grants:
        await insert_grant(db, tenant, request, user_id, g.role_key, g.system_id, g.module)
    await recompute_users_role(db, tenant.id, user_id)

    try:
        key_id = (await db.execute(
            text("INSERT INTO api_keys (tenant_id, user_id, name, key_prefix, key_hash, created_by, expires_at) "
                 "VALUES (:t, :u, :n, :p, :h, :c, :x) RETURNING id"),
            {"t": str(tenant.id), "u": user_id, "n": name, "p": prefix, "h": key_hash,
             "c": current_user_id(request), "x": expires_at})).scalar_one()
    except IntegrityError:  # a 48-bit prefix collision: ask the caller to repeat rather than loop here
        await db.rollback()
        raise HTTPException(status_code=409, detail="Could not create the key. Try again.")
    row = await _load(db, tenant, key_id)
    out = _view(row, await _grants_of(db, tenant.id, [user_id]))
    await write_audit(db, tenant.id, request, "api_key.create", "api_key", str(key_id), None,
                      out.model_dump(exclude={"created_by_name"}))
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return ApiKeyCreated(**out.model_dump(), key=key)


@router.post("/{key_id}/revoke", dependencies=[Depends(require_permission("manage_users"))])
async def revoke_key(key_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> ApiKeyOut:
    """Stop the key working at once. Revoking again changes nothing."""
    await _rls(db, tenant)
    row = await _load(db, tenant, key_id)
    await guard_user_access_change(db, tenant, request, row.user_id)
    if row.revoked_at is None:
        await db.execute(text("UPDATE api_keys SET revoked_at = now() WHERE id = :k AND tenant_id = :t"),
                         {"k": str(key_id), "t": str(tenant.id)})
        await write_audit(db, tenant.id, request, "api_key.revoke", "api_key", str(key_id),
                          {"name": row.name, "key_prefix": row.key_prefix,
                           "status": key_status(None, row.expires_at, row.is_active)},
                          {"name": row.name, "key_prefix": row.key_prefix, "status": "revoked"})
        await db.commit()
        row = await _load(db, tenant, key_id)
    return _view(row, await _grants_of(db, tenant.id, [str(row.user_id)]))


@router.delete("/{key_id}", dependencies=[Depends(require_permission("manage_users"))])
async def delete_key(key_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> ApiKeyDeleted:
    """Remove the key. When it was its service account's last key, the account is suspended and its grants
    are removed, so nothing keeps access that nothing can use."""
    await _rls(db, tenant)
    row = await _load(db, tenant, key_id)
    await guard_user_access_change(db, tenant, request, row.user_id)
    await db.execute(text("DELETE FROM api_keys WHERE id = :k AND tenant_id = :t"),
                     {"k": str(key_id), "t": str(tenant.id)})
    left = (await db.execute(text("SELECT count(*) FROM api_keys WHERE user_id = :u AND tenant_id = :t"),
                             {"u": str(row.user_id), "t": str(tenant.id)})).scalar_one()
    if not left:
        await db.execute(text("DELETE FROM user_role_scopes WHERE user_id = :u AND tenant_id = :t"),
                         {"u": str(row.user_id), "t": str(tenant.id)})
        await db.execute(text(f"UPDATE users SET is_active = false, role = 'viewer', token_version = token_version + 1 "
                              f"WHERE id = :u AND tenant_id = :t AND {IS_SERVICE_EMAIL_SQL.format(col='email')}"),
                         {"u": str(row.user_id), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "api_key.delete", "api_key", str(key_id),
                      {"name": row.name, "key_prefix": row.key_prefix,
                       "status": key_status(row.revoked_at, row.expires_at, row.is_active)}, None)
    await db.commit()
    return ApiKeyDeleted(id=str(key_id), status="deleted")
