"""RBAC service — permission matrix with FastAPI dependency factory.

Supports both the legacy 7-role system and the simplified 3-tier system:

  3-tier (Phase 2+):
    admin   — full access including user/rules management and SAP field mapping
    manager — write access but no admin-only features (rules engine, user mgmt)
    viewer  — read-only access + Ask Meridian + licence details

  Legacy (backward compat):
    steward, analyst, approver, auditor, ai_reviewer — mapped to equivalent tiers

Actions: see PERMISSIONS below — it is the single source of truth.
"""

import os
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

# ── Permission matrix ────────────────────────────────────────────────────────
#
# Single source of truth. /api/v1/auth/me returns permissions_for(role) so the
# frontend never keeps its own copy.
#
#   admin        everything, incl. users, LLM, platform update, settings
#   manager      runs the programme: systems, sync, analysis, approve/apply, assign
#   steward      data owner: fix, clean, approve/apply, rules, assign
#   analyst      upload + analyse + export, no approvals
#   approver     four-eyes approver only
#   auditor      read-only + audit log
#   ai_reviewer  reviews AI proposals
#   viewer       read-only

_READ = {"view", "mdm.read", "view_ai_confidence"}

PERMISSIONS: dict[str, set[str]] = {
    "admin": _READ | {
        "upload", "analyse", "approve", "apply", "export", "assign",
        "manage_users", "manage_rules", "manage_field_mappings", "manage_llm",
        "manage_system", "manage_systems", "manage_settings", "view_audit",
        "ai_feedback", "review_ai_rules", "trigger_ai", "trigger_sync",
        "mdm.write",
    },
    "manager": _READ | {
        "upload", "analyse", "approve", "apply", "export", "assign",
        "manage_systems", "view_audit",
        "ai_feedback", "trigger_ai", "trigger_sync", "mdm.write",
    },
    "steward": _READ | {
        "upload", "analyse", "approve", "apply", "export", "assign",
        "manage_rules", "ai_feedback", "review_ai_rules", "trigger_ai",
        "trigger_sync", "mdm.write",
    },
    "analyst": _READ | {"upload", "analyse", "export", "trigger_ai", "trigger_sync"},
    "approver": _READ | {"approve", "export"},
    "auditor": _READ | {"export", "view_audit"},
    "ai_reviewer": _READ | {"review_ai_rules", "ai_feedback"},
    "viewer": set(_READ),
}


def permissions_for(role: str) -> list[str]:
    """Sorted permission list for a role (unknown role → none)."""
    return sorted(PERMISSIONS.get(role, set()))


def current_user_id(request: Optional[Request] = None) -> Optional[str]:
    """Authenticated user's id (None if unauthenticated).

    Reads ``request.state`` when given, else the request-scoped context var
    set by LocalAuthMiddleware — so services can attribute actions without
    threading ``request`` through every call.
    """
    uid = getattr(request.state, "local_user_id", None) if request is not None else None
    if not uid:
        from api.middleware.local_auth import get_current_user
        uid = (get_current_user() or {}).get("id")
    return str(uid) if uid else None


def current_user_label() -> str:
    """Email of the authenticated user for audit rows ('system' for background jobs)."""
    from api.middleware.local_auth import get_current_user
    return (get_current_user() or {}).get("email") or "system"


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
        # TenantMiddleware runs before routing and can only guess a default
        # tenant onto request.state.tenant_id. `tenant` here is the real,
        # per-request resolution (JWT-derived in prod, dependency-overridden
        # in tests) and is known earlier than anywhere else in the request.
        # Publish it back onto request.state so anything reading that
        # attribute *after* the route runs — chiefly AuditMiddleware, which
        # builds its row once the response comes back — sees the request's
        # actual tenant instead of the middleware's placeholder. Without
        # this, AuditMiddleware's auto-logged row is attributed to the wrong
        # tenant whenever the two diverge (a tenant-isolation defect).
        request.state.tenant_id = tenant.id
        role = await _get_user_role(tenant, db, request)
        if not has_permission(role, action):
            raise HTTPException(
                status_code=403,
                detail=f"Role '{role}' does not have '{action}' permission",
            )
        return role

    return _check
