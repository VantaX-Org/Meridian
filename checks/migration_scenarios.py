"""Which rules matter for which S/4HANA transition path. Static, deterministic, no prompt.

Inputs are fields already in the rule YAML: ``rule_authority``, ``s4_impact`` and ``s4_area``.
The area table below is a judgement call grounded in SAP's published transition approach
(conversion pre-checks and the Simplification List for a system conversion, the migration cockpit
for a new implementation, selective copy of chosen objects and organisational units, and a company
code subset extract for a carve-out). It cites no SAP note numbers. Change it here, in review.

Relevance per rule and scenario, first match wins:
  1. ``rule_authority: s4hana_migration`` or ``s4_impact: blocking`` -> required for conversion and selective.
  2. ``rule_authority: sap_hard_constraint`` -> required in every scenario (loading fails in all of them).
  3. the rule's ``s4_area`` row in AREAS.
  4. no s4 metadata -> recommended.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Iterable, Optional

REQUIRED, RECOMMENDED, NOT_APPLICABLE = "required", "recommended", "not_applicable"
RELEVANCES = (REQUIRED, RECOMMENDED, NOT_APPLICABLE)

#: id -> description shown beside the name in the UI and returned by the API.
SCENARIOS: dict[str, str] = {
    "new_implementation": "Greenfield: a fresh S/4HANA system loaded through the migration cockpit, with no history carried over.",
    "system_conversion": "Brownfield: the existing ECC system is converted in place and must pass the conversion pre-checks.",
    "selective_transition": "Chosen objects and organisational units are copied into S/4HANA while the rest stays behind.",
    "carve_out": "One company code or business unit is extracted into its own S/4HANA system.",
}
_ORDER = tuple(SCENARIOS)

_R, _C, _N = REQUIRED, RECOMMENDED, NOT_APPLICABLE

#: s4_area -> (one-sentence rationale, (new_implementation, system_conversion, selective_transition, carve_out)).
AREAS: dict[str, tuple[str, tuple[str, str, str, str]]] = {
    "credit_management": ("SD credit management is replaced by FSCM credit management, so credit data must be clean before it is carried or rebuilt.", (_C, _R, _C, _C)),
    "business_partner": ("Customers and vendors become business partners in every path, so customer-vendor integration data must be consistent.", (_R, _R, _R, _R)),
    "purchasing": ("Purchasing data is simplified in S/4HANA, and open documents depend on the selected master data.", (_C, _C, _R, _C)),
    "archiving": ("Archiving shrinks the volume to convert or extract, but a fresh load carries no history to archive.", (_N, _C, _C, _C)),
    "foreign_trade": ("SD foreign trade is not carried into S/4HANA, so its data needs a decision before conversion.", (_C, _R, _C, _C)),
    "output_management": ("Output determination moves to the new output management, which a conversion must account for.", (_C, _R, _C, _N)),
    "sales": ("Open sales documents and customer-material data are loaded or copied, so their fields must be valid.", (_R, _C, _R, _C)),
    "material_ledger": ("The material ledger is mandatory in S/4HANA, so valuation data must be complete before conversion.", (_C, _R, _R, _C)),
    "material": ("The material number length and material master structure change, and material data is moved in every path.", (_R, _R, _R, _R)),
    "mrp": ("Planning data is reviewed for the S/4HANA MRP simplifications during a conversion.", (_C, _R, _C, _C)),
    "finance": ("General ledger, accounts and the universal journal are loaded or converted in every path.", (_R, _R, _R, _R)),
    "warehouse_ewm": ("Warehouse management moves to embedded EWM, which a conversion must plan for.", (_C, _R, _C, _C)),
    "warehouse": ("Warehouse data is migrated alongside stock but rarely blocks a path on its own.", (_C, _C, _C, _C)),
    "hcm": ("HCM is not part of the S/4HANA core, so employee data needs a deployment decision in a conversion.", (_C, _R, _C, _C)),
    "plant_maintenance": ("Equipment and functional locations are loaded or copied for the chosen plants.", (_R, _C, _R, _C)),
    "asset_accounting": ("New asset accounting is mandatory, and fixed assets are migrated in every path.", (_R, _R, _R, _R)),
    "production": ("Production data is converted with the plants, and open orders are usually not migrated.", (_C, _C, _C, _C)),
    "batch_serial": ("Batch and serial number data is loaded for the chosen materials and changes in a conversion.", (_R, _C, _R, _C)),
    "organisational": ("Organisational units must exist and be consistent first, and they dominate a carve-out or selective scope.", (_R, _C, _R, _R)),
    "controlling": ("Controlling is integrated into the universal journal, so cost objects and cost elements are checked before moving.", (_C, _R, _R, _R)),
    "treasury": ("Treasury and cash management change in S/4HANA, which a conversion must review.", (_C, _R, _C, _C)),
    "revenue_recognition": ("Revenue accounting replaces the older revenue recognition, which a conversion must plan for.", (_C, _R, _C, _C)),
}

_FORCED = {
    "system_conversion": "Flagged as a migration blocker, so the conversion pre-checks fail until it is fixed.",
    "selective_transition": "Flagged as a migration blocker, so the copied objects fail to load until it is fixed.",
}
_HARD = "SAP rejects the record at load time, so loading fails in every scenario."
_DEFAULT = "No S/4HANA-specific impact is recorded for this rule, so it is general data quality for the move."


def _impact(rule: dict) -> tuple[Optional[str], Optional[str]]:
    """(blocking|warning|None, free-text note). Any value outside the enum is a warning with the text kept."""
    v = rule.get("s4_impact")
    if not v:
        return None, None
    return (v, None) if v in ("blocking", "warning") else ("warning", str(v))


def classify(rule: dict) -> dict[str, tuple[str, str]]:
    """scenario -> (relevance, rationale) for one YAML rule."""
    area = rule.get("s4_area")
    row = AREAS.get(area) if area else None
    forced = rule.get("rule_authority") == "s4hana_migration" or rule.get("s4_impact") == "blocking"
    out = {}
    for i, sc in enumerate(_ORDER):
        if forced and sc in _FORCED:
            out[sc] = (REQUIRED, _FORCED[sc])
        elif rule.get("rule_authority") == "sap_hard_constraint":
            out[sc] = (REQUIRED, _HARD)
        elif row:
            out[sc] = (row[1][i], row[0])
        else:
            out[sc] = (RECOMMENDED, _DEFAULT)
    return out


def enabled_rules() -> Iterable[tuple[str, dict]]:
    """(module, rule) for every shipped rule that is not disabled."""
    from api.services.tenant_seed import raw_rules
    return ((module, r) for _, _, module, r in raw_rules() if r.get("enabled", True))


def summary(rules: Optional[Iterable[tuple[str, dict]]] = None) -> dict[str, Any]:
    """Per scenario: description, counts by relevance, blocking count, per-module counts."""
    acc = {sc: {"counts": Counter(), "blocking": 0, "modules": defaultdict(Counter)} for sc in SCENARIOS}
    for module, r in (enabled_rules() if rules is None else rules):
        blocking = _impact(r)[0] == "blocking"
        for sc, (rel, _) in classify(r).items():
            acc[sc]["counts"][rel] += 1
            acc[sc]["modules"][module][rel] += 1
            acc[sc]["blocking"] += blocking and rel != NOT_APPLICABLE
    return {sc: {"id": sc, "description": SCENARIOS[sc],
                 "counts": {k: a["counts"][k] for k in RELEVANCES}, "blocking": a["blocking"],
                 "modules": {m: {k: c[k] for k in RELEVANCES} for m, c in sorted(a["modules"].items())}}
            for sc, a in acc.items()}


def rule_list(scenario: str, relevance: Optional[str] = None) -> list[dict]:
    rows = []
    for module, r in enabled_rules():
        rel, why = classify(r)[scenario]
        if relevance and rel != relevance:
            continue
        impact, note = _impact(r)
        rows.append({"id": str(r["id"]), "module": module, "field": r.get("field"), "message": r.get("message"),
                     "s4_area": r.get("s4_area"), "s4_impact": impact, "impact_note": note,
                     "relevance": rel, "rationale": why})
    return rows
