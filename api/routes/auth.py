"""Local authentication endpoints — login and current-user lookup.

Active only when AUTH_MODE=local.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from api.deps import get_sync_engine_or_create
from api.services.local_auth import (
    create_access_token,
    decode_access_token,
    generate_jwt_secret,
    verify_password,
)
from api.services.rate_limiter import rate_limit

# Login endpoint is unauthenticated, so rate-limit by IP: 10 attempts per
# minute. Tight enough to slow credential stuffing, loose enough that a
# legitimate user fat-fingering the password a few times isn't locked out.
_login_rate_limit = rate_limit("auth_login", limit=10, window_s=60, key_by="ip")

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


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(_login_rate_limit)])
def login(body: LoginRequest):
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
                f"SELECT id, email, name, role, password_hash, is_active, {must_change_select} "
                "FROM users WHERE email = :email AND tenant_id = :tid"
            ),
            {"email": body.email, "tid": DEV_TENANT_ID},
        ).fetchone()

        if not row or not row[5]:  # not found or inactive
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if not row[4]:  # no password_hash set
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if not verify_password(body.password, row[4]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        must_change = bool(row[6]) if len(row) > 6 else False

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
        )

        # Update last_login
        conn.execute(
            text("UPDATE users SET last_login = :now WHERE id = :uid"),
            {"now": datetime.now(timezone.utc), "uid": user_id},
        )
        conn.commit()

        return LoginResponse(
            token=token,
            user=UserResponse(id=user_id, email=row[1], name=row[2], role=row[3]),
            must_change_password=must_change,
        )


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
            user=UserResponse(id=str(row[0]), email=row[1], name=row[2], role=row[3]),
            must_change_password=bool(row[5]) if len(row) > 5 else False,
        )


# ── Password rotation ────────────────────────────────────────────────────────

# Password policy — loose on purpose (we're not a password manager; the
# point here is "not `admin`"). Operators can plug in something stricter
# by configuring their identity provider and bypassing local auth.
_MIN_PASSWORD_LENGTH = 12


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, request: Request):
    """Rotate the password for the currently-authenticated user.

    Accepted even when `must_change_password` is true on the account —
    in fact that's the intended path. Clears the flag on success so
    the user can proceed with normal API use.
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
            text("SELECT id, password_hash, is_active FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": payload["sub"], "tid": DEV_TENANT_ID},
        ).fetchone()
        if not row or not row[2]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        if not row[1] or not verify_password(body.current_password, row[1]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        conn.execute(
            text(
                "UPDATE users "
                "SET password_hash = :ph, must_change_password = false "
                "WHERE id = :uid"
            ),
            {"ph": hash_password(new_password), "uid": str(row[0])},
        )
        conn.commit()
    return {"ok": True}
