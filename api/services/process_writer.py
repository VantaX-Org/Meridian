"""Process Document Writer — enriches L1-L5 process hierarchy with DQ status.

Takes a module's findings, SPRO config baseline, and config impact results,
then produces a fully annotated process document showing field-level readiness.

Colour coding:
  green  — check passed (pass_rate >= 95%) or no findings
  amber  — check has warnings (pass_rate 70-95% or severity=medium)
  red    — check failed (pass_rate < 70% or severity=critical/high)

Overall L3 transaction readiness is the worst status from its child L4 steps.
Overall L4 step readiness is the worst status from its child L5 fields.
"""

import copy
import logging
from typing import Any

from sap.process_definitions import PROCESS_DEFINITIONS

logger = logging.getLogger("meridian.services.process_writer")

# Thresholds for DQ status classification
_PASS_RATE_GREEN = 0.95
_PASS_RATE_AMBER = 0.70

# Severity levels that force red regardless of pass_rate
_RED_SEVERITIES = {"critical", "high"}

# Status ordering for worst-of aggregation
_STATUS_RANK: dict[str, int] = {
    "green": 0,
    "amber": 1,
    "red": 2,
}


def generate_process_document(
    module: str,
    findings_by_check: dict[str, dict[str, Any]],
    spro_config: dict[str, Any],
    config_impact: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Generate an enriched process document for a given module.

    Parameters
    ----------
    module
        SAP module key (e.g. ``"accounts_payable"``).
    findings_by_check
        Dict mapping check_id to its finding summary dict.
        Expected keys per entry: ``severity``, ``pass_rate``,
        ``affected_count``, ``total_count``, ``message``.
    spro_config
        SPRO / baseline configuration data keyed by config table name.
        Used to annotate each field with its current config dependency.
    config_impact
        List of config impact result dicts (output of ``config_impact_node``).
        Each entry has ``check_id``, ``target_feature``, ``impact_type``, etc.

    Returns
    -------
    list[dict]
        List of enriched L1 process documents that reference the given module.
        Each document mirrors the L1-L5 hierarchy with added ``dq_status``,
        ``config_dependency``, and ``readiness`` annotations.
    """
    # Index config impact by check_id for fast lookup
    impact_index: dict[str, list[dict[str, Any]]] = {}
    for item in config_impact:
        cid = item.get("check_id", "")
        if cid:
            impact_index.setdefault(cid, []).append(item)

    enriched_processes: list[dict[str, Any]] = []

    for l1 in PROCESS_DEFINITIONS:
        # Only include processes that reference this module
        if module not in l1.get("modules", []):
            continue

        enriched_l1 = _enrich_l1(l1, findings_by_check, spro_config, impact_index)
        enriched_processes.append(enriched_l1)

    logger.info(
        "Generated %d process documents for module '%s'",
        len(enriched_processes),
        module,
    )
    return enriched_processes


def _enrich_l1(
    l1: dict[str, Any],
    findings_by_check: dict[str, dict[str, Any]],
    spro_config: dict[str, Any],
    impact_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Enrich an L1 process with DQ status at every level."""
    result = {
        "l1_id": l1["id"],
        "l1_name": l1["name"],
        "l1_description": l1.get("description", ""),
        "system": _module_to_system(l1.get("modules", [])),
        "l2_groups": [],
        "readiness": "green",
    }

    worst_l1 = "green"

    for l2 in l1.get("l2_processes", []):
        enriched_l2 = _enrich_l2(l2, findings_by_check, spro_config, impact_index)
        result["l2_groups"].append(enriched_l2)
        worst_l1 = _worst_status(worst_l1, enriched_l2.get("readiness", "green"))

    result["readiness"] = worst_l1
    return result


def _enrich_l2(
    l2: dict[str, Any],
    findings_by_check: dict[str, dict[str, Any]],
    spro_config: dict[str, Any],
    impact_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Enrich an L2 sub-process."""
    result = {
        "l2_id": l2["id"],
        "l2_name": l2["name"],
        "l3_processes": [],
        "readiness": "green",
    }

    worst_l2 = "green"

    for l3 in l2.get("l3_transactions", []):
        enriched_l3 = _enrich_l3(l3, findings_by_check, spro_config, impact_index)
        result["l3_processes"].append(enriched_l3)
        worst_l2 = _worst_status(worst_l2, enriched_l3.get("overall_readiness", "green"))

    result["readiness"] = worst_l2
    return result


def _enrich_l3(
    l3: dict[str, Any],
    findings_by_check: dict[str, dict[str, Any]],
    spro_config: dict[str, Any],
    impact_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Enrich an L3 transaction. Readiness = worst status from L4 steps."""
    result = {
        "l3_id": l3["id"],
        "l3_name": l3["name"],
        "tcode": l3.get("tcode", ""),
        "description": l3.get("description", ""),
        "l4_steps": [],
        "overall_readiness": "green",
    }

    worst_l3 = "green"

    for l4 in l3.get("l4_steps", []):
        enriched_l4 = _enrich_l4(l4, findings_by_check, spro_config, impact_index)
        result["l4_steps"].append(enriched_l4)
        worst_l3 = _worst_status(worst_l3, enriched_l4.get("step_status", "green"))

    result["overall_readiness"] = worst_l3
    return result


def _enrich_l4(
    l4: dict[str, Any],
    findings_by_check: dict[str, dict[str, Any]],
    spro_config: dict[str, Any],
    impact_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Enrich an L4 step. Readiness = worst status from L5 fields."""
    result = {
        "l4_id": l4["id"],
        "l4_name": l4["name"],
        "description": l4.get("description", ""),
        "config_dependency": None,
        "l5_fields": [],
        "step_status": "green",
    }

    worst_l4 = "green"

    for l5 in l4.get("l5_fields", []):
        enriched_l5 = _enrich_l5(l5, findings_by_check, spro_config, impact_index)
        result["l5_fields"].append(enriched_l5)
        worst_l4 = _worst_status(worst_l4, enriched_l5["dq_status"])

    result["step_status"] = worst_l4
    return result


def _enrich_l5(
    l5: dict[str, Any],
    findings_by_check: dict[str, dict[str, Any]],
    spro_config: dict[str, Any],
    impact_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """Enrich a single L5 field with DQ status and config dependency."""
    check_id = l5.get("check_id", "")
    config_source = l5.get("config_source", "")

    result: dict[str, Any] = {
        "field": l5.get("field", ""),
        "check_id": check_id,
        "description": l5.get("description", ""),
        "mandatory": l5.get("mandatory", False),
        "config_source": config_source,
        "dq_status": "green",
        "pass_rate": None,
        "affected_count": 0,
        "finding_message": "",
        "config_dependency": None,
    }

    # --- DQ status from findings ---
    finding = findings_by_check.get(check_id)
    if finding:
        result["dq_status"] = _classify_finding(finding)
        result["pass_rate"] = finding.get("pass_rate")
        result["affected_count"] = finding.get("affected_count", 0)
        result["finding_message"] = finding.get("message", "")

    # --- Config dependency from SPRO baseline ---
    if config_source and spro_config:
        # config_source may be a table name like "T052" or a compound like
        # "T077Y (field status)".  Extract the table name portion.
        table_name = config_source.split("(")[0].strip().split("/")[0].strip()
        config_data = spro_config.get(table_name)
        if config_data is not None:
            result["config_dependency"] = {
                "config_table": table_name,
                "description": f"Governed by SPRO table {table_name}",
                "has_config": True,
                "config_record_count": len(config_data) if isinstance(config_data, list) else 1,
            }
        else:
            result["config_dependency"] = {
                "config_table": table_name,
                "description": f"No SPRO baseline found for {table_name}",
                "has_config": False,
                "config_record_count": 0,
            }

    return result


def _module_to_system(modules: list[str]) -> str:
    """Map module list to the primary SAP system type."""
    SF_MODULES = {
        "employee_central", "compensation", "benefits", "payroll_integration",
        "performance_goals", "succession_planning", "recruiting_onboarding",
        "learning_management", "time_attendance",
    }
    EWMS_MODULES = {
        "ewms_stock", "ewms_transfer_orders", "batch_management",
        "mdg_master_data", "grc_compliance", "fleet_management",
        "transport_management", "wm_interface", "cross_system_integration",
    }
    for m in modules:
        if m in SF_MODULES:
            return "SuccessFactors"
        if m in EWMS_MODULES:
            return "eWMS"
    return "ECC"


def _classify_finding(finding: dict[str, Any]) -> str:
    """Classify a finding into green / amber / red based on pass_rate and severity.

    Rules:
      - severity critical or high -> red (regardless of pass_rate)
      - pass_rate < 70% -> red
      - pass_rate 70-95% or severity medium -> amber
      - pass_rate >= 95% and severity low/info -> green
    """
    severity = (finding.get("severity") or "").lower()
    pass_rate = finding.get("pass_rate")

    # Severity override
    if severity in _RED_SEVERITIES:
        return "red"

    # Pass-rate based
    if pass_rate is not None:
        if pass_rate < _PASS_RATE_AMBER:
            return "red"
        if pass_rate < _PASS_RATE_GREEN:
            return "amber"
        return "green"

    # If severity is medium but no pass_rate, treat as amber
    if severity == "medium":
        return "amber"

    return "green"


def _worst_status(current: str, incoming: str) -> str:
    """Return the more severe of two statuses."""
    if _STATUS_RANK.get(incoming, 0) > _STATUS_RANK.get(current, 0):
        return incoming
    return current
