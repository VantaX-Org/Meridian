"""
Meridian Licence Service
========================

Supports two validation strategies, selected by MERIDIAN_LICENCE_MODE env var:

  online  (default) — sends licence key to licence.meridian.vantax.co.za every 6 hours
  offline            — verifies a pre-signed RS256 JWT token (air-gapped deployments)

Both strategies return the same LicenceManifest dataclass so callers are
unaware of which mode is active.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("meridian.licence")

# ── Public key embedded at build time ────────────────────────────────────────
# This is the RSA public key used to verify offline JWT tokens.
# The matching private key lives only in Meridian HQ — never on customer infra.
# Rotate by rebuilding images with a new key pair.
OFFLINE_PUBLIC_KEY = os.getenv(
    "MERIDIAN_OFFLINE_PUBLIC_KEY",
    # Placeholder — replaced with real key during production build
    "",
)


# ── Manifest dataclass ────────────────────────────────────────────────────────

@dataclass
class LicenceManifest:
    valid: bool
    tenant_id: str = ""
    enabled_modules: list[str] = field(default_factory=list)
    enabled_menu_items: list[str] = field(default_factory=list)
    features: dict[str, Any] = field(default_factory=dict)
    rules: list[dict] = field(default_factory=list)
    field_mappings: list[dict] = field(default_factory=list)
    llm_config: dict[str, Any] = field(default_factory=dict)
    expires_at: str = ""
    grace_period_ends: str = ""
    reason: str = ""

    @property
    def in_grace_period(self) -> bool:
        return bool(self.grace_period_ends)

    @classmethod
    def invalid(cls, reason: str = "unknown") -> "LicenceManifest":
        return cls(valid=False, reason=reason)


# ── Online strategy ───────────────────────────────────────────────────────────

class OnlineLicenceClient:
    """Validates the licence key against the Meridian HQ licence worker."""

    def __init__(self) -> None:
        self._server_url = os.getenv(
            "MERIDIAN_LICENCE_SERVER_URL",
            "https://licence.meridian.vantax.co.za/api/licence/validate",
        )
        self._key = os.getenv("MERIDIAN_LICENCE_KEY", os.getenv("LICENCE_KEY", ""))

    def validate(self) -> LicenceManifest:
        if not self._key:
            logger.warning("No MERIDIAN_LICENCE_KEY configured — running unlicensed")
            return LicenceManifest.invalid("no_key")

        try:
            resp = httpx.post(
                self._server_url,
                json={"licenceKey": self._key, "machineFingerprint": _machine_fingerprint()},
                timeout=15.0,
            )
        except httpx.RequestError as exc:
            logger.warning("Licence server unreachable: %s", exc)
            return LicenceManifest.invalid("server_unreachable")

        if resp.status_code == 402:
            data = resp.json()
            return LicenceManifest(
                valid=True,
                grace_period_ends=data.get("grace_period_ends", ""),
                enabled_modules=data.get("enabled_modules", []),
                enabled_menu_items=data.get("enabled_menu_items", []),
                features=data.get("features", {}),
                rules=data.get("rules", []),
                field_mappings=data.get("field_mappings", []),
                llm_config=data.get("llm_config", {}),
                tenant_id=data.get("tenantId", ""),
                expires_at=data.get("expiresAt", ""),
            )

        if resp.status_code == 403:
            data = resp.json()
            return LicenceManifest.invalid(data.get("reason", "forbidden"))

        if resp.status_code != 200:
            logger.error("Unexpected licence server response: %s", resp.status_code)
            return LicenceManifest.invalid("server_error")

        data = resp.json()
        return LicenceManifest(
            valid=data.get("valid", False),
            tenant_id=data.get("tenantId", ""),
            enabled_modules=data.get("enabled_modules", []),
            enabled_menu_items=data.get("enabled_menu_items", []),
            features=data.get("features", {}),
            rules=data.get("rules", []),
            field_mappings=data.get("field_mappings", []),
            llm_config=data.get("llm_config", {}),
            expires_at=data.get("expiresAt", ""),
        )


# ── Offline strategy ──────────────────────────────────────────────────────────

class OfflineLicenceClient:
    """Verifies a pre-signed RS256 JWT licence token without network access.

    The token is generated in Meridian HQ and delivered to the customer as part
    of their deployment bundle. They set MERIDIAN_LICENCE_TOKEN in their .env.
    """

    def validate(self) -> LicenceManifest:
        token = os.getenv("MERIDIAN_LICENCE_TOKEN", "")
        if not token:
            return LicenceManifest.invalid("no_offline_token")

        if not OFFLINE_PUBLIC_KEY:
            logger.error(
                "MERIDIAN_OFFLINE_PUBLIC_KEY not set — cannot verify offline token"
            )
            return LicenceManifest.invalid("no_public_key")

        try:
            import jwt as pyjwt  # PyJWT

            payload = pyjwt.decode(
                token,
                OFFLINE_PUBLIC_KEY,
                algorithms=["RS256"],
                options={"require": ["exp", "tenant_id"]},
            )
        except Exception as exc:
            logger.warning("Offline licence token invalid: %s", exc)
            return LicenceManifest.invalid("invalid_token")

        return LicenceManifest(
            valid=True,
            tenant_id=payload.get("tenant_id", ""),
            enabled_modules=payload.get("enabled_modules", []),
            enabled_menu_items=payload.get("enabled_menu_items", []),
            features=payload.get("features", {}),
            rules=payload.get("rules", []),
            field_mappings=payload.get("field_mappings", []),
            llm_config=payload.get("llm_config", {}),
            expires_at=str(payload.get("exp", "")),
        )


# ── Factory + cached service ──────────────────────────────────────────────────

def _build_client() -> OnlineLicenceClient | OfflineLicenceClient:
    mode = os.getenv("MERIDIAN_LICENCE_MODE", os.getenv("LICENCE_MODE", "online"))
    if mode == "offline":
        logger.info("Licence mode: offline (JWT token)")
        return OfflineLicenceClient()
    logger.info("Licence mode: online (phone-home)")
    return OnlineLicenceClient()


class LicenceService:
    """Thread-safe cached licence manifest with background refresh."""

    REFRESH_INTERVAL = 6 * 3600   # 6 hours
    GRACE_FAIL_LIMIT = 2 * 3600   # 2 hours — jobs blocked after this many seconds of consecutive failures

    def __init__(self) -> None:
        self._client = _build_client()
        self._manifest: LicenceManifest = LicenceManifest.invalid("not_validated")
        self._last_valid_at: float = 0.0
        self._lock = threading.Lock()

    def validate(self) -> LicenceManifest:
        """Force an immediate validation and update the cache."""
        manifest = self._client.validate()
        with self._lock:
            if manifest.valid or manifest.in_grace_period:
                self._last_valid_at = time.monotonic()
            self._manifest = manifest
        return manifest

    def get_cached(self) -> LicenceManifest:
        """Return the last cached manifest without a network call."""
        with self._lock:
            return self._manifest

    def is_analysis_allowed(self) -> bool:
        """Allow new analysis jobs only while licence is valid or within grace.

        After GRACE_FAIL_LIMIT seconds of consecutive validation failures the
        manifest becomes stale and new jobs are blocked.
        """
        with self._lock:
            m = self._manifest
            if m.valid or m.in_grace_period:
                return True
            elapsed = time.monotonic() - self._last_valid_at
            return elapsed < self.GRACE_FAIL_LIMIT


# Singleton — imported by middleware and routes
_service: LicenceService | None = None


def get_licence_service() -> LicenceService:
    global _service
    if _service is None:
        _service = LicenceService()
    return _service


# ── Helpers ───────────────────────────────────────────────────────────────────

def _machine_fingerprint() -> str:
    """Generate a stable machine identifier from hostname + MAC address."""
    import hashlib
    import socket
    import uuid

    host = socket.gethostname()
    mac = str(uuid.getnode())
    return hashlib.sha256(f"{host}:{mac}".encode()).hexdigest()[:16]
