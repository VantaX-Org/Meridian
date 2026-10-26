"""User management API routes — RBAC user CRUD."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.roles import LAST_ADMIN_DETAIL, guard_user_access_change, insert_grant, lock_admin_rows
from api.services.rbac import BUILTIN_NAMES, PERSONA_ALIAS, require_permission, strongest_role, write_audit
from workers.tasks.send_user_invitation import send_invitation_email

router = APIRouter(prefix="/api/v1", tags=["users"])

ROLE_VIA_GRANTS_DETAIL = "Roles are given as grants under Roles and access"


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


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


# Role keys that carry tenant administration (manage_users, manage_system): the legacy admin and
# its persona alias. A user holds it through users.role or an unscoped grant.
ADMIN_ROLES: tuple[str, ...] = ("admin", next(k for k, v in PERSONA_ALIAS.items() if v == "admin"))

_IS_ADMIN_SQL = (
    "(u.role = ANY(:admin_roles) OR EXISTS (SELECT 1 FROM user_role_scopes g WHERE g.tenant_id = u.tenant_id "
    "AND g.user_id = u.id AND g.system_id IS NULL AND g.module IS NULL AND g.role_key = ANY(:admin_roles)))"
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


# ── GET /api/v1/users ────────────────────────────────────────────────────────


@router.get("/users/assignable", dependencies=[Depends(require_permission("assign"))])
async def assignable_users(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """Active users work can be assigned to (id, name, email, role) — no admin rights needed."""
    await _set_rls(db, tenant.id)
    rows = await db.execute(text("SELECT id, name, email, role FROM users WHERE tenant_id = :tid AND is_active "
                                 "ORDER BY name, email"), {"tid": str(tenant.id)})
    return [{"id": str(r[0]), "name": r[1], "email": r[2], "role": r[3]} for r in rows.fetchall()]


@router.get("/users", dependencies=[Depends(require_permission("manage_users"))])
async def list_users(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _set_rls(db, tenant.id)

    result = await db.execute(
        text("""
            SELECT id, tenant_id, email, name, role,
                   permissions, is_active, last_login, created_at, totp_enabled
            FROM users
            WHERE tenant_id = :tid
            ORDER BY created_at ASC
        """),
        {"tid": str(tenant.id)},
    )
    users = [_row_to_dict(r) for r in result.fetchall()]

    # Each user's grants (role names and scope names resolved) so Admin › Users lists them read-only.
    grants = await db.execute(
        text("""
            SELECT g.user_id, g.id, g.role_key, r.name, g.system_id, s.name, g.module
            FROM user_role_scopes g
            LEFT JOIN roles r ON r.tenant_id = g.tenant_id AND r.key = g.role_key
            LEFT JOIN sap_systems s ON s.tenant_id = g.tenant_id AND s.id = g.system_id
            WHERE g.tenant_id = :tid
            ORDER BY g.created_at, g.role_key
        """),
        {"tid": str(tenant.id)},
    )
    by_user: dict[str, list[dict[str, Optional[str]]]] = {}
    for uid, gid, key, custom_name, sid, sname, module in grants.fetchall():
        by_user.setdefault(str(uid), []).append({
            "id": str(gid), "role_key": key, "role_name": custom_name or BUILTIN_NAMES.get(key, key),
            "system_id": str(sid) if sid else None, "system_name": sname, "module": module,
        })
    for u in users:
        u["grants"] = by_user.get(str(u["id"]), [])

    return {"users": users}


# ── PUT /api/v1/users/{id} ──────────────────────────────────────────────────


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

    await _set_rls(db, tenant.id)

    updates = []
    params: dict = {"uid": str(user_id), "tid": str(tenant.id)}

    if body.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = body.is_active
        if body.is_active is False:
            # Deactivation ends every session the user holds: LocalAuthMiddleware rejects tokens
            # issued below the new users.token_version, so reactivation means signing in again.
            updates.append("token_version = token_version + 1")

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    if body.is_active is not None:
        # Deactivating (or reactivating) takes all of a user's access away (or gives it back): not
        # yourself, and only for a user whose every role sits under your own permissions.
        await guard_user_access_change(db, tenant, request, user_id)
        if body.is_active is False:
            await forbid_last_admin(db, tenant.id, user_id)

    set_clause = ", ".join(updates)
    result = await db.execute(
        text(f"UPDATE users SET {set_clause} WHERE id = :uid AND tenant_id = :tid RETURNING id"),
        params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    await db.commit()
    if body.is_active is False:
        from api.middleware.local_auth import forget_token_version

        forget_token_version(str(user_id))

    # Return updated user
    row = await db.execute(
        text("SELECT id, email, name, role, is_active, last_login, created_at FROM users WHERE id = :uid AND tenant_id = :tid"),
        {"uid": str(user_id), "tid": str(tenant.id)},
    )
    return _row_to_dict(row.fetchone())


# ── POST /api/v1/users/invite ───────────────────────────────────────────────


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


@router.post("/users/invite", status_code=200)
async def invite_user(
    body: InviteUserBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    await _set_rls(db, tenant.id)

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

    new_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, email, name, role, is_active, created_at)
            VALUES (:id, :tid, :email, :name, :role, true, now())
        """),
        {
            "id": new_id,
            "tid": str(tenant.id),
            "email": email,
            "name": body.name or email.split("@")[0],
            "role": role,
        },
    )
    # insert_grant validates each role key (built-in or custom) and system; a bad one aborts the invite.
    try:
        for g in grants:
            await insert_grant(db, tenant, request, new_id, g.role_key, g.system_id, g.module)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()

    # Generate the invite acceptance token — a signed JWT the user redeems on
    # the /accept-invite page to set their first password. Same HS256 secret
    # the auth flow uses, with a distinct "purpose" claim. Silently omit if
    # the tenant has no jwt_secret yet (legacy bootstrap edge-case).
    invite_token = ""
    try:
        from api.services.local_auth import create_invite_token

        secret_q = await db.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": str(tenant.id)},
        )
        secret_row = secret_q.fetchone()
        if secret_row and secret_row[0]:
            invite_token = create_invite_token(new_id, str(tenant.id), secret_row[0])
    except Exception as e:
        import logging
        logging.getLogger("meridian.users").warning(
            f"Could not mint invite token for {email}: {e}"
        )

    # Trigger invitation email (async — does not block response)
    try:
        send_invitation_email.delay(
            user_id=new_id,
            tenant_id=str(tenant.id),
            recipient_email=email,
            recipient_name=body.name or email.split("@")[0],
            role=role,
            invite_token=invite_token,
        )
    except Exception as e:
        # Log but don't fail the response if Celery task fails to queue
        import logging
        logging.getLogger("meridian.users").error(f"Failed to queue invitation email: {e}")

    return {"id": new_id, "email": body.email, "role": role, "status": "invited"}


# ── DELETE /api/v1/users/{id} ───────────────────────────────────────────────


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    """Hard-delete a user from this tenant.

    Returns 409 if the user is referenced by other rows (audit log, findings,
    etc.) — the operator should deactivate via PUT /users/{id} in that case.
    """
    from sqlalchemy.exc import IntegrityError

    await _set_rls(db, tenant.id)
    await guard_user_access_change(db, tenant, request, user_id)
    await forbid_last_admin(db, tenant.id, user_id)

    try:
        result = await db.execute(
            text(
                "DELETE FROM users WHERE id = :uid AND tenant_id = :tid "
                "RETURNING id"
            ),
            {"uid": str(user_id), "tid": str(tenant.id)},
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
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


# ── POST /api/v1/users/{id}/2fa/reset ───────────────────────────────────────


@router.post("/users/{user_id}/2fa/reset")
async def reset_two_factor(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    """Clear a user's two-factor sign-in (a lost phone): the secret, the recovery codes, and every session
    they hold (users.token_version). They sign in with the password alone next time, and set it up again
    if the tenant requires it. Not your own (turn it off under Preferences), and only for a user whose
    roles sit under yours, as for deactivation. Writes ``user.2fa_reset``."""
    from api.middleware.local_auth import forget_token_version
    from api.services.two_factor import CLEAR_TWO_FACTOR_SET

    await _set_rls(db, tenant.id)
    await guard_user_access_change(db, tenant, request, user_id)
    row = (await db.execute(
        text("SELECT totp_enabled FROM users WHERE id = :uid AND tenant_id = :tid FOR UPDATE"),
        {"uid": str(user_id), "tid": str(tenant.id)},
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    await db.execute(
        text(f"UPDATE users SET {CLEAR_TWO_FACTOR_SET}, token_version = token_version + 1 "
             "WHERE id = :uid AND tenant_id = :tid"),
        {"uid": str(user_id), "tid": str(tenant.id)},
    )
    await db.execute(text("DELETE FROM user_recovery_codes WHERE tenant_id = :tid AND user_id = :uid"),
                     {"uid": str(user_id), "tid": str(tenant.id)})
    await write_audit(db, tenant.id, request, "user.2fa_reset", "user", str(user_id),
                      {"totp_enabled": bool(row[0])}, {"totp_enabled": False})
    await db.commit()
    forget_token_version(str(user_id))
    return {"id": str(user_id), "totp_enabled": False}
