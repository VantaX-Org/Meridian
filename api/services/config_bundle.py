"""Tenant configuration as one JSON bundle: export, and import with a dry-run diff (GET/POST /api/v1/admin/config-bundle).

The bundle carries what an administrator sets up by hand, never SAP data or findings:

  settings      tenants.dqs_weights, alert_thresholds, cost_model, retention
  rules         per rule (module, name): enabled, the one tenant-level override of a shipped rule
  mappings      per (module, standard_field): customer_field, customer_label, is_mapped, notes
  waves         per name: modules, target_date, stage, min_readiness, min_dqs and its gate
  sla_policies  per (severity, module): ack_minutes, resolve_minutes, at_risk_pct, business_hours
  escalation    the escalation chain levels

``diff`` compares the tenant's current bundle with an incoming one section by section: each item is ``add`` (new key),
``change`` (same key, other values) or ``same``. Import is additive: it adds and changes, it never deletes what the
incoming bundle leaves out (the diff counts those as ``kept``). Pure; the route reads and writes.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

FORMAT = "meridian.tenant-config"
VERSION = 1

KEYS: dict[str, Callable[[Mapping[str, Any]], str]] = {
    "settings": lambda _i: "tenant",
    "rules": lambda i: f"{i.get('module')}:{i.get('name')}",
    "mappings": lambda i: f"{i.get('module')}:{i.get('standard_field')}",
    "waves": lambda i: str(i.get("name")),
    "sla_policies": lambda i: f"{i.get('severity')}:{i.get('module') or '*'}",
    "escalation": lambda i: str(i.get("level")),
}
SECTIONS: tuple[str, ...] = tuple(KEYS)
_IGNORED = {"id", "updated_at", "created_at"}


def _items(section: str, value: Any) -> list[Mapping[str, Any]]:
    if section == "settings":
        return [value] if isinstance(value, Mapping) and value else []
    return [v for v in value if isinstance(v, Mapping)] if isinstance(value, list) else []


def _clean(item: Mapping[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if k not in _IGNORED}


def validate(bundle: Any) -> list[str]:
    """Why a bundle cannot be imported, as sentences; empty when it can."""
    if not isinstance(bundle, Mapping):
        return ["The file is not a configuration bundle."]
    errors = []
    if bundle.get("format") != FORMAT:
        errors.append(f"The format must be {FORMAT}.")
    if bundle.get("version") != VERSION:
        errors.append(f"Only version {VERSION} bundles can be imported.")
    sections = bundle.get("sections")
    if not isinstance(sections, Mapping):
        errors.append("The bundle has no sections.")
    else:
        unknown = sorted(set(sections) - set(SECTIONS))
        if unknown:
            errors.append(f"Unknown sections: {', '.join(unknown)}.")
    return errors


def diff(current: Mapping[str, Any], incoming: Mapping[str, Any]) -> dict[str, Any]:
    """{sections: {name: {add, change, same, kept, items: [{key, change, before, after}]}}, totals: {...}} for the
    sections the incoming bundle carries."""
    out: dict[str, Any] = {}
    totals = {"add": 0, "change": 0, "same": 0, "kept": 0}
    for section in SECTIONS:
        if section not in incoming:
            continue
        key = KEYS[section]
        have = {key(i): _clean(i) for i in _items(section, current.get(section))}
        items = []
        seen: set[str] = set()
        for raw in _items(section, incoming[section]):
            k, new = key(raw), _clean(raw)
            if k in seen:
                continue
            seen.add(k)
            old = have.get(k)
            if old is None:
                change = "add"
            elif section == "settings":
                change = "same" if all(old.get(f) == v for f, v in new.items()) else "change"
            else:
                change = "same" if {f: old.get(f) for f in new} == new else "change"
            items.append({"key": k, "change": change, "before": old, "after": new})
        counts = {c: sum(1 for i in items if i["change"] == c) for c in ("add", "change", "same")}
        counts["kept"] = sum(1 for k in have if k not in seen)
        for c, n in counts.items():
            totals[c] += n
        out[section] = {**counts, "items": items}
    return {"sections": out, "totals": totals}
