"""Tenant data retention policy and the selection of versions it would purge.

The policy lives in ``tenants.retention`` (JSONB, migration 082) like the other
tenant settings. Selection is deterministic Python over one query so it runs the
same way in the API preview and the nightly worker (workers/tasks/purge_expired.py)
and can be tested with a fake session.

A version is expired when all of these hold:

* it is archived (``metadata.archived = true``, set by /versions/archive or the
  weekly archive task), so nothing a user still sees is ever purged;
* it ran more than ``versions_days`` days ago;
* it is not the pinned baseline of its system (``metadata.baseline = true``)
  while ``keep_baseline`` is on;
* it is not among the newest ``keep_latest_per_system`` versions of its system.
  Uploads count as one system, ``"upload"``, the same scope /versions/compare uses.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field
from sqlalchemy import text

UPLOAD_SCOPE = "upload"
# Real deletes start only after this many days of nightly dry runs (and the env flag).
DRY_RUN_DAYS = 7
PURGE_FLAG = "MERIDIAN_PURGE_ENABLED"
# Key inside tenants.retention set on every PUT; dry runs older than it do not count.
POLICY_UPDATED_KEY = "updated_at"
# The oldest nightly dry run written since the policy last changed. Previews and
# manual deletes never count, nor does anything from before the current policy.
OLDEST_NIGHTLY_DRY_RUN_SQL = """
    SELECT min(created_at) FROM purge_log
     WHERE tenant_id = :t AND dry_run = true AND source = 'nightly'
       AND created_at > COALESCE(
             (SELECT NULLIF(retention->>'updated_at', '')::timestamptz FROM tenants WHERE id = :t),
             '-infinity'::timestamptz)
"""


def purge_flag_enabled() -> bool:
    return os.getenv(PURGE_FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def enforcement(oldest_dry_run: Optional[datetime], now: Optional[datetime] = None,
                flag_enabled: Optional[bool] = None) -> dict[str, Any]:
    """Whether the nightly task may delete for real: the flag is on and the tenant's
    oldest nightly dry-run purge_log row written under the current policy
    (``oldest_dry_run``, see OLDEST_NIGHTLY_DRY_RUN_SQL) is at least DRY_RUN_DAYS old."""
    now = now or datetime.now(timezone.utc)
    flag = purge_flag_enabled() if flag_enabled is None else flag_enabled
    until = None
    if oldest_dry_run is not None:
        if oldest_dry_run.tzinfo is None:
            oldest_dry_run = oldest_dry_run.replace(tzinfo=timezone.utc)
        until = oldest_dry_run + timedelta(days=DRY_RUN_DAYS)
    enforced = bool(flag and until is not None and until <= now)
    return {"flag_enabled": flag, "dry_run_until": until, "enforced": enforced}


def oldest_dry_run(session: Any, tenant_id: str) -> Optional[datetime]:
    """The oldest nightly dry run since the policy last changed, or None."""
    return session.execute(text(OLDEST_NIGHTLY_DRY_RUN_SQL), {"t": str(tenant_id)}).scalar()


class RetentionPolicy(BaseModel):
    """Days are ``None`` when that class of data is kept for ever."""
    versions_days: Optional[int] = Field(None, ge=1, le=3650)
    reports_days: Optional[int] = Field(None, ge=1, le=3650)
    audit_days: Optional[int] = Field(None, ge=30, le=3650)
    keep_baseline: bool = True
    keep_latest_per_system: int = Field(1, ge=0, le=100)


class ExpiredVersion(BaseModel):
    id: str
    label: Optional[str]
    run_at: Optional[datetime]
    system_id: str
    status: str


def load_policy(session: Any, tenant_id: str) -> RetentionPolicy:
    """The tenant's policy; an empty or missing document is the default (keep everything)."""
    row = session.execute(text("SELECT retention FROM tenants WHERE id = :t"), {"t": str(tenant_id)}).fetchone()
    raw = row[0] if row and row[0] else {}
    if not isinstance(raw, dict):
        raw = {}
    return RetentionPolicy(**{k: v for k, v in raw.items() if k in RetentionPolicy.model_fields})


def _scope_of(metadata: Optional[dict]) -> str:
    return str((metadata or {}).get("system_id") or UPLOAD_SCOPE)


def _is_true(metadata: Optional[dict], key: str) -> bool:
    v = (metadata or {}).get(key)
    return v is True or (isinstance(v, str) and v.lower() == "true")


def select_expired_versions(session: Any, tenant_id: str, policy: RetentionPolicy,
                            now: Optional[datetime] = None) -> list[ExpiredVersion]:
    """Archived versions past ``policy.versions_days``, never the baseline, never the
    newest ``keep_latest_per_system`` of any system. Oldest first."""
    if policy.versions_days is None:
        return []
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=policy.versions_days)
    rows = session.execute(text(
        "SELECT id, label, run_at, metadata, status FROM analysis_versions "
        "WHERE tenant_id = :t ORDER BY run_at DESC NULLS LAST, id"
    ), {"t": str(tenant_id)}).fetchall()

    seen_per_system: dict[str, int] = {}
    expired: list[ExpiredVersion] = []
    for vid, label, run_at, metadata, status in rows:
        scope = _scope_of(metadata)
        rank = seen_per_system.get(scope, 0)
        seen_per_system[scope] = rank + 1
        if rank < policy.keep_latest_per_system:
            continue  # one of the newest versions of this system, archived or not
        if policy.keep_baseline and _is_true(metadata, "baseline"):
            continue
        if not _is_true(metadata, "archived"):
            continue
        if run_at is None:
            continue
        run_at_utc = run_at if run_at.tzinfo else run_at.replace(tzinfo=timezone.utc)
        if run_at_utc >= cutoff:
            continue
        expired.append(ExpiredVersion(id=str(vid), label=label, run_at=run_at_utc, system_id=scope,
                                      status=str(status or "")))
    expired.reverse()
    return expired
