"""Triage engine: rule-based auto-assignment, SLA timers on a business-hours calendar,
SLA state evaluation + escalation, and impact ranking.

Work items are rows of two existing tables, extended by migration 059:

  issue   record_issues      (one failing SAP record per check, tracked across runs)
  queue   stewardship_queue  (merge decisions, golden-record reviews, exceptions, ...)

Lifecycle
  1. auto_assign      unassigned, never-assigned items go through the ordered assignment
                      rules (first match wins) to a user or a team (round_robin or
                      least_loaded inside the team); no match / inactive target goes to the
                      tenant's fallback owner. Idempotent: only rows with assigned_at NULL.
  2. apply_sla        assigned items without a running clock get the policy's deadlines
                      (ack + resolve, with at-risk points), from the assignment time.
  3. sync_pause       waiting_sap / waiting_requester freeze the clock; leaving the
                      waiting status moves every deadline by the paused working time.
  4. evaluate         on_track / at_risk / breached per item; each notification
                      (at_risk, ack_breached, breached) fires once, recorded in sla_notified.

Notifications go to the in-app notifications table and to every callable in ALERT_HOOKS
(the alert-channel dispatcher registers itself there; nothing else needs to change).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text

logger = logging.getLogger("meridian.triage")

SEVERITIES = ("critical", "high", "medium", "low")
SEV_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1}
TERMINAL = ("resolved", "accepted")
WAITING = ("waiting_sap", "waiting_requester")
# org criteria read from the record key (BUKRS=1000|LIFNR=...)
ORG_FIELDS = {"company_code": "BUKRS", "plant": "WERKS", "sales_org": "VKORG"}
MATCH_KEYS = ("module", "check_id", "severity", "dimension", *ORG_FIELDS)
STRATEGIES = ("round_robin", "least_loaded")
# minutes, wall clock — used for a severity the tenant has no policy for
DEFAULT_POLICIES: dict[str, dict[str, Any]] = {
    "critical": {"ack_minutes": 240, "resolve_minutes": 1440},
    "high": {"ack_minutes": 480, "resolve_minutes": 4320},
    "medium": {"ack_minutes": 1440, "resolve_minutes": 10080},
    "low": {"ack_minutes": 4320, "resolve_minutes": 43200},
}

_TERM_SQL = "('resolved', 'accepted')"
_WAIT_SQL = "('waiting_sap', 'waiting_requester')"
_QUEUE_SEV = ("CASE WHEN sq.priority <= 1 THEN 'critical' WHEN sq.priority = 2 THEN 'high' "
              "WHEN sq.priority = 3 THEN 'medium' ELSE 'low' END")
TABLES = {"issue": "record_issues", "queue": "stewardship_queue"}
LINKS = {"issue": "/issues", "queue": "/stewardship"}
LABELS = {"issue": "record issue", "queue": "stewardship item"}

AlertHook = Callable[..., None]
# Called as hook(session, tenant_id=..., event=..., kind=..., user_id=..., item_ids=[...], title=..., body=...)
ALERT_HOOKS: list[AlertHook] = []


# ── business-hours calendar ───────────────────────────────────────────────────


@dataclass(frozen=True)
class Calendar:
    tz: str = "UTC"
    work_days: tuple[int, ...] = (1, 2, 3, 4, 5)  # ISO weekday, Monday = 1
    start: time = time(8)
    end: time = time(17)
    holidays: frozenset[date] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        ZoneInfo(self.tz)  # raises on an unknown zone
        if not self.work_days or any(d not in range(1, 8) for d in self.work_days):
            raise ValueError("work_days must be ISO weekdays 1..7, at least one")
        if self.start >= self.end:
            raise ValueError("work_start must be before work_end")

    def windows(self, frm: datetime) -> Iterable[tuple[datetime, datetime]]:
        """Working intervals in UTC from `frm` on. Local wall times are converted per day,
        so a DST change moves the UTC window, never the local opening hours."""
        z = ZoneInfo(self.tz)
        d = frm.astimezone(z).date()
        for _ in range(3700):  # ~10 years; a calendar with no working day at all is rejected above
            if d.isoweekday() in self.work_days and d not in self.holidays:
                a = datetime.combine(d, self.start, z).astimezone(UTC)
                b = datetime.combine(d, self.end, z).astimezone(UTC)
                if b > frm:
                    yield max(a, frm), b
            d += timedelta(days=1)

    def add(self, start: datetime, seconds: float) -> datetime:
        left = seconds
        for a, b in self.windows(start):
            span = (b - a).total_seconds()
            if left <= span:
                return a + timedelta(seconds=left)
            left -= span
        raise ValueError("calendar has no working time in range")

    def between(self, a: datetime, b: datetime) -> float:
        total = 0.0
        if b <= a:
            return total
        for x, y in self.windows(a):
            if x >= b:
                break
            total += (min(y, b) - x).total_seconds()
        return total


def add_time(cal: Optional[Calendar], start: datetime, seconds: float) -> datetime:
    return cal.add(start, seconds) if cal else start + timedelta(seconds=seconds)


def time_between(cal: Optional[Calendar], a: datetime, b: datetime) -> float:
    return cal.between(a, b) if cal else max(0.0, (b - a).total_seconds())


def deadlines(start: datetime, policy: dict, cal: Optional[Calendar]) -> dict[str, Optional[datetime]]:
    """ack/resolve due + at-risk points. `cal` applies only when the policy uses business hours."""
    c = cal if policy.get("business_hours") else None
    pct = policy.get("at_risk_pct") or 80

    def at(minutes: Optional[int], share: float = 100) -> Optional[datetime]:
        return None if minutes is None else add_time(c, start, minutes * 60 * share / 100)

    return {"ack_due_at": at(policy.get("ack_minutes")), "ack_risk_at": at(policy.get("ack_minutes"), pct),
            "due_at": at(policy["resolve_minutes"]), "risk_at": at(policy["resolve_minutes"], pct)}


def shift(ts: Optional[datetime], paused_at: datetime, now: datetime, cal: Optional[Calendar]) -> Optional[datetime]:
    """Deadline after a pause: the working time that was left at pause starts again at `now`."""
    if ts is None or ts <= paused_at:
        return ts
    return add_time(cal, now, time_between(cal, paused_at, ts))


def pick_policy(policies: dict, severity: str, module: Optional[str]) -> dict:
    return (policies.get((severity, module)) or policies.get((severity, None))
            or {**DEFAULT_POLICIES.get(severity, DEFAULT_POLICIES["low"]), "id": None,
                "at_risk_pct": 80, "business_hours": False})


# ── rule matching + assignment strategies ─────────────────────────────────────


def org_values(record_key: Optional[str]) -> dict[str, str]:
    parts = dict(p.split("=", 1) for p in (record_key or "").split("|") if "=" in p)
    return {k: parts[f] for k, f in ORG_FIELDS.items() if f in parts}


def rule_matches(match: dict, item: dict) -> bool:
    """Every criterion present in `match` (a value or list of values) must hold;
    an item without the attribute (e.g. no BUKRS in its key) does not match it."""
    for k in MATCH_KEYS:
        want = match.get(k)
        if want in (None, "", []):
            continue
        want = [want] if isinstance(want, str) else want
        have = item.get(k)
        if have is None or str(have).lower() not in {str(w).lower() for w in want}:
            return False
    return True


def first_match(rules: list[dict], item: dict) -> Optional[dict]:
    return next((r for r in rules if rule_matches(r.get("match") or {}, item)), None)


@dataclass
class Team:
    id: str
    strategy: str
    members: list[str]
    lead: Optional[str] = None
    cursor: int = 0


def choose(team: Team, active: set[str], load: dict[str, int]) -> Optional[str]:
    members = sorted(m for m in team.members if m in active)
    if not members:
        return team.lead if team.lead in active else None
    if team.strategy == "least_loaded":
        uid = min(members, key=lambda u: (load.get(u, 0), u))
    else:
        uid = members[team.cursor % len(members)]
        team.cursor += 1
    return uid


def plan(items: list[dict], rules: list[dict], teams: dict[str, Team], active: set[str],
         load: dict[str, int], fallback: Optional[str]) -> list[tuple[str, str, Optional[str], Optional[str]]]:
    """(item id, user, team, rule id) per item that has an owner. Mutates team cursors and load."""
    out = []
    for it in items:
        rule = first_match(rules, it)
        uid = team_id = None
        if rule:
            if rule.get("assign_user_id") in active:
                uid = rule["assign_user_id"]
            elif rule.get("assign_team_id") in teams:
                team_id = rule["assign_team_id"]
                uid = choose(teams[team_id], active, load)
        if uid is None:
            uid, team_id = (fallback if fallback in active else None), None
        if uid is None:
            continue
        load[uid] = load.get(uid, 0) + 1
        out.append((it["id"], uid, team_id, rule["id"] if rule else None))
    return out


# ── loaders ───────────────────────────────────────────────────────────────────


def load_settings(session, tid: str) -> dict:
    r = session.execute(text("SELECT timezone, work_days, work_start, work_end, holidays, fallback_user_id "
                             "FROM triage_settings WHERE tenant_id = CAST(:tid AS uuid)"), {"tid": tid}).fetchone()
    if not r:
        return {"calendar": Calendar(), "fallback": None}
    return {"calendar": Calendar(r.timezone, tuple(r.work_days), r.work_start, r.work_end, frozenset(r.holidays)),
            "fallback": str(r.fallback_user_id) if r.fallback_user_id else None}


def load_policies(session, tid: str) -> dict:
    rows = session.execute(text("SELECT id, severity, module, ack_minutes, resolve_minutes, at_risk_pct, "
                                "business_hours FROM sla_policies WHERE tenant_id = CAST(:tid AS uuid)"),
                           {"tid": tid}).fetchall()
    return {(r.severity, r.module): {**r._mapping, "id": str(r.id)} for r in rows}


def _ids(rows) -> list[str]:
    return [str(r) for r in rows]


# ── engine ────────────────────────────────────────────────────────────────────

# ponytail: per-run cap so a first run over a large backlog stays inside the task time limits; the
# 5-minute sweep drains the rest (most severe first). Raise it or loop in batches if that is too slow.
BATCH = 20000

_CANDIDATES = {
    "issue": f"""
        SELECT ri.id::text AS id, ri.module, ri.check_id, ri.severity, f.dimension, ri.record_key
          FROM record_issues ri
          LEFT JOIN LATERAL (SELECT f.dimension, f.affected_count FROM findings f WHERE f.version_id = ri.last_seen_version
                             AND f.check_id = ri.check_id AND f.tenant_id = ri.tenant_id LIMIT 1) f ON true
         WHERE ri.tenant_id = CAST(:tid AS uuid) AND ri.status NOT IN {_TERM_SQL}
           AND ri.assigned_at IS NULL AND ri.assigned_to IS NULL
         ORDER BY ri.severity = 'critical' DESC, ri.severity = 'high' DESC, ri.first_seen_at LIMIT :cap""",
    "queue": f"""
        SELECT sq.id::text AS id, sq.domain AS module, sq.item_type AS check_id, {_QUEUE_SEV} AS severity,
               NULL AS dimension, NULL AS record_key
          FROM stewardship_queue sq
         WHERE sq.tenant_id = CAST(:tid AS uuid) AND sq.status NOT IN {_TERM_SQL}
           AND sq.assigned_at IS NULL AND sq.assigned_to IS NULL
         ORDER BY sq.priority, sq.created_at LIMIT :cap""",
}

_LOAD_SQL = f"""
    SELECT assigned_to::text, COUNT(*) FROM (
        SELECT assigned_to FROM record_issues WHERE tenant_id = CAST(:tid AS uuid)
           AND assigned_to IS NOT NULL AND status NOT IN {_TERM_SQL}
        UNION ALL
        SELECT assigned_to FROM stewardship_queue WHERE tenant_id = CAST(:tid AS uuid)
           AND assigned_to IS NOT NULL AND status NOT IN {_TERM_SQL}) x
     GROUP BY 1"""


def load_teams(session, tid: str) -> dict[str, Team]:
    teams = {str(r.id): Team(str(r.id), r.strategy, [], str(r.lead_user_id) if r.lead_user_id else None,
                             r.rr_cursor)
             for r in session.execute(text("SELECT id, strategy, lead_user_id, rr_cursor FROM triage_teams "
                                           "WHERE tenant_id = CAST(:tid AS uuid)"), {"tid": tid})}
    for r in session.execute(text("SELECT team_id::text, user_id::text FROM triage_team_members "
                                  "WHERE tenant_id = CAST(:tid AS uuid)"), {"tid": tid}):
        if r[0] in teams:
            teams[r[0]].members.append(r[1])
    return teams


def active_users(session, tid: str) -> set[str]:
    return {r[0] for r in session.execute(text("SELECT id::text FROM users WHERE tenant_id = CAST(:tid AS uuid) "
                                               "AND is_active"), {"tid": tid})}


def write_assignments(session, tid: str, kind: str, rows: list[tuple], label: str = "system",
                      actor: Optional[str] = None, note: Optional[str] = None, only_unassigned: bool = True) -> int:
    """Set owner (+team, +rule) on items. Issues get an 'assign' event per changed row."""
    if not rows:
        return 0
    table = TABLES[kind]
    guard = "AND t.assigned_at IS NULL AND t.assigned_to IS NULL" if only_unassigned else \
        "AND t.assigned_to IS DISTINCT FROM x.uid"
    upd = f"""
        WITH x AS (SELECT * FROM unnest(CAST(:ids AS uuid[]), CAST(:users AS uuid[]), CAST(:teams AS uuid[]),
                                        CAST(:rules AS uuid[])) AS x(id, uid, team, rule)),
             old AS (SELECT t.id, t.assigned_to FROM {table} t JOIN x ON x.id = t.id
                      WHERE t.tenant_id = CAST(:tid AS uuid) FOR UPDATE OF t),
             upd AS (UPDATE {table} t SET assigned_to = x.uid, assigned_team_id = x.team, assigned_by_rule = x.rule,
                            assigned_at = now(), updated_at = now()
                       FROM x, old WHERE t.id = x.id AND old.id = x.id AND t.tenant_id = CAST(:tid AS uuid)
                        AND t.status NOT IN {_TERM_SQL} {guard}
                     RETURNING t.id, x.uid, x.rule, old.assigned_to AS prev)"""
    if kind == "issue":
        sql = upd + """
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value,
                                             to_value, note)
            SELECT CAST(:tid AS uuid), upd.id, CAST(:actor AS uuid), :label, 'assign', upd.prev::text,
                   upd.uid::text, COALESCE(:note, CASE WHEN r.name IS NOT NULL THEN 'auto-assigned by rule: ' || r.name
                                                      ELSE 'auto-assigned to fallback owner' END)
              FROM upd LEFT JOIN assignment_rules r ON r.id = upd.rule"""
    else:
        sql = upd + " SELECT COUNT(*) FROM upd"
    p = {"tid": tid, "ids": [r[0] for r in rows], "users": [r[1] for r in rows], "teams": [r[2] for r in rows],
         "rules": [r[3] for r in rows], "label": label, "actor": actor, "note": note}
    res = session.execute(text(sql), p)
    return res.rowcount if kind == "issue" else int(res.scalar() or 0)


def auto_assign(session, tid: str) -> dict[str, int]:
    """Route never-assigned open items through the rules. Safe to run any number of times."""
    session.execute(text("SELECT pg_advisory_xact_lock(hashtext('triage:' || :tid))"), {"tid": tid})
    rules = [{**r._mapping, "id": str(r.id),
              "assign_user_id": str(r.assign_user_id) if r.assign_user_id else None,
              "assign_team_id": str(r.assign_team_id) if r.assign_team_id else None}
             for r in session.execute(text(
                 "SELECT id, name, match, assign_user_id, assign_team_id FROM assignment_rules "
                 "WHERE tenant_id = CAST(:tid AS uuid) AND enabled ORDER BY position, created_at"), {"tid": tid})]
    settings = load_settings(session, tid)
    if not rules and not settings["fallback"]:
        return {"issue": 0, "queue": 0}
    teams, active = load_teams(session, tid), active_users(session, tid)
    load = {u: int(n) for u, n in session.execute(text(_LOAD_SQL), {"tid": tid})}
    out = {}
    for kind in TABLES:
        items = []
        for r in session.execute(text(_CANDIDATES[kind]), {"tid": tid, "cap": BATCH}):
            it = dict(r._mapping)
            it.update(org_values(it.pop("record_key")))
            items.append(it)
        out[kind] = write_assignments(session, tid, kind, plan(items, rules, teams, active, load,
                                                               settings["fallback"]))
    for t in teams.values():
        session.execute(text("UPDATE triage_teams SET rr_cursor = :c WHERE id = CAST(:id AS uuid) "
                             "AND rr_cursor <> :c"), {"c": t.cursor, "id": t.id})
    return out


_SEV_EXPR = {"issue": "t.severity", "queue": _QUEUE_SEV.replace("sq.", "t.")}
_MOD_EXPR = {"issue": "t.module", "queue": "t.domain"}


def apply_sla(session, tid: str, kind: Optional[str] = None, ids: Optional[list[str]] = None) -> dict[str, int]:
    """Start the clock on assigned items that have none. The start is the assignment time."""
    settings, policies = load_settings(session, tid), load_policies(session, tid)
    out = {}
    for k in ([kind] if kind else TABLES):
        flt = "AND t.id = ANY(CAST(:ids AS uuid[]))" if ids is not None else ""
        rows = session.execute(text(f"""
            SELECT t.id::text, {_SEV_EXPR[k]} AS severity, {_MOD_EXPR[k]} AS module,
                   COALESCE(t.assigned_at, now()) AS start
              FROM {TABLES[k]} t
             WHERE t.tenant_id = CAST(:tid AS uuid) AND t.assigned_to IS NOT NULL AND t.sla_started_at IS NULL
               AND t.status NOT IN {_TERM_SQL} {flt} LIMIT :cap"""), {"tid": tid, "ids": ids, "cap": BATCH}).fetchall()
        if not rows:
            out[k] = 0
            continue
        cache: dict[tuple, tuple] = {}
        cols: dict[str, list] = defaultdict(list)
        for r in rows:
            key = (r.severity, r.module, r.start)
            if key not in cache:
                pol = pick_policy(policies, r.severity, r.module)
                cache[key] = (pol, deadlines(r.start, pol, settings["calendar"]))
            pol, d = cache[key]
            cols["ids"].append(r.id)
            cols["start"].append(r.start)
            cols["pol"].append(pol["id"])
            cols["bh"].append(bool(pol.get("business_hours")))
            for c in ("ack_due_at", "ack_risk_at", "due_at", "risk_at"):
                cols[c].append(d[c])
        out[k] = session.execute(text(f"""
            UPDATE {TABLES[k]} t SET sla_started_at = x.start, sla_policy_id = x.pol, sla_business_hours = x.bh,
                   ack_due_at = x.ack_due, ack_risk_at = x.ack_risk, due_at = x.due, risk_at = x.risk,
                   sla_state = 'on_track', sla_notified = '{{}}', sla_paused_at = NULL
              FROM unnest(CAST(:ids AS uuid[]), CAST(:start AS timestamptz[]), CAST(:pol AS uuid[]),
                          CAST(:bh AS boolean[]), CAST(:ack_due_at AS timestamptz[]),
                          CAST(:ack_risk_at AS timestamptz[]), CAST(:due_at AS timestamptz[]),
                          CAST(:risk_at AS timestamptz[])) AS x(id, start, pol, bh, ack_due, ack_risk, due, risk)
             WHERE t.id = x.id AND t.tenant_id = CAST(:tid AS uuid) AND t.sla_started_at IS NULL
        """), {"tid": tid, **cols}).rowcount
        # a waiting item assigned before its clock started is paused from the start
        session.execute(text(f"UPDATE {TABLES[k]} t SET sla_paused_at = t.sla_started_at "
                             f"WHERE t.id = ANY(CAST(:ids AS uuid[])) AND t.status IN {_WAIT_SQL} "
                             f"AND t.sla_paused_at IS NULL"), {"ids": cols["ids"]})
    return out


def sync_pause(session, tid: str, kind: str, ids: list[str], now: Optional[datetime] = None) -> dict[str, int]:
    """Pause the clock of items now in a waiting status; resume (shift deadlines) for items that left it."""
    table = TABLES[kind]
    p = {"tid": tid, "ids": ids}
    paused = session.execute(text(f"""
        UPDATE {table} SET sla_paused_at = COALESCE(CAST(:now AS timestamptz), now())
         WHERE tenant_id = CAST(:tid AS uuid) AND id = ANY(CAST(:ids AS uuid[])) AND status IN {_WAIT_SQL}
           AND sla_paused_at IS NULL AND sla_started_at IS NOT NULL"""), {**p, "now": now}).rowcount
    rows = session.execute(text(f"""
        SELECT id::text, sla_paused_at, sla_business_hours, ack_due_at, ack_risk_at, due_at, risk_at,
               COALESCE(CAST(:now AS timestamptz), now()) AS now
          FROM {table} WHERE tenant_id = CAST(:tid AS uuid) AND id = ANY(CAST(:ids AS uuid[]))
           AND sla_paused_at IS NOT NULL AND status NOT IN {_WAIT_SQL} FOR UPDATE"""), {**p, "now": now}).fetchall()
    if rows:
        cal = load_settings(session, tid)["calendar"]
        cols: dict[str, list] = defaultdict(list)
        for r in rows:
            c = cal if r.sla_business_hours else None
            cols["rids"].append(r.id)
            for col in ("ack_due_at", "ack_risk_at", "due_at", "risk_at"):
                cols[col].append(shift(getattr(r, col), r.sla_paused_at, r.now, c))
        session.execute(text(f"""
            UPDATE {table} t SET ack_due_at = x.a, ack_risk_at = x.b, due_at = x.c, risk_at = x.d,
                   sla_paused_at = NULL
              FROM unnest(CAST(:rids AS uuid[]), CAST(:ack_due_at AS timestamptz[]),
                          CAST(:ack_risk_at AS timestamptz[]), CAST(:due_at AS timestamptz[]),
                          CAST(:risk_at AS timestamptz[])) AS x(id, a, b, c, d)
             WHERE t.id = x.id AND t.tenant_id = CAST(:tid AS uuid)"""), {"tid": tid, **cols})
    return {"paused": paused, "resumed": len(rows)}


STATE_SQL = """CASE WHEN now() >= t.due_at OR (t.acknowledged_at IS NULL AND now() >= t.ack_due_at) THEN 'breached'
                    WHEN now() >= t.risk_at OR (t.acknowledged_at IS NULL AND now() >= t.ack_risk_at) THEN 'at_risk'
                    ELSE 'on_track' END"""
_LIVE = f"t.tenant_id = CAST(:tid AS uuid) AND t.sla_started_at IS NOT NULL AND t.sla_paused_at IS NULL " \
        f"AND t.status NOT IN {_TERM_SQL}"
# event -> condition; each fires once per item (sla_notified), reset when the clock restarts
EVENTS = {
    "at_risk": "now() >= t.risk_at AND now() < t.due_at",
    "ack_breached": "t.acknowledged_at IS NULL AND now() >= t.ack_due_at",
    "breached": "now() >= t.due_at",
}


def notify(session, tid: str, user_id: str, event: str, kind: str, item_ids: list[str]) -> None:
    from api.services.notifications import create_notification_sync

    n, what = len(item_ids), LABELS[kind] + ("s" if len(item_ids) != 1 else "")
    title = {"at_risk": f"{n} {what} at risk of breaching SLA",
             "ack_breached": f"{n} {what} not acknowledged within SLA",
             "breached": f"{n} {what} breached SLA"}[event]
    body = "Open your triage queue to act on them."
    create_notification_sync(tid, user_id, f"sla_{event}", title, body, LINKS[kind], session)
    for hook in ALERT_HOOKS:
        try:
            with session.begin_nested():
                hook(session, tenant_id=tid, event=event, kind=kind, user_id=user_id, item_ids=item_ids,
                     title=title, body=body)
        except Exception:  # an alert channel must never stop the SLA sweep
            logger.exception("triage alert hook failed")


def evaluate(session, tid: str) -> dict[str, Any]:
    """Refresh SLA states, fire at-risk/breach notifications once, escalate breaches, expire snoozes."""
    fallback = load_settings(session, tid)["fallback"]
    leads = {str(r[0]): str(r[1]) for r in session.execute(text(
        "SELECT id, lead_user_id FROM triage_teams WHERE tenant_id = CAST(:tid AS uuid) "
        "AND lead_user_id IS NOT NULL"), {"tid": tid})}
    out: dict[str, Any] = {"states": {}, "notified": {}}
    for kind, table in TABLES.items():
        session.execute(text(f"UPDATE {table} t SET snoozed_until = NULL, snooze_reason = NULL "
                             f"WHERE t.tenant_id = CAST(:tid AS uuid) AND t.snoozed_until <= now()"), {"tid": tid})
        out["states"][kind] = session.execute(text(
            f"UPDATE {table} t SET sla_state = {STATE_SQL} WHERE {_LIVE} AND t.sla_state IS DISTINCT FROM {STATE_SQL}"),
            {"tid": tid}).rowcount
        for event, cond in EVENTS.items():
            hits = session.execute(text(f"""
                UPDATE {table} t SET sla_notified = array_append(t.sla_notified, :ev)
                 WHERE {_LIVE} AND NOT (:ev = ANY(t.sla_notified)) AND {cond}
                RETURNING t.id::text, t.assigned_to::text, t.assigned_team_id::text"""),
                {"tid": tid, "ev": event}).fetchall()
            out["notified"][f"{kind}:{event}"] = len(hits)
            if not hits:
                continue
            by_user: dict[str, list[str]] = defaultdict(list)
            escalated: list[tuple[str, str]] = []
            for item_id, owner, team in hits:
                if owner:
                    by_user[owner].append(item_id)
                if event != "at_risk":
                    boss = leads.get(team or "") or fallback
                    if boss and boss != owner:
                        by_user[boss].append(item_id)
                        escalated.append((item_id, boss))
            for uid, ids in by_user.items():
                notify(session, tid, uid, event, kind, ids)
            if kind == "issue":
                session.execute(text("""
                    INSERT INTO record_issue_events (tenant_id, issue_id, user_label, action, to_value, note)
                    SELECT CAST(:tid AS uuid), x.id, 'system', :action, x.boss, :note
                      FROM unnest(CAST(:ids AS uuid[]), CAST(:boss AS text[])) AS x(id, boss)"""),
                    {"tid": tid, "action": f"sla_{event}",
                     "ids": [h[0] for h in hits], "boss": [dict(escalated).get(h[0]) for h in hits],
                     "note": "escalated to team lead / fallback owner" if event != "at_risk" else None})
    return out


def run_tenant(session, tid: str) -> dict[str, Any]:
    """Everything the beat task does for one tenant."""
    return {"assigned": auto_assign(session, tid), "sla_started": apply_sla(session, tid),
            **evaluate(session, tid)}


# ── ranking + queue ───────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def blocked_features() -> dict[str, int]:
    """check_id -> number of SAP features it fully blocks (config impact rules)."""
    try:
        from agents.config_impact import _load_impact_rules
        rules = _load_impact_rules()
    except Exception:  # config impact model unavailable → ranking falls back to severity × records
        logger.exception("config impact rules unavailable")
        return {}
    return {cid: n for cid, rs in rules.items() if (n := sum(r.get("impact_type") == "full_block" for r in rs))}


# One row per work item across both tables; :tid and :blocks (jsonb) are bound by the caller.
# impact = severity weight × records affected by the check × (1 + features it blocks).
# rank   = impact × (1 + 2 × share of the resolve window already used), so urgency lifts items.
# ponytail: urgency uses wall-clock elapsed share even on business-hours policies; exact
# business-time share would need the calendar in SQL.
ITEMS_SQL = f"""
    WITH items AS (
        SELECT 'issue' AS kind, ri.id, ri.module, ri.check_id, ri.severity, ri.status, ri.record_key AS ref,
               ri.assigned_to, ri.assigned_team_id, ri.assigned_by_rule,
               COALESCE(ri.priority, CASE ri.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                                                      WHEN 'medium' THEN 3 ELSE 4 END) AS priority,
               ri.sla_state, ri.sla_started_at, ri.acknowledged_at, ri.ack_due_at, ri.due_at, ri.risk_at,
               ri.sla_paused_at, ri.snoozed_until, ri.snooze_reason, ri.first_seen_at AS created_at,
               ri.resolved_at, COALESCE(f.affected_count, 1) AS affected
          FROM record_issues ri
          LEFT JOIN LATERAL (SELECT f.dimension, f.affected_count FROM findings f WHERE f.version_id = ri.last_seen_version
                             AND f.check_id = ri.check_id AND f.tenant_id = ri.tenant_id LIMIT 1) f ON true
         WHERE ri.tenant_id = CAST(:tid AS uuid)
        UNION ALL
        SELECT 'queue', sq.id, sq.domain, sq.item_type, {_QUEUE_SEV}, sq.status, sq.source_id::text,
               sq.assigned_to, sq.assigned_team_id, sq.assigned_by_rule, sq.priority,
               sq.sla_state, sq.sla_started_at, sq.acknowledged_at, sq.ack_due_at, sq.due_at, sq.risk_at,
               sq.sla_paused_at, sq.snoozed_until, sq.snooze_reason, sq.created_at, sq.resolved_at, 1
          FROM stewardship_queue sq
         WHERE sq.tenant_id = CAST(:tid AS uuid)
    ), ranked AS (
        SELECT i.*,
               (CASE i.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
                 * GREATEST(i.affected, 1)
                 * (1 + COALESCE((CAST(:blocks AS jsonb) ->> i.check_id)::int, 0)) AS impact,
               CASE WHEN i.due_at IS NULL OR i.sla_started_at IS NULL THEN 0
                    ELSE LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM now() - i.sla_started_at)
                         / NULLIF(EXTRACT(EPOCH FROM i.due_at - i.sla_started_at), 0))) END AS urgency
          FROM items i
    )
    SELECT r.*, round((r.impact * (1 + 2 * r.urgency))::numeric, 2) AS rank_score FROM ranked r
"""
