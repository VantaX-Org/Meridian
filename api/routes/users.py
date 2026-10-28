"""User management API routes — RBAC user CRUD and the invite / reset / bulk / import lifecycle.

Every route here needs manage_users, every change writes an audit row (rbac.write_audit), and every change
to someone's access keeps the existing guards: not yourself, only users whose roles sit under your own
permissions (roles.guard_user_access_change), never the last active admin (forbid_last_admin). Links (invite,
password reset) go only to these callers and are never logged or audited.
"""

import csv
import io
import logging
import re
import uuid
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.licence import seats_for
from api.routes.roles import (
    LAST_ADMIN_DETAIL, LEGACY_GRANT_DETAIL, _custom_role, enforce_ceiling, guard_user_access_change,
    insert_grant, lock_admin_rows, resolve_caller,
)
from api.services.local_auth import INVITE_TTL_DAYS, create_invite_token, create_password_reset_token
from api.services.rbac import (
    BUILTIN_NAMES, LEGACY_ROLES, PERSONA_ALIAS, VALID_ROLES, Scope, require_permission,
    strongest_role, write_audit,
)
from workers.tasks.send_password_reset import send_password_reset_email
from workers.tasks.send_user_invitation import _resolve_app_base_url, send_invitation_email

log = logging.getLogger("meridian.users")

router = APIRouter(prefix="/api/v1", tags=["users"])

ROLE_VIA_GRANTS_DETAIL = "Roles are given as grants under Roles and access"
NOT_INVITED_DETAIL = "This user has already set a password"
NO_PASSWORD_DETAIL = "This user has not set a password yet. Resend the invite instead."
IMPORT_MAX_ROWS = 500
IMPORT_MAX_BYTES = 256 * 1024
BULK_MAX_IDS = 200
RESET_LINK_MINUTES = 24 * 60  # a link handed over by an admin; the emailed one keeps the 1-hour default

UserStatus = Literal["invited", "invite_expired", "active", "locked", "suspended"]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


def user_status(row: Mapping[str, Any], now: Optional[datetime] = None) -> UserStatus:
    """The one derived status of a user (mirrored for display in frontend lib/users.ts).

    suspended   is_active is false (wins over everything: a suspended user cannot sign in or accept an invite)
    locked      locked_until is in the future (too many failed sign-ins)
    invited     no password yet and the invite has not run out
    invite_expired  no password yet and invite_expires_at has passed (rows from before 096 count their 7 days
                from created_at, the life of the token)
    active      everything else; `must_change_password` is a separate flag on it.
    Needs the keys is_active, has_password, locked_until, invite_expires_at, created_at."""
    now = now or datetime.now(timezone.utc)
    if not row["is_active"]:
        return "suspended"
    if row["locked_until"] and row["locked_until"] > now:
        return "locked"
    if not row["has_password"]:
        expires = row["invite_expires_at"] or (row["created_at"] + timedelta(days=INVITE_TTL_DAYS))
        return "invite_expired" if expires <= now else "invited"
    return "active"


class UpdateUserBody(BaseModel):
    # Accepted only to answer 422: users.role is derived from grants (rbac.recompute_users_role).
    role: Optional[str] = None
    is_active: Optional[bool] = None


class InviteGrant(BaseModel):
    role_key: str
    system_id: Optional[uuid.UUID] = None
    module: Optional[str] = None


class InviteUserBody(BaseModel):
    email: str
    name: str = ""
    # Shorthand for one unscoped grant of this role, used only when `grants` is empty.
    role: str = "analyst"
    # Scoped grants. When given, `role` is ignored. users.role (the tenant-wide value every legacy guard
    # reads) is then derived from the unscoped grants, else viewer, so a scoped grant never widens.
    grants: list[InviteGrant] = Field(default_factory=list)


class ResetPasswordBody(BaseModel):
    # True: queue the reset email. False: return a one-time link for the admin to hand over.
    send_email: bool = True


class BulkBody(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=BULK_MAX_IDS)
    action: Literal["suspend", "reactivate", "resend", "reset"]


class ImportBody(BaseModel):
    csv: str = Field(max_length=IMPORT_MAX_BYTES)


# Role keys that carry tenant administration (manage_users, manage_system): the legacy admin and
# its persona alias. A user holds it through users.role or an unscoped grant.
ADMIN_ROLES: tuple[str, ...] = ("admin", next(k for k, v in PERSONA_ALIAS.items() if v == "admin"))

_IS_ADMIN_SQL = (
    "(u.role = ANY(:admin_roles) OR EXISTS (SELECT 1 FROM user_role_scopes g WHERE g.tenant_id = u.tenant_id "
    "AND g.user_id = u.id AND g.system_id IS NULL AND g.module IS NULL AND g.role_key = ANY(:admin_roles) "
    "AND (g.expires_at IS NULL OR g.expires_at > now())))"
)


async def _is_active_admin(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    row = (await db.execute(text(
        f"SELECT 1 FROM users u WHERE u.id = :uid AND u.tenant_id = :tid AND u.is_active AND {_IS_ADMIN_SQL}"),
        {"uid": str(user_id), "tid": str(tenant_id), "admin_roles": list(ADMIN_ROLES)})).fetchone()
    return row is not None


async def forbid_last_admin(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """409 when `user_id` is an active admin and no other active admin is left in the tenant:
    demoting, deactivating or removing them would leave nobody able to manage users. The admin rows are
    locked first, so a concurrent change to another admin cannot pass the same check (lock_admin_rows)."""
    await lock_admin_rows(db, tenant_id)
    if not await _is_active_admin(db, tenant_id, user_id):
        return
    others = (await db.execute(text(
        f"SELECT count(*) FROM users u WHERE u.tenant_id = :tid AND u.id <> :uid AND u.is_active AND {_IS_ADMIN_SQL}"),
        {"uid": str(user_id), "tid": str(tenant_id), "admin_roles": list(ADMIN_ROLES)})).scalar()
    if not others:
        raise HTTPException(status_code=409, detail=LAST_ADMIN_DETAIL)


async def require_seats(db: AsyncSession, tenant: Tenant, needed: int = 1) -> None:
    """409 when `needed` more active users would not fit the licence's seats (invited users hold a seat)."""
    used, limit = await seats_for(db, tenant)
    if limit is not None and used + needed > limit:
        raise HTTPException(
            status_code=409,
            detail=f"Licence seats are full ({used} of {limit}). Suspend a user or raise the licence.")


# ── GET /api/v1/users ────────────────────────────────────────────────────────

_USER_COLUMNS = (
    "u.id, u.tenant_id, u.email, u.name, u.role, u.permissions, u.is_active, u.last_login, u.created_at, "
    "u.must_change_password, u.invited_at, u.invite_sent_at, u.invite_status, u.invite_expires_at, "
    "u.locked_until, u.password_changed_at, (u.password_hash IS NOT NULL) AS has_password"
)


def _user_view(row: Mapping[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in row.items() if k != "has_password"}
    out["status"] = user_status(row)
    return out


async def _grants_by_user(db: AsyncSession, tenant_id: uuid.UUID,
                          user_id: Optional[uuid.UUID] = None) -> dict[str, list[dict[str, Any]]]:
    """Each user's grants (role names and scope names resolved), expired ones flagged, not hidden."""
    rows = await db.execute(
        text("""
            SELECT g.user_id, g.id, g.role_key, r.name, g.system_id, s.name, g.module, g.expires_at,
                   (g.expires_at IS NOT NULL AND g.expires_at <= now()) AS expired
            FROM user_role_scopes g
            LEFT JOIN roles r ON r.tenant_id = g.tenant_id AND r.key = g.role_key
            LEFT JOIN sap_systems s ON s.tenant_id = g.tenant_id AND s.id = g.system_id
            WHERE g.tenant_id = :tid AND (CAST(:uid AS uuid) IS NULL OR g.user_id = CAST(:uid AS uuid))
            ORDER BY g.created_at, g.role_key
        """),
        {"tid": str(tenant_id), "uid": str(user_id) if user_id else None},
    )
    by_user: dict[str, list[dict[str, Any]]] = {}
    for uid, gid, key, custom_name, sid, sname, module, expires_at, expired in rows.fetchall():
        by_user.setdefault(str(uid), []).append({
            "id": str(gid), "role_key": key, "role_name": custom_name or BUILTIN_NAMES.get(key, key),
            "system_id": str(sid) if sid else None, "system_name": sname, "module": module,
            "expires_at": expires_at.isoformat() if expires_at else None, "expired": bool(expired),
        })
    return by_user


@router.get("/users/assignable", dependencies=[Depends(require_permission("assign"))])
async def assignable_users(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Active users work can be assigned to (id, name, email, role) — no admin rights needed."""
    await _set_rls(db, tenant.id)
    rows = await db.execute(text("SELECT id, name, email, role FROM users WHERE tenant_id = :tid AND is_active "
                                 "ORDER BY name, email"), {"tid": str(tenant.id)})
    return [{"id": str(r[0]), "name": r[1], "email": r[2], "role": r[3]} for r in rows.fetchall()]


@router.get("/users", dependencies=[Depends(require_permission("manage_users"))])
async def list_users(
    q: Optional[str] = Query(default=None, max_length=200),
    status: Optional[UserStatus] = None,
    role: Optional[str] = Query(default=None, max_length=120),
    system_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Users with their derived `status` and grants. Filters (all optional, all together):
    q (email or name contains), status, role (users.role or an unexpired grant of that role key) and
    system_id (an unexpired grant scoped to that system)."""
    await _set_rls(db, tenant.id)
    where = ["u.tenant_id = :tid"]
    params: dict[str, Any] = {"tid": str(tenant.id)}
    if q and q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where.append("(u.email ILIKE :q OR u.name ILIKE :q)")
        params["q"] = f"%{escaped}%"
    grant = ("EXISTS (SELECT 1 FROM user_role_scopes g WHERE g.tenant_id = u.tenant_id AND g.user_id = u.id "
             "AND (g.expires_at IS NULL OR g.expires_at > now()) AND ")
    if role:
        where.append(f"(u.role = :role OR {grant}g.role_key = :role))")
        params["role"] = role
    if system_id:
        where.append(f"{grant}g.system_id = CAST(:sid AS uuid))")
        params["sid"] = str(system_id)

    result = await db.execute(
        text(f"SELECT {_USER_COLUMNS} FROM users u WHERE {' AND '.join(where)} ORDER BY u.created_at ASC"), params)
    rows = [_row_to_dict(r) for r in result.fetchall()]
    now = datetime.now(timezone.utc)
    users = [_user_view(r) for r in rows if status is None or user_status(r, now) == status]

    by_user = await _grants_by_user(db, tenant.id)
    for u in users:
        u["grants"] = by_user.get(str(u["id"]), [])
    return {"users": users}


@router.get("/users/{user_id}", dependencies=[Depends(require_permission("manage_users"))])
async def get_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """One user with the derived `status`, the invite and lockout fields, and grants."""
    await _set_rls(db, tenant.id)
    row = (await db.execute(
        text(f"SELECT {_USER_COLUMNS} FROM users u WHERE u.id = :uid AND u.tenant_id = :tid"),
        {"uid": str(user_id), "tid": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    out = _user_view(_row_to_dict(row))
    out["grants"] = (await _grants_by_user(db, tenant.id, user_id)).get(str(user_id), [])
    return out


# ── PUT /api/v1/users/{id} ──────────────────────────────────────────────────


async def set_user_active(db: AsyncSession, tenant: Tenant, request: Request, user_id: uuid.UUID,
                          active: bool) -> bool:
    """Suspend or reactivate one user under every guard; commits. False when the user does not exist.

    Suspending ends every session (token_version + 1: LocalAuthMiddleware rejects tokens issued below
    it) and is refused for yourself, a user above your own permissions and the last active admin.
    Reactivating needs a free licence seat and clears any lockout."""
    await guard_user_access_change(db, tenant, request, user_id)
    if not active:
        await forbid_last_admin(db, tenant.id, user_id)
    else:
        await require_seats(db, tenant)
    sets = ["is_active = :is_active"]
    sets += ["token_version = token_version + 1"] if not active else ["failed_login_count = 0", "locked_until = NULL"]
    result = await db.execute(
        text(f"UPDATE users SET {', '.join(sets)} WHERE id = :uid AND tenant_id = :tid RETURNING id"),
        {"uid": str(user_id), "tid": str(tenant.id), "is_active": active})
    if not result.fetchone():
        return False
    await write_audit(db, tenant.id, request, "user.reactivate" if active else "user.suspend", "user",
                      str(user_id), {"is_active": not active}, {"is_active": active})
    await db.commit()
    if not active:
        from api.middleware.local_auth import forget_token_version

        forget_token_version(str(user_id))
    return True


@router.put("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    if body.role is not None:
        # users.role is derived from the user's grants; it is never set directly.
        raise HTTPException(status_code=422, detail=ROLE_VIA_GRANTS_DETAIL)
    if body.is_active is None:
        raise HTTPException(status_code=400, detail="No fields to update")

    await _set_rls(db, tenant.id)
    if not await set_user_active(db, tenant, request, user_id, body.is_active):
        raise HTTPException(status_code=404, detail="User not found")

    # Return updated user
    row = await db.execute(
        text("SELECT id, email, name, role, is_active, last_login, created_at FROM users WHERE id = :uid AND tenant_id = :tid"),
        {"uid": str(user_id), "tid": str(tenant.id)},
    )
    return _row_to_dict(row.fetchone())


# ── Invites ──────────────────────────────────────────────────────────────────


def invite_grants(body: InviteUserBody) -> list[InviteGrant]:
    """The grants an invite creates: `grants`, or one unscoped grant of `role` when none are given."""
    return list(body.grants) or [InviteGrant(role_key=body.role)]


def invite_users_role(body: InviteUserBody) -> str:
    """users.role for an invite: the strongest unscoped built-in grant, else viewer (rbac.strongest_role),
    the same value recompute_users_role derives once the grants are in.

    users.role always counts tenant-wide (rbac.require_permission checks it before any grant), so it
    may only follow an *unscoped* grant. An invite whose grants are all scoped (a steward for one
    system) keeps users.role at viewer: storing the scoped role there would widen it to every system.
    users.role also stays a built-in key (legacy guards read it directly): a custom grant is still
    granted, and users.role falls back to viewer.
    """
    return strongest_role(g.role_key for g in invite_grants(body) if g.system_id is None and g.module is None)


async def _mint_invite_token(db: AsyncSession, tenant: Tenant, user_id: str) -> str:
    """A fresh invite JWT (7 days, INVITE_TTL_DAYS) for the user, or "" when the tenant has no jwt_secret
    yet (legacy bootstrap edge-case: the email then links to /sign-in)."""
    row = (await db.execute(text("SELECT jwt_secret FROM tenants WHERE id = :tid"), {"tid": str(tenant.id)})).fetchone()
    return create_invite_token(user_id, str(tenant.id), row[0]) if row and row[0] else ""


def _accept_url(token: str) -> str:
    return f"{_resolve_app_base_url()}/accept-invite?token={token}"


async def _queue_invite_email(db: AsyncSession, tenant: Tenant, user_id: str, email: str, name: str, role: str,
                              token: str) -> None:
    """Hand the invitation to the worker (which writes invite_status sent|failed). A queue failure is not
    an error for the caller: it is recorded as failed so Admin › Users shows it and can resend."""
    try:
        send_invitation_email.delay(user_id=user_id, tenant_id=str(tenant.id), recipient_email=email,
                                    recipient_name=name, role=role, invite_token=token)
    except Exception as e:  # noqa: BLE001 — the user exists either way
        log.error("Failed to queue invitation email: %s", type(e).__name__)
        await db.execute(text("UPDATE users SET invite_status = 'failed' WHERE id = :u AND tenant_id = :t"),
                         {"u": user_id, "t": str(tenant.id)})
        await db.commit()


async def create_invited_user(db: AsyncSession, tenant: Tenant, request: Request, body: InviteUserBody) -> dict[str, Any]:
    """Seat check, insert the user and its grants, audit, commit and queue the email. Shared by
    POST /users/invite and the CSV import. Raises HTTPException (nothing is left half-created)."""
    # Roles come only from grants: insert_grant refuses legacy keys (422) and re-derives users.role.
    grants = invite_grants(body)
    role = invite_users_role(body)

    # Emails are case-insensitive by convention everywhere else in the auth
    # flow (login, forgot-password) — normalise on write so every row is
    # consistently lowercase, and reject a case-variant duplicate explicitly
    # rather than letting a mismatched-case invite silently create a second
    # account for the same address.
    email = body.email.strip().lower()
    existing = await db.execute(
        text("SELECT id FROM users WHERE LOWER(email) = LOWER(:email) AND tenant_id = :tid"),
        {"email": email, "tid": str(tenant.id)},
    )
    if existing.fetchone():
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    await require_seats(db, tenant)

    new_id = str(uuid.uuid4())
    name = body.name or email.split("@")[0]
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, email, name, role, is_active, created_at,
                               invited_at, invite_sent_at, invite_status, invite_expires_at)
            VALUES (:id, :tid, :email, :name, :role, true, now(),
                    now(), now(), 'queued', now() + make_interval(days => :days))
        """),
        {"id": new_id, "tid": str(tenant.id), "email": email, "name": name, "role": role, "days": INVITE_TTL_DAYS},
    )
    # insert_grant validates each role key (built-in or custom) and system; a bad one aborts the invite.
    try:
        for g in grants:
            await insert_grant(db, tenant, request, new_id, g.role_key, g.system_id, g.module)
        await write_audit(db, tenant.id, request, "user.invite", "user", new_id, None,
                          {"email": email, "role": role, "grants": [g.model_dump(mode="json") for g in grants]})
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()

    # The invite acceptance token: a signed JWT the user redeems on /accept-invite to set a first password.
    token = ""
    try:
        token = await _mint_invite_token(db, tenant, new_id)
    except Exception as e:  # noqa: BLE001
        log.warning("Could not mint invite token: %s", type(e).__name__)
    await _queue_invite_email(db, tenant, new_id, email, name, role, token)
    return {"id": new_id, "email": email, "role": role, "status": "invited"}


@router.post("/users/invite", status_code=200)
async def invite_user(
    body: InviteUserBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    await _set_rls(db, tenant.id)
    out = await create_invited_user(db, tenant, request, body)
    return {**out, "email": body.email}


async def _pending_invite(db: AsyncSession, tenant: Tenant, user_id: uuid.UUID) -> Any:
    """(id, email, name, role) of an active user who has not set a password yet; 404 / 409 otherwise."""
    row = (await db.execute(
        text("SELECT id, email, name, role, is_active, (password_hash IS NOT NULL) FROM users "
             "WHERE id = :uid AND tenant_id = :tid"),
        {"uid": str(user_id), "tid": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if row[5]:
        raise HTTPException(status_code=409, detail=NOT_INVITED_DETAIL)
    if not row[4]:
        raise HTTPException(status_code=409, detail="This user is suspended. Reactivate them first.")
    return row


async def _renew_invite(db: AsyncSession, tenant: Tenant, user_id: uuid.UUID, *, queued: bool) -> tuple[str, datetime]:
    """Mint a new token and move invite_expires_at to match its 7 days. `queued` also marks the invite
    queued (a resend); a copied link leaves the delivery status alone. Caller audits and commits."""
    token = await _mint_invite_token(db, tenant, str(user_id))
    expires = (await db.execute(
        text("UPDATE users SET invite_expires_at = now() + make_interval(days => :days)"
             + (", invite_status = 'queued', invite_sent_at = now()" if queued else "")
             + " WHERE id = :uid AND tenant_id = :tid RETURNING invite_expires_at"),
        {"days": INVITE_TTL_DAYS, "uid": str(user_id), "tid": str(tenant.id)})).scalar_one()
    return token, expires


async def resend_invite(db: AsyncSession, tenant: Tenant, request: Request, user_id: uuid.UUID) -> dict[str, Any]:
    """New token, new 7 days, status queued, email re-queued; commits."""
    row = await _pending_invite(db, tenant, user_id)
    token, expires = await _renew_invite(db, tenant, user_id, queued=True)
    await write_audit(db, tenant.id, request, "user.invite_resend", "user", str(user_id), None,
                      {"email": row[1], "invite_expires_at": expires.isoformat()})
    await db.commit()
    await _queue_invite_email(db, tenant, str(user_id), row[1], row[2] or row[1].split("@")[0], row[3], token)
    return {"id": str(user_id), "invite_status": "queued", "invite_expires_at": expires.isoformat()}


@router.post("/users/{user_id}/invite/resend")
async def resend_user_invite(user_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                             tenant: Tenant = Depends(get_tenant),
                             _role: str = Depends(require_permission("manage_users"))):
    await _set_rls(db, tenant.id)
    return await resend_invite(db, tenant, request, user_id)


@router.post("/users/{user_id}/invite/link")
async def invite_link(user_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant),
                      _role: str = Depends(require_permission("manage_users"))):
    """The accept-invite URL, for an admin to hand over. Mints a fresh 7-day token (and moves
    invite_expires_at to match) without emailing. The URL is in this response only; the audit row
    ("user.invite_link_copied") records that it was taken, not the link."""
    await _set_rls(db, tenant.id)
    row = await _pending_invite(db, tenant, user_id)
    token, expires = await _renew_invite(db, tenant, user_id, queued=False)
    if not token:
        raise HTTPException(status_code=503, detail="Sign-in is not configured yet. Sign in once as an admin first.")
    await write_audit(db, tenant.id, request, "user.invite_link_copied", "user", str(user_id), None,
                      {"email": row[1], "invite_expires_at": expires.isoformat()})
    await db.commit()
    return {"id": str(user_id), "url": _accept_url(token), "expires_at": expires.isoformat()}


# ── Password reset ───────────────────────────────────────────────────────────


async def reset_user_password(db: AsyncSession, tenant: Tenant, request: Request, user_id: uuid.UUID,
                              send_email: bool) -> dict[str, Any]:
    """Force a password change: must_change_password, every session revoked (token_version + 1), any lockout
    cleared, and either the reset email queued or a one-time link returned. Not yourself; not a user above
    your own permissions. The link carries the new token_version, so it works once. Commits."""
    await guard_user_access_change(db, tenant, request, user_id)
    row = (await db.execute(
        text("SELECT email, name, is_active, (password_hash IS NOT NULL) FROM users WHERE id = :u AND tenant_id = :t"),
        {"u": str(user_id), "t": str(tenant.id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if not row[2]:
        raise HTTPException(status_code=409, detail="This user is suspended. Reactivate them first.")
    if not row[3]:
        raise HTTPException(status_code=409, detail=NO_PASSWORD_DETAIL)
    secret = (await db.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).scalar()
    if not secret:
        raise HTTPException(status_code=503, detail="Sign-in is not configured yet. Sign in once as an admin first.")
    version = (await db.execute(
        text("UPDATE users SET must_change_password = true, token_version = token_version + 1, "
             "failed_login_count = 0, locked_until = NULL WHERE id = :u AND tenant_id = :t RETURNING token_version"),
        {"u": str(user_id), "t": str(tenant.id)})).scalar_one()
    await write_audit(db, tenant.id, request, "user.password_reset", "user", str(user_id), None,
                      {"email": row[0], "send_email": send_email})
    await db.commit()
    from api.middleware.local_auth import forget_token_version

    forget_token_version(str(user_id))

    out: dict[str, Any] = {"id": str(user_id), "must_change_password": True, "emailed": False, "link": None}
    if send_email:
        token = create_password_reset_token(str(user_id), str(tenant.id), secret, token_version=int(version))
        try:
            send_password_reset_email.delay(user_id=str(user_id), tenant_id=str(tenant.id), recipient_email=row[0],
                                            recipient_name=row[1] or row[0].split("@")[0], reset_token=token)
            out["emailed"] = True
        except Exception as e:  # noqa: BLE001
            log.error("Could not queue password reset email: %s", type(e).__name__)
    else:
        token = create_password_reset_token(str(user_id), str(tenant.id), secret, ttl_minutes=RESET_LINK_MINUTES,
                                            token_version=int(version))
        out["link"] = f"{_resolve_app_base_url()}/reset-password?token={token}"
    return out


@router.post("/users/{user_id}/reset-password")
async def reset_password_route(user_id: uuid.UUID, body: ResetPasswordBody, request: Request,
                               db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                               _role: str = Depends(require_permission("manage_users"))):
    await _set_rls(db, tenant.id)
    return await reset_user_password(db, tenant, request, user_id, body.send_email)


# ── Bulk ─────────────────────────────────────────────────────────────────────


@router.post("/users/bulk")
async def bulk_users(body: BulkBody, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant), _role: str = Depends(require_permission("manage_users"))):
    """suspend | reactivate | resend | reset over many users, each under the guards of its single route
    (not yourself, nobody above your own permissions, never the last admin, a free seat to reactivate).
    One user failing does not stop the rest: every id gets a result; each success is committed and audited
    on its own. `reset` emails the reset link (a bulk call never returns links)."""
    await _set_rls(db, tenant.id)
    results: list[dict[str, Any]] = []
    for uid in dict.fromkeys(body.ids):
        try:
            if body.action in ("suspend", "reactivate"):
                if not await set_user_active(db, tenant, request, uid, body.action == "reactivate"):
                    raise HTTPException(status_code=404, detail="User not found")
            elif body.action == "resend":
                await resend_invite(db, tenant, request, uid)
            else:
                await reset_user_password(db, tenant, request, uid, send_email=True)
            results.append({"id": str(uid), "ok": True, "error": None})
        except HTTPException as e:
            await db.rollback()
            await _set_rls(db, tenant.id)
            detail = e.detail if isinstance(e.detail, str) else "Not permitted"
            results.append({"id": str(uid), "ok": False, "error": detail})
    ok = sum(1 for r in results if r["ok"])
    return {"action": body.action, "results": results, "succeeded": ok, "failed": len(results) - ok}


# ── CSV import ───────────────────────────────────────────────────────────────

_IMPORT_COLUMNS = ("email", "name", "role", "system", "module")


async def _preview_rows(db: AsyncSession, tenant: Tenant, request: Request, raw: str) -> dict[str, Any]:
    """Validate a CSV (header email,name,role,system,module) row by row; writes nothing."""
    try:
        reader = csv.DictReader(io.StringIO(raw.lstrip("﻿")))
        reader.fieldnames = [(f or "").strip().lower() for f in (reader.fieldnames or [])]
        records = list(reader)
    except csv.Error:
        raise HTTPException(status_code=422, detail="The file is not valid CSV")
    if "email" not in (reader.fieldnames or []):
        raise HTTPException(status_code=422, detail="The first row must be a header with at least: email")
    if len(records) > IMPORT_MAX_ROWS:
        raise HTTPException(status_code=422, detail=f"Import at most {IMPORT_MAX_ROWS} users at a time")

    tid = str(tenant.id)
    have = {r[0] for r in (await db.execute(text("SELECT LOWER(email) FROM users WHERE tenant_id = :t"), {"t": tid})).fetchall()}
    systems: dict[str, list[tuple[str, str]]] = {}
    for sid, sname in (await db.execute(text("SELECT id, name FROM sap_systems WHERE tenant_id = :t"), {"t": tid})).fetchall():
        systems.setdefault(sname.strip().lower(), []).append((str(sid), sname))
        systems.setdefault(str(sid), []).append((str(sid), sname))
    custom_names = {n.strip().lower(): k for k, n in (await db.execute(
        text("SELECT key, name FROM roles WHERE tenant_id = :t"), {"t": tid})).fetchall()}
    by_name = {n.lower(): k for k, n in BUILTIN_NAMES.items()}
    caller = await resolve_caller(db, tenant, request, Scope())

    seen: dict[str, int] = {}
    rows: list[dict[str, Any]] = []
    for i, rec in enumerate(records, start=2):  # line 1 is the header
        cell = {c: (rec.get(c) or "").strip() for c in _IMPORT_COLUMNS}
        email = cell["email"].lower()
        row: dict[str, Any] = {"line": i, "email": email, "name": cell["name"] or email.split("@")[0],
                               "role": None, "system_id": None, "system_name": None,
                               "module": cell["module"] or None, "ok": False, "error": None}
        rows.append(row)
        if not _EMAIL.match(email):
            row["error"] = "Not a valid email address"
            continue
        if email in seen:
            row["error"] = f"Duplicate of line {seen[email]}"
            continue
        seen[email] = i
        if email in have:
            row["error"] = "A user with this email already exists"
            continue
        key = (cell["role"] or "viewer").strip()
        key = key if key in VALID_ROLES or key.startswith("custom:") else \
            by_name.get(key.lower()) or custom_names.get(key.lower()) or key.lower()
        if key in LEGACY_ROLES:
            row["error"] = LEGACY_GRANT_DETAIL
            continue
        if key not in VALID_ROLES and not await _custom_role(db, tenant.id, key):
            row["error"] = f"Unknown role: {cell['role']}"
            continue
        row["role"] = key
        sys_id: Optional[uuid.UUID] = None
        if cell["system"]:
            hits = systems.get(cell["system"].lower(), [])
            if len(hits) != 1:
                row["error"] = f"System not found: {cell['system']}" if not hits else \
                    f"More than one system is called {cell['system']}. Use its id."
                continue
            sys_id = uuid.UUID(hits[0][0])
            row["system_id"], row["system_name"] = hits[0]
        try:  # the same ceiling insert_grant applies at commit: no row the caller could not grant by hand
            at = caller if sys_id is None and not row["module"] else await resolve_caller(
                db, tenant, request, Scope(sys_id, row["module"]))
            await enforce_ceiling(db, tenant.id, at, key)
        except HTTPException as e:
            row["error"] = e.detail if isinstance(e.detail, str) else "Not permitted"
            continue
        row["ok"] = True
    used, limit = await seats_for(db, tenant)
    needed = sum(1 for r in rows if r["ok"])
    seats = {"used": used, "limit": limit, "needed": needed,
             "available": None if limit is None else max(limit - used, 0),
             "ok": limit is None or used + needed <= limit}
    return {"rows": rows, "accepted": needed, "rejected": len(rows) - needed, "seats": seats}


@router.post("/users/import/preview")
async def import_preview(body: ImportBody, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant),
                         _role: str = Depends(require_permission("manage_users"))):
    """Per-line verdicts for a CSV (email,name,role,system,module) and the seat check; writes nothing.
    `role` is a role key or name (blank = viewer); `system` a system name or id (blank = all systems)."""
    await _set_rls(db, tenant.id)
    return await _preview_rows(db, tenant, request, body.csv)


@router.post("/users/import")
async def import_users(body: ImportBody, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant),
                       _role: str = Depends(require_permission("manage_users"))):
    """Invite every row the preview accepts (the CSV is validated again here, never trusted from the
    preview). 409 with the seat message, creating nobody, when the accepted rows would not fit the licence.
    A row that fails at commit (a race) is reported in `skipped`; the others still go through."""
    await _set_rls(db, tenant.id)
    preview = await _preview_rows(db, tenant, request, body.csv)
    seats = preview["seats"]
    if not seats["ok"]:
        raise HTTPException(
            status_code=409,
            detail=f"Licence seats are full ({seats['used']} of {seats['limit']}). Suspend a user or raise the licence.")
    created: list[dict[str, Any]] = []
    skipped = [{"line": r["line"], "email": r["email"], "error": r["error"]} for r in preview["rows"] if not r["ok"]]
    for r in (r for r in preview["rows"] if r["ok"]):
        grant = InviteGrant(role_key=r["role"], system_id=uuid.UUID(r["system_id"]) if r["system_id"] else None,
                            module=r["module"])
        try:
            out = await create_invited_user(db, tenant, request,
                                            InviteUserBody(email=r["email"], name=r["name"], grants=[grant]))
            created.append({"line": r["line"], "id": out["id"], "email": out["email"]})
        except HTTPException as e:
            await db.rollback()
            await _set_rls(db, tenant.id)
            skipped.append({"line": r["line"], "email": r["email"],
                            "error": e.detail if isinstance(e.detail, str) else "Not permitted"})
    await write_audit(db, tenant.id, request, "user.import", "user", "import", None,
                      {"created": len(created), "skipped": len(skipped)})
    await db.commit()
    return {"created": created, "skipped": skipped}


# ── DELETE /api/v1/users/{id} ───────────────────────────────────────────────


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    """Hard-delete a user from this tenant. For a user who never set a password this is revoking the
    invite (nothing references them yet, so it always succeeds).

    Returns 409 if the user is referenced by other rows (audit log, findings,
    etc.) — the operator should deactivate via PUT /users/{id} in that case.
    """
    from sqlalchemy.exc import IntegrityError

    await _set_rls(db, tenant.id)
    await guard_user_access_change(db, tenant, request, user_id)
    await forbid_last_admin(db, tenant.id, user_id)

    try:
        before = (await db.execute(
            text("SELECT email, (password_hash IS NULL) FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": str(user_id), "tid": str(tenant.id)})).fetchone()
        result = await db.execute(
            text(
                "DELETE FROM users WHERE id = :uid AND tenant_id = :tid "
                "RETURNING id"
            ),
            {"uid": str(user_id), "tid": str(tenant.id)},
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        revoked = bool(before and before[1])
        await write_audit(db, tenant.id, request, "user.invite_revoke" if revoked else "user.delete", "user",
                          str(user_id), {"email": before[0] if before else None}, None)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                "User is referenced by other records (audit, findings, etc.) "
                "and cannot be hard-deleted. Deactivate instead."
            ),
        )

    return {"id": str(user_id), "status": "deleted"}
