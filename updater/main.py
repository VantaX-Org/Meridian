"""Meridian self-update sidecar.

Tiny, dependency-light FastAPI service that holds the Docker socket so the
`api`/`worker` containers (which handle tenant SAP data) never have to.
Reachable only over the internal `meridian-net` network — never a published
port — and intended to be called only by the `api` container.

Endpoints:
    POST /update  - starts scripts/update.sh as a background subprocess.
    GET  /status  - returns the last known progress written by update.sh.
    GET  /health  - trivial liveness probe for the compose healthcheck.

No database access, no dependencies beyond FastAPI/uvicorn and the stdlib —
this container's attack surface should stay as small as possible.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

INSTALL_DIR = os.environ.get("MERIDIAN_INSTALL_DIR", "/opt/meridian")
STATUS_FILE = os.path.join(INSTALL_DIR, ".update-status.json")
SHARED_SECRET = os.environ.get("UPDATER_SHARED_SECRET", "")

DEFAULT_STATUS: dict = {
    "state": "idle",
    "message": None,
    "started_at": None,
    "updated_at": None,
}

app = FastAPI(title="meridian-updater")

# Module-level state — this is a single-worker, single-purpose sidecar, not a
# multi-worker web app, so plain module globals are fine.
_process: Optional["asyncio.subprocess.Process"] = None
_lock = asyncio.Lock()
_last_good_status: dict = dict(DEFAULT_STATUS)


class UpdateStatus(BaseModel):
    state: str
    message: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None


@app.post("/update", status_code=202)
async def start_update(x_updater_secret: Optional[str] = Header(None, alias="X-Updater-Secret")):
    # Fail closed if this sidecar was started without a secret configured —
    # otherwise hmac.compare_digest(b"", b"") on a missing header would
    # return True, letting anyone on meridian-net trigger an update.
    if not SHARED_SECRET:
        raise HTTPException(status_code=503, detail="Updater has no shared secret configured")
    # hmac.compare_digest, not `==` — constant-time comparison against timing attacks.
    if not hmac.compare_digest((x_updater_secret or "").encode(), SHARED_SECRET.encode()):
        raise HTTPException(status_code=401)

    global _process
    async with _lock:
        if _process is not None and _process.returncode is None:
            return JSONResponse({"status": "already_running"}, status_code=409)

        env = dict(os.environ)
        env["MERIDIAN_UPDATE_STATUS_FILE"] = STATUS_FILE

        # NEVER pass --include-updater here: that flag is the separate,
        # rare, operator-driven path for upgrading this sidecar's own image
        # (sudo bash scripts/update.sh --include-updater). If this container
        # restarted itself mid-script, the running update.sh process would be
        # killed mid-flight, corrupting the update.
        _process = await asyncio.create_subprocess_exec(
            "bash",
            "scripts/update.sh",
            cwd=INSTALL_DIR,
            env=env,
        )
        # Reap the child promptly once it exits, without blocking this request.
        asyncio.create_task(_process.wait())

    return JSONResponse({"status": "started"}, status_code=202)


@app.get("/status", response_model=UpdateStatus)
async def get_status() -> dict:
    global _last_good_status

    if not os.path.isfile(STATUS_FILE):
        return _last_good_status

    # Read defensively: update.sh writes atomically (tmp file + mv), but a
    # reader can still race a write in flight. Retry once, then fall back to
    # the last known good copy rather than 500ing.
    for attempt in range(2):
        try:
            with open(STATUS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            _last_good_status = data
            return data
        except (OSError, json.JSONDecodeError):
            if attempt == 0:
                await asyncio.sleep(0.05)
                continue

    return _last_good_status


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    # Single worker — module-level state (the running-update lock/process
    # handle) would not be shared across multiple worker processes.
    uvicorn.run(app, host="0.0.0.0", port=8080, workers=1)
