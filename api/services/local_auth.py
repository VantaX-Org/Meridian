"""Local authentication service — password hashing & JWT tokens.

Used only when AUTH_MODE=local (air-gapped / customer deployments).
"""

import secrets
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_ph = PasswordHasher()

# JWT config
_JWT_ALGORITHM = "HS256"
_JWT_EXPIRY_HOURS = 24


def hash_password(plain: str) -> str:
    """Argon2id hash of a plaintext password."""
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against an Argon2id hash."""
    try:
        return _ph.verify(hashed, plain)
    except VerifyMismatchError:
        return False


def generate_jwt_secret() -> str:
    """Generate a random 64-char hex secret for JWT signing."""
    return secrets.token_hex(32)


def create_access_token(
    user_id: str,
    tenant_id: str,
    email: str,
    role: str,
    secret: str,
) -> str:
    """Create a signed JWT access token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=_JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str, secret: str) -> dict | None:
    """Decode and verify a JWT. Returns payload dict or None if invalid."""
    try:
        return jwt.decode(token, secret, algorithms=[_JWT_ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
