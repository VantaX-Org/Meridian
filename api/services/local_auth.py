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
    token_version: int = 0,
) -> str:
    """Create a signed JWT access token.

    ``tv`` is the user's ``users.token_version`` at issue time. LocalAuthMiddleware rejects a token
    whose ``tv`` is below the user's current value, so bumping the column (password change or reset,
    deactivation) revokes every session issued before it.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "email": email,
        "role": role,
        "tv": token_version,
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


def token_version_claim(payload: dict) -> int:
    """The ``tv`` claim of a decoded access token. Tokens issued before migration 092 carry none and
    count as version 0, so they stay valid until they expire unless the user's sessions were revoked."""
    tv = payload.get("tv", 0)
    return tv if isinstance(tv, int) and not isinstance(tv, bool) else 0


def create_invite_token(user_id: str, tenant_id: str, secret: str, ttl_days: int = 7) -> str:
    """Create a signed JWT for accepting an invitation (sets first password).

    Same HS256 + tenant secret as access tokens, with a distinct ``purpose``
    claim so an access token can't be substituted for an invite acceptance
    and vice versa. Default 7-day expiry.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "purpose": "invite_accept",
        "iat": now,
        "exp": now + timedelta(days=ttl_days),
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)


def create_password_reset_token(
    user_id: str, tenant_id: str, secret: str, ttl_minutes: int = 60
) -> str:
    """Create a signed JWT for the forgot-password flow.

    Short TTL (default 1 hour) and a distinct ``purpose`` claim so it can't
    be confused with an access token or invite token.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "purpose": "password_reset",
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)
