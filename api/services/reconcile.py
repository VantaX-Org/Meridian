"""Reconciliation pack: what an SAP user needs to reproduce one rule's count of one run by hand in SE16 / SE16N.

Derived deterministically from the rule's YAML (or the tenant's rule row), its check type, the population policy
(sap/dictionaries/populations.yaml), the join graph (sap/dictionaries/joins.yaml through checks/frames.py) and the
run's stored finding. Nothing is estimated and no language model is involved.

The pack has

  population_selection  SE16 selection lines that give the records the rule judged (applies_when, the check type's
                        own scope such as "value not initial", and the SAP-standard exclusions such as deletion flags)
  failing_selection     further lines that, added to the population lines, give the failing records
  conditions            what SE16 alone cannot express (a pattern, a check-table lookup, a duplicate, a join), each
                        with its kind, the identifiers it names and the condition in plain words; the closest
                        selection is still given in the lines
  joins                 the join path from the record grain to every other table the rule reads
  se16                  True when the failing count is reproducible from one table's selection alone

Selection operators are SE16's own: EQ, NE, GT, LT, GE, LE, CP (pattern), plus ``initial`` / ``not_initial``
(the field's initial value: blank, 0 or 00000000) and ``in`` / ``not_in`` (SE16's multiple selection, single values
to include or exclude).
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Optional

from checks.frames import TableFrames, tables_of

CLOUD_CATEGORIES = {"successfactors", "concur", "ariba"}
SAMPLE_KEYS = 5
_BACKTICKED = re.compile(r"`([^`]+)`")
_GROUP_CLASSES = {
    "balance_check": "The records of one {group} must net to zero in {amount}{sign}.",
    "aggregate_check": "Per {group}, the {amount} of rows with {split} in {left} must agree with the rows with {split} in {right}{sign}.",
    "group_sum_check": "The sum of {amount} per parent record must stay {compare} {field}.",
    "group_range_check": "{field} must stay within the range learned for its {group}.",
    "interval_check": "The validity periods ({start} to {end}) of one {group} must not overlap{gaps}.",
    "hierarchy_check": "Following {field} from record to record by {id_field} must never come back to a record already on the path.",
    "reconciliation_check": "The total of {field} must equal the total of {target}.",
    "similarity_check": "No two records in the same {group} may have names that differ only by a typo, word order or spacing.",
    "dependency_check": "{field} must hold the value its {determinant} determines.",
    "value_placement_check": "{field} must not hold content that belongs in another field ({family}).",
    "country_format_check": "{field} must follow the format of the record's country ({country_field}).",
}


def _line(table: str, field: str, op: str, values: list[str], part: str, words: str) -> dict:
    return {"table": table, "field": field, "operator": op, "values": [str(v) for v in values], "part": part,
            "words": words}


def _split(col: str) -> tuple[str, str]:
    t, _, f = col.partition(".")
    return t, f


def _sap_date(d: date) -> str:
    return d.strftime("%Y%m%d")


def as_of_date(as_of: Any) -> Optional[date]:
    """The run's as-of date (metadata ``checks_as_of``, else its run time) as a date."""
    if as_of is None:
        return None
    if isinstance(as_of, datetime):
        return as_of.date()
    if isinstance(as_of, date):
        return as_of
    try:
        return datetime.fromisoformat(str(as_of).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _context_lines(applies_when: dict, as_of: Optional[date]) -> tuple[list[dict], list[dict]]:
    """applies_when as population lines, plus conditions for what has no SE16 form."""
    lines: list[dict] = []
    conds: list[dict] = []
    for col, allowed in (applies_when or {}).items():
        t, f = _split(col)
        if not isinstance(allowed, dict):
            vals = [str(v).strip() for v in allowed]
            lines.append(_line(t, f, "in", vals, "population", f"{col} is one of {', '.join(vals)}"))
            continue
        if "not_in" in allowed:
            vals = [str(v).strip() for v in allowed["not_in"]]
            lines.append(_line(t, f, "not_in", vals, "population", f"{col} is none of {', '.join(vals)}"))
        if allowed.get("populated"):
            lines.append(_line(t, f, "not_initial", [], "population", f"{col} is not initial"))
        if allowed.get("blank"):
            lines.append(_line(t, f, "initial", [], "population", f"{col} is initial"))
        if "gt" in allowed:
            lines.append(_line(t, f, "GT", [str(allowed["gt"])], "population", f"{col} is greater than {allowed['gt']}"))
        if "startswith" in allowed:
            vals = [f"{v}*" for v in allowed["startswith"]]
            lines.append(_line(t, f, "CP", vals, "population", f"{col} starts with {', '.join(str(v) for v in allowed['startswith'])}"))
        if "contains_any" in allowed:
            vals = [f"*{v}*" for v in allowed["contains_any"]]
            lines.append(_line(t, f, "CP", vals, "population", f"{col} contains any of {', '.join(str(v) for v in allowed['contains_any'])}"))
        for key, op, sign in (("older_than_days", "LT", "before"), ("within_days", "GE", "on or after")):
            if key not in allowed:
                continue
            if as_of is None:
                conds.append({"kind": "relative_date", "fields": [col], "params": {key: allowed[key]},
                              "words": f"{col} is {allowed[key]} days {'older than' if op == 'LT' else 'within'} the run's as-of date"})
                continue
            cut = as_of - timedelta(days=int(allowed[key]))
            lines.append(_line(t, f, op, [_sap_date(cut)], "population", f"{col} is {sign} {_sap_date(cut)}"))
            lines.append(_line(t, f, "not_initial", [], "population", f"{col} is not initial"))
        if allowed.get("open_ended"):
            lines.append(_line(t, f, "in", ["", "99991231"], "population", f"{col} is initial or 99991231"))
    return lines, conds


def _exclusion_lines(rule: dict, grain: str, cols: list[str]) -> tuple[list[dict], list[dict]]:
    """SAP-standard exclusions (populations.yaml) of the grain table as population lines; a flag on another table
    (the central deletion flag of a company-code record) or a status-table lookup is a condition."""
    from checks.population import exclusions
    lines: list[dict] = []
    conds: list[dict] = []
    for x in exclusions(rule, [grain], cols):
        fields = x.get("fields") or [x["field"]]
        label = x.get("label") or x["id"]
        if x.get("in_table") or len(fields) != 1:
            spec = x.get("in_table") or {}
            conds.append({"kind": "status_exclusion", "fields": fields,
                          "params": {"table": spec.get("table"), "label": label},
                          "words": f"Leave out records {label} ({', '.join(fields)} found in {spec.get('table') or 'its status table'})"})
            continue
        t, f = _split(fields[0])
        if x.get("values"):
            vals = [str(v) for v in x["values"]]
            line = _line(t, f, "not_in", vals, "population", f"{fields[0]} is none of {', '.join(vals)} (not {label})")
        else:
            line = _line(t, f, "initial", [], "population", f"{fields[0]} is initial (not {label})")
        lines.append(line)
    return lines, conds


def _check_lines(rule: dict, details: dict) -> tuple[list[dict], list[dict], list[dict]]:
    """(population lines, failing lines, conditions) of the check type itself."""
    cc = rule.get("check_class") or ""
    field = rule.get("field") or ""
    t, f = _split(field) if field else ("", "")
    pop: list[dict] = []
    fail: list[dict] = []
    conds: list[dict] = []
    not_initial = (lambda c: _line(*_split(c), "not_initial", [], "population", f"{c} is not initial"))

    if cc == "null_check":
        fail.append(_line(t, f, "initial", [], "failing", f"{field} is initial (blank, 0 or 00000000)"))
    elif cc == "regex_check":
        pop.append(not_initial(field))
        conds.append({"kind": "pattern", "fields": [field], "params": {"pattern": rule.get("pattern")},
                      "words": f"{field} does not match the pattern {rule.get('pattern')}"})
    elif cc in ("domain_value_check", "referential_check"):
        pop.append(not_initial(field))
        source = details.get("reference_source")
        ref = details.get("reference_table") or rule.get("_reference_key") or (
            f"{rule['reference_table']}.{rule.get('reference_field') or f}" if rule.get("reference_table") else None)
        if ref is None and field:
            from sap.ddic import get_dictionary
            fdef = get_dictionary("s4hana").resolve(field)
            ref = fdef.check_ref if fdef is not None else None
        allowed = details.get("allowed_values") if cc == "domain_value_check" else None
        if cc == "domain_value_check" and source is None and allowed is None:
            allowed = rule.get("allowed_values")  # no stored evidence of the run: the rule's own list
        if cc == "domain_value_check" and isinstance(allowed, list) and source != "live_config":
            vals = [str(v).strip() for v in allowed]
            fail.append(_line(t, f, "not_in", vals, "failing", f"{field} is none of {', '.join(vals)}"))
        elif cc == "referential_check" and source != "live_config" and rule.get("reference_values") \
                and rule.get("multi_value") != "chars":
            vals = [str(v).strip() for v in rule["reference_values"]]
            fail.append(_line(t, f, "not_in", vals, "failing", f"{field} is none of {', '.join(vals)}"))
        elif rule.get("multi_value") == "chars":
            conds.append({"kind": "chars_not_in", "fields": [field], "params": {"reference": ref},
                          "words": f"A character of {field} is not a value of {ref or 'the reference list'}"})
        elif rule.get("format") in ("email", "date"):
            conds.append({"kind": "format", "fields": [field], "params": {"format": rule.get("format")},
                          "words": f"{field} is not a valid {rule.get('format')}"})
        else:
            rt, _, rf = (ref or "").partition(".")
            conds.append({"kind": "not_in_check_table", "fields": [field], "params": {"table": rt or None, "field": rf or None},
                          "words": f"{field} has no entry in {rt or 'its check table'}{f' ({rf})' if rf else ''}: "
                                   f"list {rt or 'the check table'} in SE16 and compare"})
    elif cc == "freshness_check":
        pop.append(not_initial(field))
        cutoff = details.get("cutoff_datetime")
        day = as_of_date(cutoff) if cutoff else None
        if day is not None:
            fail.append(_line(t, f, "LT", [_sap_date(day)], "failing", f"{field} is before {_sap_date(day)}"))
            if rule.get("time_field") or int(rule.get("max_age_hours") or 0) % 24:
                conds.append({"kind": "time_of_day", "fields": [field] + ([rule["time_field"]] if rule.get("time_field") else []),
                              "params": {"cutoff": cutoff},
                              "words": f"Records dated {_sap_date(day)} itself fail when their time is before {cutoff}"})
        else:
            conds.append({"kind": "older_than_hours", "fields": [field], "params": {"hours": rule.get("max_age_hours")},
                          "words": f"{field} is more than {rule.get('max_age_hours')} hours before the run's as-of time"})
        conds.append({"kind": "not_a_date", "fields": [field], "params": {},
                      "words": f"A value of {field} that is not a date also fails"})
    elif cc == "format_check":
        pop.append(not_initial(field))
        conds.append({"kind": "checksum", "fields": [field], "params": {"format": rule.get("format")},
                      "words": f"{field} fails the {rule.get('format')} check digit"})
    elif cc == "field_status_check":
        groups = [str(g) for g in rule.get("groups") or []]
        gf = rule.get("group_field")
        if isinstance(gf, str):
            pop.append(_line(*_split(gf), "in", groups, "population", f"{gf} is one of {', '.join(groups)}"))
        else:
            conds.append({"kind": "group_combination", "fields": list(gf or []), "params": {"groups": groups},
                          "words": f"The combination {' | '.join(gf or [])} is one of {', '.join(groups)}"})
        required = rule.get("kind") == "required"
        fail.append(_line(t, f, "initial" if required else "not_initial", [], "failing",
                          f"{field} is {'initial' if required else 'not initial'} ({'required' if required else 'suppressed'} by the field status)"))
    elif cc == "uniqueness_check":
        cols = list(rule.get("fields") or [field])
        pop += [not_initial(c) for c in cols]
        conds.append({"kind": "duplicate", "fields": cols, "params": {"across": rule.get("unique_across"),
                                                                      "normalize": rule.get("normalize")},
                      "words": f"Two or more records share the same {', '.join(cols)}"
                               + (f" with different {rule['unique_across']}" if rule.get("unique_across") else "")
                               + "; in SE16N, output only these fields with the number of entries per value"})
    elif cc == "exists_check":
        cols = list(rule.get("fields") or [field])
        pop += [not_initial(c) for c in cols]
        target = rule.get("target_table")
        tfields = [f"{target}.{x}" for x in rule.get("target_fields") or []]
        conds.append({"kind": "present_in_target" if rule.get("negate") else "missing_in_target", "fields": cols,
                      "params": {"table": target, "target_fields": tfields,
                                 "target_when": {str(k): v for k, v in (rule.get("target_when") or {}).items()}},
                      "words": f"{', '.join(cols)} {'has' if rule.get('negate') else 'has no'} record in {target} "
                               f"({', '.join(tfields)})"
                               + (f" where {', '.join(f'{k} {v}' for k, v in (rule.get('target_when') or {}).items())}"
                                  if rule.get("target_when") else "")})
    elif cc == "cross_field_check":
        expr = rule.get("fail_when") or rule.get("condition") or ""
        cols = _BACKTICKED.findall(expr)
        if rule.get("require_populated"):
            pop += [not_initial(c) for c in dict.fromkeys(cols)]
        conds.append({"kind": "expression_true" if rule.get("fail_when") else "expression_false", "fields": cols,
                      "params": {"expression": expr},
                      "words": f"{'Records where' if rule.get('fail_when') else 'Records where it is not true that'} {expr}"})
    else:
        words = _GROUP_CLASSES.get(cc, "Meridian applies the {check} logic.")
        params = {
            "group": " + ".join(rule.get("group_by") or []) if isinstance(rule.get("group_by"), list) else rule.get("group_by"),
            "amount": rule.get("amount"), "split": rule.get("split_field"),
            "left": ", ".join(str(v) for v in rule.get("left_values") or []),
            "right": ", ".join(str(v) for v in rule.get("right_values") or []),
            "sign": f", signed by {rule['sign_field']}" if rule.get("sign_field") else "",
            "compare": {"<=": "at or below", ">=": "at or above", "==": "equal to"}.get(rule.get("compare", "<="), "at or below"),
            "field": field, "start": rule.get("start"), "end": rule.get("end"),
            "gaps": " or leave a gap" if rule.get("mode") == "continuous" else "",
            "id_field": rule.get("id_field"), "determinant": rule.get("determinant"),
            "family": rule.get("family"), "country_field": rule.get("country_field"),
            "target": f"{rule.get('target_table')}.{rule.get('target_field')}", "check": cc,
        }
        conds.append({"kind": "group_logic", "fields": [c for c in ([field] if field else [])],
                      "params": {"check_class": cc}, "words": words.format(**{k: v if v is not None else "" for k, v in params.items()})})
    return pop, fail, conds


def _rule_columns(rule: dict) -> list[str]:
    from checks.runner import rule_columns
    try:
        return rule_columns(rule)
    except (KeyError, TypeError):
        return [rule["field"]] if rule.get("field") else []


def joins_for(grain: str, tables: list[str]) -> list[dict]:
    """The join path from the grain table to every other table, as SE16H / SQVI would join them."""
    frames = TableFrames({})
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for t in tables:
        if t == grain:
            continue
        path = frames._path(grain, t)
        if path is None:
            out.append({"from_table": grain, "to_table": t, "on": [], "words": f"No join path from {grain} to {t} is defined"})
            continue
        for edge, direction in path:
            a, b = (edge.child, edge.parent) if direction == "up" else (edge.parent, edge.child)
            if (a, b) in seen:
                continue
            seen.add((a, b))
            pairs = [[f"{edge.child}.{c}", f"{edge.parent}.{p}"] for c, p in edge.on]
            if direction == "down":
                pairs = [[q, p] for p, q in pairs]
            filt = "".join(f", {b}.{k} = {v}" for k, v in edge.filter) if edge.filter else ""
            out.append({"from_table": a, "to_table": b, "on": pairs,
                        "words": f"{a} to {b} on " + ", ".join(f"{x} = {y}" for x, y in pairs) + filt})
    return out


def grain_of(rule: dict, stored: Optional[str]) -> str:
    """The table the rule was evaluated at: as stored with the failing records, else resolved as the engine does."""
    if stored:
        return stored
    if rule.get("grain"):
        return str(rule["grain"])
    tables = tables_of(_rule_columns(rule))
    if not tables:
        return ""
    try:
        return TableFrames({})._resolve_grain(tables)
    except Exception:  # an unknown table: the first one the rule reads
        return tables[0]


def display_key(record_key: str, grain: str) -> dict:
    """A stored record key (``MATNR=000000000000000232|WERKS=3000``) as SE16 shows it: ALPHA and MATN1 values
    without their leading zeros, every other value as stored. The raw key stays alongside."""
    from sap.ddic import get_dictionary
    d = get_dictionary("s4hana")
    parts = []
    for chunk in record_key.split("|"):
        name, eq, value = chunk.partition("=")
        if not eq:
            parts.append({"field": None, "raw": chunk, "display": chunk})
            continue
        fdef = d.resolve(f"{grain}.{name}") if grain else None
        shown = value
        if fdef is not None and fdef.conversion_exit in ("ALPHA", "MATN1") and value.isdigit():
            shown = value.lstrip("0") or "0"
        parts.append({"field": name, "raw": value, "display": shown})
    return {"raw": record_key, "display": ", ".join(f"{p['field']} {p['display']}" if p["field"] else p["display"] for p in parts),
            "fields": parts}


def build_pack(*, rule: dict, check_id: str, module: str, category: Optional[str], finding: dict,
               sample_keys: list[str], grain: Optional[str], as_of: Any) -> dict:
    """The reconciliation pack of one rule in one run (see the module docstring)."""
    details = finding.get("details") or {}
    cols = _rule_columns(rule)
    g = grain_of(rule, grain)
    day = as_of_date(as_of)
    ctx_lines, ctx_conds = _context_lines(rule.get("applies_when") or {}, day)
    pop_lines, fail_lines, conds = _check_lines(rule, details)
    excl_lines, excl_conds = _exclusion_lines(rule, g, cols) if g and rule.get("population") != "all" else ([], [])
    population = ctx_lines + pop_lines + excl_lines
    conditions = ctx_conds + conds + excl_conds
    tables = list(dict.fromkeys([g] + tables_of(cols) + [ln["table"] for ln in population + fail_lines]))
    tables = [t for t in tables if t]
    joins = joins_for(g, tables) if g else []
    for j in joins:
        conditions.append({"kind": "join", "fields": [x for pair in j["on"] for x in pair],
                           "params": {"from_table": j["from_table"], "to_table": j["to_table"]},
                           "words": f"Join {j['words']}: SE16 reads one table at a time (use SE16H or SQVI)"})
    key_fields = [p.split("=", 1)[0] for p in sample_keys[0].split("|")] if sample_keys else []
    if not key_fields and g:
        from sap.ddic import get_dictionary
        key_fields = [k for k in get_dictionary("s4hana").keys(g) if k != "MANDT"]
    abap = (category or "") not in CLOUD_CATEGORIES
    se16 = abap and bool(g) and not conditions and all(ln["table"] == g for ln in population + fail_lines)
    excluded = {str(k): int(v) for k, v in (details.get("population_excluded") or {}).items()}
    return {
        "check_id": check_id,
        "module": module,
        "check_class": rule.get("check_class"),
        "message": rule.get("message"),
        "field": rule.get("field"),
        "system": "abap" if abap else "cloud",
        "transaction": ("SE16N" if se16 else "SE16H") if abap else None,
        "tables": tables,
        "grain": {"table": g or None, "key_fields": key_fields},
        "population_selection": population,
        "failing_selection": fail_lines,
        "conditions": conditions,
        "joins": joins,
        "se16": se16,
        "population": int(finding.get("total_count") or 0),
        "failing": int(finding.get("affected_count") or 0),
        "excluded": excluded,
        "sample_keys": [display_key(k, g) for k in sample_keys[:SAMPLE_KEYS]],
    }


def steps_in_words(pack: dict) -> list[str]:
    """The pack as numbered steps in English, for the workbook."""
    g = pack["grain"]["table"] or "the table"
    out = []
    if pack["system"] == "cloud":
        out.append(f"{g} is read from a cloud system: SE16 does not apply. Query it in the source's own reporting with the "
                   "same selection.")
    else:
        out.append(f"Open {pack['transaction']} and enter table {g}.")
    for ln in pack["population_selection"]:
        out.append(f"Population: {ln['table']}-{ln['field']} {_op_words(ln)}.")
    out.append(f"Count the entries: Meridian measured {pack['population']:,} records in the population.")
    for ln in pack["failing_selection"]:
        out.append(f"Failing: add {ln['table']}-{ln['field']} {_op_words(ln)}.")
    for c in pack["conditions"]:
        out.append(f"Not expressible in SE16 alone: {c['words']}.")
    out.append(f"Count the entries: Meridian measured {pack['failing']:,} failing records.")
    return out


def _op_words(ln: dict) -> str:
    vals = [v if v != "" else "(initial)" for v in ln["values"]]
    op = ln["operator"]
    if op == "initial":
        return "is initial (leave the value empty with option =)"
    if op == "not_initial":
        return "is not initial (option not equal to an empty value)"
    if op == "in":
        return "is one of " + ", ".join(vals) + " (multiple selection, single values)"
    if op == "not_in":
        return "is none of " + ", ".join(vals) + " (multiple selection, exclude single values)"
    words = {"EQ": "equals", "NE": "does not equal", "GT": "is greater than", "LT": "is less than",
             "GE": "is at least", "LE": "is at most", "CP": "matches the pattern"}
    return f"{words.get(op, op)} {', '.join(vals)}"


def selection_in_words(pack: dict) -> str:
    """The SE16 selection on one line, for the workbook's summary sheet."""
    lines = pack["population_selection"] + pack["failing_selection"]
    text = "; ".join(f"{ln['table']}-{ln['field']} {_op_words(ln)}" for ln in lines) or "no selection: every record"
    if pack["conditions"]:
        text += "; then " + "; ".join(c["words"] for c in pack["conditions"])
    return text
