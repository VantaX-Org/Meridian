"""Data catalogue: every SAP table and field Meridian knows, with the facts other services already hold.

Nothing here is a second source. A field's description and type come from the SAP dictionary (``sap.ddic``: the
DDIC bundle, the S/4 delta, the canonical schemas, a system's live DDIC through
``api.services.source_design.dictionary_for``) with the functional help of ``sap.data_dictionary``; the rules that
check it from the shipped YAML (``tenant_seed.raw_rules`` read with ``checks.runner.rule_columns``); its lineage from
``api.services.lineage``. The tenant's facts (systems, profiles, glossary terms, owners, rule state) are read by
``api/routes/catalogue.py``, which passes them in. Pure functions and process-wide caches only.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable, Optional

from sap.ddic import Dictionary, Table, get_dictionary

# The lineage node types worth naming beside a field: what its value flows into. Rules are listed on their own.
DOWNSTREAM_TYPES = ("object", "step", "process", "feature", "kpi")
DOWNSTREAM_LIMIT = 30
LINEAGE_DEPTH = 6


@dataclass(frozen=True)
class RuleRef:
    check_id: str
    module: str
    severity: str
    dimension: Optional[str]
    check_class: Optional[str]
    enabled: bool
    message: str


@dataclass(frozen=True)
class RuleIndex:
    by_field: dict[tuple[str, str], tuple[RuleRef, ...]]
    objects_by_table: dict[str, tuple[str, ...]]
    rules_by_table: dict[str, int]


def base_dictionary() -> Dictionary:
    """The dictionary used when no system is named: S/4HANA (ECC plus the cited S/4 delta) and the canonical views,
    the same default ``source_design.dictionary_for`` uses."""
    return get_dictionary("s4hana")


@lru_cache(maxsize=1)
def rule_index() -> RuleIndex:
    """Which shipped rules read which ``TABLE.FIELD`` (the columns the check engine reads for each rule)."""
    from api.services.tenant_seed import raw_rules
    from checks.runner import rule_columns, target_columns

    by_field: dict[tuple[str, str], dict[tuple[str, str], RuleRef]] = defaultdict(dict)
    objects: dict[str, set[str]] = defaultdict(set)
    per_table: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for _category, _file, module, rule in raw_rules():
        try:
            cols = rule_columns(rule) + target_columns(rule)
        except (KeyError, TypeError, ValueError):
            continue  # a malformed rule reads nothing the catalogue can name
        ref = RuleRef(check_id=str(rule["id"]), module=module, severity=str(rule.get("severity") or "medium"),
                      dimension=rule.get("dimension"), check_class=rule.get("check_class"),
                      enabled=bool(rule.get("enabled", True)), message=str(rule.get("message") or rule["id"]))
        for col in cols:
            if not isinstance(col, str) or "." not in col:
                continue
            table, field = (p.upper() for p in col.split(".", 1))
            by_field[(table, field)][(ref.check_id, module)] = ref
            objects[table].add(module)
            per_table[table].add((ref.check_id, module))
    return RuleIndex(
        by_field={k: tuple(sorted(v.values(), key=lambda r: (r.check_id, r.module))) for k, v in by_field.items()},
        objects_by_table={t: tuple(sorted(m)) for t, m in objects.items()},
        rules_by_table={t: len(r) for t, r in per_table.items()},
    )


@lru_cache(maxsize=1)
def lineage_graph():
    """The lineage graph is built from static files only, so one build serves the process."""
    from api.services import lineage as svc

    return svc.graph()


def downstream(table: str, field: str) -> tuple[Optional[str], list[dict]]:
    """The lineage node of ``TABLE.FIELD`` and the objects, steps, processes, features and KPIs it flows into, nearest
    first. ``(None, [])`` when the lineage model does not draw the field."""
    from api.services import lineage as svc

    g = lineage_graph()
    node = f"field:{table}.{field}"
    if node not in g.nodes:
        return None, []
    hops, _parent, _edges = svc.traverse(g, node, "down", LINEAGE_DEPTH)
    out = [{"id": n, "type": g.nodes[n]["type"], "label": g.nodes[n]["label"], "hops": h}
           for n, h in hops.items() if n != node and g.nodes[n]["type"] in DOWNSTREAM_TYPES]
    out.sort(key=lambda r: (r["hops"], DOWNSTREAM_TYPES.index(r["type"]), r["label"]))
    return node, out[:DOWNSTREAM_LIMIT]


def table_systems(table: str, objects: Iterable[str], module_systems: dict[str, set[str]],
                  profiled: dict[str, set[str]], snapshot: dict[str, set[str]]) -> list[str]:
    """The tenant's systems that use a table: an enabled object of the system reads it, an analysed run of the system
    profiled it, or the system's latest DDIC snapshot holds it."""
    found: set[str] = set(profiled.get(table, ())) | set(snapshot.get(table, ()))
    for module in objects:
        found |= module_systems.get(module, set())
    return sorted(found)


def matches(needle: str, *hay: Optional[str]) -> bool:
    return any(needle in (h or "").lower() for h in hay)


def table_rank(name: str, needle: str) -> int:
    """0 for the exact name, 1 for a name that starts with the words, 2 for any other hit."""
    n = name.lower()
    return 0 if n == needle else 1 if n.startswith(needle) else 2


def field_names(table: str, field: str) -> tuple[str, str, str]:
    """A field's name, ``TABLE.FIELD`` as the API writes it and ``TABLE-FIELD`` as the screens show it, lower case."""
    return field.lower(), f"{table}.{field}".lower(), f"{table}-{field}".lower()


def field_rank(table: str, field: str, needle: str) -> int:
    names = field_names(table, field)
    return 0 if needle in names else 1 if any(n.startswith(needle) for n in names) else 2


def help_of(table: str, field: str) -> dict:
    """The functional help ``sap.data_dictionary`` keeps for a field: help text, mandatory, processes, tcodes."""
    from sap.data_dictionary import get_field_metadata

    meta = get_field_metadata(table, field) or {}
    return {"help": meta.get("sap_help") or None, "mandatory": meta.get("mandatory"),
            "processes": list(meta.get("processes") or []), "tcodes": list(meta.get("tcodes") or [])}


def source_of(t: Table) -> str:
    """Where a table's definition comes from: ``sap_standard``, ``live`` or ``canonical:<system>``."""
    return t.provenance

