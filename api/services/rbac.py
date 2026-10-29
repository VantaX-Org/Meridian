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
from collections.abc import Callable, Iterable
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
#   (handoff_rule: hand one blocking rule to a steward; every `assign` holder and process_analyst)
#   viewer       read-only

_READ = {"view", "mdm.read", "view_ai_confidence"}

PERMISSIONS: dict[str, set[str]] = {
    "admin": _READ | {
        "upload", "analyse", "approve", "apply", "export", "assign", "handoff_rule",
        "manage_users", "manage_rules", "manage_field_mappings", "manage_llm",
        "manage_system", "manage_systems", "manage_settings", "view_audit",
        "ai_feedback", "review_ai_rules", "trigger_ai", "trigger_sync",
        "mdm.write", "run_process_discovery", "export_process",
    },
    "manager": _READ | {
        "upload", "analyse", "approve", "apply", "export", "assign", "handoff_rule",
        "manage_systems", "view_audit",
        "ai_feedback", "trigger_ai", "trigger_sync", "mdm.write", "export_process",
    },
    "steward": _READ | {
        "upload", "analyse", "approve", "apply", "export", "assign", "handoff_rule",
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
    # Leads and stewards run process discovery (owner decision 2026-10-26); the legacy keys stay unchanged.
    # manage_triage: edit teams, assignment rules and SLA policies (not the tenant clock, which stays manage_settings).
    "programme_lead": PERMISSIONS["manager"] | {"run_process_discovery", "manage_triage"},
    "data_steward": PERMISSIONS["steward"] | {"run_process_discovery", "manage_triage"},
    "data_owner": PERMISSIONS["approver"],
    # No manage_system: in code it gates platform update/restart and admin doctor
    # (system_update.py, admin_doctor.py), not SAP systems. manage_systems covers those.
    "sap_basis": PERMISSIONS["analyst"] | {
        "manage_systems", "trigger_sync", "manage_field_mappings", "upload", "run_process_discovery",
    },
    "platform_admin": PERMISSIONS["admin"],
    # Process discovery (process-discovery spec 6.1): read everything, run discovery, export as-is models,
    # and hand a blocking rule to a steward (handoff_rule) without general `assign` over the inbox.
    "process_analyst": _READ | {"run_process_discovery", "export_process", "handoff_rule"},
}

# The admin sees every feature (owner requirement): platform_admin and the legacy admin hold the union of every
# action any built-in role holds, so an action added to another role later never leaves the admin out.
ALL_ACTIONS: frozenset[str] = frozenset().union(*PERMISSIONS.values(), *PERSONA_ROLES.values())
PERMISSIONS["admin"] = set(ALL_ACTIONS)
PERSONA_ROLES["platform_admin"] = set(ALL_ACTIONS)

# Persona key -> legacy key whose special-cased behaviour it inherits.
PERSONA_ALIAS: dict[str, str] = {
    "programme_lead": "manager", "data_steward": "steward",
    "data_owner": "approver", "platform_admin": "admin",
}

PERSONA_HOME: dict[str, str] = {
    "programme_lead": "/home/lead", "data_steward": "/home/steward",
    "data_owner": "/home/steward", "analyst": "/home/lead", "sap_basis": "/home/basis",
    "platform_admin": "/home/lead", "auditor": "/home/lead", "viewer": "/home/lead",
    "process_analyst": "/home/process",
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

# Legacy keys a persona replaces (plus ai_reviewer): existing grants of them still work and display,
# but no new grant or invite may hand one out (api/routes/roles.py insert_grant).
LEGACY_ROLES: frozenset[str] = frozenset(set(PERMISSIONS) - set(PERSONA_ROLES) - {"analyst", "auditor", "viewer"})

# users.role is derived, never set by hand: the strongest unscoped built-in grant, strongest first.
# Grants are the only source of a user's role (recompute_users_role); custom keys never become users.role.
ROLE_RANK: tuple[str, ...] = (
    "platform_admin", "admin", "programme_lead", "manager", "data_steward", "steward", "sap_basis",
    "data_owner", "approver", "process_analyst", "analyst", "ai_reviewer", "auditor", "viewer",
)


def persona_for(role: str) -> str:
    """The persona key that replaces a legacy key (admin -> platform_admin, ...); any other key is itself."""
    return next((p for p, legacy in PERSONA_ALIAS.items() if legacy == role), role)


def strongest_role(keys: Iterable[str]) -> str:
    """users.role for a set of unscoped grant keys: the highest built-in by ROLE_RANK, else viewer."""
    held = set(keys)
    return next((k for k in ROLE_RANK if k in held), "viewer")


async def recompute_users_role(db: AsyncSession, tenant_id: uuid.UUID | str, user_id: uuid.UUID | str) -> str:
    """Set users.role from the user's unscoped grants (strongest built-in, else viewer). Caller commits.

    Run after every grant added or removed and after an invite. users.role is read from the database on
    every request (_get_user_role), never from the token, so the new value applies at the next request."""
    await db.execute(text(f"SET LOCAL app.tenant_id = '{uuid.UUID(str(tenant_id))}'"))
    rows = await db.execute(
        text(f"SELECT role_key FROM user_role_scopes WHERE tenant_id = :t AND user_id = :u "
             f"AND system_id IS NULL AND module IS NULL AND {ACTIVE_GRANT_SQL}"),
        {"t": str(tenant_id), "u": str(user_id)})
    role = strongest_role(r[0] for r in rows.fetchall())
    await db.execute(text("UPDATE users SET role = :r WHERE id = :u AND tenant_id = :t"),
                     {"r": role, "u": str(user_id), "t": str(tenant_id)})
    return role


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


async def _role_after_expiry(db: AsyncSession, tenant_id: uuid.UUID, user_id: str, role: str) -> str:
    """users.role when a grant of that very key has expired but the nightly purge has not yet re-derived it:
    the role stays only if an unexpired unscoped grant still backs it, else the strongest unexpired one."""
    rows = await db.execute(
        text(f"SELECT role_key FROM user_role_scopes WHERE tenant_id = :t AND user_id = :u "
             f"AND system_id IS NULL AND module IS NULL AND {ACTIVE_GRANT_SQL}"),
        {"t": str(tenant_id), "u": user_id})
    keys = [r[0] for r in rows.fetchall()]
    return role if role in keys else strongest_role(keys)


# View as (support): an administrator sends this header to see the product with another role's permissions. It only
# narrows: the header is honoured for a caller who holds manage_users, and every request carrying it is read-only
# (POST /admin/view-as and DELETE /admin/view-as, which start and stop it and write the audit rows, excepted).
VIEW_AS_HEADER = "x-view-as-role"
VIEW_AS_PATH = "/api/v1/admin/view-as"


def view_as_target(request: Request) -> Optional[str]:
    """The role asked for by the view-as header, when it is a known built-in role; else None."""
    role = request.headers.get(VIEW_AS_HEADER)
    return role if role in VALID_ROLES else None


def _apply_view_as(request: Request, role: str) -> str:
    """The role a request runs under: the view-as role for an administrator, else the caller's own (403 for a
    caller without manage_users, or for a write made while viewing as another role)."""
    target = view_as_target(request)
    if target is None:
        return role
    if not has_permission(role, "manage_users"):
        raise HTTPException(status_code=403, detail="View as is only for administrators who manage users.")
    if request.method not in ("GET", "HEAD") and request.url.path != VIEW_AS_PATH:
        raise HTTPException(status_code=403, detail=f"You are viewing as {target}: nothing can be changed until you stop.")
    request.state.view_as = target
    return target


def viewing_as(request: Request) -> Optional[str]:
    """The view-as role this request runs under (set by _get_user_role), or None."""
    return getattr(request.state, "view_as", None)


async def _get_user_role(
    tenant: Tenant, db: AsyncSession, request: Request
) -> str:
    """Resolve the current user's role (narrowed to a view-as role for an administrator who asks for one)."""
    return _apply_view_as(request, await _own_role(tenant, db, request))


async def _own_role(
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
                text("SELECT u.role, u.is_active, EXISTS (SELECT 1 FROM user_role_scopes g "
                     "WHERE g.tenant_id = u.tenant_id AND g.user_id = u.id AND g.role_key = u.role "
                     "AND g.system_id IS NULL AND g.module IS NULL AND g.expires_at <= now()) "
                     "FROM users u WHERE u.id = :uid AND u.tenant_id = :tid"),
                {"uid": local_user_id, "tid": str(tenant.id)},
            )
            row = result.fetchone()
            if row:
                if not row[1]:
                    raise HTTPException(status_code=403, detail="User account is deactivated")
                if row[2]:
                    return await _role_after_expiry(db, tenant.id, local_user_id, row[0])
                return row[0]
        # No authenticated user — fail closed (was: return "admin", a privilege
        # escalation if middleware ever failed to populate local_user_id).
        raise HTTPException(status_code=403, detail="Authentication required")
    return "analyst"


# ── Resource x action model ──────────────────────────────────────────────────

RESOURCES: tuple[str, ...] = (
    "systems", "credentials", "extraction", "analysis", "rules", "findings", "fixes", "mdm",
    "glossary", "stewardship", "contracts", "reports", "llm", "users", "licence", "audit", "process",
)
ACTIONS: tuple[str, ...] = ("view", "create", "edit", "approve", "run", "export", "admin")

_NO_VIEW = {"audit", "llm", "users", "licence", "credentials"}
# The legacy `export` action predates `process`; process export is granted only by export_process.
_NO_EXPORT = {"process"}

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
    # Create one stewardship task for a blocking rule (POST /stewardship/handoff); every `assign` holder has it too.
    "handoff_rule": {("stewardship", "create")},
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
    # Triage teams, assignment rules and SLA policies; business hours and holidays stay manage_settings.
    "manage_triage": {("stewardship", "admin")},
    "manage_llm": {("llm", "admin")},
    "manage_users": {("users", "admin")},
    "view_audit": {("audit", "view"), ("audit", "export")},
    "run_process_discovery": {("process", "run")},
    "export_process": {("process", "export")},
}


def _expand(pairs: set[tuple[str, str]]) -> set[tuple[str, str]]:
    """Concrete (resource, action) pairs; `*` expands to every resource (view skips _NO_VIEW, export _NO_EXPORT)."""
    out: set[tuple[str, str]] = set()
    for res, act in pairs:
        if res != "*":
            out.add((res, act))
        else:
            out |= {(r, act) for r in RESOURCES
                    if not (act == "view" and r in _NO_VIEW) and not (act == "export" and r in _NO_EXPORT)}
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
        text(f"SELECT role_key, system_id, module FROM user_role_scopes "
             f"WHERE user_id = :uid AND tenant_id = :tid AND {ACTIVE_GRANT_SQL}"),
        {"uid": user_id, "tid": str(tenant_id)},
    )
    grants = [(r[0], Scope(r[1], r[2])) for r in rows.fetchall()]
    if not grants and fallback_role:
        return [(fallback_role, Scope())]
    return grants


# A grant authorises until its expires_at (migration 096); NULL never expires. Used by every query that asks
# who holds what; the nightly purge (workers/tasks/purge_expired.py) deletes the rows afterwards.
ACTIVE_GRANT_SQL = "(expires_at IS NULL OR expires_at > now())"


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
    elif "/process-discovery/runs/" in path and pp.get("run_id"):
        rid = _as_uuid(pp.get("run_id"))
        if not rid:  # the route's own validation answers 422
            return Scope()
        r = await _row(db, "SELECT system_id FROM process_discovery_runs WHERE id = :i AND tenant_id = :t",
                       str(rid), tenant_id)
        sids.append(r[0] if r else None)
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
    if dev_role_override(request) is not None or viewing_as(request) or not uid:
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
        dev = dev_role_override(request) is not None or viewing_as(request) is not None
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
    "process_analyst": "Process analyst",
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


def active_users_holding_sync(session, tenant_id: uuid.UUID | str, user_ids: Iterable[str], action: str) -> set[str]:
    """The ids among ``user_ids`` of active users of this tenant who hold ``action`` tenant-wide: by users.role
    or by an unscoped grant (built-in or custom), the same answer require_permission gives a signed-in user.

    Synchronous (a Session or Connection) so a Celery worker can ask; a route calls it through
    ``AsyncSession.run_sync``. Every query carries tenant_id; RLS is the second line, not the only one."""
    ids = sorted({str(u) for u in user_ids if u})
    if not ids:
        return set()
    tid = str(tenant_id)
    users = session.execute(
        text("SELECT id::text, role FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
             "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": tid, "ids": ids}).fetchall()
    grants: dict[str, set[str]] = {}
    for uid, key in session.execute(
            text(f"SELECT user_id::text, role_key FROM user_role_scopes WHERE tenant_id = CAST(:t AS uuid) "
            f"AND user_id = ANY(CAST(:ids AS uuid[])) AND system_id IS NULL AND module IS NULL AND {ACTIVE_GRANT_SQL}"),
            {"t": tid, "ids": ids}).fetchall():
        grants.setdefault(uid, set()).add(key)
    custom: dict[str, set[str]] = {}

    def holds(key: str) -> bool:
        if not key.startswith("custom:"):
            return has_permission(key, action)
        if key not in custom:
            rows = session.execute(
                text("SELECT rp.resource, rp.action FROM role_permissions rp JOIN roles r ON r.id = rp.role_id "
                     "WHERE r.tenant_id = CAST(:t AS uuid) AND r.key = :key"), {"t": tid, "key": key}).fetchall()
            custom[key] = legacy_actions_for_pairs({(r[0], r[1]) for r in rows})
        return action in custom[key]

    return {uid for uid, role in users if any(holds(k) for k in {role, *grants.get(uid, set())})}


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
    extra: Iterable[Grant] = (),
) -> EffectivePermissions:
    """The /me/permissions shape. Not narrowed: union of every grant (what the nav needs).
    Narrowed: only grants covering (system_id, module). `extra` are proposed grants added to the user's
    own (the "after" of a grant preview); nothing is written."""
    grants = await user_grants(db, tenant_id, user_id, user_role)
    if narrowed:
        want = Scope(system_id, module)
        grants = [g for g in grants if _scope_matches(g[1], want)]
    grants = [*grants, *extra]
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


def grant_diff(before: EffectivePermissions, after: EffectivePermissions) -> dict[str, list]:
    """What a proposed grant adds. Pure: compares two EffectivePermissions and touches nothing else.

    added_actions  legacy actions in `after` and not in `before`
    added_pairs    (resource, action) cells newly true, as [resource, action]
    widened_scopes the scope of each role `after` holds that `before` did not (same key at the same scope
                   counts as held); both null means tenant-wide
    All lists are sorted, so equal inputs give equal output."""
    cells = {(r, a) for r, acts in after.resources.items() for a, ok in acts.items() if ok}
    had = {(r, a) for r, acts in before.resources.items() for a, ok in acts.items() if ok}
    held = {(x.key, x.system_id, x.module) for x in before.roles}
    new = {(x.system_id, x.module) for x in after.roles if (x.key, x.system_id, x.module) not in held}
    return {
        "added_actions": sorted(set(after.actions) - set(before.actions)),
        "added_pairs": [list(p) for p in sorted(cells - had)],
        "widened_scopes": [ScopeRef(system_id=s, module=m).model_dump()
                           for s, m in sorted(new, key=lambda t: (t[0] or "", t[1] or ""))],
    }


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
             "WHERE s.tenant_id = :t AND s.user_id = :u AND s.system_id IS NULL AND s.module IS NULL "
             "AND (s.expires_at IS NULL OR s.expires_at > now())"),
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
    """Append a role/grant/access-request row to audit_log (caller commits).

    The actor is attributed only when they are a user row of the tenant; a token for a user that no longer exists
    (or a service principal) still acts, and the row then names no user id instead of failing the request."""
    me = current_user_id(request)
    known = None
    if me:
        try:
            uuid.UUID(str(me))
        except (ValueError, TypeError, AttributeError):
            known = None
        else:
            known = (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                                      {"u": str(me), "t": str(tenant_id)})).fetchone()
    await db.execute(
        text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, "
             "method, path, status_code, before_json, after_json) "
             "VALUES (:t, :u, :e, :a, :et, :ei, :m, :p, 200, CAST(:b AS jsonb), CAST(:af AS jsonb))"),
        {"t": str(tenant_id), "u": str(me) if known else None, "e": current_user_label(), "a": action,
         "et": entity_type, "ei": entity_id, "m": request.method, "p": request.url.path,
         "b": json.dumps(before) if before is not None else None,
         "af": json.dumps(after) if after is not None else None},
    )
