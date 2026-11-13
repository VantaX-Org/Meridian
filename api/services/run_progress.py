"""Truthful progress for a running job, read from the job record (api/services/jobs.py) alone.

A percentage is given only where both what is done and the total are known. Where the total is unknown the
answer is indeterminate (pct None), never an invented number. The estimate of time left comes from the rate
observed so far, is labelled an estimate, and is held back for the first minute while that rate means little.

No worker writes anything new for this: extraction already records per-table rows and SAP's own counts, analysis
records its rule counter in the step text, and every update refreshes updated_at, which serves as the heartbeat.
"""

from __future__ import annotations

import re
import time
from typing import Any, Optional

STALL_AFTER_S = 300  # no update for 5 minutes on a running job: stalled (analysis beats every 30 s)
ETA_AFTER_S = 60     # no estimate before a minute of observed rate
SETTLE_S = 120       # a finished run stays on the live list this long, so its card can show how it ended
ACTIVE = ("queued", "running")
_RULE = re.compile(r"rule (\d+)/(\d+)")
_TABLE_ACTIVE = ("queued", "running")


def ratio(done: Any, total: Any) -> Optional[float]:
    """done/total as a percent clamped to 0..100, or None when the total is unknown or zero."""
    try:
        d, t = float(done or 0), float(total or 0)
    except (TypeError, ValueError):
        return None
    if t <= 0:
        return None
    return round(max(0.0, min(100.0, 100.0 * d / t)), 1)


def _step(job: dict) -> dict:
    """What the current stage has done: rows of tables, rules of checks, or nothing known."""
    tables = job.get("tables") or []
    if job.get("kind") == "extraction" and job.get("stage") == "read" and tables:
        rows = sum(int(t.get("rows") or 0) for t in tables)
        if all(t.get("expected") is not None for t in tables):
            total = sum(int(t["expected"] or 0) for t in tables)
            pct = ratio(rows, total)
            if pct is not None:
                return {"unit": "rows", "done": rows, "total": total, "pct": pct}
        done = sum(1 for t in tables if t.get("status") not in _TABLE_ACTIVE)
        return {"unit": "tables", "done": done, "total": len(tables), "pct": ratio(done, len(tables)), "rows": rows}
    m = _RULE.search(job.get("message") or "")
    if m:
        d, t = int(m.group(1)), int(m.group(2))
        return {"unit": "rules", "done": d, "total": t, "pct": ratio(d, t)}
    total = job.get("rows_total") or 0
    if total > 0:
        return {"unit": "rows", "done": int(job.get("rows_done") or 0), "total": int(total), "pct": ratio(job.get("rows_done"), total)}
    return {"unit": None, "done": int(job.get("rows_done") or 0), "total": None, "pct": None}


def _parts(job: dict) -> list[dict]:
    """One part per table (extraction) with its own percent where SAP gave a count."""
    out = []
    for t in job.get("tables") or []:
        st = t.get("status") or "queued"
        state = "queued" if st == "queued" else "running" if st == "running" else "failed" if st == "failed" else "done"
        exp = t.get("expected")
        pct = 100.0 if state == "done" else ratio(t.get("rows"), exp)
        out.append({"name": t.get("table"), "state": state, "status": st, "done": int(t.get("rows") or 0),
                    "total": exp, "pct": pct})
    return out


def is_live(job: dict, now: Optional[float] = None) -> bool:
    """Queued or running, or finished within the last SETTLE_S seconds."""
    if (job.get("status") or "queued") in ACTIVE:
        return True
    now = time.time() if now is None else now
    return float(job.get("finished_at") or job.get("updated_at") or 0) >= now - SETTLE_S


def compute_progress(job: dict, now: Optional[float] = None) -> dict:
    now = time.time() if now is None else now
    status = job.get("status") or "queued"
    started = float(job.get("started_at") or now)
    updated = float(job.get("updated_at") or started)
    end = float(job.get("finished_at") or 0) or (now if status in ACTIVE else updated)
    elapsed = max(0.0, end - started)
    idle = max(0.0, now - updated)
    state = "stalled" if status == "running" and idle >= STALL_AFTER_S else status

    stages = job.get("stages") or []
    n = len(stages)
    i = next((k for k, s in enumerate(stages) if s.get("id") == job.get("stage")), None)
    done_stages = sum(1 for s in stages if s.get("status") in ("done", "skipped"))
    step = _step(job)

    if status == "completed":
        pct: Optional[float] = 100.0
    elif status == "queued" or n == 0:
        pct = None
    else:
        # whole stages done, plus the current stage's fraction only when its own total is known
        frac = (step["pct"] or 0) / 100.0 if step["pct"] is not None else 0.0
        pct = round(min(99.0 if status in ACTIVE else 100.0, 100.0 * (done_stages + frac) / n), 1)

    # ETA from the observed rate of the current step: only with a known total, after a minute, while running
    eta = None
    if state == "running" and step["pct"] is not None and 0 < step["pct"] < 100 and elapsed >= ETA_AFTER_S:
        eta = round(elapsed * (100 - step["pct"]) / step["pct"])
        if i is not None and i < n - 1:
            eta = None  # later stages are not measured: an end time for the whole run would be a guess
    rows = step.get("rows", step["done"] if step["unit"] == "rows" else int(job.get("rows_done") or 0))
    return {
        "id": job.get("id"), "kind": job.get("kind"), "label": job.get("label"), "status": status, "state": state,
        "pct": pct, "determinate": pct is not None,
        "stage": job.get("stage"), "stage_index": i, "stage_count": n,
        "stages": [{"id": s.get("id"), "label": s.get("label"), "status": s.get("status")} for s in stages],
        "step": step, "parts": _parts(job),
        "rows": rows, "rows_per_min": round(rows * 60 / elapsed) if elapsed >= ETA_AFTER_S and rows else None,
        "elapsed_s": round(elapsed), "idle_s": round(idle), "eta_s": eta, "eta_is_estimate": True,
        "message": job.get("message") or "", "error": job.get("error"),
        "started_at": job.get("started_at"), "updated_at": job.get("updated_at"),
        "finished_at": job.get("finished_at"), "queue_position": job.get("queue_position"),
        "system_id": job.get("system_id"), "version_id": job.get("version_id"), "modules": job.get("modules") or [],
    }
