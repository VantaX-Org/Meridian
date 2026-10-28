"""Per-L1 health of a system's process discovery: the last run, fitness drift, the schedule and its freshness.

Fitness is ``process_discovery_runs.stats.conformance.fitness`` (what the catalogue reads as ``last_run.fitness``),
present on completed runs that were mined. Drift is the fitness of the latest completed run minus that of the
completed run before it; an L1 with fewer than two such runs has no drift. Freshness is ``api.services.cadence``
(the same rule as object monitoring): the age of the latest completed run against the schedule's interval, in the
tenant's time zone. An L1 without a schedule is ``manual``; a scheduled L1 that never ran is ``due``.
Deterministic, no LLM. The caller sets ``app.tenant_id``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import cadence

FITNESS_DECIMALS = 4
HISTORY = 8  # finished runs read per L1: enough to find two with a fitness

RUNS_SQL = text("""
SELECT l1, id::text AS id, status, finished_at, started_at,
       CASE WHEN jsonb_typeof(stats->'conformance'->'fitness') = 'number'
            THEN (stats->'conformance'->>'fitness')::float END AS fitness
FROM (SELECT *, row_number() OVER (PARTITION BY l1 ORDER BY started_at DESC, id DESC) AS n
      FROM process_discovery_runs
      WHERE tenant_id = CAST(:t AS uuid) AND system_id = CAST(:s AS uuid) AND status IN ('completed', 'failed')) r
WHERE n <= :n ORDER BY l1, started_at DESC, id DESC""")

SCHEDULES_SQL = text("""
SELECT id::text AS id, l1, schedule_cron, active, next_run_at FROM process_discovery_schedules
WHERE tenant_id = CAST(:t AS uuid) AND system_id = CAST(:s AS uuid)""")

TZ_SQL = text("SELECT timezone FROM triage_settings WHERE tenant_id = CAST(:t AS uuid)")


class HealthRun(BaseModel):
    id: str
    status: str
    finished_at: Optional[datetime] = None
    fitness: Optional[float] = None


class HealthSchedule(BaseModel):
    id: str
    cron: str
    active: bool
    next_run_at: Optional[datetime] = None


class L1Health(BaseModel):
    l1: str
    last_run: Optional[HealthRun] = None
    previous_fitness: Optional[float] = None
    fitness_drift: Optional[float] = None
    schedule: Optional[HealthSchedule] = None
    freshness: cadence.Freshness


def fitness_drift(latest: Optional[float], previous: Optional[float]) -> Optional[float]:
    if latest is None or previous is None:
        return None
    return round(latest - previous, FITNESS_DECIMALS)


def l1_health(l1: str, runs: Sequence[dict], schedule: Optional[dict], now: datetime, tz: str) -> L1Health:
    """``runs`` are this L1's finished (completed or failed) runs, newest first."""
    last = runs[0] if runs else None
    mined = [r for r in runs if r["status"] == "completed" and r["fitness"] is not None]
    latest_fit = mined[0]["fitness"] if mined else None
    previous_fit = mined[1]["fitness"] if len(mined) > 1 else None
    completed = next((r for r in runs if r["status"] == "completed"), None)
    sched = None if schedule is None else HealthSchedule(
        id=schedule["id"], cron=schedule["schedule_cron"], active=schedule["active"],
        next_run_at=schedule["next_run_at"])
    state = cadence.freshness(
        completed["finished_at"] if completed else None,
        sched.cron if sched else None, sched.active if sched else True,
        last["status"] if last else None, now, tz, sched.next_run_at if sched else None)
    return L1Health(
        l1=l1,
        last_run=None if last is None else HealthRun(
            id=last["id"], status=last["status"], finished_at=last["finished_at"],
            fitness=None if last["status"] != "completed" else last["fitness"]),
        previous_fitness=previous_fit,
        fitness_drift=fitness_drift(latest_fit, previous_fit),
        schedule=sched, freshness=state)


async def system_health(db: AsyncSession, tenant_id: str, system_id: str, l1s: Sequence[str],
                        now: Optional[datetime] = None) -> list[L1Health]:
    """Health of every L1 in ``l1s`` (the L1s the system type can mine), plus any L1 that has a run or a schedule."""
    now = now or datetime.now(timezone.utc)
    params = {"t": tenant_id, "s": system_id}
    tz = (await db.execute(TZ_SQL, {"t": tenant_id})).scalar() or "UTC"
    runs: dict[str, list[dict]] = {}
    for r in (await db.execute(RUNS_SQL, {**params, "n": HISTORY})).mappings():
        runs.setdefault(r["l1"], []).append(dict(r))
    schedules = {r["l1"]: dict(r) for r in (await db.execute(SCHEDULES_SQL, params)).mappings()}
    names = [*l1s, *sorted((set(runs) | set(schedules)) - set(l1s))]
    return [l1_health(l1, runs.get(l1, []), schedules.get(l1), now, tz) for l1 in names]
