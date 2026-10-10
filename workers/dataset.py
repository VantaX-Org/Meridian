"""Load an analysis version's dataset from MinIO into per-table frames.

  "<prefix>/"         → live-extraction bundle, one <TABLE>.parquet per SAP table
  "<path>.parquet"    → flat upload with TABLE.FIELD columns (split by DDIC key)

Shared by the check pipeline and the migration analyser so both read exactly
the same data the same way.
"""

from __future__ import annotations

import io
import logging
import os
from typing import Optional
from urllib.parse import quote, unquote

import pandas as pd

from checks.frames import TableFrames, tables_of
from sap.ddic import Dictionary

logger = logging.getLogger("meridian.workers.dataset")


def _client():
    from minio import Minio

    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
        secret_key=os.getenv("MINIO_SECRET_KEY") or os.getenv("MINIO_PASSWORD") or "",
        secure=False,
    )


def _read(client, bucket: str, name: str) -> bytes:
    resp = client.get_object(bucket, name)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


def parquet_name(table: str) -> str:
    """Bundle object name for a table; /SCWM/AQUA → %2FSCWM%2FAQUA.parquet (one object, no sub-folders)."""
    return quote(table, safe="") + ".parquet"


def load_dataset(path: str, dictionary: Dictionary, modules: Optional[list[str]] = None,
                 extra: Optional[set[str]] = None, conversions: Optional[dict[str, dict[str, str]]] = None,
                 *, tables: Optional[set[str]] = None) -> tuple[TableFrames, Optional[pd.DataFrame], int, int]:
    """(frames, flat_df_or_None, row_count, column_count) for a dataset path.

    ``tables``, when given, restricts the per-table (extraction bundle) branch to
    those table names — loading every table in a bundle eagerly has OOM'd workers
    that only need a handful (e.g. proven-cost metrics).
    """
    client = _client()
    bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
    if path.endswith("/"):
        loaded = {}
        for obj in client.list_objects(bucket, prefix=path):
            name = obj.object_name.rsplit("/", 1)[-1]
            if name.endswith(".parquet"):
                table_name = unquote(name[: -len(".parquet")])
                if tables is not None and table_name not in tables:
                    continue
                loaded[table_name] = pd.read_parquet(io.BytesIO(_read(client, bucket, obj.object_name)))
        if not loaded:
            raise ValueError(f"No table parquet files under {path}")
        return (TableFrames(loaded, dictionary), None, sum(len(t) for t in loaded.values()),
                sum(len(t.columns) for t in loaded.values()))

    buf = io.BytesIO(_read(client, bucket, path))
    needed: set[str] = set()
    if modules:
        # Column pruning: every column any rule reads plus each referenced
        # table's DDIC key (needed to split the flat frame at its grain).
        try:
            from checks.runner import get_required_columns
            from checks.config_rules import fields_for as config_fields
            from checks.country_rules import fields_for as country_fields
            from checks.value_placement import fields_for
            from checks.config_rules import live_tables
            for mod in modules:
                needed |= get_required_columns(mod)
                needed |= {f"{t}.{f}" for t, fs in live_tables(mod, dictionary).items() for f in fs}
            needed |= set(extra or ())
            needed |= {f"{t}.{f}" for t in tables_of(needed)
                       for f in fields_for(t, dictionary) | country_fields(t, dictionary) | config_fields(t, dictionary)}
            needed |= {f"{t}.{k}" for t in tables_of(needed) for k in dictionary.keys(t)}
        except FileNotFoundError:
            needed = set()
    import pyarrow.parquet as pq
    all_cols = set(pq.read_schema(buf).names)
    buf.seek(0)
    project = [c for c in all_cols if c in needed] if needed else None
    df = pd.read_parquet(buf, columns=project or None)
    return TableFrames.from_flat(df, dictionary, conversions=conversions), df, len(df), len(df.columns)


def load_module_frame(path: str, module: str, dictionary: Optional[Dictionary] = None) -> pd.DataFrame:
    """One flat frame for record-level consumers (cleaning, dedup, mining).

    Flat uploads are returned as uploaded. Extraction bundles return the
    module's anchor table (e.g. LFA1 for accounts_payable) joined with its
    1:1 attribute tables (address, e-mail, bank …) — one row per business
    object, never fanned out.
    """
    from checks.frames import _graph
    from sap.ddic import get_dictionary

    d = dictionary or get_dictionary("s4hana")
    frames, flat, _, _ = load_dataset(path, d, [module])
    if flat is not None:
        return flat
    edges, anchors = _graph()
    anchor = anchors.get(module)
    if anchor not in frames.frames:
        anchor = max(frames.frames, key=lambda t: len(frames.frames[t]))  # best effort: largest table
    tables, todo = {anchor}, [anchor]
    while todo:
        cur = todo.pop()
        for e in edges:
            if e.parent == cur and e.cardinality == "one" and e.child in frames.frames and e.child not in tables:
                tables.add(e.child)
                todo.append(e.child)
    cols = [c for t in tables for c in frames.frames[t].columns]
    built = frames.frame_for(cols, grain=anchor)
    return built[0] if built else frames.frames[anchor]
