"""The arithmetic behind a score receipt, shared by the explain and run-timeline endpoints.

These are the same functions the step 0 receipt (GET /objects/{module}/receipt) uses from api/routes/objects.py
(``reweigh``, ``breach_ids``, ``cap_level_of``, ``records_checked_of``, ``rule_names``), kept here so the v2 endpoints
do not depend on that branch being merged first; once both are on one branch, objects.py can import these and drop
its copies. Nothing here estimates: a value the run did not store is None.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant
from api.routes.objects import _measured_dimensions
from api.services.scoring import critical_over_tolerance

DIMENSION_ORDER = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")
OPEN_WORK = ("to_fix", "proposed", "approved", "awaiting_load", "sent")  # api/routes/work.py OPEN


def breach_ids(mod_summary: dict) -> list[str]:
    """check_ids of the failing critical rules over tolerance, from dqs_summary ``critical_breaches``
    ("MM014: 5.9% of MARA rows" -> "MM014"). [] for a summary stored before breaches were recorded."""
    out: list[str] = []
    for b in mod_summary.get("critical_breaches") or []:
        cid = str(b).split(":", 1)[0].strip()
        if cid and cid not in out:
            out.append(cid)
    return out


def cap_level_of(mod_summary: dict) -> Optional[int]:
    """The ceiling a critical failure holds the score at (85 for one rule over tolerance, 70 for two or more,
    api/services/scoring.py _cap); None when the score is not capped."""
    if not mod_summary.get("capped"):
        return None
    return 70 if critical_over_tolerance(mod_summary) >= 2 else 85


def records_checked_of(mod_summary: dict, widest_population: Optional[int] = None) -> Optional[int]:
    """Records the run checked for an object: the driving object's record count the run stored (clean_records),
    else ``widest_population`` (the largest rule population in the run's findings); None when neither exists."""
    n = (mod_summary.get("clean_records") or {}).get("records")
    if isinstance(n, (int, float)) and not isinstance(n, bool) and n > 0:
        return int(n)
    return widest_population if widest_population else None


async def rule_names(db: AsyncSession, tenant: Tenant, check_ids: list[str]) -> dict[str, str]:
    """{check_id: title} from the tenant's rules table (names are stored as "MM014: Base unit not valid")."""
    if not check_ids:
        return {}
    return {r[0]: r[1] for r in (await db.execute(text(
        "SELECT DISTINCT ON (split_part(name, ':', 1)) split_part(name, ':', 1), trim(substr(name, strpos(name, ':') + 1)) "
        "FROM rules WHERE tenant_id = :t AND split_part(name, ':', 1) = ANY(:ids) AND strpos(name, ':') > 0 "
        "ORDER BY split_part(name, ':', 1), module"
    ), {"t": str(tenant.id), "ids": check_ids})).fetchall()}


def reweigh(mod_summary: dict, configured: dict[str, float]) -> tuple[dict[str, float], Optional[float], Optional[float], bool]:
    """(share per measured dimension, weighted, measured, reproduced): the score re-weighted over the measured
    dimensions exactly as scoring._composite does (weights of the dimensions that have rules, rescaled to 1).
    The run's own stored ``weights`` win over the tenant's current ones. ``weighted`` is the one-decimal sum;
    ``measured`` equals it when the stored ``raw_score`` agrees (``reproduced``), else it is the stored
    ``raw_score`` and ``weighted`` is None -- never a made-up row."""
    dims = _measured_dimensions(mod_summary)
    raw = mod_summary.get("raw_score")
    stored = {d: w for d, w in (mod_summary.get("weights") or {}).items()
              if isinstance(w, (int, float)) and not isinstance(w, bool) and w > 0}
    base = stored if dims and all(d in stored for d in dims) else configured
    total = sum(base.get(d, 0.0) for d in dims)
    if not dims or total <= 0:
        return {}, None, raw, False
    shares = {d: base.get(d, 0.0) / total for d in dims}
    weighted = round(sum(dims[d] * shares[d] for d in dims), 1)
    if raw is not None and abs(weighted - raw) > 0.1:  # the stored summary cannot reproduce its own score
        return shares, None, raw, False
    return shares, weighted, weighted, True
