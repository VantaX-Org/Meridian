"""
Task 11: Cryptographic key separation for LLM API key encryption.

Decouples LLM_KEK (Key Encryption Key) from JWT_SECRET to follow
defense-in-depth: each secret is scoped to its specific use.

Uses Fernet (AES-128-CBC + HMAC-SHA256) for authenticated encryption.
Supports key rotation with automatic decryption of previous key versions.
"""

import os
import json
from typing import Optional
from cryptography.fernet import Fernet, MultiFernet
import logging

logger = logging.getLogger(__name__)


class LLMKeyEncryptor:
    """Manages LLM API key encryption with support for key rotation."""

    def __init__(self):
        """Initialize encryptor from LLM_KEK environment variable.
        
        LLM_KEK format:
          - Single key: base64-encoded Fernet key (44 chars ending in =)
          - Rotation: space-separated keys, newest first
            Example: "key1_new key1_old key1_older..."
        """
        kek_raw = os.getenv("LLM_KEK")
        if not kek_raw:
            raise ValueError(
                "LLM_KEK not set. Generate with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )

        keys = kek_raw.strip().split()
        if not keys:
            raise ValueError("LLM_KEK is empty")

        try:
            # MultiFernet supports decryption with multiple keys (new first for rotation)
            self._cipher = MultiFernet([Fernet(k.encode()) for k in keys])
            self._primary_key = keys[0]  # Use first key for encryption
        except Exception as e:
            raise ValueError(f"Invalid LLM_KEK format: {e}") from e

        logger.info(f"LLM key encryptor initialized with {len(keys)} key(s)")

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a string (typically an LLM API key).
        
        Args:
            plaintext: The value to encrypt
            
        Returns:
            Base64-encoded ciphertext (URL-safe)
        """
        try:
            # Use primary key for encryption
            cipher = Fernet(self._primary_key.encode())
            ciphertext = cipher.encrypt(plaintext.encode())
            return ciphertext.decode()
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            raise

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt a string using MultiFernet (supports key rotation).
        
        Args:
            ciphertext: Base64-encoded ciphertext to decrypt
            
        Returns:
            Decrypted plaintext string
            
        Raises:
            cryptography.fernet.InvalidToken: If decryption fails with all keys
        """
        try:
            plaintext = self._cipher.decrypt(ciphertext.encode())
            return plaintext.decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise

    @staticmethod
    def generate_key() -> str:
        """Generate a new Fernet key for rotation.
        
        Usage:
            key = LLMKeyEncryptor.generate_key()
            # Add to LLM_KEK at the front: f"{key} {existing_keys}"
        """
        return Fernet.generate_key().decode()


# Singleton instance
_encryptor: Optional[LLMKeyEncryptor] = None


def get_llm_encryptor() -> LLMKeyEncryptor:
    """Get or initialize the LLM key encryptor.
    
    Lazy initialization to allow environment setup before import.
    """
    global _encryptor
    if _encryptor is None:
        _encryptor = LLMKeyEncryptor()
    return _encryptor


def encrypt_llm_key(api_key: str) -> str:
    """Encrypt an LLM API key for storage.
    
    Typical usage in database schema migration:
        encrypted_key = encrypt_llm_key(plaintext_key)
        db.execute("UPDATE ... SET llm_api_key_encrypted = ?", [encrypted_key])
    """
    return get_llm_encryptor().encrypt(api_key)


def decrypt_llm_key(ciphertext: str) -> str:
    """Decrypt an LLM API key from storage.
    
    Typical usage in llm/provider.py:
        plaintext_key = decrypt_llm_key(row.llm_api_key_encrypted)
        client = Anthropic(api_key=plaintext_key)
    """
    return get_llm_encryptor().decrypt(ciphertext)
