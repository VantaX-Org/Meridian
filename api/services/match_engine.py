"""Weighted match scoring engine — scores candidate record pairs.

For each candidate pair, applies each active match_rule for the domain:
  - exact: equality check
  - fuzzy: Levenshtein distance normalised by string length
  - phonetic: Soundex/Metaphone comparison
  - numeric_range: within tolerance
  - semantic: delegates to ai_semantic_matcher.py

Sums weighted scores to total_score. Routes:
  - 95+ → auto-merge
  - below 30 → auto-dismiss
  - 30-95 → route to stewardship_queue as merge_decision items
"""

import logging
import uuid
from typing import Optional

import jellyfish
from sqlalchemy import text
from sqlalchemy.orm import Session
from thefuzz import fuzz

from api.services.ai_semantic_matcher import compute_semantic_score

logger = logging.getLogger("meridian.match_engine")


# ── Scorers ──────────────────────────────────────────────────────────────────


def _exact_scorer(a: str, b: str) -> float:
    """Return 1.0 if values are equal (case-insensitive, trimmed), else 0.0."""
    return 1.0 if str(a).strip().lower() == str(b).strip().lower() else 0.0


def _fuzzy_scorer(a: str, b: str) -> float:
    """Return normalised Levenshtein similarity 0.0-1.0."""
    return fuzz.ratio(str(a), str(b)) / 100.0


def _phonetic_scorer(a: str, b: str) -> float:
    """Return phonetic similarity using Soundex and Metaphone.

    1.0 if both Soundex and Metaphone match, 0.5 if one matches, 0.0 if neither.
    """
    str_a, str_b = str(a).strip(), str(b).strip()
    if not str_a or not str_b:
        return 0.0

    try:
        soundex_match = jellyfish.soundex(str_a) == jellyfish.soundex(str_b)
    except Exception:
        soundex_match = False

    try:
        metaphone_match = jellyfish.metaphone(str_a) == jellyfish.metaphone(str_b)
    except Exception:
        metaphone_match = False

    if soundex_match and metaphone_match:
        return 1.0
    if soundex_match or metaphone_match:
        return 0.5
    return 0.0


def _numeric_range_scorer(a: str, b: str) -> float:
    """Return numeric proximity 0.0-1.0. Returns 0.0 on parse failure."""
    try:
        fa, fb = float(a), float(b)
    except (ValueError, TypeError):
        return 0.0

    denominator = max(abs(fa), abs(fb), 1.0)
    score = 1.0 - abs(fa - fb) / denominator
    return max(0.0, min(1.0, score))


# ── Scorer dispatch ──────────────────────────────────────────────────────────

SCORERS = {
    "exact": _exact_scorer,
    "fuzzy": _fuzzy_scorer,
    "phonetic": _phonetic_scorer,
    "numeric_range": _numeric_range_scorer,
}


# ── Main scoring function ────────────────────────────────────────────────────


def score_candidate_pair(
    tenant_id: str,
    domain: str,
    candidate_a: dict,
    candidate_b: dict,
    candidate_a_key: str,
    candidate_b_key: str,
    session: Session,
    dry_run: bool = False,
) -> dict:
    """Score a candidate pair using all active match rules for the domain.

    Args:
        tenant_id: Tenant UUID string
        domain: SAP domain (e.g. 'business_partner')
        candidate_a: Dict of field → value for first candidate
        candidate_b: Dict of field → value for second candidate
        candidate_a_key: Unique key for candidate A
        candidate_b_key: Unique key for candidate B
        session: Sync SQLAlchemy session (RLS will be set)
        dry_run: If True, compute scores but don't write to DB

    Returns:
        Dict with total_score, field_scores, auto_action, ai_semantic_score
    """
    # Set RLS context
    session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

    # Load active match rules for this domain
    rows = session.execute(
        text(
            "SELECT id, field, match_type, weight, threshold "
            "FROM match_rules "
            "WHERE tenant_id = :tid AND domain = :domain AND active = true "
            "ORDER BY weight DESC"
        ),
        {"tid": tenant_id, "domain": domain},
    ).fetchall()

    if not rows:
        return {
            "total_score": 0.0,
            "field_scores": {},
            "auto_action": "dismissed",
            "ai_semantic_score": None,
        }

    field_scores: dict = {}
    weighted_sum = 0.0
    weight_total = 0
    ai_semantic_score: Optional[float] = None

    for rule_id, field, match_type, weight, threshold in rows:
        value_a = candidate_a.get(field)
        value_b = candidate_b.get(field)

        # Skip if either value is missing
        if value_a is None or value_b is None:
            field_scores[field] = {
                "match_type": match_type,
                "score": 0.0,
                "weight": weight,
                "skipped": True,
            }
            continue

        # Compute score based on match type
        score: float = 0.0

        if match_type == "semantic":
            semantic_result = compute_semantic_score(
                tenant_id, domain, field, str(value_a), str(value_b)
            )
            if semantic_result is not None:
                score = semantic_result
                ai_semantic_score = semantic_result
            else:
                # Semantic scoring failed — skip this rule
                field_scores[field] = {
                    "match_type": match_type,
                    "score": 0.0,
                    "weight": weight,
                    "skipped": True,
                    "reason": "semantic_scoring_failed",
                }
                continue
        else:
            scorer = SCORERS.get(match_type)
            if scorer is None:
                logger.warning(f"Unknown match_type '{match_type}' for rule {rule_id}")
                continue
            score = scorer(str(value_a), str(value_b))

        field_scores[field] = {
            "match_type": match_type,
            "score": score,
            "weight": weight,
        }

        weighted_sum += score * weight
        weight_total += weight

    # Compute total weighted score
    total_score = weighted_sum / weight_total if weight_total > 0 else 0.0

    # Determine auto action
    if total_score >= 0.95:
        auto_action = "merged"
    elif total_score < 0.30:
        auto_action = "dismissed"
    else:
        auto_action = "queued"

    result = {
        "total_score": round(total_score, 4),
        "field_scores": field_scores,
        "auto_action": auto_action,
        "ai_semantic_score": round(ai_semantic_score, 4) if ai_semantic_score is not None else None,
    }

    if not dry_run:
        _persist_score(
            session, tenant_id, domain,
            candidate_a_key, candidate_b_key,
            total_score, field_scores, ai_semantic_score, auto_action,
        )

    return result


def _persist_score(
    session: Session,
    tenant_id: str,
    domain: str,
    candidate_a_key: str,
    candidate_b_key: str,
    total_score: float,
    field_scores: dict,
    ai_semantic_score: Optional[float],
    auto_action: str,
) -> None:
    """Write match_scores row and optionally a cleaning_queue entry for review."""
    import json

    score_id = str(uuid.uuid4())

    session.execute(
        text(
            "INSERT INTO match_scores "
            "(id, tenant_id, candidate_a_key, candidate_b_key, domain, "
            " total_score, field_scores, ai_semantic_score, auto_action) "
            "VALUES (:id, :tid, :a_key, :b_key, :domain, "
            " :total, :fs::jsonb, :ai_score, :action)"
        ),
        {
            "id": score_id,
            "tid": tenant_id,
            "a_key": candidate_a_key,
            "b_key": candidate_b_key,
            "domain": domain,
            "total": total_score,
            "fs": json.dumps(field_scores),
            "ai_score": ai_semantic_score,
            "action": auto_action,
        },
    )

    # Route queued items to stewardship via cleaning_queue
    if auto_action == "queued":
        queue_id = str(uuid.uuid4())
        session.execute(
            text(
                "INSERT INTO cleaning_queue "
                "(id, tenant_id, object_type, record_key, status, confidence, priority) "
                "VALUES (:id, :tid, :obj_type, :record_key, 'detected', :conf, 2)"
            ),
            {
                "id": queue_id,
                "tid": tenant_id,
                "obj_type": domain,
                "record_key": f"{candidate_a_key}|{candidate_b_key}",
                "conf": total_score,
            },
        )

    session.commit()
