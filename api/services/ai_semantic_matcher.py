"""AI semantic matcher — embedding-based similarity scoring for match engine.

Third scorer inside match_engine.py for fields with match_type = semantic.
Generates LLM-based semantic similarity scores for candidate field values.
Scores are cached in Redis with tenant-scoped keys to avoid redundant LLM calls.

Token limit: 400 per call
Batch size: max 50 candidate pairs per Celery call
Returns: float (cosine similarity 0.0-1.0) or None on error
"""

import hashlib
import json
import logging
import os
import time
from typing import Optional

import redis

from api.services.prompt_shapes import in_unit_range, shape
from api.utils.llm_logger import log_llm_call
from sap.deterministic import (
    FieldType,
    SimilarityBand,
    classify_band,
    classify_field,
    deterministic_similarity,
)

logger = logging.getLogger("meridian.ai_semantic_matcher")

_CACHE_TTL = 7 * 24 * 60 * 60  # 7 days in seconds
_MAX_BATCH_SIZE = 50


def _llm_mode() -> str:
    """Return 'on' (default), 'uncertain_only', or 'off'.

    Controlled by MERIDIAN_SEMANTIC_MATCHER_LLM. At bulk scale (400k records)
    setting this to 'off' makes the matcher fully deterministic — the
    uncertain band returns the deterministic score as-is.
    """
    val = os.getenv("MERIDIAN_SEMANTIC_MATCHER_LLM", "uncertain_only").strip().lower()
    if val in ("off", "false", "0", "no"):
        return "off"
    if val in ("on", "always", "true", "1"):
        return "on"
    return "uncertain_only"


def _get_redis() -> redis.Redis:
    """Get a sync Redis client for embedding cache."""
    return redis.Redis.from_url(
        os.getenv("REDIS_URL", "redis://redis:6379/0"),
        decode_responses=True,
    )


def _cache_key(tenant_id: str, domain: str, value_a: str, value_b: str) -> str:
    """Build a deterministic cache key for a value pair."""
    pair_hash = hashlib.sha256(f"{value_a}|{value_b}".encode()).hexdigest()
    return f"{tenant_id}:emb:{domain}:{pair_hash}"


def facts(field: str, value_a: str, value_b: str, det_score: float, field_type: object) -> dict:
    """The only thing the model sees about a pair: field metadata, each value's shape (blank, length, mask) and the
    deterministic score. Never a value, a preview or a hash of one. ponytail: shapes are weaker evidence than values,
    so the model only acts in the uncertain band and its answer is proved by ``verify``."""
    return {"field": field, "field_type": getattr(field_type, "name", str(field_type)),
            "a": shape(value_a), "b": shape(value_b),
            "deterministic_score": round(det_score, 3)}


def _build_prompt(domain: str, f: dict) -> str:
    """Semantic similarity prompt from ``facts`` only."""
    return f"""You are an SAP master data matching expert.

Domain: {domain}
Field: {f['field']} (type {f['field_type']})

Two values were compared. You see only each value's shape (A upper, a lower, 9 digit, ~ space), never the value:
  Value A: length {f['a']['length']}, shape {f['a']['mask']}
  Value B: length {f['b']['length']}, shape {f['b']['mask']}
  Deterministic similarity: {f['deterministic_score']}

Estimate how likely the two values refer to the same real-world {domain} entity.

Respond in JSON format only:
{{"similarity": <0.0-1.0>}}"""


def verify(rec: object, det_score: float) -> dict:
    """Prove a model answer before its score is used. Deterministic.

    SIMILARITY_IS_NUMBER   the answer holds a numeric similarity
    SIMILARITY_IN_RANGE    it is from 0 to 1 (rejected, not clamped)
    A failed answer falls back to the deterministic score. Free-text reasoning is never kept."""
    sim = rec.get("similarity") if isinstance(rec, dict) else None
    numeric = isinstance(sim, (int, float)) and not isinstance(sim, bool)
    checks = [{"code": "SIMILARITY_IS_NUMBER", "passed": numeric},
              {"code": "SIMILARITY_IN_RANGE", "passed": in_unit_range(sim)}]
    ok = all(c["passed"] for c in checks)
    return {"verified": ok, "checks": checks, "similarity": float(sim) if ok else det_score}


def compute_semantic_score(
    tenant_id: str,
    domain: str,
    field: str,
    value_a: str,
    value_b: str,
) -> Optional[float]:
    """Compute semantic similarity between two field values using the LLM.

    Args:
        tenant_id: Tenant UUID string
        domain: SAP domain (e.g. 'business_partner')
        field: The field being compared
        value_a: First candidate value
        value_b: Second candidate value

    Returns:
        Float 0.0-1.0 similarity score, or None on error
    """
    # Null/empty short-circuit
    if value_a is None or value_b is None or value_a == "" or value_b == "":
        return 0.0

    # ── Deterministic fast path (SAP-aware, no LLM) ─────────────────────────
    # At 400k records this is the primary path — only the uncertain band
    # (NO_MATCH_THRESHOLD < score < MATCH_THRESHOLD) can fall through to an
    # LLM call, and only if the operator has opted in.
    field_type = classify_field(field, sample_value=value_a)
    det_score = deterministic_similarity(field, value_a, value_b, field_type=field_type)
    band = classify_band(det_score)
    mode = _llm_mode()

    # Closed-domain codes never benefit from an LLM — exact canonical or zero.
    is_closed_domain = field_type in (
        FieldType.COUNTRY, FieldType.CURRENCY, FieldType.UOM,
        FieldType.EMAIL, FieldType.PHONE, FieldType.POSTAL_CODE,
        FieldType.PRIMARY_KEY, FieldType.FOREIGN_KEY, FieldType.CODE,
        FieldType.FLAG, FieldType.LANGUAGE,
    )

    if band in (SimilarityBand.MATCH, SimilarityBand.NO_MATCH):
        return det_score
    if mode == "off" or is_closed_domain:
        return det_score

    # ── Cache lookup (LLM path only) ─────────────────────────────
    cache_key = _cache_key(tenant_id, domain, str(value_a), str(value_b))
    try:
        r = _get_redis()
        cached = r.get(cache_key)
        if cached is not None:
            return float(cached)
    except Exception as e:
        logger.warning(f"Redis cache read failed: {e}")

    # Build prompt and call LLM (uncertain band only)
    prompt = _build_prompt(domain, facts(field, value_a, value_b, det_score, field_type))
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm, safe_invoke

        llm = get_llm().bind(max_tokens=400)
        response = safe_invoke(llm, prompt, timeout_seconds=30)
        if response is None:
            logger.warning(f"Semantic matcher LLM timeout for {field}")
            return 0.0  # Conservative: no match on timeout
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response if isinstance(response, str) else (
            response.content if hasattr(response, "content") else str(response)
        )

        # Log the call (prompt content is hashed, never stored)
        token_count = getattr(response, "usage_metadata", {})
        total_tokens = 0
        if isinstance(token_count, dict):
            total_tokens = token_count.get("total_tokens", 0)

        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_semantic_matcher",
            prompt=prompt,
            model_version=getattr(llm, "model", "unknown"),
            token_count=total_tokens,
            latency_ms=elapsed_ms,
            success=True,
        )

        # Parse JSON response — strip markdown code fences if present
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        result = json.loads(cleaned)
        proof = verify(result, det_score)
        if not proof["verified"]:
            logger.warning("Semantic matcher answer failed %s for %s",
                           [c["code"] for c in proof["checks"] if not c["passed"]], field)
            return det_score
        similarity = proof["similarity"]

        # Cache the result
        try:
            r = _get_redis()
            r.setex(cache_key, _CACHE_TTL, str(similarity))
        except Exception as e:
            logger.warning(f"Redis cache write failed: {e}")

        return similarity

    except Exception as e:
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)
        logger.warning(f"AI semantic matching failed for field '{field}': {e}")

        try:
            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_semantic_matcher",
                prompt=prompt,
                model_version="unknown",
                token_count=0,
                latency_ms=elapsed_ms,
                success=False,
            )
        except Exception:
            pass

        return None


def compute_semantic_scores_batch(
    tenant_id: str,
    domain: str,
    pairs: list[tuple[str, str, str]],
) -> list[Optional[float]]:
    """Compute semantic similarity for a batch of field value pairs.

    Args:
        tenant_id: Tenant UUID string
        domain: SAP domain
        pairs: List of (field, value_a, value_b) tuples. Max 50 pairs.

    Returns:
        List of similarity scores (float or None) in same order as input pairs
    """
    if len(pairs) > _MAX_BATCH_SIZE:
        pairs = pairs[:_MAX_BATCH_SIZE]
        logger.warning(f"Batch size truncated to {_MAX_BATCH_SIZE} pairs")

    results: list[Optional[float]] = []
    for field, value_a, value_b in pairs:
        score = compute_semantic_score(tenant_id, domain, field, value_a, value_b)
        results.append(score)

    return results
