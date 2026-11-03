"""Real-time data-quality firewall: candidate records in, which enabled rules fail out, nothing stored.

An external system (an SAP BAdI, middleware, a CI job) posts up to MAX_RECORDS candidate records of one module, each a
flat ``TABLE.FIELD: value`` object. Every record is judged on its own by the same engine a run uses
(checks/runner.py run_checks, the tenant's rule governance applied as in api/services/change_requests.py), so no check
logic lives here. Block policy: a record is blocked when any rule of severity ``critical`` fails; the call is blocked
when any record is. CPU only and deterministic: no database, no language model; the route writes the audit row and
never the record values.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional

import pandas as pd

from checks.runner import CATEGORIES, RULES_DIR, is_overlay, module_rules, rule_columns, run_checks

MAX_RECORDS = 100
BLOCK_SEVERITY = "critical"  # the severity vocabulary of the rules: critical, high, medium, low
_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


class FirewallError(Exception):
    """A request the firewall refuses (422): the message is safe to show the caller."""


@lru_cache(maxsize=1)
def modules() -> tuple[str, ...]:
    """Modules with a rule pack that judges records of their own (overlays only re-judge other modules' tables)."""
    names = {p.stem for c in CATEGORIES for p in (RULES_DIR / c).glob("*.yaml")
             if not p.stem.endswith(".generated") and p.stem != "column_map"}
    return tuple(sorted(n for n in names if not is_overlay(n)))


@lru_cache(maxsize=64)
def module_fields(module: str) -> frozenset[str]:
    """Every TABLE.FIELD a rule of the module reads, enabled or not."""
    out: set[str] = set()
    for r in module_rules(module):
        try:
            out.update(c.upper() for c in rule_columns(r))
        except Exception:  # noqa: BLE001 - a rule that names no readable column adds no field
            continue
    return frozenset(out)


def _clean(module: str, records: list[dict[str, Any]]) -> list[dict[str, str]]:
    if module not in modules():
        raise FirewallError(f"Unknown module {module[:60]!r}.")
    if not records:
        raise FirewallError("Send at least one record.")
    if len(records) > MAX_RECORDS:
        raise FirewallError(f"At most {MAX_RECORDS} records per call.")
    known = module_fields(module)
    out: list[dict[str, str]] = []
    for i, rec in enumerate(records):
        if not isinstance(rec, dict) or not rec:
            raise FirewallError(f"Record {i}: send an object of TABLE.FIELD values.")
        unknown = [k for k in rec if str(k).strip().upper() not in known]
        if unknown:
            raise FirewallError(
                f"Record {i}: not a field of any {module} rule: {', '.join(str(k)[:60] for k in unknown[:10])}.")
        row: dict[str, str] = {}
        for k, v in rec.items():
            if v is not None and not isinstance(v, (str, int, float, bool)):
                raise FirewallError(f"Record {i}: {str(k)[:60]}: give a single value.")
            row[str(k).strip().upper()] = "" if v is None else str(v)
        out.append(row)
    return out


def validate(tid: str, module: str, records: list[dict[str, Any]], overrides: Optional[dict] = None,
             extra_rules: Optional[list[dict]] = None) -> dict[str, Any]:
    """{verdict, block_severity, module, rules_run, records: [{index, verdict, failures: [{rule_id, description, field,
    severity, dimension, reason}]}]}. Raises FirewallError for a request it refuses."""
    rows = _clean(module, records)
    desc = {r.get("id"): (r.get("message") or "") for r in module_rules(module)}
    desc.update({r.get("id"): (r.get("message") or "") for r in (extra_rules or []) if r.get("module") == module})
    out, rules_run = [], 0
    for i, row in enumerate(rows):
        # ponytail: one run_checks per record, about 0.09s each, so 100 records is about 9s; batch one frame with key attribution if that is too slow
        results = run_checks(module, pd.DataFrame([row]), tid, overrides=overrides, extra_rules=extra_rules)
        rules_run = max(rules_run, len(results))
        fails = [{"rule_id": r.check_id, "description": desc.get(r.check_id) or r.message, "field": r.field,
                  "severity": r.severity, "dimension": r.dimension, "reason": (r.message or "")[:300]}
                 for r in results if not r.passed and not r.error and r.affected_count]
        fails.sort(key=lambda f: (_ORDER.get(f["severity"], 9), f["rule_id"]))
        out.append({"index": i, "verdict": "block" if any(f["severity"] == BLOCK_SEVERITY for f in fails) else "pass",
                    "failures": fails})
    return {"verdict": "block" if any(r["verdict"] == "block" for r in out) else "pass",
            "block_severity": BLOCK_SEVERITY, "module": module, "rules_run": rules_run, "records": out}
