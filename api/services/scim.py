"""SCIM 2.0 provisioning (RFC 7643 / 7644): the bearer token, errors, filters, PATCH helpers and role sync.

Token. ``mscim_<prefix>.<secret>`` where the prefix is the tenant id (32 hex) followed by 12 random hex characters.
The prefix is public and finds the row; it also names the tenant, so the lookup runs under that tenant's
row-level security (an identity provider calls with nothing else to identify the tenant). The secret is 32 random
bytes, shown once, stored as a SHA-256 digest and compared in constant time. One live token per tenant: rotating
revokes the previous one in the same transaction.

Group-to-role map. scim_group_role_map holds group displayName (case-insensitive) -> role key. A provisioned
user's unscoped grants follow their groups: ``sync_roles`` grants each mapped role they lack and takes away the
ones it granted earlier (scim_users.managed_roles) that no group maps any more. A grant an administrator made by
hand is never recorded as managed, so SCIM never removes it. The last active admin is never left without admin:
that change is refused (409).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.rbac import LEGACY_ROLES, VALID_ROLES, recompute_users_role

TOKEN_SCHEME = "mscim_"
ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"
LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group"
ENTERPRISE_SCHEMA = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
MEDIA_TYPE = "application/scim+json"
MAX_COUNT = 200
DEFAULT_COUNT = 100
INVALID_TOKEN = "The SCIM bearer token is missing, invalid or revoked."
_DUMMY_HASH = hashlib.sha256(b"no such token").hexdigest()


class ScimError(Exception):
    """Answered as a SCIM error body (RFC 7644 section 3.12)."""

    def __init__(self, status: int, detail: str, scim_type: Optional[str] = None) -> None:
        super().__init__(detail)
        self.status, self.detail, self.scim_type = status, detail, scim_type

    def body(self) -> dict[str, Any]:
        out: dict[str, Any] = {"schemas": [ERROR_SCHEMA], "status": str(self.status), "detail": self.detail}
        if self.scim_type:
            out["scimType"] = self.scim_type
        return out


# ── token ─────────────────────────────────────────────────────────────────────


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def new_token(tenant_id: uuid.UUID) -> tuple[str, str, str]:
    """(full token, prefix, secret digest). The full token is returned once and never stored."""
    prefix = uuid.UUID(str(tenant_id)).hex + secrets.token_hex(6)
    secret = secrets.token_urlsafe(32)
    return f"{TOKEN_SCHEME}{prefix}.{secret}", prefix, hash_secret(secret)


def parse_token(token: str) -> Optional[tuple[str, str, str]]:
    """(tenant id, prefix, secret) of a well-formed token, else None."""
    if not token.startswith(TOKEN_SCHEME) or token.count(".") != 1:
        return None
    prefix, secret = token[len(TOKEN_SCHEME):].split(".")
    if not re.fullmatch(r"[0-9a-f]{44}", prefix) or not secret or len(secret) > 256:
        return None
    return str(uuid.UUID(prefix[:32])), prefix, secret


@dataclass(frozen=True)
class ScimContext:
    tenant_id: uuid.UUID
    token_id: str
    prefix: str

    @property
    def actor(self) -> str:
        return f"scim:{self.prefix[32:]}"


def resolve_token_sync(token: str) -> ScimContext:
    """The tenant a presented token belongs to; ScimError(401) for anything else. Records use once a minute."""
    from api.deps import get_sync_engine_or_create

    parsed = parse_token(token)
    if parsed is None:
        raise ScimError(401, INVALID_TOKEN)
    tenant_id, prefix, secret = parsed
    with get_sync_engine_or_create().begin() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tenant_id})
        row = conn.execute(text(
            "SELECT id, token_hash, revoked_at, last_used_at, now() FROM scim_tokens "
            "WHERE token_prefix = :p AND tenant_id = :t"), {"p": prefix, "t": tenant_id}).fetchone()
        stored = row[1] if row else _DUMMY_HASH
        if not hmac.compare_digest(stored.encode(), hash_secret(secret).encode()) or row is None or row[2] is not None:
            raise ScimError(401, INVALID_TOKEN)
        conn.execute(text("UPDATE scim_tokens SET last_used_at = now() WHERE id = :i AND tenant_id = :t "
                          "AND (last_used_at IS NULL OR last_used_at <= now() - interval '1 minute')"),
                     {"i": str(row[0]), "t": tenant_id})
    return ScimContext(uuid.UUID(tenant_id), str(row[0]), prefix)


# ── request helpers ──────────────────────────────────────────────────────────


async def json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise ScimError(400, "The request body is not valid JSON.", "invalidSyntax")
    if not isinstance(body, dict):
        raise ScimError(400, "The request body must be a JSON object.", "invalidSyntax")
    return body


_FILTER = re.compile(r'^\s*([A-Za-z][\w.:]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$', re.IGNORECASE)


def parse_filter(raw: Optional[str], allowed: dict[str, str]) -> Optional[tuple[str, str]]:
    """``attr eq "value"`` -> (column key, value) for an attribute in ``allowed`` (lower-cased name -> key).
    Anything else is ScimError 400 invalidFilter. None when there is no filter."""
    if raw is None or not raw.strip():
        return None
    m = _FILTER.match(raw)
    if not m:
        raise ScimError(400, "Only filters of the form attribute eq \"value\" are supported.", "invalidFilter")
    attr = m.group(1).lower()
    if attr.startswith(USER_SCHEMA.lower() + ":"):
        attr = attr[len(USER_SCHEMA) + 1:]
    if attr not in allowed:
        raise ScimError(400, f"Filtering on {m.group(1)} is not supported.", "invalidFilter")
    return allowed[attr], json.loads(f'"{m.group(2)}"')


def paging(start_index: Optional[int], count: Optional[int]) -> tuple[int, int]:
    start = max(1, start_index or 1)
    n = DEFAULT_COUNT if count is None else max(0, min(MAX_COUNT, count))
    return start, n


def as_bool(value: Any) -> bool:
    """SCIM booleans; Entra ID sends "True"/"False" strings in PATCH."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise ScimError(400, "active must be true or false.", "invalidValue")


def member_ids(value: Any) -> list[str]:
    """[{value: id}, ...] (or one object) -> ids."""
    items = value if isinstance(value, list) else [value]
    out = []
    for item in items:
        if isinstance(item, dict) and item.get("value"):
            out.append(str(item["value"]))
        elif isinstance(item, str):
            out.append(item)
        else:
            raise ScimError(400, "Each member needs a value.", "invalidValue")
    return out


_VALUE_FILTER = re.compile(r'^(\w+)\[\s*value\s+eq\s+"([^"]+)"\s*\]$', re.IGNORECASE)


def path_value_filter(path: str) -> Optional[tuple[str, str]]:
    """'members[value eq "id"]' -> ('members', 'id')."""
    m = _VALUE_FILTER.match(path.strip())
    return (m.group(1).lower(), m.group(2)) if m else None


def as_uuid(value: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


# ── roles ────────────────────────────────────────────────────────────────────


async def valid_role(db: AsyncSession, tenant_id: uuid.UUID, role_key: str) -> bool:
    if role_key in VALID_ROLES:
        return role_key not in LEGACY_ROLES
    return bool((await db.execute(text("SELECT 1 FROM roles WHERE tenant_id = :t AND key = :k"),
                                  {"t": str(tenant_id), "k": role_key})).fetchone())


async def ensure_scim_user(db: AsyncSession, tenant_id: uuid.UUID, user_id: str) -> None:
    """A users row adopted by SCIM (as a group member) gets its scim_users row, userName = its email."""
    await db.execute(text(
        "INSERT INTO scim_users (user_id, tenant_id, user_name) SELECT u.id, u.tenant_id, u.email FROM users u "
        "WHERE u.id = :u AND u.tenant_id = :t ON CONFLICT (user_id) DO NOTHING"),
        {"u": user_id, "t": str(tenant_id)})


async def desired_roles(db: AsyncSession, tenant_id: uuid.UUID, user_id: str) -> set[str]:
    rows = await db.execute(text(
        "SELECT DISTINCT m.role_key FROM scim_group_members gm "
        "JOIN scim_groups g ON g.id = gm.group_id AND g.tenant_id = gm.tenant_id "
        "JOIN scim_group_role_map m ON m.tenant_id = g.tenant_id AND m.group_key = lower(g.display_name) "
        "WHERE gm.tenant_id = :t AND gm.user_id = :u"), {"t": str(tenant_id), "u": user_id})
    return {r[0] for r in rows.fetchall()}


async def sync_roles(db: AsyncSession, tenant_id: uuid.UUID, user_ids: Iterable[str]) -> dict[str, dict[str, list[str]]]:
    """Make each user's SCIM-managed unscoped grants match their groups. Returns {user: {added, removed}} for the
    users that changed (caller audits and commits). 409 (HTTPException) when it would remove the last admin."""
    from api.routes.roles import forbid_last_admin_grant

    changes: dict[str, dict[str, list[str]]] = {}
    for uid in sorted(set(user_ids)):
        await ensure_scim_user(db, tenant_id, uid)
        row = (await db.execute(text("SELECT managed_roles FROM scim_users WHERE user_id = :u AND tenant_id = :t "
                                     "FOR UPDATE"), {"u": uid, "t": str(tenant_id)})).fetchone()
        if row is None:
            continue
        managed = set(row[0] or [])
        want = {r for r in await desired_roles(db, tenant_id, uid) if await valid_role(db, tenant_id, r)}
        added, removed = [], []
        for role in sorted(want - managed):
            hit = (await db.execute(text(
                "INSERT INTO user_role_scopes (tenant_id, user_id, role_key) VALUES (:t, :u, :r) "
                "ON CONFLICT DO NOTHING RETURNING id"), {"t": str(tenant_id), "u": uid, "r": role})).fetchone()
            if hit:  # an existing hand-made grant stays the administrator's, never SCIM's to remove
                managed.add(role)
                added.append(role)
        for role in sorted(managed - want):
            grants = (await db.execute(text(
                "SELECT id FROM user_role_scopes WHERE tenant_id = :t AND user_id = :u AND role_key = :r "
                "AND system_id IS NULL AND module IS NULL"), {"t": str(tenant_id), "u": uid, "r": role})).fetchall()
            for (gid,) in grants:
                await forbid_last_admin_grant(db, tenant_id, uuid.UUID(uid), gid, role)
                await db.execute(text("DELETE FROM user_role_scopes WHERE id = :g AND tenant_id = :t"),
                                 {"g": str(gid), "t": str(tenant_id)})
            managed.discard(role)
            removed.append(role)
        if added or removed:
            await db.execute(text("UPDATE scim_users SET managed_roles = :m, updated_at = now() "
                                  "WHERE user_id = :u AND tenant_id = :t"),
                             {"m": sorted(managed), "u": uid, "t": str(tenant_id)})
            await recompute_users_role(db, tenant_id, uid)
            changes[uid] = {"added": added, "removed": removed}
    return changes


async def scim_audit(db: AsyncSession, ctx_actor: str, tenant_id: uuid.UUID, request: Request, action: str,
                     entity_type: str, entity_id: str, before: Optional[dict], after: Optional[dict],
                     status_code: int = 200) -> None:
    """One audit_log row per SCIM mutation, attributed to the token (the caller commits)."""
    await db.execute(text(
        "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
        "status_code, ip, user_agent, before_json, after_json) VALUES (:t, NULL, :a, :ac, :et, :ei, :m, :p, :s, :ip, "
        ":ua, CAST(:b AS jsonb), CAST(:af AS jsonb))"),
        {"t": str(tenant_id), "a": ctx_actor, "ac": action, "et": entity_type, "ei": entity_id, "m": request.method,
         "p": request.url.path, "s": status_code, "ip": request.client.host if request.client else None,
         "ua": (request.headers.get("user-agent") or "")[:300] or None,
         "b": json.dumps(before, default=str) if before is not None else None,
         "af": json.dumps(after, default=str) if after is not None else None})


def http_to_scim(e: HTTPException) -> ScimError:
    detail = e.detail if isinstance(e.detail, str) else "The request could not be completed."
    return ScimError(e.status_code, detail)
