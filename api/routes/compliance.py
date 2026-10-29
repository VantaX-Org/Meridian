"""Data residency and retention statement.

* ``GET /api/v1/settings/compliance`` (manage_settings): where this deployment keeps data (its own database and
  object storage hosts, the LLM provider and whether it runs inside the deployment), the retention days per table
  family (tenants.retention, the same policy as /settings/retention, plus the fixed windows), encryption-at-rest
  flags from the environment and the last backup recorded by scripts/backup.sh.
* ``PUT /api/v1/settings/compliance`` (manage_settings): retention days (versions_days, reports_days, audit_days)
  validated by the retention policy model; the rest of the policy is kept. Audited.

Read-mostly and literal: a fact this process cannot see is null, never a guess. Encryption at rest of the database
volume and of object storage are infrastructure facts, so they come only from MERIDIAN_DB_ENCRYPTED_AT_REST and
MERIDIAN_OBJECT_STORAGE_ENCRYPTED_AT_REST (true/false; unset is null). The last backup comes from the newest
manifest.json under MERIDIAN_BACKUP_DIR (default ./backups, where scripts/backup.sh writes), null when none is
readable from the API.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.deps import Tenant, get_db, get_tenant
from api.services.health_probe import SAMPLE_KEEP_DAYS
from api.services.rbac import require_permission, write_audit
from api.services.retention import (
    OLDEST_NIGHTLY_DRY_RUN_SQL,
    POLICY_UPDATED_KEY,
    RetentionPolicy,
    enforcement,
)
from api.services.tenant_settings import set_rls

router = APIRouter(prefix="/api/v1/settings", tags=["compliance"])

JOB_TTL_DAYS = 7  # api/services/jobs.py JOB_TTL_SECONDS
LOCAL_LLM_HOSTS = {"ollama", "llm", "localhost", "127.0.0.1"}


class RetentionDaysIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    versions_days: Optional[int] = None
    reports_days: Optional[int] = None
    audit_days: Optional[int] = None


class ComplianceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    retention: RetentionDaysIn


def _host(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        parts = urlsplit(url if "://" in url else f"//{url}")
        host = parts.hostname
        if not host and "host=" in (parts.query or ""):  # unix socket DSN: ?host=/path
            return "local socket"
        return host
    except ValueError:
        return None


def _env_bool(name: str) -> Optional[bool]:
    v = os.getenv(name)
    if v is None or not v.strip():
        return None
    return v.strip().lower() in ("1", "true", "yes", "on")


def last_backup() -> Optional[dict[str, Any]]:
    """The newest scripts/backup.sh manifest readable from here, else None."""
    base = Path(os.getenv("MERIDIAN_BACKUP_DIR") or Path(__file__).resolve().parents[2] / "backups")
    try:
        manifests = sorted(base.glob("*/manifest.json"), reverse=True)
    except OSError:
        return None
    for m in manifests[:20]:
        try:
            data = json.loads(m.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("backup_at_utc"):
            return {"at": data.get("backup_at_utc"), "migration_head": data.get("migration_head"),
                    "database_only": data.get("database_only"), "env_encrypted": data.get("encrypted_env")}
    return None


async def _policy(db: AsyncSession, tenant: Tenant) -> tuple[dict[str, Any], RetentionPolicy]:
    row = (await db.execute(text("SELECT retention FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    raw = row[0] if isinstance(row[0], dict) else {}
    return raw, RetentionPolicy(**{k: v for k, v in raw.items() if k in RetentionPolicy.model_fields})


async def statement(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    await set_rls(db, tenant.id)
    _, policy = await _policy(db, tenant)
    llm = (await db.execute(text("SELECT llm_config->>'provider', llm_config->>'base_url' FROM tenants WHERE id = :t"),
                            {"t": str(tenant.id)})).fetchone()
    provider = (llm[0] if llm and llm[0] else None) or settings.llm_provider
    llm_host = _host((llm[1] if llm and llm[1] else None) or settings.ollama_base_url) if provider == "ollama" else None
    oldest = (await db.execute(text(OLDEST_NIGHTLY_DRY_RUN_SQL), {"t": str(tenant.id)})).scalar()
    enforce = enforcement(oldest, datetime.now(timezone.utc))
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_residency": {
            "deployment": "customer_hosted",
            "database_host": _host(settings.database_url_sync or settings.database_url),
            "object_storage_host": _host(settings.minio_endpoint),
            "llm_provider": provider,
            # True only for the bundled Ollama on the deployment's own network; null when it cannot be told.
            "llm_in_deployment": (llm_host in LOCAL_LLM_HOSTS if llm_host else None) if provider == "ollama"
            else False,
        },
        "retention": {
            "families": [
                {"family": "analysis_versions", "label": "Analysis runs, findings and work lists",
                 "days": policy.versions_days, "configurable": True},
                {"family": "reports", "label": "Generated reports", "days": policy.reports_days,
                 "configurable": True},
                {"family": "audit_log", "label": "Audit log", "days": policy.audit_days, "configurable": True},
                {"family": "health_samples", "label": "Health samples", "days": SAMPLE_KEEP_DAYS,
                 "configurable": False},
                {"family": "jobs", "label": "Job progress", "days": JOB_TTL_DAYS, "configurable": False},
            ],
            "keep_baseline": policy.keep_baseline,
            "keep_latest_per_system": policy.keep_latest_per_system,
            "enforcement": {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in enforce.items()},
        },
        "encryption_at_rest": {
            "database_volume": _env_bool("MERIDIAN_DB_ENCRYPTED_AT_REST"),
            "object_storage": _env_bool("MERIDIAN_OBJECT_STORAGE_ENCRYPTED_AT_REST"),
            "sap_credentials": bool(settings.credential_master_key),
            "llm_api_keys": bool(os.getenv("LLM_KEK")),
        },
        "backup": last_backup(),
    }


@router.get("/compliance", dependencies=[Depends(require_permission("manage_settings"))])
async def get_compliance(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    return await statement(db, tenant)


@router.put("/compliance", dependencies=[Depends(require_permission("manage_settings"))])
async def put_compliance(body: ComplianceIn, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> dict[str, Any]:
    """Set retention days; a field left out keeps its value, null keeps that data for ever."""
    await set_rls(db, tenant.id)
    raw, policy = await _policy(db, tenant)
    changes = {k: getattr(body.retention, k) for k in body.retention.model_fields_set}
    try:
        updated = RetentionPolicy(**{**policy.model_dump(), **changes})
    except ValidationError as e:
        first = e.errors()[0]
        field = ".".join(str(p) for p in first.get("loc", ()))
        raise HTTPException(status_code=422, detail=f"{field}: {first.get('msg')}")
    stored = {**raw, **json.loads(updated.model_dump_json()), POLICY_UPDATED_KEY: datetime.now(timezone.utc).isoformat()}
    await db.execute(text("UPDATE tenants SET retention = CAST(:r AS jsonb) WHERE id = :t"),
                     {"r": json.dumps(stored), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "update", "retention_policy", str(tenant.id), policy.model_dump(),
                      updated.model_dump())
    await db.commit()
    return await statement(db, tenant)
