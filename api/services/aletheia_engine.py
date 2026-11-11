"""Client for Meridian's own Aletheia engine sidecar (the `aletheia` service in docker/docker-compose.customer.yml).

The engine is optional. Every call degrades to None on any failure, so Meridian keeps working when the sidecar is
absent, unreachable or unlicensed, and the screens say which. Only aggregates are ever sent: run-level scores and
counts from the trend series, keyed by metric name. No extracted record, field value or free text leaves Meridian.

Env: ALETHEIA_URL (compose sets http://aletheia:8000), ALETHEIA_TOKEN (the sidecar's CORTEX0_TOKEN, needed for
writes), ALETHEIA_TENANT (the engine tenant Meridian learns into, default "meridian").
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
import urllib.request
from typing import Optional

_TIMEOUT = 4
_TTL = 60
_cache: dict[str, tuple[float, object]] = {}

# Run-trend metrics sent to the engine, with the label the screens show beside each.
METRICS = {
    "composite": "Composite data quality score",
    "failing_rules": "Failing rules",
    "affected_records": "Records with a finding",
    "critical": "Critical findings",
    "high": "High-severity failing rules",
    "blockers": "Migration blockers",
    "auto_fixable_pct": "Records with a suggested fix (%)",
}


def _url() -> str:
    return (os.environ.get("ALETHEIA_URL") or "").rstrip("/")


def _tenant() -> str:
    return os.environ.get("ALETHEIA_TENANT") or "meridian"


def _call(path: str, body: Optional[dict] = None, timeout: float = _TIMEOUT) -> Optional[dict]:
    """GET (or POST when body is given) a JSON path on the sidecar. None on any failure, never raises."""
    if not _url():
        return None
    headers = {"Accept": "application/json"}
    token = os.environ.get("ALETHEIA_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    try:
        req = urllib.request.Request(_url() + path, data=data, headers=headers, method="POST" if data else "GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except Exception:
        return None


def _ensure_tenant() -> None:
    """Register Meridian's engine tenant once (needs the token). An existing tenant is left untouched."""
    listed = _call("/api/tenants")
    if listed is not None and _tenant() not in (listed.get("tenants") or []):
        _call("/api/tenants", {"id": _tenant(), "name": "Meridian"})


def _date(epoch) -> Optional[str]:
    try:
        return datetime.fromtimestamp(int(epoch), timezone.utc).date().isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def status() -> dict:
    """Configured, reachable, version, licence verdict, expiry and usage. Cached 60s."""
    hit = _cache.get("status")
    if hit and time.monotonic() - hit[0] < _TTL:
        return hit[1]  # type: ignore[return-value]
    out: dict = {"configured": bool(_url()), "live": False, "token_set": bool(os.environ.get("ALETHEIA_TOKEN")),
                 "tenant": _tenant(), "version": None, "licence": None, "usage": None}
    health = _call("/health") if out["configured"] else None
    if health is not None:
        out["live"] = True
        out["version"] = health.get("version")
        if out["token_set"]:
            _ensure_tenant()
        lic = _call(f"/api/{_tenant()}/license") or {}
        verdict = lic.get("license") or {}
        payload = verdict.get("payload") or {}
        if lic:
            out["licence"] = {
                "valid": bool(verdict.get("valid")),
                # no key at all: the engine runs unlicensed and does not enforce
                "licensed": verdict.get("reason") != "no license key",
                "reason": verdict.get("reason"),
                "deployment": lic.get("deployment_id"),
                "expires": _date(payload.get("expires")),
                "max_tenants": payload.get("max_tenants"),
            }
            out["usage"] = lic.get("usage")
    _cache["status"] = (time.monotonic(), out)
    return out


def trend_series(runs: list[dict]) -> dict[str, list[float]]:
    """Equal-length, gap-free series per metric from the trend runs (oldest first). A metric missing from any run
    is left out, the engine needs every point."""
    keys = [(k, lambda r, k=k: r.get(k)) for k in METRICS]
    dims = sorted({d for r in runs for d in (r.get("dimensions") or {})})
    keys += [(f"dimension:{d}", lambda r, d=d: (r.get("dimensions") or {}).get(d)) for d in dims]
    out = {}
    for name, get in keys:
        vals = [get(r) for r in runs]
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vals):
            out[name] = [float(v) for v in vals]
    return out


def _gate(n: int, minimum: int) -> Optional[dict]:
    """The reason the engine cannot be used for a trend of n runs, or None when it can."""
    if n < minimum:
        return {"available": False, "reason": "too_few_runs"}
    st = status()
    if not st["configured"]:
        return {"available": False, "reason": "not_configured"}
    if not st["live"]:
        return {"available": False, "reason": "unreachable"}
    if not st["token_set"]:
        return {"available": False, "reason": "no_token"}
    if st["licence"] and st["licence"]["licensed"] and not st["licence"]["valid"]:
        return {"available": False, "reason": "licence_invalid"}
    return None


def learn_trend(runs: list[dict]) -> dict:
    """Learn normal ranges and lead/lag links from the run trend. Always a dict: available False plus a reason
    when the engine cannot be used."""
    off = _gate(len(runs), 3)
    if off:
        return off
    series = trend_series(runs)
    res = _call(f"/api/{_tenant()}/learn", series)
    if res is None:
        return {"available": False, "reason": "engine_error"}
    latest = {k: v[-1] for k, v in series.items()}
    ranges = [{"metric": k, "mean": b.get("mean"), "low": b.get("low"), "high": b.get("high"), "n": b.get("n"),
               "latest": latest.get(k),
               "outside": latest.get(k) is not None and not (b.get("low", latest[k]) <= latest[k] <= b.get("high", latest[k]))}
              for k, b in (res.get("benchmarks") or {}).items()]
    links = [{"source": e.get("source"), "target": e.get("target"), "lag": e.get("lag"),
              "correlation": e.get("correlation")} for e in (res.get("causal_edges") or [])]
    links = sorted(links, key=lambda e: -abs(e["correlation"] or 0))[:8]  # the strongest, not all of them
    return {"available": True, "runs": len(runs), "ranges": ranges, "links": links}


SURPRISE_MIN_RUNS = 6
_SURPRISE_TIMEOUT = 30
_SURPRISE_TTL = 600


def surprises(runs: list[dict]) -> dict:
    """Runs the engine's world model was surprised by. The engine trains a spiking encoder and a JEPA world model on
    the run-trend series (POST /api/{tenant}/model-insights) and flags each run whose reconstruction surprise is more
    than 2.5 robust deviations above the median. Each surprise names the metric that diverged most, what the model
    expected and what was observed. The engine's money figure is dropped: it is costed for business KPIs, not data
    quality. Cached ten minutes per series, training takes seconds."""
    off = _gate(len(runs), SURPRISE_MIN_RUNS)
    if off:
        return off
    series = trend_series(runs)
    key = "surprise:" + json.dumps(series, sort_keys=True)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _SURPRISE_TTL:
        return hit[1]  # type: ignore[return-value]
    res = _call(f"/api/{_tenant()}/model-insights", {"series": series, "epochs": 30, "context": {}},
                timeout=_SURPRISE_TIMEOUT)
    if res is None:
        return {"available": False, "reason": "engine_error"}
    found = []
    for f in res.get("findings") or []:
        for d in f.get("drilldown") or []:
            t = d.get("timestep")
            if not isinstance(t, int) or not 0 <= t < len(runs):
                continue
            run = runs[t]
            found.append({"metric": d.get("kpi"), "version_id": run.get("version_id"), "label": run.get("label"),
                          "run_at": run.get("run_at"), "expected": d.get("predicted"), "observed": d.get("actual"),
                          "z": d.get("z"), "severity": "high" if f.get("severity") == "neg" else "medium"})
    found.sort(key=lambda s: -(s["z"] or 0))
    learned = res.get("learned") or {}
    out = {"available": True, "runs": len(runs), "metrics": sorted(series), "surprises": found,
           "methodology": [m for m in res.get("methodology") or [] if isinstance(m, str)],
           "recon_loss": learned.get("recon_loss"), "jepa_loss": learned.get("jepa_loss")}
    _cache[key] = (time.monotonic(), out)
    return out
