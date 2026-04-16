"""AI glossary enricher — rewrites technical SAP field metadata into business language.

Two call modes:
  - batch: called by seed script with skip_rate_limit=True
  - single: called by POST /glossary/{id}/ai-draft, rate-limited per tenant
"""

import json
import logging
import re
import time

import redis

from api.config import settings
from api.utils.llm_logger import log_llm_call
from llm.provider import get_llm

logger = logging.getLogger("meridian.ai_glossary_enricher")

RATE_LIMIT_KEY = "glossary_enrich:{tenant_id}:count"
RATE_LIMIT_MAX = 20  # calls per hour per tenant
TOKEN_LIMIT = 1200


class RateLimitExceeded(Exception):
    pass


class LLMError(Exception):
    pass


def _get_redis() -> redis.Redis:
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def check_rate_limit(tenant_id: str, redis_client: redis.Redis) -> bool:
    """Returns True if call is allowed, False if rate limit exceeded."""
    key = RATE_LIMIT_KEY.format(tenant_id=tenant_id)
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, 3600)
    return count <= RATE_LIMIT_MAX


def enrich_term(
    tenant_id: str,
    technical_name: str,
    sap_table: str,
    sap_field: str,
    why_it_matters: str,
    sap_impact: str,
    redis_client: redis.Redis | None = None,
    skip_rate_limit: bool = False,
) -> dict:
    """Enrich a single glossary term with AI-drafted business language.

    Returns: {business_definition: str, why_it_matters_business: str}
    Raises: RateLimitExceeded if on-demand limit hit
    Raises: LLMError if provider call fails
    """
    if not skip_rate_limit:
        rc = redis_client or _get_redis()
        if not check_rate_limit(tenant_id, rc):
            raise RateLimitExceeded(f"Rate limit: {RATE_LIMIT_MAX} calls/hour/tenant")

    llm = get_llm()
    prompt_str = (
        "You are an SAP data governance expert. Rewrite the following technical SAP field "
        "documentation into plain business language for non-technical data stewards.\n\n"
        f"SAP Table: {sap_table}  |  Field: {sap_field}  |  Full name: {technical_name}\n"
        f"Technical description: {why_it_matters}\n"
        f"SAP impact: {sap_impact}\n\n"
        "Respond in JSON only with two keys:\n"
        '  "business_definition" (1-2 sentences for a business user)\n'
        '  "why_it_matters_business" (1 sentence explaining business impact).\n'
        "No preamble, no markdown, JSON only."
    )

    t_start = time.time()
    success = False
    model_version = "unknown"
    try:
        response = llm.invoke(prompt_str, max_tokens=TOKEN_LIMIT)
        latency = int((time.time() - t_start) * 1000)
        model_version = getattr(llm, "model", "unknown")
        success = True

        # Parse response — strip any accidental markdown fences
        text_content = response.content if hasattr(response, "content") else str(response)
        clean = re.sub(r"```json|```", "", text_content).strip()
        result = json.loads(clean)

        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_glossary_enricher",
            prompt=prompt_str,
            model_version=model_version,
            token_count=TOKEN_LIMIT,
            latency_ms=latency,
            success=True,
        )

        return result

    except json.JSONDecodeError as e:
        latency = int((time.time() - t_start) * 1000)
        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_glossary_enricher",
            prompt=prompt_str,
            model_version=model_version,
            token_count=TOKEN_LIMIT,
            latency_ms=latency,
            success=False,
        )
        raise LLMError(f"Failed to parse LLM JSON response: {e}") from e

    except Exception as e:
        latency = int((time.time() - t_start) * 1000)
        if not success:
            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_glossary_enricher",
                prompt=prompt_str,
                model_version=model_version,
                token_count=TOKEN_LIMIT,
                latency_ms=latency,
                success=False,
            )
        raise LLMError(f"LLM call failed: {e}") from e
