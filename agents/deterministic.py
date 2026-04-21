"""Deterministic analyst — replaces LLM-backed analyst node.

Groups failing findings by module × dimension and ranks by
affected_count × severity weight. Uses YAML why_it_matters for text.
Never calls the LLM.

Replaces: agents/analyst.py (LLM call with root_causes prompt)

For WS5 from Meridian v3.0 spec §9.
"""

from __future__ import annotations

import logging
from typing import TypedDict

from agents.state import AgentState

logger = logging.getLogger("meridian.agents.deterministic")

# Severity weights for ranking
SEVERITY_WEIGHTS = {
    "critical": 4,
    "high": 3,
    "medium": 2,
    "low": 1,
}

# Dimension display names for readability
DIMENSION_LABELS = {
    "completeness": "Data Completeness",
    "accuracy": "Data Accuracy",
    "consistency": "Data Consistency",
    "timeliness": "Data Timeliness",
    "uniqueness": "Data Uniqueness",
    "validity": "Data Validity",
}


class RootCause(TypedDict):
    """A root cause entry for the agent state."""
    module: str
    dimension: str
    finding_ids: list[str]
    root_cause: str
    business_impact: str
    severity: str
    affected_count: int
    pass_rate_avg: float


def run_deterministic_analyst(findings_summary: list[dict]) -> list[RootCause]:
    """Analyze findings deterministically to identify root causes.
    
    Groups failing findings by module × dimension, ranks by
    affected_count × severity weight, and builds root cause descriptions
    using why_it_matters text from rules.
    
    Args:
        findings_summary: List of finding dicts with check_id, module,
                          severity, dimension, affected_count, total_count,
                          pass_rate, and optional rule_context.
    
    Returns:
        List of RootCause dicts sorted by impact (highest first).
    """
    if not findings_summary:
        return []
    
    # Filter to failing findings only
    failing = [f for f in findings_summary if f.get("pass_rate", 100) < 100]
    
    if not failing:
        return []
    
    # Group by module × dimension
    groups: dict[str, list[dict]] = {}
    for f in failing:
        key = (f.get("module", "unknown"), f.get("dimension", "unknown"))
        groups.setdefault(key, []).append(f)
    
    root_causes: list[RootCause] = []
    
    for (module, dimension), group_findings in groups.items():
        # Collect finding IDs
        finding_ids = [f.get("check_id", "") for f in group_findings]
        
        # Sum affected count
        total_affected = sum(f.get("affected_count", 0) for f in group_findings)
        
        # Average pass rate
        pass_rates = [f.get("pass_rate", 0) for f in group_findings]
        avg_pass_rate = sum(pass_rates) / len(pass_rates) if pass_rates else 0
        
        # Determine worst severity in group
        max_severity = "low"
        for f in group_findings:
            sev = f.get("severity", "low").lower()
            if SEVERITY_WEIGHTS.get(sev, 0) > SEVERITY_WEIGHTS.get(max_severity, 0):
                max_severity = sev
        
        # Compute impact score: affected × severity weight
        impact_score = total_affected * SEVERITY_WEIGHTS.get(max_severity, 1)
        
        # Build root cause description
        dimension_label = DIMENSION_LABELS.get(dimension, dimension)
        
        # Get why_it_matters from first finding with rule_context
        why_it_matters = ""
        for f in group_findings:
            ctx = f.get("rule_context", {})
            if ctx and ctx.get("why_it_matters"):
                why_it_matters = ctx["why_it_matters"]
                break
        
        if why_it_matters:
            root_cause_text = f"{dimension_label} gap in {module}: {why_it_matters}"
        else:
            root_cause_text = (
                f"Multiple {dimension_label} issues affecting {total_affected:,} records "
                f"in {module} module"
            )
        
        # Build business impact
        if max_severity == "critical":
            business_impact = f"Blocks SAP migration or critical business process in {module}"
        elif max_severity == "high":
            business_impact = f"Causes data integrity issues or reporting inaccuracies in {module}"
        else:
            business_impact = f"May affect data quality downstream in {module}"
        
        root_causes.append(RootCause(
            module=module,
            dimension=dimension,
            finding_ids=finding_ids,
            root_cause=root_cause_text,
            business_impact=business_impact,
            severity=max_severity,
            affected_count=total_affected,
            pass_rate_avg=round(avg_pass_rate, 2),
        ))
    
    # Sort by impact score descending
    root_causes.sort(
        key=lambda rc: (
            -rc["affected_count"] * SEVERITY_WEIGHTS.get(rc["severity"], 1),
            rc["module"],
            rc["dimension"],
        )
    )
    
    logger.info(f"Deterministic analyst: {len(root_causes)} root causes from {len(failing)} failing findings")
    return root_causes


def analyst_node(state: AgentState) -> dict:
    """LangGraph node: run deterministic analysis and write root_causes."""
    findings = state.get("findings_summary", [])
    root_causes = run_deterministic_analyst(findings)
    return {"root_causes": root_causes}


# Alias for compatibility with existing orchestrator
deterministic_analyst_node = analyst_node