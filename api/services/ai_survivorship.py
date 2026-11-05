"""AI survivorship service — proposes field winners when deterministic rules cannot.

Called by: golden_record_engine.py for fields with no deterministic survivorship rule winner.
Prompt construction: field names + source system metadata + aggregate value shapes ONLY (see ``facts``).
The LLM never sees a SAP field value, a preview or a hash of one. Its answer is proved by ``verify`` before it can win.

Returns: {recommended_value_source: str, confidence: float, reasoning: str (written by verify), verification: dict}
Token limit: 600 per call
On error: returns None (golden_record_engine falls back to most_recent rule)
"""

import logging
import time
from typing import Optional

from api.utils.llm_logger import log_llm_call

logger = logging.getLogger("meridian.ai_survivorship")


def ai_survivorship_available() -> bool:
    """False when no LLM is configured (``LLM_PROVIDER=none`` or the admin config says so):
    the engine then runs deterministic survivorship only. Decide this once per run."""
    from llm.provider import llm_is_noop
    return not llm_is_noop()


def facts(contributions: list[dict], field_name: str | None = None) -> list[dict]:
    """The only thing the model sees about each contributor: where it came from, when, how confident, and the
    aggregate shape of its value (mask, length, blank) plus how many other sources hold the same value. Never the
    value, a preview of it, or a hash of it (a hash of a short code can be reversed by guessing)."""
    from api.services.fix_drafter import mask_of
    from api.utils.pii_fields import is_pii_header

    personal = is_pii_header(field_name)  # a personal field keeps its length, never its mask
    texts = [("" if c["value"] is None else str(c["value"]).strip()) for c in contributions]
    return [
        {"source_system": c["source_system"], "extracted_at": str(c["extracted_at"]), "confidence": c.get("confidence"),
         "blank": not t, "length": len(t), "mask": "" if personal else mask_of(t), "same_as": sum(1 for o in texts if o == t) - 1}
        for c, t in zip(contributions, texts)
    ]


def _build_prompt(field_name: str, domain: str, contributions: list[dict]) -> str:
    """Survivorship prompt from ``facts`` only. ``field_name`` is metadata, not a value."""
    lines = "\n".join(
        f"  - Source: {f['source_system']}, Extracted: {f['extracted_at']}, Confidence: {f['confidence']}, "
        f"Blank: {f['blank']}, Length: {f['length']}, Shape: {f['mask']}, Other sources with the same value: {f['same_as']}"
        for f in facts(contributions, field_name)
    )
    return f"""You are an SAP master data survivorship expert.

Domain: {domain}
Field: {field_name}
Conflicting values from {len(contributions)} source systems. You see each value's shape only (A upper, a lower, 9 digit, ~ space), never the value:

{lines}

Recommend which source system's value should be the golden record winner for this field, using recency,
confidence, completeness and agreement between sources.

Respond in JSON format only:
{{"recommended_value_source": "<source_system_name>", "confidence": <0.0-1.0>}}"""


def verify(contributions: list[dict], rec: dict) -> dict:
    """Prove a model recommendation against the contributions before it can win. Deterministic.

    SOURCE_KNOWN       the named source is exactly one contributor (no invented or ambiguous source)
    VALUE_PRESENT      that contributor's value is not blank
    CONFIDENCE_VALID   the stated confidence is a number from 0 to 1
    The model's free-text reasoning is never kept: the sentence shown is written here from the same facts."""
    named = [c for c in contributions if c["source_system"] == rec.get("recommended_value_source")]
    win = named[0] if len(named) == 1 else None
    text = "" if win is None or win["value"] is None else str(win["value"]).strip()
    conf = rec.get("confidence")
    checks = [
        {"code": "SOURCE_KNOWN", "passed": win is not None},
        {"code": "VALUE_PRESENT", "passed": bool(text)},
        {"code": "CONFIDENCE_VALID", "passed": isinstance(conf, (int, float)) and not isinstance(conf, bool) and 0 <= conf <= 1},
    ]
    same = sum(1 for c in contributions if win is not None and str(c["value"] or "").strip() == text) - 1 if win else 0
    sentence = (f"{win['source_system']} holds a value extracted {win['extracted_at']}; {same} of the other "
                f"{len(contributions) - 1} sources hold the same value.") if win is not None and text else ""
    return {"verified": all(c["passed"] for c in checks), "checks": checks, "reasoning": sentence}


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
    if not ai_survivorship_available():
        return None  # no LLM: the caller's deterministic chain decides

    from api.services.prompt_shapes import aggregates_only
    if aggregates_only(tenant_id):
        return None  # "aggregates only": every per-source fact is derived from a row, so the deterministic chain decides
    prompt = _build_prompt(field_name, domain, contributions)
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm, safe_invoke

        llm = get_llm()
        response = safe_invoke(llm, prompt, timeout_seconds=40, max_tokens=600)
        if response is None:
            logger.warning(f"Survivorship LLM timeout for {field_name}")
            return None  # Fallback to deterministic survivorship
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

        rec = {"recommended_value_source": str(result["recommended_value_source"]), "confidence": result.get("confidence")}
        proof = verify(contributions, rec)
        conf = rec["confidence"]
        return {
            "recommended_value_source": rec["recommended_value_source"],
            "confidence": float(conf) if proof["verified"] else 0.0,
            "reasoning": proof["reasoning"],
            "verification": {"verified": proof["verified"], "checks": proof["checks"]},
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
