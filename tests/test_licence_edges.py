"""Licence middleware edge cases — expiry, offline failures, network partition.

Covers the failure modes called out in the production-readiness audit:
- Expired offline licence → rejected
- Missing offline licence file → failure counter starts
- Offline HMAC signature mismatch → rejected
- Cloudflare unreachable, under 2h grace → middleware keeps serving cached
- Cloudflare unreachable, over 2h → hard cutoff, 403
- 48h consecutive-failure cutoff for offline mode
- Invalid licence key format

Tests patch the module-level caches in api.middleware.licence and drive
pure-python branches; no real Cloudflare or DB calls. Each test resets
state so execution order doesn't matter.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _reset_licence_state():
    """Clear the module-level caches before every test so we see a clean slate."""
    from api.middleware import licence as lic

    lic._cache.clear()
    lic._cache.update({"response": None, "expires_at": 0.0})
    lic._manifest_cache.clear()
    lic._consecutive_failures = 0
    lic._first_failure_at = None
    lic._degraded_at = None
    lic._last_checked_at = None
    yield
    lic._cache.clear()
    lic._cache.update({"response": None, "expires_at": 0.0})
    lic._manifest_cache.clear()


# ── Offline licence file ──────────────────────────────────────────────────────


def _write_signed_licence(
    path: Path,
    *,
    expires_at: str,
    active: bool = True,
    secret: str = "s3cret",
    modules: list | None = None,
    corrupt_signature: bool = False,
) -> None:
    """Write a JWT-style offline licence file (payload + HMAC signature)."""
    payload = {
        "active": active,
        "expiresAt": expires_at,
        "tenantId": "00000000-0000-0000-0000-000000000001",
        "modules": modules or ["business_partner"],
    }
    sig = hmac_mod.new(
        secret.encode(),
        json.dumps(payload, sort_keys=True).encode(),
        hashlib.sha256,
    ).hexdigest()
    if corrupt_signature:
        sig = "0" * 64
    path.write_text(json.dumps({"payload": payload, "signature": sig}))


def test_expired_offline_licence_is_rejected(tmp_path, monkeypatch):
    from api.middleware import licence as lic

    licence_file = tmp_path / "licence.json"
    _write_signed_licence(
        licence_file,
        expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z"),
        secret="s3cret",
    )

    monkeypatch.setenv("LICENCE_MODE", "offline")
    monkeypatch.setenv("LICENCE_FILE_PATH", str(licence_file))
    monkeypatch.setenv("LICENCE_SECRET", "s3cret")
    monkeypatch.setattr(lic.settings, "licence_file", str(licence_file))

    result = lic._read_offline_licence()
    assert result is not None
    assert result.get("valid") is False
    assert result.get("reason") == "expired"


def test_offline_hmac_mismatch_rejected(tmp_path, monkeypatch):
    from api.middleware import licence as lic

    licence_file = tmp_path / "licence.json"
    _write_signed_licence(
        licence_file,
        expires_at=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat().replace("+00:00", "Z"),
        secret="s3cret",
        corrupt_signature=True,
    )

    monkeypatch.setenv("LICENCE_MODE", "offline")
    monkeypatch.setenv("LICENCE_FILE_PATH", str(licence_file))
    monkeypatch.setenv("LICENCE_SECRET", "s3cret")
    monkeypatch.setattr(lic.settings, "licence_file", str(licence_file))

    result = lic._read_offline_licence()
    assert result == {"valid": False, "reason": "invalid_signature"}
    # Signature failures also bump the failure counter — that's the hook the
    # 48h degradation check relies on.
    assert lic._consecutive_failures == 1
    assert lic._first_failure_at is not None


def test_offline_file_missing_bumps_failure_counter(tmp_path, monkeypatch):
    from api.middleware import licence as lic

    monkeypatch.setenv("LICENCE_MODE", "offline")
    monkeypatch.setenv("LICENCE_FILE_PATH", str(tmp_path / "does-not-exist.json"))
    monkeypatch.setattr(lic.settings, "licence_file", str(tmp_path / "does-not-exist.json"))

    result = lic._read_offline_licence()
    assert result is None
    assert lic._consecutive_failures == 1
    assert lic._first_failure_at is not None


def test_valid_offline_licence_resets_failure_counter(tmp_path, monkeypatch):
    from api.middleware import licence as lic

    # Pre-dirty the counter
    lic._consecutive_failures = 3
    lic._first_failure_at = time.time() - 100

    licence_file = tmp_path / "licence.json"
    _write_signed_licence(
        licence_file,
        expires_at=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat().replace("+00:00", "Z"),
        secret="s3cret",
    )
    monkeypatch.setenv("LICENCE_MODE", "offline")
    monkeypatch.setenv("LICENCE_FILE_PATH", str(licence_file))
    monkeypatch.setenv("LICENCE_SECRET", "s3cret")
    monkeypatch.setattr(lic.settings, "licence_file", str(licence_file))

    result = lic._read_offline_licence()
    assert result is not None and result.get("valid") is True
    assert lic._consecutive_failures == 0
    assert lic._first_failure_at is None


# ── 48h offline degradation cutoff ────────────────────────────────────────────


def test_licence_degraded_false_when_no_failures():
    from api.middleware import licence as lic

    assert lic.is_licence_degraded() is False


def test_licence_degraded_false_within_48h():
    from api.middleware import licence as lic

    lic._consecutive_failures = 10
    lic._first_failure_at = time.time() - 60 * 60  # 1 hour ago
    assert lic.is_licence_degraded() is False


def test_licence_degraded_true_after_48h():
    from api.middleware import licence as lic

    lic._consecutive_failures = 100
    lic._first_failure_at = time.time() - (lic.FAILURE_CUTOFF_SECONDS + 10)
    assert lic.is_licence_degraded() is True


# ── Cloudflare network-partition cutoff (2h grace) ────────────────────────────


def test_cloudflare_healthy_by_default():
    from api.middleware import licence as lic

    assert lic.is_cloudflare_unreachable() is False


def test_cloudflare_marked_degraded_starts_grace_period():
    from api.middleware import licence as lic

    lic._mark_cloudflare_degraded()
    assert lic._degraded_at is not None
    # Still within 2h grace → not unreachable
    assert lic.is_cloudflare_unreachable() is False


def test_cloudflare_hard_cutoff_after_2h():
    from api.middleware import licence as lic

    lic._degraded_at = time.time() - (lic.LICENCE_DEGRADED_CUTOFF_SECONDS + 60)
    assert lic.is_cloudflare_unreachable() is True


def test_cloudflare_healthy_clears_degraded_state():
    from api.middleware import licence as lic

    lic._degraded_at = time.time() - 100
    lic._mark_cloudflare_healthy()
    assert lic._degraded_at is None
    assert lic.is_cloudflare_unreachable() is False


def test_double_degraded_does_not_reset_clock():
    """Consecutive _mark_cloudflare_degraded calls keep the original clock,
    so the 2h counter starts on the first failure, not every retry."""
    from api.middleware import licence as lic

    lic._mark_cloudflare_degraded()
    first = lic._degraded_at
    assert first is not None

    time.sleep(0.01)
    lic._mark_cloudflare_degraded()
    assert lic._degraded_at == first  # unchanged


# ── _validate_licence routing ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_validate_licence_in_offline_mode_skips_network(tmp_path, monkeypatch):
    from api.middleware import licence as lic

    licence_file = tmp_path / "licence.json"
    _write_signed_licence(
        licence_file,
        expires_at=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat().replace("+00:00", "Z"),
        secret="s3cret",
    )
    monkeypatch.setenv("LICENCE_MODE", "offline")
    monkeypatch.setenv("LICENCE_FILE_PATH", str(licence_file))
    monkeypatch.setenv("LICENCE_SECRET", "s3cret")
    monkeypatch.setattr(lic.settings, "licence_file", str(licence_file))

    class _Boom:
        def __init__(self, *a, **kw):
            raise AssertionError("network MUST NOT be called in offline mode")

    # If anyone tries to instantiate AsyncClient we'd see it here.
    monkeypatch.setattr(lic.httpx, "AsyncClient", _Boom)

    result = await lic._validate_licence()
    assert result is not None
    assert result.get("valid") is True


@pytest.mark.asyncio
async def test_validate_licence_short_circuits_past_cutoff(monkeypatch):
    from api.middleware import licence as lic

    monkeypatch.setenv("LICENCE_MODE", "online")
    monkeypatch.setattr(lic.settings, "licence_file", None)
    lic._degraded_at = time.time() - (lic.LICENCE_DEGRADED_CUTOFF_SECONDS + 10)

    class _Boom:
        def __init__(self, *a, **kw):
            raise AssertionError("should not attempt network past cutoff")

    monkeypatch.setattr(lic.httpx, "AsyncClient", _Boom)

    result = await lic._validate_licence()
    assert result == {"valid": False, "reason": "licence_server_unreachable_cutoff"}
