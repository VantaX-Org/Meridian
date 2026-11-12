"""Where each object stands in the clean cycle: pull, clean, upload, score, compare.

Derived on the server so every screen shows the same step. Inputs are the object's runs in one lineage and the
audit rows written when a cleaning workbook is downloaded (``report.export`` with kind ``cleaning_workbook``):

* pull     no finished run of the object yet.
* score    the newest run is a cleaned run (it has a parent) that is queued or running.
* upload   a workbook was downloaded after the newest finished run: the edited file is awaited.
* compare  the newest finished run is a cleaned run: its result is to be read against its parent.
* clean    otherwise: the newest finished run is a pull and no workbook was downloaded after it.

The Load step needs "verdict ready and Compare opened"; the server cannot see a screen being opened, so it is
left to the client.
"""
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.run_lineage import lineage_sql
from api.services.version_status import ENDED, finished_sql

_MODULES = ("CASE WHEN jsonb_typeof(v.metadata->'modules') = 'array' THEN v.metadata->'modules' "
            "ELSE '[]'::jsonb END")
_RUNS = f"""
SELECT {{pick}} m.module, v.id::text AS id, v.status, v.run_at, v.run_number, v.parent_version_id::text AS parent
  FROM analysis_versions v CROSS JOIN LATERAL jsonb_array_elements_text({_MODULES}) AS m(module)
 WHERE v.tenant_id = CAST(:t AS uuid) AND {lineage_sql('v').replace('{', '{{').replace('}', '}}')} = :scope {{extra}}
   AND v.metadata->>'purpose' IS DISTINCT FROM 'process_discovery' AND v.metadata->>'archived' IS DISTINCT FROM 'true'
 ORDER BY m.module, v.run_at DESC"""
_DOWNLOADS = f"""
SELECT DISTINCT ON (a.after_json->>'module') a.after_json->>'module' AS module, a.created_at, a.actor_email
  FROM audit_log a JOIN analysis_versions v ON v.id = CAST(a.after_json->>'version_id' AS uuid)
 WHERE a.tenant_id = CAST(:t AS uuid) AND a.action = 'report.export' AND a.after_json->>'kind' = 'cleaning_workbook'
   AND {lineage_sql('v')} = :scope
 ORDER BY a.after_json->>'module', a.created_at DESC"""
_DEPTH = """
WITH RECURSIVE c AS (SELECT id AS root, parent_version_id AS p, 1 AS n FROM analysis_versions WHERE id = ANY(CAST(:ids AS uuid[]))
  UNION ALL SELECT c.root, v.parent_version_id, c.n + 1 FROM c JOIN analysis_versions v ON v.id = c.p)
SELECT root::text, max(n) FROM c GROUP BY root"""


def derive(newest: Optional[dict], finished: Optional[dict], download: Optional[dict], number: int = 1) -> dict[str, Any]:
    """The cycle of one object from its newest run, its newest finished run and its newest workbook download."""
    dl = download or {}
    if newest and newest["status"] not in ENDED and newest.get("parent"):
        step, since = "score", newest["run_at"]
    elif finished is None:
        step, since = "pull", None
    elif dl.get("at") and dl["at"] > finished["run_at"]:
        step, since = "upload", dl["at"]
    elif finished.get("parent"):
        step, since = "compare", finished["run_at"]
    else:
        step, since = "clean", finished["run_at"]
    return {"number": number, "step": step, "since": since, "parent_run": (finished or {}).get("parent"),
            "downloaded_at": dl.get("at") if step == "upload" or dl else None, "downloaded_by": dl.get("by")}


async def cycles_for(db: AsyncSession, tenant_id, scope: str) -> dict[str, dict]:
    """``{module: cycle}`` for every object seen in the lineage ``scope`` (a system id, or ``upload:<modules>``).
    RLS must already be set by the caller."""
    p = {"t": str(tenant_id), "scope": scope}
    newest = {r["module"]: dict(r) for r in (await db.execute(
        text(_RUNS.format(pick="DISTINCT ON (m.module)", extra="")), p)).mappings()}
    finished = {r["module"]: dict(r) for r in (await db.execute(
        text(_RUNS.format(pick="DISTINCT ON (m.module)", extra=f"AND {finished_sql('v.status')}")), p)).mappings()}
    dls = {r["module"]: {"at": r["created_at"], "by": r["actor_email"]} for r in (await db.execute(text(_DOWNLOADS), p)).mappings()}
    ids = [f["id"] for f in finished.values()]
    depth = {r[0]: int(r[1]) for r in (await db.execute(text(_DEPTH), {"ids": ids})).fetchall()} if ids else {}
    return {m: derive(newest.get(m), finished.get(m), dls.get(m), depth.get((finished.get(m) or {}).get("id"), 1))
            for m in newest}
