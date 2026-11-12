"""Field-level SAP lineage of one object: table -> field -> check table -> owning object.

Deterministic, built from three repo sources only:

* the extraction registry (``sap/extraction_registry.py``) gives the tables the object
  extracts and the fields read from each; fields that a rule reads in those tables are
  added, so every field the product touches is listed;
* the SAP data dictionary (``sap/ddic.py``) gives each field's text, data element,
  domain, length and its foreign key (check table and check field). A field the
  dictionary does not know is listed with ``in_dictionary = False``, never guessed;
* the rule packs give the rules that read each field (``checks.runner.rule_columns``,
  the same reads the lineage graph uses).

The owner of a check table is the object that owns it as master data (the load-plan
table ownership first, then any object that extracts it as a non-configuration table);
with no owner it is ``configuration``. The check table's delivery class is returned as
evidence (A master data, C/G/E/S customizing).
"""

from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from typing import Iterable

from api.services.migration.load_plan import OWNED_TABLES
from sap.ddic import Dictionary
from sap.extraction_registry import SYSTEM_EXTRACTIONS, get_extraction_targets

CONFIGURATION = "configuration"
MAX_RULE_IDS = 25


@lru_cache(maxsize=1)
def _rule_index() -> dict[str, tuple[tuple[str, str], ...]]:
    """``TABLE.FIELD`` -> ((rule id, module), ...) for every enabled shipped rule."""
    from api.services.tenant_seed import raw_rules
    from checks.runner import rule_columns

    idx: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for _, _, module, rule in raw_rules():
        if rule.get("enabled", True) is False:
            continue
        try:
            cols = rule_columns(rule)
        except (KeyError, TypeError, ValueError):
            continue  # a malformed rule reads nothing we can name
        for c in cols:
            if "." in c:
                idx[c.upper()].append((str(rule["id"]), module))
    return {k: tuple(dict.fromkeys(v)) for k, v in idx.items()}


def table_owners(system_type: str) -> dict[str, str]:
    """Table -> object that owns it as master data on this system type."""
    owners: dict[str, str] = {}
    for module, targets in (SYSTEM_EXTRACTIONS.get(system_type) or {}).items():
        for t in targets:
            if not t.is_config:
                owners.setdefault(t.source.upper(), module)
    for module, tables in OWNED_TABLES.items():
        for tbl in tables:
            owners[tbl] = module  # the curated ownership wins over an incidental extraction
    return owners


def field_lineage(module: str, system_type: str, dictionary: Dictionary,
                  rule_index: dict[str, tuple[tuple[str, str], ...]] | None = None,
                  glossary: Iterable[dict] = ()) -> dict:
    """The field lineage of ``module`` as extracted from ``system_type``."""
    rules = _rule_index() if rule_index is None else rule_index
    owners = table_owners(system_type)
    terms: dict[str, list[str]] = defaultdict(list)
    for g in glossary:
        if g.get("sap_table") and g.get("sap_field"):
            terms[f"{g['sap_table']}.{g['sap_field']}".upper()].append(str(g["business_name"]))

    tables: list[dict] = []
    edges = 0
    for target in get_extraction_targets(system_type, module, include_config=False):
        tname = target.source.upper()
        t = dictionary.table(tname)
        names = list(dict.fromkeys(f.upper() for f in target.fields))
        prefix = f"{tname}."
        names += sorted({k[len(prefix):] for k in rules if k.startswith(prefix)} - set(names))
        fields = []
        for name in names:
            q = f"{tname}.{name}"
            f = dictionary.field(tname, name)
            hits = rules.get(q, ())
            row = {
                "field": name, "in_dictionary": f is not None,
                "text": f.description if f else "", "data_element": f.data_element if f else None,
                "domain": f.domain if f else None, "type": f.type if f else None,
                "length": f.length if f else None, "key": bool(f and f.key),
                "check_table": None, "check_field": None, "check_table_text": None,
                "check_delivery_class": None, "owner": None,
                "fixed_values": len(f.fixed_values) if f else 0,
                "glossary_terms": terms.get(q, []),
                "rule_count": len(hits), "rule_ids": [r for r, _ in hits[:MAX_RULE_IDS]],
            }
            if f and f.check_table and f.check_table.upper() != tname:
                ct = dictionary.table(f.check_table)
                row.update(check_table=f.check_table, check_field=f.check_field,
                           check_table_text=(ct.description if ct else "") or "",
                           check_delivery_class=ct.delivery_class if ct else None,
                           owner=owners.get(f.check_table.upper(), CONFIGURATION))
                edges += 1
            fields.append(row)
        tables.append({"table": tname, "text": (t.description if t else "") or "",
                       "in_dictionary": t is not None, "fields": fields})
    all_fields = [f for t in tables for f in t["fields"]]
    return {
        "module": module, "system_type": system_type, "release": dictionary.release,
        "tables": tables,
        "totals": {"tables": len(tables), "fields": len(all_fields), "foreign_keys": edges,
                   "fields_with_rules": sum(1 for f in all_fields if f["rule_count"]),
                   "not_in_dictionary": sum(1 for f in all_fields if not f["in_dictionary"]),
                   "cross_object": sum(1 for f in all_fields if f["owner"] not in (None, CONFIGURATION, module))},
    }
