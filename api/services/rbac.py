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

import json
import os
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import Connection, Row, text
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


# ── Persona roles (wave 13) ──────────────────────────────────────────────────
#
# Added alongside the legacy keys, NOT merged into PERMISSIONS: PERMISSIONS (and
# every legacy (role, action) answer) stays byte-identical. Each persona carries
# the same action set as the legacy role it replaces; `analyst` and `viewer` and
# `auditor` are already persona keys and stay in PERMISSIONS untouched.
# ponytail: spec §3.2 also folds ai_reviewer's extras into `analyst`; that would
# widen the legacy analyst, so it is deliberately not done here.

PERSONA_ROLES: dict[str, set[str]] = {
    "programme_lead": PERMISSIONS["manager"],
    "data_steward": PERMISSIONS["steward"],
    "data_owner": PERMISSIONS["approver"],
    # No manage_system: in code it gates platform update/restart and admin doctor
    # (system_update.py, admin_doctor.py), not SAP systems. manage_systems covers those.
    "sap_basis": PERMISSIONS["analyst"] | {
        "manage_systems", "trigger_sync", "manage_field_mappings", "upload",
    },
    "platform_admin": PERMISSIONS["admin"],
}

# Persona key -> legacy key whose special-cased behaviour it inherits.
PERSONA_ALIAS: dict[str, str] = {
    "programme_lead": "manager", "data_steward": "steward",
    "data_owner": "approver", "platform_admin": "admin",
}

PERSONA_HOME: dict[str, str] = {
    "programme_lead": "/home/lead", "data_steward": "/home/steward",
    "data_owner": "/home/steward", "analyst": "/home/lead", "sap_basis": "/home/basis",
    "platform_admin": "/home/lead", "auditor": "/home/lead", "viewer": "/home/lead",
}


def home_for(role: str) -> str:
    """Default landing page for a role key (legacy keys follow their persona)."""
    legacy_to_persona = {v: k for k, v in PERSONA_ALIAS.items()}
    return PERSONA_HOME.get(legacy_to_persona.get(role, role), "/home/lead")


def _perms(role: str) -> set[str]:
    return PERMISSIONS.get(role) or PERSONA_ROLES.get(role, set())


def permissions_for(role: str) -> list[str]:
    """Sorted permission list for a role (unknown role → none)."""
    return sorted(_perms(role))


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
VALID_ROLES: set[str] = set(PERMISSIONS.keys()) | set(PERSONA_ROLES.keys())


def has_permission(role: str, action: str) -> bool:
    """Check if a role has a given action permission."""
    return action in _perms(role)


def can_approve_for_object(
    role: str, object_type: str, permissions: dict | None = None
) -> bool:
    """Check if user can approve for a specific object type.

    Admin can approve all. Steward/Approver checked against permissions JSONB
    if present, else default True.
    """
    role = PERSONA_ALIAS.get(role, role)
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


# ── Resource x action model ──────────────────────────────────────────────────

RESOURCES: tuple[str, ...] = (
    "systems", "credentials", "extraction", "analysis", "rules", "findings", "fixes", "mdm",
    "glossary", "stewardship", "contracts", "reports", "llm", "users", "licence", "audit",
)
ACTIONS: tuple[str, ...] = ("view", "create", "edit", "approve", "run", "export", "admin")

_NO_VIEW = {"audit", "llm", "users", "licence", "credentials"}

LEGACY_ACTION_MAP: dict[str, set[tuple[str, str]]] = {
    "view": {("*", "view")},
    "mdm.read": {("mdm", "view")},
    "mdm.write": {("mdm", "edit")},
    "view_ai_confidence": {("findings", "view")},
    "upload": {("extraction", "create")},
    "trigger_sync": {("extraction", "run")},
    "analyse": {("analysis", "run")},
    "trigger_ai": {("analysis", "run"), ("llm", "view")},
    "approve": {("fixes", "approve"), ("mdm", "approve"), ("stewardship", "approve"),
                ("analysis", "approve")},
    "apply": {("fixes", "run")},
    "assign": {("stewardship", "edit")},
    "export": {("reports", "export"), ("*", "export")},
    "manage_rules": {("rules", "create"), ("rules", "edit"), ("contracts", "create"),
                     ("contracts", "edit"), ("glossary", "edit")},
    "review_ai_rules": {("rules", "approve")},
    "ai_feedback": {("findings", "edit")},
    "manage_field_mappings": {("extraction", "edit")},
    "manage_systems": {("systems", "create"), ("systems", "edit"), ("systems", "admin"),
                       ("credentials", "edit")},
    # Platform update/restart/doctor. A pair only admin/platform_admin hold, so no
    # custom role derived from a lesser role (or ticked with systems pairs) reaches it.
    "manage_system": {("licence", "admin")},
    "manage_settings": {("analysis", "admin"), ("reports", "admin"), ("rules", "admin")},
    "manage_llm": {("llm", "admin")},
    "manage_users": {("users", "admin")},
    "view_audit": {("audit", "view"), ("audit", "export")},
}


def _expand(pairs: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """Concrete (resource, action) pairs; `*` expands to every resource (view skips _NO_VIEW)."""
    out: set[tuple[str, str]] = set()
    for res, act in pairs:
        if res != "*":
            out.add((res, act))
        else:
            out |= {(r, act) for r in RESOURCES if not (act == "view" and r in _NO_VIEW)}
    return out


def _required_pairs(action: str) -> set[tuple[str, str]]:
    """Pairs a custom role must hold to be granted a legacy action."""
    pairs = LEGACY_ACTION_MAP.get(action, set())
    concrete = {p for p in pairs if p[0] != "*"}
    return _expand(concrete or pairs)  # `*` only when nothing more specific exists


def legacy_actions_for_pairs(pairs: set[tuple[str, str]]) -> set[str]:
    """Legacy action strings a set of (resource, action) pairs satisfies."""
    return {a for a in LEGACY_ACTION_MAP if _required_pairs(a) <= pairs}


def resource_matrix(actions: set[str]) -> dict[str, dict[str, bool]]:
    """{resource: {action: bool}} implied by a legacy action set."""
    granted: set[tuple[str, str]] = set()
    for a in actions:
        granted |= _expand(LEGACY_ACTION_MAP.get(a, set()))
    return {r: {a: (r, a) in granted for a in ACTIONS} for r in RESOURCES}


# ── Scoped grants ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Scope:
    system_id: uuid.UUID | None = None
    module: str | None = None


Grant = tuple[str, Scope]


def _scope_matches(grant: Scope, request: Scope) -> bool:
    """A grant covers a request when each of its dimensions is null (all) or equal."""
    return ((grant.system_id is None or grant.system_id == request.system_id)
            and (grant.module is None or grant.module == request.module))


def has_permission_scoped(grants: list[Grant], action: str, scope: Scope) -> bool:
    """Built-in roles only; custom roles resolve through role_has_action()."""
    return any(has_permission(role, action) and _scope_matches(s, scope) for role, s in grants)


async def actions_for(role_key: str, tenant_id: uuid.UUID, db: AsyncSession) -> set[str]:
    """Legacy action set of a role key: built-ins from code, custom from role_permissions."""
    if not role_key.startswith("custom:"):
        return set(_perms(role_key))
    rows = await db.execute(
        text("SELECT rp.resource, rp.action FROM role_permissions rp "
             "JOIN roles r ON r.id = rp.role_id "
             "WHERE r.tenant_id = :tid AND r.key = :key"),
        {"tid": str(tenant_id), "key": role_key},
    )
    return legacy_actions_for_pairs({(r[0], r[1]) for r in rows.fetchall()})


async def grants_for(db: AsyncSession, user_id: str, tenant_id: uuid.UUID,
                     fallback_role: str | None = None) -> list[Grant]:
    """user_role_scopes rows; falls back to [(fallback_role, Scope())] when none exist."""
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant_id)}'"))
    rows = await db.execute(
        text("SELECT role_key, system_id, module FROM user_role_scopes "
             "WHERE user_id = :uid AND tenant_id = :tid"),
        {"uid": user_id, "tid": str(tenant_id)},
    )
    grants = [(r[0], Scope(r[1], r[2])) for r in rows.fetchall()]
    if not grants and fallback_role:
        return [(fallback_role, Scope())]
    return grants


def _as_uuid(v: Optional[str]) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(v)) if v else None
    except ValueError:
        return None


def scope_from_path(request: Request) -> Scope:
    """Scope of a request from its PATH params only: system_id, and object_type (wins) or module.

    Query strings never decide authorization: the caller controls them. A version_id or an item id in
    the path is resolved server-side by require_permission (_resolve_scope). Anything unresolved stays
    None, which only tenant-wide grants cover, so a scoped grant fails closed rather than open."""
    pp = request.path_params
    request.state.scope_version_id = pp.get("version_id")
    module = pp.get("object_type") or pp.get("module")
    return Scope(_as_uuid(pp.get("system_id")), str(module) if module else None)


async def _row(db: AsyncSession, sql: str, item: str, tenant_id: uuid.UUID) -> Optional[Row]:
    await db.execute(text(f"SET LOCAL app.tenant_id = '{str(tenant_id)}'"))
    return (await db.execute(text(sql), {"i": item, "t": str(tenant_id)})).fetchone()


async def _resolve_scope(request: Request, db: AsyncSession, tenant_id: uuid.UUID, base: Scope) -> Scope:
    """Refine the path scope from the resource the handler acts on, read from the database.

    Never trusts the caller: a path version/item id is looked up (tenant-filtered); a connectivity body
    system_id is the value the handler uses. When two sources disagree, or the target spans two systems,
    the result is Scope() so only tenant-wide grants pass. Unknown resources also stay at Scope()."""
    pp, path = request.path_params, request.url.path
    system, module = base.system_id, base.module
    vid = _as_uuid(request.state.scope_version_id) if getattr(request.state, "scope_version_id", None) else None
    if getattr(request.state, "scope_version_id", None) and not vid:
        return Scope()
    sids: list[Optional[uuid.UUID]] = []
    # metadata.system_id is stamped server-side by the extraction worker ('upload' for files) and no
    # route writes it from client input (pinned by test_version_metadata_system_id_not_client_writable).
    vsql = "SELECT metadata->>'system_id' FROM analysis_versions WHERE id = :i AND tenant_id = :t"
    if vid:
        r = await _row(db, vsql, str(vid), tenant_id)
        sids.append(_as_uuid(r[0]) if r else None)
    item = _as_uuid(pp.get("item_id"))
    if item and "/cleaning/" in path:
        r = await _row(db, "SELECT object_type, version_id FROM cleaning_queue WHERE id = :i AND tenant_id = :t",
                       str(item), tenant_id)
        if not r:
            return Scope()
        module = module or r[0]
        if r[1]:
            v = await _row(db, vsql, str(r[1]), tenant_id)
            sids.append(_as_uuid(v[0]) if v else None)
    elif "/migration/" in path and (pp.get("wave_id") or pp.get("run_id")):
        sql = ("SELECT source_system_id, target_system_id FROM migration_waves WHERE id = :i AND tenant_id = :t"
               if pp.get("wave_id") else
               "SELECT source_system_id, dest_system_id FROM migration_runs WHERE id = :i AND tenant_id = :t")
        rid = _as_uuid(pp.get("wave_id") or pp.get("run_id"))
        if not rid:  # the route's own validation answers 422
            return Scope()
        r = await _row(db, sql, str(rid), tenant_id)
        if not r or not r[0] or (r[1] and r[1] != r[0]):
            return Scope()
        sids.append(r[0])
    elif "/connectivity/" in path and request.method == "POST" and not system:
        try:
            body = await request.json()
        except ValueError:
            return Scope()
        sids.append(_as_uuid(body.get("system_id")) if isinstance(body, dict) else None)
    if any(x is None for x in sids) or len(set(sids + ([system] if system else []))) > 1:
        return Scope(None, module)
    return Scope(sids[0] if sids else system, module)


async def _grants_allow(grants: list[Grant], action: str, scope: Scope,
                        tenant_id: uuid.UUID, db: AsyncSession) -> bool:
    for role, s in grants:
        if _scope_matches(s, scope) and action in await actions_for(role, tenant_id, db):
            return True
    return False


async def require_scope(request: Request, db: AsyncSession, tenant: Tenant, action: str, scope: Scope) -> None:
    """In-handler check: 403 unless the caller holds `action` at `scope` (same rules as require_permission).
    Use for ids in a request body that the path scope does not cover."""
    role = await _get_user_role(tenant, db, request)
    uid = getattr(request.state, "local_user_id", None)
    if dev_role_override(request) is not None or not uid:
        ok = has_permission(role, action)
    else:
        ok = await _grants_allow(await user_grants(db, tenant.id, uid, role), action, scope, tenant.id, db)
    if not ok:
        raise HTTPException(status_code=403, detail={"detail": "forbidden", "resource": None, "action": action,
                                                     "request_access": True})


def require_permission(
    action: str,
    *,
    resource: str | None = None,
    scope: Callable[[Request], Scope] | None = None,
):
    """FastAPI dependency factory — returns a dependency that checks the current
    user's role against the required action. Raises HTTP 403 if not permitted.

    Single-arg calls behave exactly as before: a tenant-wide check of users.role
    (plus, only when that fails, the user's unscoped grants). With `scope`, the
    request's Scope is resolved and only grants covering it count. `resource` is
    informational (403 body, audit)."""

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
        uid = getattr(request.state, "local_user_id", None)
        dev = dev_role_override(request) is not None
        req_scope = scope(request) if scope else None
        if scope is scope_from_path and not dev and uid:  # the only resolver that reads a request
            req_scope = await _resolve_scope(request, db, tenant.id, req_scope)

        if req_scope is None:
            if has_permission(role, action):
                return role
            # Not allowed by users.role: an unscoped grant may still allow it.
            if uid and not dev:
                grants = [g for g in await grants_for(db, uid, tenant.id)
                          if g[1] == Scope()]
                if await _grants_allow(grants, action, Scope(), tenant.id, db):
                    return role
        elif dev or not uid:
            # No grants to resolve (dev header / auth off): the tenant-wide legacy check.
            if has_permission(role, action):
                return role
        else:
            # users.role always counts tenant-wide, exactly as the unscoped check; grants narrow nothing
            # and widen only at the scopes they cover.
            if await _grants_allow(await user_grants(db, tenant.id, uid, role), action, req_scope,
                                   tenant.id, db):
                return role

        if resource is None and req_scope is None:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{role}' does not have '{action}' permission",
            )
        # Nested on purpose: FastAPI wraps `detail`, so the body is
        # {"detail": {"detail": "forbidden", "resource", "action", "request_access": true}}.
        # Clients read body.detail.request_access (rbac.md §3.3).
        raise HTTPException(
            status_code=403,
            detail={"detail": "forbidden", "resource": resource, "action": action,
                    "request_access": True},
        )

    return _check


def require_any_permission(*actions: str):
    """Dependency factory: pass when the user holds ANY of `actions` (tenant-wide)."""
    checks = [require_permission(a) for a in actions]

    async def _check(
        request: Request,
        tenant: Tenant = Depends(get_tenant),
        db: AsyncSession = Depends(get_db),
    ) -> str:
        last: HTTPException | None = None
        for c in checks:
            try:
                return await c(request, tenant, db)
            except HTTPException as exc:
                last = exc
        assert last is not None
        raise last

    return _check


# ── Effective permissions + audit (shared by /me and /roles routes) ──────────

BUILTIN_NAMES: dict[str, str] = {
    "programme_lead": "Programme lead / CIO", "data_steward": "Data steward",
    "data_owner": "Data owner / approver", "analyst": "Analyst", "sap_basis": "SAP Basis / integration admin",
    "platform_admin": "Platform admin", "auditor": "Auditor", "viewer": "Viewer",
    "admin": "Admin (legacy)", "manager": "Manager (legacy)", "steward": "Steward (legacy)",
    "approver": "Approver (legacy)", "ai_reviewer": "AI reviewer (legacy)",
}


class RoleRef(BaseModel):
    key: str
    name: str
    system_id: str | None = None
    module: str | None = None


class ScopeRef(BaseModel):
    system_id: str | None = None
    module: str | None = None


class EffectivePermissions(BaseModel):
    """The /me/permissions and /users/{id}/effective shape (rbac.md §3.3)."""
    role: str
    roles: list[RoleRef]
    actions: list[str]
    resources: dict[str, dict[str, bool]]
    scopes: list[ScopeRef]
    home: str


async def user_grants(db: AsyncSession, tenant_id: uuid.UUID, user_id: str | None,
                       user_role: str) -> list[Grant]:
    """All grants plus users.role (always counts, as in legacy checks). No uid -> users.role only."""
    grants = await grants_for(db, user_id, tenant_id, fallback_role=user_role) if user_id else []
    if not any(r == user_role for r, _ in grants):
        grants.append((user_role, Scope()))
    return grants


async def effective_actions(db: AsyncSession, tenant_id: uuid.UUID, user_id: str | None,
                            user_role: str, scope: Scope) -> set[str]:
    """Legacy actions a user holds at `scope`: users.role plus every grant covering it."""
    actions: set[str] = set()
    for key, s in await user_grants(db, tenant_id, user_id, user_role):
        if _scope_matches(s, scope):
            actions |= await actions_for(key, tenant_id, db)
    return actions


async def effective_permissions(
    db: AsyncSession, tenant_id: uuid.UUID, user_id: str | None, user_role: str,
    system_id: uuid.UUID | None = None, module: str | None = None, narrowed: bool = False,
) -> EffectivePermissions:
    """The /me/permissions shape. Not narrowed: union of every grant (what the nav needs).
    Narrowed: only grants covering (system_id, module)."""
    grants = await user_grants(db, tenant_id, user_id, user_role)
    if narrowed:
        want = Scope(system_id, module)
        grants = [g for g in grants if _scope_matches(g[1], want)]
    actions: set[str] = set()
    names: dict[str, str] = {}
    for key, _ in grants:
        actions |= await actions_for(key, tenant_id, db)
        if key.startswith("custom:") and key not in names:
            row = await db.execute(text("SELECT name FROM roles WHERE tenant_id = :t AND key = :k"),
                                   {"t": str(tenant_id), "k": key})
            r = row.fetchone()
            names[key] = r[0] if r else key
    return EffectivePermissions(
        role=user_role,
        roles=[RoleRef(key=k, name=names.get(k) or BUILTIN_NAMES.get(k, k),
                       system_id=str(s.system_id) if s.system_id else None, module=s.module)
               for k, s in grants],
        actions=sorted(actions),
        resources=resource_matrix(actions),
        scopes=[ScopeRef(system_id=str(s.system_id) if s.system_id else None, module=s.module)
                for _, s in grants if s != Scope()],
        home=home_for(user_role),
    )


def unscoped_actions_sync(conn: Connection, tenant_id: str, user_id: str, user_role: str) -> list[str]:
    """Sync twin of the tenant-wide check for /auth/me: users.role plus unscoped grants
    (custom ones resolved through role_permissions). Pre-077 DBs: users.role only."""
    actions = set(_perms(user_role))
    if conn.execute(text("SELECT to_regclass('user_role_scopes')")).scalar() is None:
        return sorted(actions)
    rows = conn.execute(
        text("SELECT s.role_key, rp.resource, rp.action FROM user_role_scopes s "
             "LEFT JOIN roles r ON r.tenant_id = s.tenant_id AND r.key = s.role_key "
             "LEFT JOIN role_permissions rp ON rp.role_id = r.id "
             "WHERE s.tenant_id = :t AND s.user_id = :u AND s.system_id IS NULL AND s.module IS NULL"),
        {"t": tenant_id, "u": user_id}).fetchall()
    custom: dict[str, set[tuple[str, str]]] = {}
    for key, res, act in rows:
        if key.startswith("custom:"):
            custom.setdefault(key, set()).update({(res, act)} if res else set())
        else:
            actions |= _perms(key)
    for pairs in custom.values():
        actions |= legacy_actions_for_pairs(pairs)
    return sorted(actions)


async def write_audit(
    db: AsyncSession, tenant_id: uuid.UUID, request: Request, action: str,
    entity_type: str, entity_id: str, before: dict | None, after: dict | None,
) -> None:
    """Append a role/grant/access-request row to audit_log (caller commits)."""
    await db.execute(
        text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, "
             "method, path, status_code, before_json, after_json) "
             "VALUES (:t, :u, :e, :a, :et, :ei, :m, :p, 200, CAST(:b AS jsonb), CAST(:af AS jsonb))"),
        {"t": str(tenant_id), "u": current_user_id(request), "e": current_user_label(), "a": action,
         "et": entity_type, "ei": entity_id, "m": request.method, "p": request.url.path,
         "b": json.dumps(before) if before is not None else None,
         "af": json.dumps(after) if after is not None else None},
    )
