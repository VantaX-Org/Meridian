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
# An internal extraction name: no licence tier lists it, so never check a licence against it (see licence_modules).
MODULE_OF: dict[str, str] = {l1: f"process_events_{l1.lower()}" for l1 in L1S}

# Registry keys that are internal extractions, not entitlements.
_NOT_LICENSABLE = frozenset({"process_discovery", "proven_cost", "interface_health"})
# Event tables the registry does not extract under their home DQ module (R2R reads BKPF/BSAS, PP reads AFKO,
# PM reads QMEL, WH reads LTAK, MDG reads USMD*), so the registry lookup alone misses the home module.
_DOMAIN_HOME: dict[str, str] = {"R2R": "fi_gl", "PP": "production_planning", "PM": "plant_maintenance",
                                "WH": "ewms_transfer_orders", "MDG": "mdg_master_data"}
# Tables shared by every L1 event log; they say nothing about which domain is being read.
_SHARED_TABLES = frozenset({"CDHDR", "CDPOS", "USR02", "T001W"})


def licence_modules(l1: str, system_type: str) -> tuple[str, ...]:
    """The DQ modules whose source tables ``l1``'s event log extracts, as licence tiers name them.

    A tenant needs at least one of them to run ``l1``. Derived from the extraction registry: cloud L1s from
    their source-module column, ABAP L1s from the event tables that some DQ module also extracts.
    """
    from sap.extraction_plan import PROCESS_EVENTS_DATA
    from sap.extraction_registry import _PROCESS_EVENT_CLOUD, SYSTEM_EXTRACTIONS

    key = MODULE_OF[l1]
    if key in _PROCESS_EVENT_CLOUD:
        return tuple(sorted({row[1] for row in _PROCESS_EVENT_CLOUD[key][1]}))
    tables = set(PROCESS_EVENTS_DATA.get(key, {})) - _SHARED_TABLES
    registry = SYSTEM_EXTRACTIONS.get("ewm" if system_type == "ewm" else "ecc", {})
    found = {m for m, targets in registry.items()
             if m not in _NOT_LICENSABLE and tables & {t.source for t in targets}}
    return tuple(sorted(found | ({_DOMAIN_HOME[l1]} if l1 in _DOMAIN_HOME else set())))

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


CLOUD_L1S: tuple[str, ...] = ("SFX", "ARB", "CNQ")
ABAP_SYSTEM_TYPES_WITH_EVENTS: tuple[str, ...] = ("ecc", "s4hana_onprem", "ewm")


def reason(l1: str, system_type: str) -> str | None:
    """Why ``l1`` has no mined flow on ``system_type``; None when the system type can discover it."""
    if l1 in L1S_BY_SYSTEM.get(system_type, ()):
        return None
    if system_type in ABAP_SYSTEM_TYPES_WITH_EVENTS and l1 in CLOUD_L1S:
        return "Connect the SuccessFactors / Ariba / Concur system to discover this process."
    if system_type in ("successfactors", "ariba", "concur") and l1 not in CLOUD_L1S:
        return "Discovered from an ABAP system."
    return "Event tables are not exposed by this connector; showing the reference model and configuration."
