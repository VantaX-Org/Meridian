"""AI survivorship service — proposes field winners when deterministic rules cannot.

Called by: golden_record_engine.py for fields with no deterministic survivorship rule winner.
Prompt construction: field names + source system metadata + value hashes ONLY.
The LLM never sees raw SAP field values — sanitise_for_prompt() strips PII.

Returns: {recommended_value_source: str, confidence: float, reasoning: str}
Token limit: 600 per call
On error: returns None (golden_record_engine falls back to most_recent rule)
"""

import hashlib
import logging
import time
from typing import Optional

from api.utils.pii_fields import sanitise_for_prompt
from api.utils.llm_logger import log_llm_call

logger = logging.getLogger("meridian.ai_survivorship")


def _hash_value(value: object) -> str:
    """Hash a value for prompt inclusion — LLM sees hash, not raw data."""
    return hashlib.sha256(str(value).encode()).hexdigest()[:12]


def _build_prompt(
    field_name: str,
    domain: str,
    contributions: list[dict],
) -> str:
    """Build a survivorship prompt using only metadata and value hashes.

    Each contribution dict has: source_system, extracted_at, confidence, value
    """
    sanitised_entries = []
    for c in contributions:
        sanitised_value = sanitise_for_prompt(field_name, c["value"])
        value_hash = _hash_value(c["value"])
        sanitised_entries.append(
            f"  - Source: {c['source_system']}, "
            f"Extracted: {c['extracted_at']}, "
            f"Confidence: {c.get('confidence', 'N/A')}, "
            f"Value hash: {value_hash}, "
            f"Value preview: {sanitised_value}"
        )

    entries_text = "\n".join(sanitised_entries)

    return f"""You are an SAP master data survivorship expert.

Domain: {domain}
Field: {field_name}
Conflicting values from {len(contributions)} source systems:

{entries_text}

Based on the source system metadata, extraction timestamps, and confidence scores,
recommend which source system's value should be the golden record winner for this field.

Consider:
1. Data recency (more recent extractions may be more current)
2. Source system reliability and confidence scores
3. SAP domain best practices for {domain}

Respond in JSON format only:
{{"recommended_value_source": "<source_system_name>", "confidence": <0.0-1.0>, "reasoning": "<brief explanation>"}}"""


def propose_field_winner(
    tenant_id: str,
    field_name: str,
    domain: str,
    contributions: list[dict],
) -> Optional[dict]:
    """Call LLM to propose a field winner when deterministic rules fail.

    Args:
        tenant_id: Tenant UUID string
        field_name: The field being evaluated
        domain: SAP domain (e.g. 'business_partner')
        contributions: List of dicts with source_system, extracted_at, confidence, value

    Returns:
        Dict with recommended_value_source, confidence, reasoning — or None on error
    """
    if not contributions or len(contributions) < 2:
        return None

    prompt = _build_prompt(field_name, domain, contributions)
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm

        llm = get_llm().bind(max_tokens=600)
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
            service_name="ai_survivorship",
            prompt=prompt,
            model_version=getattr(llm, "model", "unknown"),
            token_count=total_tokens,
            latency_ms=elapsed_ms,
            success=True,
        )

        # Parse JSON response
        import json
        # Strip markdown code fences if present
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        result = json.loads(cleaned)

        # Validate required fields
        if "recommended_value_source" not in result:
            logger.warning("AI survivorship response missing recommended_value_source")
            return None

        return {
            "recommended_value_source": str(result["recommended_value_source"]),
            "confidence": float(result.get("confidence", 0.5)),
            "reasoning": str(result.get("reasoning", "")),
        }

    except Exception as e:
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)
        logger.warning(f"AI survivorship failed for field '{field_name}': {e}")

        try:
            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_survivorship",
                prompt=prompt,
                model_version="unknown",
                token_count=0,
                latency_ms=elapsed_ms,
                success=False,
            )
        except Exception:
            pass

        return None
