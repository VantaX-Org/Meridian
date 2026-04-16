"""Deterministic Report Engine — generates a complete, actionable report
with zero LLM calls in <1 second.

This report is the primary deliverable. AI enrichment (executive summary,
root cause narratives) is added later in the background by the
``ai_enrich_report`` Celery task.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("meridian.services.deterministic_report")


# ---------------------------------------------------------------------------
# 1. Root Cause Clustering
# ---------------------------------------------------------------------------

def cluster_root_causes(findings: list[dict]) -> list[dict]:
    """Group findings into root cause clusters — pure Python.

    Clustering rules (no LLM):
    1. Same field prefix (e.g., all LFA1.* failures) = same master data object
    2. Same config_table reference = same SPRO misconfiguration
    """
    clusters: list[dict] = []
    seen_ids: set[str] = set()

    # Strategy A: Group by SAP table (field prefix before the dot)
    by_table: dict[str, list[dict]] = {}
    for f in findings:
        table = f.get("field", "").split(".")[0] if "." in f.get("field", "") else "UNKNOWN"
        by_table.setdefault(table, []).append(f)

    for table, group in by_table.items():
        if len(group) >= 2:
            total_affected = sum(f.get("affected_count", 0) for f in group)
            severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            worst_severity = min(
                group,
                key=lambda x: severity_order.get(x.get("severity", "low"), 9),
            )["severity"]
            cluster_id = f"RC_{table}"
            clusters.append({
                "cluster_id": cluster_id,
                "root_cause": f"Multiple data quality issues in {table} master data",
                "description": (
                    f"{len(group)} checks failed on the {table} table affecting "
                    f"up to {total_affected} records. This suggests systematic "
                    f"data entry or migration issues in this master data object."
                ),
                "severity": worst_severity,
                "finding_count": len(group),
                "total_affected_records": total_affected,
                "check_ids": [f["check_id"] for f in group],
                "remediation_approach": _table_remediation(table, group),
            })
            seen_ids.add(cluster_id)

    # Strategy B: Group by config table (findings that share a SPRO dependency)
    by_config: dict[str, list[dict]] = {}
    for f in findings:
        config_table = (f.get("rule_context") or {}).get("config_table", "")
        if config_table:
            by_config.setdefault(config_table, []).append(f)

    for config_table, group in by_config.items():
        cluster_id = f"RC_CFG_{config_table}"
        if len(group) >= 2 and cluster_id not in seen_ids:
            clusters.append({
                "cluster_id": cluster_id,
                "root_cause": f"SPRO configuration issue in {config_table}",
                "description": (
                    f"{len(group)} failures linked to config table {config_table}. "
                    f"Review customising entries — one config fix may resolve "
                    f"multiple data issues."
                ),
                "severity": "high",
                "finding_count": len(group),
                "check_ids": [f["check_id"] for f in group],
                "remediation_approach": f"Transaction SPRO — review {config_table} entries",
            })

    return clusters


_TABLE_REMEDIATION: dict[str, str] = {
    "LFA1": "Mass maintenance via transaction XK99 or LSMW for vendor master corrections",
    "KNA1": "Mass maintenance via transaction XD99 or LSMW for customer master corrections",
    "MARA": "Mass maintenance via transaction MM17 or LSMW for material master corrections",
    "MARC": "Plant-level data maintenance via MM02 per plant or LSMW batch",
    "MBEW": "Valuation data corrections via MR21 (price change) or LSMW",
    "BUT000": "Business Partner mass maintenance via BP transaction or MDG",
    "SKA1": "Chart of accounts maintenance via FS00/OB_GLACC01",
    "EKKO": "PO header corrections via ME22N or mass change ME_MASS",
    "ANLA": "Asset master corrections via AS02 or mass change",
    "EQUI": "Equipment master corrections via IE02 or IL02",
}


def _table_remediation(table: str, findings: list[dict]) -> str:
    return _TABLE_REMEDIATION.get(
        table,
        f"Review and correct {table} records via appropriate SAP transaction",
    )


# ---------------------------------------------------------------------------
# 2. Config vs Data Classification
# ---------------------------------------------------------------------------

def classify_config_vs_data(findings: list[dict]) -> list[dict]:
    """Classify each finding as data_error, config_deviation, or hybrid.

    Uses rule metadata already embedded in each finding — no LLM needed.
    """
    classified: list[dict] = []
    for f in findings:
        ctx = f.get("rule_context") or {}
        check_class = f.get("check_class", "")
        config_table = ctx.get("config_table", "")

        if config_table:
            if f.get("affected_count", 0) == f.get("total_count", 0) and f.get("total_count", 0) > 0:
                classification = "config_deviation"
                explanation = (
                    f"All records fail this check. This indicates a SPRO "
                    f"configuration issue in {config_table}, not a data entry problem."
                )
            else:
                classification = "hybrid"
                explanation = (
                    f"Some records fail against config in {config_table}. "
                    f"May be a mix of incorrect config values and bad data."
                )
        elif check_class == "domain_value_check" and f.get("pass_rate", 100) < 50:
            classification = "possible_config"
            explanation = (
                "Over 50% of records fail this domain check. "
                "The allowed values list may be incomplete in SPRO."
            )
        elif check_class in ("null_check", "regex_check"):
            classification = "data_error"
            explanation = "This is a data entry or migration issue. Records are missing or malformed."
        else:
            classification = "data_error"
            explanation = "Standard data quality issue."

        classified.append({
            **f,
            "classification": classification,
            "classification_explanation": explanation,
        })

    return classified


# ---------------------------------------------------------------------------
# 3. Remediation Priority & Effort Estimation
# ---------------------------------------------------------------------------

_SEVERITY_WEIGHT: dict[str, int] = {"critical": 10, "high": 5, "medium": 2, "low": 1}


def prioritise_remediations(findings: list[dict]) -> list[dict]:
    """Score and rank findings by remediation priority — pure arithmetic."""
    scored: list[dict] = []
    for f in findings:
        weight = _SEVERITY_WEIGHT.get(f.get("severity", "low"), 1)
        impact = f.get("affected_count", 0) * (100 - f.get("pass_rate", 0)) / 100
        priority_score = round(weight * impact, 1)

        scored.append({
            **f,
            "priority_score": priority_score,
            "effort_estimate": _estimate_effort(f),
            "fix_method": _determine_fix_method(f),
        })

    scored.sort(key=lambda x: x["priority_score"], reverse=True)

    for i, item in enumerate(scored):
        item["sequence"] = i + 1

    return scored


def _estimate_effort(finding: dict) -> dict:
    """Heuristic effort estimation — no LLM."""
    affected = finding.get("affected_count", 0)
    has_fix_map = bool(
        finding.get("value_fix_map")
        or (finding.get("rule_context") or {}).get("fix_map")
    )
    is_config = finding.get("classification") == "config_deviation"

    if is_config:
        return {"hours": 4, "type": "config_change", "method": "SPRO + transport + test"}
    elif has_fix_map:
        hours = round(0.5 + (affected * 0.001), 1)
        return {"hours": hours, "type": "automated", "method": "LSMW / mass update with deterministic fix map"}
    else:
        hours = round(2 + (affected * 0.01), 1)
        return {"hours": hours, "type": "manual", "method": "Manual review and correction per record"}


_FIX_METHODS: dict[str, str] = {
    "LFA1": "XK02 (single) / XK99 (mass) / LSMW recording on XK02",
    "LFB1": "FK02 (single) / LSMW recording on FK02",
    "KNA1": "XD02 (single) / XD99 (mass) / LSMW recording on XD02",
    "KNB1": "FD02 (single) / LSMW recording on FD02",
    "MARA": "MM02 (single) / MM17 (mass) / LSMW recording on MM02",
    "MARC": "MM02 plant view (single) / LSMW",
    "MBEW": "MR21 (price change) / LSMW",
    "BUT000": "BP (single) / BUPA_MASS (mass) / MDG change request",
    "SKA1": "FS00 (single) / OB_GLACC01 (mass)",
    "EKKO": "ME22N (single) / ME_MASS (mass update)",
    "ANLA": "AS02 (single) / LSMW recording on AS02",
    "EQUI": "IE02 (single) / IL02 (functional loc) / LSMW",
    "MAKT": "MM02 basic data (single) / MM17 (mass)",
    "MVKE": "MM02 sales view (single) / VD51 (conditions)",
}


def _determine_fix_method(finding: dict) -> str:
    field = finding.get("field", "")
    table = field.split(".")[0] if "." in field else ""
    return _FIX_METHODS.get(table, f"Correct via appropriate SAP transaction for {table}")


# ---------------------------------------------------------------------------
# 4. Cross-Finding Pattern Detection
# ---------------------------------------------------------------------------

def detect_cross_finding_patterns(findings: list[dict]) -> list[dict]:
    """Detect patterns across findings — pure Python."""
    patterns: list[dict] = []

    # Pattern 1: Completeness cascade
    null_findings = [f for f in findings if f.get("dimension") == "completeness"]
    by_table: dict[str, list[dict]] = {}
    for f in null_findings:
        table = f.get("field", "").split(".")[0] if "." in f.get("field", "") else "?"
        by_table.setdefault(table, []).append(f)
    for table, group in by_table.items():
        if len(group) >= 3:
            patterns.append({
                "pattern": "completeness_cascade",
                "title": f"{len(group)} mandatory fields missing in {table}",
                "description": (
                    f"Multiple required fields in {table} are blank. This typically "
                    f"indicates records were loaded via interface or migration "
                    f"without complete validation."
                ),
                "affected_checks": [f["check_id"] for f in group],
                "recommended_action": (
                    f"Review the data load/migration process for {table}. "
                    f"Consider adding validation to the inbound interface."
                ),
            })

    # Pattern 2: Zero pass rate fields
    zero_fields = [f for f in findings if f.get("pass_rate", 100) == 0]
    if len(zero_fields) >= 2:
        patterns.append({
            "pattern": "zero_pass_rate",
            "title": f"{len(zero_fields)} fields have 0% pass rate (completely empty or invalid)",
            "description": (
                "These fields appear to have never been maintained or were "
                "intentionally skipped during data loading."
            ),
            "affected_checks": [f["check_id"] for f in zero_fields],
            "recommended_action": (
                "Determine if these fields are required for business operations. "
                "If yes, plan a data enrichment exercise. If no, consider "
                "suppressing these checks."
            ),
        })

    # Pattern 3: Severity concentration in one module
    by_module: dict[str, list[dict]] = {}
    for f in findings:
        by_module.setdefault(f.get("module", "?"), []).append(f)
    for module, group in by_module.items():
        critical = [f for f in group if f.get("severity") == "critical"]
        if len(critical) >= 3:
            patterns.append({
                "pattern": "critical_concentration",
                "title": f"{len(critical)} critical findings in {module}",
                "description": (
                    f"Module {module} has a concentration of critical issues. "
                    f"Prioritise this module for remediation."
                ),
                "affected_checks": [f["check_id"] for f in critical],
                "recommended_action": (
                    f"Conduct a focused data cleansing sprint on {module} "
                    f"before addressing other modules."
                ),
            })

    return patterns


# ---------------------------------------------------------------------------
# 5. Readiness
# ---------------------------------------------------------------------------

def compute_readiness_status(composite_score: float, critical_count: int) -> str:
    """Determine go / no-go / conditional from DQS composite and critical count."""
    if critical_count > 0:
        return "no-go"
    if composite_score >= 90:
        return "go"
    if composite_score >= 70:
        return "conditional"
    return "no-go"


# ---------------------------------------------------------------------------
# 6. Report Assembly
# ---------------------------------------------------------------------------

def generate_deterministic_report(
    version_id: str,
    tenant_id: str,
    module_names: list[str],
    findings: list[dict],
    dqs_scores: dict[str, Any],
) -> dict[str, Any]:
    """Generate the complete report from check results — no LLM needed.

    Returns a report dict that can be stored directly in the reports table.
    This report is complete and actionable on its own.
    """
    # 1. Classify config vs data
    classified = classify_config_vs_data(findings)

    # 2. Prioritise remediations
    prioritised = prioritise_remediations(classified)

    # 3. Cluster root causes
    root_causes = cluster_root_causes(classified)

    # 4. Detect cross-finding patterns
    patterns = detect_cross_finding_patterns(classified)

    # 5. Compute readiness per module
    readiness_scores: dict[str, dict] = {}
    for module in module_names:
        mod_dqs = dqs_scores.get(module, {})
        composite = mod_dqs.get("composite_score", 0.0)
        critical_count = mod_dqs.get("critical_count", 0)
        status = compute_readiness_status(composite, critical_count)
        readiness_scores[module] = {
            "score": composite,
            "status": status,
            "blockers": [
                f["check_id"]
                for f in classified
                if f.get("module") == module and f.get("severity") == "critical"
            ],
        }

    # 6. Overall status
    overall_status = _compute_overall_status(readiness_scores)
    overall_score = _compute_overall_score(readiness_scores)

    # 7. Executive summary (deterministic template)
    executive_summary = _generate_deterministic_summary(
        module_names, dqs_scores, readiness_scores, len(findings), overall_status,
    )

    # 8. Assemble
    return {
        "report_id": str(uuid.uuid4()),
        "version_id": version_id,
        "tenant_id": tenant_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generation_method": "deterministic",
        "modules_analysed": module_names,
        "executive_summary": executive_summary,
        "ai_executive_summary": None,
        "overall_dqs": {
            "composite": overall_score,
            "by_module": {
                m: dqs_scores.get(m, {}).get("composite_score", 0)
                for m in module_names
            },
        },
        "findings_by_severity": _count_by_severity(findings),
        "findings_by_dimension": _count_by_dimension(findings),
        "modules": [
            {
                "name": mod,
                "dqs_score": dqs_scores.get(mod, {}).get("composite_score", 0),
                "readiness": readiness_scores.get(mod, {}),
                "findings": [f for f in prioritised if f.get("module") == mod],
                "config_deviations": [
                    f
                    for f in classified
                    if f.get("module") == mod
                    and f.get("classification") in ("config_deviation", "hybrid")
                ],
            }
            for mod in module_names
        ],
        "root_causes": root_causes,
        "cross_finding_patterns": patterns,
        "remediation_plan": {
            "priority_sequence": prioritised[:20],
            "total_effort_hours": sum(
                f.get("effort_estimate", {}).get("hours", 0) for f in prioritised
            ),
            "automated_fixes_available": len(
                [f for f in prioritised if f.get("effort_estimate", {}).get("type") == "automated"]
            ),
            "config_fixes_needed": len(
                [f for f in prioritised if f.get("classification") == "config_deviation"]
            ),
        },
        "migration_readiness": {
            "overall_status": overall_status,
            "overall_score": overall_score,
            "by_module": readiness_scores,
            "summary": _compute_migration_summary(overall_status, overall_score),
        },
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_overall_status(readiness_scores: dict[str, dict]) -> str:
    if not readiness_scores:
        return "no-go"
    statuses = [v.get("status", "no-go") for v in readiness_scores.values()]
    if all(s == "go" for s in statuses):
        return "go"
    if any(s == "no-go" for s in statuses):
        return "no-go"
    return "conditional"


def _compute_overall_score(readiness_scores: dict[str, dict]) -> float:
    if not readiness_scores:
        return 0.0
    scores = [v.get("score", 0.0) for v in readiness_scores.values()]
    return round(sum(scores) / len(scores), 1)


def _count_by_severity(findings: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        sev = f.get("severity", "low")
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def _count_by_dimension(findings: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in findings:
        dim = f.get("dimension", "unknown")
        counts[dim] = counts.get(dim, 0) + 1
    return counts


def _generate_deterministic_summary(
    modules: list[str],
    dqs_scores: dict,
    readiness: dict,
    finding_count: int,
    status: str,
) -> str:
    avg_score = (
        sum(dqs_scores.get(m, {}).get("composite_score", 0) for m in modules)
        / max(len(modules), 1)
    )
    critical_count = sum(
        dqs_scores.get(m, {}).get("critical_count", 0) for m in modules
    )

    if status == "go":
        return (
            f"Data quality assessment of {len(modules)} module(s) shows strong "
            f"readiness with an average DQS of {avg_score:.1f}%. All modules "
            f"pass migration thresholds. {finding_count} checks were evaluated "
            f"with no critical blockers."
        )
    elif status == "no-go":
        return (
            f"Data quality assessment of {len(modules)} module(s) identifies "
            f"significant gaps with an average DQS of {avg_score:.1f}%. "
            f"{critical_count} critical issue(s) must be resolved before "
            f"migration can proceed. See the remediation plan for priority actions."
        )
    else:
        return (
            f"Data quality assessment of {len(modules)} module(s) shows "
            f"conditional readiness at {avg_score:.1f}% average DQS. "
            f"{critical_count} critical finding(s) require attention. "
            f"The remediation plan sequences fixes by business impact."
        )


def _compute_migration_summary(overall_status: str, overall_score: float) -> str:
    if overall_status == "go":
        return (
            f"All modules meet migration readiness thresholds with an overall "
            f"score of {overall_score:.1f}%. Proceed with migration planning."
        )
    elif overall_status == "no-go":
        return (
            f"Critical data quality issues block migration readiness (overall "
            f"score: {overall_score:.1f}%). Address the remediation plan before "
            f"proceeding."
        )
    return (
        f"Conditional readiness at {overall_score:.1f}%. Some modules require "
        f"remediation before migration can proceed."
    )
