"""RBAC service — permission matrix with FastAPI dependency factory.

Supports both the legacy 7-role system and the simplified 3-tier system:

  3-tier (Phase 2+):
    admin   — full access including user/rules management and SAP field mapping
    manager — write access but no admin-only features (rules engine, user mgmt)
    viewer  — read-only access + Ask Meridian + licence details

  Legacy (backward compat):
    steward, analyst, approver, auditor, ai_reviewer — mapped to equivalent tiers

Actions: view, upload, analyse, approve, apply, export, manage_users, manage_rules,
         ai_feedback, review_ai_rules, trigger_ai, view_ai_confidence,
         trigger_sync, manage_field_mappings
"""

import os
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

# ── Permission matrix ────────────────────────────────────────────────────────

PERMISSIONS: dict[str, set[str]] = {
    # ── 3-tier roles (Phase 2+) ───────────────────────────────────────────
    "admin": {
        "view", "upload", "analyse", "approve", "apply", "export",
        "manage_users", "manage_rules", "manage_field_mappings", "manage_llm",
        "ai_feedback", "review_ai_rules", "trigger_ai", "view_ai_confidence",
        "trigger_sync",
        # mdm.* — mining pipeline endpoints. Admin gets both read and
        # write. These were added to route guards in an earlier phase but
        # the PERMISSIONS dict was never updated, so every role 403'd.
        # Sweep-added here.
        "mdm.read", "mdm.write",
    },
    "manager": {
        "view", "upload", "analyse", "approve", "apply", "export",
        "ai_feedback", "trigger_ai", "view_ai_confidence", "trigger_sync",
        "mdm.read", "mdm.write",
    },
    "viewer": {"view", "mdm.read"},

    # ── Legacy roles (backward compat) ────────────────────────────────────
    "steward": {
        "view", "upload", "analyse", "approve", "apply", "export", "manage_rules",
        "ai_feedback", "review_ai_rules", "trigger_ai", "view_ai_confidence",
        "trigger_sync",
        "mdm.read", "mdm.write",
    },
    "analyst": {
        "view", "upload", "analyse", "export", "trigger_ai", "view_ai_confidence",
        "trigger_sync",
        "mdm.read",
    },
    "approver": {"view", "approve", "export", "mdm.read"},
    "auditor": {"view", "export", "mdm.read"},
    "ai_reviewer": {"view", "view_ai_confidence", "review_ai_rules", "ai_feedback", "mdm.read"},
}

# All valid role values accepted by the users table
VALID_ROLES: set[str] = set(PERMISSIONS.keys())


def has_permission(role: str, action: str) -> bool:
    """Check if a role has a given action permission."""
    return action in PERMISSIONS.get(role, set())


def can_approve_for_object(
    role: str, object_type: str, permissions: dict | None = None
) -> bool:
    """Check if user can approve for a specific object type.

    Admin can approve all. Steward/Approver checked against permissions JSONB
    if present, else default True.
    """
    if role == "admin":
        return True
    if role not in ("steward", "approver"):
        return False
    if permissions is None:
        return True
    # Check object-type-specific overrides in permissions JSONB
    object_perms = permissions.get(object_type)
    if object_perms is None:
        return True
    return bool(object_perms.get("approve", True))


def dev_role_override(request: Request) -> Optional[str]:
    """Honour the X-User-Role header ONLY when explicitly enabled for local dev
    (MERIDIAN_DEV_ROLE_HEADER=1). Off by default — in production the header is
    ignored, closing the privilege-escalation hole where any caller could send
    `X-User-Role: admin`. Returns None unless the flag is set AND the supplied
    role is a known role."""
    if os.environ.get("MERIDIAN_DEV_ROLE_HEADER") != "1":
        return None
    role = request.headers.get("x-user-role")
    return role if role in VALID_ROLES else None


async def _get_user_role(
    tenant: Tenant, db: AsyncSession, request: Request
) -> str:
    """Resolve the current user's role from the users table or tenant default."""
    dev_role = dev_role_override(request)
    if dev_role:
        return dev_role

    # Check for local auth JWT claims
    from api.config import settings
    if settings.auth_mode == "local":
        local_user_id = getattr(request.state, "local_user_id", None)
        if local_user_id:
            await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant.id)}'"))
            result = await db.execute(
                text("SELECT role, is_active FROM users WHERE id = :uid AND tenant_id = :tid"),
                {"uid": local_user_id, "tid": str(tenant.id)},
            )
            row = result.fetchone()
            if row:
                if not row[1]:
                    raise HTTPException(status_code=403, detail="User account is deactivated")
                return row[0]
        # No authenticated user — fail closed (was: return "admin", a privilege
        # escalation if middleware ever failed to populate local_user_id).
        raise HTTPException(status_code=403, detail="Authentication required")
    return "analyst"


def require_permission(action: str):
    """FastAPI dependency factory — returns a dependency that checks the current
    user's role against the required action. Raises HTTP 403 if not permitted."""

    async def _check(
        request: Request,
        tenant: Tenant = Depends(get_tenant),
        db: AsyncSession = Depends(get_db),
    ) -> str:
        role = await _get_user_role(tenant, db, request)
        if not has_permission(role, action):
            raise HTTPException(
                status_code=403,
                detail=f"Role '{role}' does not have '{action}' permission",
            )
        return role

    return _check
