"""Connectivity Management API -- module-aware extraction, config sync, health."""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from api.services.rbac import require_permission
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.models.config_score import LandscapeConfigStatus
from api.services import jobs

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


@router.post("/extract", dependencies=[Depends(require_permission("trigger_sync"))])
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

    version_id = str(uuid.uuid4())
    jobs.start_job(str(tenant.id), f"dl-{version_id}", "extraction", ", ".join(body.modules), status="queued",
                   system_id=body.system_id, modules=body.modules, version_id=version_id)
    run_extraction.delay(str(tenant.id), body.system_id, body.modules, body.include_config, body.sync_type,
                         None, True, None, version_id)
    return {"job_id": f"dl-{version_id}", "version_id": version_id, "status": "queued", "modules": body.modules}


@router.post("/config-sync", dependencies=[Depends(require_permission("trigger_sync"))])
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

    task_id = str(uuid.uuid4())
    jobs.start_job(str(tenant.id), f"cfg-{task_id}", "config_sync", f"Configuration: {', '.join(body.modules)}",
                   status="queued", system_id=body.system_id, modules=body.modules)
    run_config_sync.apply_async(args=(str(tenant.id), body.system_id, body.modules), task_id=task_id)
    return {"job_id": f"cfg-{task_id}", "status": "queued"}


@router.post("/health-check/{system_id}", dependencies=[Depends(require_permission("trigger_sync"))])
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


# -- Config load: read-only configuration snapshot of one system + flow derivation ----------------------------


class ConfigLoadRequest(BaseModel):
    system_id: str


@router.post("/config-load", dependencies=[Depends(require_permission("trigger_sync"))])
async def start_config_load(
    body: ConfigLoadRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Load all configuration of the system in one job (every module), then derive the process flows.
    Read only. Call it right after a successful test connection; poll ``GET /api/v1/jobs/{job_id}``."""
    from api.services.config_pairing import enqueue_config_load

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    out = await enqueue_config_load(db, str(tenant.id), body.system_id, force=True)
    if out is None:
        raise HTTPException(404, "System not found")
    return out


@router.get("/config-load", response_model=LandscapeConfigStatus)
async def list_config_status(
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Configuration status of every active system (latest source load each): loaded, with_gaps, loading,
    not_loaded, failed, not_available, with areas loaded of total. ``loaded`` of ``total`` counts only systems
    whose configuration can be read."""
    from api.services.config_areas import system_status

    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    tid = str(tenant.id)
    rows = (await db.execute(text(
        "SELECT s.id::text, s.name, s.system_type, l.id::text, l.status, l.objects, l.error, l.finished_at::text "
        "FROM sap_systems s LEFT JOIN LATERAL (SELECT id, status, objects, error, finished_at FROM config_loads c "
        "WHERE c.tenant_id = :tid AND c.system_id = s.id ORDER BY c.created_at DESC LIMIT 1) l "
        "ON true WHERE s.tenant_id = :tid AND s.is_active ORDER BY s.name"), {"tid": tid})).fetchall()
    out = []
    for sid, name, st, lid, lstatus, objects, error, finished in rows:
        load = {"status": lstatus, "objects": objects or [], "error": error} if lid else None
        job_id = f"cfgload-{lid}" if lid and lstatus in ("running", "queued") else None
        job_areas = (jobs.get_job(tid, job_id) or {}).get("areas") if job_id else None
        s_ = system_status(st, load, job_areas)
        out.append({"system_id": sid, "name": name, "system_type": st, "status": s_["status"], "load_id": lid,
                    "job_id": job_id, "loaded_at": finished if lstatus == "completed" else None,
                    "areas_loaded": s_["areas_loaded"], "areas_total": s_["areas_total"],
                    "current_area": s_["current_area"], "error": error if lstatus == "failed" else None})
    counts: dict[str, int] = {}
    for r in out:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"systems": out, "counts": counts, "loaded": counts.get("loaded", 0),
            "total": sum(1 for r in out if r["status"] != "not_available")}


@router.get("/config-load/{system_id}")
async def get_config_load(
    system_id: str,
    role: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Latest config load of the system: per-object state (loaded, empty, failed, not_available), the customizing
    change history (last change date and change count per table; ``table_logging_off`` when DBTABLOG is empty)
    and whether flows were derived."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    r = (await db.execute(
        text("SELECT id::text, system_type, role, origin, status, objects, history, error, created_at::text, "
             "finished_at::text, derivation IS NOT NULL FROM config_loads "
             "WHERE tenant_id = :tid AND system_id = :sid AND (CAST(:role AS text) IS NULL OR role = :role) "
             "ORDER BY created_at DESC LIMIT 1"),
        {"tid": str(tenant.id), "sid": system_id, "role": role})).fetchone()
    if not r:
        raise HTTPException(404, "No configuration load for this system")
    objects = r[5] or []
    history = r[6] or {}
    per_table = history.get("tables") or {}
    summary: dict[str, int] = {}
    for o in objects:
        o["history"] = per_table.get(o["object"])
        summary[o["state"]] = summary.get(o["state"], 0) + 1
    from api.services.config_areas import system_status

    job_areas = (jobs.get_job(str(tenant.id), f"cfgload-{r[0]}") or {}).get("areas") \
        if r[4] in ("running", "queued") else None
    cfg = system_status(r[1], {"status": r[4], "objects": objects, "error": r[7]}, job_areas)
    return {"load_id": r[0], "system_id": system_id, "system_type": r[1], "role": r[2], "origin": r[3],
            "status": r[4], "error": r[7], "created_at": r[8], "finished_at": r[9], "flows_derived": r[10],
            "config_status": cfg["status"], "areas": cfg["areas"], "areas_loaded": cfg["areas_loaded"],
            "areas_total": cfg["areas_total"], "current_area": cfg["current_area"],
            "summary": summary, "objects": objects,
            "history": {k: v for k, v in history.items() if k != "tables"}}


@router.get("/config-load/{system_id}/items")
async def get_config_load_items(
    system_id: str,
    object: str,
    role: Optional[str] = None,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    """Config items (object + key + values) of the latest completed load for one config object."""
    await db.execute(text(f"SET app.tenant_id = \'{str(tenant.id)}\'"))
    rows = (await db.execute(
        text("SELECT i.key, i.\"values\" FROM config_items i WHERE i.tenant_id = :tid AND i.object = :obj "
             "AND i.load_id = (SELECT id FROM config_loads WHERE tenant_id = :tid AND system_id = :sid "
             "AND (CAST(:role AS text) IS NULL OR role = :role) AND status = 'completed' "
             "ORDER BY created_at DESC LIMIT 1) "
             "ORDER BY i.key LIMIT :lim"),
        {"tid": str(tenant.id), "sid": system_id, "obj": object, "role": role,
         "lim": max(1, min(limit, 5000))})).fetchall()
    return {"system_id": system_id, "object": object, "items": [{"key": r[0], "values": r[1]} for r in rows]}
