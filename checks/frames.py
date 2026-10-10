"""Per-table frames + grain resolution: evaluate every rule at its true record grain.

Why: a flat LFA1×LFB1 extract repeats every vendor once per company code, so a
vendor-level rule counts the same vendor N times and a uniqueness rule
(`~LFA1.LIFNR.duplicated()`) flags every multi-company vendor as a duplicate.
Instead the engine holds one frame per SAP table (columns ``TABLE.FIELD``,
de-duplicated on the table's DDIC key) and, per rule, builds exactly the frame
the rule needs:

* **grain** = the finest table the rule touches. Attribute tables (joined
  1:0..1, e.g. ADR6 e-mail, LFBK bank, ANLZ time segment) are evaluated at
  their parent's grain, so a vendor with *no* bank row fails "bank required".
* other tables are joined along ``sap/dictionaries/joins.yaml`` — up to
  parents (many-to-one) or down to attribute tables (one) — never fanning out.

Flat uploads whose columns lack a table's key cannot be split reliably; rules
touching such a table fall back to the flat frame as uploaded.
"""

from __future__ import annotations

import copy
import io
import logging
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

from checks.base import record_keys
from sap.ddic import Dictionary, get_dictionary

logger = logging.getLogger("meridian.checks.frames")

_JOINS = Path(__file__).resolve().parent.parent / "sap" / "dictionaries" / "joins.yaml"


@dataclass(frozen=True)
class Edge:
    parent: str
    child: str
    on: tuple[tuple[str, str], ...]   # (child_field, parent_field)
    cardinality: str                  # one | many
    filter: tuple[tuple[str, str], ...] = ()
    prefer: tuple[tuple[str, str], ...] = ()


@lru_cache(maxsize=1)
def _graph() -> tuple[tuple[Edge, ...], dict[str, str]]:
    doc = yaml.safe_load(_JOINS.read_text())
    edges = tuple(
        Edge(
            parent=e["parent"], child=e["child"],
            on=tuple((k, v) for k, v in e["join"].items()),
            cardinality=e["cardinality"],
            filter=tuple((k, str(v)) for k, v in (e.get("filter") or {}).items()),
            prefer=tuple((k, str(v)) for k, v in (e.get("prefer") or {}).items()),
        )
        for e in doc["edges"]
    )
    return edges, dict(doc.get("anchors") or {})


def _moved_fields() -> dict[str, str]:
    """S/4 field → ECC origin (e.g. VBAK.GBSTK → VBUK.GBSTK) from the S/4 delta."""
    delta = yaml.safe_load((_JOINS.parent / "s4hana_delta.yaml").read_text())
    return {
        f"{t}.{f}": origin
        for t, spec in (delta.get("fields_moved") or {}).items()
        for f, origin in spec["fields"].items()
    }


_MOVED = _moved_fields()


def tables_of(columns: list[str] | set[str]) -> list[str]:
    return list(dict.fromkeys(c.split(".", 1)[0] for c in columns if "." in c))


def unprefix(table: str, df: pd.DataFrame) -> pd.DataFrame:
    """Frames hold ``TABLE.FIELD`` columns; this gives the bare field names (MATNR) a
    one-table service reads. Columns of other tables or already bare stay as they are."""
    return df.rename(columns=lambda c: c.split(".", 1)[1] if str(c).startswith(f"{table}.") else c)


def internal_format(df: pd.DataFrame, dictionary: Dictionary,
                    conversions: dict[str, dict[str, str]] | None = None) -> pd.DataFrame:
    """Uploaded values in SAP's internal format, as RFC delivers them: numeric
    values of ALPHA / MATN1 fields zero-padded (spreadsheets drop the zeros, so
    '140000' would never match SKB1.SAKNR '0000140000'), and external codes of
    CUNIT / AUART fields ('PC', 'OR') mapped to internal ones ('ST', 'TA') through
    the system's own T006A / TAUUM (sap/field_status_config.conversion_maps)."""
    out = None
    for c in df.columns:
        f = dictionary.resolve(c) if "." in str(c) else None
        if f is not None and (conversions or {}).get(f.conversion_exit or ""):
            m = conversions[f.conversion_exit]
            s = df[c].astype("string").str.strip()
            hit = s.isin(m.keys()).fillna(False)
            if hit.any():
                out = df.copy() if out is None else out
                out[c] = s.where(~hit, s.map(m))
            continue
        if f is None or f.conversion_exit not in ("ALPHA", "MATN1") or not f.length:
            continue
        width = min(f.length, 18) if f.conversion_exit == "MATN1" else f.length  # MATN1: 18-digit internal form
        s = df[c].astype("string").str.strip()
        digits = s.str.fullmatch(r"\d+", na=False) & (s.str.len() < width)
        if digits.any():
            out = df.copy() if out is None else out
            out[c] = s.where(~digits, s.str.zfill(width))
    return df if out is None else out


_STRING_BYTES = 14  # decoded bytes per row of a string column under pandas 3 (arrow strings)


class ParquetTable:
    """One extracted table held as its compressed parquet bytes; columns decode on access.

    A wide table of tens of millions of rows takes tens of GB once decoded, while a
    rule reads a handful of its columns. Indexing returns exactly what the same
    indexing of the fully decoded frame returns (same values, dtypes and index).
    """

    def __init__(self, data: bytes) -> None:
        self._data = data
        meta = pq.ParquetFile(io.BytesIO(data))
        index = {c for c in (meta.schema_arrow.pandas_metadata or {}).get("index_columns", []) if isinstance(c, str)}
        self._stored = pd.Index([c for c in meta.schema_arrow.names if c not in index])
        self._added: dict[str, pd.Series] = {}
        self.columns = self._stored
        self._rows = meta.metadata.num_rows
        self._sizes: dict[str, int] | None = None
        self._meta = meta.metadata
        self._strings = {f.name for f in meta.schema_arrow if pa.types.is_string(f.type) or pa.types.is_large_string(f.type)}

    def nbytes(self, col: str) -> int:
        """Estimated decoded bytes of ``col``: the parquet metadata's uncompressed size, never less
        than ``_STRING_BYTES`` a row for a string column (pandas 3 holds those as arrow strings)."""
        if col in self._added:
            return int(self._added[col].memory_usage(deep=True))
        if self._sizes is None:
            sizes: dict[str, int] = {}
            for i in range(self._meta.num_row_groups):
                rg = self._meta.row_group(i)
                for j in range(rg.num_columns):
                    c = rg.column(j)
                    sizes[c.path_in_schema] = sizes.get(c.path_in_schema, 0) + c.total_uncompressed_size
            self._sizes = sizes
        return max(self._sizes.get(col, 0), _STRING_BYTES * self._rows if col in self._strings else 0)

    def with_column(self, name: str, values: pd.Series) -> "ParquetTable":
        """A copy with ``values`` appended as column ``name`` (held decoded; the rest stays compressed)."""
        out = copy.copy(self)
        out._added = {**self._added, name: values}
        out.columns = self._stored.append(pd.Index(list(out._added)))
        return out

    def __len__(self) -> int:
        return self._rows

    @property
    def empty(self) -> bool:
        return self._rows == 0 or len(self.columns) == 0

    def __getitem__(self, cols: str | list[str]) -> pd.Series | pd.DataFrame:
        if isinstance(cols, str):
            return self[[cols]][cols]
        missing = [c for c in cols if c not in self.columns]
        if missing:
            raise KeyError(missing)
        stored = [c for c in cols if c in self._stored]
        if not stored:  # the index only: decode one column for it
            first = list(self._stored[:1])
            frame = pd.read_parquet(io.BytesIO(self._data), columns=first).drop(columns=first)
        else:
            frame = pd.read_parquet(io.BytesIO(self._data), columns=stored)
        if len(stored) == len(cols):
            return frame
        return frame.assign(**{c: self._added[c] for c in cols if c in self._added})[list(cols)]

    def head(self, n: int) -> pd.DataFrame:
        """The first ``n`` rows, all columns, decoding only those rows."""
        if n >= self._rows:
            return self[list(self.columns)]
        pf = pq.ParquetFile(io.BytesIO(self._data))
        batches: list[pa.RecordBatch] = []
        for batch in pf.iter_batches(batch_size=max(n, 1)):
            if sum(len(b) for b in batches) >= n:
                break
            batches.append(batch)
        part = pa.Table.from_batches(batches, schema=pf.schema_arrow).slice(0, n)
        buf = io.BytesIO()
        pq.write_table(part.replace_schema_metadata(pf.schema_arrow.metadata), buf)
        out = pd.read_parquet(io.BytesIO(buf.getvalue()))
        return out.assign(**{c: v.iloc[:n].set_axis(out.index) for c, v in self._added.items()})


def _edge_columns(edge: Edge) -> set[str]:
    """Columns a join along ``edge`` reads: its keys on both sides and the child's filter/prefer fields."""
    return ({f"{edge.child}.{c}" for c, _ in edge.on} | {f"{edge.parent}.{p}" for _, p in edge.on}
            | {f"{edge.child}.{f}" for f, _ in edge.filter + edge.prefer})


class TableFrames:
    """One DataFrame per SAP table plus the original flat frame (if any)."""

    def __init__(self, frames: dict[str, pd.DataFrame | ParquetTable], dictionary: Dictionary | None = None,
                 flat: pd.DataFrame | None = None, unsplittable: set[str] | None = None,
                 module: str | None = None):
        self.dictionary = dictionary or get_dictionary("s4hana")
        self.frames = frames
        self.flat = flat
        self.unsplittable = unsplittable or set()
        self.module = module
        self._cache: dict[tuple, tuple[pd.DataFrame, str, list[str]]] = {}
        self._norm: dict[str, pd.Series] = {}  # stripped string columns of the cached frame (population.exclude)
        self.incomplete: set[str] = set()  # tables the extraction could not read completely
        self.partial: set[str] = set()  # tables read by window or scope (not every record)
        self._apply_moved_fields()

    # ── construction ─────────────────────────────────────────────────────

    @classmethod
    def from_flat(cls, df: pd.DataFrame, dictionary: Dictionary | None = None,
                  module: str | None = None, conversions: dict[str, dict[str, str]] | None = None) -> "TableFrames":
        """Split a flat ``TABLE.FIELD`` frame into per-table frames by DDIC key."""
        d = dictionary or get_dictionary("s4hana")
        df = internal_format(df, d, conversions)
        frames: dict[str, pd.DataFrame] = {}
        unsplittable: set[str] = set()
        for table in tables_of(df.columns):
            cols = [c for c in df.columns if c.startswith(table + ".")]
            keys = [f"{table}.{k}" for k in d.keys(table)]
            if keys and all(k in df.columns for k in keys):
                part = df[cols]
                # drop rows the flat layout repeated (vendor data on every company-code
                # line), never rows that merely share a key: those are duplicates or
                # distinct records, and uniqueness rules must see them
                part = part[~part[keys].isna().all(axis=1)].drop_duplicates()
                frames[table] = part.reset_index(drop=True)
            else:
                unsplittable.add(table)
        return cls(frames, d, flat=df, unsplittable=unsplittable, module=module)

    def _apply_moved_fields(self) -> None:
        """Expose ECC fields under their S/4 name (VBUK.GBSTK → VBAK.GBSTK)."""
        for s4, origin in _MOVED.items():
            s4_table, origin_table = s4.split(".")[0], origin.split(".")[0]
            if self.flat is not None and origin in self.flat.columns and s4 not in self.flat.columns:
                self.flat[s4] = self.flat[origin]
            host, src = self.frames.get(s4_table), self.frames.get(origin_table)
            if host is None or src is None or s4 in host.columns or origin not in src.columns:
                continue
            edge = next((e for e in _graph()[0] if e.parent == s4_table and e.child == origin_table), None)
            if edge:
                # only the join's columns and the moved field: a lazily held table stays compressed
                cols = _edge_columns(edge) | {origin}
                src = _decoded(src, cols)
                if isinstance(host, ParquetTable):
                    moved = _join(_decoded(host, cols), src, edge, [origin]).rename(columns={origin: s4})
                    for c in moved.columns.difference(host.columns, sort=False):  # as the full join adds them
                        host = host.with_column(c, moved[c])
                    self.frames[s4_table] = host
                else:
                    self.frames[s4_table] = _join(host, src, edge, [origin]).rename(columns={origin: s4})

    def plain(self, table: str) -> pd.DataFrame | None:
        """``table``'s frame with bare field names plus ``__key__``, the record key exactly as
        the migration engine and finding_records build it (DDIC key, ``MATNR=..|WERKS=..``).
        None when the table was not extracted or is empty."""
        df = self.frames.get(table)
        if df is None or df.empty:
            return None
        keys = [f"{table}.{k}" for k in self.dictionary.keys(table) if f"{table}.{k}" in df.columns]
        return unprefix(table, df).assign(__key__=record_keys(df, keys))

    # ── per-rule frame ───────────────────────────────────────────────────

    def grain_for(self, columns: list[str], grain: str | None = None) -> str | None:
        """The table ``frame_for(columns, grain)`` evaluates at; None for the flat frame."""
        tables = tables_of(columns)
        if not tables or any(t in self.unsplittable for t in tables) or (not self.frames and self.flat is not None):
            return None
        return grain or self._resolve_grain(tables)

    def clear_cache(self) -> None:
        """Drop the joined per-rule frames (they hold decoded copies of the tables)."""
        self._cache.clear()
        self._norm.clear()

    @property
    def lazy(self) -> bool:
        return any(isinstance(f, ParquetTable) for f in self.frames.values())

    def _wanted(self, columns: set[str], g: str) -> set[str] | None:
        """The columns ``frame_for`` decodes for ``columns`` at grain ``g``; None means every column
        (a grain without a key in the extract guesses the record id from all of them)."""
        if not any(f"{g}.{k}" in self.frames[g].columns for k in self.dictionary.keys(g)):
            return None
        out = set(columns) | {f"{g}.{k}" for k in self.dictionary.keys(g)}
        for t in set(tables_of(list(columns))) - {g}:
            out |= {c for edge, _ in self._path(g, t) or [] for c in _edge_columns(edge)}
        return out

    def estimate_bytes(self, columns: set[str], grain: str, stripped: set[str] | None = None) -> int:
        """Decoded bytes of the joined frame ``frame_for`` builds at ``grain`` for ``columns``, from
        parquet metadata. Every column is held once per grain row; ``stripped`` ones twice (the
        normalised copy rules keep). Each decoded table, then the join, holds no more than this."""
        rows = len(self.frames[grain])
        wanted = self._wanted(columns, grain)
        total = 0
        for t in {c.partition(".")[0] for c in columns} | {grain} | {
                e for tb in set(tables_of(list(columns))) - {grain} for edge, _ in self._path(grain, tb) or []
                for e in (edge.parent, edge.child)}:
            src = self.frames.get(t)
            if src is None or not len(src):
                continue
            for c in src.columns:
                if wanted is not None and c not in wanted:
                    continue
                size = src.nbytes(c) if isinstance(src, ParquetTable) else _STRING_BYTES * len(src)
                total += size * rows // len(src) * (2 if stripped and c in stripped else 1)
        return total

    def prefetch(self, columns: set[str], grain: str) -> None:
        """Lazy tables: build ``grain``'s joined frame once with every column a group of rules
        reads, so each rule reuses it instead of re-joining (an 18M-row merge costs ~10s).
        Callers keep ``columns`` within a byte budget (``estimate_bytes``)."""
        cols = sorted(c for c in columns if c.partition(".")[0] in self.frames
                      and c in self.frames[c.partition(".")[0]].columns
                      and (pt := self.path_tables([c], grain)) is not None and pt <= set(self.frames))
        if self.lazy and cols and grain in self.frames:
            self.frame_for(cols, grain=grain)

    def frame_for(self, columns: list[str], grain: str | None = None, optional: list[str] | None = None
                  ) -> Optional[tuple[pd.DataFrame, str | None, list[str]]]:
        """(frame, grain_table, key_columns) for a rule's columns, or None to skip.

        ``optional`` columns are read when their table is joined anyway and are never
        required: a fully decoded frame has them already, a lazy one decodes them too."""
        tables = tables_of(columns)
        if not tables:
            return None
        if any(t in self.unsplittable for t in tables) or (not self.frames and self.flat is not None):
            if self.flat is None or any(c not in self.flat.columns for c in columns):
                return None
            return self.flat, None, []
        if any(t not in self.frames for t in tables):
            return None  # table not extracted → rule not applicable
        # a lazy frame holds only the columns rules asked for, so a cached one serves a rule
        # that needs no more tables and columns than it has; only the last one is kept
        lazy = self.lazy
        read = set(columns) | set(optional or [])
        g = self.grain_for(columns, grain)
        if g not in self.frames:
            return None
        want = set(tables) | {g}
        cache_key = (self.module, g, tuple(sorted(want)))
        avail = {c for c in read if c.partition(".")[0] in want and c in self.frames[c.partition(".")[0]].columns}
        for key, hit in self._cache.items():
            if key == cache_key or (lazy and key[:2] == cache_key[:2] and want <= set(key[2])):
                if not lazy or avail <= set(hit[0].columns):
                    return hit
        paths = {t: self._path(g, t) for t in tables if t != g}
        wanted: set[str] | None = None
        if lazy and any(f"{g}.{k}" in self.frames[g].columns for k in self.dictionary.keys(g)):
            # the rule's fields, the grain's key and every join's keys; without a key the
            # record id is guessed from all columns (checks/base.find_id_field), so read all
            wanted = read | {f"{g}.{k}" for k in self.dictionary.keys(g)}
            wanted |= {c for path in paths.values() for edge, _ in path or [] for c in _edge_columns(edge)}
        frame = _decoded(self.frames[g], wanted)
        for t, path in paths.items():
            if path is None:
                raise ValueError(f"No non-fan-out join path from {g} to {t} (sap/dictionaries/joins.yaml)")
            for edge, direction in path:
                other = edge.parent if direction == "up" else edge.child
                if other not in self.frames:
                    return None
                right = _decoded(self.frames[other], wanted)
                need = [c for c in right.columns if c not in frame.columns]
                frame = _join(frame, right, edge, need, up=(direction == "up"))
        keys = [f"{g}.{k}" for k in self.dictionary.keys(g) if f"{g}.{k}" in frame.columns]
        if lazy:
            self.clear_cache()
        self._cache[cache_key] = (frame, g, keys)
        return self._cache[cache_key]

    def path_tables(self, columns: list[str], grain: str | None = None) -> Optional[set[str]]:
        """Every table the engine joins to evaluate ``columns`` (grain + paths)."""
        tables = tables_of(columns)
        if not tables:
            return None
        g = grain or self._resolve_grain(tables)
        out = {g}
        for t in tables:
            if t == g:
                continue
            path = self._path(g, t)
            if path is None:
                return None
            for edge, direction in path:
                out.add(edge.parent if direction == "up" else edge.child)
        return out

    def _resolve_grain(self, tables: list[str]) -> str:
        edges, anchors = _graph()
        attr_parent = {}
        for t in tables:
            parents = [e.parent for e in edges if e.child == t and e.cardinality == "one"]
            in_rule = [p for p in parents if p in tables]
            present = [p for p in parents if p in self.frames]
            if in_rule or present:
                anchor = anchors.get(self.module or "")
                attr_parent[t] = (in_rule or ([anchor] if anchor in present else present))[0]
        candidates = []
        for t in tables:
            g = t
            seen = set()
            while g in attr_parent and g not in seen:
                seen.add(g)
                g = attr_parent[g]
            candidates.append(g)
        candidates = list(dict.fromkeys(candidates))
        for c in candidates:
            if all(o == c or self._path(c, o) is not None for o in candidates):
                return c
        return candidates[0]

    def _path(self, start: str, goal: str) -> Optional[list[tuple[Edge, str]]]:
        """BFS over non-fan-out moves: child→parent ("up") or parent→attribute ("down")."""
        edges, _ = _graph()
        queue = deque([(start, [])])
        seen = {start}
        while queue:
            node, path = queue.popleft()
            if node == goal:
                return path
            for e in edges:
                if e.child == node and e.parent not in seen:
                    seen.add(e.parent)
                    queue.append((e.parent, path + [(e, "up")]))
                elif e.parent == node and e.cardinality == "one" and e.child not in seen:
                    seen.add(e.child)
                    queue.append((e.child, path + [(e, "down")]))
        return None


def _decoded(table: pd.DataFrame | ParquetTable, columns: set[str] | None = None) -> pd.DataFrame:
    """``table`` as a DataFrame; a lazily held one decodes only ``columns`` (None: all), in table order."""
    if not isinstance(table, ParquetTable):
        return table
    return table[[c for c in table.columns if columns is None or c in columns]]


def _join(left: pd.DataFrame, right: pd.DataFrame, edge: Edge, cols: list[str],
          up: bool = False) -> pd.DataFrame:
    """Left-join ``right`` onto ``left`` along ``edge`` without multiplying rows."""
    if up:   # left is the child, right is the parent
        lk = [f"{edge.child}.{c}" for c, _ in edge.on]
        rk = [f"{edge.parent}.{p}" for _, p in edge.on]
    else:    # left is the parent, right is the child
        lk = [f"{edge.parent}.{p}" for _, p in edge.on]
        rk = [f"{edge.child}.{c}" for c, _ in edge.on]
    if any(k not in left.columns for k in lk) or any(k not in right.columns for k in rk):
        return left
    r = right
    if not up:
        for f, v in edge.filter:
            col = f"{edge.child}.{f}"
            if col in r.columns:
                r = r[r[col].astype("string").fillna("").str.strip() == v]
        if edge.prefer:
            order = pd.Series(0, index=r.index)
            for f, v in edge.prefer:
                col = f"{edge.child}.{f}"
                if col in r.columns:
                    order -= (r[col].astype("string").str.strip() == v).astype(int)
            r = r.assign(_prefer=order).sort_values("_prefer", kind="stable").drop(columns="_prefer")
    keep = list(dict.fromkeys(rk + [c for c in cols if c in r.columns and c not in left.columns]))
    lnorm = left[lk].astype("string").apply(lambda s: s.str.strip())
    rnorm = r[keep].copy()
    for k in rk:
        rnorm[k] = rnorm[k].astype("string").str.strip()
    # dedup on the trimmed keys the merge uses: 'M1' and 'M1 ' would otherwise both match
    rnorm = rnorm.drop_duplicates(subset=rk)
    merged = lnorm.merge(rnorm, how="left", left_on=lk, right_on=rk)
    merged.index = left.index
    added = [c for c in keep if c not in left.columns and c not in lk]
    return pd.concat([left, merged[added]], axis=1)
