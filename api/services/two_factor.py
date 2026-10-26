"""Two-factor sign-in, the database side: checking a code against a user, recovery codes, audit rows.

Sync (a SQLAlchemy Connection) because the local-auth routes in api/routes/auth.py are. The caller has
set ``app.tenant_id`` on the connection and commits. Code arithmetic lives in api/services/totp.py.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.engine import Connection

from api.services import totp
from api.services.rate_limiter import _client_ip

logger = logging.getLogger("meridian.two_factor")

Method = Literal["totp", "recovery"]

SECRET_UNAVAILABLE_DETAIL = "Two-factor sign-in is not available: the server cannot read its encryption key."


def encrypt_secret_or_503(tenant_id: str, secret: str) -> str:
    try:
        return totp.encrypt_secret(tenant_id, secret)
    except Exception as e:  # CREDENTIAL_MASTER_KEY unset
        logger.error(f"Could not encrypt a two-factor secret: {e}")
        raise HTTPException(status_code=503, detail=SECRET_UNAVAILABLE_DETAIL) from None


def decrypt_secret_or_503(tenant_id: str, stored: str) -> str:
    try:
        return totp.decrypt_secret(tenant_id, stored)
    except Exception as e:  # key missing or rotated without the previous key
        logger.error(f"Could not decrypt a two-factor secret: {e}")
        raise HTTPException(status_code=503, detail=SECRET_UNAVAILABLE_DETAIL) from None


def verify_second_factor(
    conn: Connection, tenant_id: str, user_id: str, code: str, stored_secret: str | None,
    last_step: int | None, allow_recovery: bool = True,
) -> Method | None:
    """Spend ``code`` for the user: an authenticator code (once per step, never an earlier step) or an
    unused recovery code. Both are single-use by a conditional UPDATE, so two requests racing with the
    same code cannot both pass. Returns how the user got in, or None."""
    if allow_recovery and totp.looks_like_recovery_code(code):
        row = conn.execute(
            text("UPDATE user_recovery_codes SET used_at = now() "
                 "WHERE tenant_id = :t AND user_id = :u AND code_hash = :h AND used_at IS NULL RETURNING id"),
            {"t": tenant_id, "u": user_id, "h": totp.hash_recovery_code(code)},
        ).fetchone()
        return "recovery" if row else None
    if not stored_secret:
        return None
    step = totp.matching_step(decrypt_secret_or_503(tenant_id, stored_secret), code, last_step=last_step)
    if step is None:
        return None
    row = conn.execute(
        text("UPDATE users SET totp_last_step = :s "
             "WHERE id = :u AND tenant_id = :t AND (totp_last_step IS NULL OR totp_last_step < :s) RETURNING id"),
        {"s": step, "u": user_id, "t": tenant_id},
    ).fetchone()
    return "totp" if row else None


def replace_recovery_codes(conn: Connection, tenant_id: str, user_id: str) -> list[str]:
    """Drop the user's recovery codes and store a fresh set; returns the plain codes (shown once)."""
    codes = totp.generate_recovery_codes()
    conn.execute(text("DELETE FROM user_recovery_codes WHERE tenant_id = :t AND user_id = :u"),
                 {"t": tenant_id, "u": user_id})
    for c in codes:
        conn.execute(
            text("INSERT INTO user_recovery_codes (tenant_id, user_id, code_hash) VALUES (:t, :u, :h)"),
            {"t": tenant_id, "u": user_id, "h": totp.hash_recovery_code(c)},
        )
    return codes


def recovery_codes_left(conn: Connection, tenant_id: str, user_id: str) -> int:
    return int(conn.execute(
        text("SELECT count(*) FROM user_recovery_codes WHERE tenant_id = :t AND user_id = :u AND used_at IS NULL"),
        {"t": tenant_id, "u": user_id},
    ).scalar() or 0)


# Clears a user's two-factor sign-in. The caller adds token_version = token_version + 1 when it should
# also end the user's sessions.
CLEAR_TWO_FACTOR_SET = "totp_secret = NULL, totp_enabled = false, totp_last_step = NULL"


def audit(conn: Connection, request: Request, tenant_id: str, user_id: str, email: str | None, action: str,
          status_code: int = 200, after: dict | None = None) -> None:
    """One audit_log row for a two-factor event, shaped like ``user.password_change`` (api/routes/auth.py):
    the user is both actor and entity. The audit middleware skips /api/v1/auth/*, so this is the only row."""
    import json

    conn.execute(
        text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, "
             "method, path, status_code, ip, after_json) "
             "VALUES (:t, :u, :e, :a, 'user', :u, :m, :p, :s, :ip, CAST(:af AS jsonb))"),
        {"t": tenant_id, "u": user_id, "e": email, "a": action, "m": request.method, "p": request.url.path,
         "s": status_code, "ip": _client_ip(request),
         "af": json.dumps(after) if after is not None else None},
    )
