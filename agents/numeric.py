"""Null-safe numeric helpers for aggregating finding and score fields.

DB rows and agent state carry explicit ``None`` (``dict.get(k, 0)`` does not help when the key
is present). Counts become 0 (nothing affected is semantically true); rates and scores are
"not measured" and are excluded from averages rather than counted as 0 or 100.
"""

from collections.abc import Iterable, Mapping


def count_of(row: Mapping[str, object], key: str) -> int | float:
    """Numeric count field; missing or None means 0."""
    v = row.get(key)
    return v if isinstance(v, (int, float)) else 0


def measured_mean(values: Iterable[object]) -> float | None:
    """Mean of the non-None numeric values; None when nothing was measured."""
    vals = [float(v) for v in values if isinstance(v, (int, float))]
    return sum(vals) / len(vals) if vals else None


def mean_or(values: Iterable[object], default: float) -> float:
    """measured_mean with a fallback for the nothing-measured case."""
    m = measured_mean(values)
    return default if m is None else m
