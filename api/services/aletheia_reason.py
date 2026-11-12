"""Aletheia reason: anomalies and causal risks over the run history.

Two layers, as Foresight. The deterministic layer always answers: a z-score of each run-level measure against the
runs before it (anomalies), and the rules and dimensions whose recent change best explains the composite's movement
(risks). The engine layer is the Aletheia sidecar's `POST /api/{tenant}/reason`. Meridian holds no request or response
contract for that route (docs/project/aletheia-capability-map.md), so the engine layer is not called and says
not_configured once the engine is otherwise usable. Only aggregates are ever put in `aggregates()`: scores, failure
counts per rule id and module codes. No record value, field content or personal data, and no money figure.
"""
from __future__ import annotations

from statistics import mean, pstdev
from typing import Any, Optional

import numpy as np
from sqlalchemy.orm import Session

from api.services import aletheia_engine as engine
from api.services import insights_aggregate as agg
from api.services.pdf_reports import _all, _rule

MIN_RUNS = 4
Z_FLAG = 2.5
Z_HIGH = 3.5
TOP = 8
_METHOD_ANOMALY = ("Each run-level measure is compared with the runs before it: z = (observed - mean of earlier runs) "
                   "/ standard deviation of earlier runs, flagged at |z| of 2.5 or more, high at 3.5 or more. Needs "
                   "three earlier runs with some spread.")
_METHOD_RISK = ("For each failing rule, the least-squares slope of the composite on the rule's affected-record count "
                "across the runs, times the rule's latest change; for each dimension, its latest score against the "
                "mean of earlier runs, weighted by its correlation with the composite. Confidence is the absolute "
                "correlation, scaled by the number of runs.")


def load(s: Session, tid: str, vid: Optional[str], system_id: Optional[str], limit: int = 12) -> Optional[dict]:
    """The run trend plus the failing rules' affected counts per run (check_id -> count) and rule texts."""
    trend = agg.trends(s, tid, vid, system_id, limit)
    if trend is None:
        return None
    ids = [r["version_id"] for r in trend["runs"]]
    by_run: dict[str, dict[str, int]] = {i: {} for i in ids}
    rows = _all(s, "SELECT version_id, check_id, affected_count, details FROM findings WHERE tenant_id = :t "
                   "AND version_id = ANY(CAST(:ids AS uuid[]))", t=tid, ids=ids)
    for f in rows:
        if agg.failing_rows([f]):
            d = by_run[str(f["version_id"])]
            d[f["check_id"]] = d.get(f["check_id"], 0) + int(f["affected_count"])
    names = {c: _rule(c).get("message") or c for d in by_run.values() for c in d}
    return {**trend, "rules": by_run, "rule_names": names}


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _series(runs: list[dict]) -> dict[str, list[float]]:
    """Run-level measures plus per-module composite scores; a measure missing from any run is left out."""
    out = engine.trend_series(runs)
    for m in sorted({m for r in runs for m in (r.get("modules") or {})}):
        vals = [(r.get("modules") or {}).get(m) for r in runs]
        nums = [float(v) for v in vals if v is not None and _num(v)]
        if len(nums) == len(vals):
            out[f"module:{m}"] = nums
    return out


def aggregates(runs: list[dict], rules: dict[str, dict[str, int]]) -> dict:
    """Everything the engine layer may be sent: numbers keyed by metric name or rule id, nothing else."""
    ids: list[Any] = [r.get("version_id") for r in runs]
    return {"series": _series(runs),
            "rule_failures": {c: [float(rules.get(i, {}).get(c, 0)) for i in ids]
                              for c in sorted({c for i in ids for c in rules.get(i, {})})}}


def _sev(z: float, metric: str, observed: float, expected: float) -> str:
    worse = observed < expected if (metric == "composite" or metric.startswith(("module:", "dimension:"))
                                    or metric == "auto_fixable_pct") else observed > expected
    return "high" if abs(z) >= Z_HIGH and worse else "medium"


def anomalies(series: dict[str, list[float]], runs: list[dict]) -> list[dict]:
    out: list[dict[str, Any]] = []
    for metric, vals in series.items():
        for i in range(MIN_RUNS - 1, len(vals)):
            prior = vals[:i]
            sd = pstdev(prior)
            if sd < 1e-9:
                continue
            mu, z = mean(prior), (vals[i] - mean(prior)) / sd
            if abs(z) >= Z_FLAG:
                r = runs[i]
                out.append({"metric": metric, "version_id": r.get("version_id"), "label": r.get("label"),
                            "run_at": r.get("run_at"), "expected": round(mu, 2), "observed": vals[i],
                            "z": round(z, 2), "severity": _sev(z, metric, vals[i], mu)})
    out.sort(key=lambda a: -abs(a["z"]))
    return out[:TOP]


def _corr(a: list[float], b: list[float]) -> float:
    if np.std(a) < 1e-9 or np.std(b) < 1e-9:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def _conf(r: float, n: int) -> int:
    return int(round(min(100.0, abs(r) * 100 * min(1.0, n / 8))))


def risks(series: dict[str, list[float]], rules: dict[str, dict[str, int]], names: dict[str, str],
          runs: list[dict]) -> list[dict]:
    comp = series.get("composite")
    if not comp:
        return []
    ids: list[Any] = [r.get("version_id") for r in runs]
    out: list[dict[str, Any]] = []
    for cid in sorted({c for i in ids for c in rules.get(i, {})}):
        v = [float(rules.get(i, {}).get(cid, 0)) for i in ids]
        change = v[-1] - v[-2]
        if change <= 0 or np.std(v) < 1e-9:
            continue
        slope = float(np.polyfit(v, comp, 1)[0])
        effect = slope * change
        if effect < 0:
            out.append({"kind": "rule", "driver": cid, "name": names.get(cid, cid), "change": change,
                        "effect": round(effect, 2), "confidence": _conf(_corr(v, comp), len(v))})
    for m, v in series.items():
        if m.startswith("dimension:"):
            delta = v[-1] - mean(v[:-1])
            if delta <= -1.0:
                out.append({"kind": "dimension", "driver": m[10:], "name": m[10:], "change": round(delta, 2),
                            "effect": round(delta * max(0.0, _corr(v, comp)), 2),
                            "confidence": _conf(_corr(v, comp), len(v))})
    out.sort(key=lambda r: r["effect"])
    return out[:TOP]


def reason(runs: list[dict], rules: dict[str, dict[str, int]], names: dict[str, str]) -> dict:
    series = _series(runs)
    n = len(runs)
    evid = lambda method, inputs: {"inputs": inputs, "method": method, "confidence": None, "runs": n,  # noqa: E731
                                   "first_run": runs[0].get("run_at") if runs else None,
                                   "last_run": runs[-1].get("run_at") if runs else None}
    inputs = [f"{len(series)} run-level measures and failure counts of {len({c for d in rules.values() for c in d})} "
              f"rules over {n} runs (scores and counts only, no record values)"]
    det: dict[str, Any]
    if n < MIN_RUNS:
        det = {"available": False, "reason": "too_few_runs", "anomalies": [], "risks": []}
    else:
        det = {"available": True, "reason": None, "anomalies": anomalies(series, runs),
               "risks": risks(series, rules, names, runs)}
    det["anomaly_evidence"] = evid(_METHOD_ANOMALY, inputs)
    det["risk_evidence"] = evid(_METHOD_RISK, inputs)
    if det["available"]:
        det["risk_evidence"]["confidence"] = max((r["confidence"] for r in det["risks"]), default=0)
    eng = engine.reason(runs, aggregates(runs, rules))
    return {"runs": [{"version_id": r.get("version_id"), "label": r.get("label"), "run_at": r.get("run_at"),
                      "composite": r.get("composite")} for r in runs],
            "deterministic": det,
            "engine": {"available": bool(eng.get("available")), "reason": eng.get("reason"),
                       "anomalies": eng.get("anomalies") or [], "risks": eng.get("risks") or [],
                       "evidence": {"inputs": inputs, "confidence": None,
                                    "method": "Aletheia dynamic reasoning over one snapshot of run-level aggregates."}}}
