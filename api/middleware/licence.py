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

CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours
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
        elif licence_secret and "signature" not in data:
            # Secret is set but file has no signature — legacy format, treat as payload
            payload = data
        else:
            # No secret configured — trust the file as-is (legacy behavior)
            payload = data.get("payload", data)

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


def is_licence_degraded() -> bool:
    """Check if offline licence failures have exceeded the 48h cutoff.

    After 48h of consecutive failures: refuse new analysis jobs,
    keep dashboard and existing data accessible.
    """
    if _first_failure_at is None or _consecutive_failures == 0:
        return False
    return (time.time() - _first_failure_at) > FAILURE_CUTOFF_SECONDS


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
    """Background thread: upsert rules and field_mappings into local DB."""
    try:
        from sqlalchemy import create_engine, text
        from api.config import settings as _settings

        engine = create_engine(_settings.database_url_sync)
        with engine.connect() as conn:
            # Sync rules — upsert by rule id, mark source='hq'
            for rule in rules:
                rule_id = rule.get("id")
                if not rule_id:
                    continue
                conn.execute(
                    text("""
                        INSERT INTO rules_hq_cache (id, name, description, module, category, severity, enabled, conditions, thresholds, tags, source, updated_at)
                        VALUES (:id, :name, :description, :module, :category, :severity, :enabled, :conditions, :thresholds, :tags, 'hq', NOW())
                        ON CONFLICT(id) DO UPDATE SET
                            name = EXCLUDED.name,
                            description = EXCLUDED.description,
                            module = EXCLUDED.module,
                            category = EXCLUDED.category,
                            severity = EXCLUDED.severity,
                            enabled = EXCLUDED.enabled,
                            conditions = EXCLUDED.conditions,
                            thresholds = EXCLUDED.thresholds,
                            tags = EXCLUDED.tags,
                            updated_at = EXCLUDED.updated_at
                    """),
                    {
                        "id": rule_id,
                        "name": rule.get("name", ""),
                        "description": rule.get("description"),
                        "module": rule.get("module", ""),
                        "category": rule.get("category", ""),
                        "severity": rule.get("severity", "medium"),
                        "enabled": rule.get("enabled", True),
                        "conditions": json.dumps(rule.get("conditions", [])),
                        "thresholds": json.dumps(rule.get("thresholds", {})),
                        "tags": json.dumps(rule.get("tags", [])),
                    },
                )

            # Sync field mappings
            for fm in field_mappings:
                if not fm.get("tenant_id") or not fm.get("module") or not fm.get("standard_field"):
                    continue
                conn.execute(
                    text("""
                        INSERT INTO field_mappings (id, tenant_id, module, standard_field, standard_label, customer_field, customer_label, data_type, is_mapped, notes, updated_at)
                        VALUES (:id, :tenant_id, :module, :standard_field, :standard_label, :customer_field, :customer_label, :data_type, :is_mapped, :notes, NOW())
                        ON CONFLICT (tenant_id, module, standard_field) DO UPDATE SET
                            standard_label = EXCLUDED.standard_label,
                            customer_field = EXCLUDED.customer_field,
                            customer_label = EXCLUDED.customer_label,
                            data_type = EXCLUDED.data_type,
                            is_mapped = EXCLUDED.is_mapped,
                            notes = EXCLUDED.notes,
                            updated_at = EXCLUDED.updated_at
                    """),
                    {
                        "id": fm.get("id", str(uuid.uuid4())),
                        "tenant_id": fm.get("tenant_id"),
                        "module": fm.get("module"),
                        "standard_field": fm.get("standard_field"),
                        "standard_label": fm.get("standard_label"),
                        "customer_field": fm.get("customer_field"),
                        "customer_label": fm.get("customer_label"),
                        "data_type": fm.get("data_type", "string"),
                        "is_mapped": fm.get("is_mapped", False),
                        "notes": fm.get("notes"),
                    },
                )
            conn.commit()
            logger.info(f"Synced {len(rules)} rules and {len(field_mappings)} field mappings from licence manifest")
    except Exception as e:
        logger.warning(f"Failed to sync manifest to DB: {e}")


async def _validate_licence() -> dict | None:
    """Call the licence server or read offline file. Returns the response dict or None on failure."""
    global _last_checked_at
    _last_checked_at = time.time()

    # Offline mode: skip network call entirely
    licence_mode = os.getenv("LICENCE_MODE", "online")
    if licence_mode == "offline":
        return _read_offline_licence()

    # Check offline licence file first (legacy support)
    offline = _read_offline_licence()
    if offline is not None:
        return offline

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.licence_server_url}/validate",
                json={
                    "licenceKey": settings.licence_key,
                    "machineFingerprint": _get_machine_fingerprint(),
                },
            )
            return resp.json()
    except Exception as e:
        logger.warning(f"Licence server unreachable: {e}")
        return None


# Feature flag route mapping — routes requiring specific licence features.
# Feature keys must match the features dict returned by the licence manifest.
# All other routes are gated by enabled_modules / enabled_menu_items (frontend)
# or RBAC (per-endpoint dependency) rather than the features dict.
FEATURE_ROUTE_MAP: dict[str, str] = {
    # Phase A-G routes (longer prefixes first for correct startswith matching)
    "/api/v1/cleaning/export": "export_reports",
    "/api/v1/cleaning": "cleaning",
    "/api/v1/exceptions": "exceptions",
    "/api/v1/analytics": "analytics",
    "/api/v1/nlp": "nlp",
    "/api/v1/contracts": "contracts",
    "/api/v1/notifications": "notifications",
    "/api/v1/reports": "export_reports",
    "/api/v1/sync-trigger": "run_sync",
    # Phase H-O MDM routes
    "/api/v1/systems": "mdm",
    "/api/v1/sync": "mdm",  # must be after /api/v1/sync-trigger
    "/api/v1/master-records": "mdm",
    "/api/v1/stewardship": "mdm",
    "/api/v1/glossary": "mdm",
    "/api/v1/relationships": "mdm",
    "/api/v1/match-rules": "mdm",
    "/api/v1/mdm-metrics": "mdm",
    # AI features
    "/api/v1/ai": "ai_features",
}


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


class LicenceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only check /api/v1/* routes
        if not request.url.path.startswith("/api/v1"):
            return await call_next(request)

        # Dev mode — skip validation if no licence key and AUTH_MODE=local
        if not settings.licence_key and settings.auth_mode == "local":
            request.state.licensed_modules = ["*"]
            request.state.licensed_features = ["*"]
            return await call_next(request)

        # Check in-memory cache
        now = time.time()
        if _cache["response"] and _cache["expires_at"] > now:
            cached = _cache["response"]
            if cached.get("valid"):
                enabled_modules = cached.get("enabled_modules") or cached.get("modules", [])
                features = cached.get("features", {})
                if isinstance(features, list):
                    licensed_features = features
                else:
                    licensed_features = [k for k, v in features.items() if v] if features else ["*"]
                request.state.licensed_modules = enabled_modules
                request.state.licensed_features = licensed_features
                request.state.licence_manifest = cached
                # Check feature gate
                feature_block = _check_feature_gate(request.url.path, licensed_features)
                if feature_block:
                    return feature_block
                return await call_next(request)
            else:
                return JSONResponse(
                    {"error": "licence_invalid", "reason": cached.get("reason")},
                    status_code=402,
                )

        # Cache miss — call licence server
        result = await _validate_licence()

        if result is None:
            # Licence server unreachable — graceful degradation
            logger.warning("Licence server unreachable — allowing request through")
            request.state.licensed_modules = ["*"]
            request.state.licensed_features = ["*"]
            return await call_next(request)

        # Cache the result
        _cache["response"] = result
        _cache["expires_at"] = now + CACHE_TTL_SECONDS

        if result.get("valid"):
            enabled_modules = result.get("enabled_modules") or result.get("modules", [])
            features = result.get("features", {})
            # features may be a dict (new format) or list (legacy format)
            if isinstance(features, list):
                licensed_features = features
            else:
                # Convert dict features to list of enabled feature keys for legacy gate check
                licensed_features = [k for k, v in features.items() if v] if features else ["*"]

            request.state.licensed_modules = enabled_modules
            request.state.licensed_features = licensed_features
            request.state.licence_manifest = result

            # Populate full manifest cache for GET /api/v1/licence
            _update_manifest_cache(result)

            # Sync rules and field mappings from manifest asynchronously
            _sync_manifest_to_db(result)

            # Check feature gate
            feature_block = _check_feature_gate(request.url.path, licensed_features)
            if feature_block:
                return feature_block
            return await call_next(request)
        else:
            reason = result.get("reason", "unknown")
            if reason == "expired_grace":
                # Grace period — update manifest cache but still allow through with warning
                _update_manifest_cache(result)
            return JSONResponse(
                {"error": "licence_invalid", "reason": reason},
                status_code=402,
            )
