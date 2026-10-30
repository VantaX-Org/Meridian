#!/usr/bin/env python3
"""Issue an offline Meridian licence (EdDSA / Ed25519 JWT) without Meridian HQ. Vendor use only.

The API verifies MERIDIAN_LICENCE_TOKEN only against the vendor's Ed25519 public keys compiled into the image
(api/middleware/licence_keys.py), so a token signs a customer's licence only when it is signed with the
VENDOR private key (the same key as the licence worker's LICENCE_SIGNING_KEY_ED25519 secret). This signs the
same claims HQ's POST /api/admin/tenants/:id/offline-token does.

    # with the vendor key (kept off every customer server)
    python scripts/issue_offline_licence.py --key vendor-licence-ed25519.pem --customer "Example" --days 365

    # a throwaway key for a development stack or a test: the token verifies only where the stack runs as
    # development and MERIDIAN_LICENCE_TEST_PUBLIC_KEY is set to the printed public key
    python scripts/issue_offline_licence.py --new-key test-licence-ed25519.pem --customer "Test" --days 30

Prints the .env lines for the customer's server: MERIDIAN_LICENCE_MODE=offline and MERIDIAN_LICENCE_TOKEN,
and, for a --new-key test key only, MERIDIAN_LICENCE_TEST_PUBLIC_KEY.
"""
from __future__ import annotations

import argparse
import base64
import sys
import time
import uuid
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

# Mirrors DEFAULT_MENU_ITEMS (cloudflare/licence-worker) and the frontend feature flags.
FEATURES = {"ask_meridian": True, "export_reports": True, "run_sync": True, "field_mapping_self_service": True}


def load_or_create_key(path: Path, create: bool) -> Ed25519PrivateKey:
    if create:
        if path.exists():
            sys.exit(f"{path} already exists; use --key to reuse it")
        key = Ed25519PrivateKey.generate()
        path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
        path.chmod(0o600)
        return key
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        sys.exit(f"{path} is not an Ed25519 private key (offline licences are EdDSA-signed)")
    return key


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    k = p.add_mutually_exclusive_group(required=True)
    k.add_argument("--key", type=Path, help="existing PEM private key")
    k.add_argument("--new-key", type=Path, help="create a new PEM private key at this path")
    p.add_argument("--customer", required=True, help="customer name, recorded in the token")
    p.add_argument("--tenant-id", default=str(uuid.uuid4()), help="licence tenant id (default: new UUID)")
    p.add_argument("--days", type=int, default=365, help="validity in days (1-1095)")
    p.add_argument("--max-users", type=int, default=50)
    a = p.parse_args()
    if not 1 <= a.days <= 1095:
        sys.exit("--days must be between 1 and 1095")

    key = load_or_create_key(a.new_key or a.key, create=a.new_key is not None)
    now = int(time.time())
    claims = {
        "iss": "meridian-hq", "sub": a.tenant_id, "tenant_id": a.tenant_id, "customer": a.customer,
        "iat": now, "exp": now + a.days * 86400,
        "enabled_modules": ["*"], "enabled_menu_items": ["*"],
        "features": {**FEATURES, "max_users": a.max_users},
    }
    token = jwt.encode(claims, key, algorithm="EdDSA")
    print("MERIDIAN_LICENCE_MODE=offline")
    print(f"MERIDIAN_LICENCE_TOKEN={token}")
    if a.new_key is not None:
        raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        print(f"MERIDIAN_LICENCE_TEST_PUBLIC_KEY={base64.b64encode(raw).decode()}")

if __name__ == "__main__":
    main()
