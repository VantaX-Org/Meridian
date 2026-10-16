"""Data retention and purge.

* ``GET/PUT /api/v1/settings/retention``: the tenant's policy (tenants.retention).
* ``GET /api/v1/settings/retention/preview``: what the policy would purge now, as a dry run.
* ``GET /api/v1/settings/purge-log``: the purge history, newest first.
* ``DELETE /api/v1/versions/{id}``: purge one archived version for good; the body must
  repeat the version's label (its id when it has none).
* ``POST /api/v1/admin/purge-tenant``: two-step. The first call issues a token that
  becomes usable 24 hours later; the second call with that token purges every
  version, report and audit row, sweeps the tenant's storage prefixes and returns a
  one-page certificate PDF. The audit middleware writes its row for that POST after
  the handler returns; that row and the purge_log row are the record of deletion and
  are kept on purpose.

All writes need ``manage_settings`` (admin only). The database work runs on the sync
engine in a worker thread (api/services/purge.py), the same way report PDFs do.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.cache import get_redis
from api.services.purge import Actor, VersionNotFound, _trusted_key, purge_version, write_purge_log
from api.services.rate_limiter import rate_limit
from api.services.rbac import current_user_id, current_user_label, require_permission, write_audit
from api.services.retention import (
    OLDEST_NIGHTLY_DRY_RUN_SQL, POLICY_UPDATED_KEY, RetentionPolicy, enforcement, load_policy,
    select_expired_versions,
)

router = APIRouter(prefix="/api/v1", tags=["retention"])
logger = logging.getLogger("meridian.retention")

PURGE_TOKEN_DELAY = timedelta(hours=24)
PURGE_TOKEN_TTL_S = int(timedelta(hours=72).total_seconds())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _actor(request: Request) -> Actor:
    return Actor(user_id=current_user_id(request), email=current_user_label(),
                 method=request.method, path=request.url.path)


def _sync_session(tenant_id: str):
    from workers.db import get_sync_engine, tenant_session
    return tenant_session(get_sync_engine(), tenant_id)


# ── sync helpers, run in a thread ────────────────────────────────────────────

def _preview(tenant_id: str) -> list[dict[str, Any]]:
    """Dry-run purge of every version the policy selects now."""
    out: list[dict[str, Any]] = []
    with _sync_session(tenant_id) as session:
        policy = load_policy(session, tenant_id)
        for v in select_expired_versions(session, tenant_id, policy, _now()):
            r = purge_version(session, tenant_id, v.id, dry_run=True, actor=None, source="preview")
            out.append({"version_id": v.id, "label": v.label, "run_at": v.run_at, "system_id": v.system_id,
                        "blocked_reason": r["blocked_reason"], "rows_by_table": r["rows_by_table"],
                        "bytes_freed": r["bytes_freed"]})
    return out


def _version_label(tenant_id: str, version_id: str) -> Optional[tuple[Optional[str], bool]]:
    with _sync_session(tenant_id) as session:
        row = session.execute(text(
            "SELECT label, COALESCE(metadata->>'archived', '') = 'true' FROM analysis_versions "
            "WHERE id = :v AND tenant_id = :t"), {"v": version_id, "t": tenant_id}).fetchone()
    return (row[0], bool(row[1])) if row else None


def _delete_version(tenant_id: str, version_id: str, actor: Actor) -> dict[str, Any]:
    with _sync_session(tenant_id) as session:
        return purge_version(session, tenant_id, version_id, dry_run=False, actor=actor, source="manual")


def _tenant_storage_prefixes(tenant_id: str) -> list[tuple[str, str]]:
    """Every object-storage prefix keyed by this tenant (api/routes/upload.py, run_extraction,
    report_pdf, the findings archive)."""
    from api.config import settings

    return [(settings.minio_bucket_uploads, f"uploads/{tenant_id}/"),
            (settings.minio_bucket_uploads, f"staging/{tenant_id}/"),
            (settings.minio_bucket_reports, f"reports/{tenant_id}/"),
            (settings.minio_bucket_reports, f"archive/{tenant_id}/")]


def _purge_tenant(tenant_id: str, actor: Actor) -> dict[str, Any]:
    """Every version (open work included), then the remaining reports and audit rows,
    then a sweep of the tenant's whole storage prefixes (uploads, staging, reports)."""
    from api.config import settings
    from api.services import storage

    totals: dict[str, int] = {}
    bytes_freed = 0
    errors: list[str] = []
    skipped: list[str] = []

    def add(rows: dict[str, Any]) -> None:
        for k, n in rows.items():
            if isinstance(n, int):
                totals[k] = totals.get(k, 0) + n

    with _sync_session(tenant_id) as session:
        ids = [str(r[0]) for r in session.execute(text(
            "SELECT id FROM analysis_versions WHERE tenant_id = :t ORDER BY run_at"), {"t": tenant_id}).fetchall()]
    for vid in ids:
        with _sync_session(tenant_id) as session:
            r = purge_version(session, tenant_id, vid, dry_run=False, actor=actor, force=True, source="tenant")
        add(r["rows_by_table"])
        bytes_freed += r["bytes_freed"]
        errors.extend(r["storage_errors"])
    with _sync_session(tenant_id) as session:
        for (path,) in session.execute(text(
                "SELECT pdf_path FROM reports WHERE tenant_id = :t AND pdf_path IS NOT NULL"), {"t": tenant_id}):
            if _trusted_key(path, f"reports/{tenant_id}/") is None:
                skipped.append(str(path))
                continue
            try:
                size = storage.object_size(settings.minio_bucket_reports, path)
                if size is not None:
                    storage.delete_file(settings.minio_bucket_reports, path)
                    bytes_freed += size
            except Exception as e:  # noqa: BLE001
                errors.append(f"delete {path}: {e}")
        n = session.execute(text("DELETE FROM reports WHERE tenant_id = :t"), {"t": tenant_id}).rowcount or 0
        if n:
            totals["reports"] = totals.get("reports", 0) + n
        n = session.execute(text("DELETE FROM audit_log WHERE tenant_id = :t"), {"t": tenant_id}).rowcount or 0
        if n:
            totals["audit_log"] = n
        n = session.execute(text("DELETE FROM purge_log WHERE tenant_id = :t AND kind <> 'tenant'"),
                            {"t": tenant_id}).rowcount or 0
        if n:
            totals["purge_log"] = n
        # whatever the per-version purges did not know about: raw uploads of versions that
        # predate upload_path, staged datasets of failed runs, orphaned reports
        for bucket, prefix in _tenant_storage_prefixes(tenant_id):
            try:
                count, freed = storage.delete_prefix(bucket, prefix)
            except Exception as e:  # noqa: BLE001
                errors.append(f"delete prefix {prefix}: {e}")
                continue
            if count:
                totals[f"storage objects {prefix}"] = count
                bytes_freed += freed
        rows: dict[str, Any] = dict(totals)
        if errors:
            rows["storage_errors"] = errors
        if skipped:
            rows["skipped_untrusted_key"] = skipped
        log_id = write_purge_log(session, tenant_id, "tenant", None, False, rows, bytes_freed, None, actor,
                                 source="tenant")
        session.commit()
    return {"rows_by_table": totals, "bytes_freed": bytes_freed, "versions": len(ids),
            "storage_errors": errors, "purge_log_id": log_id, "purged_at": _now()}


def _certificate_pdf(tenant_name: str, tenant_id: str, outcome: dict[str, Any], actor: Actor) -> bytes:
    from api.services import pdf_reports

    when = outcome["purged_at"]
    ctx = {
        "title": "Certificate of deletion",
        "eyebrow": "Data retention",
        "scope_label": tenant_name,
        "generated_sast": pdf_reports.fmt_sast(when),
        "meta": [("Tenant", tenant_name), ("Purged at", pdf_reports.fmt_dt(when)),
                 ("Requested by", actor.email or "system")],
        "tenant": tenant_name,
        "tenant_id": tenant_id,
        "purged_at": pdf_reports.fmt_dt(when),
        "actor": actor.email or "system",
        "versions": outcome["versions"],
        "bytes_freed": outcome["bytes_freed"],
        "rows": sorted(outcome["rows_by_table"].items()),
        "storage_errors": outcome["storage_errors"],
        "purge_log_id": outcome["purge_log_id"],
    }
    return pdf_reports.render("purge_certificate.html", ctx)


# ── models ───────────────────────────────────────────────────────────────────

class EnforcementStatus(BaseModel):
    flag_enabled: bool
    dry_run_until: Optional[datetime]
    enforced: bool


class RetentionResponse(BaseModel):
    policy: RetentionPolicy
    enforcement: EnforcementStatus


class ConfirmBody(BaseModel):
    confirm: str


class TenantPurgeBody(BaseModel):
    token: Optional[str] = None


# ── settings ─────────────────────────────────────────────────────────────────

async def _status(db: AsyncSession, tenant_id: uuid.UUID) -> EnforcementStatus:
    oldest = (await db.execute(text(OLDEST_NIGHTLY_DRY_RUN_SQL), {"t": str(tenant_id)})).scalar()
    return EnforcementStatus(**enforcement(oldest, _now()))


@router.get("/settings/retention", response_model=RetentionResponse,
            dependencies=[Depends(require_permission("manage_settings"))])
async def get_retention(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    row = (await db.execute(text("SELECT retention FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    raw = row[0] if isinstance(row[0], dict) else {}
    policy = RetentionPolicy(**{k: v for k, v in raw.items() if k in RetentionPolicy.model_fields})
    return RetentionResponse(policy=policy, enforcement=await _status(db, tenant.id))


@router.put("/settings/retention", response_model=RetentionResponse,
            dependencies=[Depends(require_permission("manage_settings"))])
async def put_retention(
    body: RetentionPolicy,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    before_row = (await db.execute(text("SELECT retention FROM tenants WHERE id = :t"),
                                   {"t": str(tenant.id)})).fetchone()
    if before_row is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    after = body.model_dump()
    # the dry-run window restarts from this moment (api/services/retention.py)
    stored = {**json.loads(body.model_dump_json()), POLICY_UPDATED_KEY: _now().isoformat()}
    await db.execute(text("UPDATE tenants SET retention = CAST(:r AS jsonb) WHERE id = :t"),
                     {"r": json.dumps(stored), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "update", "retention_policy", str(tenant.id),
                      before_row[0] if isinstance(before_row[0], dict) else {}, after)
    await db.commit()
    return RetentionResponse(policy=body, enforcement=await _status(db, tenant.id))


@router.get("/settings/retention/preview", dependencies=[Depends(require_permission("manage_settings"))])
async def preview_retention(tenant: Tenant = Depends(get_tenant)):
    """Dry run of the policy as it stands: each version it would purge now, with the
    rows per table, the storage it would free, and why it would be refused."""
    items = await asyncio.to_thread(_preview, str(tenant.id))
    return {"items": items, "generated_at": _now()}


@router.get("/settings/purge-log", dependencies=[Depends(require_permission("manage_settings"))])
async def purge_log(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})
    rows = (await db.execute(text(
        "SELECT id, kind, target_id, dry_run, rows_by_table, bytes_freed, blocked_reason, actor_email, created_at "
        "FROM purge_log WHERE tenant_id = :t ORDER BY created_at DESC LIMIT :n"),
        {"t": str(tenant.id), "n": limit})).fetchall()
    return {"items": [
        {"id": str(r[0]), "kind": r[1], "target_id": str(r[2]) if r[2] else None, "dry_run": bool(r[3]),
         "rows_by_table": r[4] or {}, "bytes_freed": int(r[5] or 0), "blocked_reason": r[6],
         "actor_email": r[7], "created_at": r[8]}
        for r in rows]}


# ── one version ──────────────────────────────────────────────────────────────

@router.delete("/versions/{version_id}", dependencies=[Depends(require_permission("manage_settings"))])
async def delete_version(
    version_id: uuid.UUID,
    body: ConfirmBody,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
):
    """Purge one archived version for good. ``confirm`` must equal the version's label
    (or its id when it has no label). 409 with ``blocked_reason`` when open work remains."""
    tid, vid = str(tenant.id), str(version_id)
    found = await asyncio.to_thread(_version_label, tid, vid)
    if found is None:
        raise HTTPException(status_code=404, detail="Version not found")
    label, archived = found
    expected = label or vid
    if body.confirm.strip() != expected:
        raise HTTPException(status_code=400, detail="The confirmation does not match the version label.")
    if not archived:
        raise HTTPException(status_code=409, detail={"blocked_reason": "Archive the run before deleting it."})
    try:
        result = await asyncio.to_thread(_delete_version, tid, vid, _actor(request))
    except VersionNotFound:
        raise HTTPException(status_code=404, detail="Version not found")
    if result["blocked_reason"]:
        raise HTTPException(status_code=409, detail={"blocked_reason": result["blocked_reason"]})
    return {"version_id": vid, **result}


# ── whole tenant ─────────────────────────────────────────────────────────────

def _token_key(tenant_id: str, token: str) -> str:
    return f"meridian:purge-tenant:{tenant_id}:{token}"


@router.post("/admin/purge-tenant",
             dependencies=[Depends(require_permission("manage_settings")),
                           Depends(rate_limit("purge_tenant", limit=5, window_s=3600))])
async def purge_tenant(
    body: TenantPurgeBody,
    request: Request,
    tenant: Tenant = Depends(get_tenant),
):
    """Step one (no token): returns ``{token, executes_after}`` 24 hours out.
    Step two (token, after that time): purges everything and returns the certificate PDF."""
    r = get_redis()
    if r is None:
        raise HTTPException(status_code=503, detail="The purge needs Redis to hold the delay token.")
    tid = str(tenant.id)
    actor = _actor(request)

    if not body.token:
        token = secrets.token_urlsafe(24)
        executes_after = _now() + PURGE_TOKEN_DELAY
        r.setex(_token_key(tid, token), PURGE_TOKEN_TTL_S, executes_after.isoformat())
        logger.warning("tenant purge requested for %s by %s, executes after %s", tid, actor.email, executes_after)
        return {"token": token, "executes_after": executes_after}

    stored = r.get(_token_key(tid, body.token))
    if not stored:
        raise HTTPException(status_code=404, detail="Unknown or expired purge token. Request a new one.")
    executes_after = datetime.fromisoformat(stored if isinstance(stored, str) else stored.decode())
    now = _now()
    if now < executes_after:
        raise HTTPException(status_code=409, detail={
            "error": "too_early", "executes_after": executes_after.isoformat(),
            "message": "The purge token is not usable yet."})
    r.delete(_token_key(tid, body.token))
    outcome = await asyncio.to_thread(_purge_tenant, tid, actor)
    logger.warning("tenant purge executed for %s by %s: %s", tid, actor.email, outcome["rows_by_table"])
    pdf = await asyncio.to_thread(_certificate_pdf, tenant.name, tid, outcome, actor)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="deletion-certificate-{tid[:8]}.pdf"',
        "X-Purge-Log-Id": outcome["purge_log_id"],
    })
