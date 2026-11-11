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


MIN_HISTORY = 3  # fewer matching decided tasks than this and the forecast falls back to the step alone
EVIDENCE_CAP = 50


def forecast(requests: list[dict], tasks: list[dict], history: list[dict], now: datetime) -> dict[str, Any]:
    """Approval ETA and SLA-breach forecast for every open change request, from the tenant's own decided tasks.

    ``requests``: id, title, object, kind, status, object_key, instance_id (open requests only).
    ``tasks``: the workflow tasks of their instances (instance_id, step_index, step_name, status, sla_hours, due_at,
    activated_at, decided_at). ``history``: decided tasks (request_id, title, object, kind, step_name, activated_at,
    decided_at).

    The pending task of a request is compared with decided tasks of the same object, kind and step name; with fewer
    than ``MIN_HISTORY`` of those, with every decided task of that step name (``basis`` says which). Of that history only
    the tasks that were still undecided at the pending task's current age are kept, so the forecast is conditional on
    the time already waited (``conditioned``); when none waited that long the whole history is used. ETA is the
    activation time plus the nearest-rank P50 dwell, the P90 ETA likewise. Breach probability is the share of that
    history whose dwell exceeded the task's SLA hours, or 1 when the due time has already passed. Each waiting step after
    this one carries its own historical P50, and the request's ETA is the step ETA plus their sum (None when a later step
    has no history). Every row names the historical tasks the figure came from.
    """
    def key(t: dict) -> tuple:
        return (t["object"], t["kind"], t["step_name"])

    by_full: dict[tuple, list[dict]] = {}
    by_step: dict[str, list[dict]] = {}
    for h in history:
        d = _hours(h.get("activated_at"), h.get("decided_at"))
        if d is None:
            continue
        h = {**h, "dwell": d}
        by_full.setdefault(key(h), []).append(h)
        by_step.setdefault(h["step_name"], []).append(h)

    def pool(obj: str, kind: str, step: str) -> tuple[str, list[dict]]:
        full = by_full.get((obj, kind, step), [])
        if len(full) >= MIN_HISTORY:
            return "object_kind_step", full
        if by_step.get(step):
            return "step", by_step[step]
        return "none", []

    per_instance: dict[str, list[dict]] = {}
    for t in tasks:
        per_instance.setdefault(t["instance_id"], []).append(t)

    rows: list[dict] = []
    without_pending = 0
    for r in requests:
        ts = sorted(per_instance.get(r.get("instance_id") or "", []), key=lambda t: t.get("step_index") or 0)
        cur = next((t for t in ts if t["status"] == "pending"), None)
        if cur is None:
            without_pending += 1
            continue
        basis, hist = pool(r["object"], r["kind"], cur["step_name"])
        started = cur.get("activated_at") or now
        elapsed = _hours(started, now) or 0.0
        survivors = [h for h in hist if h["dwell"] > elapsed]
        used = survivors or hist
        dw = [h["dwell"] for h in used]
        p50, p90 = percentile(dw, 50), percentile(dw, 90)
        due, sla = cur.get("due_at"), cur.get("sla_hours")
        if due is not None and now > due:
            prob, breached = 1.0, True
        else:
            breached = False
            prob = _rate(sum(1 for d in dw if d > sla), len(dw)) if sla is not None else None
        eta = started + timedelta(hours=p50) if p50 is not None else None
        remaining = []
        for t in ts:
            if t["status"] != "waiting" or (t.get("step_index") or 0) <= (cur.get("step_index") or 0):
                continue
            b, h2 = pool(r["object"], r["kind"], t["step_name"])
            remaining.append({"step": t["step_name"], "index": t.get("step_index") or 0, "basis": b, "n": len(h2),
                              "p50_hours": percentile([h["dwell"] for h in h2], 50), "sla_hours": t.get("sla_hours")})
        rest = [s["p50_hours"] for s in remaining]
        full_eta = eta + timedelta(hours=sum(rest)) if eta is not None and None not in rest else None
        rows.append({
            "request_id": r["id"], "title": r.get("title"), "object": r["object"], "kind": r["kind"],
            "status": r["status"], "object_key": r.get("object_key"),
            "step": cur["step_name"], "step_index": cur.get("step_index") or 0,
            "activated_at": cur.get("activated_at"), "due_at": due, "sla_hours": sla,
            "elapsed_hours": round(elapsed, 2), "basis": basis, "conditioned": bool(survivors), "n": len(used),
            "p50_hours": p50, "p90_hours": p90, "eta": eta,
            "p90_eta": started + timedelta(hours=p90) if p90 is not None else None,
            "breach_probability": prob, "breached": breached, "remaining": remaining, "request_eta": full_eta,
            "evidence": [{"request_id": h["request_id"], "title": h.get("title"), "dwell_hours": round(h["dwell"], 2),
                          "decided_at": h["decided_at"]}
                         for h in sorted(used, key=lambda h: h["decided_at"], reverse=True)[:EVIDENCE_CAP]],
        })
    rows.sort(key=lambda x: (-(x["breach_probability"] or 0), x["eta"] or now))
    return {"requests": rows, "open": len(requests), "without_pending": without_pending,
            "at_risk": sum(1 for x in rows if (x["breach_probability"] or 0) >= 0.5),
            "breached": sum(x["breached"] for x in rows)}
