"""AES-256 encrypt/decrypt for SAP system passwords.

Tenant-scoped encryption keys derived from a master secret + tenant_id.
Never returns decrypted values via API — used only by sync worker at runtime.
"""

import base64
import hashlib
import logging
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("meridian.credential_store")

# 96-bit nonce for AES-GCM
_NONCE_LENGTH = 12


def _derive_key(tenant_id: str) -> bytes:
    """Derive a 256-bit AES key from the master secret and tenant_id."""
    master_secret = os.getenv("CREDENTIAL_MASTER_KEY", "")
    if not master_secret:
        raise RuntimeError("CREDENTIAL_MASTER_KEY environment variable is not set")

    # HKDF-like derivation using SHA-256
    key_material = f"{master_secret}:{tenant_id}".encode()
    return hashlib.sha256(key_material).digest()


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

    Used only by sync worker at runtime — never exposed via API.
    """
    key = _derive_key(tenant_id)
    raw = base64.b64decode(encrypted)
    nonce = raw[:_NONCE_LENGTH]
    ciphertext = raw[_NONCE_LENGTH:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode()
