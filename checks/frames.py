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

import logging
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

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


class TableFrames:
    """One DataFrame per SAP table plus the original flat frame (if any)."""

    def __init__(self, frames: dict[str, pd.DataFrame], dictionary: Dictionary | None = None,
                 flat: pd.DataFrame | None = None, unsplittable: set[str] | None = None,
                 module: str | None = None):
        self.dictionary = dictionary or get_dictionary("s4hana")
        self.frames = frames
        self.flat = flat
        self.unsplittable = unsplittable or set()
        self.module = module
        self._cache: dict[tuple, tuple[pd.DataFrame, str, list[str]]] = {}
        self._apply_moved_fields()

    # ── construction ─────────────────────────────────────────────────────

    @classmethod
    def from_flat(cls, df: pd.DataFrame, dictionary: Dictionary | None = None,
                  module: str | None = None) -> "TableFrames":
        """Split a flat ``TABLE.FIELD`` frame into per-table frames by DDIC key."""
        d = dictionary or get_dictionary("s4hana")
        frames: dict[str, pd.DataFrame] = {}
        unsplittable: set[str] = set()
        for table in tables_of(df.columns):
            cols = [c for c in df.columns if c.startswith(table + ".")]
            keys = [f"{table}.{k}" for k in d.keys(table)]
            if keys and all(k in df.columns for k in keys):
                part = df[cols]
                part = part[~part[keys].isna().all(axis=1)].drop_duplicates(subset=keys)
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
                self.frames[s4_table] = _join(host, src, edge, [origin]).rename(columns={origin: s4})

    # ── per-rule frame ───────────────────────────────────────────────────

    def frame_for(self, columns: list[str], grain: str | None = None
                  ) -> Optional[tuple[pd.DataFrame, str | None, list[str]]]:
        """(frame, grain_table, key_columns) for a rule's columns, or None to skip."""
        tables = tables_of(columns)
        if not tables:
            return None
        if any(t in self.unsplittable for t in tables) or (not self.frames and self.flat is not None):
            if self.flat is None or any(c not in self.flat.columns for c in columns):
                return None
            return self.flat, None, []
        if any(t not in self.frames for t in tables):
            return None  # table not extracted → rule not applicable
        cache_key = (self.module, grain, tuple(sorted(tables)))
        if cache_key in self._cache:
            return self._cache[cache_key]

        g = grain or self._resolve_grain(tables)
        if g not in self.frames:
            return None
        frame = self.frames[g]
        for t in tables:
            if t == g:
                continue
            path = self._path(g, t)
            if path is None:
                raise ValueError(f"No non-fan-out join path from {g} to {t} (sap/dictionaries/joins.yaml)")
            for edge, direction in path:
                other = edge.parent if direction == "up" else edge.child
                if other not in self.frames:
                    return None
                need = [c for c in self.frames[other].columns if c not in frame.columns]
                frame = _join(frame, self.frames[other], edge, need, up=(direction == "up"))
        keys = [f"{g}.{k}" for k in self.dictionary.keys(g) if f"{g}.{k}" in frame.columns]
        self._cache[cache_key] = (frame, g, keys)
        return self._cache[cache_key]

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
    r = r.drop_duplicates(subset=rk)
    keep = list(dict.fromkeys(rk + [c for c in cols if c in r.columns and c not in left.columns]))
    lnorm = left[lk].astype("string").apply(lambda s: s.str.strip())
    rnorm = r[keep].copy()
    for k in rk:
        rnorm[k] = rnorm[k].astype("string").str.strip()
    merged = lnorm.merge(rnorm, how="left", left_on=lk, right_on=rk)
    merged.index = left.index
    added = [c for c in keep if c not in left.columns and c not in lk]
    return pd.concat([left, merged[added]], axis=1)
