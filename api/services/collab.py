"""Comments, mentions, watches and per-event subscriptions (migration 104, docs/roles-and-features.md).

Everything that decides *who hears about what* is a pure function here, so the routes and the worker share one
answer and the tests can pin it without a database:

  EVENTS              the event kinds a person can subscribe to, with their label and default
  wants()             does a person's subscription row (or the default) let an event through
  run_events()        the watch events a finished run raises against the run before it: run finished, score dropped,
                      a new critical breach (deterministic: composite scores and capping rule ids from dqs_summary)
  mention_tokens()    the ``@`` handles written in a comment body (the ids come from the client's picker; the server
                      keeps only active users of the tenant)

Writers (sync, for the worker; the routes have their async twins in api/routes/collab.py):

  notify_watchers_sync()  one notification per watcher of a target whose subscription lets the event through
  fire_run_events()       run_events() for one analysis version, notified to the watchers of each object and rule
"""
from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Mapping
from typing import Any, Optional

from sqlalchemy import text

logger = logging.getLogger("meridian.collab")

# event -> (label, default on). The labels are what the preferences panel lists.
EVENTS: dict[str, tuple[str, bool]] = {
    "mention": ("Someone mentions you in a comment", True),
    "comment": ("A comment on something you watch", True),
    "run_finished": ("A run finishes on an object you watch", True),
    "score_dropped": ("The score of an object you watch drops", True),
    "critical_breach": ("A new critical breach on an object or rule you watch", True),
    "batch_waiting": ("A fix batch you watch waits for approval", True),
    "delegated": ("Work routed to you while someone is out of office", True),
}
WATCH_EVENTS: tuple[str, ...] = ("comment", "run_finished", "score_dropped", "critical_breach", "batch_waiting")
TARGET_KINDS: tuple[str, ...] = ("record", "rule", "batch", "object", "system", "contract", "wave")
COMMENT_KINDS: tuple[str, ...] = ("record", "rule", "batch", "contract", "wave", "object")

_MENTION = re.compile(r"(?<![\w.])@([A-Za-z0-9][\w.\-]{0,63})")


def wants(event: str, row: bool | None) -> bool:
    """True when a person hears about ``event``: their own choice when they made one, else the event's default."""
    if event not in EVENTS:
        return False
    return EVENTS[event][1] if row is None else bool(row)


def mention_tokens(body: str) -> list[str]:
    """The ``@handle`` tokens of a comment body, in order, once each (an e-mail address is not a mention)."""
    return list(dict.fromkeys(m.group(1).rstrip(".-") for m in _MENTION.finditer(body or "")))


def link_for(kind: str, target_id: str) -> str:
    """Where a notification about a target opens: its canvas, with the target in the inspector."""
    if kind == "object":
        system, _, module = target_id.partition(":")
        return f"/o/{system}/{module}" if module else "/"
    if kind == "system":
        return f"/?open=system:{target_id}"
    if kind == "wave":
        return "/?open=waves"
    if kind == "contract":
        return f"/?open=contract:{target_id}"
    return f"/?open={kind}:{target_id}"


def _score(summary: Mapping[str, Any]) -> float | None:
    s = summary.get("composite_score")
    return float(s) if isinstance(s, (int, float)) else None


def _criticals(summary: Mapping[str, Any]) -> set[str]:
    from api.services.receipt_math import breach_ids

    return set(breach_ids(dict(summary)))


def run_events(current: Mapping[str, Any], previous: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The watch events of one run, per module of ``current`` (a dqs_summary): always ``run_finished``; ``score_dropped``
    when the composite score is lower than in ``previous`` (the module's summary in the run before it, if any); and
    one ``critical_breach`` per capping rule that was not capping before. Sorted by module, then event."""
    out: list[dict[str, Any]] = []
    for module in sorted(k for k, v in current.items() if isinstance(v, Mapping)):
        cur, prev = current[module], previous.get(module) if isinstance(previous.get(module), Mapping) else None
        score = _score(cur)
        out.append({"module": module, "event": "run_finished", "score": score})
        if prev is not None:
            before = _score(prev)
            if score is not None and before is not None and score < before:
                out.append({"module": module, "event": "score_dropped", "score": score, "before": before,
                            "delta": round(score - before, 1)})
        for cid in sorted(_criticals(cur) - (_criticals(prev) if prev is not None else set())):
            out.append({"module": module, "event": "critical_breach", "check_id": cid})
    return out


def _sentence(e: Mapping[str, Any], label: str) -> tuple[str, str]:
    if e["event"] == "score_dropped":
        return (f"{label} dropped {abs(e['delta']):.1f} points to {e['score']:.1f}",
                f"The score was {e['before']:.1f} in the run before.")
    if e["event"] == "critical_breach":
        return f"New critical breach on {label}: {e['check_id']}", "The rule is over tolerance and caps the score."
    score = "no score" if e.get("score") is None else f"score {e['score']:.1f}"
    return f"Run finished on {label}: {score}", "The analysis of an object you watch has finished."


def notify_watchers_sync(session, tenant_id: str, event: str, targets: Iterable[tuple[str, str]], title: str,
                         body: str, link: str | None, skip_user: str | None = None) -> int:
    """One notification per user watching any of ``targets`` for ``event`` (a person is told once even when they
    watch several of the targets), unless their subscription turns the event off. Returns how many were written."""
    from api.services.notifications import create_notification_sync

    pairs = list(dict.fromkeys(targets))
    if not pairs:
        return 0
    rows = session.execute(text("""
        SELECT DISTINCT w.user_id, s.enabled
          FROM watches w
          JOIN unnest(CAST(:kinds AS text[]), CAST(:ids AS text[])) AS x(kind, id)
            ON x.kind = w.target_kind AND x.id = w.target_id
          LEFT JOIN notification_subscriptions s
            ON s.tenant_id = w.tenant_id AND s.user_id = w.user_id AND s.event = :ev
         WHERE w.tenant_id = CAST(:t AS uuid) AND (:ev = ANY(w.events) OR cardinality(w.events) = 0)"""),
        {"t": tenant_id, "kinds": [k for k, _ in pairs], "ids": [i for _, i in pairs], "ev": event}).fetchall()
    sent = 0
    for uid, enabled in rows:
        if uid == skip_user or not wants(event, enabled) or not _is_uuid(uid):
            continue
        create_notification_sync(tenant_id, uid, event, title, body, link, session)
        sent += 1
    return sent


def _is_uuid(v: object) -> bool:
    import uuid

    try:
        uuid.UUID(str(v))
    except ValueError:
        return False
    return True


def fire_run_events(session, tenant_id: str, version_id: str) -> int:
    """Notify the watchers of each object, its system and each newly breached rule about a finished run. Compares
    with the latest earlier finished run of the same system that measured the module. Never raises: a watch
    notification must not fail an analysis."""
    try:
        with session.begin_nested():
            return _fire_run_events(session, tenant_id, version_id)
    except Exception:
        logger.exception("watch notifications failed for version %s", version_id)
        return 0


def _fire_run_events(session, tenant_id: str, version_id: str) -> int:
    from api.routes.objects import _label

    row = session.execute(text(
        "SELECT dqs_summary, metadata->>'system_id', run_at FROM analysis_versions "
        "WHERE id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)"), {"v": version_id, "t": tenant_id}).fetchone()
    if not row or not isinstance(row[0], dict):
        return 0
    current, sid, run_at = row[0], row[1], row[2]
    previous: dict[str, Any] = {}
    for module in [m for m, v in current.items() if isinstance(v, dict)]:
        prev = session.execute(text("""
            SELECT dqs_summary->:m FROM analysis_versions
             WHERE tenant_id = CAST(:t AS uuid) AND id <> CAST(:v AS uuid) AND run_at < :at
               AND status = 'complete' AND dqs_summary ? :m
               AND (CAST(:sid AS text) IS NULL OR metadata->>'system_id' = CAST(:sid AS text))
             ORDER BY run_at DESC LIMIT 1"""),
            {"t": tenant_id, "v": version_id, "at": run_at, "m": module, "sid": sid}).scalar()
        if isinstance(prev, dict):
            previous[module] = prev
    sent = 0
    for e in run_events(current, previous):
        label = _label(e["module"])
        targets = [("object", f"{sid}:{e['module']}")] if sid else []
        targets.append(("object", e["module"]))
        if sid:
            targets.append(("system", sid))
        if e["event"] == "critical_breach":
            targets.append(("rule", e["check_id"]))
        title, body = _sentence(e, label)
        sent += notify_watchers_sync(session, tenant_id, e["event"], targets, title, body,
                                     link_for("object", f"{sid}:{e['module']}") if sid else "/")
    return sent


def notify_batch_waiting_sync(session, tenant_id: str, batch_id: str, name: str, modules: Iterable[str],
                              author: Optional[str]) -> int:
    """A new fix batch waits for approval: tell the watchers of its objects (and of the batch). Never raises."""
    try:
        with session.begin_nested():
            targets = [("object", m) for m in sorted(set(modules))] + [("batch", batch_id)]
            return notify_watchers_sync(session, tenant_id, "batch_waiting", targets,
                                        f"Fix batch {name} waits for approval",
                                        "A steward built a fix batch on an object you watch.",
                                        link_for("batch", batch_id), skip_user=author)
    except Exception:
        logger.exception("batch waiting notifications failed for batch %s", batch_id)
        return 0
