"""The current state as (object, run) pairs, for routes that page through per-run tables.

The current state is every object at the latest complete run of its lineage: the run set of
``api.routes.findings._latest_version_ids`` (what GET /findings/aggregate, Home and the objects list read), each
object (module) once, from the newest of those runs that measured it (``insights_aggregate.current_objects``, the
frontend's ``stateObjects``). Per-run tables (work_records, work_groups, finding_records, config_impact_results)
are read over these pairs, so a cross-object screen counts each object once, from its own run.

Deterministic SQL only; every query is tenant-filtered and runs after the caller set ``app.tenant_id`` (RLS).
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.run_lineage import lineage_sql
from api.services.version_status import finished_sql

CURRENT_RUNS_SQL = f"""
    SELECT DISTINCT ON ({lineage_sql()}) id FROM analysis_versions
     WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()}
     ORDER BY {lineage_sql()}, run_at DESC"""

# Same rule as insights_aggregate._CURRENT_OBJECTS_SQL, over the run set above.
CURRENT_PAIRS_SQL = f"""
    WITH runs AS ({CURRENT_RUNS_SQL})
    SELECT DISTINCT ON (module) module, id::text AS version_id FROM (
        SELECT av.id, av.run_at, k.module FROM analysis_versions av
         CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(av.dqs_summary) = 'object'
                                                   THEN av.dqs_summary ELSE '{{}}'::jsonb END) AS k(module)
         WHERE av.tenant_id = CAST(:t AS uuid) AND av.id IN (SELECT id FROM runs)
        UNION
        SELECT av.id, av.run_at, f.module FROM analysis_versions av
          JOIN findings f ON f.version_id = av.id AND f.tenant_id = CAST(:t AS uuid)
         WHERE av.tenant_id = CAST(:t AS uuid) AND av.id IN (SELECT id FROM runs)
    ) x
     WHERE CAST(:m AS text) IS NULL OR module = CAST(:m AS text)
     ORDER BY module, run_at DESC, id DESC"""


async def current_pairs(db: AsyncSession, tenant_id, module: Optional[str] = None) -> list[dict]:
    """``[{module, version_id}]`` ordered by module: each object of the current state once, with the run it is
    read from. ``module`` keeps only that object. Empty for a tenant with no finished run."""
    rows = (await db.execute(text(CURRENT_PAIRS_SQL), {"t": str(tenant_id), "m": module})).mappings().all()
    return [{"module": r["module"], "version_id": r["version_id"]} for r in rows]


# The current state as it stood when run ``:asof`` finished: the same rule over the runs at or before it.
_AS_OF = ("AND run_at <= (SELECT a.run_at FROM analysis_versions a WHERE a.id = CAST(:asof AS uuid) "
          "AND a.tenant_id = CAST(:t AS uuid))")
CURRENT_PAIRS_AS_OF_SQL = CURRENT_PAIRS_SQL.replace(f"{finished_sql()}\n", f"{finished_sql()} {_AS_OF}\n", 1)


async def current_pairs_as_of(db: AsyncSession, tenant_id, as_of_run: str, module: Optional[str] = None) -> list[dict]:
    """``current_pairs`` as the state stood at run ``as_of_run``: every object at the newest finished run of its
    lineage at or before that run. Empty when the run is not this tenant's."""
    rows = (await db.execute(text(CURRENT_PAIRS_AS_OF_SQL), {"t": str(tenant_id), "m": module,
                                                             "asof": str(as_of_run)})).mappings().all()
    return [{"module": r["module"], "version_id": r["version_id"]} for r in rows]


def pairs_clause(alias: str, pairs: list[dict], params: dict, key: str = "c") -> str:
    """SQL keeping the rows of ``alias`` (a table with ``module`` and ``version_id``) that belong to one of the
    current pairs; binds ``<key>m`` / ``<key>v`` into ``params`` (``key`` tells two clauses of one query apart).
    No pairs keeps nothing."""
    params[f"{key}m"] = [p["module"] for p in pairs]
    params[f"{key}v"] = [p["version_id"] for p in pairs]
    return (f"({alias}.module, {alias}.version_id) IN "
            f"(SELECT m, v FROM unnest(CAST(:{key}m AS text[]), CAST(:{key}v AS uuid[])) AS cur_{key}(m, v))")


def run_ids(pairs: list[dict]) -> list[str]:
    """The distinct runs behind ``pairs``, in first-seen order."""
    return list(dict.fromkeys(p["version_id"] for p in pairs))
