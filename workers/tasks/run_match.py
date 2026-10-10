"""Match pipeline: block, compare and score near-duplicate master records.

Fanned out from run_checks next to run_dedup, once per analysed module. Candidate
pairs come from the similarity check's own blocking and name comparison
(checks.types.similarity_check.blocks / near_pairs). Each pair is scored by
match_engine.score_candidate_pair, which upserts match_scores and queues the review
band; populate_queue then turns queued pairs into steward merge decisions. Pairs a
steward marked do_not_match are never scored. Records that cannot be blocked or sit
in an oversized block are reported in the result, never counted as distinct.
Cross-system matching is not done here: one run matches one analysed frame.
"""

import logging
from collections.abc import Hashable
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from checks.types.similarity_check import blocks, near_pairs
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.run_match")

# module: (id column, name column, block-by columns)
MATCH_KEYS: dict[str, tuple[str, str, list[str]]] = {
    "business_partner": ("BUT000.PARTNER", "BUT000.NAME_ORG1", ["ADRC.COUNTRY", "ADRC.POST_CODE1"]),
    "material_master": ("MARA.MATNR", "MAKT.MAKTX", ["MARA.MATKL", "MARA.MTART"]),
}
CANDIDATE_THRESHOLD = 0.8  # looser than the similarity rules' 0.9: the match engine sets the band
MAX_BLOCK = 300
# Seeded only for a domain with no match_rules at all: (field, match_type, weight, threshold).
DEFAULT_RULES: dict[str, list[tuple[str, str, int, float]]] = {
    "business_partner": [("BUT000.NAME_ORG1", "name_legal", 60, 0.85),
                         ("ADRC.STREET", "address_tokens", 25, 0.7),
                         ("ADRC.CITY1", "exact", 15, 1.0)],
    "material_master": [("MAKT.MAKTX", "fuzzy", 70, 0.85),
                        ("MARA.MEINS", "exact", 15, 1.0),
                        ("MARA.MFRPN", "exact", 15, 1.0)],
}

_SEED_RULES = text("""
    INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold, active)
    SELECT gen_random_uuid(), CAST(:tid AS uuid), :d, u.f, u.m, u.w, u.t, true
    FROM unnest(CAST(:f AS text[]), CAST(:m AS text[]), CAST(:w AS int[]), CAST(:t AS float8[])) AS u(f, m, w, t)
    WHERE NOT EXISTS (SELECT 1 FROM match_rules WHERE tenant_id = CAST(:tid AS uuid) AND domain = :d)
""")
_DO_NOT_MATCH = text("""
    SELECT key_lo, key_hi FROM mdm_pair_constraints
    WHERE tenant_id = CAST(:tid AS uuid) AND domain = :d AND kind = 'do_not_match'
""")


def candidate_pairs(df: pd.DataFrame,
                    module: str) -> tuple[list[tuple[Hashable, Hashable, float]], dict[str, int]]:
    """Index pairs whose names are near inside a block, plus what could not be compared."""
    _, name_col, block_by = MATCH_KEYS[module]
    kept, oversized = blocks(df, name_col, block_by, MAX_BLOCK)
    compared = sum(len(g) for g in kept)
    not_compared = sum(len(g) for g in oversized)
    return near_pairs(df, name_col, kept, CANDIDATE_THRESHOLD), {
        "compared": compared,
        "blocks_skipped_too_large": len(oversized),
        "records_not_compared": not_compared,
        "records_not_blocked": len(df) - compared - not_compared,
    }


def _record(row: pd.Series) -> dict:
    """Row as plain Python values for scoring (NaN to None, numpy scalars to Python)."""
    return {k: None if pd.isna(v) else (v.item() if hasattr(v, "item") else v) for k, v in row.items()}


def match_frame(df: pd.DataFrame, module: str, tenant_id: str, session: Optional[Session]) -> dict:
    """Score one module's candidate pairs into match_scores. ``session`` may be None only
    when the module is skipped (no DB work happens before the column checks)."""
    from api.services.match_engine import score_candidate_pair
    from api.services.merge_explain import drop_blocked_pairs

    if module not in MATCH_KEYS:
        return {"status": "skipped", "reason": f"no match keys for {module}"}
    id_col, name_col, block_by = MATCH_KEYS[module]
    missing = [c for c in (id_col, name_col, *block_by) if c not in df.columns]
    if missing:
        return {"status": "skipped", "reason": f"missing columns: {', '.join(missing)}"}
    assert session is not None

    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    # ponytail: two first runs at once can both seed; duplicate rules only double-weight
    # equally. Add a unique (tenant_id, domain, field) key if that ever happens.
    f, m, w, t = (list(x) for x in zip(*DEFAULT_RULES[module]))
    session.execute(_SEED_RULES, {"tid": tenant_id, "d": module, "f": f, "m": m, "w": w, "t": t})
    blocked = {(r.key_lo, r.key_hi) for r in session.execute(_DO_NOT_MATCH, {"tid": tenant_id, "d": module})}
    session.commit()

    pairs, stats = candidate_pairs(df, module)
    candidates = []
    for a, b, _ in pairs:
        ida, idb = str(df.at[a, id_col]), str(df.at[b, id_col])
        if ida != idb:  # identical keys are cleaning_engine's exact_pk duplicates
            candidates.append({"category": "dedup", "record_key": f"{ida}|{idb}", "a": a, "b": b})
    to_score = drop_blocked_pairs(candidates, blocked)

    queued = 0
    for c in to_score:
        ida, _, idb = c["record_key"].partition("|")
        res = score_candidate_pair(tenant_id, module, _record(df.loc[c["a"]]), _record(df.loc[c["b"]]),
                                   ida, idb, session, dry_run=False)
        queued += res["auto_action"] == "queued"
    return {"status": "complete", **stats, "candidates": len(candidates),
            "blocked": len(candidates) - len(to_score), "scored": len(to_score), "queued": queued}


@celery_app.task(bind=True, name="workers.tasks.run_match.run_match",
                 soft_time_limit=1800, time_limit=2100)
def run_match(self, version_id: str, tenant_id: str, module: str, parquet_path: str) -> dict:
    """Score one analysed module's near-duplicate pairs and refresh the steward queue."""
    from workers.dataset import load_module_frame
    from workers.tasks.populate_stewardship_queue import populate_queue

    if module not in MATCH_KEYS:
        return {"version_id": version_id, "module": module, "status": "skipped"}
    df = load_module_frame(parquet_path, module)
    with Session(get_sync_engine()) as session:
        result = match_frame(df, module, tenant_id, session)
    logger.info("run_match version_id=%s module=%s result=%s", version_id, module, result)
    if result.get("queued"):
        populate_queue.delay()
    return {"version_id": version_id, "module": module, **result}
