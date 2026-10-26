#!/usr/bin/env python3
"""Issue an offline Meridian licence (RS256 JWT) without Meridian HQ.

The API verifies MERIDIAN_LICENCE_TOKEN against MERIDIAN_OFFLINE_PUBLIC_KEY
(api/middleware/licence.py _read_offline_token). This signs the same claims HQ's
POST /api/admin/tenants/:id/offline-token does, with a private key you hold.

    # first time: create the signing key pair (keep the private key secret, off the server)
    python scripts/issue_offline_licence.py --new-key licence-signing.pem --customer "Acme" --days 365

    # later tokens, same key
    python scripts/issue_offline_licence.py --key licence-signing.pem --customer "Acme" --days 365

Prints the two .env lines for the customer's server: MERIDIAN_LICENCE_MODE=offline,
MERIDIAN_LICENCE_TOKEN and MERIDIAN_OFFLINE_PUBLIC_KEY (PEM with \\n escapes).
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# Mirrors DEFAULT_MENU_ITEMS (cloudflare/licence-worker) and the frontend feature flags.
FEATURES = {"ask_meridian": True, "export_reports": True, "run_sync": True, "field_mapping_self_service": True}


def load_or_create_key(path: Path, create: bool) -> rsa.RSAPrivateKey:
    if create:
        if path.exists():
            sys.exit(f"{path} already exists; use --key to reuse it")
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
        path.chmod(0o600)
        return key
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


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
    token = jwt.encode(claims, key, algorithm="RS256")
    pub = key.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    print("MERIDIAN_LICENCE_MODE=offline")
    print(f"MERIDIAN_LICENCE_TOKEN={token}")
    print("MERIDIAN_OFFLINE_PUBLIC_KEY=\"" + pub.strip().replace("\n", "\\n") + "\"")


if __name__ == "__main__":
    main()
