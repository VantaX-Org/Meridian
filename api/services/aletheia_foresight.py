"""Aletheia foresight: where the composite score is heading, when it reaches the go-live target, and which runs the
engine's world model did not expect.

Two layers. The projection is deterministic and always shown: a least-squares line through the composite score of
each run against calendar days, with its 95% prediction interval (the same maths as the predictive forecast,
api/services/analytics_engine.py). The go-live date is the first day the line reaches the target; the earliest and
latest dates are the first days the upper and lower edges of the band reach it. The engine layer adds what the
Aletheia sidecar learned from the same run trend: the composite's learned normal range (POST /learn) and the runs
its world model was surprised by (POST /model-insights). Only run-level aggregates go to the engine.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from statistics import median
from typing import Optional

import numpy as np

from api.services import aletheia_engine as engine
from api.services.analytics_engine import _days_since_first, _interval_confidence, _prediction_interval

HORIZON_DAYS = 365
_METHOD = ("Least-squares line through the composite score of each run against calendar days, with a 95% prediction "
           "interval from the fit residuals (Student t, n-2 degrees of freedom). The go-live date is the first day "
           "the line reaches the target; earliest and latest are the first days the upper and lower band edges do.")


def _stamp(v) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def project(runs: list[dict], target: float) -> dict:
    """The deterministic projection of the composite toward target. available False plus a reason when it cannot
    be projected: too_few_runs (under three scored runs), undated (runs without distinct dates)."""
    pts = [(r.get("run_at"), float(r["composite"])) for r in runs
           if isinstance(r.get("composite"), (int, float)) and not isinstance(r.get("composite"), bool)]
    raw_stamps = [_stamp(t) for t, _ in pts]
    evidence = {"inputs": [f"Composite score of {len(pts)} runs"], "method": _METHOD, "confidence": 0,
                "runs": len(pts), "first_run": pts[0][0] if pts else None, "last_run": pts[-1][0] if pts else None}
    if len(pts) < 3:
        return {"available": False, "reason": "too_few_runs", "evidence": evidence}
    stamps = [s for s in raw_stamps if s is not None]
    if len(stamps) < len(raw_stamps) or len({s.date() for s in stamps}) < 2:
        return {"available": False, "reason": "undated", "evidence": evidence}
    days = _days_since_first([t for t, _ in pts])
    scores = [s for _, s in pts]
    slope, intercept = (float(v) for v in np.polyfit(days, scores, 1))
    last_day, last_at = days[-1], stamps[-1]
    gaps = [b - a for a, b in zip(days, days[1:]) if b > a]
    step = median(gaps) if gaps else 7.0

    def at(offset: float) -> tuple[float, float, float]:
        return _prediction_interval(days, scores, intercept, slope, last_day + offset)

    nxt = at(step)
    first: dict[str, Optional[int]] = {"point": None, "high": None, "low": None}
    for d in range(1, HORIZON_DAYS + 1):
        point, low, high = at(d)
        for k, v in (("point", point), ("high", high), ("low", low)):
            if first[k] is None and v >= target:
                first[k] = d
        if first["low"] is not None:
            break

    def date(offset: Optional[int]) -> Optional[str]:
        return (last_at + timedelta(days=offset)).date().isoformat() if offset is not None else None

    latest = scores[-1]
    if latest >= target:
        status = "reached"
    elif slope <= 0:
        status = "not_converging"
    elif first["point"] is None:
        status = "beyond_horizon"
    else:
        status = "projected"
    reach = first["low"] or first["point"] or 0
    span = int(min(HORIZON_DAYS, max(30, reach, step * 4)))
    band = [{"date": date(d), "point": p, "low": lo, "high": hi}
            for d in sorted({round(span * i / 8) for i in range(1, 9)}) for p, lo, hi in [at(d)]]
    evidence["confidence"] = _interval_confidence(nxt[1], nxt[2])
    return {
        "available": True, "latest": latest, "slope_per_30d": round(slope * 30, 2),
        "next": {"date": date(round(step)), "point": nxt[0], "low": nxt[1], "high": nxt[2]},
        "go_live": {"status": status, "projected": date(first["point"]),
                    "earliest": date(first["high"]), "latest": date(first["low"])},
        "band": band, "evidence": evidence,
    }


def foresight(runs: list[dict], target: float) -> dict:
    """Projection plus the engine layer. The engine layer degrades on its own: the projection never waits on it."""
    learned = engine.learn_trend(runs)
    normal = None
    if learned.get("available"):
        normal = next(({k: r.get(k) for k in ("mean", "low", "high", "n", "latest", "outside")}
                       for r in learned.get("ranges") or [] if r.get("metric") == "composite"), None)
    seen = engine.surprises(runs)
    eng: dict = {"available": bool(seen.get("available")), "reason": seen.get("reason"), "normal": normal,
                 "surprises": seen.get("surprises") or [], "methodology": seen.get("methodology") or []}
    eng["evidence"] = {
        "inputs": [f"{len(seen.get('metrics') or [])} run-level measures over {len(runs)} runs (scores and counts "
                   "only, no record values)"],
        "method": "Aletheia world model: spiking encoder plus JEPA latent dynamics, surprise above 2.5 robust "
                  "deviations; learned normal range is the mean plus or minus two standard deviations.",
        "confidence": None,  # per surprise: its z score, the higher the less the run fits the learned dynamics
    }
    return {"target": target, "runs": [{"version_id": r.get("version_id"), "label": r.get("label"),
                                        "run_at": r.get("run_at"), "composite": r.get("composite")} for r in runs],
            "projection": project(runs, target), "engine": eng}
