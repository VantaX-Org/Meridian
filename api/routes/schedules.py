"""Run schedules, across systems (the Admin area's Schedules tab).

  GET    /api/v1/schedules                 every schedule of the tenant (?system_id= narrows it)
  POST   /api/v1/schedules                 create
  GET    /api/v1/schedules/{id}            one
  PATCH  /api/v1/schedules/{id}            change name, cadence, modules, scope, mode
  POST   /api/v1/schedules/{id}/pause      stop it starting runs
  POST   /api/v1/schedules/{id}/resume     start it again, from the next occurrence
  DELETE /api/v1/schedules/{id}

A schedule is a sync_profiles row, the same one /systems/{id}/profiles reads and writes: both routes go through
api/services/run_schedules.py. Cadence is a cron expression or a preset (hourly, daily, weekdays, weekly, monthly);
scope is a download's scope. Every change writes an audit row.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import attention, run_schedules
from api.services.rbac import require_permission, write_audit

router = APIRouter(prefix="/api/v1/schedules", tags=["schedules"])

Preset = Literal["hourly", "daily", "weekdays", "weekly", "monthly"]


class ScopeIn(BaseModel):
    """What a scheduled download covers; empty = everything. Same keys as a manual download's scope."""
    model_config = ConfigDict(extra="forbid")
    company_codes: list[str] = Field(default_factory=list, max_length=200)
    plants: list[str] = Field(default_factory=list, max_length=200)
    sales_orgs: list[str] = Field(default_factory=list, max_length=200)
    purchasing_orgs: list[str] = Field(default_factory=list, max_length=200)
    date_from: str | None = None  # YYYY-MM-DD
    date_to: str | None = None
    exclude_deleted: bool = False


class ScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_id: str
    modules: list[str] = Field(min_length=1, max_length=40)
    name: str | None = Field(None, max_length=120)
    cron: str | None = Field(None, max_length=120)
    preset: Preset | None = None
    scope: ScopeIn = Field(default_factory=ScopeIn)
    extraction_mode: Literal["full", "delta"] = "full"
    active: bool = True


class SchedulePatch(BaseModel):
    """Only the keys sent change. ``cron: null`` or ``""`` with no preset makes the schedule manual."""
    model_config = ConfigDict(extra="forbid")
    modules: list[str] | None = Field(None, min_length=1, max_length=40)
    name: str | None = Field(None, max_length=120)
    cron: str | None = Field(None, max_length=120)
    preset: Preset | None = None
    scope: ScopeIn | None = None
    extraction_mode: Literal["full", "delta"] | None = None


def _check_modules(system_type: str, modules: list[str]) -> list[str]:
    from sap.extraction_plan import MODULES_BY_SYSTEM
    wanted = list(dict.fromkeys(m.strip() for m in modules if m and m.strip()))
    if not wanted:
        raise HTTPException(status_code=422, detail="Choose at least one module")
    unknown = sorted(set(wanted) - set(MODULES_BY_SYSTEM.get(system_type, [])))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Not available for a {system_type} system: {', '.join(unknown)}")
    return wanted


async def _one(db: AsyncSession, tenant: Tenant, schedule_id: str) -> dict[str, Any]:
    rows = [r for r in await run_schedules.list_schedules(db, tenant.id) if r["id"] == schedule_id]
    if not rows:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return rows[0]


@router.get("", dependencies=[Depends(require_permission("view"))])
async def list_schedules(system_id: str | None = Query(None), db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    """``{"schedules": [...]}``, each ``{id, name, system_id, system_name, domain, modules, tables, cadence: {cron,
    preset}, schedule_cron, scope, extraction_mode, active, status, last_run_at, next_run_at}``."""
    return {"schedules": await run_schedules.list_schedules(db, tenant.id, system_id)}


@router.get("/{schedule_id}", dependencies=[Depends(require_permission("view"))])
async def get_schedule(schedule_id: str, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    await run_schedules.get_schedule(db, tenant.id, schedule_id)
    return await _one(db, tenant, schedule_id)


@router.post("", status_code=201, dependencies=[Depends(require_permission("manage_systems"))])
async def create_schedule(body: ScheduleCreate, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    """Schedule a download of ``modules`` from one system. Without cron or preset the schedule is manual (it never
    starts by itself). 422 for a module the system type does not offer, a bad cron, a bad scope."""
    system = await run_schedules.system_row(db, tenant.id, body.system_id)
    modules = _check_modules(system.system_type, body.modules)
    row = await run_schedules.create_schedule(
        db, tenant.id, system_id=body.system_id, domain=modules[0], modules=modules, cron=body.cron,
        preset=body.preset, scope=body.scope.model_dump(), active=body.active, extraction_mode=body.extraction_mode,
        name=body.name)
    out = run_schedules.public(row, system.name)
    await write_audit(db, tenant.id, request, "schedule.create", "schedule", out["id"], None, out)
    await db.commit()
    attention.invalidate(tenant.id)
    return out


@router.patch("/{schedule_id}", dependencies=[Depends(require_permission("manage_systems"))])
async def update_schedule(schedule_id: str, body: SchedulePatch, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    sent = body.model_fields_set
    if not sent:
        raise HTTPException(status_code=422, detail="Nothing to update")
    cur = await run_schedules.get_schedule(db, tenant.id, schedule_id)
    before = await _one(db, tenant, str(cur.id))
    changes: dict[str, Any] = {}
    if "cron" in sent or "preset" in sent:
        changes["cron"], changes["preset"] = body.cron, body.preset
    for key in ("name", "extraction_mode"):
        if key in sent:
            changes[key] = getattr(body, key)
    if "scope" in sent:
        changes["scope"] = (body.scope or ScopeIn()).model_dump()
    if "modules" in sent:
        if body.modules is None:
            raise HTTPException(status_code=422, detail="modules cannot be null")
        system = await run_schedules.system_row(db, tenant.id, str(cur.system_id))
        changes["modules"] = _check_modules(system.system_type, body.modules)
    if "extraction_mode" in sent and body.extraction_mode is None:
        raise HTTPException(status_code=422, detail="extraction_mode cannot be null")
    await run_schedules.update_schedule(db, tenant.id, schedule_id, changes)
    out = await _one(db, tenant, str(cur.id))
    await write_audit(db, tenant.id, request, "schedule.update", "schedule", out["id"], before, out)
    await db.commit()
    attention.invalidate(tenant.id)
    return out


async def _set_active(schedule_id: str, active: bool, request: Request, db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    cur = await run_schedules.get_schedule(db, tenant.id, schedule_id)
    before = await _one(db, tenant, str(cur.id))
    if bool(cur.active) != active:
        await run_schedules.update_schedule(db, tenant.id, schedule_id, {"active": active})
    out = await _one(db, tenant, str(cur.id))
    if before["active"] != active:
        await write_audit(db, tenant.id, request, "schedule.resume" if active else "schedule.pause", "schedule",
                          out["id"], before, out)
        attention.invalidate(tenant.id)
    await db.commit()
    return out


@router.post("/{schedule_id}/pause", dependencies=[Depends(require_permission("manage_systems"))])
async def pause_schedule(schedule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    """Stop the schedule starting runs. Pausing a paused schedule changes nothing."""
    return await _set_active(schedule_id, False, request, db, tenant)


@router.post("/{schedule_id}/resume", dependencies=[Depends(require_permission("manage_systems"))])
async def resume_schedule(schedule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    """Start the schedule again from its next occurrence (a missed slot is not run)."""
    return await _set_active(schedule_id, True, request, db, tenant)


@router.delete("/{schedule_id}", dependencies=[Depends(require_permission("manage_systems"))])
async def delete_schedule(schedule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    cur = await run_schedules.get_schedule(db, tenant.id, schedule_id)
    before = await _one(db, tenant, str(cur.id))
    await run_schedules.delete_schedule(db, tenant.id, schedule_id)
    await write_audit(db, tenant.id, request, "schedule.delete", "schedule", before["id"], before, None)
    await db.commit()
    attention.invalidate(tenant.id)
    return {"id": before["id"], "status": "deleted"}
