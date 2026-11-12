"""Classify the failing records of run N against the previous run P (spec 7.1).

* new        failing in N, not in P, and never failing in an earlier run of the lineage.
* regressed  failing in N, not in P, but failing in some run before P: it was fixed and came back.
* resolved   failing in P, not in N.
* persisting failing in both.

``new + regressed`` is the plain "in N, not in P". Each change carries a reason, decided per check from the two
findings rows (a record fails a check, so the check explains it): ``data``, ``new_rule``, ``rule_removed``,
``rule_changed``, ``records_added``, ``records_removed``.

finding_records has no field column, so the unit is (check, record), not (check, record, field).
"""
import json
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CHANGES = ("new", "regressed", "resolved", "persisting")
SORTS = {"record_key": "record_key", "check_id": "check_id", "change": "change", "module": "module"}

_CLASSIFIED = """
WITH a AS (SELECT check_id, record_key, module, field_values FROM finding_records WHERE version_id = :v1),
     b AS (SELECT check_id, record_key, module, field_values FROM finding_records WHERE version_id = :v2),
     seen AS (SELECT DISTINCT check_id, record_key FROM finding_records
               WHERE version_id = ANY(CAST(:earlier AS uuid[]))),
     c AS (
       SELECT COALESCE(b.check_id, a.check_id) AS check_id, COALESCE(b.record_key, a.record_key) AS record_key,
              COALESCE(b.module, a.module) AS module,
              a.field_values AS values_before, b.field_values AS values_after,
              CASE WHEN a.record_key IS NOT NULL AND b.record_key IS NOT NULL THEN 'persisting'
                   WHEN b.record_key IS NULL THEN 'resolved'
                   WHEN seen.record_key IS NOT NULL THEN 'regressed' ELSE 'new' END AS change
         FROM a FULL JOIN b ON a.check_id = b.check_id AND a.record_key = b.record_key
         LEFT JOIN seen ON a.record_key IS NULL AND seen.check_id = b.check_id AND seen.record_key = b.record_key)
"""
COUNTS_SQL = _CLASSIFIED + "SELECT check_id, module, change, count(*) AS n FROM c GROUP BY check_id, module, change"
META_SQL = ("SELECT version_id, check_id, total_count, rule_context, details->>'error' AS error FROM findings "
            "WHERE version_id IN (:v1, :v2)")


def _values(v: Any) -> Optional[dict]:
    """field_values as a dict: jsonb arrives decoded from asyncpg, as text from SQLite."""
    if isinstance(v, str):
        v = json.loads(v)
    return v if isinstance(v, dict) else None


def list_sql(sort: str) -> str:
    """Page of classified records; ``sort`` is a key of SORTS with an optional leading ``-``."""
    col = SORTS[sort.lstrip("-")]
    return (_CLASSIFIED + "SELECT check_id, record_key, module, change, values_before, values_after, count(*) OVER() AS total FROM c "
            "WHERE (CAST(:change AS text) IS NULL OR change = :change) "
            "AND (CAST(:cid AS text) IS NULL OR check_id = :cid) AND (CAST(:module AS text) IS NULL OR module = :module) "
            f"ORDER BY {col} {'DESC' if sort.startswith('-') else 'ASC'}, check_id, record_key LIMIT :limit OFFSET :offset")


def reason_for(p: Optional[dict], n: Optional[dict], change: str) -> str:
    """Why a record changed, from the check's findings in P and N ({total_count, rule_context, error} or None)."""
    ran = lambda m: m is not None and not m.get("error")  # noqa: E731
    if not ran(p) and ran(n):
        return "new_rule"
    if ran(p) and not ran(n):
        return "rule_removed"
    if json.dumps((p or {}).get("rule_context"), sort_keys=True) != json.dumps((n or {}).get("rule_context"), sort_keys=True):
        return "rule_changed"
    grew = ((n or {}).get("total_count") or 0) > ((p or {}).get("total_count") or 0)
    shrank = ((n or {}).get("total_count") or 0) < ((p or {}).get("total_count") or 0)
    if change in ("new", "regressed") and grew:
        return "records_added"
    if change == "resolved" and shrank:
        return "records_removed"
    return "data"


async def check_metas(db: AsyncSession, v1, v2) -> dict[str, tuple[Optional[dict], Optional[dict]]]:
    """{check_id: (meta in P, meta in N)}."""
    out: dict[str, list] = {}
    for r in (await db.execute(text(META_SQL), {"v1": v1, "v2": v2})).mappings():
        slot = out.setdefault(r["check_id"], [None, None])
        slot[0 if str(r["version_id"]) == str(v1) else 1] = dict(r)
    return {k: tuple(v) for k, v in out.items()}


async def earlier_runs(db: AsyncSession, scope: str, before: Any) -> list[str]:
    """Finished runs of the lineage older than run ``before`` (the P run)."""
    from api.services.run_lineage import lineage_sql
    from api.services.version_status import finished_sql
    rows = await db.execute(text(
        f"SELECT id::text FROM analysis_versions WHERE {lineage_sql()} = :s AND {finished_sql()} "
        "AND run_at < (SELECT run_at FROM analysis_versions WHERE id = :b)"), {"s": scope, "b": before})
    return [r[0] for r in rows]


async def counts(db: AsyncSession, v1, v2, earlier: list[str]) -> dict[str, Any]:
    """Totals per change and per check, each check with its reason."""
    metas = await check_metas(db, v1, v2)
    totals = dict.fromkeys(CHANGES, 0)
    by_check: dict[str, dict] = {}
    for r in (await db.execute(text(COUNTS_SQL), {"v1": v1, "v2": v2, "earlier": earlier})).mappings():
        totals[r["change"]] += r["n"]
        c = by_check.setdefault(r["check_id"], {"check_id": r["check_id"], "module": r["module"], **dict.fromkeys(CHANGES, 0)})
        c[r["change"]] += r["n"]
        c["reason"] = reason_for(*metas.get(r["check_id"], (None, None)), r["change"])
    return {"totals": totals, "checks": sorted(by_check.values(), key=lambda c: (-c["new"] - c["regressed"], c["check_id"]))}


async def records(db: AsyncSession, v1, v2, earlier: list[str], *, change=None, check_id=None, module=None,
                  sort="record_key", limit=100, offset=0) -> tuple[list[dict], int]:
    metas = await check_metas(db, v1, v2)
    rows = (await db.execute(text(list_sql(sort)), {
        "v1": v1, "v2": v2, "earlier": earlier, "change": change, "cid": check_id, "module": module,
        "limit": limit, "offset": offset})).mappings().all()
    items = [{"check_id": r["check_id"], "record_key": r["record_key"], "module": r["module"], "change": r["change"],
              "reason": reason_for(*metas.get(r["check_id"], (None, None)), r["change"]),
              # The failing record's values in each run; a resolved record passes in v2, so v2 stored none for it.
              "values_before": _values(r["values_before"]), "values_after": _values(r["values_after"])} for r in rows]
    return items, int(rows[0]["total"]) if rows else 0
