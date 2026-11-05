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


def shape(value: Any, personal: bool = False) -> dict:
    """Blank flag, length and mask of one value. ``personal`` withholds the mask (a personal field keeps only its
    length)."""
    from api.services.fix_drafter import mask_of

    t = _text(value)
    return {"blank": not t, "length": len(t), "mask": "" if personal else mask_of(t)}


def masks_of(values: Iterable[Any]) -> list[str]:
    """Top masks of a column, for local decisions only (not for a prompt: use ``column_profile``)."""
    return [m for m, _ in Counter(shape(t)["mask"] for t in (_text(v) for v in values) if t).most_common(MAX_MASKS)]


def aggregates_only(tenant_id: str | None = None) -> bool:
    """True when the tenant set "aggregates only to the model" (``tenants.llm_config['aggregates_only']``). Reads
    the tenant from the argument, else the request context, else MERIDIAN_TENANT_ID. No tenant is False. When a known
    tenant's setting cannot be read the answer is True: a database blip must not loosen a privacy switch."""
    import os

    from sqlalchemy import text as sql

    try:
        if tenant_id is None:
            from api.middleware.tenant import get_current_tenant_id

            tenant_id = str(get_current_tenant_id() or os.getenv("MERIDIAN_TENANT_ID") or "")
        if not tenant_id:
            return False
        from workers.db import get_sync_engine

        with get_sync_engine().connect() as c:
            c.execute(sql("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
            cfg = c.execute(sql("SELECT llm_config FROM tenants WHERE id = CAST(:t AS uuid)"),
                            {"t": str(tenant_id)}).scalar()
        return bool(isinstance(cfg, dict) and cfg.get("aggregates_only"))
    except Exception:
        return bool(tenant_id)


def _kind(full: list[str]) -> str:
    if not full:
        return "empty"
    if all(is_number(_num(t)) for t in full):
        return "numeric"
    return "text"


def _num(t: str) -> Any:
    try:
        return float(t.replace(",", ""))
    except ValueError:
        return None


def column_profile(values: Iterable[Any], header: str | None = None, mapped_field: str | None = None,
                   aggregates: bool = False) -> dict:
    """Counts and shapes of a column's sample values: rows, blanks, distinct non-blank values (a count, never the
    values), length range and up to MAX_MASKS distinct masks (most common first).

    A personal column (by saved mapping, header words, or value shape) or any column when ``aggregates`` is on
    gets counts, length range and a coarse ``kind`` only: no masks, so no row-level shape reaches the model."""
    from api.utils.pii_fields import column_is_personal

    texts = [_text(v) for v in values]
    full = [t for t in texts if t]
    lens = [len(t) for t in full]
    out = {"rows": len(texts), "blank": len(texts) - len(full), "distinct": len(set(full)),
           "min_length": min(lens, default=0), "max_length": max(lens, default=0)}
    if aggregates or column_is_personal(header, full, mapped_field):
        return {**out, "masks": [], "kind": _kind(full), "masked": True}
    masks = Counter(shape(t)["mask"] for t in full)
    return {**out, "masks": [m for m, _ in masks.most_common(MAX_MASKS)]}


def is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x


def in_unit_range(x: Any) -> bool:
    return is_number(x) and 0 <= x <= 1
