"""AI impact scorer — predicts downstream impact when a golden record changes.

Called by: relationship_discovery.py after golden records are updated.
Input: changed field name, related domain list from record_relationships.
Does NOT receive raw field values — uses field names and relationship metadata only.
Returns: {impact_score: float, affected_domains: list[str], rationale: str}
Token limit: 600 per call.

Also runs a secondary inference pass to flag ai_inferred relationships
(probable relationships not found in RFC link tables, stored with ai_inferred=True).
"""

import json
import logging
import time
from typing import Optional

from api.utils.pii_fields import sanitise_for_prompt
from api.utils.llm_logger import log_llm_call

logger = logging.getLogger("meridian.ai_impact_scorer")


def _build_impact_prompt(
    changed_field: str,
    domain: str,
    related_domains: list[dict],
) -> str:
    """Build prompt using only field names and relationship metadata — no raw values."""
    relationships_text = "\n".join(
        f"  - {r['to_domain']} via {r['relationship_type']} "
        f"(link table: {r.get('sap_link_table', 'N/A')})"
        for r in related_domains
    )

    return f"""You are an SAP master data impact analysis expert.

A golden record field has changed in the {domain} domain.
Changed field: {sanitise_for_prompt(changed_field, changed_field)}

Related domains connected to this record:
{relationships_text}

Assess the downstream impact of this field change on each related domain.
Consider SAP cross-domain dependencies, data propagation paths, and business process impact.

Respond in JSON format only:
{{"impact_score": <0.0-1.0>, "affected_domains": [<list of domain names that need review>], "rationale": "<brief explanation of impact chain>"}}"""


def _build_inference_prompt(
    domain: str,
    sap_object_key: str,
    known_relationships: list[dict],
    candidate_domains: list[str],
) -> str:
    """Build prompt to infer probable relationships not found in RFC link tables."""
    known_text = "\n".join(
        f"  - {r['to_domain']} ({r['relationship_type']})"
        for r in known_relationships
    ) or "  (none discovered via RFC)"

    candidates_text = ", ".join(candidate_domains)

    return f"""You are an SAP cross-domain relationship expert.

Domain: {domain}
Object key pattern: {sanitise_for_prompt('sap_object_key', sap_object_key)}

Known RFC-discovered relationships:
{known_text}

Candidate domains that MAY have undiscovered relationships: {candidates_text}

Based on SAP domain knowledge, which candidate domains likely have a relationship
with this {domain} record, even if no RFC link table confirms it?

Only suggest relationships with high probability based on SAP best practices.

Respond in JSON format only:
{{"inferred_relationships": [{{"to_domain": "<domain>", "relationship_type": "<type>", "confidence": <0.0-1.0>, "reasoning": "<brief>"}}]}}"""


def score_impact(
    tenant_id: str,
    changed_field: str,
    domain: str,
    related_domains: list[dict],
) -> Optional[dict]:
    """Predict downstream impact when a golden record field changes.

    Args:
        tenant_id: Tenant UUID string
        changed_field: The field that changed
        domain: SAP domain of the changed record
        related_domains: List of dicts with to_domain, relationship_type, sap_link_table

    Returns:
        Dict with impact_score, affected_domains, rationale — or None on error
    """
    if not related_domains:
        return {"impact_score": 0.0, "affected_domains": [], "rationale": "No related domains found"}

    prompt = _build_impact_prompt(changed_field, domain, related_domains)
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm

        llm = get_llm().bind(max_tokens=600)
        response = llm.invoke(prompt)
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response.content if hasattr(response, "content") else str(response)

        token_count = getattr(response, "usage_metadata", {})
        total_tokens = token_count.get("total_tokens", 0) if isinstance(token_count, dict) else 0

        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_impact_scorer",
            prompt=prompt,
            model_version=getattr(llm, "model", "unknown"),
            token_count=total_tokens,
            latency_ms=elapsed_ms,
            success=True,
        )

        # Parse JSON response
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        result = json.loads(cleaned)

        return {
            "impact_score": max(0.0, min(1.0, float(result.get("impact_score", 0.5)))),
            "affected_domains": list(result.get("affected_domains", [])),
            "rationale": str(result.get("rationale", "")),
        }

    except Exception as e:
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)
        logger.warning(f"AI impact scoring failed for field '{changed_field}': {e}")

        try:
            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_impact_scorer",
                prompt=prompt,
                model_version="unknown",
                token_count=0,
                latency_ms=elapsed_ms,
                success=False,
            )
        except Exception:
            pass

        return None


def infer_relationships(
    tenant_id: str,
    domain: str,
    sap_object_key: str,
    known_relationships: list[dict],
    candidate_domains: list[str],
) -> list[dict]:
    """Infer probable relationships not found in RFC link tables.

    Args:
        tenant_id: Tenant UUID string
        domain: SAP domain of the record
        sap_object_key: The record's SAP key
        known_relationships: Already-discovered relationships
        candidate_domains: Domains to check for undiscovered relationships

    Returns:
        List of dicts with to_domain, relationship_type, confidence, reasoning
    """
    if not candidate_domains:
        return []

    prompt = _build_inference_prompt(domain, sap_object_key, known_relationships, candidate_domains)
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm

        llm = get_llm().bind(max_tokens=600)
        response = llm.invoke(prompt)
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response.content if hasattr(response, "content") else str(response)

        token_count = getattr(response, "usage_metadata", {})
        total_tokens = token_count.get("total_tokens", 0) if isinstance(token_count, dict) else 0

        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_impact_scorer_inference",
            prompt=prompt,
            model_version=getattr(llm, "model", "unknown"),
            token_count=total_tokens,
            latency_ms=elapsed_ms,
            success=True,
        )

        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        result = json.loads(cleaned)
        inferred = result.get("inferred_relationships", [])

        # Filter to only high-confidence inferences (>= 0.6)
        return [
            {
                "to_domain": str(r["to_domain"]),
                "relationship_type": str(r["relationship_type"]),
                "confidence": max(0.0, min(1.0, float(r.get("confidence", 0.5)))),
                "reasoning": str(r.get("reasoning", "")),
            }
            for r in inferred
            if float(r.get("confidence", 0)) >= 0.6
        ]

    except Exception as e:
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)
        logger.warning(f"AI relationship inference failed for {domain}/{sap_object_key}: {e}")

        try:
            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_impact_scorer_inference",
                prompt=prompt,
                model_version="unknown",
                token_count=0,
                latency_ms=elapsed_ms,
                success=False,
            )
        except Exception:
            pass

        return []
