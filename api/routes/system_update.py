"""Platform self-update — GET status, POST trigger, GET progress.

Admin-only (require_permission("manage_system")). The actual pull/restart/
migrate/health-check/rollback sequence lives entirely in scripts/update.sh,
invoked by the updater sidecar (docker/docker-compose.updater.yml) which is
the only container holding the Docker socket. This module never touches
Docker itself — it only talks to the sidecar over the internal network and
records the outcome in system_update_log for audit purposes.

"latest_version" comes from Meridian HQ's licence server, piggybacked on the
existing licence-manifest cache (api/middleware/licence.py) — no separate
polling loop needed.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.middleware.licence import get_cached_manifest
from api.services import updater_client
from api.services.rbac import require_permission
from api.services.version import APP_VERSION, is_newer

logger = logging.getLogger("meridian.system_update")

router = APIRouter(prefix="/api/v1/system", tags=["system"])

_TERMINAL_STATES = {"done", "failed", "rolled_back"}


async def _set_rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant_id)}'"))


@router.get("/update-status")
async def get_update_status_route(
    _role: str = Depends(require_permission("manage_system")),
):
    manifest = get_cached_manifest()
    latest_version = manifest.get("latest_version") or None
    return {
        "current_version": APP_VERSION,
        "latest_version": latest_version or APP_VERSION,
        "update_available": is_newer(latest_version, APP_VERSION),
        "release_notes": manifest.get("release_notes") or "",
        "updater_configured": bool(settings.updater_shared_secret),
    }


@router.post("/update/trigger", status_code=202)
async def trigger_update_route(
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_system")),
):
    result = await updater_client.trigger_update()
    status = result.get("status")

    if status == "not_configured":
        raise HTTPException(
            status_code=404,
            detail="Self-update isn't set up for this deployment yet.",
        )
    if status == "already_running":
        raise HTTPException(status_code=409, detail="An update is already in progress")
    if status == "unauthorized":
        # Shared secret mismatch between api and updater — an install/config
        # bug, not something a click can retry past.
        logger.error("Updater rejected our shared secret — check UPDATER_SHARED_SECRET")
        raise HTTPException(status_code=500, detail="Updater sidecar rejected authentication")
    if status != "started":
        raise HTTPException(status_code=503, detail="Updater sidecar unreachable")

    await _set_rls(db, tenant.id)
    manifest = get_cached_manifest()
    raw_user_id = getattr(request.state, "local_user_id", None)
    await db.execute(
        text("""
            INSERT INTO system_update_log
                (id, tenant_id, triggered_by_user_id, triggered_by_email,
                 from_version, to_version_requested, status, started_at)
            VALUES
                (:id, :tid, :uid, :email, :from_v, :to_v, 'started', :now)
        """),
        {
            "id": uuid.uuid4(),
            "tid": tenant.id,
            "uid": uuid.UUID(raw_user_id) if raw_user_id else None,
            "email": getattr(request.state, "local_user_email", None),
            "from_v": APP_VERSION,
            "to_v": manifest.get("latest_version") or "unknown",
            "now": datetime.now(timezone.utc),
        },
    )
    await db.commit()

    return {"status": "started"}


@router.get("/update/progress")
async def get_update_progress_route(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _role: str = Depends(require_permission("manage_system")),
):
    result = await updater_client.get_update_status()
    sidecar_status = result.get("status")

    if sidecar_status == "not_configured":
        raise HTTPException(
            status_code=404,
            detail="Self-update isn't set up for this deployment yet.",
        )
    if sidecar_status == "unreachable":
        # Expected mid-update: scripts/update.sh recreates api/worker/frontend/
        # nginx, so the sidecar (and everything else) goes dark for a window.
        # Not an error — the frontend treats this as "still restarting".
        return {"status": "reconnecting", "message": None, "started_at": None, "updated_at": None}

    state = result.get("state", "idle")
    response = {
        "status": state,
        "message": result.get("message"),
        "started_at": result.get("started_at"),
        "updated_at": result.get("updated_at"),
    }

    if state in _TERMINAL_STATES:
        await _set_rls(db, tenant.id)
        await db.execute(
            text("""
                UPDATE system_update_log
                SET status = :status,
                    to_version_actual = :actual,
                    error_detail = :err,
                    finished_at = :now
                WHERE id = (
                    SELECT id FROM system_update_log
                    WHERE tenant_id = :tid AND status = 'started'
                    ORDER BY started_at DESC LIMIT 1
                )
            """),
            {
                "status": state,
                # This request handler is running in whichever api process is
                # currently up — once the update reaches "done" that's the
                # freshly-recreated container on the NEW image, so APP_VERSION
                # (read once at import time) already reflects the new version.
                "actual": APP_VERSION if state == "done" else None,
                "err": result.get("message") if state in ("failed", "rolled_back") else None,
                "now": datetime.now(timezone.utc),
                "tid": str(tenant.id),
            },
        )
        await db.commit()

    return response
