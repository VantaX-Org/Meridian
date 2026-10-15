"""Hard delete of one analysis version and everything keyed to it.

Archiving (api/routes/versions.py) only hides a version. This is the irreversible
step behind the retention policy (api/services/retention.py), the nightly worker
(workers/tasks/purge_expired.py) and DELETE /api/v1/versions/{id}.

Order of work, all deterministic:

1. Refuse when the version still has open work (stewardship items not resolved,
   cleaning items not finished, write-back requests waiting or approved but not
   applied). Nothing is deleted; the purge_log row records ``blocked_reason``.
2. In one transaction, delete the version's rows from every version-keyed table,
   children before parents (``DELETE_ORDER``), unlink the tenant assets that
   merely point at the version (``UNLINK``), then the version row itself. Write
   the purge_log row and an audit_log row in the same transaction.
3. After the commit, remove the parquet prefix and the report objects. Storage is
   not transactional: a failure there is written back onto the purge_log row
   (``storage_errors``) instead of failing the request, since the rows are gone.

Golden records, learned rules, glossary terms, contracts, exceptions, remediation
batches and the tenant's own rules are tenant assets and are never deleted here;
where one of them points at the version, the pointer is cleared.

``dry_run=True`` runs the same checks and counts the same rows but commits only
the purge_log row.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import text

logger = logging.getLogger("meridian.purge")

# (table, where-clause) deleted in this order. Children first so no foreign key
# without ON DELETE CASCADE can stop the transaction:
#   write_back_log -> findings; exceptions -> findings (unlinked, see UNLINK);
#   finding_records, finding_root_causes -> findings' version; the rest -> the version.
DELETE_ORDER: tuple[tuple[str, str], ...] = (
    ("write_back_log", "version_id = :v OR finding_id IN (SELECT id FROM findings WHERE version_id = :v)"),
    ("finding_records", "version_id = :v"),
    ("finding_root_causes", "version_id = :v"),
    ("findings", "version_id = :v"),
    ("config_matches", "version_id = :v"),
    ("config_impact_results", "version_id = :v"),
    ("impact_records", "version_id = :v"),
    ("data_duplicates", "version_id = :v"),
    ("data_anomalies", "version_id = :v"),
    ("data_relationships", "version_id = :v"),
    ("field_dependencies", "version_id = :v"),
    ("field_profiles", "version_id = :v"),
    ("table_profiles", "version_id = :v"),
    ("analysis_run_steps", "version_id = :v"),
    ("record_fixes", "version_id = :v"),
    ("proven_cost_results", "version_id = :v"),
    ("process_derivations", "version_id = :v"),
    ("process_variants", "version_id = :v"),
    ("record_hashes", "version_id = :v"),
    ("insight_feedback", "run_id = CAST(:v AS text)"),
    # issues whose last evidence lived only in this version; their events cascade
    ("record_issues", "last_seen_version = :v"),
    ("reports", "version_id = :v"),
)

# Tenant assets that point at the version: the pointer is cleared, the row stays.
UNLINK: tuple[tuple[str, str, str], ...] = (
    ("exceptions", "linked_finding_id = NULL",
     "linked_finding_id IN (SELECT id FROM findings WHERE version_id = :v)"),
    ("record_issues", "first_seen_version = last_seen_version",
     "first_seen_version = :v AND last_seen_version <> :v"),
    ("record_issues", "resolved_version = NULL", "resolved_version = :v"),
    ("record_issue_events", "version_id = NULL", "version_id = :v"),
    ("remediation_events", "version_id = NULL", "version_id = :v"),
    ("remediation_items", "recon_version = NULL", "recon_version = :v"),
    ("cleaning_queue", "version_id = NULL", "version_id = :v"),
    ("contract_compliance_history", "version_id = NULL", "version_id = :v"),
    ("learned_rule_proposals", "version_id = NULL", "version_id = :v"),
    ("migration_runs", "source_version_id = NULL", "source_version_id = :v"),
    ("process_discovery_runs", "extraction_version_id = NULL", "extraction_version_id = :v"),
)

# The unlink steps that must run before a delete step they would otherwise collide with.
# exceptions.linked_finding_id has no ON DELETE clause, so findings cannot go first.
_UNLINK_BEFORE_DELETE = {"exceptions", "record_issues"}

OPEN_STEWARDSHIP_SQL = """
    SELECT count(*) FROM stewardship_queue sq
     WHERE sq.tenant_id = :t AND sq.status NOT IN ('resolved', 'closed', 'dismissed')
       AND ((sq.item_type = 'exception' AND sq.source_id IN (
                SELECT e.id FROM exceptions e JOIN findings f ON f.id = e.linked_finding_id
                 WHERE f.version_id = :v))
         OR (sq.item_type = 'writeback_approval' AND sq.source_id IN (
                SELECT id FROM cleaning_queue WHERE version_id = :v)))
"""
OPEN_CLEANING_SQL = """
    SELECT count(*) FROM cleaning_queue
     WHERE tenant_id = :t AND version_id = :v
       AND status NOT IN ('applied', 'rejected', 'rolled_back', 'merged')
"""
OPEN_WRITEBACK_SQL = """
    SELECT count(*) FROM write_back_log w
     WHERE w.tenant_id = :t AND w.dry_run = false AND w.applied_at IS NULL
       AND (w.version_id = :v OR w.finding_id IN (SELECT id FROM findings WHERE version_id = :v))
"""


@dataclass
class Actor:
    """Who asked for the purge: a user (API) or the scheduler (``None`` fields)."""
    user_id: Optional[str] = None
    email: Optional[str] = None
    method: str = "TASK"
    path: str = "workers.tasks.purge_expired"


@dataclass
class PurgeResult:
    rows_by_table: dict[str, int] = field(default_factory=dict)
    bytes_freed: int = 0
    blocked_reason: Optional[str] = None
    storage_errors: list[str] = field(default_factory=list)
    purge_log_id: Optional[str] = None

    def as_dict(self) -> dict[str, Any]:
        return {"rows_by_table": self.rows_by_table, "bytes_freed": self.bytes_freed,
                "blocked_reason": self.blocked_reason, "storage_errors": self.storage_errors,
                "purge_log_id": self.purge_log_id}


class VersionNotFound(LookupError):
    pass


def open_work(session: Any, tenant_id: str, version_id: str) -> Optional[str]:
    """Why this version cannot be purged yet, or None."""
    p = {"t": str(tenant_id), "v": str(version_id)}
    reasons = []
    n = session.execute(text(OPEN_STEWARDSHIP_SQL), p).scalar() or 0
    if n:
        reasons.append(f"{n} stewardship item{'s' if n != 1 else ''} not resolved")
    n = session.execute(text(OPEN_CLEANING_SQL), p).scalar() or 0
    if n:
        reasons.append(f"{n} cleaning item{'s' if n != 1 else ''} not finished")
    n = session.execute(text(OPEN_WRITEBACK_SQL), p).scalar() or 0
    if n:
        reasons.append(f"{n} write-back request{'s' if n != 1 else ''} pending or approved")
    return "; ".join(reasons) if reasons else None


def _count(session: Any, table: str, where: str, p: dict) -> int:
    return int(session.execute(text(f"SELECT count(*) FROM {table} WHERE {where}"), p).scalar() or 0)


def _storage_targets(session: Any, tenant_id: str, version_id: str, metadata: Optional[dict]) -> dict[str, Any]:
    """What to remove from object storage: the staging prefix plus named objects."""
    from api.config import settings

    meta = metadata or {}
    objects: list[tuple[str, str]] = []
    pdf_paths = session.execute(text(
        "SELECT pdf_path FROM reports WHERE version_id = :v AND pdf_path IS NOT NULL"), {"v": str(version_id)}
    ).fetchall()
    for (path,) in pdf_paths:
        objects.append((settings.minio_bucket_reports, path))
    if meta.get("findings_archive"):
        objects.append((settings.minio_bucket_reports, str(meta["findings_archive"])))
    prefix = f"staging/{tenant_id}/{version_id}/"
    dataset = meta.get("dataset_path")
    if isinstance(dataset, str) and dataset and not dataset.startswith(prefix) and "://" not in dataset:
        objects.append((settings.minio_bucket_uploads, dataset))
    return {"prefix_bucket": settings.minio_bucket_uploads, "prefix": prefix, "objects": objects}


def _measure_storage(targets: dict[str, Any]) -> tuple[int, list[str]]:
    """Bytes a purge would free; storage errors are reported, not raised."""
    from api.services import storage

    errors: list[str] = []
    total = 0
    try:
        total += sum(size for _, size in storage.list_prefix(targets["prefix_bucket"], targets["prefix"]))
    except Exception as e:  # noqa: BLE001 — storage down must not block a preview
        errors.append(f"list {targets['prefix']}: {e}")
    for bucket, name in targets["objects"]:
        try:
            total += storage.object_size(bucket, name) or 0
        except Exception as e:  # noqa: BLE001
            errors.append(f"stat {name}: {e}")
    return total, errors


def _delete_storage(targets: dict[str, Any]) -> tuple[int, list[str]]:
    from api.services import storage

    errors: list[str] = []
    freed = 0
    try:
        _, freed = storage.delete_prefix(targets["prefix_bucket"], targets["prefix"])
    except Exception as e:  # noqa: BLE001
        errors.append(f"delete prefix {targets['prefix']}: {e}")
    for bucket, name in targets["objects"]:
        try:
            size = storage.object_size(bucket, name)
            if size is None:
                continue
            storage.delete_file(bucket, name)
            freed += size
        except Exception as e:  # noqa: BLE001
            errors.append(f"delete {name}: {e}")
    return freed, errors


def write_purge_log(session: Any, tenant_id: str, kind: str, target_id: Optional[str], dry_run: bool,
                    rows_by_table: dict[str, int], bytes_freed: int, blocked_reason: Optional[str],
                    actor: Optional[Actor]) -> str:
    """Insert the purge_log row (caller commits). Returns its id."""
    log_id = str(uuid.uuid4())
    session.execute(text(
        "INSERT INTO purge_log (id, tenant_id, kind, target_id, dry_run, rows_by_table, bytes_freed, "
        "blocked_reason, actor_user_id, actor_email) VALUES (:id, :t, :k, :target, :d, CAST(:r AS jsonb), :b, "
        ":why, :u, :e)"),
        {"id": log_id, "t": str(tenant_id), "k": kind, "target": str(target_id) if target_id else None,
         "d": dry_run, "r": json.dumps(rows_by_table), "b": int(bytes_freed), "why": blocked_reason,
         "u": actor.user_id if actor else None, "e": actor.email if actor else None})
    return log_id


def write_audit_row(session: Any, tenant_id: str, actor: Optional[Actor], action: str, entity_type: str,
                    entity_id: str, after: dict) -> None:
    """Same columns api.services.rbac.write_audit fills, from a sync session without a request."""
    a = actor or Actor()
    session.execute(text(
        "INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, "
        "method, path, status_code, after_json) VALUES (:t, :u, :e, :a, :et, :ei, :m, :p, 200, CAST(:af AS jsonb))"),
        {"t": str(tenant_id), "u": a.user_id, "e": a.email or "system", "a": action, "et": entity_type,
         "ei": entity_id, "m": a.method, "p": a.path, "af": json.dumps(after, default=str)})


def purge_version(session: Any, tenant_id: str, version_id: str, *, dry_run: bool,
                  actor: Optional[Actor] = None, force: bool = False) -> dict[str, Any]:
    """Delete one version and everything keyed to it. See the module docstring.

    ``force`` skips the open-work check (tenant purge only). Raises
    ``VersionNotFound`` when the version is not this tenant's.
    """
    tid, vid = str(tenant_id), str(version_id)
    p = {"t": tid, "v": vid}
    row = session.execute(text(
        "SELECT label, metadata FROM analysis_versions WHERE id = :v AND tenant_id = :t"), p).fetchone()
    if row is None:
        raise VersionNotFound(vid)
    label, metadata = row[0], row[1]
    result = PurgeResult()

    blocked = None if force else open_work(session, tid, vid)
    if blocked:
        result.blocked_reason = blocked
        result.purge_log_id = write_purge_log(session, tid, "version", vid, dry_run, {}, 0, blocked, actor)
        session.commit()
        return result.as_dict()

    targets = _storage_targets(session, tid, vid, metadata)

    if dry_run:
        for table, where in DELETE_ORDER:
            n = _count(session, table, where, p)
            if n:
                result.rows_by_table[table] = n
        for table, _set, where in UNLINK:
            n = _count(session, table, where, p)
            if n:
                key = f"{table} (unlinked)"
                result.rows_by_table[key] = result.rows_by_table.get(key, 0) + n
        result.rows_by_table["analysis_versions"] = 1
        result.bytes_freed, result.storage_errors = _measure_storage(targets)
        result.purge_log_id = write_purge_log(session, tid, "version", vid, True, result.rows_by_table,
                                              result.bytes_freed, None, actor)
        session.commit()
        return result.as_dict()

    # Unlinks that must precede the deletes (no ON DELETE on exceptions.linked_finding_id,
    # NOT NULL on record_issues.first_seen_version).
    for table, set_clause, where in UNLINK:
        if table not in _UNLINK_BEFORE_DELETE:
            continue
        n = session.execute(text(f"UPDATE {table} SET {set_clause} WHERE {where}"), p).rowcount or 0
        if n:
            key = f"{table} (unlinked)"
            result.rows_by_table[key] = result.rows_by_table.get(key, 0) + n
    for table, where in DELETE_ORDER:
        n = session.execute(text(f"DELETE FROM {table} WHERE {where}"), p).rowcount or 0
        if n:
            result.rows_by_table[table] = n
    for table, set_clause, where in UNLINK:
        if table in _UNLINK_BEFORE_DELETE:
            continue
        n = session.execute(text(f"UPDATE {table} SET {set_clause} WHERE {where}"), p).rowcount or 0
        if n:
            key = f"{table} (unlinked)"
            result.rows_by_table[key] = result.rows_by_table.get(key, 0) + n
    n = session.execute(text("DELETE FROM analysis_versions WHERE id = :v AND tenant_id = :t"), p).rowcount or 0
    result.rows_by_table["analysis_versions"] = n

    result.purge_log_id = write_purge_log(session, tid, "version", vid, False, result.rows_by_table, 0, None, actor)
    write_audit_row(session, tid, actor, "purge", "analysis_version", vid,
                    {"label": label, "rows_by_table": result.rows_by_table, "purge_log_id": result.purge_log_id})
    session.commit()

    # Storage after the commit: the rows are gone either way, so a storage failure
    # is recorded on the log row rather than raised.
    result.bytes_freed, result.storage_errors = _delete_storage(targets)
    try:
        session.execute(text(
            "UPDATE purge_log SET bytes_freed = :b, rows_by_table = rows_by_table || CAST(:err AS jsonb) "
            "WHERE id = :id"),
            {"b": int(result.bytes_freed), "id": result.purge_log_id,
             "err": json.dumps({"storage_errors": result.storage_errors} if result.storage_errors else {})})
        session.commit()
    except Exception:  # noqa: BLE001
        logger.exception("purge %s: could not record storage outcome on purge_log %s", vid, result.purge_log_id)
    if result.storage_errors:
        logger.warning("purge %s: storage errors %s", vid, result.storage_errors)
    return result.as_dict()
