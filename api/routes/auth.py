"""Local authentication endpoints — login and current-user lookup.

Active only when AUTH_MODE=local.
"""

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from api.services.rbac import (
    BUILTIN_NAMES,
    PERMISSIONS, PERSONA_ROLES, home_for, permissions_for, require_permission, unscoped_actions_sync,
)
from api.deps import get_sync_engine_or_create
from api.services.local_auth import (
    create_access_token,
    create_mfa_pending_token,
    decode_access_token,
    generate_jwt_secret,
    verify_password,
)
from api.middleware.local_auth import forget_token_version
from api.services import totp, two_factor
from api.services.rate_limiter import limit_identity, rate_limit

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
# Two-factor codes: six digits is a million guesses, so attempts are bounded per user (the pending
# sign-in's user, or the signed-in user) as well as per IP. Five in five minutes.
_CODE_LIMIT, _CODE_WINDOW_S = 5, 300
_login_code_ip_rate_limit = rate_limit("auth_2fa_login_ip", limit=10, window_s=60, key_by="ip")
_code_rate_limit = rate_limit("auth_2fa_code", limit=_CODE_LIMIT, window_s=_CODE_WINDOW_S, key_by="user")
_setup_rate_limit = rate_limit("auth_2fa_setup", limit=10, window_s=60, key_by="user")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

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
    home: str = "/home/lead"


class LoginResponse(BaseModel):
    # Both absent when `mfa_required`: the password was right, the session comes from /login/2fa.
    token: str | None = None
    user: UserResponse | None = None
    # True when the authenticating user still has the default seeded
    # password. The frontend routes to a mandatory password-change
    # screen; the API returns 409 on any other endpoint until the
    # rotation completes.
    must_change_password: bool = False
    # The user has two-factor sign-in: send `mfa_token` and a code to POST /login/2fa.
    mfa_required: bool = False
    mfa_token: str | None = None
    # The tenant requires two-factor sign-in and the user has none: the session reaches only the
    # set-up routes (api/middleware/local_auth.py MFA_ENROL_PATHS) until it is confirmed.
    must_enrol_2fa: bool = False


class MeResponse(BaseModel):
    user: UserResponse
    must_change_password: bool = False
    must_enrol_2fa: bool = False


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


def _set_auth_cookie(response: Response, token: str) -> None:
    """Cookie fallback for browser-initiated downloads (anchor/open-in-new-tab)
    where custom Authorization headers are not reliably attached. httponly
    so JS can't read the JWT (the browser still sends it on downloads);
    secure by default — set AUTH_COOKIE_SECURE=false only for local HTTP dev."""
    cookie_secure = os.getenv("AUTH_COOKIE_SECURE", "true").lower() != "false"
    response.set_cookie(
        key="mn_auth_token",
        value=token,
        max_age=24 * 60 * 60,
        path="/",
        samesite="lax",
        httponly=True,
        secure=cookie_secure,
    )


def _require_2fa(conn) -> bool:
    """tenants.require_2fa of the local-auth tenant (migration 094)."""
    row = conn.execute(text("SELECT require_2fa FROM tenants WHERE id = :tid"), {"tid": DEV_TENANT_ID}).fetchone()
    return bool(row and row[0])


def _tenant_jwt_secret(conn) -> str:
    """The local-auth tenant's jwt_secret; minted on first use."""
    row = conn.execute(text("SELECT jwt_secret FROM tenants WHERE id = :tid"), {"tid": DEV_TENANT_ID}).fetchone()
    if row and row[0]:
        return row[0]
    jwt_secret = generate_jwt_secret()
    conn.execute(text("UPDATE tenants SET jwt_secret = :secret WHERE id = :tid"),
                 {"secret": jwt_secret, "tid": DEV_TENANT_ID})
    conn.commit()
    return jwt_secret


# The users columns a sign-in reads, in this order (_issue_session and login_second_step index them).
_SIGN_IN_COLUMNS = ("id, email, name, role, password_hash, is_active, {must}, token_version, "
                    "totp_enabled, totp_secret, totp_last_step")


def _sign_in_row(conn, where: str, params: dict):
    must = "must_change_password" if _column_exists(conn, "users", "must_change_password") \
        else "false as must_change_password"
    return conn.execute(
        text(f"SELECT {_SIGN_IN_COLUMNS.format(must=must)} FROM users WHERE {where} AND tenant_id = :tid"),
        {**params, "tid": DEV_TENANT_ID},
    ).fetchone()


def _issue_session(conn, response: Response, row, jwt_secret: str) -> LoginResponse:
    """The session for a user who has passed every sign-in step: token, cookie and last_login.

    When the tenant requires two-factor sign-in and the user has none, the token is marked
    ``mfa_enrol`` and LocalAuthMiddleware lets it reach only the set-up routes.
    """
    user_id = str(row[0])
    must_enrol = not bool(row[8]) and _require_2fa(conn)
    token = create_access_token(
        user_id=user_id,
        tenant_id=DEV_TENANT_ID,
        email=row[1],
        role=row[3],
        secret=jwt_secret,
        token_version=int(row[7]),
        mfa_enrol=must_enrol,
    )
    _set_auth_cookie(response, token)

    # Update last_login
    conn.execute(
        text("UPDATE users SET last_login = :now WHERE id = :uid"),
        {"now": datetime.now(timezone.utc), "uid": user_id},
    )
    conn.commit()

    return LoginResponse(
        token=token,
        user=UserResponse(id=user_id, email=row[1], name=row[2], role=row[3],
                          permissions=unscoped_actions_sync(conn, str(DEV_TENANT_ID), user_id, row[3]),
                          home=home_for(row[3])),
        must_change_password=bool(row[6]),
        must_enrol_2fa=must_enrol,
    )


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(_login_rate_limit)])
def login(body: LoginRequest, response: Response):
    """Authenticate with email/password and receive a JWT.

    A user with two-factor sign-in gets no session here: the response says ``mfa_required`` and
    carries a five-minute pending token for POST /login/2fa.
    """
    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))

        # Look up user
        row = _sign_in_row(conn, "LOWER(email) = LOWER(:email)", {"email": (body.email or "").strip()})

        if not row or not row[5]:  # not found or inactive
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if not row[4]:  # no password_hash set
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if not verify_password(body.password, row[4]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        jwt_secret = _tenant_jwt_secret(conn)

        if row[8]:  # totp_enabled: the password alone is not a session
            return LoginResponse(
                mfa_required=True,
                mfa_token=create_mfa_pending_token(str(row[0]), DEV_TENANT_ID, jwt_secret, int(row[7])),
            )

        return _issue_session(conn, response, row, jwt_secret)


class LoginCodeRequest(BaseModel):
    mfa_token: str
    code: str


_PENDING_EXPIRED_DETAIL = "Your sign-in timed out. Enter your email and password again."
_WRONG_CODE_DETAIL = "That code did not work. Check the time on your phone, or use a recovery code."


@router.post("/login/2fa", response_model=LoginResponse, dependencies=[Depends(_login_code_ip_rate_limit)])
def login_second_step(body: LoginCodeRequest, request: Request, response: Response):
    """The second sign-in step: the pending token from /login and a six-digit code or a recovery code.

    A wrong code is a 422 (a 401 would sign the browser out, frontend/lib/api/client.ts) and writes a
    ``user.2fa_failed`` audit row. An expired or voided pending token is a 400: the user starts again.
    Attempts are limited per user, five in five minutes, whichever IP they come from.
    """
    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        _ensure_local_auth_schema(conn)
        jwt_secret = _tenant_jwt_secret(conn)
        payload = decode_access_token(body.mfa_token, jwt_secret)
        if not payload or payload.get("purpose") != "mfa_pending" or not payload.get("sub"):
            raise HTTPException(status_code=400, detail=_PENDING_EXPIRED_DETAIL)
        user_id = str(payload["sub"])
        limit_identity("auth_2fa_login", user_id, limit=_CODE_LIMIT, window_s=_CODE_WINDOW_S)

        conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))
        try:
            row = _sign_in_row(conn, "id = CAST(:uid AS uuid)", {"uid": user_id})
        except Exception:
            raise HTTPException(status_code=400, detail=_PENDING_EXPIRED_DETAIL) from None
        # Deactivated, two-factor reset, or the password changed since the first step: start again.
        if not row or not row[5] or not row[8] or int(row[7]) != payload.get("tv"):
            raise HTTPException(status_code=400, detail=_PENDING_EXPIRED_DETAIL)

        method = two_factor.verify_second_factor(conn, DEV_TENANT_ID, user_id, body.code, row[9], row[10])
        if method is None:
            two_factor.audit(conn, request, DEV_TENANT_ID, user_id, row[1], "user.2fa_failed", 422,
                             after={"during": "sign_in"})
            conn.commit()
            raise HTTPException(status_code=422, detail=_WRONG_CODE_DETAIL)
        if method == "recovery":
            two_factor.audit(conn, request, DEV_TENANT_ID, user_id, row[1], "user.2fa_recovery_used",
                             after={"recovery_codes_left": two_factor.recovery_codes_left(conn, DEV_TENANT_ID, user_id)})
        return _issue_session(conn, response, row, jwt_secret)


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
                f"SELECT id, email, name, role, is_active, {must_change_select}, totp_enabled "
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
            must_change_password=bool(row[5]),
            # Read live, so turning the tenant requirement on reaches sessions already open.
            must_enrol_2fa=not bool(row[6]) and _require_2fa(conn),
        )


# ── Password rotation ────────────────────────────────────────────────────────

# Password policy — loose on purpose (we're not a password manager; the
# point here is "not `admin`"). Operators can plug in something stricter
# by configuring their identity provider and bypassing local auth.
_MIN_PASSWORD_LENGTH = 12


@router.post("/change-password", response_model=ChangePasswordResponse,
             dependencies=[Depends(_change_password_rate_limit)])
def change_password(body: ChangePasswordRequest, request: Request, response: Response):
    """Rotate the password for the currently-authenticated user.

    Accepted even when `must_change_password` is true on the account —
    in fact that's the intended path. Clears the flag on success so
    the user can proceed with normal API use. Writes a ``user.password_change`` audit row.

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
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"New password must be at least {_MIN_PASSWORD_LENGTH} characters",
        )
    if new_password == body.current_password:
        raise HTTPException(
            status_code=422,
            detail="New password must differ from the current one",
        )

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
            text("SELECT id, password_hash, is_active, email, role, totp_enabled FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": payload["sub"], "tid": DEV_TENANT_ID},
        ).fetchone()
        if not row or not row[2]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        if not row[1] or not verify_password(body.current_password, row[1]):
            # 422 like the other input errors here: a 401 would sign the user out (frontend/lib/api/client.ts)
            raise HTTPException(status_code=422, detail="Current password is incorrect")

        version = conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false, token_version = token_version + 1 "
                "WHERE id = :uid RETURNING token_version"
            ),
            {"ph": hash_password(new_password), "uid": str(row[0])},
        ).fetchone()
        conn.execute(
            text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, "
                 "method, path, status_code) VALUES (:t, :u, :e, 'user.password_change', 'user', :u, "
                 ":m, :p, 200)"),
            {"t": DEV_TENANT_ID, "u": str(row[0]), "e": row[3], "m": request.method, "p": request.url.path},
        )
        must_enrol = not bool(row[5]) and _require_2fa(conn)
        conn.commit()
        forget_token_version(str(row[0]))
        token = create_access_token(
            user_id=str(row[0]),
            tenant_id=DEV_TENANT_ID,
            email=row[3],
            role=row[4],
            secret=secret_row[0],
            token_version=int(version[0]),
            # A session that still has to set up two-factor sign-in stays restricted after the change.
            mfa_enrol=must_enrol,
        )
    _set_auth_cookie(response, token)
    return ChangePasswordResponse(token=token)


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
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Password must be at least {_MIN_PASSWORD_LENGTH} characters",
        )

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

        # Atomic: only succeeds if no password set yet. Replay after the user
        # has activated returns 409 instead of silently overwriting.
        result = conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false "
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
                "SELECT id, name FROM users "
                "WHERE LOWER(email) = :em AND tenant_id = :tid "
                "  AND is_active = true AND password_hash IS NOT NULL"
            ),
            {"em": email, "tid": DEV_TENANT_ID},
        ).fetchone()

        if row:
            from api.services.local_auth import create_password_reset_token

            reset_token = create_password_reset_token(
                str(row[0]), DEV_TENANT_ID, secret_row[0]
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
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=f"Password must be at least {_MIN_PASSWORD_LENGTH} characters",
        )

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

        result = conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false, token_version = token_version + 1 "
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


# ── Two-factor sign-in (self-service) ────────────────────────────────────────
#
# Setting up: POST /2fa/setup stores a new secret (encrypted, not yet enabled) and returns it with its
# otpauth:// link; POST /2fa/confirm checks a code from the app, turns two-factor sign-in on and returns
# ten recovery codes, once. Turning it off takes the password and a code. An administrator can reset it
# for a user who lost their phone (POST /api/v1/users/{id}/2fa/reset).


class TwoFactorStatus(BaseModel):
    enabled: bool
    # The tenant requires it: it cannot be turned off here, and a user without it must set it up.
    required: bool
    recovery_codes_left: int = 0


class TwoFactorSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class TwoFactorCodeRequest(BaseModel):
    code: str


class TwoFactorConfirmResponse(BaseModel):
    recovery_codes: list[str]
    # A session without the set-up-only restriction, replacing the caller's.
    token: str


class TwoFactorDisableRequest(BaseModel):
    password: str
    code: str


class TwoFactorDisableResponse(BaseModel):
    ok: bool = True
    # Turning it off ends every other session, as a password change does: this replaces the caller's.
    token: str


_TFA_USER_COLUMNS = "id, email, role, password_hash, totp_enabled, totp_secret, totp_last_step, token_version"


def _signed_in_user(conn, request: Request):
    """The caller's users row (_TFA_USER_COLUMNS) from the session token, and the jwt secret; 401 without one.
    LocalAuthMiddleware has already refused revoked and single-purpose tokens; this re-checks the purpose
    so the route stays safe on its own."""
    auth_header = request.headers.get("authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else request.cookies.get("mn_auth_token", "")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    _ensure_local_auth_schema(conn)
    secret = conn.execute(text("SELECT jwt_secret FROM tenants WHERE id = :tid"), {"tid": DEV_TENANT_ID}).scalar()
    payload = decode_access_token(token, secret) if secret else None
    if not payload or payload.get("purpose"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    conn.execute(text(f"SET app.tenant_id = '{str(DEV_TENANT_ID)}'"))
    row = conn.execute(
        text(f"SELECT {_TFA_USER_COLUMNS} FROM users WHERE id = :uid AND tenant_id = :tid AND is_active"),
        {"uid": payload["sub"], "tid": DEV_TENANT_ID},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return row, secret


@router.get("/2fa", response_model=TwoFactorStatus)
def two_factor_status(request: Request):
    """Whether the caller has two-factor sign-in, whether the tenant requires it, and recovery codes left."""
    with get_sync_engine_or_create().connect() as conn:
        row, _ = _signed_in_user(conn, request)
        enabled = bool(row[4])
        return TwoFactorStatus(
            enabled=enabled, required=_require_2fa(conn),
            recovery_codes_left=two_factor.recovery_codes_left(conn, DEV_TENANT_ID, str(row[0])) if enabled else 0,
        )


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse, dependencies=[Depends(_setup_rate_limit)])
def two_factor_setup(request: Request):
    """A new authenticator secret for the caller, not yet in force. Starting again replaces it."""
    with get_sync_engine_or_create().connect() as conn:
        row, _ = _signed_in_user(conn, request)
        if row[4]:
            raise HTTPException(status_code=409, detail="Two-factor sign-in is already on. Turn it off first to move it to a new phone.")
        secret = totp.generate_secret()
        conn.execute(
            text("UPDATE users SET totp_secret = :s, totp_enabled = false, totp_last_step = NULL WHERE id = :uid"),
            {"s": two_factor.encrypt_secret_or_503(DEV_TENANT_ID, secret), "uid": str(row[0])},
        )
        conn.commit()
        return TwoFactorSetupResponse(secret=secret, otpauth_uri=totp.provisioning_uri(secret, row[1]))


@router.post("/2fa/confirm", response_model=TwoFactorConfirmResponse, dependencies=[Depends(_code_rate_limit)])
def two_factor_confirm(body: TwoFactorCodeRequest, request: Request, response: Response):
    """Turn two-factor sign-in on with a code from the app, and return ten recovery codes (shown once).
    Writes ``user.2fa_enable``; a wrong code writes ``user.2fa_failed``."""
    with get_sync_engine_or_create().connect() as conn:
        row, jwt_secret = _signed_in_user(conn, request)
        uid = str(row[0])
        if row[4]:
            raise HTTPException(status_code=409, detail="Two-factor sign-in is already on.")
        if not row[5]:
            raise HTTPException(status_code=409, detail="Start the set-up first.")
        method = two_factor.verify_second_factor(conn, DEV_TENANT_ID, uid, body.code, row[5], row[6], allow_recovery=False)
        if method is None:
            two_factor.audit(conn, request, DEV_TENANT_ID, uid, row[1], "user.2fa_failed", 422, after={"during": "set_up"})
            conn.commit()
            raise HTTPException(status_code=422, detail="That code did not work. Check the time on your phone and enter the code now showing.")
        conn.execute(text("UPDATE users SET totp_enabled = true WHERE id = :uid"), {"uid": uid})
        codes = two_factor.replace_recovery_codes(conn, DEV_TENANT_ID, uid)
        two_factor.audit(conn, request, DEV_TENANT_ID, uid, row[1], "user.2fa_enable")
        conn.commit()
        token = create_access_token(user_id=uid, tenant_id=DEV_TENANT_ID, email=row[1], role=row[2],
                                    secret=jwt_secret, token_version=int(row[7]))
    _set_auth_cookie(response, token)
    return TwoFactorConfirmResponse(recovery_codes=codes, token=token)


@router.post("/2fa/disable", response_model=TwoFactorDisableResponse, dependencies=[Depends(_code_rate_limit)])
def two_factor_disable(body: TwoFactorDisableRequest, request: Request, response: Response):
    """Turn the caller's two-factor sign-in off: the password and a code (or a recovery code).

    Refused (409) while the tenant requires it. Ends every other session (users.token_version) and
    returns the caller's replacement token. Writes ``user.2fa_disable``, or ``user.2fa_failed``.
    """
    with get_sync_engine_or_create().connect() as conn:
        row, jwt_secret = _signed_in_user(conn, request)
        uid = str(row[0])
        if not row[4]:
            raise HTTPException(status_code=409, detail="Two-factor sign-in is not on.")
        if _require_2fa(conn):
            raise HTTPException(status_code=409, detail="Your organisation requires two-factor sign-in, so it cannot be turned off. An administrator can reset it if you lost your phone.")
        if not row[3] or not verify_password(body.password, row[3]):
            raise HTTPException(status_code=422, detail="Current password is incorrect")
        if two_factor.verify_second_factor(conn, DEV_TENANT_ID, uid, body.code, row[5], row[6]) is None:
            two_factor.audit(conn, request, DEV_TENANT_ID, uid, row[1], "user.2fa_failed", 422, after={"during": "turn_off"})
            conn.commit()
            raise HTTPException(status_code=422, detail="That code did not work.")
        version = conn.execute(
            text(f"UPDATE users SET {two_factor.CLEAR_TWO_FACTOR_SET}, token_version = token_version + 1 "
                 "WHERE id = :uid RETURNING token_version"),
            {"uid": uid},
        ).scalar_one()
        conn.execute(text("DELETE FROM user_recovery_codes WHERE tenant_id = :t AND user_id = :u"),
                     {"t": DEV_TENANT_ID, "u": uid})
        two_factor.audit(conn, request, DEV_TENANT_ID, uid, row[1], "user.2fa_disable")
        conn.commit()
        forget_token_version(uid)
        token = create_access_token(user_id=uid, tenant_id=DEV_TENANT_ID, email=row[1], role=row[2],
                                    secret=jwt_secret, token_version=int(version))
    _set_auth_cookie(response, token)
    return TwoFactorDisableResponse(token=token)
