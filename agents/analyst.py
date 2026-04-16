"""Analyst sub-agent — identifies root causes from findings summaries.

Receives findings_summary and dqs_scores from AgentState.
Groups findings by module, calls the LLM to identify root causes,
and writes root_causes back to state.
"""

import json
import logging

from jinja2 import Template

from agents.prompts import ANALYST_SYSTEM, ANALYST_USER_TEMPLATE
from agents.state import AgentState
from llm.provider import get_llm_safe, safe_invoke

logger = logging.getLogger("meridian.agents.analyst")

MAX_FINDINGS_PER_CALL = 50


def _render_user_prompt(findings: list[dict], dqs_scores: dict) -> str:
    template = Template(ANALYST_USER_TEMPLATE)
    return template.render(
        findings_json=json.dumps(findings, indent=2),
        dqs_json=json.dumps(dqs_scores, indent=2),
    )


def _parse_response(content: str) -> list[dict] | None:
    """Parse LLM response JSON. Returns None on failure."""
    try:
        # Strip markdown code fences if present
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        data = json.loads(text)
        return data.get("root_causes", [])
    except (json.JSONDecodeError, AttributeError):
        return None


def _chunk_findings(findings: list[dict], max_size: int = MAX_FINDINGS_PER_CALL) -> list[list[dict]]:
    """Split findings into chunks of max_size."""
    return [findings[i:i + max_size] for i in range(0, len(findings), max_size)]


def analyst_node(state: AgentState) -> dict:
    """LangGraph node: analyse findings and identify root causes."""
    findings = state.get("findings_summary", [])
    dqs_scores = state.get("dqs_scores", {})

    if not findings:
        return {"root_causes": []}

    llm = get_llm_safe()
    if llm is None:
        logger.warning("Analyst: LLM unavailable — returning empty root causes")
        return {"root_causes": []}

    all_root_causes: list[dict] = []

    chunks = _chunk_findings(findings)

    for chunk in chunks:
        user_prompt = _render_user_prompt(chunk, dqs_scores)
        messages = [
            {"role": "system", "content": ANALYST_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]

        try:
            content = safe_invoke(llm, messages, timeout_seconds=90)
            if content is None:
                logger.warning("Analyst: LLM call returned None for chunk, skipping")
                continue

            root_causes = _parse_response(content)

            if root_causes is None:
                # Retry once with clarification
                logger.warning("Analyst: invalid JSON on first attempt, retrying")
                retry_messages = messages + [
                    {"role": "assistant", "content": content},
                    {"role": "user", "content": "Your response was not valid JSON. Please respond with ONLY valid JSON matching the schema. No markdown, no explanation."},
                ]
                retry_content = safe_invoke(llm, retry_messages, timeout_seconds=60)
                if retry_content is not None:
                    root_causes = _parse_response(retry_content)

                if root_causes is None:
                    logger.warning("Analyst: invalid JSON on retry — skipping chunk")
                    continue

            all_root_causes.extend(root_causes)

        except Exception as e:
            logger.warning(f"Analyst agent LLM call failed: {e}")
            continue

    logger.info(f"Analyst: identified {len(all_root_causes)} root causes")
    return {"root_causes": all_root_causes}
