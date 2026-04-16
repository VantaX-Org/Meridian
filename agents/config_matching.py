"""Config matching sub-agent — classifies findings as data errors vs config deviations.

Receives findings_summary from AgentState.
Groups findings by module, extracts config signals, calls the LLM to classify
each finding as data_error, config_deviation, or ambiguous, and writes
config_matches and config_match_summary back to state.
"""

import json
import logging
import pathlib
import yaml

import pandas as pd
from jinja2 import Template

from agents.prompts import CONFIG_MATCH_SYSTEM, CONFIG_MATCH_USER_TEMPLATE
from agents.state import AgentState
from checks.config_signals import extract_config_signals
from checks.runner import RULES_DIR, CATEGORIES
from llm.provider import get_llm_safe, safe_invoke

logger = logging.getLogger("meridian.agents.config_matching")

MAX_RECORDS_PER_MODULE = 30
MAX_VALUE_SAMPLES = 5


def _load_rule_context(module: str, check_ids: list[str]) -> dict:
    """Load YAML rule file for the module and extract context for each check_id.

    Returns {check_id: {why_it_matters, sap_impact, std_expectation}} for each
    matched check. Returns empty dict if YAML not found — never raises.
    """
    try:
        yaml_path: pathlib.Path | None = None
        for category in CATEGORIES:
            candidate = RULES_DIR / category / f"{module}.yaml"
            if candidate.exists():
                yaml_path = candidate
                break

        if yaml_path is None:
            return {}

        with open(yaml_path, "r") as f:
            config = yaml.safe_load(f)

        rules = config.get("rules", [])
        check_id_set = set(check_ids)
        context: dict = {}

        for rule in rules:
            cid = rule.get("check_id", "")
            if cid in check_id_set:
                context[cid] = {
                    "why_it_matters": rule.get("why_it_matters", ""),
                    "sap_impact": rule.get("sap_impact", ""),
                    "std_expectation": rule.get("message", ""),
                }

        return context

    except Exception as exc:
        logger.warning("_load_rule_context failed for module %r: %s", module, exc)
        return {}


def _extract_value_samples(finding: dict) -> list[str]:
    """Extract up to MAX_VALUE_SAMPLES distinct bad values from value_fix_map.

    Excludes __blank__ and __null__ sentinel keys.
    Returns [] if value_fix_map is missing or empty.
    """
    value_fix_map = finding.get("value_fix_map")
    if not value_fix_map:
        return []

    sentinels = {"__blank__", "__null__"}
    samples = [k for k in value_fix_map if k not in sentinels]
    return samples[:MAX_VALUE_SAMPLES]


def _build_findings_payload(findings: list[dict]) -> list[dict]:
    """Build trimmed finding dicts for the LLM, capped at MAX_RECORDS_PER_MODULE."""
    payload = []
    for finding in findings[:MAX_RECORDS_PER_MODULE]:
        payload.append({
            "check_id": finding.get("check_id", ""),
            "field": finding.get("field", ""),
            "affected_count": finding.get("affected_count", 0),
            "total_count": finding.get("total_count", 0),
            "pass_rate": finding.get("pass_rate", 0.0),
            "message": finding.get("message", ""),
            "value_samples": _extract_value_samples(finding),
        })
    return payload


def _render_user_prompt(
    module: str,
    findings: list[dict],
    config_patterns: dict,
    rule_context: dict,
) -> str:
    template = Template(CONFIG_MATCH_USER_TEMPLATE)
    return template.render(
        module=module,
        findings_with_signals_json=json.dumps(_build_findings_payload(findings), indent=2),
        config_patterns_json=json.dumps(config_patterns, indent=2),
        rule_context_json=json.dumps(rule_context, indent=2),
    )


def _parse_response(content: str) -> list[dict] | None:
    """Parse LLM response JSON. Returns None on failure."""
    try:
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        data = json.loads(text)
        return data.get("classifications", [])
    except (json.JSONDecodeError, AttributeError):
        return None


def config_matching_node(state: AgentState) -> dict:
    """LangGraph node: classify findings as data errors vs config deviations."""
    findings_summary = state.get("findings_summary", [])

    if not findings_summary:
        return {
            "config_matches": [],
            "config_match_summary": {
                "total_records_assessed": 0,
                "data_errors": 0,
                "config_deviations": 0,
                "ambiguous": 0,
                "modules_with_deviations": [],
            },
        }

    # Group findings by module
    by_module: dict[str, list[dict]] = {}
    for finding in findings_summary:
        module = finding.get("module", "unknown")
        by_module.setdefault(module, []).append(finding)

    llm = get_llm_safe()

    all_matches: list[dict] = []
    total_data_errors = 0
    total_deviations = 0
    total_ambiguous = 0
    modules_with_deviations: list[str] = []

    for module, module_findings in by_module.items():
        if llm is None:
            # LLM unavailable — mark all as ambiguous
            classifications = [
                {
                    "check_id": f.get("check_id", ""),
                    "record_key": "",
                    "field": f.get("field", ""),
                    "actual_value": "",
                    "std_rule_expectation": f.get("message", ""),
                    "classification": "ambiguous",
                    "config_evidence": "LLM unavailable — flagged for human review",
                    "recommended_action": "Manual stewardship review required",
                    "sap_tcode": "",
                    "fix_priority": 3,
                    "module": module,
                }
                for f in module_findings
            ]
            all_matches.extend(classifications)
            total_ambiguous += len(classifications)
            continue

        try:
            rows = []
            for finding in module_findings:
                value_fix_map = finding.get("value_fix_map") or {}
                sentinels = {"__blank__", "__null__"}
                for val in value_fix_map:
                    if val not in sentinels:
                        rows.append({finding.get("field", "value"): val})
            reconstructed_df = pd.DataFrame(rows) if rows else pd.DataFrame()

            config_patterns = extract_config_signals(module, reconstructed_df)

            check_ids = [f.get("check_id", "") for f in module_findings]
            rule_context = _load_rule_context(module, check_ids)

            user_prompt = _render_user_prompt(module, module_findings, config_patterns, rule_context)
            messages = [
                {"role": "system", "content": CONFIG_MATCH_SYSTEM},
                {"role": "user", "content": user_prompt},
            ]

            content = safe_invoke(llm, messages, timeout_seconds=90)
            classifications = _parse_response(content) if content else None

            if classifications is None and content is not None:
                logger.warning(
                    "Config matching: invalid JSON on first attempt for %r, retrying",
                    module,
                )
                retry_messages = messages + [
                    {"role": "assistant", "content": content},
                    {
                        "role": "user",
                        "content": (
                            "Your response was not valid JSON. Please respond with ONLY valid JSON "
                            "matching the schema. No markdown, no explanation."
                        ),
                    },
                ]
                retry_content = safe_invoke(llm, retry_messages, timeout_seconds=60)
                if retry_content is not None:
                    classifications = _parse_response(retry_content)

            if classifications is None:
                logger.warning(
                    "Config matching: could not classify %r — marking all as ambiguous",
                    module,
                )
                classifications = [
                    {
                        "check_id": f.get("check_id", ""),
                        "record_key": "",
                        "field": f.get("field", ""),
                        "actual_value": "",
                        "std_rule_expectation": f.get("message", ""),
                        "classification": "ambiguous",
                        "config_evidence": "LLM failed to classify — flagged for human review",
                        "recommended_action": "Manual stewardship review required",
                        "sap_tcode": "",
                        "fix_priority": 3,
                    }
                    for f in module_findings
                ]

        except Exception as exc:
            logger.warning("Config matching failed for module %r: %s", module, exc)
            classifications = [
                {
                    "check_id": f.get("check_id", ""),
                    "record_key": "",
                    "field": f.get("field", ""),
                    "actual_value": "",
                    "std_rule_expectation": f.get("message", ""),
                    "classification": "ambiguous",
                    "config_evidence": "LLM error — flagged for human review",
                    "recommended_action": "Manual stewardship review required",
                    "sap_tcode": "",
                    "fix_priority": 3,
                }
                for f in module_findings
            ]

        # Attach module to each classification and tally counts
        data_errors = 0
        deviations = 0
        ambiguous = 0
        for item in classifications:
            item["module"] = module
            clf = item.get("classification", "ambiguous")
            if clf == "data_error":
                data_errors += 1
            elif clf == "config_deviation":
                deviations += 1
            else:
                ambiguous += 1

        logger.info(
            "Config matching: %s — %d errors, %d deviations, %d ambiguous",
            module, data_errors, deviations, ambiguous,
        )

        all_matches.extend(classifications)
        total_data_errors += data_errors
        total_deviations += deviations
        total_ambiguous += ambiguous

        if deviations > 0:
            modules_with_deviations.append(module)

    config_match_summary = {
        "total_records_assessed": len(all_matches),
        "data_errors": total_data_errors,
        "config_deviations": total_deviations,
        "ambiguous": total_ambiguous,
        "modules_with_deviations": modules_with_deviations,
    }

    return {
        "config_matches": all_matches,
        "config_match_summary": config_match_summary,
    }
