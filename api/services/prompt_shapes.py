"""Shape-only facts for LLM prompts (Aletheia rule): the model never sees a SAP value, a preview or a hash of one.

``shape`` is the aggregate view of one value (blank flag, length, mask); ``column_profile`` is the same for a column
of sample values. The mask alphabet is fixed (A upper, a lower, 9 digit, ~ space, a few punctuation marks, ? other),
so a mask cannot carry a letter or digit of the data. Same mask logic as ``ai_survivorship.facts``
(``fix_drafter.mask_of``).
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

MAX_MASKS = 3


def _text(v: Any) -> str:
    return "" if v is None else str(v).strip()


def shape(value: Any) -> dict:
    from api.services.fix_drafter import mask_of

    t = _text(value)
    return {"blank": not t, "length": len(t), "mask": mask_of(t)}


def column_profile(values: Iterable[Any]) -> dict:
    """Counts and shapes of a column's sample values: rows, blanks, distinct non-blank values (a count, never the
    values), length range and up to MAX_MASKS distinct masks (most common first)."""
    texts = [_text(v) for v in values]
    full = [t for t in texts if t]
    masks = Counter(shape(t)["mask"] for t in full)
    lens = [len(t) for t in full]
    return {"rows": len(texts), "blank": len(texts) - len(full), "distinct": len(set(full)),
            "min_length": min(lens, default=0), "max_length": max(lens, default=0),
            "masks": [m for m, _ in masks.most_common(MAX_MASKS)]}


def is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x


def in_unit_range(x: Any) -> bool:
    return is_number(x) and 0 <= x <= 1
