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
import os
import pathlib
import time
from functools import lru_cache
from typing import Any, Optional

import yaml

from api.utils.pii_fields import sanitise_for_prompt
from api.utils.llm_logger import log_deterministic_skip, log_llm_call

logger = logging.getLogger("meridian.ai_impact_scorer")

_RULES_PATH = (
    pathlib.Path(__file__).resolve().parent.parent.parent
    / "db"
    / "seeds"
    / "config_impact_rules.yaml"
)

_IMPACT_SCORE: dict[str, float] = {
    "cosmetic": 0.2,
    "degraded": 0.6,
    "full_block": 0.95,
}


def _rules_files_path() -> pathlib.Path:
    return _RULES_PATH


@lru_cache(maxsize=1)
def _load_rules_by_module() -> dict[str, list[dict[str, Any]]]:
    """Index config_impact_rules.yaml by the SAP module each rule applies to.

    The YAML schema uses ``module`` (e.g. business_partner, material_master) —
    the ``changed_field`` input to the scorer is the trailing SAP field name
    (e.g. NAME1) which isn't enough to identify impact. We fan out by module
    instead: for any finding in module X, the rule list tells us which
    downstream features are at risk.
    """
    if not _RULES_PATH.exists():
        logger.warning("config_impact_rules.yaml not found at %s", _RULES_PATH)
        return {}

    with open(_RULES_PATH, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}

    out: dict[str, list[dict[str, Any]]] = {}
    for rule in data.get("rules", []):
        module = (rule.get("module") or "").strip()
        if module:
            out.setdefault(module, []).append(rule)
    logger.info("ai_impact_scorer: loaded deterministic rules for %d modules", len(out))
    return out


# Backward-compat alias for tests that imported the old name.
_load_rules_by_field = _load_rules_by_module


def _llm_enabled() -> bool:
    """Feature flag — default ON. MERIDIAN_IMPACT_SCORER_LLM=off keeps this fully deterministic."""
    val = os.getenv("MERIDIAN_IMPACT_SCORER_LLM", "on").strip().lower()
    return val not in ("off", "false", "0", "no")


def deterministic_impact(
    changed_field: str,
    domain: str,
    related_domains: list[dict],
) -> Optional[dict]:
    """Return impact dict from YAML rules if ``domain`` is known, else None.

    Uses the 52-rule `config_impact_rules.yaml` that already powers the
    deterministic `agents/config_impact.py` node. A field change in a known
    SAP module (domain) is scored using the worst-case rule for that module —
    we aggregate ``impact_type`` to the most severe band and collect the set
    of downstream features and target systems that the rules call out.

    ``changed_field`` is still threaded through for rationale text but the
    lookup key is the module, because the YAML is organised that way.
    """
    rules = _load_rules_by_module().get(domain)
    if not rules:
        return None

    worst = "cosmetic"
    affected: set[str] = set()
    features: list[str] = []
    blocked: list[str] = []

    for rule in rules:
        impact = (rule.get("impact_type") or rule.get("impact") or "cosmetic").strip()
        if _IMPACT_SCORE.get(impact, 0) > _IMPACT_SCORE.get(worst, 0):
            worst = impact
        feat = rule.get("target_feature") or rule.get("feature")
        if feat:
            features.append(feat)
        tgt_sys = rule.get("target_system")
        if tgt_sys:
            affected.add(tgt_sys)
        for bt in rule.get("blocked_transactions", []) or []:
            blocked.append(bt)

    # Union with caller-supplied related domains for a complete picture.
    for r in related_domains or []:
        if r.get("to_domain"):
            affected.add(r["to_domain"])

    rationale = (
        f"Deterministic rule match for module '{domain}' ({worst}); "
        f"affects {len(set(features))} downstream feature(s)"
    )

    return {
        "impact_score": _IMPACT_SCORE.get(worst, 0.5),
        "affected_domains": sorted(affected) or [domain],
        "rationale": rationale,
        "features": sorted(set(features)),
        "blocked_transactions": sorted(set(blocked))[:8],
        "deterministic": True,
    }


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

    # Deterministic first — if the field appears in config_impact_rules.yaml
    # we can answer in microseconds with full audit trail.
    det = deterministic_impact(changed_field, domain, related_domains)
    if det is not None:
        try:
            log_deterministic_skip(tenant_id, "ai_impact_scorer", "config_impact_rules")
        except Exception:
            pass
        return det
    if not _llm_enabled():
        return {"impact_score": 0.0, "affected_domains": [], "rationale": "LLM disabled and no rule match"}

    prompt = _build_impact_prompt(changed_field, domain, related_domains)
    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm, safe_invoke

        llm = get_llm().bind(max_tokens=600)
        response = safe_invoke(llm, prompt, timeout_seconds=45)
        if response is None:
            logger.warning("Impact scorer LLM timeout")
            return {"impact_score": 0.0, "affected_domains": [], "rationale": "LLM unavailable"}
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response if isinstance(response, str) else (
            response.content if hasattr(response, "content") else str(response)
        )

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
        from llm.provider import get_llm, safe_invoke

        llm = get_llm().bind(max_tokens=600)
        response = safe_invoke(llm, prompt, timeout_seconds=45)
        if response is None:
            logger.warning("Inference LLM timeout")
            return []
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response if isinstance(response, str) else (
            response.content if hasattr(response, "content") else str(response)
        )

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
