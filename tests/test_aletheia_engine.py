"""api/services/aletheia_engine.py against a stub sidecar on a local port: degrade paths and the learn shape."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from api.services import aletheia_engine as engine

SEEN: list[tuple[str, str, object]] = []
LICENCE = {"valid": False, "reason": "no license key", "payload": {}}


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
        SEEN.append(("GET", self.path, self.headers.get("Authorization")))
        if self.path == "/health":
            return self._send({"status": "ok", "version": "1.7.0"})
        if self.path == "/api/tenants":
            return self._send({"tenants": ["other"]})
        if self.path == "/api/meridian/license":
            return self._send({"deployment_id": "meridian", "tenant": "meridian", "license": LICENCE,
                               "usage": {"calls": 3}})
        self._send({"error": "nope"}, 404)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append(("POST", self.path, body))
        if self.path == "/api/meridian/learn":
            return self._send({"benchmarks": {"composite": {"mean": 80.0, "low": 78.0, "high": 82.0, "n": 4}},
                               "causal_edges": [{"source": "failing_rules", "target": "composite", "lag": 1,
                                                 "correlation": -0.9, "note": "x"}]})
        self._send({"added": body.get("id")})


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


RUNS = [{"composite": c, "failing_rules": f, "affected_records": 10, "critical": 0, "high": 1, "blockers": 0,
         "auto_fixable_pct": None, "dimensions": {"completeness": c, "validity": None if i == 0 else 90}}
        for i, (c, f) in enumerate([(70, 9), (75, 7), (79, 4), (90, 1)])]


def test_not_configured_and_unreachable_degrade(monkeypatch):
    engine._cache.clear()
    monkeypatch.delenv("ALETHEIA_URL", raising=False)
    assert engine.status()["configured"] is False
    assert engine.learn_trend(RUNS) == {"available": False, "reason": "not_configured"}
    engine._cache.clear()
    monkeypatch.setenv("ALETHEIA_URL", "http://127.0.0.1:9")  # nothing listens
    assert engine.learn_trend(RUNS)["reason"] == "unreachable"
    assert engine.learn_trend(RUNS[:2])["reason"] == "too_few_runs"
    engine._cache.clear()


def test_unlicensed_sidecar_reports_and_still_learns(sidecar):
    st = engine.status()
    assert st["live"] and st["version"] == "1.7.0"
    assert st["licence"]["licensed"] is False and st["usage"] == {"calls": 3}
    assert ("POST", "/api/tenants", {"id": "meridian", "name": "Meridian"}) in SEEN  # registered once
    out = engine.learn_trend(RUNS)
    assert out["available"] is True
    sent = next(b for m, p, b in SEEN if p == "/api/meridian/learn")
    # only gap-free numeric aggregates go out: no None series, no labels, no ids
    assert set(sent) == {"composite", "failing_rules", "affected_records", "critical", "high", "blockers",
                         "dimension:completeness"}
    assert all(len(v) == 4 for v in sent.values())
    assert out["ranges"][0]["outside"] is True  # latest 90 is above 78..82
    assert out["links"] == [{"source": "failing_rules", "target": "composite", "lag": 1, "correlation": -0.9}]
    assert all(a == "Bearer t0k" for m, p, a in SEEN if m == "GET")


def test_invalid_licence_blocks_learning(sidecar, monkeypatch):
    monkeypatch.setitem(LICENCE, "reason", "expired")
    st = engine.status()
    assert st["licence"]["licensed"] and not st["licence"]["valid"]
    assert engine.learn_trend(RUNS) == {"available": False, "reason": "licence_invalid"}


def test_no_token_is_said_not_sent(sidecar, monkeypatch):
    monkeypatch.delenv("ALETHEIA_TOKEN")
    assert engine.learn_trend(RUNS) == {"available": False, "reason": "no_token"}
    assert not any(m == "POST" for m, *_ in SEEN)
