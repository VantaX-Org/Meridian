#!/usr/bin/env python3
"""Rotate the CREDENTIAL_MASTER_KEY that encrypts SAP system passwords.

Reads every row in system_credentials, decrypts with the OLD master key,
re-encrypts with the NEW master key, and bumps key_version. Safe to re-run
— already-new-encrypted rows are detected and skipped via key_version.

Usage:
    # Dry run — reports what would change, writes nothing
    OLD_MASTER_KEY=$(cat old.key) NEW_MASTER_KEY=$(cat new.key) \\
        python scripts/rotate-credential-key.py --dry-run

    # Real rotation
    OLD_MASTER_KEY=$(cat old.key) NEW_MASTER_KEY=$(cat new.key) \\
        python scripts/rotate-credential-key.py

After success:
  1. Update .env:  CREDENTIAL_MASTER_KEY=<new>
                   CREDENTIAL_MASTER_KEY_PREV=<old>   (temporary — grace period)
  2. Restart the API + worker
  3. Once you're confident everything still works, remove CREDENTIAL_MASTER_KEY_PREV
     from .env and restart again.

Rollback:
    The OLD key still works during the grace window because decrypt_password
    falls back to CREDENTIAL_MASTER_KEY_PREV automatically. If the rotation
    goes sideways, re-run this script with OLD/NEW swapped to restore the
    previous key version.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from typing import Iterable

# Make the repo importable when running from any cwd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from api.services.credential_store import (  # noqa: E402
    decrypt_with_key,
    encrypt_with_key,
)


logger = logging.getLogger("meridian.rotate")


@dataclass
class RotationResult:
    rotated: int
    already_new: int
    failed: list[str]

    @property
    def total_scanned(self) -> int:
        return self.rotated + self.already_new + len(self.failed)


def _fetch_credentials(conn) -> Iterable[tuple]:
    """Return (credential_id, system_id, tenant_id, encrypted_password, key_version)."""
    rows = conn.execute(
        text(
            """
            SELECT sc.id, sc.system_id, s.tenant_id, sc.encrypted_password, sc.key_version
            FROM system_credentials sc
            JOIN sap_systems s ON s.id = sc.system_id
            """
        )
    ).fetchall()
    return rows


def rotate(
    db_url: str,
    old_key: str,
    new_key: str,
    dry_run: bool,
    target_version: int,
) -> RotationResult:
    if old_key == new_key:
        raise SystemExit("OLD_MASTER_KEY and NEW_MASTER_KEY must differ")

    engine = create_engine(db_url, echo=False)
    result = RotationResult(rotated=0, already_new=0, failed=[])

    with engine.begin() as conn:
        rows = list(_fetch_credentials(conn))
        logger.info(f"Found {len(rows)} credential row(s) to scan")

        for cred_id, system_id, tenant_id, ct, version in rows:
            cred_ref = f"cred={cred_id} system={system_id}"

            # Skip rows that are already at (or past) the target version.
            if version >= target_version:
                result.already_new += 1
                continue

            # Decrypt with old key
            try:
                plaintext = decrypt_with_key(old_key, str(tenant_id), ct)
            except Exception as e:
                logger.error(f"decrypt failed with OLD key for {cred_ref}: {e}")
                result.failed.append(cred_ref)
                continue

            # Re-encrypt with new key
            try:
                new_ct = encrypt_with_key(new_key, str(tenant_id), plaintext)
            except Exception as e:
                logger.error(f"re-encrypt failed for {cred_ref}: {e}")
                result.failed.append(cred_ref)
                continue

            if dry_run:
                logger.info(f"[DRY RUN] would rotate {cred_ref} v{version} -> v{target_version}")
            else:
                conn.execute(
                    text(
                        "UPDATE system_credentials "
                        "SET encrypted_password = :ct, key_version = :ver "
                        "WHERE id = :cid"
                    ),
                    {"ct": new_ct, "ver": target_version, "cid": cred_id},
                )
                logger.info(f"Rotated {cred_ref} v{version} -> v{target_version}")

            result.rotated += 1

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report only, don't write")
    parser.add_argument(
        "--target-version",
        type=int,
        default=None,
        help="new key_version to stamp (default: max(existing)+1)",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL_SYNC", os.environ.get("DATABASE_URL", "")),
        help="Override DB URL (default: DATABASE_URL_SYNC / DATABASE_URL env)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    old_key = os.environ.get("OLD_MASTER_KEY", "")
    new_key = os.environ.get("NEW_MASTER_KEY", "")
    if not old_key or not new_key:
        print("ERROR: OLD_MASTER_KEY and NEW_MASTER_KEY environment variables are required", file=sys.stderr)
        return 2
    if not args.database_url:
        print("ERROR: DATABASE_URL_SYNC / DATABASE_URL not set, and --database-url not passed", file=sys.stderr)
        return 2

    # Determine target version — default is highest existing + 1 so repeated
    # runs (mid-rotation) don't re-process rows already at the new version.
    target_version = args.target_version
    if target_version is None:
        eng = create_engine(args.database_url, echo=False)
        with eng.connect() as conn:
            current_max = conn.execute(
                text("SELECT COALESCE(MAX(key_version), 0) FROM system_credentials")
            ).scalar() or 0
        target_version = int(current_max) + 1
        eng.dispose()

    logger.info(f"Rotating to key_version {target_version} (dry_run={args.dry_run})")

    result = rotate(
        db_url=args.database_url,
        old_key=old_key,
        new_key=new_key,
        dry_run=args.dry_run,
        target_version=target_version,
    )

    print("")
    print(f"  Scanned:      {result.total_scanned}")
    print(f"  Rotated:      {result.rotated}")
    print(f"  Already new:  {result.already_new}")
    print(f"  Failed:       {len(result.failed)}")
    if result.failed:
        print("  Failed ids:")
        for f in result.failed:
            print(f"    - {f}")
        return 1

    if args.dry_run:
        print("\nDry run — no changes written.")
    else:
        print("\nRotation complete. Next steps:")
        print("  1. Update .env: CREDENTIAL_MASTER_KEY=<new>, CREDENTIAL_MASTER_KEY_PREV=<old>")
        print("  2. Restart the API + worker services")
        print("  3. Verify SAP extraction still works")
        print("  4. Remove CREDENTIAL_MASTER_KEY_PREV from .env and restart")

    return 0


if __name__ == "__main__":
    sys.exit(main())
