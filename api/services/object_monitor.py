"""Per-object monitoring: when an object was last checked, how often it should be, whether that is still
recent enough, and what changed since its baseline.

One row per object, read from rows that already exist: ``sync_profiles`` (the cadence), the latest
``sync_runs`` status (a failed run), ``analysis_versions`` (the run, how it started) and ``run_change`` (record
and rule drift against the baseline). The baseline is the pinned run when the lineage has one, else the run
before it. Nothing here reads ``work_records``: drift comes from ``finding_records`` / ``findings`` through the
same compare path as the run diff, so the cost is bounded by the number of runs in the current state.
Deterministic SQL and Python; every query is tenant-filtered and runs after the caller set ``app.tenant_id``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import cadence
from api.services.current_state import current_pairs, run_ids
from api.services.monitor import PINNED_BASELINE_SQL
from api.services.work_analytics import RULES_CAP, run_change

_RUNS_SQL = """
    SELECT id::text AS id, run_at, metadata->>'system_id' AS system_id, metadata->>'trigger' AS trigger,
           metadata->>'requested_by_label' AS requested_by_label, metadata->>'source' AS source
      FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) AND id = ANY(CAST(:ids AS uuid[]))
"""

# every sync profile with the status of its latest sync run
_PROFILES_SQL = """
    SELECT sp.id::text AS profile_id, sp.system_id::text AS system_id, sp.domain AS module, sp.schedule_cron AS cron,
           sp.active, sp.next_run_at, lr.status AS last_sync_status
      FROM sync_profiles sp
      LEFT JOIN LATERAL (SELECT status FROM sync_runs r WHERE r.profile_id = sp.id AND r.tenant_id = sp.tenant_id
                          ORDER BY r.started_at DESC LIMIT 1) lr ON true
     WHERE sp.tenant_id = CAST(:t AS uuid) AND (CAST(:m AS text) IS NULL OR sp.domain = CAST(:m AS text))
     ORDER BY sp.next_run_at NULLS LAST, sp.id
"""

_NO_DRIFT = {"new_failing": 0, "recovered": 0, "newly_failing_rules": [], "recovered_rules": [],
             "newly_failing_rule_count": 0, "recovered_rule_count": 0}


async def tenant_timezone(db: AsyncSession, tenant_id: Any) -> str:
    tz = (await db.execute(text("SELECT timezone FROM triage_settings WHERE tenant_id = CAST(:t AS uuid)"),
                           {"t": str(tenant_id)})).scalar()
    return tz or "UTC"


async def _drift(db: AsyncSession, tenant_id: Any, version_id: str) -> tuple[dict, dict[str, dict]]:
    """(baseline, {module: drift}) for one run: against its lineage's pinned baseline, else the run before it."""
    pin = (await db.execute(text(PINNED_BASELINE_SQL), {"v": version_id})).fetchone()
    change = await run_change(db, tenant_id, version_id, None, baseline_id=str(pin[0]) if pin else None)
    prev = change["previous"]
    if not prev:
        return {"kind": None, "version_id": None, "run_at": None}, {}
    baseline = {"kind": "pinned" if pin else "previous", "version_id": prev["version_id"], "run_at": prev["run_at"]}
    by_module = {}
    for o in change["objects"]:
        rules = o["rules"]
        by_module[o["module"]] = {
            "new_failing": o["new"], "recovered": o["fixed"],
            "newly_failing_rules": rules["newly_failing"][:RULES_CAP], "recovered_rules": rules["recovered"][:RULES_CAP],
            "newly_failing_rule_count": rules["newly_failing_total"], "recovered_rule_count": rules["recovered_total"]}
    return baseline, by_module


async def _rows(db: AsyncSession, tenant_id: Any, targets: list[dict], module: Optional[str],
                now: Optional[datetime]) -> list[dict]:
    """The monitor row of each target ``{module, version_id}`` (``version_id`` None: the object never ran)."""
    now = now or datetime.now(timezone.utc)
    t = str(tenant_id)
    tz = await tenant_timezone(db, tenant_id)
    ids = run_ids([x for x in targets if x["version_id"]])
    runs = {r.id: r for r in (await db.execute(text(_RUNS_SQL), {"t": t, "ids": ids})).fetchall()} if ids else {}
    profiles = (await db.execute(text(_PROFILES_SQL), {"t": t, "m": module})).fetchall()
    drift = {vid: await _drift(db, tenant_id, vid) for vid in ids}
    out = []
    for x in targets:
        run = runs.get(x["version_id"])
        system_id = run.system_id if run else None
        mine = [p for p in profiles if p.module == x["module"]]
        # a run is paired with the profile of its own system; an object that never ran, with its most overdue one
        profile = next((p for p in mine if p.system_id == system_id), None) if run else (mine[0] if mine else None)
        active = profile.active if profile else True
        last_run_at = run.run_at if run else None
        baseline, by_module = drift.get(x["version_id"], ({"kind": None, "version_id": None, "run_at": None}, {}))
        out.append({
            "module": x["module"], "system_id": system_id or (profile.system_id if profile else None),
            "last_run_at": last_run_at, "last_version_id": run.id if run else None,
            "trigger": (run.trigger or ("upload" if run.source == "upload" else None)) if run else None,
            "requested_by_label": run.requested_by_label if run else None,
            "cadence": {"cron": profile.cron if profile else None, "active": profile.active if profile else None,
                        "interval_seconds": cadence.interval_seconds(profile.cron if profile else None, tz, now),
                        "profile_id": profile.profile_id if profile else None},
            "next_run_at": profile.next_run_at if profile and profile.active and profile.cron else None,
            "freshness": cadence.freshness(last_run_at, profile.cron if profile else None, active,
                                           profile.last_sync_status if profile else None, now, tz,
                                           profile.next_run_at if profile else None),
            "baseline": baseline, "drift": by_module.get(x["module"], _NO_DRIFT),
        })
    return out


async def for_current_state(db: AsyncSession, tenant_id: Any, module: Optional[str] = None,
                            now: Optional[datetime] = None) -> list[dict]:
    """One row per object of the current state (each object at its own latest run), then one per scheduled
    object that has never run, ordered by module."""
    pairs = await current_pairs(db, tenant_id, module)
    ran = {p["module"] for p in pairs}
    profiles = (await db.execute(text(_PROFILES_SQL), {"t": str(tenant_id), "m": module})).fetchall()
    never = sorted({p.module for p in profiles} - ran)
    targets = pairs + [{"module": m, "version_id": None} for m in never]
    return sorted(await _rows(db, tenant_id, targets, module, now), key=lambda r: r["module"])


async def for_module(db: AsyncSession, tenant_id: Any, module: str, run_id: Optional[str] = None,
                     now: Optional[datetime] = None) -> Optional[dict]:
    """The monitor row of one object: at run ``run_id``, else at its own latest run. None when the object has
    neither a run nor a sync profile."""
    if run_id:
        targets = [{"module": module, "version_id": run_id}]
    else:
        targets = await current_pairs(db, tenant_id, module) or [{"module": module, "version_id": None}]
    row = (await _rows(db, tenant_id, targets, module, now))[0]
    if run_id:  # a run that is not this tenant's, or not found
        return row if row["last_version_id"] else None
    return row if row["last_version_id"] or row["cadence"]["profile_id"] else None
