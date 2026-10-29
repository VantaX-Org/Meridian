"""Support diagnostics: a bundle an administrator sends to support, and its JSON summary.

* ``GET /api/v1/support/diagnostics``      (manage_system) the JSON summary.
* ``GET /api/v1/support/diagnostics.zip``  (manage_system) a zip built in memory: summary.json, versions.json,
  licence.json, tenant_settings.json, systems.json, jobs.json, server_errors.json, health_samples.json,
  workers.json, environment.json and README.txt.

What it holds is chosen field by field (allow-lists, never "everything but"): versions (API, frontend, migration
head), the licence's validity, modules and seats (never the key), tenant settings without secrets (no SSO client
secret, no LLM key, no notification addresses), each system's type, release and health (never host, user, URL or
credentials), the last 200 jobs (status, kind, timing, a truncated error), the last 50 server-error references
with times and API area, 24 hours of health samples, live worker and queue state, and environment flags (the LLM
provider's name only). Never SAP data, never credentials, never a user's email: users appear as counts only. As a
last guard every file is scanned for the tenant's user emails and any hit is replaced before the zip is built.
Each download writes an audit row.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.routes.licence import seats_for
from api.routes.status_page import _components_now, area, incidents_24h
from api.services import health_probe
from api.services.api_keys import IS_SERVICE_EMAIL_SQL
from api.services.rbac import current_user_id, current_user_label, require_permission
from api.services.tenant_settings import set_rls
from api.services.version import APP_VERSION

router = APIRouter(prefix="/api/v1/support", tags=["support"])

JOB_FIELDS = ("id", "kind", "status", "stage", "percent", "rows_done", "rows_total", "started_at", "updated_at",
              "finished_at")
LICENCE_FIELDS = ("valid", "status", "tier", "expiry_date", "days_remaining", "enabled_modules", "last_validated",
                  "grace_period_ends", "seats", "max_users", "min_version", "latest_version")
SYSTEM_SQL = """
    SELECT id, system_type, sap_release, sap_product, environment, role, is_active, health_status,
           last_health_check, consecutive_failures, config_sync_status, config_last_synced_at, discovery_status
      FROM sap_systems WHERE tenant_id = :t ORDER BY created_at"""
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ERROR_MAX = 300


def _iso(v: Any) -> Any:
    return v.isoformat() if isinstance(v, datetime) else v


def frontend_version() -> Optional[str]:
    """frontend/package.json's version when this process can read it, else None (the API image has no frontend)."""
    candidates = [os.getenv("MERIDIAN_FRONTEND_PACKAGE_JSON") or "",
                  str(Path(__file__).resolve().parents[2] / "frontend" / "package.json"), "/app/frontend/package.json"]
    for c in candidates:
        try:
            if c and os.path.isfile(c):
                with open(c) as f:
                    v = json.load(f).get("version")
                return str(v) if v else None
        except (OSError, ValueError):
            continue
    return None


def _scrub(text_value: Optional[str]) -> Optional[str]:
    """A job error, truncated, with anything shaped like an email or a URL credential removed."""
    if not text_value:
        return None
    s = _EMAIL.sub("[email]", str(text_value))
    s = re.sub(r"://[^/@\s]+@", "://[credentials]@", s)
    return s[:ERROR_MAX]


def environment_flags(llm_provider: str) -> dict[str, Any]:
    from api.services.retention import purge_flag_enabled

    return {
        "env": settings.env, "auth_mode": settings.auth_mode, "licence_mode": settings.licence_mode,
        "llm_provider": llm_provider, "api_workers": settings.api_workers,
        "live_writeback_enabled": settings.live_writeback_enabled, "purge_enabled": purge_flag_enabled(),
        "credential_master_key_set": bool(settings.credential_master_key),
        "llm_kek_set": bool(os.getenv("LLM_KEK")), "sentry_configured": bool(settings.sentry_dsn),
        "updater_configured": bool(settings.updater_shared_secret),
        "email_backend": _email_backend(),
    }


def _email_backend() -> Optional[str]:
    try:
        from api.services.user_notifications import email_backend_name
        return email_backend_name()
    except Exception:  # noqa: BLE001 - optional facts: null when unreadable
        return None


async def _migration_head(db: AsyncSession) -> Optional[str]:
    try:
        return (await db.execute(text("SELECT string_agg(version_num, ',') FROM alembic_version"))).scalar()
    except Exception:  # noqa: BLE001 - optional facts: null when unreadable
        return None


async def _tenant_settings(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    row = (await db.execute(text(
        "SELECT name, licensed_modules, dqs_weights, alert_thresholds, retention, default_role, "
        "       sso_config IS NOT NULL, COALESCE((sso_config->>'enforce')::boolean, false), "
        "       llm_config->>'provider', cost_model IS NOT NULL, created_at "
        "  FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).fetchone()
    if not row:
        return {}
    weights = dict(row[2]) if isinstance(row[2], dict) else None
    if weights:
        weights.pop("notification_config", None)  # email address and webhook URL
    keys = (await db.execute(text("SELECT key, value, updated_at FROM tenant_settings WHERE tenant_id = :t ORDER BY key"),
                             {"t": str(tenant.id)})).fetchall()
    stored: dict[str, Any] = {}
    for k, v, at in keys:
        if k == "theme" and isinstance(v, dict):
            v = {"product_name_override": v.get("product_name_override"), "accent": v.get("accent"),
                 "accent_dark": v.get("accent_dark"), "has_logo": bool(v.get("logo"))}
        stored[k] = {"value": v, "updated_at": _iso(at)}
    return {"name": row[0], "licensed_modules": list(row[1] or []), "dqs_weights": weights,
            "alert_thresholds": row[3], "retention": row[4], "default_role": row[5],
            "sso": {"configured": bool(row[6]), "enforce": bool(row[7])}, "llm_provider_override": row[8],
            "cost_model_customised": bool(row[9]), "created_at": _iso(row[10]), "settings_keys": stored}


async def _user_counts(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    svc = IS_SERVICE_EMAIL_SQL.format(col="email")
    row = (await db.execute(text(
        f"SELECT count(*), count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE {svc}), "
        f"       count(*) FILTER (WHERE password_hash IS NULL AND NOT {svc}) "
        f"  FROM users WHERE tenant_id = :t"), {"t": str(tenant.id)})).fetchone()
    by_role = (await db.execute(text("SELECT role, count(*) FROM users WHERE tenant_id = :t AND is_active "
                                     "GROUP BY role ORDER BY role"), {"t": str(tenant.id)})).fetchall()
    scim = (await db.execute(text("SELECT count(*) FROM scim_users WHERE tenant_id = :t"),
                             {"t": str(tenant.id)})).scalar()
    return {"total": int(row[0]), "active": int(row[1]), "service_accounts": int(row[2]),
            "without_password": int(row[3]), "scim_provisioned": int(scim or 0),
            "active_by_role": {r: int(n) for r, n in by_role}}


async def _systems(db: AsyncSession, tenant: Tenant) -> list[dict[str, Any]]:
    rows = (await db.execute(text(SYSTEM_SQL), {"t": str(tenant.id)})).mappings().fetchall()
    return [{k: (str(v) if k == "id" and v else _iso(v)) for k, v in r.items()} for r in rows]


async def _server_errors(db: AsyncSession, tenant: Tenant) -> list[dict[str, Any]]:
    rows = (await db.execute(text(
        "SELECT entity_id, method, path, created_at FROM audit_log WHERE tenant_id = :t AND action = 'server_error' "
        "ORDER BY created_at DESC LIMIT 50"), {"t": str(tenant.id)})).fetchall()
    return [{"reference": r[0], "method": r[1], "area": area(r[2]), "at": _iso(r[3])} for r in rows]


async def _samples(db: AsyncSession, tenant: Tenant) -> list[dict[str, Any]]:
    rows = (await db.execute(text(
        "SELECT sampled_at, component, status, latency_ms FROM health_samples WHERE tenant_id = :t "
        "AND sampled_at >= :since ORDER BY sampled_at, component"),
        {"t": str(tenant.id), "since": datetime.now(timezone.utc) - timedelta(hours=24)})).fetchall()
    return [{"at": _iso(r[0]), "component": r[1], "status": r[2], "latency_ms": r[3]} for r in rows]


def _jobs(tenant_id: str) -> list[dict[str, Any]]:
    from api.services import jobs

    out = []
    for j in jobs.list_jobs(tenant_id, limit=200):
        item = {k: j.get(k) for k in JOB_FIELDS}
        item["error"] = _scrub(j.get("error"))
        item["system_id"] = j.get("system_id")
        item["version_id"] = j.get("version_id")
        out.append(item)
    return out


def _licence(seats_used: int, seat_limit: Optional[int]) -> dict[str, Any]:
    from api.middleware.licence import get_cached_manifest

    manifest = get_cached_manifest() or {}
    out = {k: manifest.get(k) for k in LICENCE_FIELDS}
    out["features"] = sorted(k for k, v in (manifest.get("features") or {}).items() if v) \
        if isinstance(manifest.get("features"), dict) else []
    out["seats_used"], out["seat_limit"] = seats_used, seat_limit
    out["key_configured"] = bool(settings.licence_key)
    return out


async def build(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    """Every part of the bundle, keyed by its file name (without .json)."""
    await set_rls(db, tenant.id)
    used, limit = await seats_for(db, tenant)
    await set_rls(db, tenant.id)
    tenant_settings = await _tenant_settings(db, tenant)
    users = await _user_counts(db, tenant)
    systems = await _systems(db, tenant)
    errors = await _server_errors(db, tenant)
    incidents = await incidents_24h(db, tenant.id)
    samples = await _samples(db, tenant)
    head = await _migration_head(db)
    emails = [r[0] for r in (await db.execute(text("SELECT email FROM users WHERE tenant_id = :t"),
                                              {"t": str(tenant.id)})).fetchall() if r[0]]
    jobs = await asyncio.to_thread(_jobs, str(tenant.id))
    comps = await asyncio.to_thread(_components_now)
    from workers.db import get_sync_engine

    provider, _ = await asyncio.to_thread(health_probe.llm_provider, get_sync_engine(), str(tenant.id))
    now = datetime.now(timezone.utc).isoformat()
    versions = {"api": APP_VERSION, "frontend": frontend_version(), "migrations_head": head}
    licence = _licence(used, limit)
    workers = {"status": health_probe.overall(comps), "components": [c.as_dict() for c in comps]}
    env = environment_flags(provider)
    by_status: dict[str, int] = {}
    for j in jobs:
        by_status[str(j.get("status"))] = by_status.get(str(j.get("status")), 0) + 1
    summary = {
        "generated_at": now, "tenant_id": str(tenant.id), "versions": versions,
        "licence": {k: licence.get(k) for k in ("valid", "status", "tier", "expiry_date", "seats_used", "seat_limit")},
        "users": users,
        "systems": {"count": len(systems), "by_type": _count(systems, "system_type"),
                    "by_health": _count(systems, "health_status")},
        "jobs": {"count": len(jobs), "by_status": by_status},
        "server_errors": {"last_24h": sum(i["count"] for i in incidents), "references_24h": len(incidents),
                          "latest": errors[0] if errors else None},
        "health": workers, "health_samples_24h": len(samples), "environment": env,
    }
    parts = {"summary": summary, "versions": versions, "licence": licence, "tenant_settings": tenant_settings,
             "systems": systems, "jobs": jobs, "server_errors": errors, "health_samples": samples,
             "workers": workers, "environment": env}
    return redact(parts, emails)


def _is_uuid(value: Optional[str]) -> bool:
    try:
        uuid.UUID(str(value))
        return bool(value)
    except ValueError:
        return False


def _count(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rows:
        out[str(r.get(key))] = out.get(str(r.get(key)), 0) + 1
    return out


def redact(parts: dict[str, Any], emails: list[str]) -> dict[str, Any]:
    """Replace any of the tenant's user emails wherever they appear (the last guard; nothing should match)."""
    if not emails:
        return parts
    pattern = re.compile("|".join(re.escape(e) for e in sorted(set(emails), key=len, reverse=True)), re.IGNORECASE)
    raw = json.dumps(parts, default=str)
    if not pattern.search(raw):
        return parts
    return json.loads(pattern.sub("[redacted]", raw))


README = """Meridian diagnostics bundle

Generated for support. It holds versions, licence status (no key), tenant settings without secrets, system types
and health (no hosts, users or credentials), recent jobs, server-error references, 24 hours of health samples,
worker and queue state and environment flags. It holds no SAP data, no credentials and no user emails (users are
counted only). Quote a server-error reference to support to match it with the API log.
"""


@router.get("/diagnostics", dependencies=[Depends(require_permission("manage_system"))])
async def diagnostics(request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    parts = await build(db, tenant)
    return parts["summary"]


@router.get("/diagnostics.zip", dependencies=[Depends(require_permission("manage_system"))])
async def diagnostics_zip(request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> Response:
    parts = await build(db, tenant)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, value in parts.items():
            zf.writestr(f"{name}.json", json.dumps(value, indent=2, default=str, sort_keys=True))
        zf.writestr("README.txt", README)
    data = buf.getvalue()
    await set_rls(db, tenant.id)
    # A download is a read, so the actor is attributed only when they are a user row of the tenant (a token for
    # a user that no longer exists still downloads; the audit row then names no user id).
    me = current_user_id(request)
    known = me and (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = :t"),
                                     {"u": str(me), "t": str(tenant.id)})).fetchone() if _is_uuid(me) else None
    await db.execute(text(
        "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
        "status_code, after_json) VALUES (:t, :u, :e, 'diagnostics.download', 'support', 'diagnostics.zip', :m, :p, "
        "200, CAST(:a AS jsonb))"),
        {"t": str(tenant.id), "u": str(me) if known else None, "e": current_user_label(), "m": request.method,
         "p": request.url.path,
         "a": json.dumps({"bytes": len(data), "files": sorted(f"{n}.json" for n in parts) + ["README.txt"]})})
    await db.commit()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="meridian-diagnostics-{stamp}.zip"',
                             "Cache-Control": "no-store"})
