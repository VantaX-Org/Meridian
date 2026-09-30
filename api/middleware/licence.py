import base64
import hashlib
import hmac as hmac_mod
import json
import logging
import os
import platform
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from api.config import settings

logger = logging.getLogger("meridian.licence")

# In-memory licence cache
_cache: dict = {
    "response": None,
    "expires_at": 0.0,
}

# Full manifest cache — stores the complete validated manifest for the licence route
_manifest_cache: dict = {}

_last_checked_at: Optional[float] = None
_consecutive_failures: int = 0
_first_failure_at: Optional[float] = None

# Task 08: Licence degradation cutoff
_degraded_at: Optional[float] = None  # When Cloudflare became unreachable
LICENCE_DEGRADED_CUTOFF_SECONDS = 2 * 60 * 60  # 2 hours: 7200 seconds

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours — valid licences
INVALID_CACHE_TTL_SECONDS = 60  # a renewal or reactivation applies within a minute
EXPIRY_GRACE_SECONDS = 7 * 24 * 60 * 60  # matches the licence worker's grace window
FAILURE_CUTOFF_SECONDS = 48 * 60 * 60  # 48 hours


def _get_machine_fingerprint() -> str:
    hostname = platform.node()
    # Get a stable machine identifier — hostname + UUID from /etc/machine-id or similar
    try:
        mac = hex(uuid.getnode())
    except Exception:
        mac = "unknown"
    raw = f"{hostname}:{mac}"
    return hashlib.sha256(raw.encode()).hexdigest()


def get_cached_manifest() -> dict:
    """Return the full manifest from the last successful validation.

    Includes: valid, status, tier, company_name, expiry_date, days_remaining,
    enabled_modules, enabled_menu_items, features, llm_config, last_validated.
    Used by GET /api/v1/licence.
    """
    if not _manifest_cache:
        return {"valid": None, "status": "not_yet_checked"}
    return _manifest_cache


def get_cached_licence() -> dict:
    """Return the cached licence data for the health endpoint.

    Returns a dict with licence details or a 'not_yet_checked' status
    if no cache exists.
    """
    cached = _cache.get("response")
    if cached is None:
        return {"valid": None, "status": "not_yet_checked"}

    result: dict = {
        "valid": cached.get("valid"),
        "modules": cached.get("modules", []),
        "expires_at": cached.get("expiresAt"),
        "last_checked": (
            datetime.fromtimestamp(_last_checked_at, tz=timezone.utc).isoformat()
            if _last_checked_at
            else None
        ),
    }

    expires_at = cached.get("expiresAt")
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            days = (exp_dt - now_dt).days
            result["days_remaining"] = days
        except (ValueError, TypeError):
            result["days_remaining"] = None
    else:
        result["days_remaining"] = None

    if not cached.get("valid"):
        result["reason"] = cached.get("reason")

    return result


def _read_offline_licence() -> dict | None:
    """Read licence from a local JSON file for air-gapped deployments.

    Requires LICENCE_MODE=offline. Validates HMAC-SHA256 signature using LICENCE_SECRET.
    After 48h of consecutive validation failures: refuse new analysis jobs,
    keep dashboard and existing data accessible.
    """
    global _consecutive_failures, _first_failure_at

    licence_mode = os.getenv("LICENCE_MODE", "online")
    if licence_mode != "offline":
        # Legacy support: fall back to checking licence_file directly
        if not settings.licence_file:
            return None
        licence_path = settings.licence_file
    else:
        licence_path = os.getenv("LICENCE_FILE_PATH", "/etc/meridian/licence.json")
        if not settings.licence_file:
            licence_path = licence_path  # use LICENCE_FILE_PATH
        else:
            licence_path = settings.licence_file  # prefer settings if set

    try:
        with open(licence_path, "r") as f:
            data = json.load(f)

        # HMAC signature verification
        licence_secret = os.getenv("LICENCE_SECRET", "")
        if licence_secret and "signature" in data and "payload" in data:
            # New format: {payload: {...}, signature: "<hmac_sha256_hex>"}
            payload = data["payload"]
            expected = hmac_mod.new(
                licence_secret.encode(),
                json.dumps(payload, sort_keys=True).encode(),
                hashlib.sha256,
            ).hexdigest()
            if data["signature"] != expected:
                logger.warning("Offline licence HMAC signature mismatch")
                _consecutive_failures += 1
                if _first_failure_at is None:
                    _first_failure_at = time.time()
                return {"valid": False, "reason": "invalid_signature"}
        else:
            # An unsigned file (or no LICENCE_SECRET to verify it with) grants
            # nothing — otherwise anyone could write their own licence.
            logger.warning("Offline licence is unsigned or LICENCE_SECRET is not set — rejecting")
            return {"valid": False, "reason": "unsigned_licence"}

        # Reset failure counter on successful read
        _consecutive_failures = 0
        _first_failure_at = None

        # Check expiry locally
        expires_at = payload.get("expiresAt", "")
        if expires_at:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                return {"valid": False, "reason": "expired"}

        return {
            "valid": payload.get("active", True),
            "modules": payload.get("modules", []),
            "tenantId": payload.get("tenantId", ""),
            "expiresAt": expires_at,
        }
    except FileNotFoundError:
        logger.warning(f"Offline licence file not found: {licence_path}")
        _consecutive_failures += 1
        if _first_failure_at is None:
            _first_failure_at = time.time()
        return None
    except Exception as e:
        logger.warning(f"Failed to read offline licence file: {e}")
        _consecutive_failures += 1
        if _first_failure_at is None:
            _first_failure_at = time.time()
        return None


def _read_offline_token() -> dict | None:
    """Verify HQ's RS256 offline licence JWT (MERIDIAN_LICENCE_TOKEN).

    Issued by POST /api/admin/tenants/:id/offline-token and verified with the
    matching public key (MERIDIAN_OFFLINE_PUBLIC_KEY). None when no token is set.
    """
    token = os.getenv("MERIDIAN_LICENCE_TOKEN", "").strip()
    if not token:
        return None
    key = os.getenv("MERIDIAN_OFFLINE_PUBLIC_KEY", "").strip()
    if not key:
        logger.error("MERIDIAN_LICENCE_TOKEN set but MERIDIAN_OFFLINE_PUBLIC_KEY is not — cannot verify")
        return {"valid": False, "reason": "no_public_key"}
    import jwt as pyjwt

    try:
        claims = pyjwt.decode(token, key, algorithms=["RS256"], issuer="meridian-hq",
                              options={"require": ["exp", "tenant_id", "iss"]})
    except pyjwt.ExpiredSignatureError:
        return {"valid": False, "reason": "expired"}
    except pyjwt.PyJWTError as e:
        logger.warning(f"Offline licence token rejected: {type(e).__name__}")
        return {"valid": False, "reason": "invalid_token"}
    return {
        "valid": True,
        "status": "active",
        "tenant_id": claims["tenant_id"],
        "expiry_date": datetime.fromtimestamp(claims["exp"], tz=timezone.utc).isoformat(),
        "enabled_modules": claims.get("enabled_modules", []),
        "enabled_menu_items": claims.get("enabled_menu_items", []),
        "features": claims.get("features", {}),
        "llm_config": claims.get("llm_config", {}),
        "rules": claims.get("rules", []),
        "field_mappings": claims.get("field_mappings", []),
    }


def is_licence_degraded() -> bool:
    """Check if offline licence failures have exceeded the 48h cutoff.

    After 48h of consecutive failures: refuse new analysis jobs,
    keep dashboard and existing data accessible.
    """
    if _first_failure_at is None or _consecutive_failures == 0:
        return False
    return (time.time() - _first_failure_at) > FAILURE_CUTOFF_SECONDS


def is_cloudflare_unreachable() -> bool:
    """Check if Cloudflare licence server has been unreachable for >= 2 hours.
    
    Task 08: Hard cutoff to prevent permanent bypass when Cloudflare is down.
    After 2 hours: refuse all licence-gated requests, return 403.
    """
    if _degraded_at is None:
        return False
    elapsed = time.time() - _degraded_at
    if elapsed > LICENCE_DEGRADED_CUTOFF_SECONDS:
        logger.error(f"Licence server unreachable for {elapsed:.0f}s (cutoff: {LICENCE_DEGRADED_CUTOFF_SECONDS}s). Rejecting request.")
        return True
    return False


def _mark_cloudflare_degraded() -> None:
    """Record that Cloudflare has become unreachable.
    
    Called on first connection failure. Starts the 2-hour grace period clock.
    """
    global _degraded_at
    if _degraded_at is None:
        _degraded_at = time.time()
        logger.warning("Cloudflare licence server marked as unreachable. Grace period starts (2 hours).")


def _mark_cloudflare_healthy() -> None:
    """Clear degraded state when Cloudflare comes back online."""
    global _degraded_at
    if _degraded_at is not None:
        elapsed = time.time() - _degraded_at
        logger.info(f"Cloudflare licence server back online after {elapsed:.0f}s downtime.")
        _degraded_at = None


def _update_manifest_cache(result: dict) -> None:
    """Populate _manifest_cache from a validation response."""
    global _manifest_cache
    features = result.get("features", {})
    expires_at = result.get("expiry_date") or result.get("expiresAt")
    days_remaining = result.get("days_remaining")
    if days_remaining is None and expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            days_remaining = max(0, (exp_dt - datetime.now(timezone.utc)).days)
        except (ValueError, TypeError):
            days_remaining = None

    _manifest_cache.update({
        "valid": result.get("valid", False),
        "tenant_id": result.get("tenant_id") or result.get("tenantId"),
        "company_name": result.get("company_name", ""),
        "tier": result.get("tier", "starter"),
        "status": result.get("status", "unknown"),
        "expiry_date": expires_at,
        "days_remaining": days_remaining,
        "enabled_modules": result.get("enabled_modules") or result.get("modules", []),
        "enabled_menu_items": result.get("enabled_menu_items", []),
        "features": features if isinstance(features, dict) else {},
        "llm_config": result.get("llm_config", {}),
        # Advisory platform-update metadata — NOT part of the signed
        # entitlement (see _entitlement_canonical), just passed through so
        # /api/v1/system/update-status can compare it against APP_VERSION.
        "latest_version": result.get("latest_version"),
        "release_notes": result.get("release_notes"),
        "last_validated": (
            datetime.fromtimestamp(_last_checked_at, tz=timezone.utc).isoformat()
            if _last_checked_at
            else None
        ),
    })


def _sync_manifest_to_db(result: dict) -> None:
    """Sync rules and field_mappings from licence manifest into local DB.

    This is a fire-and-forget operation. Errors are logged but not raised.
    Runs in a background thread to avoid blocking the request.
    """
    rules = result.get("rules", [])
    field_mappings = result.get("field_mappings", [])
    if not rules and not field_mappings:
        return

    import threading
    thread = threading.Thread(
        target=_do_sync_manifest,
        args=(rules, field_mappings),
        daemon=True,
    )
    thread.start()


def _do_sync_manifest(rules: list, field_mappings: list) -> None:
    """Background thread: upsert HQ rule governance and field mappings into the local DB.

    Field mappings belong to this deployment's tenant (HQ's tenant id is a
    different key space), written under RLS.
    """
    try:
        from sqlalchemy import text

        from api.deps import _DEV_TENANT
        from workers.db import get_sync_engine

        local_tid = str(_DEV_TENANT.id)
        with get_sync_engine().begin() as conn:
            conn.execute(text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": local_tid})
            for rule in rules:
                if not rule.get("id"):
                    continue
                conn.execute(text("""
                    INSERT INTO rules_hq_cache (id, name, description, module, category, severity, enabled,
                                                conditions, thresholds, tags, source, updated_at)
                    VALUES (:id, :name, :description, :module, :category, :severity, :enabled,
                            CAST(:conditions AS jsonb), CAST(:thresholds AS jsonb), CAST(:tags AS jsonb), 'hq', NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name, description = EXCLUDED.description, module = EXCLUDED.module,
                        category = EXCLUDED.category, severity = EXCLUDED.severity, enabled = EXCLUDED.enabled,
                        conditions = EXCLUDED.conditions, thresholds = EXCLUDED.thresholds,
                        tags = EXCLUDED.tags, updated_at = EXCLUDED.updated_at
                """), {
                    "id": rule["id"], "name": rule.get("name", ""), "description": rule.get("description"),
                    "module": rule.get("module", ""), "category": rule.get("category", ""),
                    "severity": rule.get("severity", "medium"), "enabled": bool(rule.get("enabled", True)),
                    "conditions": json.dumps(rule.get("conditions", [])),
                    "thresholds": json.dumps(rule.get("thresholds", {})), "tags": json.dumps(rule.get("tags", [])),
                })
            for fm in field_mappings:
                if not fm.get("module") or not fm.get("standard_field"):
                    continue
                conn.execute(text("""
                    INSERT INTO field_mappings (id, tenant_id, module, standard_field, standard_label, customer_field,
                                                customer_label, data_type, is_mapped, notes, updated_at)
                    VALUES (gen_random_uuid(), :tenant_id, :module, :standard_field, :standard_label, :customer_field,
                            :customer_label, :data_type, :is_mapped, :notes, NOW())
                    ON CONFLICT (tenant_id, module, standard_field) DO UPDATE SET
                        standard_label = EXCLUDED.standard_label, customer_field = EXCLUDED.customer_field,
                        customer_label = EXCLUDED.customer_label, data_type = EXCLUDED.data_type,
                        is_mapped = EXCLUDED.is_mapped, notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
                """), {
                    "tenant_id": local_tid, "module": fm["module"], "standard_field": fm["standard_field"],
                    "standard_label": fm.get("standard_label"), "customer_field": fm.get("customer_field"),
                    "customer_label": fm.get("customer_label"), "data_type": fm.get("data_type", "string"),
                    "is_mapped": bool(fm.get("is_mapped", False)), "notes": fm.get("notes"),
                })
        logger.info(f"Synced {len(rules)} rules and {len(field_mappings)} field mappings from licence manifest")
    except Exception as e:
        logger.warning(f"Failed to sync manifest to DB: {e}")


# ── Response signature verification (anti-self-grant) ─────────────────────────
# The worker RSA-signs every valid licence response. A customer holding the image
# could otherwise MITM their own licence check and forge `valid:true`; an HMAC
# wouldn't stop them (they'd hold the secret), so the worker signs with a private
# key and we verify with the PUBLIC key here. Enforcement is OFF until
# LICENCE_SERVER_PUBLIC_KEY is set — lets the worker deploy first, then the
# operator flips enforcement on with no forced lockout (safe rollout).

# 7 days — matches the worker's expiry grace window. Bounds replay of a captured
# response to this window; after it, the stale signature is rejected.
LICENCE_SIGNATURE_MAX_AGE = int(
    os.getenv("LICENCE_SIGNATURE_MAX_AGE_SECONDS", str(7 * 24 * 60 * 60))
)


def _entitlement_canonical(result: dict, signed_at) -> bytes:
    """Byte-identical twin of the worker's `entitlementCanonical` (index.ts).

    Fixed field list + "\\n" join (not JSON) so JS and Python cannot diverge on
    key order or escaping. Covers the entitlement fields that gate access.
    """
    features = result.get("features") or {}
    if isinstance(features, dict):
        feat_keys = sorted(k for k, v in features.items() if v)
    else:
        feat_keys = sorted(features)
    parts = [
        "meridian-licence-v1",
        "1",  # valid
        result.get("tenant_id") or "",
        result.get("expiry_date") or "",
        ",".join(sorted(result.get("enabled_modules") or [])),
        ",".join(sorted(result.get("enabled_menu_items") or [])),
        ",".join(feat_keys),
        result.get("machine_fingerprint") or "",
        str(signed_at),
    ]
    return "\n".join(parts).encode()


def _licence_public_key():
    pem = os.getenv("LICENCE_SERVER_PUBLIC_KEY")
    if not pem:
        return None
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    return load_pem_public_key(pem.encode())


def _verify_response_signature(result: dict) -> bool:
    """True if the response is authentic OR enforcement is disabled.

    Disabled (no LICENCE_SERVER_PUBLIC_KEY) → True (rollout passthrough). Enabled
    → the response MUST carry a fresh RSA signature over its entitlement fields,
    bound to this node's fingerprint; otherwise False (reject the grant).
    """
    pub = _licence_public_key()
    if pub is None:
        return True  # enforcement not enabled yet — worker-first rollout

    sig_b64 = result.get("signature")
    signed_at = result.get("signed_at")
    if not sig_b64 or signed_at is None:
        logger.error("Licence response unsigned but signature enforcement is on — rejecting")
        return False

    try:
        if abs(time.time() - float(signed_at)) > LICENCE_SIGNATURE_MAX_AGE:
            logger.error("Licence response signature stale — rejecting")
            return False
    except (TypeError, ValueError):
        return False

    # Node binding: a response captured for another node carries that node's
    # fingerprint and will not match ours.
    echoed_fp = result.get("machine_fingerprint") or ""
    if echoed_fp and echoed_fp != _get_machine_fingerprint():
        logger.error("Licence response fingerprint mismatch — rejecting")
        return False

    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    try:
        pub.verify(
            base64.b64decode(sig_b64),
            _entitlement_canonical(result, signed_at),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, ValueError, TypeError) as e:
        logger.error(f"Licence response signature invalid — rejecting: {type(e).__name__}")
        return False


async def _validate_licence() -> dict | None:
    """Call the licence server or read offline file. Returns the response dict or None on failure."""
    global _last_checked_at
    _last_checked_at = time.time()

    # Offline / air-gapped: never touch the network. HQ's signed token first,
    # then the legacy HMAC-signed licence file.
    if settings.licence_mode in ("offline", "airgap"):
        return _read_offline_token() or _read_offline_licence()

    # Task 08: Check degraded state cutoff BEFORE attempting network call
    if is_cloudflare_unreachable():
        logger.error("Licence server has been unreachable >2hrs. Rejecting request.")
        return {"valid": False, "reason": "licence_server_unreachable_cutoff"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.licence_server_url}/api/licence/validate",
                json={
                    "licenceKey": settings.licence_key,
                    "machineFingerprint": _get_machine_fingerprint(),
                },
            )
            # A non-200 means the server is reachable but the request didn't
            # succeed — almost always a misconfigured LICENCE_SERVER_URL (wrong
            # host/path → 404) or an HQ-side outage (5xx). Surface the real
            # status instead of letting resp.json() throw a cryptic
            # "Expecting value: line 1 column 1" on the HTML error body.
            if resp.status_code in (400, 402, 403):
                # HQ answered: the key is invalid / suspended / expired (or in grace).
                # That is a licence state — never "unreachable", which would let a
                # revoked licence keep running on its last entitlements.
                try:
                    verdict = resp.json()
                except Exception:
                    verdict = None
                if isinstance(verdict, dict) and verdict.get("valid") is False:
                    _mark_cloudflare_healthy()
                    return verdict
            if resp.status_code != 200:
                logger.warning(
                    "Licence server returned HTTP %s for %s/api/licence/validate "
                    "— check LICENCE_SERVER_URL. Treating as unreachable.",
                    resp.status_code,
                    settings.licence_server_url,
                )
                _mark_cloudflare_degraded()
                return None
            try:
                result = resp.json()
            except Exception as e:
                logger.warning(
                    "Licence server returned a non-JSON 200 response (%s). "
                    "Treating as unreachable.",
                    e,
                )
                _mark_cloudflare_degraded()
                return None
            # Connection successful — clear degraded state
            _mark_cloudflare_healthy()
            # Anti-self-grant: when a public key is configured, a forged or
            # replayed `valid:true` is rejected here before it can entitle anything.
            if result.get("valid") and not _verify_response_signature(result):
                return {"valid": False, "reason": "signature_invalid"}
            return result
    except Exception as e:
        logger.warning(f"Licence server unreachable: {e}")
        # Task 08: Mark first failure time for cutoff tracking
        _mark_cloudflare_degraded()
        return None


# Routes that must remain reachable even when licence validation fails hard.
# Authentication must never depend on the licence server being healthy, and
# the licence-status route itself has to stay readable so the UI can explain
# the problem. Matched with str.startswith, so this covers /api/v1/auth/login,
# /api/v1/auth/me, /api/v1/auth/change-password, etc.
_LICENCE_EXEMPT_PREFIXES = (
    "/api/v1/auth",
    "/api/v1/licence",
    "/api/v1/system/update",  # security/licence fixes must install even on a lapsed licence
)


# Feature flag route mapping — routes requiring specific licence features.
# Feature keys must match the features dict returned by the licence manifest.
# All other routes are gated by enabled_modules / enabled_menu_items (frontend)
# or RBAC (per-endpoint dependency) rather than the features dict.
FEATURE_ROUTE_MAP: dict[str, str] = {
    # Longer prefixes first for correct startswith matching.
    # cleaning/exceptions/analytics/contracts/notifications/systems/sync/
    # master-records/stewardship/glossary/relationships/match-rules/mdm-metrics/ai
    # used to map to feature keys ("cleaning", "mdm", "ai_features", ...) that
    # were never part of TenantFeatures — no tenant, on any tier, could ever
    # have them enabled, so those routes 402'd for every customer. They're
    # gated by enabled_modules/enabled_menu_items (frontend) and RBAC
    # (per-endpoint require_permission + tenant isolation) instead, per this
    # map's own original intent.
    "/api/v1/cleaning/export": "export_reports",
    "/api/v1/reports": "export_reports",
    "/api/v1/sync-trigger": "run_sync",
}


def _features_to_list(features) -> list[str]:
    """Normalise the manifest `features` field to a list of enabled keys.

    Accepts the new dict form ({feat: bool}) or legacy list form. Empty/missing
    means "no explicit feature list" → ["*"] so the feature gate is a no-op and
    entitlement falls to enabled_modules. NEVER returns ["*"] as a security
    grant — it only disables the feature-level gate.
    """
    if isinstance(features, list):
        return features
    if isinstance(features, dict) and features:
        return [k for k, v in features.items() if v]
    return ["*"]


def _check_feature_gate(path: str, licensed_features: list[str]) -> JSONResponse | None:
    """Return a 402 response if the route requires a feature not in the licence."""
    if "*" in licensed_features:
        return None
    for route_prefix, feature in FEATURE_ROUTE_MAP.items():
        if path.startswith(route_prefix):
            if feature not in licensed_features:
                return JSONResponse(
                    {
                        "error": "feature_not_licenced",
                        "feature": feature,
                        "upgrade_url": "https://meridian-hq.vantax.co.za/upgrade",
                    },
                    status_code=402,
                )
            break
    return None


def enforce_licensed_modules(request: Request, requested: list[str]) -> None:
    """Reject any requested SAP module the licence does not entitle.

    The middleware sets request.state.licensed_modules from the validated
    manifest but nothing consumed it — a tenant licensed for one module could
    extract/upload all 29. This is the real entitlement boundary: it runs where
    module-scoped data ENTERS the system (extract, upload). "*" entitles all.

    Raises HTTPException(402) listing the unlicensed modules. Caller is a route,
    so the short message is safe to surface (no stack trace).
    """
    from fastapi import HTTPException

    licensed = getattr(request.state, "licensed_modules", None)
    if licensed is None or "*" in licensed:
        return
    unlicensed = [m for m in requested if m not in licensed]
    if unlicensed:
        raise HTTPException(
            status_code=402,
            detail={
                "error": "module_not_licenced",
                "modules": unlicensed,
                "upgrade_url": "https://meridian-hq.vantax.co.za/upgrade",
            },
        )


def _within_grace(expiry: str | None) -> bool:
    if not expiry:
        return False
    try:
        exp = datetime.fromisoformat(str(expiry).replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return time.time() < exp.timestamp() + EXPIRY_GRACE_SECONDS


async def _serve_entitled(request: Request, call_next, manifest: dict):
    """Attach the manifest's entitlements to the request, apply the feature gate, continue."""
    request.state.licensed_modules = manifest.get("enabled_modules") or manifest.get("modules", [])
    request.state.licensed_features = _features_to_list(manifest.get("features", {}))
    request.state.licence_manifest = manifest
    feature_block = _check_feature_gate(request.url.path, request.state.licensed_features)
    if feature_block:
        return feature_block
    return await call_next(request)


class LicenceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only check /api/v1/* routes
        if not request.url.path.startswith("/api/v1"):
            return await call_next(request)

        # Authentication and licence-status routes are NEVER licence-gated.
        # The degradation cutoff returns 403 on the gated path; if it also
        # covered /auth/login, any HQ-side outage or misconfigured
        # LICENCE_SERVER_URL would lock every user out of the product — unable
        # to even sign in or read why. Feature/module gating still applies to
        # all other routes, so the anti-piracy cutoff keeps biting where it
        # should (the licensed features), just not the front door.
        if request.url.path.startswith(_LICENCE_EXEMPT_PREFIXES):
            return await call_next(request)

        # Development only: no key → everything entitled. In any other
        # deployment a missing key is a missing licence, not a bypass.
        if not settings.licence_key and settings.env == "development":
            request.state.licensed_modules = ["*"]
            request.state.licensed_features = ["*"]
            return await call_next(request)

        # Check in-memory cache
        now = time.time()
        if _cache["response"] and _cache["expires_at"] > now:
            cached = _cache["response"]
            if cached.get("valid"):
                response = await _serve_entitled(request, call_next, cached)
                if _cache.get("grace"):
                    response.headers["X-Licence-Warning"] = "expired_grace"
                return response
            else:
                return JSONResponse(
                    {"error": "licence_invalid", "reason": cached.get("reason")},
                    status_code=402,
                )

        # Cache miss — call licence server
        result = await _validate_licence()

        if result is None:
            # Licence server unreachable. FAIL CLOSED — granting ["*"] here let
            # anyone bypass licensing entirely by blocking the licence server
            # (firewall it, or never configure it). Degrade ONLY on a licence
            # this deployment previously validated, using its LAST KNOWN
            # entitlements, and only inside the degradation grace window. No
            # prior valid licence (fresh boot, never validated) → deny.
            last_known = _cache.get("response")
            if (
                last_known
                and last_known.get("valid")
                and not is_cloudflare_unreachable()
            ):
                logger.warning(
                    "Licence server unreachable — running degraded on the last "
                    "validated licence's entitlements"
                )
                return await _serve_entitled(request, call_next, last_known)
            logger.error(
                "Licence server unreachable and no valid cached licence — denying"
            )
            return JSONResponse(
                {"error": "licence_unverified", "reason": "licence_server_unreachable"},
                status_code=403,
            )

        # Task 08: Check cutoff rejection reason
        if result.get("reason") == "licence_server_unreachable_cutoff":
            return JSONResponse(
                {"error": "licence_server_cutoff", "reason": "Licence server unreachable for >2hrs. Please restore connection."},
                status_code=403,
            )

        if not result.get("valid"):
            reason = result.get("reason", "unknown")
            last_known = _cache.get("response")
            # Grace: HQ says the licence expired less than 7 days ago. Keep the
            # last SIGNED entitlements, bounded by that manifest's own expiry
            # date (not by the unsigned grace timestamp), and warn every caller.
            if reason == "expired_grace" and last_known and last_known.get("valid") \
                    and _within_grace(last_known.get("expiry_date") or last_known.get("expiresAt")):
                _manifest_cache.update({"status": "expired_grace",
                                        "grace_period_ends": result.get("grace_period_ends")})
                _cache["expires_at"] = now + INVALID_CACHE_TTL_SECONDS
                _cache["grace"] = True
                response = await _serve_entitled(request, call_next, last_known)
                response.headers["X-Licence-Warning"] = "expired_grace"
                return response
            _cache["response"] = result
            _cache["expires_at"] = now + INVALID_CACHE_TTL_SECONDS
            _cache["grace"] = False
            _manifest_cache.update({"valid": False, "status": reason})
            return JSONResponse({"error": "licence_invalid", "reason": reason}, status_code=402)

        # Cache the result
        _cache["response"] = result
        _cache["expires_at"] = now + CACHE_TTL_SECONDS
        _cache["grace"] = False

        # Populate full manifest cache for GET /api/v1/licence
        _update_manifest_cache(result)
        # Sync rules and field mappings from manifest asynchronously
        _sync_manifest_to_db(result)
        return await _serve_entitled(request, call_next, result)
