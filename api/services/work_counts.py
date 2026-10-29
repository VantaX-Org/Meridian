"""Open work, pre-aggregated: work_counts holds one row per (tenant, run, object, work status, system, severity,
assignee) with how many work_records rows fall in it, so the landscape, the Fix work summary, the object receipt and
People read a few hundred rows instead of counting every work record of the current state (migration 108).

work_counts columns
  count               work records in the slice
  issues_sum          sum of work_records.issues
  proposed_count      work records with a machine-proposed value (work_records.proposed > 0)
  value_at_risk_sum   sum over the slice's records of each failing check's cost at risk shared over the records the
                      check fails on (api/routes/work.py _VALUE_JOIN, summed); 0 when nothing is priced

Maintained in the same transaction as every write to work_records by three statement-level triggers on work_records
(migration 108: insert, update, delete, each reading its transition table), so the worklist build, a decision, a fix
batch's approve / send-back / send, a reassignment, an undo, a re-score and the retention purge all keep it exact
without a call of their own. ``backfill`` rebuilds it from work_records; ``reconcile`` (the nightly beat task
workers/tasks/reconcile_work_counts.py) compares it with a live count, logs any drift as a warning with the numbers
and repairs it.

Severity is work_records.sev_rank by name (0 critical, 1 high, 2 medium, 3 low, else info). ``system_id`` is
work_records.scope: the source system id, or 'upload'. Deterministic, no model.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

log = logging.getLogger("meridian.work_counts")

OPEN = ("to_fix", "proposed", "approved", "sent")  # api/routes/work.py OPEN
SEVERITY_NAMES = ("critical", "high", "medium", "low")
SEV_NAME_SQL = ("CASE {c} WHEN 0 THEN 'critical' WHEN 1 THEN 'high' WHEN 2 THEN 'medium' WHEN 3 THEN 'low' "
                "ELSE 'info' END")
SEV_RANK_OF_NAME_SQL = ("CASE {c} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 "
                        "ELSE 4 END")
KEY_COLUMNS = ("tenant_id", "version_id", "module", "status", "system_id", "severity", "assigned_to")

# The signed slices of a set of work_records rows (``rows`` selects them with a ``sgn`` column: +1 counted, -1 taken
# away). The same text is frozen in migration 108's trigger function; the live count of backfill / reconcile is this
# with every row at +1.
DELTA_SQL = """
    WITH r AS ({rows}),
    cnt AS (SELECT tenant_id, version_id, module, status, scope AS system_id, {sev} AS severity, assigned_to,
                   sum(sgn) AS n, sum(sgn * issues) AS i, sum(sgn * (proposed > 0)::int) AS p
              FROM r GROUP BY 1, 2, 3, 4, 5, 6, 7),
    val AS (SELECT r.tenant_id, r.version_id, r.module, r.status, r.scope AS system_id, {rsev} AS severity,
                   r.assigned_to, sum(r.sgn * f.cost_at_risk / f.affected_count) AS v
              FROM r CROSS JOIN LATERAL unnest(r.checks) AS c(check_id)
              JOIN findings f ON f.version_id = r.version_id AND f.check_id = c.check_id AND f.tenant_id = r.tenant_id
             WHERE f.cost_at_risk IS NOT NULL AND f.affected_count > 0
             GROUP BY 1, 2, 3, 4, 5, 6, 7)
    SELECT cnt.tenant_id, cnt.version_id, cnt.module, cnt.status, cnt.system_id, cnt.severity, cnt.assigned_to,
           cnt.n, cnt.i, cnt.p, COALESCE(val.v, 0) AS v
      FROM cnt LEFT JOIN val ON val.tenant_id = cnt.tenant_id AND val.version_id = cnt.version_id
                            AND val.module = cnt.module AND val.status = cnt.status AND val.system_id = cnt.system_id
                            AND val.severity = cnt.severity AND val.assigned_to IS NOT DISTINCT FROM cnt.assigned_to
""".replace("{sev}", SEV_NAME_SQL.format(c="sev_rank")).replace("{rsev}", SEV_NAME_SQL.format(c="r.sev_rank"))


def live_sql(where: str = "tenant_id = CAST(:t AS uuid)") -> str:
    """The slices work_records holds now (``where`` over work_records), as work_counts should hold them."""
    return DELTA_SQL.replace("{rows}", f"SELECT *, 1 AS sgn FROM work_records WHERE {where}")


_INSERT_LIVE = """
    INSERT INTO work_counts (tenant_id, version_id, module, status, system_id, severity, assigned_to, count, issues_sum,
                             proposed_count, value_at_risk_sum, updated_at)
    SELECT tenant_id, version_id, module, status, system_id, severity, assigned_to, n, i, p, v, now()
      FROM ({live}) d WHERE d.n <> 0"""


def backfill(session, tenant_id: str, version_ids: list[str] | None = None) -> int:
    """Rebuild the tenant's work_counts (or only these runs') from work_records. Holds a lock on work_counts that keeps
    every work_records writer waiting at its trigger, so no change slips between the count and the write; the caller
    has set ``app.tenant_id`` and commits."""
    p: dict = {"t": str(tenant_id)}
    where = "tenant_id = CAST(:t AS uuid)"
    if version_ids is not None:
        where += " AND version_id = ANY(CAST(:vids AS uuid[]))"
        p["vids"] = [str(v) for v in version_ids]
    session.execute(text("LOCK TABLE work_counts IN SHARE ROW EXCLUSIVE MODE"))
    session.execute(text(f"DELETE FROM work_counts WHERE {where}"), p)
    return session.execute(text(_INSERT_LIVE.format(live=live_sql(where))), p).rowcount or 0


_DRIFT_SQL = """
    WITH live AS ({live}),
    stored AS (SELECT tenant_id, version_id, module, status, system_id, severity, assigned_to,
                      count AS n, issues_sum AS i, proposed_count AS p, value_at_risk_sum AS v
                 FROM work_counts WHERE tenant_id = CAST(:t AS uuid))
    SELECT COALESCE(l.version_id, s.version_id)::text AS version_id, COALESCE(l.module, s.module) AS module,
           COALESCE(l.status, s.status) AS status, COALESCE(l.system_id, s.system_id) AS system_id,
           COALESCE(l.severity, s.severity) AS severity, COALESCE(l.assigned_to, s.assigned_to)::text AS assigned_to,
           COALESCE(l.n, 0) AS live_count, COALESCE(s.n, 0) AS stored_count,
           COALESCE(l.i, 0) AS live_issues, COALESCE(s.i, 0) AS stored_issues,
           COALESCE(l.p, 0) AS live_proposed, COALESCE(s.p, 0) AS stored_proposed,
           COALESCE(l.v, 0) AS live_value, COALESCE(s.v, 0) AS stored_value
      FROM live l FULL JOIN stored s
        ON s.version_id = l.version_id AND s.module = l.module AND s.status = l.status AND s.system_id = l.system_id
       AND s.severity = l.severity AND s.assigned_to IS NOT DISTINCT FROM l.assigned_to
     WHERE COALESCE(l.n, 0) <> COALESCE(s.n, 0) OR COALESCE(l.i, 0) <> COALESCE(s.i, 0)
        OR COALESCE(l.p, 0) <> COALESCE(s.p, 0) OR COALESCE(l.v, 0) <> COALESCE(s.v, 0)
     ORDER BY 1, 2, 3, 4, 5, 6"""


def drift(session, tenant_id: str) -> list[dict]:
    """The slices where work_counts and a live count of work_records disagree, with both numbers. Read in one snapshot
    (the caller runs it under REPEATABLE READ, or accepts that a concurrent write may show as passing drift)."""
    return [dict(r) for r in session.execute(text(_DRIFT_SQL.format(live=live_sql())), {"t": str(tenant_id)}).mappings()]


def reconcile(session, tenant_id: str, repair: bool = True) -> list[dict]:
    """Compare the tenant's work_counts with a live count in one snapshot; log every drifted slice as a warning with
    its numbers and, with ``repair``, rebuild the drifted runs' counts. Commits. Returns the drifted slices."""
    from api.middleware.cache import mark_work_changed

    tid = str(tenant_id)
    session.commit()
    session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    session.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
    found = drift(session, tid)
    session.commit()
    for d in found:
        log.warning("work_counts drift tenant=%s run=%s object=%s status=%s system=%s severity=%s assignee=%s: "
                    "count live %s stored %s, issues live %s stored %s, proposed live %s stored %s, "
                    "value at risk live %s stored %s", tid, d["version_id"], d["module"], d["status"], d["system_id"],
                    d["severity"], d["assigned_to"], d["live_count"], d["stored_count"], d["live_issues"],
                    d["stored_issues"], d["live_proposed"], d["stored_proposed"], d["live_value"], d["stored_value"])
    if found and repair:
        session.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        n = backfill(session, tid, sorted({d["version_id"] for d in found}))
        mark_work_changed(session, tid)
        session.commit()
        log.warning("work_counts repaired for tenant=%s: %d slice(s) rewritten over %d run(s)", tid, n,
                    len({d["version_id"] for d in found}))
    return found


# ── Readers (async; the caller has set app.tenant_id) ─────────────────────────────────────────────────────────────

async def open_by_run_module(db, tenant_id: str, version_ids: list[str]) -> dict[tuple[str, str], int]:
    """Open work records per (run, object) of these runs: the landscape cells."""
    if not version_ids:
        return {}
    rows = (await db.execute(text(
        "SELECT version_id::text, module, sum(count)::bigint FROM work_counts WHERE tenant_id = CAST(:t AS uuid) "
        "AND version_id = ANY(CAST(:ids AS uuid[])) AND status = ANY(:open) GROUP BY 1, 2 HAVING sum(count) <> 0"),
        {"t": str(tenant_id), "ids": list(version_ids), "open": list(OPEN)})).fetchall()
    return {(r[0], r[1]): int(r[2]) for r in rows}


async def open_count(db, tenant_id: str, version_id: str, module: str) -> int:
    """Open work records of one object in one run: the object receipt."""
    return int((await db.execute(text(
        "SELECT COALESCE(sum(count), 0)::bigint FROM work_counts WHERE tenant_id = CAST(:t AS uuid) "
        "AND version_id = CAST(:v AS uuid) AND module = :m AND status = ANY(:open)"),
        {"t": str(tenant_id), "v": str(version_id), "m": module, "open": list(OPEN)})).scalar() or 0)


def where(sel, p: dict, module: str | None, severity: str | None, system: str | None,
          status: str | None = "all", alias: str = "c") -> list[str]:
    """work_counts' version of api/routes/work.py _records_where for the filters the table can answer: module,
    severity, system and status. ``sel`` is a work._Rows (one run or the current state)."""
    out = [f"{alias}.tenant_id = CAST(:t AS uuid)", sel.where(alias, p)]
    if module:
        out.append(f"{alias}.module = :m")
        p["m"] = module
    if severity == "blocking":
        out.append(f"{alias}.severity IN ('critical', 'high')")
    elif severity:
        out.append(f"{alias}.severity = :sv")
        p["sv"] = severity
    if system:
        out.append(f"{alias}.system_id = :sys")
        p["sys"] = system
    if status == "open":
        out.append(f"{alias}.status = ANY(:st)")
        p["st"] = list(OPEN)
    elif status and status != "all":
        out.append(f"{alias}.status = :st")
        p["st"] = status
    return out
