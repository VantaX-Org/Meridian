"""Status page and scheduled maintenance.

* ``GET /api/v1/status/page``: no sign-in needed (the tenant is the deployment's, see
  api/services/tenant_settings.resolve_public_tenant). Component health probed live (cached 15 s per API process),
  the last 24 hours of server errors grouped by reference, scheduled maintenance, and the uptime over 30 days from
  health_samples (filled every 5 minutes by workers/tasks/health_samples.py). Nothing on it names a user, a
  record or a credential: an incident shows its reference, counts, times and the API area (the first three path
  segments), never the full path, which can carry a record key.
* ``GET/PUT /api/v1/settings/maintenance`` (manage_settings): the scheduled maintenance windows, tenant_settings key
  ``maintenance``. Audited.

GET /health is unchanged.
"""
from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import health_probe
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_id, require_permission, write_audit
from api.services.tenant_settings import (
    get_setting,
    put_setting,
    resolve_public_tenant,
    set_rls,
)

router = APIRouter(prefix="/api/v1", tags=["status"])

MAINTENANCE_KEY = "maintenance"
MAX_WINDOWS = 20
CACHE_TTL_S = 15.0
_public_limit = rate_limit("public_status", limit=60, window_s=60, key_by="ip")
_cache: dict[str, Any] = {"at": 0.0, "components": None}
_cache_lock = threading.Lock()


class MaintenanceWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    starts_at: datetime
    ends_at: datetime
    detail: Optional[str] = Field(default=None, max_length=500)


class MaintenanceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    windows: list[MaintenanceWindow] = Field(default_factory=list, max_length=MAX_WINDOWS)


class MaintenanceOut(BaseModel):
    windows: list[dict[str, Any]]


def area(path: Optional[str]) -> Optional[str]:
    """'/api/v1/work/records/material_master/MATNR=1' -> '/api/v1/work': the API area, never a record key."""
    if not path:
        return None
    parts = [p for p in path.split("?")[0].split("/") if p][:3]
    return "/" + "/".join(parts)


def _components_now() -> list[health_probe.Component]:
    """Live probes, cached CACHE_TTL_S per process so a busy status page costs one probe set per 15 s."""
    with _cache_lock:
        if _cache["components"] is not None and time.monotonic() - _cache["at"] < CACHE_TTL_S:
            return _cache["components"]
    from workers.db import get_sync_engine

    api = health_probe.Component("api", health_probe.LABELS["api"], "up", 0)
    comps = health_probe.collect(get_sync_engine(), api=api)
    with _cache_lock:
        _cache.update(at=time.monotonic(), components=comps)
    return comps


async def incidents_24h(db: AsyncSession, tenant_id: uuid.UUID, limit: int = 50) -> list[dict[str, Any]]:
    rows = (await db.execute(text(
        "SELECT entity_id, count(*), min(created_at), max(created_at), "
        "       array_agg(DISTINCT method || ' ' || path) "
        "  FROM audit_log WHERE tenant_id = :t AND action = 'server_error' AND created_at >= now() - interval '24 hours' "
        " GROUP BY entity_id ORDER BY max(created_at) DESC LIMIT :n"),
        {"t": str(tenant_id), "n": limit})).fetchall()
    out = []
    for ref, n, first, last, routes in rows:
        areas = sorted({f"{r.split(' ', 1)[0]} {area(r.split(' ', 1)[1])}" for r in (routes or []) if r and " " in r})
        out.append({"reference": ref, "count": int(n), "first_seen": first.isoformat(), "last_seen": last.isoformat(),
                    "areas": areas[:5]})
    return out


def _windows(raw: Any) -> list[dict[str, Any]]:
    items = raw.get("windows") if isinstance(raw, dict) else None
    return [w for w in items if isinstance(w, dict)] if isinstance(items, list) else []


def _upcoming(windows: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    out = []
    for w in windows:
        try:
            starts, ends = datetime.fromisoformat(w["starts_at"]), datetime.fromisoformat(w["ends_at"])
        except (KeyError, TypeError, ValueError):
            continue
        if ends <= now:
            continue
        out.append({**w, "in_progress": starts <= now})
    return sorted(out, key=lambda w: w["starts_at"])


async def uptime(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(days=health_probe.UPTIME_DAYS)
    per_component = (await db.execute(text(health_probe.UPTIME_SQL), {"t": str(tenant_id), "since": since})).fetchall()
    per_day = (await db.execute(text(health_probe.SLOTS_SQL),
                                {"t": str(tenant_id), "since": since, "core": list(health_probe.CORE)})).fetchall()
    return health_probe.uptime_from_rows(per_component, per_day)


@router.get("/status/page", dependencies=[Depends(_public_limit)])
async def status_page(tenant: Optional[str] = Query(None, max_length=64),
                      db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """{status, generated_at, components[], incidents[], maintenance[], uptime{}}. No sign-in."""
    tid = await resolve_public_tenant(db, tenant)
    await set_rls(db, tid)
    now = datetime.now(timezone.utc)
    incidents = await incidents_24h(db, tid)
    maintenance = _upcoming(_windows(await get_setting(db, tid, MAINTENANCE_KEY)), now)
    up = await uptime(db, tid)
    await db.close()  # the probes below must not hold a pooled connection
    comps = await asyncio.to_thread(_components_now)
    return {
        "status": health_probe.overall(comps),
        "generated_at": now.isoformat(),
        "components": [c.as_dict() for c in comps],
        "incidents": incidents,
        "maintenance": maintenance,
        "uptime": up,
    }


@router.get("/settings/maintenance", dependencies=[Depends(require_permission("manage_settings"))])
async def get_maintenance(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> MaintenanceOut:
    await set_rls(db, tenant.id)
    return MaintenanceOut(windows=_windows(await get_setting(db, tenant.id, MAINTENANCE_KEY)))


@router.put("/settings/maintenance", dependencies=[Depends(require_permission("manage_settings"))])
async def put_maintenance(body: MaintenanceIn, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> MaintenanceOut:
    """Replace the scheduled maintenance windows. Times need a time zone and a window must end after it starts."""
    windows = []
    for w in body.windows:
        if w.starts_at.tzinfo is None or w.ends_at.tzinfo is None:
            raise HTTPException(status_code=422, detail="Give maintenance times with a time zone")
        if w.ends_at <= w.starts_at:
            raise HTTPException(status_code=422, detail="A maintenance window must end after it starts")
        windows.append({"id": str(uuid.uuid4()), "title": w.title.strip(),
                        "starts_at": w.starts_at.astimezone(timezone.utc).isoformat(),
                        "ends_at": w.ends_at.astimezone(timezone.utc).isoformat(), "detail": w.detail})
    windows.sort(key=lambda w: w["starts_at"])
    await set_rls(db, tenant.id)
    before = await get_setting(db, tenant.id, MAINTENANCE_KEY)
    await put_setting(db, tenant.id, MAINTENANCE_KEY, {"windows": windows}, current_user_id(request))
    await write_audit(db, tenant.id, request, "maintenance.update", "tenant_settings", MAINTENANCE_KEY,
                      before if isinstance(before, dict) else None, {"windows": windows})
    await db.commit()
    return MaintenanceOut(windows=windows)
