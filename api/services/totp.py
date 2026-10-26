"""Two-factor sign-in: RFC 6238 time-based one-time codes and single-use recovery codes.

No third-party OTP library: TOTP is HMAC-SHA1 over the 30-second step counter, truncated to six
digits (RFC 4226 section 5.3), which is what every authenticator app computes.

The shared secret is stored encrypted with the same AES-256-GCM helper that protects SAP system
passwords (api/services/credential_store.py, keyed by CREDENTIAL_MASTER_KEY + tenant id), so
scripts/rotate-credential-key.py re-encrypts it on a key rotation. Recovery codes are 80-bit random
strings stored as SHA-256 digests: at that entropy a fast hash cannot be brute-forced, and an exact
digest lets the single-use UPDATE find the row without trying every hash.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

from api.services.credential_store import decrypt_password, encrypt_password

STEP_S = 30
DIGITS = 6
#: Accept the code for the previous and the next step too, for clock drift between phone and server.
DRIFT_STEPS = 1
ISSUER = "Meridian"
RECOVERY_CODE_COUNT = 10
# 32 symbols (no 0/O, 1/I) so each character carries 5 bits: 16 characters = 80 bits.
_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_RECOVERY_LENGTH = 16


def generate_secret() -> str:
    """A new 160-bit shared secret, base32 without padding (the form authenticator apps take)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    s = secret.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP_S)


def code_at(secret: str, step: int) -> str:
    """The six-digit code for one 30-second step (RFC 6238 over RFC 4226 HOTP)."""
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def matching_step(secret: str, code: str, now: float | None = None, last_step: int | None = None) -> int | None:
    """The step a code belongs to, within +/- DRIFT_STEPS of now, or None.

    A step at or before ``last_step`` (the last one accepted for this user) never matches, so a code
    that was already used, or an older one, cannot be replayed. The caller records the returned step.
    """
    code = normalise_code(code)
    if len(code) != DIGITS or not code.isdigit():
        return None
    now_step = current_step(now)
    for step in range(now_step - DRIFT_STEPS, now_step + DRIFT_STEPS + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(code_at(secret, step), code):
            return step
    return None


def provisioning_uri(secret: str, account: str) -> str:
    """The otpauth:// link an authenticator app reads (from a QR code, or pasted)."""
    label = quote(f"{ISSUER}:{account}", safe="")
    params = urlencode({"secret": secret, "issuer": ISSUER, "algorithm": "SHA1", "digits": DIGITS, "period": STEP_S})
    return f"otpauth://totp/{label}?{params}"


def normalise_code(code: str) -> str:
    """Upper case with spaces and hyphens removed, so "abcd-efgh ..." and "123 456" both read."""
    return "".join(ch for ch in (code or "").upper() if ch not in " -\t")


def looks_like_recovery_code(code: str) -> bool:
    c = normalise_code(code)
    return len(c) == _RECOVERY_LENGTH and all(ch in _RECOVERY_ALPHABET for ch in c)


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """``count`` fresh codes, shown to the user once as XXXX-XXXX-XXXX-XXXX."""
    out = []
    for _ in range(count):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_LENGTH))
        out.append("-".join(raw[i:i + 4] for i in range(0, _RECOVERY_LENGTH, 4)))
    return out


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(normalise_code(code).encode()).hexdigest()


def encrypt_secret(tenant_id: str, secret: str) -> str:
    return encrypt_password(str(tenant_id), secret)


def decrypt_secret(tenant_id: str, stored: str) -> str:
    return decrypt_password(str(tenant_id), stored)
