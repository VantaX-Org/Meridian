"""The anti-self-grant licence-response signature (Ed25519, vendor key compiled into the image).

The worker signs every valid response with the vendor's Ed25519 private key; the client verifies it only
against the public keys in api/middleware/licence_keys.py. Without this, a customer holding the image could MITM
their own licence check and forge `valid:true`. Enforcement is always on (fail closed); the old RSA signature
with a key from .env is honoured only inside the legacy window (MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES).

These sign the canonical string the SAME way the worker does and assert the client accepts the genuine one
and rejects forged, tampered, replayed, cross-node and unsigned ones.

Run: pytest tests/test_licence_signing.py
"""

import base64
import time

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import api.middleware.licence as lic
from tests.licence_test_keys import install, signed_response

FP = "deadbeef" * 8  # fixed fake node fingerprint


@pytest.fixture(autouse=True)
def _keys(monkeypatch, tmp_path):
    install(monkeypatch, tmp_path)
    monkeypatch.setattr(lic, "_get_machine_fingerprint", lambda: FP)


def test_genuine_signature_accepted():
    assert lic._verify_response_signature(signed_response(FP)) is True


def test_signature_by_another_key_rejected():
    assert lic._verify_response_signature(signed_response(FP, key=Ed25519PrivateKey.generate())) is False


def test_tampered_module_rejected():
    r = signed_response(FP)
    r["enabled_modules"] = r["enabled_modules"] + ["fi_gl"]  # add entitlement post-sign
    assert lic._verify_response_signature(r) is False


def test_stale_signature_rejected():
    old = int(time.time()) - (8 * 24 * 60 * 60)  # 8 days > 7-day max age
    assert lic._verify_response_signature(signed_response(FP, signed_at=old)) is False


def test_other_node_replay_rejected():
    assert lic._verify_response_signature(signed_response(FP, machine_fingerprint="aaaa" * 16)) is False


def test_missing_signature_rejected():
    r = signed_response(FP)
    del r["signature_ed25519"]
    assert lic._verify_response_signature(r) is False


def test_unsigned_response_rejected_with_no_configuration_at_all(monkeypatch):
    """No passthrough any more: an unsigned `valid:true` never entitles anything."""
    monkeypatch.delenv("LICENCE_SERVER_PUBLIC_KEY", raising=False)
    assert lic._verify_response_signature({"valid": True, "tenant_id": "t"}) is False


def _legacy_rsa(monkeypatch) -> dict:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = key.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    monkeypatch.setenv("LICENCE_SERVER_PUBLIC_KEY", pub)
    r = signed_response(FP)
    del r["signature_ed25519"]
    r["signature"] = base64.b64encode(key.sign(lic._entitlement_canonical(r, r["signed_at"]), padding.PKCS1v15(),
                                               hashes.SHA256())).decode()
    return r


def test_legacy_rsa_signature_rejected_by_default(monkeypatch):
    assert lic._verify_response_signature(_legacy_rsa(monkeypatch)) is False


def test_legacy_rsa_signature_accepted_inside_the_transition_window(monkeypatch):
    monkeypatch.setattr(lic.settings, "licence_allow_legacy_signatures", True)
    assert lic._verify_response_signature(_legacy_rsa(monkeypatch)) is True


def test_canonical_matches_the_worker():
    """The bytes the worker signs (index.ts entitlementCanonical, v2)."""
    r = {"tenant_id": "t-1", "expiry_date": "2030-01-01", "enabled_modules": ["b", "a"],
         "enabled_menu_items": ["dashboard"], "features": {"z": True, "y": False, "x": 1},
         "machine_fingerprint": "fp"}
    assert lic._entitlement_canonical(r, 1700000000, lic.CANONICAL_V2) == (
        b"meridian-licence-v2\n1\nt-1\n2030-01-01\na,b\ndashboard\nx,z\nfp\n1700000000")


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-q"]))
