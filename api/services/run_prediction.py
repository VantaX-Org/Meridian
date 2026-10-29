"""Run duration, records and cost prediction from the tenant's own past runs, and the queue position.

Per object (module) the model is linear in records checked: a past run took ``duration`` seconds for ``records`` records
over all its objects, so its rate is ``duration / records`` seconds per record. For the last ``HISTORY`` finished runs
that measured the object (of the system when one is named):

  predicted records   the median of the object's records checked in those runs
  predicted seconds   the median rate x the predicted records
  band                the 25th and 75th percentile rates x the predicted records (with fewer than four runs, the
                      lowest and highest rate): the spread of the tenant's own runs, not a guess
  confidence          high with 6 or more runs, medium with 3 to 5, low with 1 or 2, none without history

A delta prediction reads only past delta runs (runs whose extraction logged a change-document or change-date read in
extraction_changes) when there is one, else the full runs, and says which (``basis``). The totals are the sums over the
objects. Cost: the tenant's cost model ``run_cost`` {per_hour, per_million_records} when set, else null. The queue:
the Celery broker's waiting tasks (Redis list length per queue) and the tenant's queued and running jobs
(api/services/jobs.py). Deterministic; no LLM.
"""
from __future__ import annotations

import math
from statistics import median
from typing import Any, Optional

from sqlalchemy import text

from api.services.version_status import finished_sql

HISTORY = 8
QUEUES = ("celery", "extraction", "analysis")


def percentile(values: list[float], q: float) -> float:
    """Linear interpolation between closest ranks (q in 0..1); ``values`` non-empty."""
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    pos = (len(xs) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def confidence(n: int) -> str:
    return "none" if n == 0 else "low" if n < 3 else "medium" if n < 6 else "high"


def predict_object(history: list[dict]) -> dict:
    """``history``: [{records, run_records, seconds}] newest first (``records`` the object's, ``run_records`` the
    whole run's, ``seconds`` the run's duration). Returns the object's prediction."""
    usable = [h for h in history[:HISTORY] if h.get("records") and h.get("run_records") and h.get("seconds") is not None
              and h["seconds"] >= 0]
    if not usable:
        return {"runs": 0, "records": None, "seconds": None, "seconds_low": None, "seconds_high": None,
                "seconds_per_record": None, "confidence": "none"}
    records = median([float(h["records"]) for h in usable])
    rates = [float(h["seconds"]) / float(h["run_records"]) for h in usable]
    rate = median(rates)
    lo, hi = (percentile(rates, 0.25), percentile(rates, 0.75)) if len(rates) >= 4 else (min(rates), max(rates))
    return {"runs": len(usable), "records": int(round(records)), "seconds": round(rate * records, 1),
            "seconds_low": round(lo * records, 1), "seconds_high": round(hi * records, 1),
            "seconds_per_record": rate, "confidence": confidence(len(usable))}


def cost_of(run_cost: Any, seconds: Optional[float], records: Optional[int]) -> Optional[float]:
    """The run's cost in the tenant's cost model: per_hour x hours + per_million_records x records / 1e6."""
    if not isinstance(run_cost, dict) or seconds is None:
        return None
    per_hour, per_m = run_cost.get("per_hour"), run_cost.get("per_million_records")
    if per_hour is None and per_m is None:
        return None
    total = float(per_hour or 0) * seconds / 3600.0 + float(per_m or 0) * float(records or 0) / 1_000_000.0
    return round(total, 2)


# ── reading the history (async; app.tenant_id set) ────────────────────────────────────────────────────────────

_RUNS_SQL = f"""
    SELECT av.id::text AS id, av.run_at, av.dqs_summary,
           (SELECT extract(epoch FROM max(s.finished_at) - min(s.started_at)) FROM analysis_run_steps s
             WHERE s.version_id = av.id AND s.tenant_id = av.tenant_id AND s.finished_at IS NOT NULL) AS seconds,
           EXISTS (SELECT 1 FROM extraction_changes x WHERE x.version_id = av.id AND x.tenant_id = av.tenant_id
                    AND x.mode <> 'full') AS delta,
           (SELECT jsonb_object_agg(z.module, z.widest) FROM (
               SELECT f.module, max(f.total_count) AS widest FROM findings f
                WHERE f.version_id = av.id AND f.tenant_id = av.tenant_id GROUP BY f.module) z) AS widest
      FROM analysis_versions av
     WHERE av.tenant_id = CAST(:t AS uuid) AND {finished_sql('av.status')} AND av.dqs_summary ? :m
       AND (CAST(:sid AS text) IS NULL OR av.metadata->>'system_id' = CAST(:sid AS text))
       AND av.metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND av.metadata->>'sandbox' IS DISTINCT FROM 'true'
     ORDER BY av.run_at DESC LIMIT :n"""


def _records(summary: Any, widest: Optional[int]) -> Optional[int]:
    """Records checked: what the run stored for the object, else its widest rule population (as the landscape)."""
    from api.routes.objects import records_checked_of

    if not isinstance(summary, dict):
        return None
    return records_checked_of(summary, int(widest) if widest else None)


async def history(db, tenant_id: str, module: str, system_id: Optional[str], delta: bool) -> tuple[list[dict], str]:
    """The object's past runs as ``predict_object`` reads them, and the basis (``full``, ``delta``, or
    ``full (no delta run yet)``)."""
    rows = (await db.execute(text(_RUNS_SQL), {"t": str(tenant_id), "m": module, "sid": system_id,
                                               "n": HISTORY * 4})).mappings().all()
    out = []
    for r in rows:
        summ = r["dqs_summary"] if isinstance(r["dqs_summary"], dict) else {}
        widest = r["widest"] if isinstance(r["widest"], dict) else {}
        recs = [_records(v, widest.get(k)) for k, v in summ.items() if isinstance(v, dict)]
        out.append({"run_id": r["id"], "run_at": r["run_at"], "records": _records(summ.get(module), widest.get(module)),
                    "run_records": sum(x for x in recs if x) or None,
                    "seconds": float(r["seconds"]) if r["seconds"] is not None else None, "delta": bool(r["delta"])})
    if delta:
        d = [h for h in out if h["delta"]]
        if d:
            return d[:HISTORY], "delta"
        return [h for h in out if not h["delta"]][:HISTORY], "full (no delta run yet)"
    return [h for h in out if not h["delta"]][:HISTORY], "full"


def queue_depth() -> dict:
    """Waiting tasks per Celery queue (the broker's Redis list lengths); empty when the broker cannot be read."""
    from api.services.task_progress import _redis_client

    client = _redis_client()
    if client is None:
        return {}
    try:
        return {q: int(client.llen(q) or 0) for q in QUEUES}
    except Exception:  # noqa: BLE001 - the prediction still answers without the broker
        return {}


def with_queue_positions(jobs_list: list[dict]) -> list[dict]:
    """Each queued job with its ``queue_position``: 1 + the tenant's queued jobs registered before it."""
    queued = sorted((j for j in jobs_list if j.get("status") == "queued"),
                    key=lambda j: (j.get("started_at") or 0, str(j.get("id"))))
    pos = {str(j.get("id")): i + 1 for i, j in enumerate(queued)}
    return [{**j, "queue_position": pos.get(str(j.get("id")))} if j.get("status") == "queued" else j for j in jobs_list]
