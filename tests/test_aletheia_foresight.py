"""Aletheia foresight: the deterministic composite projection and go-live date, the engine surprise layer over a
stub sidecar, and the route answering with the engine off. No database: the route's session is a stub."""
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from api.deps import Tenant
from api.routes import aletheia_engine as route
from api.services import aletheia_engine as engine
from api.services import aletheia_foresight as fs

SEEN: list[tuple[str, object]] = []


def _runs(scores: list[float], step: int = 7) -> list[dict]:
    return [{"version_id": f"v{i}", "label": f"Run {i + 1}", "run_at": f"2026-{1 + (i * step) // 28:02d}-"
             f"{1 + (i * step) % 28:02d}T08:00:00+00:00", "composite": c, "failing_rules": 20 - i, "affected_records": 100,
             "critical": 0, "high": 1, "blockers": 0, "auto_fixable_pct": None, "dimensions": {}}
            for i, c in enumerate(scores)]


def test_projection_reaches_target_with_ordered_dates() -> None:
    out = fs.project(_runs([60, 63, 65, 68, 70, 73]), 90)
    assert out["available"] and out["go_live"]["status"] == "projected"
    gl = out["go_live"]
    assert gl["earliest"] <= gl["projected"] <= gl["latest"]
    assert out["next"]["low"] <= out["next"]["point"] <= out["next"]["high"]
    assert out["slope_per_30d"] > 0 and 0 <= out["evidence"]["confidence"] <= 100
    assert out["evidence"]["runs"] == 6 and len(out["band"]) == 8


def test_projection_statuses() -> None:
    assert fs.project(_runs([91, 92, 93]), 90)["go_live"]["status"] == "reached"
    assert fs.project(_runs([80, 78, 75, 74]), 90)["go_live"]["status"] == "not_converging"
    assert fs.project(_runs([60, 60.01, 60.02, 60.0, 60.03]), 99)["go_live"]["status"] == "beyond_horizon"
    assert fs.project(_runs([60, 61]), 90) == {"available": False, "reason": "too_few_runs",
                                               "evidence": fs.project(_runs([60, 61]), 90)["evidence"]}
    undated = [dict(r, run_at=None) for r in _runs([60, 62, 64])]
    assert fs.project(undated, 90)["reason"] == "undated"


class _Stub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, code=200):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            return self._send({"status": "ok", "version": "1.7.0"})
        if self.path == "/api/tenants":
            return self._send({"tenants": ["meridian"]})
        if self.path == "/api/meridian/license":
            return self._send({"license": {"valid": False, "reason": "no license key", "payload": {}}})
        self._send({"error": "nope"}, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append((self.path, body))
        if self.path == "/api/meridian/learn":
            return self._send({"benchmarks": {"composite": {"mean": 66.0, "low": 58.0, "high": 74.0, "n": 6}}})
        if self.path == "/api/meridian/model-insights":
            return self._send({"learned": {"recon_loss": 0.1, "jepa_loss": 0.2}, "methodology": ["m1", "m2"],
                               "findings": [{"severity": "neg", "money_at_stake": 9e9, "drilldown": [
                                   {"kpi": "failing_rules", "timestep": 4, "predicted": 15.0, "actual": 3.0, "z": 6.1}]},
                                   {"severity": "warn", "drilldown": [{"kpi": "composite", "timestep": 99, "z": 3}]}]})
        self._send({}, 404)


@pytest.fixture
def sidecar(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), _Stub)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("ALETHEIA_URL", f"http://127.0.0.1:{srv.server_port}")
    monkeypatch.setenv("ALETHEIA_TOKEN", "t0k")
    monkeypatch.delenv("ALETHEIA_TENANT", raising=False)
    engine._cache.clear()
    SEEN.clear()
    yield
    srv.shutdown()
    engine._cache.clear()


def test_engine_layer_maps_surprises_to_runs_and_sends_only_aggregates(sidecar) -> None:
    runs = _runs([60, 63, 65, 68, 70, 73])
    out = fs.foresight(runs, 90)
    eng = out["engine"]
    assert eng["available"] and eng["methodology"] == ["m1", "m2"]
    assert eng["normal"]["high"] == 74.0 and eng["normal"]["outside"] is False
    # the out-of-range timestep is dropped; the engine's money figure never reaches the screen
    assert eng["surprises"] == [{"metric": "failing_rules", "version_id": "v4", "label": "Run 5",
                                 "run_at": runs[4]["run_at"], "expected": 15.0, "observed": 3.0, "z": 6.1,
                                 "severity": "high"}]
    sent = next(b for p, b in SEEN if p.endswith("/model-insights"))
    assert set(sent) == {"series", "epochs", "context"} and sent["context"] == {}
    assert all(isinstance(v, float) for s in sent["series"].values() for v in s)
    fs.foresight(runs, 90)  # second call is served from the cache
    assert sum(p.endswith("/model-insights") for p, _ in SEEN) == 1


def test_engine_layer_degrades_without_engine(monkeypatch) -> None:
    engine._cache.clear()
    monkeypatch.delenv("ALETHEIA_URL", raising=False)
    out = fs.foresight(_runs([60, 63, 65, 68, 70, 73]), 90)
    assert out["projection"]["available"] is True
    assert out["engine"]["available"] is False and out["engine"]["reason"] == "not_configured"
    assert out["engine"]["surprises"] == [] and out["engine"]["normal"] is None
    assert engine.surprises(_runs([60, 61, 62]))["reason"] == "too_few_runs"
    engine._cache.clear()


class _Db:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, *_a: Any, **_k: Any):
        class R:
            def fetchone(s):
                return self.rows

        return R()


@pytest.mark.anyio
async def test_route_uses_tenant_target_and_answers_with_engine_off(monkeypatch) -> None:
    engine._cache.clear()
    monkeypatch.delenv("ALETHEIA_URL", raising=False)
    runs = _runs([60, 63, 65, 68, 70, 73])

    async def fake_agg(db, tenant, fn, *a):
        return {"lineage": "material_master", "runs": runs}

    monkeypatch.setattr(route, "_agg", fake_agg)
    tenant = Tenant(uuid.uuid4(), "T", [])
    out = await route.get_foresight(None, None, 12, None, _Db(({"thresholds": {"target": 85}},)), tenant)
    body = route.Foresight.model_validate(out)
    assert body.target == 85 and body.target_source == "tenant"
    assert body.projection.available and body.engine.reason == "not_configured"
    out = await route.get_foresight(None, None, 12, 95.0, _Db(None), tenant)
    assert out["target"] == 95.0 and out["target_source"] == "query"
    engine._cache.clear()
