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

# Offline grace (PC-14). When HQ is unreachable, the last valid SIGNED online response is honoured for
# settings.licence_offline_grace_days (14) after it was signed, with a logged warning, the response header
# X-Licence-Warning: offline_grace and status "offline_grace" on GET /api/v1/licence. Past that, gated routes
# lock (403 licence_server_cutoff) until HQ answers again.
_degraded_at: Optional[float] = None  # When Cloudflare became unreachable
LICENCE_DEGRADED_CUTOFF_SECONDS = settings.licence_offline_grace_days * 24 * 60 * 60

# The last online response whose Ed25519 signature verified, kept with its signature (and on disk at
# settings.licence_state_path) so it can be re-verified when HQ is unreachable.
_last_signed: Optional[dict] = None

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
    # HQ unreachable and running on the last signed licence: when it was signed, when the grace ends, days left
    result["offline_grace"] = _manifest_cache.get("offline_grace") if _cache.get("offline_grace") else None

    return result


def _offline_payload_bytes(payload: dict) -> bytes:
    """The bytes an offline licence file's signature covers: its payload as sorted-key JSON."""
    return json.dumps(payload, sort_keys=True).encode()


def _offline_signature_ok(data: dict) -> tuple[bool, str]:
    """(valid, reason) for an offline licence file ``{payload, signature, signature_alg}``.

    Ed25519 by the vendor key (api/middleware/licence_keys.py) is the only accepted signature. The old
    HMAC-SHA256 over LICENCE_SECRET (a secret the customer holds, so it proves nothing) is accepted only while
    settings.licence_allow_legacy_signatures is on, and every acceptance is logged."""
    from api.middleware import licence_keys

    payload, sig = data.get("payload"), data.get("signature")
    if not isinstance(payload, dict) or not sig:
        return False, "unsigned_licence"
    alg = str(data.get("signature_alg") or "HMAC-SHA256")
    if alg == "Ed25519":
        try:
            raw = base64.b64decode(str(sig), validate=True)
        except (ValueError, TypeError):
            return False, "invalid_signature"
        return (True, "") if licence_keys.verify(raw, _offline_payload_bytes(payload)) else (False, "invalid_signature")
    if not settings.licence_allow_legacy_signatures:
        logger.error("Offline licence is signed with %s, which is no longer accepted; ask Meridian HQ for an "
                     "Ed25519-signed licence", alg)
        return False, "legacy_signature_rejected"
    secret = os.getenv("LICENCE_SECRET", "")
    if not secret:
        return False, "unsigned_licence"
    expected = hmac_mod.new(secret.encode(), _offline_payload_bytes(payload), hashlib.sha256).hexdigest()
    if not hmac_mod.compare_digest(str(sig), expected):
        return False, "invalid_signature"
    logger.warning("Offline licence accepted on a LEGACY HMAC signature (transition window: "
                   "MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES is on). Replace it with an Ed25519-signed licence.")
    return True, ""


def _read_offline_licence() -> dict | None:
    """Read licence from a local JSON file for air-gapped deployments.

    Requires LICENCE_MODE=offline. The file is ``{payload, signature, signature_alg: "Ed25519"}``, signed by
    Meridian HQ's private key and verified against the vendor public key compiled into the image; an unsigned
    file, or one signed any other way, grants nothing (see _offline_signature_ok for the legacy window).
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
        licence_path = settings.licence_file or os.getenv("LICENCE_FILE_PATH", "/etc/meridian/licence.json")

    try:
        with open(licence_path, "r") as f:
            data = json.load(f)

        ok, reason = _offline_signature_ok(data if isinstance(data, dict) else {})
        if not ok:
            if reason == "unsigned_licence":
                logger.warning("Offline licence is unsigned — rejecting")
            else:
                logger.warning(f"Offline licence signature rejected: {reason}")
                _consecutive_failures += 1
                if _first_failure_at is None:
                    _first_failure_at = time.time()
            return {"valid": False, "reason": reason}
        payload = data["payload"]

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
        logger.warning(f"Failed to read offline licence file: {type(e).__name__}")
        _consecutive_failures += 1
        if _first_failure_at is None:
            _first_failure_at = time.time()
        return None


def _decode_offline_token(token: str) -> dict:
    """The claims of an offline licence JWT. EdDSA (Ed25519) against the compiled vendor keys; the old RS256
    against MERIDIAN_OFFLINE_PUBLIC_KEY only inside the legacy window. Raises pyjwt.PyJWTError otherwise."""
    import jwt as pyjwt

    from api.middleware import licence_keys

    alg = pyjwt.get_unverified_header(token).get("alg")
    opts = {"require": ["exp", "tenant_id", "iss"]}
    if alg == "EdDSA":
        last: Exception = pyjwt.InvalidSignatureError("no vendor key")
        for key in licence_keys.public_keys():
            try:
                return pyjwt.decode(token, key, algorithms=["EdDSA"], issuer="meridian-hq", options=opts)
            except pyjwt.InvalidSignatureError as e:
                last = e
        raise last
    if alg == "RS256" and settings.licence_allow_legacy_signatures:
        # A PEM in .env is usually one line with \n escapes; restore the line breaks.
        pem = os.getenv("MERIDIAN_OFFLINE_PUBLIC_KEY", "").strip().strip('"').replace("\\n", "\n")
        if not pem:
            raise pyjwt.InvalidKeyError("no legacy public key")
        claims = pyjwt.decode(token, pem, algorithms=["RS256"], issuer="meridian-hq", options=opts)
        logger.warning("Offline licence token accepted on a LEGACY RS256 signature with a key from .env "
                       "(transition window: MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES is on).")
        return claims
    raise pyjwt.InvalidAlgorithmError(f"offline licence token algorithm {alg!r} is not accepted")


def _read_offline_token() -> dict | None:
    """Verify HQ's offline licence JWT (MERIDIAN_LICENCE_TOKEN), EdDSA-signed by the vendor key.

    Issued by POST /api/admin/tenants/:id/offline-token (or scripts/issue_offline_licence.py) and verified
    against the vendor public key compiled into the image. None when no token is set.
    """
    token = os.getenv("MERIDIAN_LICENCE_TOKEN", "").strip()
    if not token:
        return None
    import jwt as pyjwt

    try:
        claims = _decode_offline_token(token)
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
    """True once the licence server has been unreachable for longer than the offline grace (14 days).

    Inside that window the deployment runs on the last valid signed response (offline_grace_manifest), which
    is itself bounded by its own signature time, so a stale or forged response never extends it.
    """
    if _degraded_at is None:
        return False
    elapsed = time.time() - _degraded_at
    if elapsed > LICENCE_DEGRADED_CUTOFF_SECONDS:
        logger.error(f"Licence server unreachable for {elapsed:.0f}s (offline grace: {LICENCE_DEGRADED_CUTOFF_SECONDS}s).")
        return True
    return False


def _mark_cloudflare_degraded() -> None:
    """Record that Cloudflare has become unreachable.
    
    Called on first connection failure. Starts the 2-hour grace period clock.
    """
    global _degraded_at
    if _degraded_at is None:
        _degraded_at = time.time()
        logger.warning("Licence server marked as unreachable. Running on the last signed licence for at most "
                       f"{settings.licence_offline_grace_days} days after it was signed (offline grace).")


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
        "min_version": result.get("min_version") or "",
        "force_update_now": bool(result.get("force_update_now")),
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

        from api.deps import deployment_tenant_id
        from workers.db import get_sync_engine

        local_tid = str(deployment_tenant_id())
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
# The worker signs every valid licence response with the vendor's Ed25519 private key (a Cloudflare worker
# secret). A customer holding the image could otherwise MITM their own licence check and forge `valid:true`;
# an HMAC wouldn't stop them (they'd hold the secret), so we verify against the vendor PUBLIC key compiled into
# the image (api/middleware/licence_keys.py). Enforcement is always on: a valid response without a valid
# signature is rejected (fail closed). The old RSA signature with a key from .env is accepted only inside the
# legacy window (settings.licence_allow_legacy_signatures, default off), and every such acceptance is logged.

# 7 days — matches the worker's expiry grace window. Bounds replay of a captured
# response to this window; after it, the stale signature is rejected.
LICENCE_SIGNATURE_MAX_AGE = int(
    os.getenv("LICENCE_SIGNATURE_MAX_AGE_SECONDS", str(7 * 24 * 60 * 60))
)
CANONICAL_V1 = "meridian-licence-v1"  # legacy RSA signature
CANONICAL_V2 = "meridian-licence-v2"  # Ed25519 signature (signature_ed25519)


def _entitlement_canonical(result: dict, signed_at, version: str = CANONICAL_V1) -> bytes:
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
        version,
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
    """The legacy RSA public key from .env (LICENCE_SERVER_PUBLIC_KEY), honoured only in the legacy window."""
    pem = os.getenv("LICENCE_SERVER_PUBLIC_KEY")
    if not pem:
        return None
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    return load_pem_public_key(pem.strip().strip('"').replace("\\n", "\n").encode())


def _verify_legacy_rsa(result: dict, signed_at) -> bool:
    if not settings.licence_allow_legacy_signatures:
        return False
    pub = _licence_public_key()
    sig_b64 = result.get("signature")
    if pub is None or not sig_b64:
        return False
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    try:
        pub.verify(base64.b64decode(sig_b64), _entitlement_canonical(result, signed_at), padding.PKCS1v15(),
                   hashes.SHA256())
    except (InvalidSignature, ValueError, TypeError):
        return False
    logger.warning("Licence response accepted on a LEGACY RSA signature with a key from .env (transition "
                   "window: MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES is on).")
    return True


def _verify_response_signature(result: dict, max_age: Optional[int] = None) -> bool:
    """True only when the response carries a valid, fresh Ed25519 signature by the vendor key over its
    entitlement fields, bound to this node's fingerprint. Fail closed: missing, stale, cross-node or invalid
    signatures are rejected. ``max_age`` (seconds since signing) defaults to LICENCE_SIGNATURE_MAX_AGE."""
    from api.middleware import licence_keys

    signed_at = result.get("signed_at")
    if signed_at is None:
        logger.error("Licence response is unsigned — rejecting")
        return False
    try:
        age = time.time() - float(signed_at)
    except (TypeError, ValueError):
        return False
    if abs(age) > (LICENCE_SIGNATURE_MAX_AGE if max_age is None else max_age):
        logger.error("Licence response signature stale — rejecting")
        return False

    # Node binding: a response captured for another node carries that node's
    # fingerprint and will not match ours.
    echoed_fp = result.get("machine_fingerprint") or ""
    if echoed_fp and echoed_fp != _get_machine_fingerprint():
        logger.error("Licence response fingerprint mismatch — rejecting")
        return False

    sig_b64 = result.get("signature_ed25519")
    if not sig_b64:
        if _verify_legacy_rsa(result, signed_at):
            return True
        logger.error("Licence response carries no Ed25519 signature — rejecting")
        return False
    try:
        raw = base64.b64decode(str(sig_b64), validate=True)
    except (ValueError, TypeError):
        return False
    if licence_keys.verify(raw, _entitlement_canonical(result, signed_at, CANONICAL_V2)):
        return True
    logger.error("Licence response signature invalid — rejecting")
    return False


# ── Offline grace: the last signed response, re-verified ──────────────────────

def _grace_seconds() -> int:
    return settings.licence_offline_grace_days * 24 * 60 * 60


def _remember_signed(result: dict) -> None:
    """Keep a verified online response (with its signature) for the offline grace, in memory and on disk."""
    global _last_signed
    _last_signed = dict(result)
    try:
        path = settings.licence_state_path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_last_signed, f)
        os.replace(tmp, path)
    except OSError as e:  # best effort: the in-memory copy still serves this process
        logger.info(f"Could not keep the signed licence on disk ({type(e).__name__}); the offline grace "
                    "holds for this process only")


def _load_signed() -> Optional[dict]:
    """The last signed response: this process's, else the copy on disk."""
    if _last_signed is not None:
        return _last_signed
    try:
        with open(settings.licence_state_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def offline_grace_manifest() -> Optional[dict]:
    """The last valid signed online response when its signature still verifies inside the offline grace
    (signed at most settings.licence_offline_grace_days ago, for this node); None otherwise."""
    last = _load_signed()
    if not last or not last.get("valid") or _grace_seconds() <= 0:
        return None
    if not _verify_response_signature(last, max_age=_grace_seconds()):
        return None
    return last


def offline_grace_status(manifest: dict) -> dict:
    """The visible status of a grace manifest: when it was signed, when the grace ends and days left."""
    signed_at = float(manifest.get("signed_at") or 0)
    ends = signed_at + _grace_seconds()
    return {
        "active": True,
        "signed_at": datetime.fromtimestamp(signed_at, tz=timezone.utc).isoformat(),
        "ends_at": datetime.fromtimestamp(ends, tz=timezone.utc).isoformat(),
        "days_left": max(0, int((ends - time.time()) // 86400)),
        "grace_days": settings.licence_offline_grace_days,
    }


async def _validate_licence() -> dict | None:
    """Call the licence server or read offline file. Returns the response dict or None on failure."""
    global _last_checked_at
    _last_checked_at = time.time()

    # Offline / air-gapped: never touch the network. HQ's signed token first,
    # then the signed licence file.
    if settings.licence_mode in ("offline", "airgap"):
        return _read_offline_token() or _read_offline_licence()

    # Always try HQ, even past the offline grace: the first answer it gives ends the lock.
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
            # Anti-self-grant: a forged, replayed or unsigned `valid:true` is
            # rejected here before it can entitle anything.
            if result.get("valid"):
                if not _verify_response_signature(result):
                    return {"valid": False, "reason": "signature_invalid"}
                _remember_signed(result)
            return result
    except Exception as e:
        logger.warning(f"Licence server unreachable: {type(e).__name__}")
        # Starts the offline-grace clock
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
    "/api/v1/theme",  # the sign-in page's theme renders before anyone signs in, licence or not
    "/api/v1/status/page",  # the status page explains an outage, a lapsed licence included
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
                        "detail": "This feature is not included in this deployment's licence.",
                        "upgrade_url": "https://meridian-hq.vantax.co.za/upgrade",
                    },
                    status_code=402,
                )
            break
    return None


def feature_licensed(feature: str) -> bool:
    """Whether the licence entitles ``feature``, for code outside a request (Celery workers).

    Decided as LicenceMiddleware.dispatch decides a gated route: the development bypass, the cached
    result while fresh, else a revalidation; when HQ is unreachable, the last validated licence inside
    the degradation window; otherwise closed. Synchronous: never call it from a running event loop."""
    if not settings.licence_key and settings.env == "development":
        return True
    if _cache["response"] and _cache["expires_at"] > time.time():
        manifest = _cache["response"]
        if not manifest.get("valid"):
            return False
    else:
        import asyncio

        result, outcome = asyncio.run(revalidate())
        if result is None or outcome in ("cutoff", "invalid"):
            return False
        manifest = _cache["response"] if outcome == "grace" else result
    features = _features_to_list(manifest.get("features", {}))
    return "*" in features or feature in features


def enforce_licensed_modules(request: Request, requested: list[str]) -> None:
    """Reject any requested SAP module the licence does not entitle.

    The middleware sets request.state.licensed_modules from the validated
    manifest but nothing consumed it — a tenant licensed for one module could
    extract/upload all 29. This is the real entitlement boundary: it runs where
    module-scoped data ENTERS the system (extract, upload). "*" entitles all.

    Raises HTTPException(402) listing the unlicensed modules. Caller is a route,
    so the short message is safe to surface (no stack trace). ``detail`` carries
    the human sentence inside the object: an object with only machine keys read
    as "Could not reach the server." in every UI surface, hiding an entitlement
    refusal behind a fake network fault (a discovery run on a licence without
    quality_management looked like the server being down).
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
                "detail": f"This deployment's licence does not include: {', '.join(unlicensed)}. "
                          "Ask your administrator to add it in Meridian HQ.",
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


def _record_validation(result: dict) -> str:
    """Apply a validation result to the in-memory caches.

    Returns the outcome: ``cutoff`` (HQ unreachable past the hard cutoff, caches
    untouched), ``grace`` (expired less than 7 days ago: the last signed
    entitlements stay in ``_cache``), ``invalid`` or ``valid``.
    """
    now = time.time()
    if result.get("reason") == "licence_server_unreachable_cutoff":
        return "cutoff"
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
            return "grace"
        _cache["response"] = result
        _cache["expires_at"] = now + INVALID_CACHE_TTL_SECONDS
        _cache["grace"] = False
        _cache["offline_grace"] = False
        _manifest_cache.update({"valid": False, "status": reason, "offline_grace": None})
        return "invalid"

    _cache["response"] = result
    _cache["expires_at"] = now + CACHE_TTL_SECONDS
    _cache["grace"] = False
    _cache["offline_grace"] = False
    # Populate full manifest cache for GET /api/v1/licence
    _update_manifest_cache(result)
    _manifest_cache["offline_grace"] = None
    # Sync rules and field mappings from manifest asynchronously
    _sync_manifest_to_db(result)
    return "valid"


def _record_offline_grace(manifest: dict) -> None:
    """Serve the last signed response while HQ is unreachable: retried every minute, flagged everywhere."""
    status = offline_grace_status(manifest)
    logger.warning("Licence server unreachable: running on the last signed licence (offline grace, %s days "
                   "left, ends %s). Restore access to the licence server.", status["days_left"], status["ends_at"])
    _cache["response"] = manifest
    _cache["expires_at"] = time.time() + INVALID_CACHE_TTL_SECONDS
    _cache["grace"] = False
    _cache["offline_grace"] = True
    if not _manifest_cache or _manifest_cache.get("tenant_id") != (manifest.get("tenant_id") or manifest.get("tenantId")):
        _update_manifest_cache(manifest)
    _manifest_cache.update({"valid": True, "status": "offline_grace", "offline_grace": status})


async def revalidate() -> tuple[dict | None, str]:
    """Validate with the licence server now and refresh the caches.

    Used by the middleware on a cache miss and by POST /api/v1/licence/validate.
    When the server cannot be reached: ``(manifest, "offline_grace")`` while the last signed response still
    verifies inside the offline grace; ``(None, "cutoff")`` once a licence this node held has run out of
    grace; ``(None, "unreachable")`` when it never held one.
    """
    result = await _validate_licence()
    if result is None:
        if settings.licence_mode not in ("offline", "airgap"):
            grace = offline_grace_manifest()
            if grace is not None:
                _record_offline_grace(grace)
                return grace, "offline_grace"
            if _load_signed() is not None or is_cloudflare_unreachable():
                _manifest_cache.update({"valid": False, "status": "licence_server_unreachable_cutoff",
                                        "offline_grace": None})
                return None, "cutoff"
        return None, "unreachable"
    return result, _record_validation(result)


# A licence lock blocks every gated route, so its body says so in ``detail`` (the field every UI surface shows);
# without it the frontend read a lock as "Could not reach the server." or "You do not have access to this."
LICENCE_LOCK_DETAIL: dict[str, str] = {
    "licence_invalid": "This deployment's licence is not valid ({reason}). Ask your administrator to renew it in Meridian HQ.",
    "licence_unverified": "Meridian could not reach Meridian HQ to validate its licence, so features stay locked "
                          "until it does. Check that the API can reach the licence server.",
    "licence_server_cutoff": "Meridian HQ has been unreachable for too long to keep running on the last licence. "
                             "Check that the API can reach the licence server.",
}


def licence_lock_response(error: str, reason: str | None, status_code: int) -> JSONResponse:
    """The 402/403 a licence lock answers with: ``error`` and ``reason`` for code, ``detail`` for people."""
    return JSONResponse(
        {"error": error, "reason": reason, "detail": LICENCE_LOCK_DETAIL[error].format(reason=reason or "unknown")},
        status_code=status_code,
    )


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
                elif _cache.get("offline_grace"):
                    response.headers["X-Licence-Warning"] = "offline_grace"
                return response
            else:
                return licence_lock_response("licence_invalid", cached.get("reason"), 402)

        # Cache miss — call licence server
        result, outcome = await revalidate()

        if outcome == "offline_grace" and result is not None:
            # HQ unreachable: the last signed licence, re-verified, inside its 14-day grace.
            response = await _serve_entitled(request, call_next, result)
            response.headers["X-Licence-Warning"] = "offline_grace"
            return response
        if outcome == "cutoff":
            return licence_lock_response("licence_server_cutoff", "licence_server_unreachable_cutoff", 403)
        if result is None:
            # Licence server unreachable and this node never held a signed licence. FAIL CLOSED: granting
            # anything here would let anyone bypass licensing by blocking the licence server.
            logger.error("Licence server unreachable and no signed licence to fall back on — denying")
            return licence_lock_response("licence_unverified", "licence_server_unreachable", 403)

        if outcome == "grace":
            response = await _serve_entitled(request, call_next, _cache["response"])
            response.headers["X-Licence-Warning"] = "expired_grace"
            return response
        if outcome == "invalid":
            return licence_lock_response("licence_invalid", result.get("reason", "unknown"), 402)
        return await _serve_entitled(request, call_next, result)
