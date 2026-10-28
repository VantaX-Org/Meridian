"""Local authentication service — password hashing & JWT tokens.

Used only when AUTH_MODE=local (air-gapped / customer deployments).
"""

import re
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

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


MIN_PASSWORD_LENGTH = 12
INVITE_TTL_DAYS = 7  # the invite JWT's exp and users.invite_expires_at both use it
_COMMON_PASSWORDS = Path(__file__).resolve().parent.parent / "data" / "common_passwords.txt"


@lru_cache(maxsize=1)
def _common_passwords() -> frozenset[str]:
    """The bundled list of refused passwords (lower case); empty if the file is missing."""
    try:
        lines = _COMMON_PASSWORDS.read_text(encoding="utf-8").splitlines()
    except OSError:
        return frozenset()
    return frozenset(x.strip().lower() for x in lines if x.strip() and not x.startswith("#"))


def validate_password(password: str, email: str, current_hash: str | None = None) -> str | None:
    """None when `password` is acceptable, else a plain-sentence reason. Deterministic and offline.

    At least 12 characters; does not contain the email's name part (3+ characters); is not on the bundled
    common-password list, alone or with digits and punctuation added to the end; is not the user's current
    password (`current_hash`, their stored hash)."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    low = password.lower()
    local = (email or "").split("@")[0].strip().lower()
    if len(local) >= 3 and local in low:
        return "Password must not contain your email name."
    common = _common_passwords()
    if low in common or re.sub(r"[\d\W_]+$", "", low) in common:
        return "That password is too common. Choose a longer or less predictable one."
    if current_hash and verify_password(password, current_hash):
        return "New password must differ from the current one."
    return None


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


def create_invite_token(user_id: str, tenant_id: str, secret: str, ttl_days: int = INVITE_TTL_DAYS) -> str:
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
    user_id: str, tenant_id: str, secret: str, ttl_minutes: int = 60, token_version: int | None = None
) -> str:
    """Create a signed JWT for the forgot-password flow.

    Short TTL (default 1 hour) and a distinct ``purpose`` claim so it can't
    be confused with an access token or invite token. With ``token_version`` (the user's
    ``users.token_version`` at mint time) as the ``tv`` claim the link works once: the reset
    bumps the column, so the same link is refused afterwards.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "purpose": "password_reset",
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
    }
    if token_version is not None:
        payload["tv"] = token_version
    return jwt.encode(payload, secret, algorithm=_JWT_ALGORITHM)
