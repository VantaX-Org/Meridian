"""Local authentication endpoints — login and current-user lookup.

Active only when AUTH_MODE=local.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text

from api.deps import get_sync_engine_or_create
from api.services.local_auth import (
    create_access_token,
    decode_access_token,
    generate_jwt_secret,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

DEV_TENANT_ID = "00000000-0000-0000-0000-000000000001"


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


class MeResponse(BaseModel):
    user: UserResponse


def _get_sync_connection():
    """Get a synchronous DB connection for auth operations."""
    engine = get_sync_engine_or_create()
    return engine.connect()


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    """Authenticate with email/password and receive a JWT."""
    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        conn.execute(text(f"SET app.tenant_id TO '{str(DEV_TENANT_ID)}'"))

        # Look up user
        row = conn.execute(
            text(
                "SELECT id, email, name, role, password_hash, is_active "
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
        conn.execute(text(f"SET app.tenant_id TO '{str(DEV_TENANT_ID)}'"))
        row = conn.execute(
            text("SELECT id, email, name, role, is_active FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": payload["sub"], "tid": DEV_TENANT_ID},
        ).fetchone()

        if not row or not row[4]:
            raise HTTPException(status_code=401, detail="Not authenticated")

        return MeResponse(
            user=UserResponse(id=str(row[0]), email=row[1], name=row[2], role=row[3]),
        )
