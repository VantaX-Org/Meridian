"""Config impact agent node — deterministic feature-level impact assessment.

Maps check_id findings to downstream SAP features and systems that are blocked,
degraded, or cosmetically affected.  No LLM calls — pure rule lookup and
aggregation from db/seeds/config_impact_rules.yaml.

Output is written to AgentState as:
  config_impact_results  — list of per-finding impact dicts
  config_impact_summary  — aggregate feature-status counts
"""

import logging
import pathlib
from functools import lru_cache
from typing import Any

import yaml

from agents.state import AgentState

logger = logging.getLogger("meridian.agents.config_impact")

_RULES_PATH = (
    pathlib.Path(__file__).resolve().parent.parent
    / "db"
    / "seeds"
    / "config_impact_rules.yaml"
)

# Impact severity ordering for escalation logic.
_IMPACT_RANK: dict[str, int] = {
    "cosmetic": 0,
    "degraded": 1,
    "full_block": 2,
}


# ---------------------------------------------------------------------------
# Rule loading
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _load_impact_rules() -> dict[str, list[dict[str, Any]]]:
    """Load config impact rules YAML and index by check_id.

    Returns a dict mapping check_id -> list[rule_dict].  A single check_id
    may affect multiple features, so the value is always a list.
    """
    if not _RULES_PATH.exists():
        logger.warning("Config impact rules file not found: %s", _RULES_PATH)
        return {}

    with open(_RULES_PATH, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    rules_list: list[dict] = data.get("rules", [])
    index: dict[str, list[dict[str, Any]]] = {}
    for rule in rules_list:
        cid = rule.get("check_id", "")
        if cid:
            index.setdefault(cid, []).append(rule)

    logger.info("Loaded %d config impact rules (%d unique check_ids)", len(rules_list), len(index))
    return index


def _worst_impact(current: str, incoming: str) -> str:
    """Return the more severe impact type (escalation: ok -> cosmetic -> degraded -> full_block)."""
    if _IMPACT_RANK.get(incoming, -1) > _IMPACT_RANK.get(current, -1):
        return incoming
    return current


# ---------------------------------------------------------------------------
# Agent node
# ---------------------------------------------------------------------------


def config_impact_node(state: AgentState) -> dict[str, Any]:
    """Deterministic config-impact assessment node for the LangGraph pipeline.

    Iterates ``state["findings_summary"]``, looks up each check_id against
    the impact rules, aggregates feature-level status (ok -> degraded ->
    blocked escalation), and returns the results dict to merge into state.

    Returns
    -------
    dict
        ``config_impact_results`` — list of per-finding impact records.
        ``config_impact_summary`` — aggregate counts and top blocked features.
    """
    findings: list[dict] = state.get("findings_summary", [])
    if not findings:
        logger.info("No findings in state — skipping config impact assessment")
        return {
            "config_impact_results": [],
            "config_impact_summary": _empty_summary(),
        }

    rules_index = _load_impact_rules()
    if not rules_index:
        logger.warning("No impact rules loaded — returning empty results")
        return {
            "config_impact_results": [],
            "config_impact_summary": _empty_summary(),
        }

    impact_results: list[dict[str, Any]] = []

    # Track feature status across all findings (feature_key -> worst impact).
    # feature_key = (module, target_feature)
    feature_status: dict[tuple[str, str], str] = {}
    feature_details: dict[tuple[str, str], dict[str, Any]] = {}

    for finding in findings:
        check_id: str = finding.get("check_id", "")
        if not check_id:
            continue

        matched_rules = rules_index.get(check_id, [])
        if not matched_rules:
            continue

        for rule in matched_rules:
            feature_key = (rule["module"], rule["target_feature"])
            impact_type: str = rule.get("impact_type", "cosmetic")

            # Build per-finding impact record
            impact_record: dict[str, Any] = {
                "check_id": check_id,
                "module": rule.get("module", ""),
                "finding_severity": finding.get("severity", ""),
                "finding_message": finding.get("message", ""),
                "pass_rate": finding.get("pass_rate"),
                "affected_count": finding.get("affected_count", 0),
                "total_count": finding.get("total_count", 0),
                "target_feature": rule["target_feature"],
                "target_system": rule.get("target_system", ""),
                "impact_type": impact_type,
                "blocked_transactions": rule.get("blocked_transactions", []),
                "opportunity_cost_category": rule.get("opportunity_cost_category", ""),
                "opportunity_cost_description": rule.get("opportunity_cost_description", ""),
                "cost_driver": rule.get("cost_driver", ""),
                "cross_system_dependencies": rule.get("cross_system_dependencies", {}),
            }
            impact_results.append(impact_record)

            # Escalate feature status
            current = feature_status.get(feature_key, "ok")
            feature_status[feature_key] = _worst_impact(current, impact_type)

            # Store richest detail for summary
            if feature_key not in feature_details or _IMPACT_RANK.get(impact_type, -1) > _IMPACT_RANK.get(
                feature_details[feature_key].get("impact_type", ""), -1
            ):
                feature_details[feature_key] = {
                    "module": rule.get("module", ""),
                    "target_feature": rule["target_feature"],
                    "target_system": rule.get("target_system", ""),
                    "impact_type": impact_type,
                    "blocked_transactions": rule.get("blocked_transactions", []),
                    "cross_system_dependencies": rule.get("cross_system_dependencies", {}),
                }

    # Build summary
    blocked_count = sum(1 for s in feature_status.values() if s == "full_block")
    degraded_count = sum(1 for s in feature_status.values() if s == "degraded")
    cosmetic_count = sum(1 for s in feature_status.values() if s == "cosmetic")
    ok_count = sum(1 for s in feature_status.values() if s == "ok")
    total = len(feature_status)

    # Top blocked features sorted by impact severity then alphabetically
    top_blocked = sorted(
        [
            {
                "module": details["module"],
                "feature": details["target_feature"],
                "target_system": details["target_system"],
                "impact_type": details["impact_type"],
                "blocked_transactions": details["blocked_transactions"],
                "cross_system_dependencies": details["cross_system_dependencies"],
            }
            for key, details in feature_details.items()
            if feature_status.get(key) == "full_block"
        ],
        key=lambda x: (x["module"], x["feature"]),
    )

    summary: dict[str, Any] = {
        "total_features_assessed": total,
        "features_blocked": blocked_count,
        "features_degraded": degraded_count,
        "features_cosmetic": cosmetic_count,
        "features_ok": ok_count,
        "top_blocked_features": top_blocked,
    }

    logger.info(
        "Config impact: %d features assessed — %d blocked, %d degraded, %d cosmetic, %d ok",
        total,
        blocked_count,
        degraded_count,
        cosmetic_count,
        ok_count,
    )

    return {
        "config_impact_results": impact_results,
        "config_impact_summary": summary,
    }


def _empty_summary() -> dict[str, Any]:
    """Return a zeroed-out summary dict."""
    return {
        "total_features_assessed": 0,
        "features_blocked": 0,
        "features_degraded": 0,
        "features_cosmetic": 0,
        "features_ok": 0,
        "top_blocked_features": [],
    }
