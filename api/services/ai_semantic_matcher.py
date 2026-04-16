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

from api.utils.pii_fields import sanitise_for_prompt
from api.utils.llm_logger import log_llm_call

logger = logging.getLogger("meridian.ai_semantic_matcher")

_CACHE_TTL = 7 * 24 * 60 * 60  # 7 days in seconds
_MAX_BATCH_SIZE = 50


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


def _build_prompt(field: str, domain: str, value_a_sanitised: str, value_b_sanitised: str) -> str:
    """Build a semantic similarity prompt — never includes raw PII."""
    return f"""You are an SAP master data matching expert.

Domain: {domain}
Field: {field}

Compare these two field values for semantic similarity in the context of SAP {domain} data:
  Value A: {value_a_sanitised}
  Value B: {value_b_sanitised}

Consider:
1. Whether they refer to the same real-world entity or concept
2. Common SAP abbreviations and variations
3. Spelling differences, transliterations, and formatting differences
4. Domain-specific equivalences in {domain}

Respond in JSON format only:
{{"similarity": <0.0-1.0>, "reasoning": "<brief explanation>"}}"""


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
    # Sanitise values — PII fields get redacted
    sanitised_a = sanitise_for_prompt(field, value_a)
    sanitised_b = sanitise_for_prompt(field, value_b)

    # If both values are redacted, we can't compute semantic similarity
    if sanitised_a == "[REDACTED]" and sanitised_b == "[REDACTED]":
        return None

    # Check Redis cache first
    cache_key = _cache_key(tenant_id, domain, str(value_a), str(value_b))
    try:
        r = _get_redis()
        cached = r.get(cache_key)
        if cached is not None:
            return float(cached)
    except Exception as e:
        logger.warning(f"Redis cache read failed: {e}")

    # Build prompt and call LLM
    prompt = _build_prompt(field, domain, sanitised_a, sanitised_b)
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm

        llm = get_llm().bind(max_tokens=400)
        response = llm.invoke(prompt)
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response.content if hasattr(response, "content") else str(response)

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
        similarity = float(result.get("similarity", 0.0))
        similarity = max(0.0, min(1.0, similarity))  # Clamp to 0-1

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
