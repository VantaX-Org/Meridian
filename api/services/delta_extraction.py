"""Delta extraction: read only what changed, and log what changed per table (migration 111).

A sync profile with ``extraction_mode = 'delta'`` extracts against the previous extraction of the same system,
objects and scope (workers/tasks/run_extraction.delta_baseline). Per table, in this order:

  change documents   tables SAP's change documents cover (CDHDR) re-read only the changed keys (existing path,
                     api/services/connectivity_manager._delta_read)
  change date        when the previous extraction left row hashes (record_hashes), a table whose data dictionary
                     entry has a date-of-last-change field (sap/data_dictionary.get_change_date_field) is read
                     ``field >= since`` and merged by key over the previous extraction's rows; a merged count that
                     disagrees with SAP's row count falls back to a full read (deleted records leave no change date)
  full read          everything else

Every data table of a delta extraction is then compared by row hash with the previous extraction (record_hashes:
``module`` = the table's object, ``record_key`` = ``TABLE:<record key>``, ``row_hash`` = a hash of the row's fields)
and logged in extraction_changes: rows read from SAP, inserted, updated, deleted, unchanged and the read time. The
hashes are then replaced by this extraction's. Tables over ``HASH_ROW_LIMIT`` rows are logged without the comparison.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from sqlalchemy import text

HASH_ROW_LIMIT = 2_000_000
_CHUNK = 5_000


def change_date_where(field: str, since: str) -> str:
    """The RFC_READ_TABLE condition for rows changed on or after ``since`` (YYYYMMDD)."""
    if not (since.isdigit() and len(since) == 8) or not field.replace("_", "").isalnum():
        raise ValueError("since must be YYYYMMDD and field a plain field name")
    return f"{field} >= '{since}'"


def merge_by_key(baseline: pd.DataFrame, fresh: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """The previous rows whose key was not re-read, plus every re-read row."""
    if not keys:
        return fresh
    k_old = baseline[keys].astype(str).agg("|".join, axis=1)
    k_new = set(fresh[keys].astype(str).agg("|".join, axis=1)) if len(fresh) else set()
    return pd.concat([baseline[~k_old.isin(k_new)], fresh], ignore_index=True)


def row_hashes(df: pd.DataFrame, key_cols: list[str]) -> pd.Series:
    """{record key: row hash} of a frame with ``TABLE.FIELD`` columns (hash over every column, sorted)."""
    from checks.base import record_keys

    cols = sorted(df.columns)
    hashed = pd.util.hash_pandas_object(df[cols].astype("string").fillna(""), index=False)
    out = pd.Series(hashed.map(lambda h: f"{int(h):016x}").to_numpy(), index=record_keys(df, key_cols).to_numpy())
    return out[~out.index.duplicated(keep="last")]


@dataclass
class TableChange:
    table: str
    mode: str
    rows_read: int
    rows_total: int
    inserted: int | None = None
    updated: int | None = None
    deleted: int | None = None
    unchanged: int | None = None
    duration_s: float | None = None

    @property
    def changed(self) -> int | None:
        if self.inserted is None:
            return None
        return self.inserted + (self.updated or 0) + (self.deleted or 0)


def diff(previous: dict[str, str], current: pd.Series) -> tuple[int, int, int, int]:
    """(inserted, updated, deleted, unchanged) of the current hashes against the previous ones."""
    keys = set(current.index)
    inserted = sum(1 for k in keys if k not in previous)
    same = sum(1 for k, h in current.items() if previous.get(k) == h)
    updated = len(keys) - inserted - same
    deleted = sum(1 for k in previous if k not in keys)
    return inserted, updated, deleted, same


def hashes_exist(session, tenant_id: str, version_id: str | None) -> bool:
    if not version_id:
        return False
    return session.execute(text("SELECT 1 FROM record_hashes WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) LIMIT 1"),
                           {"t": tenant_id, "v": version_id}).fetchone() is not None


def _prefix(table: str) -> str:
    return f"{table}:"


def previous_hashes(session, tenant_id: str, module: str, table: str) -> dict[str, str]:
    p = _prefix(table)
    return {r[0][len(p):]: r[1] for r in session.execute(text(
        "SELECT record_key, row_hash FROM record_hashes WHERE tenant_id = :t AND module = :m "
        "AND starts_with(record_key, :p)"), {"t": tenant_id, "m": module, "p": p}).fetchall()}


def store_hashes(session, tenant_id: str, version_id: str, module: str, table: str, hashes: pd.Series) -> None:
    """Replace the table's hashes with this extraction's: upsert the current rows, drop the keys that are gone."""
    p = _prefix(table)
    items = list(hashes.items())
    for i in range(0, len(items), _CHUNK):
        session.execute(text("""
            INSERT INTO record_hashes (tenant_id, module, record_key, row_hash, version_id)
            SELECT :t, :m, CAST(:p AS text) || k, h, CAST(:v AS uuid) FROM unnest(CAST(:ks AS text[]), CAST(:hs AS text[])) AS x(k, h)
            ON CONFLICT (tenant_id, module, record_key) DO UPDATE SET row_hash = EXCLUDED.row_hash,
                                                                      version_id = EXCLUDED.version_id"""),
            {"t": tenant_id, "m": module, "p": p, "v": version_id,
             "ks": [k for k, _ in items[i:i + _CHUNK]], "hs": [h for _, h in items[i:i + _CHUNK]]})
    session.execute(text("DELETE FROM record_hashes WHERE tenant_id = :t AND module = :m AND starts_with(record_key, :p) "
                         "AND version_id <> CAST(:v AS uuid)"), {"t": tenant_id, "m": module, "p": p, "v": version_id})


def track_table(session, tenant_id: str, version_id: str, module: str, table: str, df: pd.DataFrame,
                key_cols: list[str], entry: dict, compare: bool) -> TableChange:
    """The table's change log entry; with ``compare`` (a delta whose baseline left hashes) the hash comparison too.
    Hashes are stored for every table under the limit, so the next delta can compare."""
    info = entry.get("delta") if isinstance(entry.get("delta"), dict) else None
    mode = "full" if info is None else ("change_date" if info.get("mode") == "change_date" else "change_documents")
    change = TableChange(table, mode, rows_read=int(info["reread"]) if info else len(df), rows_total=len(df),
                         duration_s=entry.get("seconds"))
    if len(df) > HASH_ROW_LIMIT:
        return change
    current = row_hashes(df, key_cols)
    if compare:
        change.inserted, change.updated, change.deleted, change.unchanged = diff(
            previous_hashes(session, tenant_id, module, table), current)
    store_hashes(session, tenant_id, version_id, module, table, current)
    return change


def record_changes(session, tenant_id: str, version_id: str, changes: list[TableChange]) -> None:
    for c in changes:
        session.execute(text("""
            INSERT INTO extraction_changes (tenant_id, version_id, table_name, mode, rows_read, rows_total, inserted,
                                            updated, deleted, unchanged, duration_s)
            VALUES (:t, CAST(:v AS uuid), :tbl, :mode, :read, :total, :ins, :upd, :del, :same, :dur)
            ON CONFLICT (version_id, table_name) DO UPDATE SET mode = EXCLUDED.mode, rows_read = EXCLUDED.rows_read,
                rows_total = EXCLUDED.rows_total, inserted = EXCLUDED.inserted, updated = EXCLUDED.updated,
                deleted = EXCLUDED.deleted, unchanged = EXCLUDED.unchanged, duration_s = EXCLUDED.duration_s"""),
            {"t": tenant_id, "v": version_id, "tbl": c.table, "mode": c.mode, "read": c.rows_read, "total": c.rows_total,
             "ins": c.inserted, "upd": c.updated, "del": c.deleted, "same": c.unchanged, "dur": c.duration_s})
