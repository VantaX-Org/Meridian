"""The Action centre: what needs a person's attention now, ranked, in one list.

``collect`` builds the tenant-level list: one SQL statement per source over aggregates (never a row-by-row read of
``work_records``: overdue records are one grouped count over the current state's runs; everything else reads
``findings``, ``analysis_versions``, ``sync_profiles``, ``sync_runs``, ``sap_systems``, ``stewardship_queue`` and the
other small tables), plus the failed jobs of the Redis job registry (skipped when Redis is down). Each item is one
(kind, system, module) with a count; its title and detail are one plain sentence per kind, written here so the Rail,
Home and the object page read the same words.

Ranking is fixed, with no weights: ``(tier, severity_rank, -count, since)``. Tiers: 1 blocked work, 2 data
regression, 3 freshness, 4 hygiene, 5 admin.

``cached_collect`` keeps the tenant-level list for 60 s (Redis, else in this process); ``invalidate`` drops it when a
signal changes. ``visible_to`` then filters per viewer: an item shows when its ``required_action`` is among the
viewer's effective actions at the item's scope (system, module), so a scoped user sees only their slice and the
admin items need tenant-wide ``manage_users``. Deterministic SQL and Python; every query is tenant-filtered and runs
after ``app.tenant_id`` is set.

Not here yet: ``discovery_due`` (process schedules) and ``api_key_expiring`` (API keys) come with their work packages.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlencode

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.middleware.cache import _build_cache_key, get_redis, invalidate_tenant_cache
from api.routes.sync_trigger import module_label
from api.services import jobs, object_monitor
from api.services.current_state import pairs_clause
from api.services.rbac import Scope, _scope_matches, actions_for, grants_for, user_grants
from api.services.scoring import scoring_config, tier as score_tier

logger = logging.getLogger("meridian.attention")

CACHE_TTL_S = 60
CACHE_PREFIX = "attention"
SEVERITIES = ("critical", "high", "medium", "low")
_SEV_RANK = {s: i for i, s in enumerate(SEVERITIES)}
OPEN_WORK = ("to_fix", "proposed", "approved", "sent")
INBOX_OPEN = ("open", "in_progress", "escalated")
JOB_KINDS = {"extraction", "analysis", "config_sync", "upload"}
SYNC_JOB_KINDS = {"extraction", "config_sync"}
MISSED_GRACE = timedelta(minutes=15)
DRIFT_WINDOW = timedelta(days=7)
JOB_WINDOW = timedelta(hours=24)
FITNESS_DROP = 0.05  # fitness is a 0..1 ratio: 5 points
SEAT_WARN = 0.9
LICENCE_WARN_DAYS = 30
GRANT_WARN_DAYS = 14
INVITE_STALE_DAYS = 7
DORMANT_DAYS = 90
DORMANT_NEVER_DAYS = 30

# kind -> (tier, required action, button label)
KINDS: dict[str, tuple[int, str, str]] = {
    "regression": (2, "apply", "Review records"),
    "stale_object": (3, "trigger_sync", "Re-check now"),
    "schedule_missed": (3, "trigger_sync", "Open schedules"),
    "schedule_failed": (3, "trigger_sync", "Retry"),
    "job_failed": (3, "trigger_sync", "Open job"),
    "connection": (1, "manage_systems", "Open system"),
    "config_missing": (4, "trigger_sync", "Load configuration"),
    "config_drift": (4, "manage_systems", "Review changes"),
    "approvals": (1, "approve", "Review approvals"),
    "sla_breach": (4, "assign", "Open overdue items"),
    "overdue_records": (4, "apply", "Fix overdue records"),
    "object_no_go": (4, "view", "Open object"),
    "discovery_failed": (3, "run_process_discovery", "Open run"),
    "fitness_drop": (2, "run_process_discovery", "Open process"),
    "rule_review": (4, "review_ai_rules", "Review rules"),
    "contract_breach": (4, "manage_rules", "Open contracts"),
    "access_requests": (5, "manage_users", "Review requests"),
    "invites_pending": (5, "manage_users", "Review invitations"),
    "seats": (5, "manage_users", "Open licence"),
    "grants_expiring": (5, "manage_users", "Review grants"),
    "dormant_users": (5, "manage_users", "Review users"),
}

Item = dict[str, Any]


# ── Wording ──────────────────────────────────────────────────────────────────

def _n(n: int, noun: str, plural: Optional[str] = None) -> str:
    return f"{n:,} {noun if n == 1 else plural or noun + 's'}"


def _is(n: int) -> str:
    return "is" if n == 1 else "are"


def _span(seconds: float) -> str:
    s = max(0, int(seconds))
    if s < 3600:
        return _n(max(1, s // 60), "minute")
    if s < 86400:
        return _n(s // 3600, "hour")
    return _n(s // 86400, "day")


def _ago(then: Optional[datetime], now: datetime) -> str:
    if then is None:
        return "a while ago"
    then = then if then.tzinfo else then.replace(tzinfo=timezone.utc)
    return f"{_span((now - then).total_seconds())} ago"


def _every(seconds: Optional[int]) -> str:
    if not seconds:
        return "on its schedule"
    named = {3600: "hourly", 86400: "daily", 604800: "weekly"}
    if seconds in named:
        return named[seconds]
    return f"every {seconds // 3600} hours" if seconds < 172800 else f"every {seconds // 86400} days"


def _fix_href(**f: Any) -> str:
    """frontend/lib/drill.ts ``fixHref``: same parameter order, omitted filters stay off the URL."""
    order = ("run", "module", "check", "sev", "st", "mine", "assignee", "sugg", "due", "system", "part", "q", "record")
    q = [(k, str(f[k])) for k in order if f.get(k)]
    return f"/fix?{urlencode(q)}" if q else "/fix"


def _approvals_title(n: int, label: Optional[str], golden: bool) -> str:
    if golden:
        return f"{_n(n, 'golden record write-back')} {_is(n)} waiting for approval"
    return f"{_n(n, 'fix batch', 'fix batches')} {_is(n)} waiting for approval" + (f" on {label}" if label else "")


def _iso(moment: Optional[datetime]) -> Optional[str]:
    if moment is None:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).isoformat()


def _item(kind: str, *, severity: str, title: str, detail: str, href: str, count: int = 1,
          module: Optional[str] = None, system_id: Optional[str] = None, system_name: Optional[str] = None,
          since: Optional[datetime] = None, tier: Optional[int] = None, **hidden: Any) -> Item:
    default_tier, action, label = KINDS[kind]
    return {
        "id": f"{kind}:{system_id or '-'}:{module or '-'}", "kind": kind, "tier": tier or default_tier,
        "severity": severity, "title": title, "detail": detail, "href": href, "action_label": label,
        "count": int(count), "object": module_label(module) if module else None, "system_id": system_id,
        "system_name": system_name, "module": module, "since": _iso(since), "required_action": action,
        **{f"_{k}": v for k, v in hidden.items()},
    }


def rank_key(item: Item) -> tuple:
    """``(tier, severity_rank, count desc, since asc)``; an item with no ``since`` sorts last, then by id."""
    return item["tier"], _SEV_RANK[item["severity"]], -item["count"], item["since"] or "9999", item["id"]


# ── Sources ──────────────────────────────────────────────────────────────────

class _Ctx:
    def __init__(self, db: AsyncSession, tenant_id: str, now: datetime) -> None:
        self.db, self.t, self.now = db, tenant_id, now
        self.systems: dict[str, dict] = {}
        self.rows: list[dict] = []  # object monitor rows of the current state

    def p(self, **kw: Any) -> dict:
        return {"t": self.t, "now": self.now, **kw}

    async def q(self, sql: str, **kw: Any) -> list:
        return list((await self.db.execute(text(sql), self.p(**kw))).fetchall())

    def name(self, system_id: Optional[str]) -> Optional[str]:
        return (self.systems.get(system_id) or {}).get("name") if system_id else None

    def pairs(self) -> list[dict]:
        return [{"module": r["module"], "version_id": r["last_version_id"]} for r in self.rows if r["last_version_id"]]

    def system_of(self, module: str) -> Optional[str]:
        return next((r["system_id"] for r in self.rows if r["module"] == module), None)


_SYSTEMS = """
    SELECT s.id::text AS id, s.name, s.system_type, s.is_active, s.health_status, s.last_health_check, s.created_at,
           EXISTS (SELECT 1 FROM config_loads c WHERE c.tenant_id = s.tenant_id AND c.system_id = s.id) AS has_config
      FROM sap_systems s WHERE s.tenant_id = CAST(:t AS uuid)"""


async def _connection(c: _Ctx) -> list[Item]:
    out = []
    for s in c.systems.values():
        if not s["is_active"] or s["health_status"] not in ("unreachable", "auth_failed", "degraded"):
            continue
        bad = s["health_status"] != "degraded"
        title = (f"Sign-in to {s['name']} is failing" if s["health_status"] == "auth_failed"
                 else f"{s['name']} cannot be reached" if bad else f"{s['name']} is only partly available")
        out.append(_item("connection", severity="critical" if bad else "medium", tier=1 if bad else 4, title=title,
                         detail=f"Last checked {_ago(s['last_health_check'], c.now)}. "
                                + ("Data cannot be read until the connection works." if bad
                                   else "Some reads may fail until it recovers."),
                         href=f"/systems/{s['id']}", system_id=s["id"], system_name=s["name"],
                         since=s["last_health_check"]))
    return out


async def _config_missing(c: _Ctx) -> list[Item]:
    from api.services.config_areas import no_config_api

    return [_item("config_missing", severity="medium", title=f"The configuration of {s['name']} is not loaded",
                  detail="Load it so Meridian can check your data against how SAP is set up.",
                  href="/systems?config=not_loaded", system_id=s["id"], system_name=s["name"], since=s["created_at"])
            for s in c.systems.values()
            if s["is_active"] and not s["has_config"] and not no_config_api(s["system_type"])]


async def _config_drift(c: _Ctx) -> list[Item]:
    rows = await c.q("""
        SELECT l.system_id::text AS system_id, count(*) AS n, min(d.detected_at) AS since
          FROM config_drift_log d LEFT JOIN config_loads l ON l.id = d.run_id AND l.tenant_id = d.tenant_id
         WHERE d.tenant_id = CAST(:t AS uuid) AND d.detected_at > CAST(:now AS timestamptz) - CAST(:win AS interval)
         GROUP BY l.system_id""", win=DRIFT_WINDOW)
    return [_item("config_drift", severity="medium", count=r.n, system_id=r.system_id, system_name=c.name(r.system_id),
                  title=f"{_n(r.n, 'configuration change')} detected"
                        + (f" on {c.name(r.system_id)}" if c.name(r.system_id) else ""),
                  detail="Found in the last 7 days. Check that they were intended.",
                  href=f"/systems/{r.system_id}?tab=config" if r.system_id else "/systems", since=r.since)
            for r in rows]


async def _monitor(c: _Ctx) -> list[Item]:
    """regression and stale_object, from the object monitor rows of the current state."""
    out = []
    for r in c.rows:
        module, label, sid = r["module"], module_label(r["module"]), r["system_id"]
        d, name = r["drift"], c.name(r["system_id"])
        rules, n_rules = d["newly_failing_rules"], d["newly_failing_rule_count"]
        # records that started failing, in rules that also failed before or in rules that are newly failing
        records = max(d["new_failing"], sum(x.get("new", 0) for x in rules))
        if records > 0:
            severe = any(x.get("severity") in ("critical", "high") for x in rules)
            out.append(_item(
                "regression", severity="critical" if severe else "high", tier=1 if severe else 2,
                count=records, module=module, system_id=sid, system_name=name, since=r["last_run_at"],
                title=(f"{_n(n_rules, 'rule')} regressed on {label}" if n_rules
                       else f"{_n(records, 'record')} started failing on {label}"),
                detail=f"{_n(records, 'record')} started failing since the "
                       f"{'pinned baseline' if r['baseline']['kind'] == 'pinned' else 'previous run'}.",
                href=_fix_href(run=r["last_version_id"], module=module, st="to_fix",
                               check=rules[0]["check_id"] if n_rules == 1 and rules else None)))
        if r["freshness"] == "stale":
            out.append(_item(
                "stale_object", severity="high", module=module, system_id=sid, system_name=name,
                since=r["last_run_at"], title=f"{label} has not been checked on schedule",
                detail=f"The last check was {_ago(r['last_run_at'], c.now)}; it runs "
                       f"{_every(r['cadence']['interval_seconds'])}.",
                href=f"/objects/{module}#monitor"))
    return out


async def _schedules(c: _Ctx) -> list[Item]:
    out = []
    for r in await c.q("""
            SELECT sp.system_id::text AS system_id, sp.domain AS module, min(sp.next_run_at) AS since
              FROM sync_profiles sp
             WHERE sp.tenant_id = CAST(:t AS uuid) AND sp.active AND sp.schedule_cron IS NOT NULL
               AND sp.next_run_at < CAST(:now AS timestamptz) - CAST(:grace AS interval)
               AND NOT EXISTS (SELECT 1 FROM sync_runs r WHERE r.profile_id = sp.id AND r.tenant_id = sp.tenant_id
                                  AND r.status = 'running')
             GROUP BY sp.system_id, sp.domain""", grace=MISSED_GRACE):
        out.append(_item("schedule_missed", severity="high", module=r.module, system_id=r.system_id,
                         system_name=c.name(r.system_id), since=r.since,
                         title=f"The scheduled check of {module_label(r.module)} did not start",
                         detail=f"It was due {_ago(r.since, c.now)}. Check that the schedule is running.",
                         href=f"/systems/{r.system_id}?tab=health#schedules"))
    groups: dict[tuple, list] = {}
    for r in await c.q("""
            SELECT sp.system_id::text AS system_id, sp.domain AS module, l.id::text AS run_id, l.started_at
              FROM sync_profiles sp
              JOIN LATERAL (SELECT id, status, started_at FROM sync_runs r
                             WHERE r.profile_id = sp.id AND r.tenant_id = sp.tenant_id
                             ORDER BY r.started_at DESC LIMIT 1) l ON true
             WHERE sp.tenant_id = CAST(:t AS uuid) AND sp.active AND l.status = 'failed'
             ORDER BY l.started_at DESC"""):
        groups.setdefault((r.system_id, r.module), []).append(r)
    for (sid, module), rs in groups.items():
        out.append(_item("schedule_failed", severity="high", count=len(rs), module=module, system_id=sid,
                         system_name=c.name(sid), since=min(x.started_at for x in rs),
                         title=f"The last scheduled check of {module_label(module)} failed",
                         detail=f"It failed {_ago(rs[0].started_at, c.now)}. Retry it once the cause is fixed.",
                         href=f"/admin/jobs?job={rs[0].run_id}"))
    return out


def _job_time(j: dict) -> float:
    return j.get("finished_at") or j.get("updated_at") or 0


async def _failed_jobs(c: _Ctx) -> list[Item]:
    listed = await asyncio.to_thread(jobs.list_jobs, c.t, limit=jobs.INDEX_KEEP)  # [] when Redis is down
    cutoff = c.now.timestamp() - JOB_WINDOW.total_seconds()
    groups: dict[Optional[str], list[dict]] = {}
    for j in listed:
        if j.get("status") == "failed" and j.get("kind") in JOB_KINDS and _job_time(j) >= cutoff:
            groups.setdefault(j.get("system_id"), []).append(j)
    out = []
    for sid, js in groups.items():
        js.sort(key=_job_time, reverse=True)
        newest, oldest = (datetime.fromtimestamp(_job_time(j), timezone.utc) for j in (js[0], js[-1]))
        item = _item("job_failed", severity="high", count=len(js), system_id=sid, system_name=c.name(sid),
                     since=oldest, title=f"{_n(len(js), 'background job')} failed in the last 24 hours"
                     + (f" on {c.name(sid)}" if c.name(sid) else ""),
                     detail=f"The latest failed {_ago(newest, c.now)}.", href=f"/admin/jobs?job={js[0]['id']}")
        if not any(j["kind"] in SYNC_JOB_KINDS for j in js):
            item["required_action"] = "analyse"
        out.append(item)
    return out


async def _overdue_records(c: _Ctx) -> list[Item]:
    pairs = c.pairs()
    if not pairs:
        return []
    params = c.p(open=list(OPEN_WORK))
    rows = (await c.db.execute(text(f"""
        SELECT w.module, count(*) AS n, min(w.due_at) AS since FROM work_records w
         WHERE w.tenant_id = CAST(:t AS uuid) AND {pairs_clause('w', pairs, params)}
           AND w.status = ANY(CAST(:open AS text[])) AND w.due_at < CAST(:now AS timestamptz)
         GROUP BY w.module"""), params)).fetchall()
    return [_item("overdue_records", severity="medium", count=r.n, module=r.module, system_id=c.system_of(r.module),
                  system_name=c.name(c.system_of(r.module)), since=r.since,
                  title=f"{_n(r.n, 'record')} {_is(r.n)} past the due date on {module_label(r.module)}",
                  detail="Fix them or move the due date.", href=_fix_href(module=r.module, due="overdue"))
            for r in rows]


async def _no_go(c: _Ctx) -> list[Item]:
    pairs = c.pairs()
    if not pairs:
        return []
    runs = {r.id: r for r in await c.q(
        "SELECT id::text AS id, dqs_summary, run_at FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
        "AND id = ANY(CAST(:ids AS uuid[]))", ids=sorted({p["version_id"] for p in pairs}))}
    raw = await c.q("SELECT dqs_weights FROM tenants WHERE id = CAST(:t AS uuid)")
    thresholds = scoring_config(raw[0].dqs_weights if raw else None)["thresholds"]
    bad = []
    for p in pairs:
        entry = ((runs[p["version_id"]].dqs_summary or {}) if p["version_id"] in runs else {}).get(p["module"])
        score = entry.get("composite_score") if isinstance(entry, dict) else None
        if score is not None and score_tier(score, thresholds) == "fail":
            bad.append((p, float(score)))
    if not bad:
        return []
    params = c.p()
    blocking = {r.module: r.n for r in (await c.db.execute(text(f"""
        SELECT f.module, count(*) AS n FROM findings f
         WHERE f.tenant_id = CAST(:t AS uuid) AND {pairs_clause('f', [p for p, _ in bad], params)}
           AND f.affected_count > 0 AND f.severity IN ('critical', 'high') GROUP BY f.module"""), params)).fetchall()}
    out = []
    for p, score in bad:
        k = blocking.get(p["module"], 0)
        out.append(_item("object_no_go", severity="medium", count=k or 1, module=p["module"],
                         system_id=c.system_of(p["module"]), system_name=c.name(c.system_of(p["module"])),
                         since=runs[p["version_id"]].run_at, title=f"{module_label(p['module'])} is rated No-go",
                         detail=f"The score is {score:.0f}, below the warning level of {thresholds['warning']:.0f}. "
                                f"{_n(k, 'critical or high rule')} {_is(k)} failing.",
                         href=f"/objects/{p['module']}"))
    return out


async def _approvals(c: _Ctx) -> list[Item]:
    out = []
    by_module: dict[str, dict] = {}
    for r in await c.q("""
            SELECT i.module, b.created_by::text AS by, count(DISTINCT b.id) AS n, min(b.created_at) AS since
              FROM remediation_batches b JOIN remediation_items i ON i.batch_id = b.id AND i.tenant_id = b.tenant_id
             WHERE b.tenant_id = CAST(:t AS uuid) AND b.status = 'draft' AND i.accepted
             GROUP BY i.module, b.created_by"""):
        g = by_module.setdefault(r.module, {"n": 0, "since": r.since, "by": {}})
        g["n"] += r.n
        g["since"] = min(g["since"], r.since)
        g["by"][r.by or ""] = g["by"].get(r.by or "", 0) + r.n
    for module, g in by_module.items():
        out.append(_item("approvals", severity="high", count=g["n"], module=module, since=g["since"],
                         title=_approvals_title(g["n"], module_label(module), False),
                         detail="A second person has to approve them before they can be exported.",
                         href="/inbox?kind=approvals", by=g["by"], golden=False, label=module_label(module)))
    if (await c.q("SELECT to_regclass('golden_writeback_requests') AS reg"))[0].reg:
        rows = await c.q("""
            SELECT requested_by AS by, count(*) AS n, min(created_at) AS since FROM golden_writeback_requests
             WHERE tenant_id = CAST(:t AS uuid) AND status = 'pending_approval' GROUP BY requested_by""")
        if rows:
            n = sum(r.n for r in rows)
            out.append(_item("approvals", severity="high", count=n, since=min(r.since for r in rows),
                             title=_approvals_title(n, None, True),
                             detail="A second person has to approve them before they are written to SAP.",
                             href="/inbox?kind=approvals", by={r.by: r.n for r in rows}, golden=True, label=None))
    return out


async def _sla(c: _Ctx) -> list[Item]:
    rows = await c.q("""
        SELECT domain AS module, count(*) AS n, min(due_at) AS since FROM stewardship_queue
         WHERE tenant_id = CAST(:t AS uuid) AND status = ANY(CAST(:open AS text[]))
           AND due_at < CAST(:now AS timestamptz) GROUP BY domain""", open=list(INBOX_OPEN))
    return [_item("sla_breach", severity="high", count=r.n, module=r.module, since=r.since,
                  title=f"{_n(r.n, 'inbox item')} {_is(r.n)} overdue in {module_label(r.module)}",
                  detail="They passed their due date. Assign or resolve them.", href="/inbox?due=overdue")
            for r in rows]


async def _discovery(c: _Ctx) -> list[Item]:
    out = []
    failed: dict[str, list] = {}
    for r in await c.q("""
            SELECT DISTINCT ON (system_id, l1) system_id::text AS system_id, l1, id::text AS id, status, started_at
              FROM process_discovery_runs WHERE tenant_id = CAST(:t AS uuid) AND status IN ('completed', 'failed')
             ORDER BY system_id, l1, started_at DESC, id DESC"""):
        if r.status == "failed":
            failed.setdefault(r.system_id, []).append(r)
    for sid, rs in failed.items():
        rs.sort(key=lambda r: r.started_at, reverse=True)
        out.append(_item("discovery_failed", severity="high", count=len(rs), system_id=sid, system_name=c.name(sid),
                         since=min(r.started_at for r in rs),
                         title=f"Process discovery failed on {c.name(sid) or 'a system'}",
                         detail=f"The latest run for {', '.join(r.l1.upper() for r in rs)} failed "
                                f"{_ago(rs[0].started_at, c.now)}.",
                         href=f"/process/runs/{rs[0].id}"))
    runs: dict[tuple, dict[int, float]] = {}
    for r in await c.q("""
            SELECT system_id::text AS system_id, l1, fitness, n FROM (
                SELECT system_id, l1, (stats->'conformance'->>'fitness')::float AS fitness,
                       row_number() OVER (PARTITION BY system_id, l1 ORDER BY started_at DESC, id DESC) AS n
                  FROM process_discovery_runs
                 WHERE tenant_id = CAST(:t AS uuid) AND status = 'completed'
                   AND jsonb_typeof(stats->'conformance'->'fitness') = 'number') x
             WHERE n <= 2"""):
        runs.setdefault((r.system_id, r.l1), {})[r.n] = r.fitness
    drops: dict[str, list] = {}
    for (sid, l1), f in runs.items():
        if 1 in f and 2 in f and f[2] - f[1] >= FITNESS_DROP - 1e-9:
            drops.setdefault(sid, []).append((f[2] - f[1], l1, f[2], f[1]))
    for sid, ds in drops.items():
        _, l1, before, after = max(ds)
        out.append(_item("fitness_drop", severity="medium", count=len(ds), system_id=sid, system_name=c.name(sid),
                         title=f"Process fitness dropped on {c.name(sid) or 'a system'}",
                         detail=f"{l1.upper()} fell from {before * 100:.0f}% to {after * 100:.0f}% between the last two runs.",
                         href=f"/process/{l1}?system={sid}"))
    return out


async def _rules(c: _Ctx) -> list[Item]:
    r = (await c.q("""
        SELECT (SELECT count(*) FROM ai_proposed_rules WHERE tenant_id = CAST(:t AS uuid) AND status = 'draft'
                   AND domain LIKE 'dq_rule:%') AS drafts,
               (SELECT count(*) FROM learned_rule_proposals WHERE tenant_id = CAST(:t AS uuid)
                   AND status = 'pending') AS learned,
               LEAST((SELECT min(created_at) FROM ai_proposed_rules WHERE tenant_id = CAST(:t AS uuid)
                         AND status = 'draft' AND domain LIKE 'dq_rule:%'),
                     (SELECT min(created_at) FROM learned_rule_proposals WHERE tenant_id = CAST(:t AS uuid)
                         AND status = 'pending')) AS since"""))[0]
    n = r.drafts + r.learned
    if not n:
        return []
    return [_item("rule_review", severity="low", count=n, since=r.since,
                  title=f"{_n(n, 'rule proposal')} {_is(n)} waiting for review",
                  detail="Drafts and learned rules need a decision before they run.", href="/rules/drafts?tab=ai")]


async def _contracts(c: _Ctx) -> list[Item]:
    r = (await c.q("""
        SELECT count(*) AS n, min(h.recorded_at) AS since FROM contracts k
          JOIN LATERAL (SELECT overall_compliant, recorded_at FROM contract_compliance_history h
                         WHERE h.contract_id = k.id AND h.tenant_id = k.tenant_id
                         ORDER BY h.recorded_at DESC LIMIT 1) h ON true
         WHERE k.tenant_id = CAST(:t AS uuid) AND k.status = 'active' AND NOT h.overall_compliant"""))[0]
    if not r.n:
        return []
    return [_item("contract_breach", severity="medium", count=r.n, since=r.since,
                  title=f"{_n(r.n, 'data contract')} {_is(r.n)} not met",
                  detail="The latest check found values outside the agreed limits.", href="/rules/contracts")]


async def _admin(c: _Ctx) -> list[Item]:
    from api.deps import Tenant
    from api.middleware.licence import get_cached_manifest
    from api.routes.licence import seats_for

    out = []
    r = (await c.q("SELECT count(*) AS n, min(created_at) AS since FROM access_requests "
                   "WHERE tenant_id = CAST(:t AS uuid) AND status = 'open'"))[0]
    if r.n:
        out.append(_item("access_requests", severity="high", count=r.n, since=r.since,
                         title=f"{_n(r.n, 'access request')} {_is(r.n)} waiting for a decision",
                         detail="People are waiting to be granted access.", href="/admin/roles?tab=requests"))
    r = (await c.q("""
        SELECT count(*) AS n, min(COALESCE(invited_at, created_at)) AS since FROM users
         WHERE tenant_id = CAST(:t AS uuid) AND is_active
           AND ((password_hash IS NULL AND invited_at < CAST(:now AS timestamptz) - CAST(:d AS interval))
                OR invite_status = 'failed')""", d=timedelta(days=INVITE_STALE_DAYS)))[0]
    if r.n:
        out.append(_item("invites_pending", severity="medium", count=r.n, since=r.since,
                         title=f"{_n(r.n, 'invitation')} {'was' if r.n == 1 else 'were'} not accepted",
                         detail="They were sent more than 7 days ago or could not be sent.",
                         href="/admin/users?status=invited"))
    used, limit = await seats_for(c.db, Tenant(uuid.UUID(c.t), "", []))
    days = get_cached_manifest().get("days_remaining")
    full = limit is not None and used / limit >= SEAT_WARN
    ending = isinstance(days, (int, float)) and days < LICENCE_WARN_DAYS
    if full or ending:
        out.append(_item(
            "seats", severity="high" if ending else "medium", count=used,
            title=("The licence needs attention" if full and ending else "The licence is nearly used up" if full
                   else "The licence is about to end"),
            detail=" ".join(([f"{used} of {limit} seats are in use."] if full else [])
                            + ([f"The licence ends in {_n(int(days), 'day')}."] if ending else [])),
            href="/admin/licence"))
    r = (await c.q("""
        SELECT count(*) AS n, min(expires_at) AS since FROM user_role_scopes
         WHERE tenant_id = CAST(:t AS uuid) AND expires_at > CAST(:now AS timestamptz)
           AND expires_at < CAST(:now AS timestamptz) + CAST(:d AS interval)""", d=timedelta(days=GRANT_WARN_DAYS)))[0]
    if r.n:
        out.append(_item("grants_expiring", severity="low", count=r.n, since=r.since,
                         title=f"{_n(r.n, 'access grant')} will expire within 14 days",
                         detail="Renew them or let them lapse.", href="/admin/roles?tab=users&expiring=1"))
    r = (await c.q("""
        SELECT count(*) AS n, min(COALESCE(last_login, invited_at, created_at)) AS since FROM users
         WHERE tenant_id = CAST(:t AS uuid) AND is_active AND (
               last_login < CAST(:now AS timestamptz) - CAST(:d AS interval)
            OR (last_login IS NULL AND password_hash IS NOT NULL
                AND COALESCE(invited_at, created_at) < CAST(:now AS timestamptz) - CAST(:never AS interval)))""",
                   d=timedelta(days=DORMANT_DAYS), never=timedelta(days=DORMANT_NEVER_DAYS)))[0]
    if r.n:
        out.append(_item("dormant_users", severity="low", count=r.n, since=r.since,
                         title=f"{_n(r.n, 'user')} {'has' if r.n == 1 else 'have'} not signed in for 90 days",
                         detail="Consider suspending their accounts.", href="/admin/users?status=dormant"))
    return out


_SOURCES: list[tuple[str, Callable[[_Ctx], Awaitable[list[Item]]]]] = [
    ("connection", _connection), ("config_missing", _config_missing), ("config_drift", _config_drift),
    ("monitor", _monitor), ("schedules", _schedules), ("jobs", _failed_jobs), ("overdue_records", _overdue_records),
    ("object_no_go", _no_go), ("approvals", _approvals), ("sla_breach", _sla), ("discovery", _discovery),
    ("rules", _rules), ("contracts", _contracts), ("admin", _admin),
]


async def collect(session: AsyncSession, tenant_id: Any, now: Optional[datetime] = None) -> list[Item]:
    """The tenant's attention items, ranked. A source that fails is logged and skipped, never raised: the list is
    advice, and one broken table must not hide the rest (each source runs in its own savepoint)."""
    now = now or datetime.now(timezone.utc)
    c = _Ctx(session, str(tenant_id), now)
    await session.execute(text(f"SET app.tenant_id = '{c.t}'"))
    items: list[Item] = []

    async def guarded(name: str, fn: Callable[[], Awaitable[Any]]) -> Any:
        try:
            async with session.begin_nested():
                return await fn()
        except Exception as exc:  # noqa: BLE001 - one broken source must not take the list down
            logger.warning("attention source %s failed: %s", name, exc)
            return None

    async def load_systems() -> dict[str, dict]:
        return {r.id: dict(r._mapping) for r in await c.q(_SYSTEMS)}

    c.systems = await guarded("systems", load_systems) or {}
    c.rows = await guarded("monitor rows", lambda: object_monitor.for_current_state(session, tenant_id, None, now)) or []
    for name, fn in _SOURCES:
        items.extend(await guarded(name, lambda fn=fn: fn(c)) or [])
    return sorted(items, key=rank_key)


# ── Cache ────────────────────────────────────────────────────────────────────

_memo: dict[str, tuple[float, dict]] = {}
_REDIS_RETRY_S = 30
_redis_down_until = 0.0


def _redis():
    """The Redis client, or None; after a miss it is not asked again for 30 s (a failed connect is slow)."""
    global _redis_down_until
    if time.monotonic() < _redis_down_until:
        return None
    r = get_redis()
    if r is None:
        _redis_down_until = time.monotonic() + _REDIS_RETRY_S
    return r


def _key(tenant_id: Any) -> str:
    return _build_cache_key(str(tenant_id), CACHE_PREFIX, "collect", "v1")


async def cached_collect(session: AsyncSession, tenant_id: Any) -> dict:
    """``{generated_at, items}`` for the tenant, at most 60 s old: Redis, else this process."""
    key, r = _key(tenant_id), _redis()
    try:
        if r is not None:
            hit = r.get(key)
            if hit:
                return json.loads(hit)
        else:
            m = _memo.get(key)
            if m and time.monotonic() - m[0] < CACHE_TTL_S:
                return m[1]
    except Exception as exc:  # noqa: BLE001
        logger.warning("attention cache read failed: %s", exc)
    now = datetime.now(timezone.utc)
    payload = {"generated_at": now.isoformat(), "items": await collect(session, tenant_id, now)}
    try:
        if r is not None:
            r.setex(key, CACHE_TTL_S, json.dumps(payload, default=str))
        else:
            _memo[key] = (time.monotonic(), payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("attention cache write failed: %s", exc)
    return payload


def invalidate(tenant_id: Any) -> None:
    """Drop the tenant's cached list (a run finished, an approval or request was decided, a schedule or a
    health check changed). Safe to call from a request or a worker."""
    _memo.pop(_key(tenant_id), None)
    if _redis() is not None:
        invalidate_tenant_cache(str(tenant_id), CACHE_PREFIX)


# ── Per-viewer filter ────────────────────────────────────────────────────────

async def visible_to(db: AsyncSession, tenant_id: Any, user_id: Optional[str], role: str,
                     items: list[Item]) -> list[Item]:
    """The items this viewer may act on, in rank order, without internal fields. An item shows when its
    ``required_action`` is among the viewer's actions at Scope(system_id, module); admin items therefore need
    tenant-wide ``manage_users``, and a read-only viewer holds only ``view`` (``object_no_go``). Approvals leave
    out the viewer's own requests (four eyes)."""
    tid = uuid.UUID(str(tenant_id))
    grants = await user_grants(db, tid, user_id, role)
    # The informational No-go item needs a grant that really covers the object: users.role is the tenant-wide
    # baseline of every user (view), so it counts only for a user with no grant rows at all.
    own = await grants_for(db, user_id, tid, fallback_role=role) if user_id else [(role, Scope())]
    held: dict[str, set[str]] = {}
    for key, _ in [*grants, *own]:
        if key not in held:
            held[key] = await actions_for(key, tid, db)
    at: dict[tuple, set[str]] = {}
    out = []
    for it in items:
        try:
            scope = (uuid.UUID(it["system_id"]) if it["system_id"] else None, it["module"])
        except ValueError:
            continue
        use = own if it["kind"] == "object_no_go" else grants
        if (it["kind"] == "object_no_go", scope) not in at:
            at[(it["kind"] == "object_no_go", scope)] = set().union(
                *(held[k] for k, s in use if _scope_matches(s, Scope(*scope))))
        if it["required_action"] not in at[(it["kind"] == "object_no_go", scope)]:
            continue
        it = dict(it)
        if it["kind"] == "approvals" and user_id:
            it["count"] -= it["_by"].get(user_id, 0)
            if it["count"] <= 0:
                continue
            it["title"] = _approvals_title(it["count"], it["_label"], it["_golden"])
        out.append({k: v for k, v in it.items() if not k.startswith("_")})
    return out


def counts(items: list[Item]) -> dict[str, int]:
    return {s: sum(1 for i in items if i["severity"] == s) for s in SEVERITIES}
