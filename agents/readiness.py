"""Readiness sub-agent — scores migration readiness per module.

Status determination is DETERMINISTIC (Python), not delegated to the LLM.
The LLM is used only to generate qualitative blockers and conditions text.
"""

import json
import logging

from jinja2 import Template

from agents.prompts import READINESS_SYSTEM, READINESS_USER_TEMPLATE
from agents.state import AgentState
from api.services.scoring import _thresholds, critical_over_tolerance, readiness_status
from llm.provider import get_llm_safe, safe_invoke

logger = logging.getLogger("meridian.agents.readiness")


# Deterministic status, never delegated to the LLM: the one band set in api/services/scoring.py
compute_readiness_status = readiness_status


def _render_user_prompt(
    module_name: str, dqs: dict, root_causes: list[dict], remediations: list[dict]
) -> str:
    template = Template(READINESS_USER_TEMPLATE)
    return template.render(
        module_name=module_name,
        dqs_json=json.dumps(dqs, indent=2),
        root_causes_json=json.dumps(root_causes, indent=2),
        remediations_json=json.dumps(remediations, indent=2),
    )


def _parse_response(content: str) -> dict | None:
    """Parse LLM response. Returns dict with blockers/conditions or None."""
    try:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        data = json.loads(text)
        return {
            "blockers": data.get("blockers", []),
            "conditions": data.get("conditions", []),
        }
    except (json.JSONDecodeError, AttributeError):
        return None


def readiness_node(state: AgentState) -> dict:
    """LangGraph node: compute migration readiness per module."""
    dqs_scores = state.get("dqs_scores", {})
    root_causes = state.get("root_causes", [])
    remediations_raw = state.get("remediations", {})
    # Flatten effort_estimates to a list for backwards-compatible filtering
    remediations = remediations_raw.get("effort_estimates", []) if isinstance(remediations_raw, dict) else remediations_raw
    module_names = state.get("module_names", [])

    if not module_names:
        return {"readiness_scores": {}}

    llm = get_llm_safe()
    readiness_scores: dict = {}

    for module in module_names:
        module_dqs = dqs_scores.get(module, {})
        composite = module_dqs.get("composite_score", 0.0)
        status = compute_readiness_status(composite, critical_over_tolerance(module_dqs), state.get("thresholds"))

        # Filter root causes and remediations for this module
        module_rcs = [rc for rc in root_causes if rc.get("module") == module]
        module_rems = [r for r in remediations if r.get("module") == module]

        # Use LLM only for blockers and conditions text
        blockers: list[str] = []
        conditions: list[str] = []

        if llm is not None:
            try:
                user_prompt = _render_user_prompt(module, module_dqs, module_rcs, module_rems)
                messages = [
                    {"role": "system", "content": READINESS_SYSTEM},
                    {"role": "user", "content": user_prompt},
                ]
                content = safe_invoke(llm, messages, timeout_seconds=60)
                if content is not None:
                    parsed = _parse_response(content)
                    if parsed:
                        blockers = parsed["blockers"]
                        conditions = parsed["conditions"]
                    else:
                        logger.warning(f"Readiness: could not parse LLM response for {module}")

            except Exception as e:
                logger.warning(f"Readiness LLM call failed for {module}: {e}")

        # Deterministic fallbacks when LLM produced nothing
        bands = _thresholds(state.get("thresholds"))
        if status == "no-go" and not blockers:
            blockers.append(f"DQS score ({composite}%) is below the {bands['warning']:g}% warning threshold")
        if status == "conditional" and not conditions:
            breaches = critical_over_tolerance(module_dqs)
            conditions.append(f"{breaches} critical finding(s) over tolerance must be resolved" if breaches
                              else f"DQS score is {composite}% — target {bands['target']:g}% for full readiness")

        readiness_scores[module] = {
            "score": composite,
            "status": status,
            "blockers": blockers,
            "conditions": conditions,
        }

    logger.info(f"Readiness: scored {len(readiness_scores)} modules")
    return {"readiness_scores": readiness_scores}
