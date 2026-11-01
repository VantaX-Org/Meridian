"""Rule self-tuning: draft a tuned rule version from the stewards' verdicts. Pure functions, no DB.

A rule whose reviewed issues (record_issues.steward_verdict) put its precision below target is
tuned by excluding the context values its false positives concentrate on (the later parts of
the record key, e.g. WERKS=1000 in 'MATNR=1|WERKS=1000') through ``applies_when: {T.F: {not_in}}``.
A bare key field is mapped to a TABLE.FIELD only when the rule itself already reads exactly one
column of that name; nothing is guessed. With no such pattern and a very low precision, the
proposal is a one-step severity downgrade. A proposal is only ever a draft rule version: a
human approves it through the rule lifecycle (checks/lifecycle.py).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from api.services.pilot_scorecard import MIN_REVIEWED, TARGET_PRECISION

MIN_SUPPORT = 3            # reviewed issues a context value needs before it can be excluded
MIN_FP_SHARE = 0.9         # share of a value's reviewed issues that must be false positives
MAX_REAL_SHARE = 0.05      # a value carrying more than this share of the rule's real issues is never excluded
DOWNGRADE_BELOW = 0.5      # precision under which, with no pattern, the severity steps down
SEVERITIES = ("critical", "high", "medium", "low", "info")


def _parts(record_key: str) -> list[tuple[str, str]]:
    """Context (field, value) parts of a record key: every part after the first (the object key)."""
    return [(f.strip(), v.strip()) for f, _, v in (p.partition("=") for p in record_key.split("|")[1:]) if f.strip()]


def _refs(rule: dict) -> set[str]:
    """TABLE.FIELD columns the rule itself names (field, fields, applies_when)."""
    fields = rule.get("fields") or []
    cols = {rule.get("field"), *(fields if isinstance(fields, list) else [fields]), *(rule.get("applies_when") or {})}
    return {c for c in cols if isinstance(c, str) and "." in c}


def resolve_column(rule: dict, key_field: str) -> str | None:
    """The rule's TABLE.FIELD for a bare key field, or None when not unambiguous from the rule."""
    hits = sorted(c for c in _refs(rule) if c.split(".", 1)[1] == key_field)
    if len(hits) > 1 and rule.get("grain"):
        hits = [c for c in hits if c.split(".", 1)[0] == rule["grain"]]
    return hits[0] if len(hits) == 1 else None


def _precision(fp: int, real: int) -> float | None:
    return round(real / (fp + real), 4) if fp + real else None


def merge_exclusions(applies_when: dict | None, excl: dict[str, list[str]]) -> dict:
    """applies_when with each column's values excluded, keeping every other condition. An allowed-value
    list loses the values; an operator dict gains them in its not_in; a new column gets a not_in."""
    out = dict(applies_when or {})
    for col, values in excl.items():
        cur = out.get(col)
        if isinstance(cur, list):
            out[col] = [v for v in cur if str(v).strip() not in values]
        elif isinstance(cur, dict):
            out[col] = {**cur, "not_in": list(dict.fromkeys([*(cur.get("not_in") or []), *values]))}
        else:
            out[col] = {"not_in": list(values)}
    return out


def propose(rule_id: str, rule: dict, body: dict, issues: Iterable[tuple[str, str]]) -> dict | None:
    """A tuning proposal for one rule, or None when it needs none or nothing deterministic helps.

    ``rule`` is the effective rule (lifecycle.effective), ``body`` the override it runs with now (the
    active version's body, {} for the shipped rule), ``issues`` its reviewed (record_key, verdict)."""
    rows = [(k, v == "false_positive") for k, v in issues if v in ("false_positive", "real")]
    fp_total = sum(fp for _, fp in rows)
    real_total = len(rows) - fp_total
    before = _precision(fp_total, real_total)
    if len(rows) < MIN_REVIEWED or before is None or before >= TARGET_PRECISION:
        return None

    by_value: dict[tuple[str, str], set[int]] = defaultdict(set)
    for i, (key, _) in enumerate(rows):
        for part in _parts(key):
            by_value[part].add(i)
    columns: dict[str, str] = {}
    candidates: dict[tuple[str, str], set[int]] = {}
    for (field, value), idx in by_value.items():
        fp = sum(rows[i][1] for i in idx)
        real = len(idx) - fp
        if len(idx) < MIN_SUPPORT or fp / len(idx) < MIN_FP_SHARE:
            continue
        if real_total and real / real_total > MAX_REAL_SHARE:
            continue
        col = columns.get(field) or resolve_column(rule, field)
        if col:
            columns[field] = col
            candidates[(field, value)] = idx

    chosen: list[tuple[str, str]] = []
    gone: set[int] = set()
    precision = before
    while precision < TARGET_PRECISION:  # greedy: take the value that raises precision the most
        best, best_p = None, precision
        for cand, idx in sorted(candidates.items()):
            if cand in chosen:
                continue
            left = [fp for i, (_, fp) in enumerate(rows) if i not in gone and i not in idx]
            p = _precision(sum(left), len(left) - sum(left))
            if p is not None and p > best_p:
                best, best_p = cand, p
        if best is None:
            break
        chosen.append(best)
        gone |= candidates[best]
        precision = best_p

    base = {"rule_id": rule_id, "reviewed": len(rows), "precision_before": before}
    if chosen:
        excl: dict[str, list[str]] = defaultdict(list)
        for field, value in chosen:
            excl[columns[field]].append(value)
        fp_removed = sum(rows[i][1] for i in gone)
        real_lost = len(gone) - fp_removed
        listed = ", ".join(f"{f}={v}" for f, v in chosen)
        return {**base, "kind": "exclude",
                "exclusions": [{"field": f, "column": columns[f], "value": v,
                                "false_positive": sum(rows[i][1] for i in candidates[(f, v)]),
                                "real": sum(not rows[i][1] for i in candidates[(f, v)])} for f, v in chosen],
                "body": {**body, "applies_when": merge_exclusions(rule.get("applies_when"), dict(excl))},
                "precision_after": precision, "records_excluded": len(gone), "fp_removed": fp_removed,
                "real_lost": real_lost,
                "rationale": (f"{fp_removed} of the {fp_total} false positives stewards marked sit on {listed}, "
                              f"where at least {MIN_FP_SHARE:.0%} of reviewed issues were false positives. "
                              f"Excluding {'it' if len(chosen) == 1 else 'them'} loses {real_lost} real issue(s) "
                              f"and raises precision from {before:.0%} to {precision:.0%}.")}

    severity = rule.get("severity")
    if before < DOWNGRADE_BELOW and severity in SEVERITIES[:-1]:
        lower = SEVERITIES[SEVERITIES.index(severity) + 1]
        return {**base, "kind": "severity", "exclusions": [], "body": {**body, "severity": lower},
                "severity_from": severity, "severity_to": lower, "precision_after": before,
                "records_excluded": 0, "fp_removed": 0, "real_lost": 0,
                "rationale": (f"Precision is {before:.0%} over {len(rows)} reviewed issues and no plant, company "
                              f"code or other key value concentrates the false positives. Lowering the severity "
                              f"from {severity} to {lower} limits the rule's weight until the rule itself is "
                              f"rewritten.")}
    return None
