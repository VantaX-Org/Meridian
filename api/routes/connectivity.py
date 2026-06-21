"""Connectivity Management API -- module-aware extraction, config sync, health."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant

router = APIRouter(prefix="/api/v1/connectivity", tags=["connectivity"])
logger = logging.getLogger("meridian.connectivity")


class ExtractModuleRequest(BaseModel):
    system_id: str
    modules: list[str]
    include_config: bool = True
    sync_type: str = "both"  # data, config, both


class ConfigSyncRequest(BaseModel):
    system_id: str
    modules: list[str]


@router.get("/systems/{system_id}/modules")
async def list_system_modules(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """List available modules for a system with sync status."""
    from sap.extraction_registry import get_available_modules

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))

    # Get system type
    result = await db.execute(
        text("SELECT system_type FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
        {"sid": system_id, "tid": str(tenant.id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "System not found")

    system_type = row[0]
    modules = get_available_modules(system_type)

    # Enrich with sync status
    status_result = await db.execute(
        text("SELECT module, enabled, last_synced_at::text, last_sync_status, "
             "row_count, config_synced FROM system_module_map "
             "WHERE tenant_id = :tid AND system_id = :sid"),
        {"tid": str(tenant.id), "sid": system_id},
    )
    status_map = {
        r[0]: {"enabled": r[1], "last_synced_at": r[2], "last_sync_status": r[3],
               "row_count": r[4], "config_synced": r[5]}
        for r in status_result.fetchall()
    }

    return [
        {
            "module": m,
            "system_type": system_type,
            **status_map.get(m, {"enabled": True, "last_synced_at": None,
                                  "last_sync_status": None, "row_count": 0,
                                  "config_synced": False}),
        }
        for m in modules
    ]


@router.post("/extract")
async def extract_modules(
    body: ExtractModuleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Extract data and/or config for selected modules from a system."""
    from api.middleware.licence import enforce_licensed_modules
    from workers.tasks.run_extraction import run_extraction

    enforce_licensed_modules(request, body.modules)

    job = run_extraction.delay(
        str(tenant.id), body.system_id, body.modules,
        body.include_config, body.sync_type,
    )
    return {"job_id": job.id, "status": "queued", "modules": body.modules}


@router.post("/config-sync")
async def sync_config(
    body: ConfigSyncRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Sync SPRO/FO configuration only (no transactional data)."""
    from api.middleware.licence import enforce_licensed_modules
    from workers.tasks.run_config_sync import run_config_sync

    enforce_licensed_modules(request, body.modules)

    job = run_config_sync.delay(str(tenant.id), body.system_id, body.modules)
    return {"job_id": job.id, "status": "queued"}


@router.post("/health-check/{system_id}")
async def health_check(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Run a connection health check."""
    from workers.tasks.run_health_check import run_health_check

    job = run_health_check.delay(str(tenant.id), system_id)
    return {"job_id": job.id, "status": "queued"}


@router.get("/config/{system_id}/{module}")
async def get_config_snapshot(
    system_id: str,
    module: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Return cached config snapshot for a system+module."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    result = await db.execute(
        text("SELECT config_table, config_data, record_count, source, "
             "synced_at::text FROM config_snapshots "
             "WHERE tenant_id = :tid AND system_id = :sid AND module = :mod"),
        {"tid": str(tenant.id), "sid": system_id, "mod": module},
    )
    rows = result.fetchall()
    return {
        "system_id": system_id,
        "module": module,
        "tables": [
            {"table": r[0], "data": r[1], "record_count": r[2],
             "source": r[3], "synced_at": r[4]}
            for r in rows
        ],
    }
