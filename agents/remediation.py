"""Remediation sub-agent — cross-finding analysis, effort estimation, sequencing.

Per-field fix instructions are now generated deterministically by the fix generator.
This agent focuses on patterns across findings, realistic effort estimates, fix
sequencing, and flagging cases where deterministic fixes may not apply.
"""

import json
import logging

from jinja2 import Template

from agents.prompts import REMEDIATION_SYSTEM, REMEDIATION_USER_TEMPLATE
from agents.state import AgentState
from llm.provider import get_llm_safe, safe_invoke

logger = logging.getLogger("meridian.agents.remediation")


def _trim_finding_for_remediation(finding: dict) -> dict:
    """Strip large fields the remediation agent doesn't need to keep token count low."""
    rule_ctx = finding.get("rule_context") or {}
    return {
        "check_id": finding.get("check_id"),
        "severity": finding.get("severity"),
        "dimension": finding.get("dimension"),
        "affected_count": finding.get("affected_count"),
        "total_count": finding.get("total_count"),
        "pass_rate": finding.get("pass_rate"),
        "message": finding.get("message"),
        "why_it_matters": (rule_ctx.get("why_it_matters") or "")[:200],
        "sap_impact": (rule_ctx.get("sap_impact") or "")[:100],
    }


def _render_user_prompt(findings: list[dict], root_causes: list[dict]) -> str:
    template = Template(REMEDIATION_USER_TEMPLATE)
    return template.render(
        findings_json=json.dumps(findings, indent=2),
        root_causes_json=json.dumps(root_causes, indent=2),
    )


def _parse_response(content: str) -> dict | None:
    """Parse LLM response JSON. Handles markdown fences and embedded JSON."""
    try:
        text = content.strip()

        # Strip markdown code fences (```json ... ``` or ``` ... ```)
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        # Try direct parse first
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

        # Try to extract JSON object from surrounding text
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(text[start : end + 1])
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass

        # Handle truncated JSON — close open brackets and retry
        if start != -1:
            fragment = text[start:]
            open_braces = fragment.count("{") - fragment.count("}")
            open_brackets = fragment.count("[") - fragment.count("]")
            if open_braces > 0 or open_brackets > 0:
                repaired = fragment + '""' + "]" * open_brackets + "}" * open_braces
                try:
                    data = json.loads(repaired)
                    if isinstance(data, dict):
                        logger.warning("Remediation: repaired truncated JSON")
                        return data
                except json.JSONDecodeError:
                    pass

        return None
    except (json.JSONDecodeError, AttributeError):
        return None


_EMPTY_RESULT = {
    "cross_finding_patterns": [],
    "effort_estimates": [],
    "fix_sequence": [],
    "flags": [],
}


def _empty_result() -> dict:
    """Return a fresh empty result dict (avoids shared mutable state)."""
    return {
        "cross_finding_patterns": [],
        "effort_estimates": [],
        "fix_sequence": [],
        "flags": [],
    }


def _call_llm(
    llm, findings: list[dict], root_causes: list[dict]
) -> dict:
    """Call LLM for cross-finding analysis. Returns result dict (never None)."""
    if not findings:
        return _empty_result()

    user_prompt = _render_user_prompt(findings, root_causes)
    messages = [
        {"role": "system", "content": REMEDIATION_SYSTEM},
        {"role": "user", "content": user_prompt},
    ]

    try:
        content = safe_invoke(llm, messages, timeout_seconds=90)
        if content is None:
            logger.warning("Remediation: LLM call returned None")
            return _empty_result()

        result = _parse_response(content)

        if result is not None:
            return result

        # Invalid JSON — single corrective retry
        logger.warning(
            f"Remediation: invalid JSON "
            f"(len={len(content)}, "
            f"ends='{content[-80:]}')"
        )
        retry_messages = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": "Your response was not valid JSON. Please respond with ONLY valid JSON matching the schema. No markdown, no explanation."},
        ]
        retry_content = safe_invoke(llm, retry_messages, timeout_seconds=60)
        if retry_content is not None:
            result = _parse_response(retry_content)
            if result is not None:
                return result

    except Exception as e:
        logger.warning(f"Remediation LLM call failed: {e}")

    logger.warning("Remediation: returning empty result after all attempts failed")
    return _empty_result()


def remediation_node(state: AgentState) -> dict:
    """LangGraph node: cross-finding analysis, effort estimation, sequencing."""
    findings = state.get("findings_summary", [])
    root_causes = state.get("root_causes", [])

    if not findings:
        return {"remediations": _empty_result()}

    trimmed = [_trim_finding_for_remediation(f) for f in findings]

    llm = get_llm_safe()
    if llm is None:
        logger.warning("Remediation: LLM unavailable — returning empty result")
        return {"remediations": _empty_result()}

    result = _call_llm(llm, trimmed, root_causes)

    # Normalise check_ids in effort_estimates and fix_sequence
    input_ids = {f["check_id"] for f in findings}
    for section_key in ("effort_estimates", "fix_sequence", "flags"):
        for item in result.get(section_key, []):
            cid = item.get("check_id", "")
            if cid and cid not in input_ids:
                normalised = cid.replace("-", "").replace("_", "").upper()
                match = next(
                    (iid for iid in input_ids
                     if iid.replace("-", "").replace("_", "").upper() == normalised),
                    None,
                )
                if match:
                    logger.info(f"Normalised check_id '{cid}' -> '{match}'")
                    item["check_id"] = match
                else:
                    logger.warning(f"Could not match check_id: {cid}")

    logger.info(
        f"Remediation: {len(result.get('cross_finding_patterns', []))} patterns, "
        f"{len(result.get('effort_estimates', []))} estimates, "
        f"{len(result.get('fix_sequence', []))} sequence items"
    )
    return {"remediations": result}
