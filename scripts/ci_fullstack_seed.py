#!/usr/bin/env python3
"""Prepare a live stack for the full-stack e2e (.github/workflows/fullstack-e2e.yml).

Signs in as the default administrator, replaces the public default password, registers an ECC system with no
reachable SAP, uploads synthetic business partner and material master extracts attached to it
(tests/fixtures/realistic_sap_data.py, no real data) and waits until the worker has analysed both.
The role users are made beforehand with scripts/manage_users.py. Environment: SEED_API_URL, ACCEPTANCE_ADMIN_PASSWORD.
"""
import io
import os
import sys
import time

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.fixtures.realistic_sap_data import (  # noqa: E402
    generate_realistic_business_partner,
    generate_realistic_material_master,
)

API = os.environ.get("SEED_API_URL", "http://127.0.0.1:8000").rstrip("/") + "/api/v1"
ROWS = int(os.environ.get("SEED_ROWS", "2000"))
NEW_PW = os.environ["ACCEPTANCE_ADMIN_PASSWORD"]


def main() -> int:
    c = httpx.Client(base_url=API, timeout=60)
    r = c.post("/auth/login", json={"email": "admin@meridian.local", "password": "admin"})
    r.raise_for_status()
    r = c.post("/auth/change-password", json={"current_password": "admin", "new_password": NEW_PW},
               headers={"Authorization": f"Bearer {r.json()['token']}"})
    r.raise_for_status()
    auth = {"Authorization": f"Bearer {r.json()['token']}"}

    r = c.post("/systems", headers=auth, json={
        "name": "ECC acceptance", "system_type": "ecc", "environment": "QAS", "host": "sap.invalid",
        "client": "100", "sysnr": "00", "credentials": {"password": "unused"}})
    r.raise_for_status()
    system_id = r.json()["id"]

    frames = {"business_partner": generate_realistic_business_partner(n=ROWS),
              "material_master": generate_realistic_material_master(n=ROWS)}
    versions = []
    for module, df in frames.items():
        r = c.post("/upload", headers=auth, data={"module": module, "system_id": system_id},
                   files={"file": (f"{module}.csv", io.BytesIO(df.to_csv(index=False).encode()), "text/csv")})
        r.raise_for_status()
        versions.append((module, r.json()["version_id"]))
        print(f"uploaded {module}: {len(df)} rows, version {versions[-1][1]}")

    deadline = time.time() + 600
    for module, vid in versions:
        while True:
            job = c.get(f"/jobs/{vid}", headers=auth).json()
            print(f"{module}: {job.get('status')} {job.get('percent')}%")
            if job.get("status") == "completed":
                break
            if job.get("status") in ("failed", "cancelled") or time.time() > deadline:
                print(f"{module} did not finish: {job}", file=sys.stderr)
                return 1
            time.sleep(5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
