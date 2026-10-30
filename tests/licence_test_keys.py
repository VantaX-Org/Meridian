"""A throwaway Ed25519 licence-signing key pair for the licence tests (TEST ONLY, generated per run).

The API trusts the vendor keys compiled into api/middleware/licence_keys.py plus, in development only,
MERIDIAN_LICENCE_TEST_PUBLIC_KEY. ``install`` points that variable at this run's test key, so a test can sign
responses, offline files and offline tokens the way Meridian HQ does, without the vendor private key.
"""
from __future__ import annotations

import base64
import json
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

TEST_ONLY_PRIVATE_KEY = Ed25519PrivateKey.generate()
TEST_ONLY_PUBLIC_KEY_B64 = base64.b64encode(TEST_ONLY_PRIVATE_KEY.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


def install(monkeypatch, tmp_path=None) -> None:
    """Trust the test key (development only) and keep the offline-grace state out of the real path."""
    from api.middleware import licence as lic

    monkeypatch.setattr(lic.settings, "env", "development")
    monkeypatch.setenv("MERIDIAN_LICENCE_TEST_PUBLIC_KEY", TEST_ONLY_PUBLIC_KEY_B64)
    monkeypatch.setattr(lic, "_last_signed", None)
    if tmp_path is not None:
        monkeypatch.setattr(lic.settings, "licence_state_path", str(tmp_path / "licence-last-valid.json"))


def sign(message: bytes, key: Ed25519PrivateKey = TEST_ONLY_PRIVATE_KEY) -> str:
    return base64.b64encode(key.sign(message)).decode()


def signed_response(fingerprint: str, key: Ed25519PrivateKey = TEST_ONLY_PRIVATE_KEY, **over) -> dict:
    """A valid licence response signed as the worker signs it (canonical v2)."""
    from api.middleware import licence as lic

    result = {
        "valid": True,
        "tenant_id": "t-1",
        "expiry_date": "2030-01-01",
        "enabled_modules": ["material_master", "business_partner"],
        "enabled_menu_items": ["dashboard"],
        "features": {"export_reports": True, "ai_features": False},
        "machine_fingerprint": fingerprint,
        "signed_at": int(time.time()),
    }
    result.update(over)
    result["signature_ed25519"] = sign(lic._entitlement_canonical(result, result["signed_at"], lic.CANONICAL_V2), key)
    return result


def signed_offline_file(payload: dict, key: Ed25519PrivateKey = TEST_ONLY_PRIVATE_KEY) -> str:
    return json.dumps({"payload": payload, "signature_alg": "Ed25519",
                       "signature": sign(json.dumps(payload, sort_keys=True).encode(), key)})
