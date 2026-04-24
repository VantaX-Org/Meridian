"""AES-256 encrypt/decrypt for SAP system passwords.

Tenant-scoped encryption keys derived from a master secret + tenant_id.
Never returns decrypted values via API — used only by sync worker at runtime.

Key rotation:
  - Current master lives in CREDENTIAL_MASTER_KEY (used for encrypt + tried
    first for decrypt).
  - Previous master can live in CREDENTIAL_MASTER_KEY_PREV during a rotation
    window; decrypt falls back to it when the current key fails. Once the
    rotation tool (scripts/rotate-credential-key.py) has re-encrypted every
    row, delete the PREV var from .env.
"""

import base64
import hashlib
import logging
import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("meridian.credential_store")

# 96-bit nonce for AES-GCM
_NONCE_LENGTH = 12


def _derive_key_with(master_secret: str, tenant_id: str) -> bytes:
    key_material = f"{master_secret}:{tenant_id}".encode()
    return hashlib.sha256(key_material).digest()


def _derive_key(tenant_id: str) -> bytes:
    """Derive a 256-bit AES key from the current master secret + tenant_id."""
    master_secret = os.getenv("CREDENTIAL_MASTER_KEY", "")
    if not master_secret:
        raise RuntimeError("CREDENTIAL_MASTER_KEY environment variable is not set")
    return _derive_key_with(master_secret, tenant_id)


def _derive_key_prev(tenant_id: str) -> bytes | None:
    prev = os.getenv("CREDENTIAL_MASTER_KEY_PREV", "")
    if not prev:
        return None
    return _derive_key_with(prev, tenant_id)


def encrypt_password(tenant_id: str, plaintext: str) -> str:
    """Encrypt a password using AES-256-GCM. Returns base64-encoded ciphertext.

    Format: base64(nonce || ciphertext || tag)
    """
    key = _derive_key(tenant_id)
    nonce = secrets.token_bytes(_NONCE_LENGTH)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_password(tenant_id: str, encrypted: str) -> str:
    """Decrypt a password encrypted with encrypt_password.

    Tries CREDENTIAL_MASTER_KEY first; if the auth tag fails and
    CREDENTIAL_MASTER_KEY_PREV is set, retries with that. This allows
    the sync worker to keep functioning mid-rotation before every row
    has been re-encrypted by scripts/rotate-credential-key.py.
    """
    raw = base64.b64decode(encrypted)
    nonce = raw[:_NONCE_LENGTH]
    ciphertext = raw[_NONCE_LENGTH:]

    # Try current key
    try:
        aesgcm = AESGCM(_derive_key(tenant_id))
        return aesgcm.decrypt(nonce, ciphertext, None).decode()
    except InvalidTag:
        pass

    # Fall back to previous key during rotation
    prev_key = _derive_key_prev(tenant_id)
    if prev_key is None:
        raise
    logger.info(
        f"decrypt_password: fell back to CREDENTIAL_MASTER_KEY_PREV for tenant {tenant_id} "
        "— run scripts/rotate-credential-key.py to re-encrypt"
    )
    aesgcm = AESGCM(prev_key)
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


def decrypt_with_key(master_secret: str, tenant_id: str, encrypted: str) -> str:
    """Decrypt using an explicit master key — used by the rotation tool."""
    raw = base64.b64decode(encrypted)
    nonce = raw[:_NONCE_LENGTH]
    ciphertext = raw[_NONCE_LENGTH:]
    aesgcm = AESGCM(_derive_key_with(master_secret, tenant_id))
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


def encrypt_with_key(master_secret: str, tenant_id: str, plaintext: str) -> str:
    """Encrypt using an explicit master key — used by the rotation tool."""
    key = _derive_key_with(master_secret, tenant_id)
    nonce = secrets.token_bytes(_NONCE_LENGTH)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ciphertext).decode()
