"""Snapshot of what a migration export handed over, kept as parquet in object storage.

Layout, in the uploads bucket: ``migration-snapshots/<tenant>/<run>/<export>/{load,held}/<quoted table>.parquet``.
It sits outside ``staging/<tenant>/`` on purpose: the suppression filter on staging extracts must not rewrite it.
The export row stores the prefix and a digest over the sorted (object name, sha256 of bytes) pairs. ``read`` checks
the digest and that the prefix belongs to the caller's tenant, so a tampered or foreign snapshot is refused.

Snapshots hold record values, personal fields included. They are removed with the run (``delete_run``), with a
version purge, with a tenant purge, and rewritten per record by a data-subject erasure (subject_requests).

Storage is bounded: a copy over ``migration_snapshot_max_mb`` is not kept, and only the newest ``KEEP`` copies of a run
stay (``prune``).
"""
import hashlib
import io
from typing import Optional
from urllib.parse import quote, unquote

import pandas as pd

from api.config import settings
from api.services import storage

ROOT = "migration-snapshots"
SIDES = ("load", "held")
KEEP = 3  # copies per run; reconciliation reads only the newest


def run_prefix(tenant_id, run_id) -> str:
    return f"{ROOT}/{tenant_id}/{run_id}/"


def prefix(tenant_id, run_id, export_id) -> str:
    return f"{run_prefix(tenant_id, run_id)}{export_id}/"


def digest(parts: dict[str, bytes]) -> str:
    h = hashlib.sha256()
    for name in sorted(parts):
        h.update(f"{name}\0{hashlib.sha256(parts[name]).hexdigest()}\n".encode())
    return h.hexdigest()


def _to_parquet(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.astype("string").to_parquet(buf, index=False)
    return buf.getvalue()


def write(tenant_id, run_id, export_id, load: dict[str, pd.DataFrame], held: dict[str, pd.DataFrame]) -> tuple[str, str]:
    """Store both sides; return ``(prefix, digest)``. Raises when storage fails (the caller records the error)."""
    pre = prefix(tenant_id, run_id, export_id)
    parts = {f"{pre}{side}/{quote(t, safe='')}.parquet": _to_parquet(df)
             for side, frames in zip(SIDES, (load, held)) for t, df in frames.items()}
    size = sum(map(len, parts.values()))
    if size > settings.migration_snapshot_max_mb * 1024 * 1024:
        raise ValueError(f"copy is {size // (1024 * 1024)} MB, over the {settings.migration_snapshot_max_mb} MB limit")
    try:
        for name, data in parts.items():
            storage.upload_file(settings.minio_bucket_uploads, name, data, suppress=False)
    except Exception:
        storage.delete_prefix(settings.minio_bucket_uploads, pre)  # no half snapshot
        raise
    return pre, digest(parts)


def read(tenant_id, pre: str, want: str) -> tuple[dict[str, pd.DataFrame], dict[str, pd.DataFrame]]:
    """Load both sides after checking tenant and digest. Raises ``ValueError`` on any mismatch."""
    if not pre.startswith(f"{ROOT}/{tenant_id}/"):
        raise ValueError("snapshot belongs to another tenant")
    parts = {n: storage.download_file(settings.minio_bucket_uploads, n)
             for n, _ in storage.list_prefix(settings.minio_bucket_uploads, pre)}
    if digest(parts) != want:
        raise ValueError("snapshot digest mismatch")
    out: dict[str, dict[str, pd.DataFrame]] = {s: {} for s in SIDES}
    for name, data in parts.items():
        side, _, file = name[len(pre):].partition("/")
        out[side][unquote(file[: -len(".parquet")])] = pd.read_parquet(io.BytesIO(data)).astype(object)
    return out["load"], out["held"]


def delete_run(tenant_id, run_id) -> int:
    """Remove every snapshot of one run. Returns the number of objects removed."""
    return storage.delete_prefix(settings.minio_bucket_uploads, run_prefix(tenant_id, run_id))[0]


def latest(session, run_id) -> Optional[object]:
    """The run's newest export row that has a snapshot, or None."""
    from sqlalchemy import text

    return session.execute(text(
        "SELECT id, snapshot_prefix, snapshot_sha256, created_at FROM migration_export_files "
        "WHERE run_id = :r AND snapshot_prefix IS NOT NULL ORDER BY created_at DESC LIMIT 1"),
        {"r": run_id}).fetchone()


def newest_has_no_copy(session, run_id) -> bool:
    """True when the run's newest export kept no copy, so a comparison cannot be against those files."""
    from sqlalchemy import text
    row = session.execute(text(
        "SELECT snapshot_prefix FROM migration_export_files WHERE run_id = :r ORDER BY created_at DESC LIMIT 1"),
        {"r": run_id}).fetchone()
    return row is not None and row.snapshot_prefix is None


def prune(session, tenant_id, run_id) -> int:
    """Remove all but the newest ``KEEP`` copies of a run; the caller commits. Returns the copies removed.

    Objects go first: an erasure finds copies through these rows, so a row must not lose its pointer while personal
    data remains. A failure leaves the rows pointing at what is left, the next prune finishes the job, and an erasure
    deletes a partial copy whole.
    """
    from sqlalchemy import text
    rows = session.execute(text(
        "SELECT id, snapshot_prefix FROM migration_export_files WHERE run_id = :r AND snapshot_prefix IS NOT NULL "
        "ORDER BY created_at DESC OFFSET :k"), {"r": run_id, "k": KEEP}).fetchall()
    rows = [r for r in rows if r.snapshot_prefix.startswith(run_prefix(tenant_id, run_id))]
    for r in rows:
        storage.delete_prefix(settings.minio_bucket_uploads, r.snapshot_prefix)
    for r in rows:
        session.execute(text(
            "UPDATE migration_export_files SET snapshot_prefix = NULL, snapshot_sha256 = NULL, "
            "snapshot_error = 'removed: only the latest copies are kept' WHERE id = :i"), {"i": r.id})
    return len(rows)
