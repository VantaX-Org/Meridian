"""The escalation chain after an SLA breach (migration 104).

The SLA sweep (api/services/triage.py evaluate) already tells the assignee and the team lead (or the fallback owner)
once an item breaches. The chain adds later levels: level n notifies its target once the item is ``after_minutes``
past its due time. Each level fires once per item (``esc<n>`` in sla_notified, the same once-only marker the sweep
uses) and the marker is cleared with the others when the clock restarts, so the step is idempotent and safe to run
every five minutes.

  validate_chain()  the rules a chain must follow (levels 1..n in order, minutes rising, a user for a user target)
  target_of()       who one level notifies for one item
  escalate_chain()  the worker step, called from triage.run_tenant
"""
from __future__ import annotations

from collections import defaultdict
from itertools import pairwise
from typing import Any

from sqlalchemy import text

TARGETS = ("team_lead", "fallback", "user")
MAX_LEVELS = 5


def validate_chain(steps: list[dict[str, Any]]) -> list[str]:
    """Problems with a chain, as sentences; empty when it is valid."""
    errors: list[str] = []
    if len(steps) > MAX_LEVELS:
        errors.append(f"A chain has at most {MAX_LEVELS} levels.")
    levels = [s.get("level") for s in steps]
    if levels != list(range(1, len(steps) + 1)):
        errors.append("Levels must run 1, 2, 3 in order with no gap.")
    minutes = [s.get("after_minutes") for s in steps]
    if any(not isinstance(m, int) or m < 0 for m in minutes):
        errors.append("Minutes after the due time must be zero or more.")
    elif any(b <= a for a, b in pairwise(minutes)):
        errors.append("Each level must come later than the one before it.")
    for s in steps:
        if s.get("target") not in TARGETS:
            errors.append(f"Level {s.get('level')}: the target must be the team lead, the fallback owner or a person.")
        elif s["target"] == "user" and not s.get("user_id"):
            errors.append(f"Level {s.get('level')}: choose the person to notify.")
    return errors


def target_of(step: dict[str, Any], team: str | None, leads: dict[str, str], fallback: str | None) -> str | None:
    """The user a level notifies about one item: the named person, the item's team lead, or the fallback owner."""
    if step["target"] == "user":
        return str(step["user_id"]) if step.get("user_id") else None
    if step["target"] == "team_lead":
        return leads.get(team or "") or fallback
    return fallback


def load_chain(session, tid: str) -> list[dict[str, Any]]:
    return [dict(r._mapping) for r in session.execute(text(
        "SELECT level, after_minutes, target, user_id::text AS user_id FROM escalation_steps "
        "WHERE tenant_id = CAST(:tid AS uuid) ORDER BY level"), {"tid": tid})]


def escalate_chain(session, tid: str) -> dict[str, int]:
    """Fire every chain level that is due; returns {"<kind>:esc<n>": items} for the levels that fired."""
    from api.services.notifications import create_notification_sync
    from api.services.triage import _LIVE, LABELS, LINKS, TABLES, load_settings

    chain = load_chain(session, tid)
    if not chain:
        return {}
    fallback = load_settings(session, tid)["fallback"]
    leads = {str(r[0]): str(r[1]) for r in session.execute(text(
        "SELECT id, lead_user_id FROM triage_teams WHERE tenant_id = CAST(:tid AS uuid) AND lead_user_id IS NOT NULL"),
        {"tid": tid})}
    out: dict[str, int] = {}
    for kind, table in TABLES.items():
        for step in chain:
            marker = f"esc{step['level']}"
            hits = session.execute(text(f"""
                UPDATE {table} t SET sla_notified = array_append(t.sla_notified, :ev)
                 WHERE {_LIVE} AND NOT (:ev = ANY(t.sla_notified))
                   AND t.due_at IS NOT NULL AND now() >= t.due_at + make_interval(mins => :after)
                RETURNING t.id::text, t.assigned_to::text, t.assigned_team_id::text"""),
                {"tid": tid, "ev": marker, "after": int(step["after_minutes"])}).fetchall()
            if not hits:
                continue
            out[f"{kind}:{marker}"] = len(hits)
            by_user: dict[str, list[str]] = defaultdict(list)
            for item_id, owner, team in hits:
                who = target_of(step, team, leads, fallback)
                if who and who != owner:
                    by_user[who].append(item_id)
            for uid, ids in by_user.items():
                n = len(ids)
                what = LABELS[kind] + ("s" if n != 1 else "")
                create_notification_sync(
                    tid, uid, "escalation", f"Escalation level {step['level']}: {n} {what} past due",
                    f"{n} {what} passed the due time by {step['after_minutes']} minutes or more without being resolved.",
                    LINKS[kind], session)
    return out
