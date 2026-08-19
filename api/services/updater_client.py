"""Thin HTTP client for the updater sidecar (docker/docker-compose.updater.yml).

The sidecar is the only container holding the Docker socket, reachable only
over the internal `meridian-net` network. It may be absent (deployment never
onboarded the self-update feature — see scripts/enable-auto-update.sh) or
unreachable mid-update (the update it's running restarts the api container
itself). Both cases are expected, not errors — callers get a plain dict back,
never an exception, so route handlers can degrade gracefully instead of 500ing.
"""

import logging

import httpx

from api.config import settings

logger = logging.getLogger("meridian.updater_client")

_TIMEOUT = httpx.Timeout(10.0)


async def trigger_update() -> dict:
    """POST /update on the sidecar. Returns {"status": ...} — "started",
    "already_running", "unauthorized", or "unreachable"."""
    if not settings.updater_shared_secret:
        return {"status": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{settings.updater_url}/update",
                headers={"X-Updater-Secret": settings.updater_shared_secret},
            )
            if resp.status_code == 401:
                logger.error("Updater sidecar rejected our shared secret")
                return {"status": "unauthorized"}
            if resp.status_code == 409:
                return {"status": "already_running"}
            resp.raise_for_status()
            return resp.json()
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        logger.warning("Updater sidecar unreachable: %s", e)
        return {"status": "unreachable"}
    except httpx.HTTPError as e:
        logger.warning("Updater sidecar returned an error: %s", e)
        return {"status": "unreachable"}


async def get_update_status() -> dict:
    """GET /status on the sidecar. Returns the sidecar's status dict, or
    {"status": "unreachable"} if it can't be reached — the expected state for
    a chunk of any real update (update.sh recreates the ingress + api itself)."""
    if not settings.updater_shared_secret:
        return {"status": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{settings.updater_url}/status")
            resp.raise_for_status()
            return resp.json()
    except (httpx.ConnectError, httpx.TimeoutException) as e:
        logger.info("Updater sidecar unreachable during status poll: %s", e)
        return {"status": "unreachable"}
    except httpx.HTTPError as e:
        logger.warning("Updater sidecar status check failed: %s", e)
        return {"status": "unreachable"}
