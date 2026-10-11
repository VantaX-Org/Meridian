"""User management API routes — RBAC user CRUD."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.roles import enforce_ceiling, forbid_self, insert_grant, resolve_caller
from api.services.rbac import Scope, require_permission, VALID_ROLES
from workers.tasks.send_user_invitation import send_invitation_email

router = APIRouter(prefix="/api/v1", tags=["users"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


class UpdateUserBody(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class InviteGrant(BaseModel):
    role_key: str
    system_id: Optional[uuid.UUID] = None
    module: Optional[str] = None


class InviteUserBody(BaseModel):
    email: str
    name: str = ""
    role: str = "analyst"
    # Scoped grants. When given, `role` is ignored: users.role (the tenant-wide
    # fallback every legacy guard reads) becomes the first unscoped grant's role,
    # else viewer, so a scoped grant never widens into a tenant-wide one.
    grants: list[InviteGrant] = Field(default_factory=list)


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
                   permissions, is_active, last_login, created_at
            FROM users
            WHERE tenant_id = :tid
            ORDER BY created_at ASC
        """),
        {"tid": str(tenant.id)},
    )
    users = [_row_to_dict(r) for r in result.fetchall()]

    return {"users": users}


# ── PUT /api/v1/users/{id} ──────────────────────────────────────────────────


@router.put("/users/{user_id}")
async def update_user(
    user_id: str,
    body: UpdateUserBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    await _set_rls(db, tenant.id)

    updates = []
    params: dict = {"uid": user_id, "tid": str(tenant.id)}

    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
        updates.append("role = :role")
        params["role"] = body.role

    if body.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = body.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    old_role = None
    if body.role is not None:
        old = await db.execute(text("SELECT role FROM users WHERE id = :uid AND tenant_id = :tid"),
                               {"uid": user_id, "tid": str(tenant.id)})
        old_row = old.fetchone()
        old_role = old_row[0] if old_row else None
        if old_role and old_role != body.role:
            # A role change is a grant of the new role and a revocation of the old one: both must sit
            # under the caller's own permissions, and nobody re-roles themself.
            caller = await resolve_caller(db, tenant, request, Scope())
            forbid_self(caller, user_id)
            await enforce_ceiling(db, tenant.id, caller, body.role)
            await enforce_ceiling(db, tenant.id, caller, old_role)

    set_clause = ", ".join(updates)
    result = await db.execute(
        text(f"UPDATE users SET {set_clause} WHERE id = :uid AND tenant_id = :tid RETURNING id"),
        params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    if body.role is not None and old_role and old_role != body.role:
        # The unscoped grant mirrors users.role; a stale one would keep the old (maybe higher) role alive.
        # If the user already holds an unscoped grant of the new role, renaming would hit the unique
        # index, so drop the old mirror instead.
        sync = {"new": body.role, "old": old_role, "uid": user_id, "tid": str(tenant.id)}
        unscoped = "tenant_id = :tid AND user_id = :uid AND system_id IS NULL AND module IS NULL"
        has_new = (await db.execute(text(f"SELECT 1 FROM user_role_scopes WHERE {unscoped} AND role_key = :new"),
                                    sync)).fetchone()
        await db.execute(text(f"DELETE FROM user_role_scopes WHERE {unscoped} AND role_key = :old") if has_new
                         else text(f"UPDATE user_role_scopes SET role_key = :new WHERE {unscoped} AND role_key = :old"),
                         sync)

    await db.commit()

    # Return updated user
    row = await db.execute(
        text("SELECT id, email, name, role, is_active, last_login, created_at FROM users WHERE id = :uid AND tenant_id = :tid"),
        {"uid": user_id, "tid": str(tenant.id)},
    )
    return _row_to_dict(row.fetchone())


# ── POST /api/v1/users/invite ───────────────────────────────────────────────


@router.post("/users/invite", status_code=200)
async def invite_user(
    body: InviteUserBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    await _set_rls(db, tenant.id)

    # users.role must stay a built-in key (legacy guards read it directly); a custom first grant is
    # still granted below, and users.role falls back to viewer.
    first = next((g.role_key for g in body.grants if g.system_id is None and g.module is None), None)
    role = (first if first in VALID_ROLES else "viewer") if body.grants else body.role
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
    grants = list(body.grants)
    if not any(g.role_key == role and g.system_id is None and g.module is None for g in grants):
        grants.append(InviteGrant(role_key=role))  # the unscoped grant mirroring users.role

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
    user_id: str,
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

    try:
        result = await db.execute(
            text(
                "DELETE FROM users WHERE id = :uid AND tenant_id = :tid "
                "RETURNING id"
            ),
            {"uid": user_id, "tid": str(tenant.id)},
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

    return {"id": user_id, "status": "deleted"}
