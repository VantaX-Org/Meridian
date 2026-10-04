"""Deviation of a system's live configuration from the SAP standard.

The SAP-standard value lists are the ones value-list rules fall back to when a
check table was not extracted live (``reference_values`` / ``allowed_values``),
keyed by the check table they stand for — resolved exactly as the runner does
(``_with_reference``). For every extracted live check table that has such a
list: the customer's own entries (live, not standard — Z-codes) and the
standard entries the system does not have.
"""

from __future__ import annotations

from functools import lru_cache

import yaml

from checks.runner import CATEGORIES, RULES_DIR, _with_reference
from sap.ddic import get_dictionary

_VALUE_LIST = {"referential_check": "reference_values", "domain_value_check": "allowed_values"}


@lru_cache(maxsize=1)
def standard_lists() -> dict[str, frozenset[str]]:
    """``TABLE.FIELD`` → the SAP-standard values the rules carry for it."""
    dictionary = get_dictionary("ecc6")
    out: dict[str, set[str]] = {}
    for category in CATEGORIES:
        for path in sorted((RULES_DIR / category).glob("*.yaml")):
            for rule in (yaml.safe_load(path.read_text()) or {}).get("rules") or []:
                values = rule.get(_VALUE_LIST.get(rule.get("check_class"), ""))
                # a list narrower than its check table by design is not the table's standard
                if not values or not rule.get("field") or rule.get("live_reference") is False:
                    continue
                key = _with_reference(rule, dictionary, {}).get("_reference_key")
                if key:
                    out.setdefault(key, set()).update(str(v).strip() for v in values)
    return {k: frozenset(v) for k, v in out.items()}


def deviation(snapshots: list[tuple[str, list[dict] | None]]) -> list[dict]:
    """Per live check table with a standard list: custom entries and missing standard entries."""
    live: dict[str, set[str]] = {}
    for table, rows in snapshots:
        for rec in rows or []:
            for col, val in rec.items():
                if val not in (None, ""):
                    live.setdefault(f"{table}.{col}", set()).add(str(val).strip())
    std = standard_lists()
    return [{"reference": k, "live_count": len(live[k]), "standard_count": len(std[k]),
             "custom": sorted(live[k] - std[k]), "missing": sorted(std[k] - live[k])}
            for k in sorted(set(live) & set(std))]
