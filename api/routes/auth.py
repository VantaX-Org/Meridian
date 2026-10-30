"""Local authentication endpoints — login and current-user lookup.

Active only when AUTH_MODE=local.
"""

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from api.services.rbac import (
    BUILTIN_NAMES,
    PERMISSIONS, PERSONA_ROLES, current_user_id, home_for, permissions_for, require_permission,
    unscoped_actions_sync, write_audit_sync,
)
from api.deps import get_sync_engine_or_create
from api.services.local_auth import (
    create_access_token,
    decode_access_token,
    MIN_PASSWORD_LENGTH,
    generate_jwt_secret,
    validate_password,
    verify_password,
)
from api.middleware.local_auth import forget_token_version
from api.services.rate_limiter import rate_limit

# Login endpoint is unauthenticated, so rate-limit by IP: 10 attempts per
# minute. Tight enough to slow credential stuffing, loose enough that a
# legitimate user fat-fingering the password a few times isn't locked out.
_login_rate_limit = rate_limit("auth_login", limit=10, window_s=60, key_by="ip")
# Password-reset and invite-accept flows are unauthenticated and email-driven.
# Rate-limit by IP to blunt enumeration and reset-email flooding: 5/min.
_forgot_rate_limit = rate_limit("auth_forgot", limit=5, window_s=60, key_by="ip")
_reset_rate_limit = rate_limit("auth_reset", limit=5, window_s=60, key_by="ip")
_invite_rate_limit = rate_limit("auth_invite", limit=5, window_s=60, key_by="ip")
_invite_preview_rate_limit = rate_limit("auth_invite_preview", limit=5, window_s=60, key_by="ip")
# Per signed-in user (the session token's subject): bounds guessing the current password with a stolen session.
_change_password_rate_limit = rate_limit("auth_change_password", limit=5, window_s=60, key_by="user")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Per-account lockout (on top of the IP rate limit): this many wrong passwords in a row lock the account for
# LOCKOUT_MINUTES. Success resets the count; an admin reset or the lock running out also clears it.
LOCKOUT_THRESHOLD = 10
LOCKOUT_MINUTES = 15

DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_column_exists_cache: dict[tuple[str, str], bool] = {}


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    permissions: list[str] = []
    home: str = "/"


class LoginResponse(BaseModel):
    token: str
    user: UserResponse
    # True when the authenticating user still has the default seeded
    # password. The frontend routes to a mandatory password-change
    # screen; the API returns 409 on any other endpoint until the
    # rotation completes.
    must_change_password: bool = False


class MeResponse(BaseModel):
    user: UserResponse
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ChangePasswordResponse(BaseModel):
    ok: bool = True
    # The change revokes every session issued before it, including the caller's: this is the
    # caller's replacement session token.
    token: str


def _get_sync_connection():
    """Get a synchronous DB connection for auth operations."""
    engine = get_sync_engine_or_create()
    return engine.connect()


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    key = (table_name, column_name)
    if key in _column_exists_cache:
        return _column_exists_cache[key]

    exists = bool(
        conn.execute(
            text(
                "SELECT 1 "
                "FROM information_schema.columns "
                "WHERE table_name = :table_name AND column_name = :column_name"
            ),
            {"table_name": table_name, "column_name": column_name},
        ).fetchone()
    )
    _column_exists_cache[key] = exists
    return exists


def _ensure_local_auth_schema(conn) -> None:
    has_password_hash = _column_exists(conn, "users", "password_hash")
    has_jwt_secret = _column_exists(conn, "tenants", "jwt_secret")
    if has_password_hash and has_jwt_secret:
        return

    raise HTTPException(
        status_code=503,
        detail=(
            "Local auth schema is not fully migrated. "
            "Run database migrations (`alembic upgrade head`) and restart the API."
        ),
    )


def cookie_secure(request: Request) -> bool:
    """Whether to mark auth cookies Secure. AUTH_COOKIE_SECURE=true or false forces it; by default it follows the
    address the browser used (nginx's X-Forwarded-Proto). A Secure cookie on a plain http:// install is never
    stored, so the help videos and other cookie-signed requests were refused."""
    forced = os.getenv("AUTH_COOKIE_SECURE", "auto").lower()
    if forced in ("true", "false"):
        return forced == "true"
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return (proto or request.url.scheme) == "https"


def _set_auth_cookie(response: Response, token: str, request: Request) -> None:
    """Cookie fallback for browser-initiated requests (anchor downloads, the help centre's <video>) where custom
    Authorization headers are not attached. httponly so JS can't read the JWT; Secure on HTTPS (`cookie_secure`)."""
    response.set_cookie(
        key="mn_auth_token",
        value=token,
        max_age=24 * 60 * 60,
        path="/",
        samesite="lax",
        httponly=True,
        secure=cookie_secure(request),
    )


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(_login_rate_limit)])
def login(body: LoginRequest, request: Request, response: Response):
    """Authenticate with email/password and receive a JWT."""
    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        conn.execute(text(f"SET app.tenant_id = \'{str(DEV_TENANT_ID)}\'"))
        supports_must_change = _column_exists(conn, "users", "must_change_password")

        # Look up user
        must_change_select = "must_change_password" if supports_must_change else "false as must_change_password"
        row = conn.execute(
            text(
                f"SELECT id, email, name, role, password_hash, is_active, {must_change_select}, token_version, "
                "CASE WHEN locked_until > now() THEN CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60)::int END "
                "FROM users WHERE LOWER(email) = LOWER(:email) AND tenant_id = :tid"
            ),
            {"email": (body.email or "").strip(), "tid": DEV_TENANT_ID},
        ).fetchone()

        # SSO enforced (api/routes/auth_oidc.py): password sign-in is for administrators only (break-glass). Unknown
        # emails get the same answer as non-administrators, so this reveals nothing about who has an account.
        from api.services import oidc as _oidc

        typed_email = (body.email or "").strip()[:320]

        def refuse(status: int, detail: str, reason: str) -> HTTPException:
            """Audit the refused sign-in (email as typed and the address, never the password) and commit it."""
            write_audit_sync(conn, DEV_TENANT_ID, request, "auth.login_failed", "user",
                             str(row[0]) if row else None, None, {"email": typed_email, "reason": reason},
                             actor_user_id=str(row[0]) if row else None, actor_email=typed_email,
                             status_code=status)
            conn.commit()
            return HTTPException(status_code=status, detail=detail)

        if _oidc.is_enforced(_oidc.load_config(conn, DEV_TENANT_ID)) and not _oidc.holds_break_glass(
                conn, DEV_TENANT_ID, str(row[0]) if row else None, row[3] if row else None):
            raise refuse(403, "Your organisation requires single sign-on. Use Continue with single sign-on.",
                         "sso_required")

        if not row or not row[5]:  # not found or inactive
            raise refuse(401, "Invalid credentials", "unknown_or_inactive")

        if not row[4]:  # no password_hash set
            raise refuse(401, "Invalid credentials", "no_password")

        if row[8]:  # locked: refused before the password is looked at, so a guesser learns nothing from it
            raise refuse(
                423,
                f"This account is locked after too many failed sign-ins. Try again in {row[8]} "
                f"minute{'' if row[8] == 1 else 's'}.",
                "locked")

        if not verify_password(body.password, row[4]):
            # Atomic count; the lock starts on the LOCKOUT_THRESHOLD-th failure, the next attempt gets 423.
            # A count left over from an expired lock restarts at one. A locked account never reaches this
            # update (it is refused above), so "locked after it" means this failure started the lock.
            counted = conn.execute(
                text("UPDATE users SET "
                     "failed_login_count = CASE WHEN locked_until <= now() THEN 1 ELSE failed_login_count + 1 END, "
                     "locked_until = CASE WHEN (CASE WHEN locked_until <= now() THEN 1 ELSE failed_login_count + 1 END) "
                     ">= :n THEN now() + make_interval(mins => :m) ELSE locked_until END WHERE id = :uid "
                     "RETURNING failed_login_count, COALESCE(locked_until > now(), false)"),
                {"n": LOCKOUT_THRESHOLD, "m": LOCKOUT_MINUTES, "uid": str(row[0])}).fetchone()
            if counted and counted[1]:
                write_audit_sync(conn, DEV_TENANT_ID, request, "auth.lockout", "user", str(row[0]), None,
                                 {"email": row[1], "failed_login_count": int(counted[0]),
                                  "locked_minutes": LOCKOUT_MINUTES},
                                 actor_user_id=str(row[0]), actor_email=row[1], status_code=401)
            raise refuse(401, "Invalid credentials", "wrong_password")

        must_change = bool(row[6])

        # Ensure tenant has a jwt_secret
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": DEV_TENANT_ID},
        ).fetchone()

        jwt_secret = secret_row[0] if secret_row and secret_row[0] else None
        if not jwt_secret:
            jwt_secret = generate_jwt_secret()
            conn.execute(
                text("UPDATE tenants SET jwt_secret = :secret WHERE id = :tid"),
                {"secret": jwt_secret, "tid": DEV_TENANT_ID},
            )
            conn.commit()

        user_id = str(row[0])
        token = create_access_token(
            user_id=user_id,
            tenant_id=DEV_TENANT_ID,
            email=row[1],
            role=row[3],
            secret=jwt_secret,
            token_version=int(row[7]),
        )
        _set_auth_cookie(response, token, request)

        # Update last_login
        conn.execute(
            text("UPDATE users SET last_login = :now, failed_login_count = 0, locked_until = NULL WHERE id = :uid"),
            {"now": datetime.now(timezone.utc), "uid": user_id},
        )
        write_audit_sync(conn, DEV_TENANT_ID, request, "auth.login", "user", user_id, None,
                         {"email": row[1], "method": "password"}, actor_user_id=user_id, actor_email=row[1])
        conn.commit()

        return LoginResponse(
            token=token,
            user=UserResponse(id=user_id, email=row[1], name=row[2], role=row[3],
                              permissions=unscoped_actions_sync(conn, str(DEV_TENANT_ID), user_id, row[3]),
                              home=home_for(row[3])),
            must_change_password=must_change,
        )


@router.get("/roles", dependencies=[Depends(require_permission("view"))])
async def role_matrix() -> dict[str, list[str]]:
    """The permission matrix itself (api/services/rbac.py) — the UI never keeps a copy."""
    return {role: permissions_for(role) for role in (*PERMISSIONS, *PERSONA_ROLES)}


@router.get("/me", response_model=MeResponse)
def me(request: Request):
    """Return the current authenticated user from the JWT."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = auth_header[7:]

    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        supports_must_change = _column_exists(conn, "users", "must_change_password")
        # Get jwt_secret
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": DEV_TENANT_ID},
        ).fetchone()

        if not secret_row or not secret_row[0]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        payload = decode_access_token(token, secret_row[0])
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        # Look up user
        conn.execute(text(f"SET app.tenant_id = \'{str(DEV_TENANT_ID)}\'"))
        must_change_select = "must_change_password" if supports_must_change else "false as must_change_password"
        row = conn.execute(
            text(
                f"SELECT id, email, name, role, is_active, {must_change_select} "
                "FROM users WHERE id = :uid AND tenant_id = :tid"
            ),
            {"uid": payload["sub"], "tid": DEV_TENANT_ID},
        ).fetchone()

        if not row or not row[4]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        return MeResponse(
            user=UserResponse(id=str(row[0]), email=row[1], name=row[2], role=row[3],
                              permissions=unscoped_actions_sync(conn, str(DEV_TENANT_ID), str(row[0]), row[3]),
                              home=home_for(row[3])),
            must_change_password=bool(row[5]) if len(row) > 5 else False,
        )


# ── Password rotation ────────────────────────────────────────────────────────

# Password policy (api/services/local_auth.validate_password): 12+ characters, not the email's name, not on the
# bundled common list, not the current password. Operators can plug in something stricter
# by configuring their identity provider and bypassing local auth.


@router.post("/change-password", response_model=ChangePasswordResponse,
             dependencies=[Depends(_change_password_rate_limit)])
def change_password(body: ChangePasswordRequest, request: Request, response: Response):
    """Rotate the password for the currently-authenticated user.

    Accepted even when `must_change_password` is true on the account —
    in fact that's the intended path. Clears the flag on success so
    the user can proceed with normal API use. Writes an ``auth.password_change`` audit row.

    Revokes every other session: bumps ``users.token_version``, so LocalAuthMiddleware rejects
    any token issued before the change (a stolen session dies with the old password). The
    caller's own session is replaced, not ended: the response carries a fresh token (and
    cookie) at the new version, which the frontend stores in place of the old one.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header[7:]

    new_password = (body.new_password or "").strip()
    if new_password == body.current_password:
        raise HTTPException(status_code=422, detail="New password must differ from the current one.")

    from api.services.local_auth import hash_password

    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": DEV_TENANT_ID},
        ).fetchone()
        if not secret_row or not secret_row[0]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        payload = decode_access_token(token, secret_row[0])
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        conn.execute(text(f"SET app.tenant_id = \'{str(DEV_TENANT_ID)}\'"))
        row = conn.execute(
            text("SELECT id, password_hash, is_active, email, role FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": payload["sub"], "tid": DEV_TENANT_ID},
        ).fetchone()
        if not row or not row[2]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        if not row[1] or not verify_password(body.current_password, row[1]):
            # 422 like the other input errors here: a 401 would sign the user out (frontend/lib/api/client.ts)
            raise HTTPException(status_code=422, detail="Current password is incorrect")

        reason = validate_password(new_password, row[3])
        if reason:
            raise HTTPException(status_code=422, detail=reason)

        version = conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false, token_version = token_version + 1, "
                "password_changed_at = now() "
                "WHERE id = :uid RETURNING token_version"
            ),
            {"ph": hash_password(new_password), "uid": str(row[0])},
        ).fetchone()
        write_audit_sync(conn, DEV_TENANT_ID, request, "auth.password_change", "user", str(row[0]), None,
                         {"email": row[3], "sessions_revoked": True},
                         actor_user_id=str(row[0]), actor_email=row[3])
        conn.commit()
        forget_token_version(str(row[0]))
        token = create_access_token(
            user_id=str(row[0]),
            tenant_id=DEV_TENANT_ID,
            email=row[3],
            role=row[4],
            secret=secret_row[0],
            token_version=int(version[0]),
        )
    _set_auth_cookie(response, token, request)
    return ChangePasswordResponse(token=token)


@router.post("/logout", status_code=204)
def logout(request: Request) -> Response:
    """Sign out: clear the session cookie and write an ``auth.logout`` audit row.

    Behind LocalAuthMiddleware, so only a signed-in caller reaches it. The browser drops its own token;
    other sessions of the same user stay valid (changing the password is what revokes them)."""
    from api.middleware.local_auth import get_current_user

    user_id = current_user_id(request)
    email = (get_current_user() or {}).get("email")
    try:
        user_id = str(uuid.UUID(str(user_id))) if user_id else None
    except ValueError:
        user_id = None  # an API key or service principal: there is no session to end
    if user_id:
        engine = get_sync_engine_or_create()
        with engine.connect() as conn:
            conn.execute(text(f"SET app.tenant_id = \'{str(DEV_TENANT_ID)}\'"))
            known = conn.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = :t"),
                                 {"u": user_id, "t": DEV_TENANT_ID}).fetchone()
            write_audit_sync(conn, DEV_TENANT_ID, request, "auth.logout", "user", user_id, None,
                             {"email": email} if email else None,
                             actor_user_id=user_id if known else None, actor_email=email)
            conn.commit()
    out = Response(status_code=204)
    out.delete_cookie("mn_auth_token", path="/", samesite="lax", httponly=True, secure=cookie_secure(request))
    return out


class AcceptInviteRequest(BaseModel):
    token: str
    password: str


@router.post("/accept-invite", dependencies=[Depends(_invite_rate_limit)])
def accept_invite(body: AcceptInviteRequest):
    """Accept an invitation: set a new user's first password from an emailed token.

    The token is a signed JWT issued by /users/invite with a ``purpose`` of
    ``invite_accept``. Single-use: only succeeds while the user still has
    ``password_hash IS NULL`` — once they've set a password, the link is
    rejected so a leaked email link can't reset an active account.
    """
    new_password = (body.password or "").strip()
    if len(new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=422, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")

    from api.services.local_auth import hash_password

    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": DEV_TENANT_ID},
        ).fetchone()
        if not secret_row or not secret_row[0]:
            raise HTTPException(status_code=503, detail="Auth not configured")

        payload = decode_access_token(body.token, secret_row[0])
        if not payload or payload.get("purpose") != "invite_accept":
            raise HTTPException(
                status_code=400,
                detail="Invitation link is invalid or has expired. Please request a new invitation.",
            )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=400, detail="Invalid invitation token")

        conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))

        pending = conn.execute(
            text("SELECT email FROM users WHERE id = :uid AND tenant_id = :tid AND password_hash IS NULL "
                 "AND is_active = true"),
            {"uid": user_id, "tid": DEV_TENANT_ID},
        ).fetchone()
        if pending:
            reason = validate_password(new_password, pending[0])
            if reason:
                raise HTTPException(status_code=422, detail=reason)

        # Atomic: only succeeds if no password set yet. Replay after the user
        # has activated returns 409 instead of silently overwriting.
        result = conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false, invite_status = 'accepted', "
                "password_changed_at = now() "
                "WHERE id = :uid AND tenant_id = :tid AND password_hash IS NULL AND is_active = true "
                "RETURNING id, email"
            ),
            {"ph": hash_password(new_password), "uid": user_id, "tid": DEV_TENANT_ID},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(
                status_code=409,
                detail="This invitation has already been used. Sign in with the password you set, or ask an admin to resend the invite.",
            )
        conn.commit()

    return {"ok": True, "email": row[1]}


class InvitePreviewRequest(BaseModel):
    token: str


@router.post("/invite/preview", dependencies=[Depends(_invite_preview_rate_limit)])
def invite_preview(body: InvitePreviewRequest):
    """What an invite grants, shown before the invitee sets a password.

    Validates the token exactly as accept-invite does. Any failure (bad, expired, wrong
    purpose, already used) is one generic 404 so the response never confirms which.
    """
    not_found = HTTPException(status_code=404, detail="Not found")
    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"), {"tid": DEV_TENANT_ID},
        ).fetchone()
        if not secret_row or not secret_row[0]:
            raise not_found
        payload = decode_access_token(body.token, secret_row[0])
        user_id = payload.get("sub") if payload and payload.get("purpose") == "invite_accept" else None
        if not user_id:
            raise not_found
        conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))
        user = conn.execute(
            text("SELECT email, role FROM users WHERE id = :uid AND tenant_id = :tid AND password_hash IS NULL AND is_active = true"),
            {"uid": user_id, "tid": DEV_TENANT_ID},
        ).fetchone()
        if not user:
            raise not_found
        rows = conn.execute(
            text(
                "SELECT g.role_key, r.name, g.system_id, s.name, g.module "
                "FROM user_role_scopes g "
                "LEFT JOIN roles r ON r.key = g.role_key AND r.tenant_id = g.tenant_id "
                "LEFT JOIN sap_systems s ON s.id = g.system_id AND s.tenant_id = g.tenant_id "
                "WHERE g.user_id = :uid AND g.tenant_id = :tid ORDER BY g.role_key"
            ),
            {"uid": user_id, "tid": DEV_TENANT_ID},
        ).fetchall()
    grants = [
        {"role_key": r[0], "role_label": r[1] or BUILTIN_NAMES.get(r[0], r[0]), "system_id": str(r[2]) if r[2] else None,
         "system_name": r[3], "module": r[4]}
        for r in rows
    ] or [{"role_key": user[1], "role_label": BUILTIN_NAMES.get(user[1], user[1]), "system_id": None, "system_name": None, "module": None}]
    return {"email": user[0], "grants": grants}


class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password", dependencies=[Depends(_forgot_rate_limit)])
def forgot_password(body: ForgotPasswordRequest):
    """Send a password-reset email to the given address.

    Always returns 200 — never reveals whether an account exists for that
    email, to prevent enumeration. The reset link is sent asynchronously
    via the worker; queue/send failures are logged, not surfaced.
    """
    email = (body.email or "").strip().lower()
    if not email:
        return {"ok": True}

    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": DEV_TENANT_ID},
        ).fetchone()
        if not secret_row or not secret_row[0]:
            return {"ok": True}

        conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))
        row = conn.execute(
            text(
                "SELECT id, name, token_version FROM users "
                "WHERE LOWER(email) = :em AND tenant_id = :tid "
                "  AND is_active = true AND password_hash IS NOT NULL"
            ),
            {"em": email, "tid": DEV_TENANT_ID},
        ).fetchone()

        if row:
            from api.services.local_auth import create_password_reset_token

            reset_token = create_password_reset_token(
                str(row[0]), DEV_TENANT_ID, secret_row[0], token_version=int(row[2])
            )
            try:
                from workers.tasks.send_password_reset import send_password_reset_email

                send_password_reset_email.delay(
                    user_id=str(row[0]),
                    tenant_id=DEV_TENANT_ID,
                    recipient_email=email,
                    recipient_name=row[1] or email.split("@")[0],
                    reset_token=reset_token,
                )
            except Exception as e:
                import logging
                logging.getLogger("meridian.auth").error(
                    f"Could not queue password reset email: {e}"
                )

    return {"ok": True}


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


@router.post("/reset-password", dependencies=[Depends(_reset_rate_limit)])
def reset_password(body: ResetPasswordRequest):
    """Reset a user's password from an emailed reset token."""
    new_password = (body.password or "").strip()
    if len(new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=422, detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")

    from api.services.local_auth import hash_password

    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        secret_row = conn.execute(
            text("SELECT jwt_secret FROM tenants WHERE id = :tid"),
            {"tid": DEV_TENANT_ID},
        ).fetchone()
        if not secret_row or not secret_row[0]:
            raise HTTPException(status_code=503, detail="Auth not configured")

        payload = decode_access_token(body.token, secret_row[0])
        if not payload or payload.get("purpose") != "password_reset":
            raise HTTPException(
                status_code=400,
                detail="Reset link is invalid or has expired. Request a new one from the Forgot password page.",
            )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=400, detail="Invalid reset token")

        conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))

        current = conn.execute(
            text("SELECT email, password_hash, token_version FROM users WHERE id = :uid AND tenant_id = :tid "
                 "AND is_active = true"),
            {"uid": user_id, "tid": DEV_TENANT_ID},
        ).fetchone()
        if current:
            # A link carrying the version it was minted at works once: the reset bumps token_version.
            if "tv" in payload and payload["tv"] != current[2]:
                raise HTTPException(
                    status_code=400,
                    detail="Reset link is invalid or has expired. Request a new one from the Forgot password page.",
                )
            reason = validate_password(new_password, current[0], current[1])
            if reason:
                raise HTTPException(status_code=422, detail=reason)

        result = conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false, token_version = token_version + 1, "
                "password_changed_at = now(), failed_login_count = 0, locked_until = NULL "
                "WHERE id = :uid AND tenant_id = :tid AND is_active = true "
                "RETURNING id, email"
            ),
            {"ph": hash_password(new_password), "uid": user_id, "tid": DEV_TENANT_ID},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Account not found or inactive")
        conn.commit()
        # Every session issued before the reset is revoked (users.token_version).
        forget_token_version(str(row[0]))

    return {"ok": True, "email": row[1]}
