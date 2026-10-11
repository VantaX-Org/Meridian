"""Mining filters (spec §3.1). Every filter tests the case's first event, except ``automated``."""

from __future__ import annotations

import hashlib
import re
from datetime import date
from typing import Callable, Mapping, Optional

from pydantic import BaseModel, field_validator

_ORG_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,15}$")


class ProcessFilter(BaseModel):
    period_from: Optional[date] = None
    period_to: Optional[date] = None
    org: dict[str, list[str]] = {}
    doc_type: list[str] = []
    case_type: Optional[str] = None  # None = primary case type of the L1
    automated: Optional[bool] = None

    @field_validator("org")
    @classmethod
    def _org_keys(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        bad = [k for k in v if not _ORG_KEY.match(k)]
        if bad:
            raise ValueError(f"invalid org key: {bad[0]}")
        return {k: sorted(set(vals)) for k, vals in sorted(v.items()) if vals}

    @classmethod
    def from_query(cls, params: Mapping[str, object]) -> "ProcessFilter":
        """Parse ``?from=&to=&org.BUKRS=&doc_type=&case_type=&automated=``.

        ``params`` is a ``MultiDict`` (Starlette ``request.query_params``) or a plain dict of lists;
        repeated keys and comma-separated values both give lists."""
        def values(key: str) -> list[str]:
            getlist = getattr(params, "getlist", None)
            got = getlist(key) if getlist is not None else params.get(key, [])
            raw: list[object] = [got] if isinstance(got, str) else list(got)  # type: ignore[call-overload]
            return [p for v in raw for p in str(v).split(",") if p]

        auto = values("automated")
        first: Callable[[str], Optional[str]] = lambda k: next(iter(values(k)), None)  # noqa: E731
        return cls(
            period_from=first("from"),  # type: ignore[arg-type]  # pydantic parses the ISO date
            period_to=first("to"),  # type: ignore[arg-type]
            org={k[4:]: values(k) for k in params.keys() if k.startswith("org.")},
            doc_type=values("doc_type"),
            case_type=first("case_type"),
            automated=None if not auto else auto[0].lower() in ("1", "true", "yes"),
        )

    def digest(self) -> str:
        """sha1 of the canonical JSON; the Redis DFG cache key part (spec §3.7)."""
        return hashlib.sha1(self.model_dump_json().encode()).hexdigest()


def case_filter_sql(flt: ProcessFilter, tz: str) -> tuple[str, dict[str, object]]:
    """``HAVING`` body over one case's events, and its bind params.

    The first event is ``(array_agg(x ORDER BY ts, seq, id))[1]``, the same order every mining query uses.
    ``tz`` turns the first event's instant into the SAP-local date the period compares against."""
    conds: list[str] = []
    p: dict[str, object] = {"f_tz": tz}
    if flt.period_from:
        conds.append("(min(ts) AT TIME ZONE :f_tz)::date >= :f_from")
        p["f_from"] = flt.period_from
    if flt.period_to:
        conds.append("(min(ts) AT TIME ZONE :f_tz)::date <= :f_to")
        p["f_to"] = flt.period_to
    for i, (key, vals) in enumerate(flt.org.items()):
        conds.append(f"(array_agg(org ->> :f_ok{i} ORDER BY ts, seq, id))[1] = ANY(:f_ov{i})")
        p[f"f_ok{i}"], p[f"f_ov{i}"] = key, list(vals)
    if flt.doc_type:
        conds.append("(array_agg(doc_type ORDER BY ts, seq, id))[1] = ANY(:f_dt)")
        p["f_dt"] = list(flt.doc_type)
    if flt.automated is True:
        conds.append("bool_or(automated) IS TRUE")
    elif flt.automated is False:
        conds.append("NOT coalesce(bool_or(automated), false)")
    return (" AND ".join(conds) or "TRUE"), p
