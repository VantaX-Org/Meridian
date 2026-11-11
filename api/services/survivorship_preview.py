"""What-if for survivorship rules: which golden values would change, and are the new values valid SAP codes.

Deterministic. The candidate rules are run through ``merge_explain.survive_cluster`` (the same function a
merge uses) over each stored cluster: the golden head first, then its members in the order they joined,
each with its own pre-merge values and the system each value came from. The result is compared field by
field with the golden values stored now. A field a steward overrode stays overridden, as in a merge.

Every attribute whose value changes is checked against the SAP data dictionary (``sap/ddic.py``):

* the attribute is resolved to a table field of the object: a ``TABLE.FIELD`` or ``TABLE_FIELD`` name
  directly, a bare field name against the tables the object extracts. An attribute the dictionary does
  not know is reported with ``in_dictionary = False`` and is not checked;
* length: a character value longer than the field's DDIC length would be cut on load;
* fixed values: a value outside the domain's fixed values is not a valid code;
* check table: a value missing from the check table's value set (the tenant's live configuration
  snapshot first, then the SAP standard baseline) would fail the foreign-key check on load. With no
  known value set the check is ``unknown``, never guessed.

Sample values are masked with ``mask_value`` as everywhere else in match review.
"""

from __future__ import annotations

from typing import Iterable, Optional

from api.services.merge_explain import mask_value, survive_cluster
from api.services.migration.load_plan import OWNED_TABLES
from sap.ddic import Dictionary, Field
from sap.extraction_registry import get_extraction_targets

SAMPLE_LIMIT = 20
INVALID_SAMPLES = 5
_CHAR_TYPES = {"CHAR", "NUMC", "CUKY", "UNIT", "LANG", "CLNT", "ACCP", "SSTR"}


def domain_tables(domain: str, system_type: str) -> list[str]:
    """The tables an object's attributes come from: what it extracts, then the load plan's owned tables."""
    out = [t.source.upper() for t in get_extraction_targets(system_type, domain, include_config=False)]
    out += [t for t in OWNED_TABLES.get(domain, ()) if t not in out]
    return out


def resolve_attribute(name: str, tables: Iterable[str], dictionary: Dictionary) -> Optional[tuple[str, Field]]:
    """``(table, Field)`` for a golden attribute name, or None when the dictionary does not know it."""
    up = name.upper()
    for sep in (".", "-", "_"):
        if sep in up:
            t, f = up.split(sep, 1)
            hit = dictionary.field(t, f)
            if hit:
                return t, hit
    bare = up.split(".")[-1]
    for t in tables:
        hit = dictionary.field(t, bare)
        if hit:
            return t, hit
    return None


def value_sets(rows: Iterable[tuple[str, list]]) -> dict[str, set[str]]:
    """``TABLE.FIELD`` -> codes from config table snapshots ``[(config_table, [record, ...]), ...]``."""
    out: dict[str, set[str]] = {}
    for table, data in rows:
        for rec in data or []:
            for col, val in (rec or {}).items():
                if val not in (None, ""):
                    out.setdefault(f"{str(table).upper()}.{str(col).upper()}", set()).add(str(val).strip())
    return out


def check_value(field: Field, name: str, value: object, sets: dict[str, set[str]]) -> list[str]:
    """The DDIC checks ``value`` fails: ``length``, ``fixed_values``, ``check_table``. Empty when it passes."""
    s = "" if value is None else str(value).strip()
    if not s:
        return []
    failed = []
    if field.length and field.type in _CHAR_TYPES and len(s) > field.length:
        failed.append("length")
    allowed = field.allowed_values()
    if allowed and s not in allowed:
        failed.append("fixed_values")
    if field.check_table:
        known = sets.get(f"{field.check_table.upper()}.{(field.check_field or name).upper()}")
        if known is not None and s not in known:
            failed.append("check_table")
    return failed


def preview(clusters: list[dict], rules: dict, dictionary: Dictionary, tables: list[str],
            sets: dict[str, set[str]], sample_limit: int = SAMPLE_LIMIT) -> dict:
    """Diff the candidate ``rules`` against the stored golden values of ``clusters``.

    ``clusters``: ``[{golden_id, key, golden, overrides, members}]`` where ``members`` is the
    ``survive_cluster`` input (head first). ``rules``: ``{field: {rule_type, trusted_sources}}``.
    """
    changed_records = 0
    per_attr: dict[str, int] = {}
    samples: list[dict] = []
    new_values: dict[str, list[object]] = {}
    for c in clusters:
        res = survive_cluster(c["members"], rules, c.get("overrides") or {})
        before = c.get("golden") or {}
        hit = False
        for f, after in res["fields"].items():
            old = before.get(f)
            if str(old if old is not None else "").strip() == str(after).strip():
                continue
            hit = True
            per_attr[f] = per_attr.get(f, 0) + 1
            new_values.setdefault(f, []).append(after)
            if len(samples) < sample_limit:
                ex = res["explanation"].get(f) or {}
                samples.append({"golden_id": c.get("golden_id"), "key": c.get("key"), "field": f,
                                "before": mask_value(f, old), "after": mask_value(f, after),
                                "rule": ex.get("rule"), "winner_key": ex.get("winner_key"),
                                "winner_system": ex.get("winner_system")})
        changed_records += hit

    attributes = []
    for f, n in sorted(per_attr.items(), key=lambda kv: (-kv[1], kv[0])):
        ref = resolve_attribute(f, tables, dictionary)
        row = {"field": f, "changed": n, "in_dictionary": ref is not None, "table": None, "text": "",
               "length": None, "check_table": None, "fixed_values": 0, "check_status": "not_checked",
               "invalid": 0, "invalid_reasons": {}, "invalid_samples": []}
        if ref:
            table, fd = ref
            ct_known = bool(fd.check_table and
                            f"{fd.check_table.upper()}.{(fd.check_field or fd.name).upper()}" in sets)
            row.update(table=table, text=fd.description, length=fd.length, check_table=fd.check_table,
                       fixed_values=len(fd.fixed_values),
                       check_status="unknown" if fd.check_table and not ct_known else "checked")
            reasons: dict[str, int] = {}
            bad = []
            for v in new_values[f]:
                failed = check_value(fd, fd.name, v, sets)
                for r in failed:
                    reasons[r] = reasons.get(r, 0) + 1
                if failed:
                    bad.append(v)
            row.update(invalid=len(bad), invalid_reasons=reasons,
                       invalid_samples=list(dict.fromkeys(mask_value(f, v) for v in bad))[:INVALID_SAMPLES])
        attributes.append(row)
    return {"clusters_scanned": len(clusters), "records_changed": changed_records,
            "values_changed": sum(per_attr.values()),
            "invalid_values": sum(a["invalid"] for a in attributes),
            "attributes": attributes, "samples": samples}
