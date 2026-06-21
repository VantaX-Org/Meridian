"""Runnable check for the anti-self-grant licence-response signature.

The worker RSA-signs every valid response; the client verifies with the public
key. Without this, a customer holding the image could MITM their own licence
check and forge `valid:true` (an HMAC wouldn't help — they'd hold the secret).
Enforcement is OFF until LICENCE_SERVER_PUBLIC_KEY is set (safe rollout).

This signs a canonical string the SAME way the worker does (RSA PKCS1v15/SHA256
over the "\\n"-joined entitlement fields) and asserts the client accepts the
genuine one and rejects forged/replayed/cross-node ones.

Run: pytest tests/test_licence_signing.py
"""

import base64
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

import api.middleware.licence as lic

FP = "deadbeef" * 8  # fixed fake node fingerprint


@pytest.fixture
def keypair(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    monkeypatch.setenv("LICENCE_SERVER_PUBLIC_KEY", pub_pem)
    monkeypatch.setattr(lic, "_get_machine_fingerprint", lambda: FP)
    return key


def _signed(key, **over):
    signed_at = over.pop("signed_at", int(time.time()))
    result = {
        "valid": True,
        "tenant_id": "t-1",
        "expiry_date": "2030-01-01",
        "enabled_modules": ["material_master", "business_partner"],
        "enabled_menu_items": ["dashboard"],
        "features": {"mdm": True, "ai_features": False},
        "machine_fingerprint": FP,
        "signed_at": signed_at,
    }
    result.update(over)
    canonical = lic._entitlement_canonical(result, result["signed_at"])
    sig = key.sign(canonical, padding.PKCS1v15(), hashes.SHA256())
    result["signature"] = base64.b64encode(sig).decode()
    return result


def test_genuine_signature_accepted(keypair):
    assert lic._verify_response_signature(_signed(keypair)) is True


def test_tampered_module_rejected(keypair):
    r = _signed(keypair)
    r["enabled_modules"] = r["enabled_modules"] + ["fi_gl"]  # add entitlement post-sign
    assert lic._verify_response_signature(r) is False


def test_stale_signature_rejected(keypair):
    old = int(time.time()) - (8 * 24 * 60 * 60)  # 8 days > 7-day max age
    assert lic._verify_response_signature(_signed(keypair, signed_at=old)) is False


def test_other_node_replay_rejected(keypair):
    r = _signed(keypair, machine_fingerprint="aaaa" * 16)  # captured for another node
    assert lic._verify_response_signature(r) is False


def test_missing_signature_rejected_when_enforced(keypair):
    r = _signed(keypair)
    del r["signature"]
    assert lic._verify_response_signature(r) is False


def test_passthrough_when_no_public_key(monkeypatch):
    monkeypatch.delenv("LICENCE_SERVER_PUBLIC_KEY", raising=False)
    # Unsigned response is accepted while enforcement is disabled (rollout).
    assert lic._verify_response_signature({"valid": True, "tenant_id": "t"}) is True


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-q"]))
