"""The vendor's licence-signing public keys, compiled into the image.

Meridian HQ (cloudflare/licence-worker) signs every valid licence response, every offline licence token and
every offline licence file with an Ed25519 private key that never leaves Cloudflare (worker secret
LICENCE_SIGNING_KEY_ED25519). The API verifies them only against the public keys below. Nothing a customer
can set in .env replaces them, so a customer cannot sign a licence of their own.

Rotation: add the new key FIRST in VENDOR_LICENCE_PUBLIC_KEYS, ship a release, then switch the worker secret;
drop the old key a release later. Each entry is the raw 32-byte Ed25519 public key, base64.

Tests and development stacks: MERIDIAN_LICENCE_TEST_PUBLIC_KEY adds one more key (raw base64 or a PEM), and is
honoured ONLY when the deployment runs as development (MERIDIAN_ENV=development), where the licence check is
already bypassed without a key. A production deployment ignores it and logs that it did.
"""
from __future__ import annotations

import base64
import logging
import os

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

logger = logging.getLogger("meridian.licence")

# Current vendor key first. Public keys only: the matching private key is a Cloudflare worker secret.
VENDOR_LICENCE_PUBLIC_KEYS: tuple[str, ...] = (
    "nzfR8bnWoo+3rWSi16DtMc1fDLCqskiO8Fyl7VS1Ga4=",
)

TEST_KEY_ENV = "MERIDIAN_LICENCE_TEST_PUBLIC_KEY"


def _load(value: str) -> Ed25519PublicKey:
    value = value.strip().strip('"').replace("\\n", "\n")
    if value.startswith("-----BEGIN"):
        key = load_pem_public_key(value.encode())
        if not isinstance(key, Ed25519PublicKey):
            raise ValueError("not an Ed25519 public key")
        return key
    return Ed25519PublicKey.from_public_bytes(base64.b64decode(value))


def _development() -> bool:
    from api.config import settings

    return settings.env == "development"


def public_keys() -> list[Ed25519PublicKey]:
    """The keys a licence signature is verified against: the compiled vendor keys, plus the test key in
    development only."""
    keys = [_load(k) for k in VENDOR_LICENCE_PUBLIC_KEYS]
    test = os.getenv(TEST_KEY_ENV, "").strip()
    if test:
        if _development():
            try:
                keys.append(_load(test))
            except Exception as e:  # noqa: BLE001 - a malformed test key verifies nothing
                logger.warning("%s is not an Ed25519 public key (%s); ignoring it", TEST_KEY_ENV, type(e).__name__)
        else:
            logger.error("%s is set on a non-development deployment and is ignored: licences are verified "
                         "only against the vendor keys compiled into the image", TEST_KEY_ENV)
    return keys


def verify(signature: bytes, message: bytes) -> bool:
    """True when ``signature`` is a valid Ed25519 signature of ``message`` by any trusted key."""
    from cryptography.exceptions import InvalidSignature

    for key in public_keys():
        try:
            key.verify(signature, message)
            return True
        except InvalidSignature:
            continue
    return False
