"""Symmetric encryption for API keys stored in the database.

Uses the tenant's jwt_secret as the key material — no new secrets needed.
Keys are encrypted at rest and decrypted only when passed to the LLM provider.
"""

import base64
import hashlib
import logging
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("meridian.crypto")


def _derive_fernet_key(jwt_secret: str) -> bytes:
    """Derive a 32-byte Fernet key from the tenant's jwt_secret."""
    digest = hashlib.sha256(jwt_secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_api_key(api_key: str, jwt_secret: str) -> str:
    """Encrypt an API key using the tenant's jwt_secret. Returns base64 string."""
    if not api_key:
        return ""
    fernet = Fernet(_derive_fernet_key(jwt_secret))
    return fernet.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted: str, jwt_secret: str) -> str:
    """Decrypt an API key. Returns empty string on failure."""
    if not encrypted:
        return ""
    try:
        fernet = Fernet(_derive_fernet_key(jwt_secret))
        return fernet.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception) as e:
        logger.warning(f"Failed to decrypt API key: {e}")
        return ""
