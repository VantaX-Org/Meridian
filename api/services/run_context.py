"""Which run a screen shows when it names none: one rule for every route.

The newest finished run (version_status.FINISHED), not archived, not a process-discovery run,
optionally of one system or one object. The frontend's latestFinishedRun (lib/run-scope.ts) is the same rule,
so "latest" on a screen and in the API it calls are the same run.
"""
from typing import Optional

from sqlalchemy import text

from api.services.version_status import finished_sql

LATEST_RUN_SQL = f"""
    SELECT id::text FROM analysis_versions
     WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()}
       AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND metadata->>'archived' IS DISTINCT FROM 'true'
       AND (CAST(:sid AS text) IS NULL OR metadata->>'system_id' = CAST(:sid AS text))
       AND (CAST(:m AS text) IS NULL OR metadata->'modules' @> to_jsonb(CAST(:m AS text))
            OR dqs_summary ? CAST(:m AS text))
     ORDER BY run_at DESC LIMIT 1"""


def _args(tenant_id, system_id, module) -> dict:
    return {"t": str(tenant_id), "sid": str(system_id) if system_id else None, "m": module}


async def latest_run(db, tenant_id, system_id=None, module: Optional[str] = None) -> Optional[str]:
    return (await db.execute(text(LATEST_RUN_SQL), _args(tenant_id, system_id, module))).scalar()


def latest_run_sync(session, tenant_id, system_id=None, module: Optional[str] = None) -> Optional[str]:
    return session.execute(text(LATEST_RUN_SQL), _args(tenant_id, system_id, module)).scalar()
