"""User management API routes — RBAC user CRUD."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission, VALID_ROLES
from workers.tasks.send_user_invitation import send_invitation_email

router = APIRouter(prefix="/api/v1", tags=["users"])


def _row_to_dict(row) -> dict:
    return dict(row._mapping) if row else {}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


class UpdateUserBody(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


class InviteUserBody(BaseModel):
    email: str
    name: str = ""
    role: str = "analyst"


# ── GET /api/v1/users ────────────────────────────────────────────────────────


@router.get("/users")
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

    set_clause = ", ".join(updates)
    result = await db.execute(
        text(f"UPDATE users SET {set_clause} WHERE id = :uid AND tenant_id = :tid RETURNING id"),
        params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

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
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_users")),
):
    await _set_rls(db, tenant.id)

    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")

    new_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, email, name, role, is_active, created_at)
            VALUES (:id, :tid, :email, :name, :role, true, now())
        """),
        {
            "id": new_id,
            "tid": str(tenant.id),
            "email": body.email,
            "name": body.name or body.email.split("@")[0],
            "role": body.role,
        },
    )
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
            f"Could not mint invite token for {body.email}: {e}"
        )

    # Trigger invitation email (async — does not block response)
    try:
        send_invitation_email.delay(
            user_id=new_id,
            tenant_id=str(tenant.id),
            recipient_email=body.email,
            recipient_name=body.name or body.email.split("@")[0],
            role=body.role,
            invite_token=invite_token,
        )
    except Exception as e:
        # Log but don't fail the response if Celery task fails to queue
        import logging
        logging.getLogger("meridian.users").error(f"Failed to queue invitation email: {e}")

    return {"id": new_id, "email": body.email, "role": body.role, "status": "invited"}


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
