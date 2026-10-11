"""Process discovery (spec docs/superpowers/specs/2026-10-11-process-discovery-design.md).

Event log builders, mining and L1-L5 generation. No LLM is called anywhere in this package.
"""

from __future__ import annotations

L1S: tuple[str, ...] = ("PTP", "OTC", "R2R", "PP", "PM", "QM", "PS", "WH", "HTR", "MDG", "SFX", "ARB", "CNQ")

# Spec §2.2: the first row per L1 is its primary case type (ARB: see the plan's gap list).
PRIMARY_CASE_TYPE: dict[str, str] = {
    "PTP": "po_item", "OTC": "so_item", "R2R": "fi_doc", "PP": "prod_order", "PM": "pm_order",
    "QM": "insp_lot", "PS": "wbs", "WH": "transfer_order", "HTR": "emp_event", "MDG": "change_request",
    "SFX": "requisition", "ARB": "requisition", "CNQ": "expense_report",
}

# Extraction module per L1 (sap/extraction_plan.py PROCESS_EVENT_MODULES / PROCESS_EVENT_CLOUD_MODULES).
MODULE_OF: dict[str, str] = {l1: f"process_events_{l1.lower()}" for l1 in L1S}

# Spec §8.2 / §1: the L1s a system type can discover.
L1S_BY_SYSTEM: dict[str, tuple[str, ...]] = {
    "ecc": L1S[:10], "s4hana_onprem": L1S[:10], "ewm": ("WH",),
    "successfactors": ("SFX",), "ariba": ("ARB",), "concur": ("CNQ",),
}


def primary_case_type(l1: str, system_type: str) -> str:
    """WH on EWM has warehouse tasks only, never transfer orders (spec §2.2, WH rows)."""
    if l1 == "WH" and system_type == "ewm":
        return "warehouse_task"
    return PRIMARY_CASE_TYPE[l1]
