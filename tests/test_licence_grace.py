"""PC-14: the signed 14-day offline grace.

When Meridian HQ is unreachable, the last valid signed online response is honoured for 14 days after it was
signed: re-verified (vendor key, node fingerprint) every time, served with X-Licence-Warning: offline_grace,
visible as status "offline_grace" on GET /api/v1/licence, and kept on disk so a restart keeps it. Past the 14
days, gated routes lock until HQ answers again. A forged or edited cached response grants nothing.
"""
from __future__ import annotations

import json
import time

import pytest

import api.middleware.licence as lic
from tests.licence_test_keys import install, signed_response

FP = "cafe" * 16
DAY = 86400


@pytest.fixture(autouse=True)
def _state(monkeypatch, tmp_path):
    install(monkeypatch, tmp_path)
    monkeypatch.setattr(lic, "_get_machine_fingerprint", lambda: FP)
    monkeypatch.setattr(lic, "_cache", {"response": None, "expires_at": 0.0})
    monkeypatch.setattr(lic, "_manifest_cache", {})
    monkeypatch.setattr(lic, "_degraded_at", None)
    monkeypatch.setattr(lic.settings, "licence_key", "MRDX-TEST")
    monkeypatch.setattr(lic.settings, "licence_mode", "online")
    monkeypatch.setattr(lic.settings, "licence_offline_grace_days", 14)


def _hq(monkeypatch, body: dict | None) -> None:
    """HQ answers ``body`` (200), or is unreachable (None)."""
    class _Resp:
        status_code = 200

        def json(self):
            return body

    class _Client:
        def __init__(self, *a, **kw):
            if body is None:
                raise OSError("connection refused")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            return _Resp()

    monkeypatch.setattr(lic.httpx, "AsyncClient", _Client)


class _Req:
    def __init__(self, path: str):
        from starlette.datastructures import State, URL

        self.url = URL(f"http://test{path}")
        self.method = "GET"
        self.state = State()


async def _ok(_request):
    from starlette.responses import JSONResponse

    return JSONResponse({"ok": True})


async def _call(path: str = "/api/v1/findings"):
    return await lic.LicenceMiddleware(app=None).dispatch(_Req(path), _ok)


@pytest.mark.asyncio
async def test_unreachable_hq_runs_on_the_last_signed_licence_with_a_warning(monkeypatch):
    _hq(monkeypatch, signed_response(FP, signed_at=int(time.time()) - 3 * DAY + 60))
    # first call validates online (signed 3 days ago is inside the 7-day freshness)
    assert (await _call()).status_code == 200
    lic._cache["expires_at"] = 0.0
    _hq(monkeypatch, None)  # HQ goes away
    r = await _call()
    assert r.status_code == 200 and r.headers["X-Licence-Warning"] == "offline_grace"
    status = lic.get_cached_manifest()
    assert status["status"] == "offline_grace" and status["valid"] is True
    assert status["offline_grace"]["active"] is True and 10 <= status["offline_grace"]["days_left"] <= 11
    assert lic.get_cached_licence()["offline_grace"]["grace_days"] == 14


@pytest.mark.asyncio
async def test_grace_survives_a_restart_and_ends_after_14_days(monkeypatch):
    _hq(monkeypatch, signed_response(FP))
    assert (await _call()).status_code == 200
    monkeypatch.setattr(lic, "_last_signed", None)  # a restart: only the disk copy is left
    monkeypatch.setattr(lic, "_cache", {"response": None, "expires_at": 0.0})
    _hq(monkeypatch, None)
    assert (await _call()).status_code == 200

    # 15 days after signing: re-verification fails the grace window, gated routes lock
    stored = json.load(open(lic.settings.licence_state_path))
    real_time = time.time
    monkeypatch.setattr(lic.time, "time", lambda: real_time() + 15 * DAY)
    monkeypatch.setattr(lic, "_cache", {"response": None, "expires_at": 0.0})
    r = await _call()
    assert r.status_code == 403 and json.loads(r.body)["error"] == "licence_server_cutoff"
    assert stored["signature_ed25519"]  # the signature is kept with the response
    # sign-in and the licence status stay reachable
    assert (await _call("/api/v1/licence")).status_code == 200


@pytest.mark.asyncio
async def test_an_edited_cached_licence_grants_nothing(monkeypatch, tmp_path):
    _hq(monkeypatch, signed_response(FP))
    assert (await _call()).status_code == 200
    path = lic.settings.licence_state_path
    data = json.load(open(path))
    data["enabled_modules"].append("fi_gl")  # widen the entitlement on disk
    json.dump(data, open(path, "w"))
    monkeypatch.setattr(lic, "_last_signed", None)
    monkeypatch.setattr(lic, "_cache", {"response": None, "expires_at": 0.0})
    _hq(monkeypatch, None)
    r = await _call()
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_no_signed_licence_ever_is_denied_not_graced(monkeypatch):
    _hq(monkeypatch, None)
    r = await _call()
    assert r.status_code == 403 and json.loads(r.body)["error"] == "licence_unverified"


@pytest.mark.asyncio
async def test_unsigned_online_response_is_rejected(monkeypatch):
    unsigned = signed_response(FP)
    del unsigned["signature_ed25519"]
    _hq(monkeypatch, unsigned)
    r = await _call()
    assert r.status_code == 402 and json.loads(r.body)["reason"] == "signature_invalid"
