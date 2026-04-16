"""AgentState — shared state object for the LangGraph agent pipeline.

Every sub-agent reads from and writes to this TypedDict.
findings_summary contains ONLY aggregated summaries — never raw SAP data.
"""

from typing import TypedDict


class AgentState(TypedDict):
    # Identifiers — set before graph entry
    version_id: str
    tenant_id: str
    module_names: list[str]

    # Populated by the orchestrator before entering the graph
    findings_summary: list[dict]
    # Each dict: {check_id, module, severity, dimension, affected_count,
    #             total_count, pass_rate, message}
    # NEVER include raw row data. Summaries only.

    dqs_scores: dict
    # {module: {composite_score, dimension_scores, critical_count, capped}}

    # Populated by analyst_agent
    root_causes: list[dict]
    # Each dict: {module, finding_ids: list[str], root_cause: str,
    #             business_impact: str, sap_context: str}

    # Populated by remediation_agent — cross-finding analysis output
    remediations: dict
    # {cross_finding_patterns: list[dict], effort_estimates: list[dict],
    #  fix_sequence: list[dict], flags: list[dict]}

    # Populated by readiness_agent
    readiness_scores: dict
    # {module: {score: float, status: "go"|"no-go"|"conditional",
    #           blockers: list[str], conditions: list[str]}}

    # Populated by report_agent
    report: dict | None
    # The fully assembled report JSON

    # Populated by config_matching_agent
    config_matches: list[dict]
    # Each dict: {
    #   module, check_id, record_key, field, actual_value,
    #   std_rule_expectation, classification, config_evidence,
    #   recommended_action, sap_tcode, fix_priority
    # }
    # classification is one of: "data_error" | "config_deviation" | "ambiguous"

    config_match_summary: dict
    # {total_records_assessed, data_errors, config_deviations,
    #  ambiguous, modules_with_deviations: list[str]}

    # Populated by config_impact_node
    config_impact_results: list[dict]
    # Each dict: {feature, system, status, blocking_findings, total_affected_records,
    #             blocked_transactions, opportunity_cost_summary, cross_system_dependencies}

    config_impact_summary: dict
    # {total_features_assessed, features_blocked, features_degraded, features_ok,
    #  top_blocked_features: list[str]}

    # Set by any node on non-recoverable error
    error: str | None
