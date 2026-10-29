"""Run schedules: one service behind every way to schedule an extraction.

A run schedule is a ``sync_profiles`` row: a system, the modules to download, a cadence (cron, or a preset that
stands for one), an extraction scope (company codes, plants, sales and purchasing organisations, a date range) and
the next time the beat task ``sync_profile_scheduler`` starts it. Two routes write them, both through this module:

* ``/api/v1/schedules``: the cross-system CRUD (list, create, update, pause, resume, delete) the Admin area uses.
* ``/api/v1/systems/{id}/profiles``: the older per-system routes (api/routes/systems.py), unchanged on the wire.

Every function takes the caller's session, sets the tenant for RLS, filters on ``tenant_id`` and leaves the commit to
the caller. Nothing here touches SAP.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from croniter import croniter
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# cadence preset -> cron (the beat task reads the cron; a preset is the name the UI chose)
PRESETS: dict[str, str] = {
    "hourly": "0 * * * *",
    "daily": "0 2 * * *",
    "weekdays": "0 2 * * 1-5",
    "weekly": "0 2 * * 1",
    "monthly": "0 2 1 * *",
}

COLUMNS = ("id, tenant_id, system_id, domain, tables, schedule_cron, active, last_run_at, next_run_at, modules, "
           "extraction_mode, name, preset, scope")


def _next_run(cron: str | None) -> datetime | None:
    if not cron:
        return None
    from workers.scheduler import _compute_next_run
    return _compute_next_run(cron)


async def _rls(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(tenant_id)})


def resolve_cadence(cron: str | None, preset: str | None) -> tuple[str | None, str | None]:
    """(cron, preset) to store. Give a preset or a cron, not both; neither is a manual schedule. 422 on anything else."""
    cron = (cron or "").strip() or None
    preset = (preset or "").strip().lower() or None
    if cron and preset:
        raise HTTPException(status_code=422, detail="Give a cron expression or a preset, not both")
    if preset:
        if preset not in PRESETS:
            raise HTTPException(status_code=422, detail=f"Unknown preset. Choose one of: {', '.join(PRESETS)}")
        return PRESETS[preset], preset
    if cron and not croniter.is_valid(cron):
        raise HTTPException(status_code=422, detail="Invalid cron expression")
    return cron, None


def resolve_scope(scope: dict | None) -> dict:
    from sap.extraction_plan import normalise_scope
    try:
        return normalise_scope(scope)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


async def system_row(db: AsyncSession, tenant_id: uuid.UUID, system_id: str) -> Any:
    try:
        sid = str(uuid.UUID(str(system_id)))
    except ValueError:
        raise HTTPException(status_code=404, detail="System not found")
    row = (await db.execute(text("SELECT id, name, system_type FROM sap_systems WHERE id = :s AND tenant_id = :t"),
                            {"s": sid, "t": str(tenant_id)})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")
    return row


def public(row: Any, system_name: str | None = None) -> dict[str, Any]:
    """The schedule as the cross-system API returns it."""
    scope = row.scope if isinstance(row.scope, dict) else {}
    return {
        "id": str(row.id),
        "name": row.name,
        "system_id": str(row.system_id),
        "system_name": system_name,
        "domain": row.domain,
        "modules": list(row.modules or []) or [row.domain],
        "tables": list(row.tables or []),
        "cadence": {"cron": row.schedule_cron, "preset": row.preset},
        "schedule_cron": row.schedule_cron,
        "scope": scope,
        "extraction_mode": row.extraction_mode or "full",
        "active": bool(row.active),
        "status": "active" if row.active else "paused",
        "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
        "next_run_at": row.next_run_at.isoformat() if row.next_run_at else None,
    }


async def list_schedules(db: AsyncSession, tenant_id: uuid.UUID, system_id: str | None = None) -> list[dict]:
    await _rls(db, tenant_id)
    params: dict[str, Any] = {"t": str(tenant_id)}
    where = "p.tenant_id = :t"
    if system_id:
        try:
            params["s"] = str(uuid.UUID(system_id))
        except ValueError:
            return []
        where += " AND p.system_id = :s"
    rows = (await db.execute(text(
        f"SELECT {', '.join('p.' + c.strip() for c in COLUMNS.split(','))}, s.name AS system_name "
        f"FROM sync_profiles p JOIN sap_systems s ON s.id = p.system_id AND s.tenant_id = p.tenant_id "
        f"WHERE {where} ORDER BY s.name, p.domain, p.id"), params)).fetchall()
    return [public(r, r.system_name) for r in rows]


async def get_schedule(db: AsyncSession, tenant_id: uuid.UUID, schedule_id: str,
                       system_id: str | None = None) -> Any:
    """The raw row, or 404. ``system_id`` narrows it to one system (the per-system routes)."""
    try:
        pid = str(uuid.UUID(str(schedule_id)))
    except ValueError:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await _rls(db, tenant_id)
    sql = f"SELECT {COLUMNS} FROM sync_profiles WHERE id = :p AND tenant_id = :t"
    params = {"p": pid, "t": str(tenant_id)}
    if system_id:
        try:
            params["s"] = str(uuid.UUID(str(system_id)))
        except ValueError:
            raise HTTPException(status_code=404, detail="Schedule not found")
        sql += " AND system_id = :s"
    row = (await db.execute(text(sql), params)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return row


async def create_schedule(db: AsyncSession, tenant_id: uuid.UUID, *, system_id: str, domain: str,
                          tables: list[str] | None = None, modules: list[str] | None = None,
                          cron: str | None = None, preset: str | None = None, scope: dict | None = None,
                          active: bool = True, extraction_mode: str = "full", name: str | None = None,
                          run_at_next_tick: bool = False) -> Any:
    """Insert a schedule and return its row. ``run_at_next_tick`` leaves next_run_at empty, so the beat task starts the
    first run on its next pass (what the per-system route has always done); otherwise next_run_at is the first cron
    occurrence."""
    await system_row(db, tenant_id, system_id)
    cron, preset = resolve_cadence(cron, preset)
    scope = resolve_scope(scope)
    row = (await db.execute(text(f"""
        INSERT INTO sync_profiles (id, tenant_id, system_id, domain, tables, modules, schedule_cron, preset, active,
                                   extraction_mode, name, scope, next_run_at)
        VALUES (gen_random_uuid(), :t, :s, :domain, :tables, :modules, :cron, :preset, :active, :mode, :name,
                CAST(:scope AS jsonb), :next)
        RETURNING {COLUMNS}"""),
        {"t": str(tenant_id), "s": str(uuid.UUID(str(system_id))), "domain": domain, "tables": list(tables or []),
         "modules": list(modules or []), "cron": cron, "preset": preset, "active": active, "mode": extraction_mode,
         "name": (name or "").strip() or None, "scope": json.dumps(scope),
         "next": None if run_at_next_tick or not active else _next_run(cron)})).fetchone()
    return row


async def update_schedule(db: AsyncSession, tenant_id: uuid.UUID, schedule_id: str, changes: dict[str, Any], *,
                          system_id: str | None = None) -> Any:
    """Apply the keys of ``changes`` (cron, preset, active, extraction_mode, name, scope, modules, tables) and return the
    new row. A changed cadence recomputes next_run_at so a change never fires an immediate run; resuming does too."""
    cur = await get_schedule(db, tenant_id, schedule_id, system_id)
    sets: list[str] = []
    params: dict[str, Any] = {"p": str(uuid.UUID(str(schedule_id))), "t": str(tenant_id)}
    if "cron" in changes or "preset" in changes:
        cron, preset = resolve_cadence(changes.get("cron"), changes.get("preset"))
        sets += ["schedule_cron = :cron", "preset = :preset", "next_run_at = :next"]
        params |= {"cron": cron, "preset": preset, "next": _next_run(cron)}
    if "active" in changes:
        sets.append("active = :active")
        params["active"] = bool(changes["active"])
        if changes["active"] and not cur.active and not ({"cron", "preset"} & changes.keys()):
            sets.append("next_run_at = :resume_next")  # resuming starts from the next occurrence, not a missed one
            params["resume_next"] = _next_run(cur.schedule_cron)
    if "extraction_mode" in changes:
        sets.append("extraction_mode = :mode")
        params["mode"] = changes["extraction_mode"]
    if "name" in changes:
        sets.append("name = :name")
        params["name"] = (changes["name"] or "").strip() or None
    if "scope" in changes:
        sets.append("scope = CAST(:scope AS jsonb)")
        params["scope"] = json.dumps(resolve_scope(changes["scope"]))
    if "modules" in changes:
        sets += ["modules = :modules", "domain = :domain"]
        params |= {"modules": list(changes["modules"]), "domain": changes["modules"][0]}
    if "tables" in changes:
        sets.append("tables = :tables")
        params["tables"] = list(changes["tables"])
    if not sets:
        raise HTTPException(status_code=422, detail="Nothing to update")
    return (await db.execute(text(
        f"UPDATE sync_profiles SET {', '.join(sets)} WHERE id = :p AND tenant_id = :t RETURNING {COLUMNS}"),
        params)).fetchone()


async def delete_schedule(db: AsyncSession, tenant_id: uuid.UUID, schedule_id: str,
                          system_id: str | None = None) -> Any:
    """Delete a schedule (its sync_runs cascade; analysis runs stay) and return the deleted row."""
    try:
        params = {"pid": str(uuid.UUID(str(schedule_id))), "tid": str(tenant_id)}
        sql = "DELETE FROM sync_profiles WHERE id = :pid AND tenant_id = :tid"
        if system_id:
            params["sid"] = str(uuid.UUID(str(system_id)))
            sql += " AND system_id = :sid"
    except ValueError:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await _rls(db, tenant_id)
    row = (await db.execute(text(f"{sql} RETURNING {COLUMNS}"), params)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return row
