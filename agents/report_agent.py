"""Report sub-agent — assembles all prior agent outputs into a structured report.

This is assembly, not creative work. The LLM is used only for the executive summary.
All status computations are deterministic Python.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from agents.prompts import REPORT_EXECUTIVE_SUMMARY_PROMPT
from agents.state import AgentState
from llm.provider import get_llm_safe, safe_invoke

logger = logging.getLogger("meridian.agents.report")


def _compute_overall_status(readiness_scores: dict) -> str:
    """Deterministic overall migration status — Python, not LLM.

    - "no-go" if any module is "no-go"
    - "conditional" if any module is "conditional" and none are "no-go"
    - "go" if all modules are "go"
    """
    statuses = [m.get("status", "no-go") for m in readiness_scores.values()]
    if not statuses:
        return "no-go"
    if "no-go" in statuses:
        return "no-go"
    if "conditional" in statuses:
        return "conditional"
    return "go"


def _compute_overall_score(readiness_scores: dict) -> float:
    """Average of module readiness scores."""
    scores = [m.get("score", 0.0) for m in readiness_scores.values()]
    if not scores:
        return 0.0
    return round(sum(scores) / len(scores), 2)


def _compute_migration_summary(overall_status: str, overall_score: float) -> str:
    """One-sentence migration readiness summary — computed in Python, not LLM."""
    if overall_status == "go":
        return f"All modules are migration-ready with an overall readiness score of {overall_score}."
    elif overall_status == "no-go":
        return f"Migration is blocked — overall readiness score is {overall_score} with critical unresolved issues."
    else:
        return f"Migration is conditionally ready at {overall_score} — resolve flagged conditions before proceeding."


def _count_findings_by_severity(findings: list[dict]) -> dict:
    """Count findings by severity."""
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        sev = f.get("severity", "low")
        if sev in counts:
            counts[sev] += 1
        else:
            counts["low"] += 1
    counts["total"] = sum(counts.values())
    return counts


_DETERMINISTIC_SUMMARY = "Data quality assessment complete. Review the detailed findings below for remediation priorities."


def _generate_executive_summary(llm, state: AgentState) -> str:
    """Use LLM to write a 2-3 sentence executive summary."""
    if llm is None:
        return _DETERMINISTIC_SUMMARY

    context = {
        "dqs_scores": state.get("dqs_scores", {}),
        "readiness_scores": state.get("readiness_scores", {}),
        "findings_count": len(state.get("findings_summary", [])),
        "modules": state.get("module_names", []),
    }

    messages = [
        {"role": "system", "content": REPORT_EXECUTIVE_SUMMARY_PROMPT},
        {"role": "user", "content": json.dumps(context, indent=2)},
    ]

    content = safe_invoke(llm, messages, timeout_seconds=60)
    if content is None:
        return _DETERMINISTIC_SUMMARY

    summary = content.strip()
    # Strip any JSON wrapper or code fences
    if summary.startswith('"') and summary.endswith('"'):
        summary = summary[1:-1]
    return summary


def report_node(state: AgentState) -> dict:
    """LangGraph node: assemble the final report from all prior agent outputs."""
    llm = get_llm_safe()

    findings = state.get("findings_summary", [])
    dqs_scores = state.get("dqs_scores", {})
    root_causes = state.get("root_causes", [])
    remediations = state.get("remediations", [])
    readiness_scores = state.get("readiness_scores", {})
    module_names = state.get("module_names", [])

    # Executive summary from LLM
    executive_summary = _generate_executive_summary(llm, state)

    # Overall DQS
    module_composites = {
        mod: dqs_scores.get(mod, {}).get("composite_score", 0.0)
        for mod in module_names
    }
    all_scores = list(module_composites.values())
    overall_composite = round(sum(all_scores) / len(all_scores), 2) if all_scores else 0.0

    # Findings by severity
    findings_by_severity = _count_findings_by_severity(findings)

    # Per-module detail
    modules_detail = []
    for mod in module_names:
        mod_dqs = dqs_scores.get(mod, {})
        mod_readiness = readiness_scores.get(mod, {})
        mod_rcs = [rc for rc in root_causes if rc.get("module") == mod]
        # Filter effort_estimates for this module from the remediations dict
        rem_estimates = remediations.get("effort_estimates", []) if isinstance(remediations, dict) else []
        mod_rems = [r for r in rem_estimates if r.get("module") == mod or r.get("check_id", "").startswith(mod[:2].upper())]

        modules_detail.append({
            "name": mod,
            "dqs_score": mod_dqs.get("composite_score", 0.0),
            "readiness_status": mod_readiness.get("status", "no-go"),
            "readiness_score": mod_readiness.get("score", 0.0),
            "critical_count": mod_dqs.get("critical_count", 0),
            "root_causes": mod_rcs,
            "remediations": mod_rems,
            "blockers": mod_readiness.get("blockers", []),
            "conditions": mod_readiness.get("conditions", []),
        })

    # Migration readiness
    overall_status = _compute_overall_status(readiness_scores)
    overall_readiness_score = _compute_overall_score(readiness_scores)
    migration_summary = _compute_migration_summary(overall_status, overall_readiness_score)

    report = {
        "report_id": str(uuid.uuid4()),
        "version_id": state["version_id"],
        "tenant_id": state["tenant_id"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "modules_analysed": module_names,
        "executive_summary": executive_summary,
        "overall_dqs": {
            "composite": overall_composite,
            "by_module": module_composites,
        },
        "findings_by_severity": findings_by_severity,
        "modules": modules_detail,
        "migration_readiness": {
            "overall_status": overall_status,
            "overall_score": overall_readiness_score,
            "summary": migration_summary,
        },
        # Cross-finding remediation analysis (from updated remediation agent)
        "remediations": remediations if isinstance(remediations, dict) else {},
    }

    logger.info(f"Report: assembled for {len(module_names)} modules, status={overall_status}")
    return {"report": report}
