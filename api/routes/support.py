"""Support diagnostics: what a person needs to hand to Meridian support, in one document.

``GET /api/v1/support/diagnostics`` (administrators only) returns the platform version, the tenant id, whether the
licence is valid, the health of the database, the cache and the workers, the last 20 server errors by their
reference code, and the counts of the jobs the registry holds. It carries no secret (no key, token, password or
connection string), no SAP data and no request body: an error is its reference, method, path and time. Each call
writes an audit row.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import jobs
from api.services.rbac import require_permission, write_audit
from api.services.version import APP_VERSION

router = APIRouter(prefix="/api/v1/support", tags=["support"])

ERROR_LIMIT = 20
PROBE_TIMEOUT_S = 3.0


async def _database(db: AsyncSession) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(db.execute(text("SELECT 1")), PROBE_TIMEOUT_S)
        return {"status": "ok", "latency_ms": round((time.perf_counter() - started) * 1000)}
    except Exception as e:  # the class name only: a database error can carry the connection string
        return {"status": "fail", "error": type(e).__name__}


async def _cache() -> dict[str, Any]:
    started = time.perf_counter()
    try:
        ok = await asyncio.wait_for(asyncio.to_thread(_ping_sync), PROBE_TIMEOUT_S)
        return {"status": "ok" if ok else "fail", "latency_ms": round((time.perf_counter() - started) * 1000)}
    except Exception as e:
        return {"status": "fail", "error": type(e).__name__}


def _ping_sync() -> bool:
    from api.services.task_progress import _redis_client
    client = _redis_client()
    return bool(client is not None and client.ping())


def _ping_workers() -> list[str]:
    from workers.celery_app import celery_app
    return sorted((celery_app.control.inspect(timeout=1.0).ping() or {}).keys())


async def _workers() -> dict[str, Any]:
    try:
        names = await asyncio.wait_for(asyncio.to_thread(_ping_workers), PROBE_TIMEOUT_S)
        return {"status": "ok" if names else "fail", "count": len(names),
                **({} if names else {"error": "no worker answered"})}
    except Exception as e:
        return {"status": "unknown", "count": 0, "error": type(e).__name__}


def _licence() -> dict[str, Any]:
    try:
        from api.middleware.licence import get_cached_licence
        lic = get_cached_licence() or {}
        return {"valid": lic.get("valid"), "status": lic.get("status"), "expires_at": lic.get("expires_at"),
                "last_checked": lic.get("last_checked"), "modules": len(lic.get("modules") or [])}
    except Exception as e:
        return {"valid": None, "status": "unknown", "error": type(e).__name__}


def job_counts(tenant_id: str) -> dict[str, int]:
    listed = jobs.list_jobs(tenant_id, limit=jobs.INDEX_KEEP)
    counts = {"total": len(listed), "queued": 0, "running": 0, "completed": 0, "failed": 0, "cancelled": 0}
    for j in listed:
        if j.get("status") in counts:
            counts[j["status"]] += 1
    return counts


@router.get("/diagnostics", dependencies=[Depends(require_permission("manage_system"))])
async def diagnostics(request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(tenant.id)})
    database = await _database(db)
    cache, workers = await asyncio.gather(_cache(), _workers())
    errors = (await db.execute(text(
        "SELECT entity_id, method, path, status_code, created_at FROM audit_log "
        "WHERE tenant_id = :t AND action = 'server_error' ORDER BY created_at DESC LIMIT :n"),
        {"t": str(tenant.id), "n": ERROR_LIMIT})).fetchall()
    doc = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "version": APP_VERSION,
        "tenant_id": str(tenant.id),
        "licence": _licence(),
        "health": {"database": database, "cache": cache, "workers": workers},
        "server_errors": [{"reference": r.entity_id, "method": r.method, "path": r.path, "status_code": r.status_code,
                           "at": r.created_at.isoformat()} for r in errors],
        "jobs": job_counts(str(tenant.id)),
    }
    await write_audit(db, tenant.id, request, "support.diagnostics", "support", str(tenant.id), None,
                      {"errors": len(errors), "jobs": doc["jobs"]["total"]})
    await db.commit()
    return doc
