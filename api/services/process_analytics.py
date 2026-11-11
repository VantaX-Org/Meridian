"""Governance process analytics: how change requests move through approval, where they wait, and which steps miss SLA.

Everything is counted from the change_requests and workflow_tasks rows; nothing is estimated. Cycle time runs from
submission to the SAP record being created; approval time from submission to the decision. A step's dwell runs from
the moment it became active to its decision. A task breaches its SLA when it was decided after its due time, or is
still pending past it. Percentiles are nearest-rank, so every figure shown is a real request or task.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

OPEN = ("submitted", "in_approval", "approved", "creating")
CLOSED = ("created", "rejected", "failed", "cancelled")
AGE_BUCKETS = (("lt_1d", 1), ("d1_3", 3), ("d3_7", 7), ("gt_7d", None))


def _hours(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    if a is None or b is None or b < a:
        return None
    return (b - a).total_seconds() / 3600


def percentile(values: Iterable[float], p: float) -> Optional[float]:
    """Nearest-rank percentile; None for no values."""
    xs = sorted(values)
    if not xs:
        return None
    return round(xs[max(0, math.ceil(p / 100 * len(xs)) - 1)], 2)


def _spread(values: list[float]) -> dict[str, Any]:
    return {"n": len(values), "median_hours": percentile(values, 50), "p90_hours": percentile(values, 90)}


def _rate(n: int, d: int) -> Optional[float]:
    return round(n / d, 4) if d else None


def analyse(requests: list[dict], tasks: list[dict], now: datetime) -> dict[str, Any]:
    """``requests``: id, object, kind, status, created_at, submitted_at, decided_at, completed_at.
    ``tasks``: request_id, step_name, step_index, status, activated_at, decided_at, due_at, sla_hours."""
    by_status: dict[str, int] = {}
    objects: dict[str, dict[str, Any]] = {}
    cycle: list[float] = []
    approval: list[float] = []
    for r in requests:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        o = objects.setdefault(r["object"], {"object": r["object"], "total": 0, "open": 0, "created": 0,
                                             "rejected": 0, "failed": 0, "cancelled": 0, "_cycle": []})
        o["total"] += 1
        if r["status"] in OPEN:
            o["open"] += 1
        elif r["status"] in CLOSED:
            o[r["status"]] += 1
        c = _hours(r.get("submitted_at"), r.get("completed_at")) if r["status"] == "created" else None
        if c is not None:
            cycle.append(c)
            o["_cycle"].append(c)
        a = _hours(r.get("submitted_at"), r.get("decided_at"))
        if a is not None:
            approval.append(a)

    closed = sum(by_status.get(s, 0) for s in CLOSED)
    per_object = []
    for o in sorted(objects.values(), key=lambda x: (-x["total"], x["object"])):
        cy = o.pop("_cycle")
        per_object.append({**o, "median_cycle_hours": percentile(cy, 50), "p90_cycle_hours": percentile(cy, 90)})

    steps: dict[str, dict[str, Any]] = {}
    with_sla = breached = 0
    for t in tasks:
        s = steps.setdefault(t["step_name"], {"step": t["step_name"], "index": t.get("step_index") or 0,
                                              "tasks": 0, "decided": 0, "pending": 0, "breached": 0,
                                              "overdue_open": 0, "_dwell": []})
        s["tasks"] += 1
        s["index"] = min(s["index"], t.get("step_index") or 0)
        d = _hours(t.get("activated_at"), t.get("decided_at"))
        if d is not None:
            s["_dwell"].append(d)
        if t.get("decided_at"):
            s["decided"] += 1
        elif t["status"] == "pending":
            s["pending"] += 1
        due = t.get("due_at")
        if due is None:
            continue
        with_sla += 1
        late = (t["decided_at"] > due) if t.get("decided_at") else (t["status"] == "pending" and now > due)
        if late:
            breached += 1
            s["breached"] += 1
            if not t.get("decided_at"):
                s["overdue_open"] += 1
    step_rows = []
    for s in sorted(steps.values(), key=lambda x: (x["index"], x["step"])):
        dw = s.pop("_dwell")
        step_rows.append({**s, "median_dwell_hours": percentile(dw, 50), "p90_dwell_hours": percentile(dw, 90)})
    ranked = [s for s in step_rows if s["median_dwell_hours"] is not None or s["breached"]]
    bottleneck = max(ranked, key=lambda s: (s["median_dwell_hours"] or 0, s["breached"]), default=None)

    aging = {k: 0 for k, _ in AGE_BUCKETS}
    for r in requests:
        if r["status"] not in OPEN:
            continue
        age = (_hours(r.get("submitted_at") or r["created_at"], now) or 0) / 24
        for k, limit in AGE_BUCKETS:
            if limit is None or age < limit:
                aging[k] += 1
                break

    weeks: dict[str, dict[str, Any]] = {}

    def _week(ts: datetime) -> str:
        return (ts - timedelta(days=ts.weekday())).date().isoformat()

    for r in requests:
        if r.get("submitted_at"):
            weeks.setdefault(_week(r["submitted_at"]), {"submitted": 0, "created": 0})["submitted"] += 1
        if r["status"] == "created" and r.get("completed_at"):
            weeks.setdefault(_week(r["completed_at"]), {"submitted": 0, "created": 0})["created"] += 1

    return {
        "total": len(requests),
        "by_status": dict(sorted(by_status.items())),
        "objects": per_object,
        "cycle": _spread(cycle),
        "approval": _spread(approval),
        "rates": {"closed": closed,
                  "rejection": _rate(by_status.get("rejected", 0), closed),
                  "failure": _rate(by_status.get("failed", 0), closed),
                  "cancellation": _rate(by_status.get("cancelled", 0), closed)},
        "sla": {"with_sla": with_sla, "breached": breached, "rate": _rate(breached, with_sla)},
        "steps": step_rows,
        "bottleneck": bottleneck["step"] if bottleneck else None,
        "aging": aging,
        "weekly": [{"week": w, **v} for w, v in sorted(weeks.items())],
    }
