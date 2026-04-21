"""Deterministic narrator — generates narrative JSON without LLM.

Single optional LLM call. All other paths use 30 hand-written templates
selected by finding pattern. Hard constraint: narrator prompt contains
only aggregate finding metadata, NEVER raw SAP data.

For WS5 from Meridian v3.0 spec §9.

Usage:
    from agents.narrator import Narrative, generate_narrative
    
    narrative = await generate_narrative(
        findings_summary=findings,
        root_causes=root_causes,
        dqs_scores=dqs_scores,
        mode="none"  # or "hq", "own"
    )
"""

from __future__ import annotations

import json
import logging
import random
from dataclasses import dataclass, field
from typing import Optional

from jinja2 import Template

logger = logging.getLogger("meridian.agents.narrator")

# ---------------------------------------------------------------------------
# Narrative output structure
# ---------------------------------------------------------------------------

@dataclass
class Narrative:
    """The output of the narrator — a structured summary of the analysis."""
    executive_summary: str
    top_3_risks: list[dict]
    top_3_wins: list[dict]
    recommended_next_actions: list[dict]
    key_metrics: dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "executive_summary": self.executive_summary,
            "top_3_risks": self.top_3_risks,
            "top_3_wins": self.top_3_wins,
            "recommended_next_actions": self.recommended_next_actions,
            "key_metrics": self.key_metrics,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "Narrative":
        return cls(
            executive_summary=data.get("executive_summary", ""),
            top_3_risks=data.get("top_3_risks", []),
            top_3_wins=data.get("top_3_wins", []),
            recommended_next_actions=data.get("recommended_next_actions", []),
            key_metrics=data.get("key_metrics", {}),
        )


# ---------------------------------------------------------------------------
# Template selection helpers
# ---------------------------------------------------------------------------

# Severity ordering for risk selection
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

# Dimension labels for human-readable output
DIMENSION_LABELS = {
    "completeness": "Data Completeness",
    "accuracy": "Data Accuracy",
    "consistency": "Data Consistency",
    "timeliness": "Data Timeliness",
    "uniqueness": "Data Uniqueness",
    "validity": "Data Validity",
}


def _select_template(findings: list[dict]) -> str:
    """Select the appropriate template based on finding patterns.
    
    Selection logic:
    1. If no findings: "clean" template
    2. If any critical: "critical" template
    3. If all high severity: "high_severity" template
    4. If multiple modules affected: "multi_module" template
    5. If low pass rate: "poor_quality" template
    6. Default: "moderate_issues" template
    """
    if not findings:
        return "clean"
    
    # Check for critical severity
    if any(f.get("severity") == "critical" for f in findings):
        return "critical"
    
    # Check for high severity only
    severities = {f.get("severity", "low") for f in findings}
    if severities == {"high"} or severities == {"high", "low"}:
        return "high_severity"
    
    # Check for multi-module
    modules = {f.get("module", "unknown") for f in findings}
    if len(modules) >= 3:
        return "multi_module"
    
    # Check for poor quality (avg pass rate < 80)
    avg_pass_rate = sum(f.get("pass_rate", 0) for f in findings) / len(findings)
    if avg_pass_rate < 80:
        return "poor_quality"
    
    return "moderate_issues"


# ---------------------------------------------------------------------------
# 30 hand-written templates
# ---------------------------------------------------------------------------

TEMPLATES = {
    "clean": {
        "executive_summary": (
            "This analysis completed successfully with no data quality findings. "
            "All {{ total_records:, }} evaluated records passed every configured rule. "
            "Your SAP data is in excellent shape for downstream processes."
        ),
        "top_3_risks": [],
        "top_3_wins": [
            {"text": "All rules passed", "detail": "Zero findings across all modules"},
            {"text": "Migration ready", "detail": "No blockers for SAP upgrade or migration"},
            {"text": "Clean audit trail", "detail": "All records conform to standards"},
        ],
        "recommended_next_actions": [
            {"action": "Schedule next analysis", "detail": "Set up recurring weekly/monthly analysis"},
            {"action": "Review rule coverage", "detail": "Confirm rule set covers all critical fields"},
        ],
    },
    
    "critical": {
        "executive_summary": (
            "CRITICAL: This analysis identified {{ critical_count }} critical severity issues "
            "affecting {{ critical_affected:, }} records. These issues will block SAP migration "
            "or cause critical business process failures if not resolved before go-live."
        ),
        "top_3_risks": [
            {"text": "{{ top_risk.module }}: {{ top_risk.count:, }} records affected", 
             "detail": "{{ top_risk.dimension }} issues with {{ top_risk.severity }} severity"},
            {"text": "Migration blocker", "detail": "Critical issues must be resolved before any SAP upgrade"},
            {"text": "Process impact", "detail": "{{ process_impact }}"},
        ],
        "top_3_wins": [],
        "recommended_next_actions": [
            {"action": "Escalate critical findings", "detail": "Engage SAP Basis and functional teams immediately"},
            {"action": "Fix before migration", "detail": "Block migration until critical findings are resolved"},
            {"action": "Review data sources", "detail": "Identify upstream systems causing bad data"},
        ],
    },
    
    "high_severity": {
        "executive_summary": (
            "This analysis found {{ high_count }} high-severity data quality issues "
            "affecting {{ affected_count:, }} records. While not immediately blocking, "
            "these issues should be resolved before go-live to prevent process failures."
        ),
        "top_3_risks": [
            {"text": "Data integrity risk", 
             "detail": "{{ high_count }} high-severity findings across {{ module_count }} modules"},
            {"text": "Process impact", "detail": "May cause downstream processing errors in SAP"},
            {"text": "Compliance concern", "detail": "Data quality issues may affect regulatory reporting"},
        ],
        "top_3_wins": [
            {"text": "No critical blockers", "detail": "Migration can proceed after fixes"},
        ],
        "recommended_next_actions": [
            {"action": "Prioritize by module", "detail": "Focus on highest-impact modules first"},
            {"action": "Assign to stewards", "detail": "Distribute to data stewardship team for resolution"},
            {"action": "Review fix instructions", "detail": "Each finding has deterministic fix guidance"},
        ],
    },
    
    "multi_module": {
        "executive_summary": (
            "This analysis found data quality issues across {{ module_count }} modules "
            "affecting {{ total_affected:, }} total records. Issues span "
            "{{ dimension_count }} quality dimensions, suggesting systemic data governance gaps."
        ),
        "top_3_risks": [
            {"text": "Multi-module impact", "detail": "{{ module_count }} modules require coordinated fixes"},
            {"text": "Cross-module dependencies", "detail": "Some fixes may affect multiple modules"},
            {"text": "Data governance gap", "detail": "Systemic issues require process-level remediation"},
        ],
        "top_3_wins": [
            {"text": "Complete picture", "detail": "Full landscape enables coordinated remediation"},
        ],
        "recommended_next_actions": [
            {"action": "Create master remediation plan", "detail": "Coordinate fixes across all affected modules"},
            {"action": "Address root causes", "detail": "Fix upstream data entry processes"},
            {"action": "Implement data governance", "detail": "Establish controls to prevent recurrence"},
        ],
    },
    
    "poor_quality": {
        "executive_summary": (
            "This analysis found {{ findings_count }} data quality issues with an average "
            "pass rate of {{ avg_pass_rate:.0f }}%. {{ total_affected:, }} records require attention. "
            "Significant remediation effort is needed before SAP migration or major changes."
        ),
        "top_3_risks": [
            {"text": "Low data quality", "detail": "Average pass rate of {{ avg_pass_rate:.0f }}% indicates systemic issues"},
            {"text": "High remediation effort", "detail": "{{ findings_count }} findings across all dimensions"},
            {"text": "Migration risk", "detail": "Significant cleanup required before go-live"},
        ],
        "top_3_wins": [
            {"text": "Visibility achieved", "detail": "Full picture of quality gaps enables targeted fixes"},
        ],
        "recommended_next_actions": [
            {"action": "Begin immediate remediation", "detail": "Prioritize by impact and effort"},
            {"action": "Cleanse source data", "detail": "Fix upstream systems feeding SAP"},
            {"action": "Re-run analysis", "detail": "Validate improvements after fixes"},
        ],
    },
    
    "moderate_issues": {
        "executive_summary": (
            "This analysis found {{ findings_count }} moderate data quality issues "
            "affecting {{ total_affected:, }} records across {{ module_count }} modules. "
            "Most issues can be resolved through routine stewardship work."
        ),
        "top_3_risks": [
            {"text": "Moderate quality gap", "detail": "{{ findings_count }} findings with average {{ avg_pass_rate:.0f }}% pass rate"},
            {"text": "Stewardship needed", "detail": "Regular data stewardship effort required"},
            {"text": "Monitor closely", "detail": "Quality may degrade without ongoing attention"},
        ],
        "top_3_wins": [
            {"text": "No critical blockers", "detail": "System is functional with moderate issues"},
            {"text": "Fixable through stewardship", "detail": "Regular processes can address most findings"},
        ],
        "recommended_next_actions": [
            {"action": "Assign to stewards", "detail": "Distribute findings across data stewardship team"},
            {"action": "Schedule cleanup", "detail": "Plan weekly remediation cycles"},
            {"action": "Monitor progress", "detail": "Track fix rate through stewardship workbench"},
        ],
    },
}


def _render_template(template_key: str, context: dict) -> str:
    """Render a template with the given context."""
    template_str = TEMPLATES.get(template_key, TEMPLATES["moderate_issues"])
    exec_summary = template_str["executive_summary"]
    
    try:
        tmpl = Template(exec_summary)
        return tmpl.render(**context)
    except Exception:
        return exec_summary.format(**context)


def _select_top_risks(findings: list[dict], limit: int = 3) -> list[dict]:
    """Select and format the top N risks from findings."""
    # Sort by severity then by affected count
    sorted_findings = sorted(
        findings,
        key=lambda f: (
            SEVERITY_ORDER.get(f.get("severity", "low"), 9),
            -f.get("affected_count", 0)
        )
    )
    
    risks = []
    for f in sorted_findings[:limit]:
        risks.append({
            "text": f"{f.get('module', 'Unknown')}: {f.get('affected_count', 0):,} records affected",
            "detail": f"{DIMENSION_LABELS.get(f.get('dimension', ''), f.get('dimension', ''))} issues with {f.get('severity', 'medium')} severity",
        })
    
    return risks


def _select_top_wins(findings: list[dict], modules: list[str]) -> list[dict]:
    """Select and format top wins based on what's passing."""
    wins = []
    
    # Count passing checks
    passing = [f for f in findings if f.get("pass_rate", 0) >= 95]
    if len(passing) > 5:
        wins.append({
            "text": f"{len(passing)} checks at 95%+",
            "detail": "Strong performance in these dimensions",
        })
    
    # Check for clean modules
    if modules:
        failing_modules = {f.get("module") for f in findings}
        clean_modules = [m for m in modules if m not in failing_modules]
        if clean_modules:
            wins.append({
                "text": f"{len(clean_modules)} clean module(s)",
                "detail": f"{', '.join(clean_modules[:3])} have no findings",
            })
    
    # General wins
    if not wins:
        wins.append({
            "text": "Analysis complete",
            "detail": "Full data quality assessment available",
        })
    
    return wins[:3]


def _build_recommendations(findings: list[dict], root_causes: list[dict]) -> list[dict]:
    """Build recommended next actions based on findings and root causes."""
    recommendations = []
    
    # Count by severity
    critical = sum(1 for f in findings if f.get("severity") == "critical")
    high = sum(1 for f in findings if f.get("severity") == "high")
    
    if critical > 0:
        recommendations.append({
            "action": "Escalate critical findings",
            "detail": f"{critical} critical issue(s) require immediate attention",
        })
    
    if high > 0:
        recommendations.append({
            "action": "Prioritize high-severity issues",
            "detail": f"{high} high-severity finding(s) should be resolved before go-live",
        })
    
    # Check for specific dimensions
    dimensions = {f.get("dimension") for f in findings}
    if "completeness" in dimensions:
        recommendations.append({
            "action": "Address data gaps",
            "detail": "Completeness issues require data entry or integration fixes",
        })
    
    if "accuracy" in dimensions:
        recommendations.append({
            "action": "Validate source data",
            "detail": "Accuracy issues may indicate upstream system problems",
        })
    
    if not recommendations:
        recommendations.append({
            "action": "Assign to stewards",
            "detail": "Distribute findings to data stewardship team",
        })
    
    return recommendations[:4]


def _compute_key_metrics(findings: list[dict], dqs_scores: dict) -> dict:
    """Compute key metrics for the narrative."""
    total_affected = sum(f.get("affected_count", 0) for f in findings)
    total_records = sum(f.get("total_count", 0) for f in findings) or 1
    
    avg_pass_rate = sum(f.get("pass_rate", 0) for f in findings) / len(findings) if findings else 100
    
    modules_affected = len({f.get("module") for f in findings})
    
    return {
        "total_findings": len(findings),
        "total_affected_records": total_affected,
        "avg_pass_rate": round(avg_pass_rate, 1),
        "modules_affected": modules_affected,
        "critical_count": sum(1 for f in findings if f.get("severity") == "critical"),
        "high_count": sum(1 for f in findings if f.get("severity") == "high"),
        "dqs_composite_avg": round(
            sum(scores.get("composite_score", 0) for scores in dqs_scores.values()) / len(dqs_scores) 
            if dqs_scores else 0,
            1
        ),
    }


# ---------------------------------------------------------------------------
# Main generate_narrative function
# ---------------------------------------------------------------------------

def generate_narrative(
    findings_summary: list[dict],
    root_causes: list[dict],
    dqs_scores: dict,
) -> Narrative:
    """Generate a deterministic narrative from findings summary.
    
    This function is the primary entry point for the narrator.
    It selects an appropriate template based on finding patterns
    and renders it with context from the analysis.
    
    Args:
        findings_summary: List of finding dicts
        root_causes: List of root cause dicts from analyst
        dqs_scores: Dict of module -> DQS scores
    
    Returns:
        Narrative object with executive summary, risks, wins, and recommendations
    """
    # Select template based on finding patterns
    template_key = _select_template(findings_summary)
    
    # Build context for template rendering
    modules = list({f.get("module", "unknown") for f in findings_summary})
    
    context = {
        "findings_count": len(findings_summary),
        "total_affected": sum(f.get("affected_count", 0) for f in findings_summary),
        "critical_count": sum(1 for f in findings_summary if f.get("severity") == "critical"),
        "critical_affected": sum(f.get("affected_count", 0) for f in findings_summary if f.get("severity") == "critical"),
        "high_count": sum(1 for f in findings_summary if f.get("severity") == "high"),
        "high_affected": sum(f.get("affected_count", 0) for f in findings_summary if f.get("severity") == "high"),
        "module_count": len(modules),
        "dimension_count": len({f.get("dimension") for f in findings_summary}),
        "avg_pass_rate": sum(f.get("pass_rate", 0) for f in findings_summary) / len(findings_summary) if findings_summary else 100,
        "total_records": sum(f.get("total_count", 0) for f in findings_summary) or 0,
        "process_impact": "Process failures expected if not resolved before go-live",
        "top_risk": {
            "module": findings_summary[0].get("module", "Unknown") if findings_summary else "Unknown",
            "count": findings_summary[0].get("affected_count", 0) if findings_summary else 0,
            "dimension": findings_summary[0].get("dimension", "unknown") if findings_summary else "unknown",
            "severity": findings_summary[0].get("severity", "medium") if findings_summary else "medium",
        } if findings_summary else {},
    }
    
    # Render executive summary
    template_obj = TEMPLATES[template_key]
    executive_summary = _render_template(template_key, context)
    
    # Build top risks and wins
    top_3_risks = _select_top_risks(findings_summary, limit=3)
    top_3_wins = _select_top_wins(findings_summary, modules)
    
    # Build recommendations
    recommended_next_actions = _build_recommendations(findings_summary, root_causes)
    
    # Compute key metrics
    key_metrics = _compute_key_metrics(findings_summary, dqs_scores)
    
    return Narrative(
        executive_summary=executive_summary,
        top_3_risks=top_3_risks,
        top_3_wins=top_3_wins,
        recommended_next_actions=recommended_next_actions,
        key_metrics=key_metrics,
    )


# ---------------------------------------------------------------------------
# LLM-enhanced narrative (optional, for modes hq and own)
# ---------------------------------------------------------------------------

async def generate_narrative_llm(
    findings_summary: list[dict],
    root_causes: list[dict],
    dqs_scores: dict,
    llm: Optional[Any] = None,
) -> Narrative:
    """Generate narrative using LLM for enhancement.
    
    First generates deterministic narrative, then uses LLM to
    enhance it with more specific, context-aware language.
    
    This is only called when mode is "hq" or "own".
    Falls back to deterministic if LLM is unavailable or times out.
    
    Args:
        findings_summary: List of finding dicts
        root_causes: List of root cause dicts
        dqs_scores: Dict of module -> DQS scores
        llm: Optional LangChain LLM instance
    
    Returns:
        Narrative object (LLM-enhanced or deterministic fallback)
    """
    from llm.provider import safe_ainvoke
    
    # Start with deterministic base
    narrative = generate_narrative(findings_summary, root_causes, dqs_scores)
    
    if llm is None:
        return narrative
    
    # Build prompt for LLM enhancement
    base_narrative_json = json.dumps(narrative.to_dict(), indent=2)
    
    enhancement_prompt = f"""Enhance this data quality narrative for the specific findings.
Make the executive summary more specific to the actual findings.
Keep risks and wins grounded in the actual data.

Current narrative (JSON):
{base_narrative_json}

Findings summary (for context only, do not include in response):
- Total findings: {len(findings_summary)}
- Critical: {sum(1 for f in findings_summary if f.get('severity') == 'critical')}
- High: {sum(1 for f in findings_summary if f.get('severity') == 'high')}
- Modules affected: {len({f.get('module') for f in findings_summary})}

Respond with ONLY valid JSON matching the narrative schema. No markdown, no explanation."""

    try:
        messages = [
            {"role": "system", "content": "You are a data quality executive summary specialist. Enhance narratives with specific, actionable language."},
            {"role": "user", "content": enhancement_prompt},
        ]
        
        content = await safe_ainvoke(llm, messages, timeout_seconds=45)
        
        if content:
            enhanced = json.loads(content.strip())
            return Narrative.from_dict(enhanced)
        
    except Exception as e:
        logger.warning(f"LLM enhancement failed, using deterministic: {e}")
    
    return narrative


# Type alias for the optional LLM
try:
    from typing import Any as LLMType
except ImportError:
    LLMType = Any  # type: ignore