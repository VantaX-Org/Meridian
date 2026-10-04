"""Statistical anomaly detection across extractions — the unknown-unknowns the
deterministic rules do not name.

After every extraction each data table gets a profile: row count and, per
column, blank rate, distinct count and — for code-like fields — the full value
distribution. The profile is compared with the same table's profiles from the
system's previous extractions:

  volume           row count outside the baseline range (drop or spike)
  null_rate        blank rate above the baseline range
  new_values       code values never seen in any baseline extraction
  vanished_values  code values of the previous extraction now absent

Baseline range: with ≥ 3 history points the median ± Z × MAD (scaled to σ,
with a floor so a perfectly stable history does not flag noise); with 1–2
points a relative / absolute change from the last extraction.

Memory: columns are profiled one at a time in fixed-size row chunks; distinct
counts beyond KMV_K values are a K-minimum-values estimate over 64-bit hashes,
so a 21M-row table never needs more than one chunk of one column extra.

Privacy: values are kept (distributions, sample values) only where
checks/profiling.py keeps them — non-sensitive code fields (DDIC length ≤ 10,
≤ 50 distinct). Sample rows are DDIC record keys, as for hidden-rule samples.
"""

from __future__ import annotations

import statistics
from collections import Counter
from typing import Any, Optional

import numpy as np
import pandas as pd

from checks.base import is_blank, record_keys
from checks.profiling import _CLIENT_FIELDS, CODE_MAX_DISTINCT, CODE_MAX_LENGTH, is_sensitive

CHUNK = 1_000_000
KMV_K = 4096
SAMPLE_ROWS = 5
MIN_HISTORY = 3          # points for MAD; fewer → relative-change fallback
HISTORY = 10             # baseline extractions considered
Z = 3.5                  # modified z-score threshold (Iglewicz & Hoaglin)

# per metric: fallback change from the last value, and the minimum spread of a MAD band
VOLUME_REL = 0.30        # ±30 % rows vs. the previous extraction
VOLUME_MIN_SPREAD = 0.02  # σ never below 2 % of the median row count
NULL_ABS = 0.10          # +10 pp blank rate vs. the previous extraction
NULL_MIN_SPREAD = 0.01   # σ never below 1 pp

_U64 = float(2 ** 64)


# ── profile ──────────────────────────────────────────────────────────────────


def code_like(table: str, field: str, dictionary: Any = None) -> bool:
    """Values of this field may be stored and shown (same rule as checks/profiling.py)."""
    f = dictionary.field(table, field) if dictionary is not None else None
    if f is None or not f.length or int(f.length) > CODE_MAX_LENGTH:
        return False
    return not is_sensitive(table, field, f.data_element)


def _values(part: pd.Series) -> tuple[pd.Series, int]:
    blank = is_blank(part)
    return part[~blank].astype("string").str.strip(), int(blank.sum())


def profile_column(series: pd.Series, codes: bool) -> dict:
    """{blank_rate, distinct, distinct_exact, values} — ``values`` the full value
    counts when ``codes`` and at most CODE_MAX_DISTINCT distinct, else None."""
    n = len(series)
    blank = 0
    sketch = np.empty(0, dtype=np.uint64)
    counts: Optional[Counter] = Counter() if codes else None
    for i in range(0, n, CHUNK):
        vals, b = _values(series.iloc[i:i + CHUNK])
        blank += b
        if len(vals):
            h = pd.util.hash_array(vals.to_numpy(dtype=object))
            sketch = np.unique(np.concatenate([sketch, h]))[:KMV_K]
        if counts is not None:
            counts.update(vals.value_counts(sort=False).to_dict())
            if len(counts) > CODE_MAX_DISTINCT:
                counts = None
    exact = len(sketch) < KMV_K
    distinct = len(sketch) if exact else int((KMV_K - 1) / ((float(sketch[-1]) + 1) / _U64))
    return {"blank_rate": round(blank / n, 6) if n else 0.0, "distinct": distinct, "distinct_exact": exact,
            "values": {str(k): int(v) for k, v in counts.items()} if counts is not None else None}


def profile_table(df: pd.DataFrame, table: str, dictionary: Any = None) -> dict:
    """{rows, columns: {FIELD: profile_column}} for a ``TABLE.FIELD`` frame."""
    cols = {}
    for c in df.columns:
        field = str(c).split(".", 1)[-1]
        if field.upper() in _CLIENT_FIELDS:
            continue
        cols[field] = profile_column(df[c], code_like(table, field, dictionary))
    return {"rows": int(len(df)), "columns": cols}


# ── baseline ─────────────────────────────────────────────────────────────────


def expected_range(history: list[float], rel: float = 0.0, abs_: float = 0.0,
                   min_spread: float = 0.0, relative_floor: bool = True) -> tuple[float, float, str]:
    """(low, high, method) for the next value given ``history`` (oldest first, ≥ 1 point)."""
    if len(history) >= MIN_HISTORY:
        med = statistics.median(history)
        mad = statistics.median(abs(x - med) for x in history) * 1.4826  # ≈ σ for normal data
        spread = max(mad, min_spread * (abs(med) if relative_floor else 1.0))
        return med - Z * spread, med + Z * spread, "mad"
    last = history[-1]
    delta = max(abs(last) * rel, abs_)
    return last - delta, last + delta, "relative_change"


# ── detection ────────────────────────────────────────────────────────────────


def _first(series: pd.Series, want_blank: bool, n: int = SAMPLE_ROWS,
           values: Optional[set[str]] = None) -> list[int]:
    """Positions of the first ``n`` rows that are blank (``want_blank``) or, else,
    populated — restricted to ``values`` when given. Chunked: stops early."""
    out: list[int] = []
    for i in range(0, len(series), CHUNK):
        part = series.iloc[i:i + CHUNK]
        hit = is_blank(part)
        if not want_blank:
            hit = ~hit
            if values is not None:
                hit &= part.astype("string").str.strip().isin(values).fillna(False)
        out += [i + int(p) for p in np.flatnonzero(hit.to_numpy())[: n - len(out)]]
        if len(out) >= n:
            break
    return out


def _rows(df: pd.DataFrame, col: str, pos: list[int], key_cols: list[str], show: bool) -> list[dict]:
    if not pos:
        return []
    part = df.iloc[pos]
    keys = record_keys(part, key_cols) if key_cols else pd.Series([f"row:{p}" for p in pos])
    vals = part[col].astype("string").str.strip()
    return [{"record_key": str(k), **({"value": None if pd.isna(v) else str(v)} if show else {})}
            for k, v in zip(keys, vals)]


def detect(table: str, current: dict, history: list[dict], df: Optional[pd.DataFrame] = None,
           dictionary: Any = None) -> list[dict]:
    """Anomalies of ``current`` against ``history`` (oldest first, each a stored profile).

    Each: {metric, table, field, expected: {low, high, method, history}, observed,
    affected, total, severity, dimension, message, samples: {good, bad}}.
    Volume compares only profiles with the same extraction window, none truncated.
    """
    if not history:
        return []
    out: list[dict] = []
    rows = current["rows"]
    key_cols = []
    if df is not None and dictionary is not None:
        key_cols = [f"{table}.{k}" for k in dictionary.keys(table) if f"{table}.{k}" in df.columns]

    def add(metric: str, field: Optional[str], low, high, method, hist, observed, affected, severity, dimension,
            message, good=(), bad=()):
        out.append({"metric": metric, "table": table, "field": field,
                    "expected": {"low": low, "high": high, "method": method, "history": hist},
                    "observed": observed, "affected": int(affected), "total": int(rows),
                    "severity": severity, "dimension": dimension, "message": message,
                    "samples": {"good": list(good), "bad": list(bad)}})

    vol = [h["rows"] for h in history if h.get("window") == current.get("window") and not h.get("truncated")]
    if vol and not current.get("truncated"):
        low, high, method = expected_range(vol, rel=VOLUME_REL, min_spread=VOLUME_MIN_SPREAD)
        low = max(0.0, low)
        if not low <= rows <= high:
            add("volume", None, round(low), round(high), method, vol, rows,
                abs(rows - statistics.median(vol)), "high" if rows < low else "medium", "completeness",
                f"{table}: {rows:,} rows, expected {max(0, round(low)):,}–{round(high):,} "
                f"({'drop' if rows < low else 'spike'})")

    for field, cur in current["columns"].items():
        col = f"{table}.{field}"
        have = df is not None and col in df.columns
        show = code_like(table, field, dictionary)
        rates = [h["columns"][field]["blank_rate"] for h in history if field in h.get("columns", {})]
        if rates:
            low, high, method = expected_range(rates, abs_=NULL_ABS, min_spread=NULL_MIN_SPREAD,
                                               relative_floor=False)
            if cur["blank_rate"] > high:
                good = _rows(df, col, _first(df[col], False), key_cols, show) if have else []
                bad = _rows(df, col, _first(df[col], True), key_cols, False) if have else []
                add("null_rate", field, round(max(0.0, low), 6), round(min(1.0, high), 6), method, rates,
                    cur["blank_rate"], round(cur["blank_rate"] * rows), "medium", "completeness",
                    f"{col}: {cur['blank_rate']:.1%} blank, expected at most {min(1.0, high):.1%}", good, bad)

        if cur.get("values") is None:
            continue
        seen = [h["columns"][field]["values"] for h in history
                if (h.get("columns", {}).get(field) or {}).get("values") is not None]
        if not seen:
            continue
        known = set().union(*seen)
        new = sorted(set(cur["values"]) - known)
        if new:
            usual = sorted(set(cur["values"]) & known, key=lambda v: -cur["values"][v])[:1]
            good = _rows(df, col, _first(df[col], False, values=set(usual)), key_cols, True) if have and usual else []
            bad = _rows(df, col, _first(df[col], False, values=set(new)), key_cols, True) if have else []
            add("new_values", field, None, None, "baseline_values", sorted(known), new,
                sum(cur["values"][v] for v in new), "medium", "validity",
                f"{col}: {len(new)} value(s) not seen in {len(seen)} previous extraction(s): "
                + ", ".join(new[:10]), good, bad)
        gone = sorted(set(seen[-1]) - set(cur["values"]))
        if gone:
            add("vanished_values", field, None, None, "previous_values", sorted(seen[-1]), gone,
                sum(seen[-1][v] for v in gone), "medium", "consistency",
                f"{col}: {len(gone)} value(s) of the previous extraction now absent: " + ", ".join(gone[:10]))
    return out


def check_id(anomaly: dict) -> str:
    """Stable per version: ANOMALY.<metric>.<TABLE>[.<FIELD>]."""
    return ".".join(x for x in ("ANOMALY", anomaly["metric"], anomaly["table"], anomaly["field"]) if x)
