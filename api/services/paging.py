"""One paging and sorting contract for list endpoints: ``limit``, ``offset``, ``sort`` (``-field`` is descending)
and a ``total`` that counts the whole filtered set. ``next_offset`` is the offset of the next page, or None on the
last. Sort fields are whitelisted per endpoint, never taken from the caller as SQL."""
from typing import Any, Optional

from fastapi import HTTPException

MAX_LIMIT = 1000


def order_by(sort: Optional[str], allowed: dict[str, str], default: str) -> str:
    """SQL ``ORDER BY`` body for ``sort`` (``name`` or ``-name``) over ``allowed`` {name: column expression}.
    422 for a name that is not allowed. A stable tiebreak is the caller's to append."""
    s = sort or default
    desc = s.startswith("-")
    col = allowed.get(s.lstrip("-"))
    if col is None:
        raise HTTPException(status_code=422, detail=f"Cannot sort by {s.lstrip('-')}. Use one of: {', '.join(sorted(allowed))}.")
    return f"{col} {'DESC' if desc else 'ASC'}"


def sort_items(items: list[dict], sort: Optional[str], allowed: tuple[str, ...], default: str) -> list[dict]:
    """The same contract for lists built in Python. None sorts last in either direction."""
    s = sort or default
    key = s.lstrip("-")
    if key not in allowed:
        raise HTTPException(status_code=422, detail=f"Cannot sort by {key}. Use one of: {', '.join(sorted(allowed))}.")
    have = [i for i in items if i.get(key) is not None]
    return sorted(have, key=lambda i: (i[key], str(i.get("module", ""))), reverse=s.startswith("-")) + \
        [i for i in items if i.get(key) is None]


def page_meta(total: int, limit: int, offset: int) -> dict[str, Any]:
    return {"total": total, "limit": limit, "offset": offset,
            "next_offset": offset + limit if offset + limit < total else None}
