"""Z-table (customer-namespace) rule support.

SAP reserves the Y* and Z* prefixes for customer-specific customisations —
tables, fields, and configuration that don't ship with SAP standard.
Meridian's standard rules (checks/rules/ecc, successfactors, warehouse)
target SAP-delivered tables; this module adds a parallel rule channel
for customer customisations so tenants with heavy Z-usage see validation
over the actual shape of their data, not just the standard shape.

Shipped Z-rules go in `checks/rules/ztables/` as normal YAML files.
Tenant-specific Z-rules (one customer may have ZMATNR fields that another
doesn't) can live in `checks/rules/ztables/tenant/<tenant_id>.yaml` and
are loaded only when the analysis runs for that tenant.

At analysis time the worker calls discover_ztable_rules(tenant_id),
which returns all common + tenant-scoped rules. Rules whose fields
aren't in the extract skip silently via the existing runner semantics.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger("meridian.checks.ztables")

# SAP customer-namespace detection. Standard objects never start with Y/Z;
# customer objects always do. Applies to both table names and field names
# within standard tables (e.g. MARA.ZZ_CUSTOM_FIELD).
_CUSTOMER_NS_RE = re.compile(r"^[YZ][A-Z0-9_]*$")


def is_customer_namespace(name: str) -> bool:
    """True if `name` (a table name, field name, or TABLE.FIELD pair)
    contains any component in the SAP customer namespace (Y* or Z*).

    Examples:
      is_customer_namespace("MARA.MATNR")     → False
      is_customer_namespace("ZMARA.MATNR")    → True (Z-table)
      is_customer_namespace("MARA.ZZ_CUSTOM") → True (Z-field on standard table)
      is_customer_namespace("YSALES")         → True (Y-table)
    """
    if not name:
        return False
    for part in name.split("."):
        if _CUSTOMER_NS_RE.match(part):
            return True
    return False


def _load_rules_from(path: Path, namespace_default: str = "customer") -> list[dict]:
    """Safely parse one YAML rule file; returns [] on any error."""
    try:
        cfg = yaml.safe_load(path.read_text()) or {}
    except Exception as e:
        logger.warning(f"ztable rules: failed to parse {path.name}: {e}")
        return []

    module_name = cfg.get("module", path.stem)
    rules: list[dict] = []
    for rule in cfg.get("rules", []) or []:
        rule = dict(rule)
        rule.setdefault("module", module_name)
        rule.setdefault("namespace", namespace_default)
        # Optional sanity: if the rule's field isn't in the customer
        # namespace, log a warning — Z-rules should be over Z-fields.
        field = rule.get("field") or ""
        if field and not is_customer_namespace(field):
            logger.warning(
                f"ztable rule {rule.get('id')}: field '{field}' is NOT in "
                f"customer namespace — move to the standard rules pack"
            )
        rules.append(rule)
    return rules


def discover_ztable_rules(tenant_id: Optional[str] = None) -> list[dict]:
    """Return all Z-table rules applicable to this analysis.

    Loading order:
      1. Every yaml in checks/rules/ztables/*.yaml (common to all tenants)
      2. If tenant_id is provided, add checks/rules/ztables/tenant/<tenant_id>.yaml
         if it exists — tenant-specific customisations

    Rules whose fields aren't in the extract skip silently via the runner;
    this function just returns the full rule list.
    """
    base = Path(__file__).parent / "rules" / "ztables"
    if not base.exists():
        return []

    rules: list[dict] = []
    # Common pack: every top-level yaml (not inside tenant/)
    for yaml_path in sorted(base.glob("*.yaml")):
        rules.extend(_load_rules_from(yaml_path))

    # Tenant-specific pack
    if tenant_id:
        tenant_path = base / "tenant" / f"{tenant_id}.yaml"
        if tenant_path.exists():
            rules.extend(_load_rules_from(tenant_path))
            logger.info(
                f"ztable rules: loaded {len(rules)} total incl. tenant "
                f"pack for {tenant_id}"
            )

    return rules
