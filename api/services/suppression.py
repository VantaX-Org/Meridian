"""Suppression list: record keys erased on request that extraction must not bring back (debt item D-27).

``subject_requests.erase`` writes one row per erased record key to ``subject_suppressions`` (migration 138). The
row holds the HMAC-SHA256 of the key under the tenant secret (label ``suppress``) and the names of the key fields,
never a value. Rows of an extract are hashed the same way and dropped when they match.

Two shared points cover every path that writes or reads an extract:

* write: ``api.services.storage.upload_file`` (RFC extraction, cloud connectors, file upload and the connect
  route all go through it) and ``workers.tasks.run_extraction.store`` (drops rows before profiles and delta hashes).
* read:  ``workers.dataset._read`` (the checks, sync and material 360 read through it), which also hides rows of
  extracts that were written before the suppression existed.

Not covered: readers that call ``storage.download_file`` directly (the delta baseline loader and the subject
request scan, which want the raw file), and any parquet outside ``staging/<tenant>/``. A tenant with no active
suppression pays one cached lookup per 30 seconds and no per-row work. A lookup that fails raises, so a write or
read never goes ahead unfiltered.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import logging
import time
import uuid
from typing import Any, Optional

from sqlalchemy import text

logger = logging.getLogger("meridian.suppression")

CACHE_SECONDS = 30
_cache: dict[str, tuple[float, Optional[dict]]] = {}


def normalise(fields_values: dict[str, str]) -> tuple[str, str]:
    """``{"A": " 1", "B": "2"}`` as ``("A|B", "A=1|B=2")``: the field names and the string that is hashed."""
    return "|".join(fields_values), "|".join(f"{f}={v.strip()}" for f, v in fields_values.items())


def invalidate(tenant_id: str) -> None:
    _cache.pop(str(tenant_id), None)


def _db(tenant_id: str):
    from workers.db import get_sync_engine, tenant_session
    return tenant_session(get_sync_engine(), tenant_id)


def _load(tenant_id: str) -> Optional[dict]:
    """Active suppressions as ``{"base": hmac prefix, "groups": {fields: {digest: hex}}}``, or None when empty."""
    now = time.monotonic()
    hit = _cache.get(tenant_id)
    if hit and hit[0] > now:
        return hit[1]
    session = _db(tenant_id)
    try:
        rows = session.execute(text(
            "SELECT key_hmac, key_fields FROM subject_suppressions WHERE tenant_id = :t AND lifted_at IS NULL"),
            {"t": tenant_id}).fetchall()
        secret = session.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": tenant_id}).scalar() \
            if rows else None
    finally:
        session.close()
    entry = None
    if rows:
        if not secret:
            raise RuntimeError("suppression list exists but the tenant has no secret")
        groups: dict[tuple[str, ...], dict[bytes, str]] = {}
        for h, fields in rows:
            groups.setdefault(tuple(fields.split("|")), {})[bytes.fromhex(h)] = h
        entry = {"base": hmac.new(str(secret).encode(), f"suppress:{tenant_id}:".encode(), hashlib.sha256),
                 "groups": groups}
    _cache[tenant_id] = (now + CACHE_SECONDS, entry)
    return entry


def tenant_of(object_name: str) -> Optional[str]:
    """Tenant id of ``staging/<tenant>/...parquet``, else None."""
    parts = object_name.split("/")
    if len(parts) < 3 or parts[0] != "staging" or not object_name.endswith(".parquet"):
        return None
    try:
        return str(uuid.UUID(parts[1]))
    except ValueError:
        return None


def _hits(entry: dict, columns: dict[str, str], get: Any, n: int) -> tuple[list[bool], dict[str, int]]:
    """Per-row suppressed flag and a count per key hash. ``columns`` maps field name to column name;
    ``get(column)`` returns the column as a list of str or None."""
    flags = [False] * n
    counts: dict[str, int] = {}
    base = entry["base"]
    for fields, digests in entry["groups"].items():
        if any(f not in columns for f in fields):
            continue  # this file has no column for a field of the key
        cols = [get(columns[f]) for f in fields]
        for i in range(n):
            vals = [c[i] for c in cols]
            if None in vals:
                continue
            h = base.copy()
            h.update("|".join(f"{f}={v.strip()}" for f, v in zip(fields, vals)).encode())
            hex_ = digests.get(h.digest())
            if hex_:
                flags[i] = True
                counts[hex_] = counts.get(hex_, 0) + 1
    return flags, counts


def _field_columns(names: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for name in names:
        out.setdefault(name.split(".")[-1], name)
    return out


def filter_frame(tenant_id: str, df: Any) -> tuple[Any, dict[str, int]]:
    """Drop suppressed rows from a pandas frame. Returns ``(frame, counts)``."""
    entry = _load(str(tenant_id))
    if not entry or len(df) == 0:
        return df, {}
    flags, counts = _hits(entry, _field_columns([str(c) for c in df.columns]),
                          lambda c: [None if v is None or v != v else str(v) for v in df[c].tolist()], len(df))
    if not counts:
        return df, {}
    return df[[not f for f in flags]], counts


def filter_parquet(object_name: str, data: bytes) -> tuple[bytes, dict[str, int], Optional[str]]:
    """Drop suppressed rows from the parquet bytes of a staging object. Returns ``(bytes, counts, tenant)``;
    the bytes are returned untouched when the object is not an extract of a tenant with suppressions."""
    tenant = tenant_of(object_name)
    entry = _load(tenant) if tenant else None
    if not entry:
        return data, {}, tenant
    import pyarrow as pa
    import pyarrow.parquet as pq

    pf = pq.ParquetFile(io.BytesIO(data))
    columns = _field_columns(pf.schema_arrow.names)
    needed = sorted({columns[f] for fields in entry["groups"] for f in fields if f in columns})
    if not needed:
        return data, {}, tenant
    keys = pf.read(columns=needed)
    flags, counts = _hits(entry, columns,
                          lambda c: [None if v is None else str(v) for v in keys.column(c).to_pylist()],
                          keys.num_rows)
    if not counts:
        return data, {}, tenant
    kept = pf.read().filter(pa.array([not f for f in flags]))
    buf = io.BytesIO()
    pq.write_table(kept, buf)
    return buf.getvalue(), counts, tenant


def record_dropped(tenant_id: Optional[str], counts: dict[str, int]) -> None:
    """Add to the dropped count of each suppression. A failure is logged and never fails the write."""
    if not counts or not tenant_id:
        return
    try:
        session = _db(str(tenant_id))
        try:
            for h, n in counts.items():
                session.execute(text(
                    "UPDATE subject_suppressions SET dropped_count = dropped_count + :n, last_dropped_at = now() "
                    "WHERE tenant_id = :t AND key_hmac = :h"), {"n": n, "t": str(tenant_id), "h": h})
            session.commit()
        finally:
            session.close()
    except Exception as e:
        logger.warning("could not record dropped suppressed rows: %s", type(e).__name__)
