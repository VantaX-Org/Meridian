"""Duplicate search at entry: which existing master records a candidate record looks like.

Opt-in beside api/services/dq_firewall.py (whose ``validate`` stays pure). Population: the tenant's live
``master_records`` of the module (``merged_into IS NULL``; own fields when the record sits in a merge cluster).
Blocking: a candidate is looked up only by equality on normalised key fields that migration 133 indexes, so a call
never scans the population; at most ``CANDIDATE_CAP`` records are scored and a cut-short search says so. A lookup that
could not have found anything says so too, never "no duplicates": ``no_block_field_in_population`` when no record of
the population carries a block field (a flat upload keeps its own column names), and ``searched: false`` on a record
with no usable block value (blank, junk, or a value with no ASCII letters or digits). Scoring is
``merge_explain.explain_pair`` (the comparators, weights, per-field thresholds and bands of the tenant's active
``match_rules``, the same function the merge review screen scores with), so the entry gate and the match run agree.
``match_engine.score_candidate_pair`` is not called: it queries per pair, can persist, and routes ``semantic`` rules
to the language model. Here a semantic rule is skipped and counted. Deterministic, no model.

Nothing of the other record but its key, score and per-field similarity leaves this module; its values never do.
Every query filters on ``tenant_id`` and the route sets the tenant (set_config) before calling.
"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.golden_keys import plain
from api.services.merge_explain import AUTO_MERGE, REVIEW_FLOOR, explain_pair

CANDIDATE_CAP = 50   # records scored per candidate; a hit on more is cut and reported
MAX_MATCHES = 10     # matches returned per candidate record
# module -> (record key field, fields a lookup may block on). Each block field has an index in migration 133.
SUPPORTED: dict[str, tuple[str, tuple[str, ...]]] = {
    "material_master": ("MARA.MATNR", ("MARA.MFRPN", "MARA.BISMT", "MAKT.MAKTX")),
    "sd_customer_master": ("KNA1.KUNNR", ("KNA1.STCEG", "KNA1.STCD1", "KNA1.STCD2", "KNA1.NAME1")),
    "business_partner": ("BUT000.PARTNER", ("BUT000.NAME_ORG1",)),
}
BLOCK_FIELDS = sorted({f for _, fs in SUPPORTED.values() for f in fs})
_NOT_ALNUM = re.compile(r"[^0-9A-Za-z]")
_JUNK = {"", "0", "NA", "NONE", "NULL", "UNKNOWN", "TBA", "TBD", "XXX", "NIL"}


def block_expr(field: str) -> str:
    """The SQL of a block key. Same text as migration 133's indexes; ``field`` is from SUPPORTED only."""
    assert field in BLOCK_FIELDS
    return f"upper(regexp_replace(COALESCE(own_fields, golden_fields)->>'{field}', '[^0-9A-Za-z]', '', 'g'))"


def block_key(value: Any) -> str:
    """The Python side of ``block_expr``; '' when the value cannot be a duplicate signal."""
    k = _NOT_ALNUM.sub("", "" if value is None else str(value)).upper()
    return "" if k in _JUNK or len(k) < 2 else k


def _not_searched(reason: str) -> dict:
    return {"searched": False, "reason": reason, "cap": CANDIDATE_CAP,
            "thresholds": {"auto_merge": AUTO_MERGE, "review_floor": REVIEW_FLOOR}}


async def match_fields(db: AsyncSession, tid: str, module: str) -> frozenset[str]:
    """Fields a record may carry for the search beyond the firewall's rule fields: key, block and match-rule fields."""
    if module not in SUPPORTED:
        return frozenset()
    got = (await db.execute(text("SELECT DISTINCT upper(field) FROM match_rules WHERE tenant_id = CAST(:t AS uuid) "
                                 "AND domain = :d AND active = true"), {"t": tid, "d": module})).fetchall()
    return frozenset({SUPPORTED[module][0], *SUPPORTED[module][1], *(r[0] for r in got)})


async def search(db: AsyncSession, tid: str, module: str, rows: list[dict[str, str]]) -> dict[str, Any]:
    """{search: {searched, reason, cap, thresholds, ...}, records: [{searched, matches, scored, truncated}]} per row."""
    empty = [{"searched": False, "matches": [], "scored": 0, "truncated": False} for _ in rows]
    if module not in SUPPORTED:
        return {"search": _not_searched("module_not_supported"), "records": empty}
    key_field, fields = SUPPORTED[module]
    rules = [{"id": str(r[0]), "field": r[1], "match_type": r[2], "weight": r[3], "threshold": r[4]} for r in (
        await db.execute(text("SELECT id, field, match_type, weight, threshold FROM match_rules "
                              "WHERE tenant_id = CAST(:t AS uuid) AND domain = :d AND active = true "
                              "ORDER BY weight DESC, field"), {"t": tid, "d": module})).fetchall()]
    if not rules:
        return {"search": _not_searched("no_match_rules"), "records": empty}
    if not (await db.execute(text("SELECT 1 FROM master_records WHERE tenant_id = CAST(:t AS uuid) AND domain = :d "
                                  "AND merged_into IS NULL LIMIT 1"), {"t": tid, "d": module})).first():
        return {"search": _not_searched("no_population"), "records": empty}

    # Answered from the migration 133 indexes: a missing field is a NULL key, so this never reads the table.
    live = [f for f in fields if (await db.execute(text(
        f"SELECT 1 FROM master_records WHERE tenant_id = CAST(:t AS uuid) AND domain = :d AND merged_into IS NULL "
        f"AND {block_expr(f)} IS NOT NULL LIMIT 1"), {"t": tid, "d": module})).first()]
    if not live:
        return {"search": _not_searched("no_block_field_in_population"), "records": empty}

    out = []
    for row in rows:
        seen: dict[str, dict] = {}
        truncated = False
        keys = {f: k for f in live if (k := block_key(row.get(f)))}
        for f, k in keys.items():
            if truncated:
                break
            room = CANDIDATE_CAP - len(seen)
            got = (await db.execute(text(
                f"SELECT sap_object_key, COALESCE(own_fields, golden_fields) FROM master_records "
                f"WHERE tenant_id = CAST(:t AS uuid) AND domain = :d AND merged_into IS NULL AND {block_expr(f)} = :k "
                f"LIMIT :n"), {"t": tid, "d": module, "k": k, "n": room + 1})).fetchall()
            for key, rec in got[:room]:
                seen.setdefault(key, rec or {})
            truncated = len(got) > room
        own = row.get(key_field)
        matches = []
        for key, rec in seen.items():
            if own and plain(key) == own:
                # The record being saved is not its own duplicate. A candidate names no system, so a record of the
                # same number in another connected system is passed over with it.
                continue
            ex = explain_pair(rules, row, rec, auto_merge=AUTO_MERGE, review_floor=REVIEW_FLOOR)
            if ex["total"] < REVIEW_FLOOR:
                continue
            scored = [a for a in ex["attributes"] if not a.get("skipped")]
            matches.append({
                "key": key, "score": ex["total"], "band": ex["band"], "threshold": AUTO_MERGE,
                "fields": [{"field": a["field"], "comparator": a["comparator"], "similarity": a["similarity"],
                            "weight": a["weight"], "threshold": a["threshold"], "met": bool(a["threshold_met"])}
                           for a in scored]})
        matches.sort(key=lambda m: (-m["score"], m["key"]))
        out.append({"searched": bool(keys), "matches": matches[:MAX_MATCHES], "scored": len(seen), "truncated": truncated})
    return {"search": {"searched": True, "reason": None, "cap": CANDIDATE_CAP,
                       "thresholds": {"auto_merge": AUTO_MERGE, "review_floor": REVIEW_FLOOR},
                       "rules": len(rules), "skipped_semantic": sum(r["match_type"] == "semantic" for r in rules)},
            "records": out}
