"""API keys for service accounts: key format, hashing and the lookup LocalAuthMiddleware makes.

A key is ``mk_<prefix>.<secret>``. The prefix is public (12 hex characters, unique) and finds the row; the secret
is 32 random bytes, urlsafe, shown once at creation and stored only as a SHA-256 digest. The secret has far too
much entropy to guess, so a plain digest compared in constant time is enough (no slow password hash per request).

A key authenticates as its service user: a ``users`` row with no password whose email ends in
``SERVICE_EMAIL_DOMAIN``. That reserved domain is the marker: service users are not licence seats and are not
dormant or pending-invite users. Nothing here grants anything; authorisation is the user's grants, as for a person.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

KEY_SCHEME = "mk_"
SERVICE_EMAIL_DOMAIN = "service.meridian.invalid"
# SQL fragments: `col` is a users.email column reference.
IS_SERVICE_EMAIL_SQL = f"LOWER({{col}}) LIKE '%@{SERVICE_EMAIL_DOMAIN}'"
NOT_SERVICE_USER_SQL = f"LOWER({{col}}) NOT LIKE '%@{SERVICE_EMAIL_DOMAIN}'"
TOUCH_INTERVAL = timedelta(minutes=1)
INVALID_KEY_DETAIL = "Invalid API key."


def is_service_email(email: str) -> bool:
    return email.lower().endswith("@" + SERVICE_EMAIL_DOMAIN)


def service_email(prefix: str) -> str:
    return f"svc-{prefix}@{SERVICE_EMAIL_DOMAIN}"


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def new_key() -> tuple[str, str, str]:
    """(full key, prefix, secret hash). The full key is shown once and never stored."""
    prefix = secrets.token_hex(6)
    secret = secrets.token_urlsafe(32)
    return f"{KEY_SCHEME}{prefix}.{secret}", prefix, hash_secret(secret)


def parse_key(token: str) -> Optional[tuple[str, str]]:
    """(prefix, secret) of a well-formed ``mk_<prefix>.<secret>``, else None."""
    if not token.startswith(KEY_SCHEME) or token.count(".") != 1:
        return None
    prefix, secret = token[len(KEY_SCHEME):].split(".")
    if not prefix or not secret or len(prefix) > 64 or len(secret) > 256:
        return None
    return prefix, secret


@dataclass(frozen=True)
class ResolvedKey:
    key_id: str
    tenant_id: str
    user_id: str
    email: str
    role: str


class KeyRejected(Exception):
    """The key must not authenticate; ``detail`` is the plain sentence for the 401."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# Compared when no row matches, so an unknown prefix costs the same as a wrong secret.
_DUMMY_HASH = hash_secret("no such key")


def resolve_key_sync(token: str, lookup_tenant_id: str) -> ResolvedKey:
    """Check a presented key and, when it is good, record its use (at most once a minute).

    Raises KeyRejected for an unknown or wrong key, a revoked or expired key, and a suspended service user.
    The row is found under ``lookup_tenant_id`` (the deployment's tenant, as for sign-in) because the key does not
    say which tenant it belongs to; the resolved tenant is the row's own."""
    from api.deps import get_sync_engine_or_create

    parsed = parse_key(token)
    if parsed is None:
        raise KeyRejected(INVALID_KEY_DETAIL)
    prefix, secret = parsed
    with get_sync_engine_or_create().begin() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": lookup_tenant_id})
        row = conn.execute(text(
            "SELECT k.id, k.tenant_id, k.user_id, k.key_hash, k.expires_at, k.revoked_at, k.last_used_at, "
            "u.is_active, u.email, u.role, now() FROM api_keys k "
            "JOIN users u ON u.id = k.user_id AND u.tenant_id = k.tenant_id WHERE k.key_prefix = :p"),
            {"p": prefix}).fetchone()
        stored = row[3] if row else _DUMMY_HASH
        if not hmac.compare_digest(stored.encode("utf-8"), hash_secret(secret).encode("utf-8")) or row is None:
            raise KeyRejected(INVALID_KEY_DETAIL)
        key_id, tenant_id, user_id, _h, expires_at, revoked_at, last_used_at, is_active, email, role, now = row
        if revoked_at is not None:
            raise KeyRejected("This API key has been revoked.")
        if expires_at is not None and expires_at <= now:
            raise KeyRejected("This API key has expired.")
        if not is_active:
            raise KeyRejected("The service account for this API key is suspended.")
        if last_used_at is None or last_used_at <= now - TOUCH_INTERVAL:
            # The WHERE repeats the throttle so two requests racing past the check above write once.
            conn.execute(text(
                "UPDATE api_keys SET last_used_at = now() WHERE id = :i AND tenant_id = :t "
                "AND (last_used_at IS NULL OR last_used_at <= now() - interval '1 minute')"),
                {"i": str(key_id), "t": str(tenant_id)})
    return ResolvedKey(str(key_id), str(tenant_id), str(user_id), email, role)


def key_status(revoked_at: Optional[datetime], expires_at: Optional[datetime], user_active: bool,
               now: Optional[datetime] = None) -> str:
    """revoked | expired | suspended | active."""
    now = now or datetime.now(timezone.utc)
    if revoked_at is not None:
        return "revoked"
    if expires_at is not None and expires_at <= now:
        return "expired"
    return "active" if user_active else "suspended"
