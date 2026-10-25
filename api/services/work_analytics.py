"""The lead's analytics over the fix work: how fast the data is getting fixed and what slows it down.

Derived from what the work already records, no table of its own:

  burndown          record_issues.first_seen_at / resolved_at plus the 'reopened' events, per day; the open
                    record checks of the lineage's runs (findings.affected_count); a projected finish date
  time_to_fix       first_seen_at -> resolved_at of the issues a run showed fixed (status 'resolved')
  throughput        decisions per day and person: values decided into a work-list fix batch
                    (remediation_items: rule value = accept, typed value = edit), sign-offs
                    (record_issue_events status -> accepted: not an issue / accept risk) and approvals
                    (remediation_events approved / accepted); open workload per assignee
  recurrence        issues that came back after a fix (record_issues.reopened_count), by rule and by system
  root_causes       the run's failing records by organisational unit read from the record key
                    (BUKRS=1000|LIFNR=... -> company code 1000)
  proposal_quality  per proposal source: proposed, approved, exported, then fixed or still failing at the next run
  run_change        per object: new, fixed and still failing between the run and the previous run of its lineage
                    (record_issues.DIFF_SQL, comparable rules only)

Every number is SQL over indexed columns, grouped in the database; the client gets at most a few hundred rows.
Days are UTC calendar days. Deterministic, no model.
"""
from __future__ import annotations

import functools
import math
import time
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.record_issues import DIFF_SQL
from api.services.run_lineage import same_lineage_as
from api.services.version_status import finished_sql

BURNDOWN_DAYS = 90
PACE_DAYS = 28
THROUGHPUT_DAYS = 30
RUNS_SHOWN = 20
TOP = 20
CLOSED = ("resolved", "accepted")
OPEN_WORK = ("to_fix", "proposed", "approved", "sent")
# Organisational units a record key can carry, in the order the page shows them.
ORG_UNITS: dict[str, str] = {
    "BUKRS": "Company code",
    "WERKS": "Plant",
    "VKORG": "Sales organisation",
    "EKORG": "Purchasing organisation",
    "LGORT": "Storage location",
}
SOURCES = ("rule", "steward", "cleaning", "simulation", "manual")
SEVERITIES = ("critical", "high", "medium", "low")

# The scans over every record issue of a tenant (burn-down, recurrence, root causes) take about a second at
# millions of issues. A lead's progress view does not need them to the second: each answer is kept for
# CACHE_TTL_S per (tenant, arguments), in this process.
CACHE_TTL_S = 300.0
_cache: dict[tuple, tuple[float, dict]] = {}


def forget(tenant_id) -> None:
    """Drop a tenant's cached measures after a decision so Progress shows it at once."""
    t = str(tenant_id)
    for k in [k for k in _cache if k[1] == t]:
        _cache.pop(k, None)


def _memo(fn):
    @functools.wraps(fn)
    async def wrapper(db, tenant_id, *args):
        key = (fn.__name__, str(tenant_id), *map(str, args))
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_TTL_S:
            return hit[1]
        out = await fn(db, tenant_id, *args)
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (time.monotonic(), out)
        return out
    return wrapper

_DAY = "((CAST({c} AS timestamptz) AT TIME ZONE 'UTC')::date)"
_MOD = "(CAST(:m AS text) IS NULL OR {c} = CAST(:m AS text))"
_CLOSING = "(c.action = 'auto_resolved' OR (c.action = 'status' AND c.to_value IN ('accepted', 'resolved')))"


def _p(tenant_id: Any, module: str | None, **kw: Any) -> dict:
    return {"t": str(tenant_id), "m": module, **kw}


def _r1(x: Any) -> float | None:
    return None if x is None else round(float(x), 1)


async def _today(db: AsyncSession) -> date:
    return (await db.execute(text("SELECT (now() AT TIME ZONE 'UTC')::date"))).scalar()


# ── burn-down ────────────────────────────────────────────────────────────────

# Every change to the open count, per day. An issue opens at first_seen_at and on each 'reopened' event; it
# closes at resolved_at when it is closed now, and, for each reopen, at the last closing event before that
# reopen (the reopen time when none was recorded). The flows therefore always sum to today's open count.
_FLOWS_SQL = f"""
    WITH ri AS (
        SELECT id, first_seen_at, resolved_at, status FROM record_issues
         WHERE tenant_id = CAST(:t AS uuid) AND {_MOD.format(c="module")}
    ), reo AS (
        SELECT e.issue_id, e.created_at FROM record_issue_events e JOIN ri ON ri.id = e.issue_id
         WHERE e.tenant_id = CAST(:t AS uuid)
           AND (e.action = 'reopened'  -- a run found it failing again, or a steward withdrew a sign-off
                OR (e.action = 'status' AND e.from_value = 'accepted' AND e.to_value = 'open'))
    ), flows AS (
        SELECT first_seen_at AS at, 1 AS n FROM ri WHERE first_seen_at IS NOT NULL
        UNION ALL SELECT resolved_at, -1 FROM ri WHERE status IN ('resolved', 'accepted') AND resolved_at IS NOT NULL
        UNION ALL SELECT created_at, 1 FROM reo
        UNION ALL SELECT COALESCE((SELECT max(c.created_at) FROM record_issue_events c
                                    WHERE c.issue_id = reo.issue_id AND c.created_at < reo.created_at AND {_CLOSING}),
                                  reo.created_at), -1 FROM reo
    )
    SELECT GREATEST({_DAY.format(c="at")}, CAST(:before AS date)) AS day,
           sum(n) FILTER (WHERE n > 0) AS opened, -sum(n) FILTER (WHERE n < 0) AS closed
      FROM flows GROUP BY 1 ORDER BY 1
"""

_RUNS_SQL = f"""
    SELECT v.id::text AS id, v.label, v.run_at,
           (SELECT COALESCE(sum(f.affected_count), 0) FROM findings f
             WHERE f.version_id = v.id AND {_MOD.format(c="f.module")}) AS issues,
           (SELECT count(*) FROM work_records w WHERE w.version_id = v.id AND w.status = ANY(:open_work)
               AND {_MOD.format(c="w.module")}) AS open_records,
           EXISTS (SELECT 1 FROM work_groups g WHERE g.version_id = v.id) AS built
      FROM analysis_versions v
     WHERE v.tenant_id = CAST(:t AS uuid) AND {finished_sql("v.status")}
       AND v.metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND v.metadata->>'archived' IS DISTINCT FROM 'true'
       AND {same_lineage_as("v", "v")}
     ORDER BY v.run_at DESC LIMIT :runs
"""


def projection(open_now: int, open_then: int, today: date, days: int = PACE_DAYS) -> tuple[float, date | None]:
    """Net records closed per day over the last ``days`` and the day the open count reaches zero at that pace
    (None when the pace is zero or negative)."""
    pace = (open_then - open_now) / days
    if pace <= 0:
        return round(pace, 2), None
    return round(pace, 2), today + timedelta(days=math.ceil(open_now / pace))


@_memo
async def burndown(db: AsyncSession, tenant_id: Any, version_id: str | None, module: str | None) -> dict:
    today = await _today(db)
    start = today - timedelta(days=BURNDOWN_DAYS - 1)
    rows = (await db.execute(text(_FLOWS_SQL), _p(tenant_id, module, before=start - timedelta(days=1)))).fetchall()
    flows = {r.day: (int(r.opened or 0), int(r.closed or 0)) for r in rows}
    open_ = sum(o - c for d, (o, c) in flows.items() if d < start)
    days = []
    for i in range(BURNDOWN_DAYS):
        d = start + timedelta(days=i)
        o, c = flows.get(d, (0, 0))
        open_ += o - c
        days.append({"day": d.isoformat(), "open": open_, "opened": o, "closed": c})
    open_now = days[-1]["open"]
    open_then = days[-1 - PACE_DAYS]["open"]
    pace, finish = projection(open_now, open_then, today)
    fixed_7d = (await db.execute(text(f"""
        SELECT count(*) FROM record_issues WHERE tenant_id = CAST(:t AS uuid) AND status = 'resolved'
           AND resolved_at >= now() - interval '7 days' AND {_MOD.format(c="module")}"""), _p(tenant_id, module))).scalar()
    runs: list[dict] = []
    open_records: int | None = None
    if version_id:
        for r in (await db.execute(text(_RUNS_SQL), _p(tenant_id, module, v=version_id, runs=RUNS_SHOWN,
                                                        open_work=list(OPEN_WORK)))).fetchall():
            runs.append({"version_id": r.id, "label": r.label, "run_at": r.run_at.isoformat() if r.run_at else None,
                         "issues": int(r.issues or 0), "open_records": int(r.open_records) if r.built else None})
            if r.id == version_id and r.built:
                open_records = int(r.open_records)
        runs.reverse()
    return {
        "version_id": version_id, "today": today.isoformat(), "days": days, "open_now": open_now,
        "open_records": open_records, "fixed_7d": int(fixed_7d or 0),
        "pace_per_day": pace, "pace_window_days": PACE_DAYS,
        "projected_finish": finish.isoformat() if finish else None, "runs": runs,
    }


# ── time to fix ──────────────────────────────────────────────────────────────

_TTF_SQL = f"""
    WITH x AS (
        SELECT module, check_id, severity, EXTRACT(EPOCH FROM resolved_at - first_seen_at) / 86400.0 AS d
          FROM record_issues
         WHERE tenant_id = CAST(:t AS uuid) AND status = 'resolved' AND resolved_at IS NOT NULL
           AND first_seen_at IS NOT NULL AND resolved_at >= now() - make_interval(days => :days)
           AND {_MOD.format(c="module")}
    )
    SELECT GROUPING(module) AS g_mod, GROUPING(check_id) AS g_chk, GROUPING(severity) AS g_sev,
           module, check_id, severity, count(*) AS fixed,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY d) AS p90
      FROM x GROUP BY GROUPING SETS ((), (module), (check_id, module), (severity))
"""


async def time_to_fix(db: AsyncSession, tenant_id: Any, module: str | None, days: int) -> dict:
    rows = (await db.execute(text(_TTF_SQL), _p(tenant_id, module, days=days))).fetchall()
    stat = lambda r: {"fixed": int(r.fixed), "median_days": _r1(r.median), "p90_days": _r1(r.p90)}
    overall = {"fixed": 0, "median_days": None, "p90_days": None}
    objects, checks, sev = [], [], []
    for r in rows:
        if r.g_mod and r.g_chk and r.g_sev:
            overall = stat(r)
        elif not r.g_chk:
            checks.append({"check_id": r.check_id, "module": r.module, **stat(r)})
        elif not r.g_mod:
            objects.append({"module": r.module, **stat(r)})
        elif not r.g_sev:
            sev.append({"severity": r.severity, **stat(r)})
    slow = lambda o: (-(o["median_days"] or 0), -o["fixed"])
    order = {s: i for i, s in enumerate(SEVERITIES)}
    return {
        "window_days": days, "overall": overall,
        "by_object": sorted(objects, key=lambda o: (*slow(o), o["module"])),
        "by_check": sorted(checks, key=lambda o: (*slow(o), o["check_id"]))[:TOP],
        "by_severity": sorted(sev, key=lambda o: order.get(o["severity"], 9)),
    }


# ── throughput ───────────────────────────────────────────────────────────────

# One row per decision: (day, person, kind). A value decided into a work-list draft counts once per
# (rule, record) item; a sign-off once per issue; an approval once per item of the approved batch.
_DECISIONS_SQL = f"""
    WITH d AS (
        SELECT {_DAY.format(c="i.updated_at")} AS day, COALESCE(b.created_by_label, 'Unknown') AS person,
               b.created_by::text AS user_id,
               CASE WHEN i.proposal_source = 'rule' THEN 'accept' ELSE 'edit' END AS kind
          FROM remediation_batches b JOIN remediation_items i ON i.batch_id = b.id
         WHERE b.tenant_id = CAST(:t AS uuid) AND b.filter->>'source' = 'worklist'
           AND i.proposed_value IS NOT NULL AND i.updated_at >= CAST(:since AS date)
           AND {_MOD.format(c="i.module")}
        UNION ALL
        SELECT {_DAY.format(c="e.created_at")}, COALESCE(e.user_label, 'Unknown'), e.user_id::text,
               CASE WHEN ri.resolution = 'false_positive' THEN 'not_an_issue' ELSE 'accept_risk' END
          FROM record_issue_events e JOIN record_issues ri ON ri.id = e.issue_id
         WHERE e.tenant_id = CAST(:t AS uuid) AND e.action = 'status' AND e.to_value = 'accepted'
           AND e.created_at >= CAST(:since AS date) AND e.user_label IS DISTINCT FROM 'system'
           AND {_MOD.format(c="ri.module")}
        UNION ALL
        SELECT {_DAY.format(c="e.created_at")}, COALESCE(e.user_label, 'Unknown'), e.user_id::text, 'approve'
          FROM remediation_events e JOIN remediation_items i ON i.id = e.item_id
         WHERE e.tenant_id = CAST(:t AS uuid) AND e.action IN ('approved', 'accepted')
           AND e.created_at >= CAST(:since AS date) AND {_MOD.format(c="i.module")}
    )
    SELECT day, person, max(user_id) AS user_id, kind, count(*) AS n FROM d GROUP BY day, person, kind
"""

_WORKLOAD_SQL = f"""
    SELECT ri.assigned_to::text AS assignee_id, max(u.name) AS name, max(u.email) AS email, count(*) AS open,
           count(*) FILTER (WHERE ri.severity = 'critical') AS critical,
           count(*) FILTER (WHERE ri.due_at < now()) AS overdue
      FROM record_issues ri LEFT JOIN users u ON u.id = ri.assigned_to
     WHERE ri.tenant_id = CAST(:t AS uuid) AND ri.status NOT IN ('resolved', 'accepted')
       AND {_MOD.format(c="ri.module")}
     GROUP BY ri.assigned_to
"""

KINDS = ("accept", "edit", "not_an_issue", "accept_risk", "approve")


async def throughput(db: AsyncSession, tenant_id: Any, module: str | None) -> dict:
    today = await _today(db)
    since = today - timedelta(days=THROUGHPUT_DAYS - 1)
    rows = (await db.execute(text(_DECISIONS_SQL), _p(tenant_id, module, since=since))).fetchall()
    per_day: dict[date, dict[str, int]] = {}
    people: dict[str, dict] = {}
    for r in rows:
        per_day.setdefault(r.day, {})
        per_day[r.day][r.person] = per_day[r.day].get(r.person, 0) + int(r.n)
        p = people.setdefault(r.person, {"person": r.person, "user_id": None, "total": 0, **{k: 0 for k in KINDS}})
        p["user_id"] = p["user_id"] or r.user_id  # their records open in Fix work (?assignee=)
        p[r.kind] += int(r.n)
        p["total"] += int(r.n)
    days = []
    for i in range(THROUGHPUT_DAYS):
        d = since + timedelta(days=i)
        by = per_day.get(d, {})
        days.append({"day": d.isoformat(), "total": sum(by.values()), "by_person": by})
    workload = [{"assignee_id": r.assignee_id, "name": r.name or r.email, "email": r.email, "open": int(r.open),
                 "critical": int(r.critical), "overdue": int(r.overdue)}
                for r in (await db.execute(text(_WORKLOAD_SQL), _p(tenant_id, module))).fetchall()]
    workload.sort(key=lambda w: (w["assignee_id"] is None, -w["open"], w["name"] or ""))
    totals = {k: sum(p[k] for p in people.values()) for k in (*KINDS, "total")}
    return {
        "window_days": THROUGHPUT_DAYS, "days": days, "totals": totals,
        "people": sorted(people.values(), key=lambda p: (-p["total"], p["person"])),
        "workload": workload[:50],
    }


# ── recurrence ───────────────────────────────────────────────────────────────

_RECUR_SQL = f"""
    SELECT GROUPING(ri.check_id) AS g_chk, ri.check_id, ri.module, ri.scope, max(s.name) AS system_name,
           count(*) AS issues, count(*) FILTER (WHERE ri.reopened_count > 0) AS reopened,
           COALESCE(sum(ri.reopened_count), 0) AS reopens
      FROM record_issues ri LEFT JOIN sap_systems s ON s.id::text = ri.scope
     WHERE ri.tenant_id = CAST(:t AS uuid) AND {_MOD.format(c="ri.module")}
     GROUP BY GROUPING SETS ((ri.check_id, ri.module), (ri.scope))
"""


@_memo
async def recurrence(db: AsyncSession, tenant_id: Any, module: str | None) -> dict:
    rows = (await db.execute(text(_RECUR_SQL), _p(tenant_id, module))).fetchall()
    rate = lambda r: round(100.0 * r.reopened / r.issues, 1) if r.issues else 0.0
    checks, systems = [], []
    for r in rows:
        base = {"issues": int(r.issues), "reopened": int(r.reopened), "reopens": int(r.reopens), "rate_pct": rate(r)}
        if not r.g_chk:
            checks.append({"check_id": r.check_id, "module": r.module, **base})
        else:
            systems.append({"scope": r.scope, "name": r.system_name or ("Uploads" if r.scope == "upload" else None),
                            **base})
    issues = sum(c["issues"] for c in checks)
    reopened = sum(c["reopened"] for c in checks)
    top = lambda xs, k: sorted((x for x in xs if x["reopened"]), key=lambda x: (-x["reopened"], -x["rate_pct"], x[k]))[:TOP]
    return {
        "totals": {"issues": issues, "reopened": reopened, "reopens": sum(c["reopens"] for c in checks),
                   "rate_pct": round(100.0 * reopened / issues, 1) if issues else 0.0},
        "by_check": top(checks, "check_id"), "by_system": top(systems, "scope"),
    }


# ── root causes ──────────────────────────────────────────────────────────────

def _org_values(col: str) -> str:
    # regexp_match(...)[2]: the value after "<FIELD>=" up to the next "|" of a composite key
    return ", ".join(f"('{f}', (regexp_match({col}, '(^|[|]){f}=([^|]*)'))[2])" for f in ORG_UNITS)


def _roots_sql(source: str) -> str:
    if source == "work_records":
        base = f"""SELECT w.record_key, w.issues, (w.status = ANY(:open_work)) AS is_open, (w.sev_rank = 0) AS crit
                     FROM work_records w WHERE w.tenant_id = CAST(:t AS uuid) AND w.version_id = CAST(:v AS uuid)
                      AND {_MOD.format(c="w.module")}"""
    else:  # a run from before the work list: its failing records, one row per (object, record)
        base = f"""SELECT fr.record_key, count(*) AS issues, true AS is_open, false AS crit
                     FROM finding_records fr WHERE fr.version_id = CAST(:v AS uuid) AND {_MOD.format(c="fr.module")}
                    GROUP BY fr.module, fr.record_key"""
    return f"""
        WITH r AS ({base}),
        s AS (
            SELECT o.dim, o.val, count(*) AS records, sum(r.issues) AS issues,
                   count(*) FILTER (WHERE r.is_open) AS open, count(*) FILTER (WHERE r.crit) AS critical
              FROM r CROSS JOIN LATERAL (VALUES {_org_values("r.record_key")}) AS o(dim, val)
             WHERE o.val IS NOT NULL AND o.val <> '' AND r.record_key LIKE '%=%'
             GROUP BY o.dim, o.val
        )
        SELECT dim, val, records, issues, open, critical, dim_records, dim_values
          FROM (SELECT s.*, row_number() OVER (PARTITION BY dim ORDER BY records DESC, val) AS rk,
                       sum(records) OVER (PARTITION BY dim) AS dim_records,
                       count(*) OVER (PARTITION BY dim) AS dim_values FROM s) z
         WHERE rk <= :top
    """


@_memo
async def root_causes(db: AsyncSession, tenant_id: Any, version_id: str | None, module: str | None) -> dict:
    if not version_id:
        return {"version_id": None, "source": None, "total_records": 0, "dimensions": []}
    built = bool((await db.execute(text("SELECT metadata ? 'worklist_built_at' FROM analysis_versions "
                                        "WHERE id = CAST(:v AS uuid)"), {"v": version_id})).scalar())
    source = "work_records" if built else "finding_records"
    p = _p(tenant_id, module, v=version_id, top=TOP, open_work=list(OPEN_WORK))
    if built:
        total = (await db.execute(text(f"SELECT count(*) FROM work_records w WHERE w.tenant_id = CAST(:t AS uuid) "
                                       f"AND w.version_id = CAST(:v AS uuid) AND {_MOD.format(c='w.module')}"), p)).scalar()
    else:
        total = (await db.execute(text(f"SELECT count(*) FROM (SELECT DISTINCT module, record_key FROM finding_records "
                                       f"WHERE version_id = CAST(:v AS uuid) AND {_MOD.format(c='module')}) x"), p)).scalar()
    rows = (await db.execute(text(_roots_sql(source)), p)).fetchall()
    dims: dict[str, dict] = {}
    for r in rows:
        d = dims.setdefault(r.dim, {"field": r.dim, "label": ORG_UNITS[r.dim], "records": int(r.dim_records),
                                    "values": int(r.dim_values), "top": []})
        d["top"].append({"value": r.val, "records": int(r.records), "issues": int(r.issues or 0), "open": int(r.open),
                         "critical": int(r.critical),
                         "share_pct": round(100.0 * r.records / total, 1) if total else 0.0})
    out = []
    for f in ORG_UNITS:
        if f in dims:
            d = dims[f]
            d["top"] = sorted(d["top"], key=lambda x: (-x["records"], x["value"]))[:TOP]
            out.append(d)
    return {"version_id": version_id, "source": source, "total_records": int(total or 0), "dimensions": out}


# ── proposal quality ─────────────────────────────────────────────────────────

_PROPOSAL_SQL = f"""
    SELECT i.proposal_source AS source,
           count(*) FILTER (WHERE i.proposed_value IS NOT NULL) AS proposed,
           count(*) FILTER (WHERE i.proposed_value IS NOT NULL AND (i.accepted OR b.status IN ('approved', 'exported'))) AS approved,
           count(*) FILTER (WHERE i.proposed_value IS NOT NULL AND b.status = 'exported') AS exported,
           count(*) FILTER (WHERE i.recon_status = 'fixed') AS fixed,
           count(*) FILTER (WHERE i.recon_status = 'still_failing') AS still_failing
      FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
     WHERE i.tenant_id = CAST(:t AS uuid) AND {_MOD.format(c="i.module")}
     GROUP BY i.proposal_source
"""


async def proposal_quality(db: AsyncSession, tenant_id: Any, module: str | None) -> dict:
    found = {r.source: r for r in (await db.execute(text(_PROPOSAL_SQL), _p(tenant_id, module))).fetchall()}
    out = []
    for s in (*SOURCES, *sorted(k for k in found if k not in SOURCES)):
        r = found.get(s)
        row = {k: int(getattr(r, k) or 0) if r else 0 for k in ("proposed", "approved", "exported", "fixed", "still_failing")}
        checked = row["fixed"] + row["still_failing"]
        row |= {"source": s,
                "approval_rate_pct": round(100.0 * row["approved"] / row["proposed"], 1) if row["proposed"] else None,
                "fix_rate_pct": round(100.0 * row["fixed"] / checked, 1) if checked else None}
        out.append(row)
    return {"sources": out,
            "totals": {k: sum(r[k] for r in out) for k in ("proposed", "approved", "exported", "fixed", "still_failing")}}


# ── run-to-run change ────────────────────────────────────────────────────────

_PREVIOUS_SQL = f"""
    SELECT p.id::text AS id, p.label, p.run_at FROM analysis_versions p
     WHERE p.tenant_id = CAST(:t AS uuid) AND {finished_sql("p.status")}
       AND p.metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND p.id <> CAST(:v AS uuid) AND {same_lineage_as("v", "p")}
       AND p.run_at < (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid))
     ORDER BY p.run_at DESC LIMIT 1
"""


async def run_change(db: AsyncSession, tenant_id: Any, version_id: str | None, module: str | None) -> dict:
    empty = {"version_id": version_id, "previous": None, "objects": [],
             "totals": {"new": 0, "fixed": 0, "still_failing": 0}, "not_comparable_checks": 0}
    if not version_id:
        return empty
    prev = (await db.execute(text(_PREVIOUS_SQL), {"t": str(tenant_id), "v": version_id})).fetchone()
    if not prev:
        return empty
    rows = (await db.execute(text(DIFF_SQL), {"v1": prev.id, "v2": version_id})).fetchall()
    objects: dict[str, dict] = {}
    skipped = 0
    for r in rows:
        if module and r.module != module:
            continue
        o = objects.setdefault(r.module, {"module": r.module, "new": 0, "fixed": 0, "still_failing": 0,
                                          "not_comparable_checks": 0})
        if r.ran_v1 and r.ran_v2 and not r.truncated:
            o["new"] += int(r.new)
            o["fixed"] += int(r.resolved)
            o["still_failing"] += int(r.persisting)
        else:
            o["not_comparable_checks"] += 1
            skipped += 1
    out = sorted(objects.values(), key=lambda o: (-o["new"], -o["still_failing"], o["module"]))
    return {"version_id": version_id,
            "previous": {"version_id": prev.id, "label": prev.label,
                         "run_at": prev.run_at.isoformat() if prev.run_at else None},
            "objects": out, "totals": {k: sum(o[k] for o in out) for k in ("new", "fixed", "still_failing")},
            "not_comparable_checks": skipped}
