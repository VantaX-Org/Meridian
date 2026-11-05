"""Snapshot of what a migration export handed over, kept as parquet in object storage.

Layout, in the uploads bucket: ``migration-snapshots/<tenant>/<run>/<export>/{load,held}/<quoted table>.parquet``.
It sits outside ``staging/<tenant>/`` on purpose: the suppression filter on staging extracts must not rewrite it.
The export row stores the prefix and a digest over the sorted (object name, sha256 of bytes) pairs. ``read`` checks
the digest and that the prefix belongs to the caller's tenant, so a tampered or foreign snapshot is refused.

Snapshots hold record values, personal fields included. They are removed with the run (``delete_run``), with a
version purge, with a tenant purge, and rewritten per record by a data-subject erasure (subject_requests).
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
