"""Precision/recall benchmark: every rule whose truth is a pure function of its own YAML.

For each enabled rule of a benchmarkable class, the benchmark builds a population of
synthetic records that all satisfy the rule's ``applies_when`` scope, injects a defect into
a fixed subset (every 4th record) derived only from the rule's own parameters, and runs the
engine on it. The ground truth (which records carry a defect) is known before the engine
runs, so per-rule precision, recall and F1 are exact.

    python scripts/bench_precision_recall.py [--modules material_master,...] [--out PATH]

Benchmarked classes and how the defect is derived from the rule:
  null_check           the field blank; clean records carry a typed value
  regex_check          a value the pattern rejects (checked with re.match); clean = a match
  domain_value_check   a value outside the static ``allowed_values`` (or failing ``format``)
  uniqueness_check     pairs of records sharing every ``fields`` value (distinct owners
                       for ``unique_across``)
  cross_field_check    a ``fail_when`` that is a conjunction of simple atoms; defect records
                       satisfy every atom, clean records violate exactly one (rotating)

Everything else (referential, exists, aggregates, live-configuration domains, compound
expressions) needs the configuration snapshot or a second dataset and is listed as not
benchmarkable with the reason.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from checks.frames import TableFrames  # noqa: E402
from checks.runner import module_rules, run_rule  # noqa: E402
from sap.ddic import get_dictionary  # noqa: E402
from tests.checks.rule_proofs import (  # noqa: E402
    TODAY, _failing_rows, _kind, _rows, sample_regex, sample_regex_overflow, sample_regex_violation,
)

D = get_dictionary("s4hana")
MODULES = ("material_master", "employee_central", "sd_customer_master", "business_partner")
OUT = ROOT / "checks" / "benchmark" / "precision_recall.json"
N = 40  # records per rule
DEFECT = {i for i in range(N) if i % 4 == 1}  # 10 defects, 30 clean

_CLEAN = {"date": "20200101", "num": "1", "char": "X", "timestamp": "20200101000000"}


def _scope_value(field: str, cond) -> str | None:
    """A value that puts a record inside one applies_when condition, or None."""
    if isinstance(cond, list):
        return str(cond[0]) if cond else None
    if not isinstance(cond, dict):
        return None
    if cond.get("blank") or cond.get("open_ended"):
        return ""
    if "contains_any" in cond:
        return str(cond["contains_any"][0]) if cond["contains_any"] else None
    if "startswith" in cond:
        return str(cond["startswith"][0])
    if "gt" in cond:
        return str(int(float(cond["gt"])) + 1)
    if "within_days" in cond:
        return TODAY
    if "older_than_days" in cond:
        return "19900101" if int(cond["older_than_days"]) < 12000 else None
    if "not_in" in cond:
        return next(v for v in ("ZQ9", "ZQ8", "ZQ7") if v not in {str(x) for x in cond["not_in"]})
    if cond.get("populated"):
        return _CLEAN[_kind(D, field)]
    return None


# ── cross_field fail_when: a conjunction of simple atoms ─────────────────────────────────
_COL = r"`([^`]+)`"
_LIT = r"'([^']*)'"
_NUM = r"(-?\d+(?:\.\d+)?)"
_ATOMS = [
    ("isna", re.compile(rf"^{_COL}\.isna\(\)$")),
    ("notna", re.compile(rf"^{_COL}\.notna\(\)$")),
    ("isin", re.compile(rf"^{_COL}\.isin\(\[((?:\s*{_LIT}\s*,?)+)\]\)$")),
    ("notin", re.compile(rf"^~\s*{_COL}\.isin\(\[((?:\s*{_LIT}\s*,?)+)\]\)$")),
    ("eqlit", re.compile(rf"^{_COL}\s*==\s*{_LIT}$")),
    ("nelit", re.compile(rf"^{_COL}\s*!=\s*{_LIT}$")),
    ("cmpnum", re.compile(rf"^{_COL}\s*(<=|>=|<|>|==|!=)\s*{_NUM}$")),
    ("cmptoday", re.compile(rf"^{_COL}\s*(<=|>=|<|>)\s*@today$")),
    ("cmpcol", re.compile(rf"^{_COL}\s*(<=|>=|<|>|==|!=)\s*{_COL}$")),
]


def _split_and(expr: str) -> list[str] | None:
    """Top-level ``&`` operands with outer parentheses removed; None if a top-level ``|``."""
    parts, depth, cur = [], 0, ""
    for ch in expr:
        depth += ch in "([" and 1 or (ch in ")]" and -1 or 0)
        if depth == 0 and ch == "|":
            return None
        if depth == 0 and ch == "&":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    out = []
    for p in parts:
        p = q = p.strip()
        while p.startswith("(") and p.endswith(")") and _balanced(p[1:-1]):
            p = p[1:-1].strip()
        if "&" in p or "|" in p:
            sub = _split_and(p) if p != q else None  # only a parenthesised group splits further
            if not sub or len(sub) == 1:
                return None
            out += sub
        else:
            out.append(p)
    return out


def _balanced(s: str) -> bool:
    d = 0
    for ch in s:
        d += (ch == "(") - (ch == ")")
        if d < 0:
            return False
    return d == 0


def _pair(op: str, kind: str) -> tuple[str, str, str, str] | None:
    """(left_true, right_true, left_false, right_false) values for a typed comparison."""
    if kind == "date":
        lo, hi = "20200101", "20210101"
    elif kind == "num":
        lo, hi = "1", "2"
    else:
        return None
    return {"<": (lo, hi, hi, lo), "<=": (lo, hi, hi, lo), ">": (hi, lo, lo, hi), ">=": (hi, lo, lo, hi),
            "==": (lo, lo, lo, hi), "!=": (lo, hi, lo, lo)}[op]


def _num(v: float) -> str:
    return str(int(v)) if v == int(v) else str(v)


def _cross_atoms(rule: dict) -> tuple[list[tuple[dict, dict]], str | None]:
    """For each atom, (values that make it true, values that make it false)."""
    if not rule.get("fail_when"):
        return [], "legacy pass condition"
    parts = _split_and(rule["fail_when"])
    if not parts:
        return [], "fail_when is not a conjunction of simple conditions"
    atoms, seen = [], set()
    for p in parts:
        for name, rx in _ATOMS:
            m = rx.match(p)
            if m:
                break
        else:
            return [], f"condition not modelled: {p[:60]}"
        c = m.group(1)
        k = _kind(D, c)
        if name == "isna":
            t, f = {c: ""}, {c: _CLEAN[k]}
        elif name == "notna":
            t, f = {c: _CLEAN[k]}, {c: ""}
        elif name in ("isin", "notin"):
            lits = re.findall(_LIT, m.group(2))
            if k != "char":
                return [], f"list literal on non-character field {c}"
            other = next(v for v in ("ZQ9", "ZQ8") if v not in lits)
            t, f = ({c: lits[0]}, {c: other}) if name == "isin" else ({c: other}, {c: lits[0]})
        elif name in ("eqlit", "nelit"):
            lit = m.group(2)
            if k != "char" or not lit:
                return [], f"literal comparison on {c} not modelled"
            other = "ZQ9" if lit != "ZQ9" else "ZQ8"
            t, f = ({c: lit}, {c: other}) if name == "eqlit" else ({c: other}, {c: lit})
        elif name == "cmpnum":
            if k != "num":
                return [], f"numeric comparison on non-numeric field {c}"
            op, n = m.group(2), float(m.group(3))
            above, below = _num(n + 1), _num(n - 1)
            t, f = {"<": (below, above), "<=": (_num(n), above), ">": (above, below), ">=": (_num(n), below),
                    "==": (_num(n), above), "!=": (above, _num(n))}[op]
            t, f = {c: t}, {c: f}
        elif name == "cmptoday":
            if k != "date":
                return [], f"date comparison on non-date field {c}"
            op = m.group(2)
            t, f = ({c: "20991231"}, {c: "20000101"}) if op in (">", ">=") else ({c: "20000101"}, {c: "20991231"})
        else:  # cmpcol
            c2 = m.group(3)
            if k != _kind(D, c2):
                return [], f"comparison across field types {c}/{c2}"
            vals = _pair(m.group(2), k)
            if vals is None:
                return [], f"character comparison {c}/{c2} not modelled"
            t, f = {c: vals[0], c2: vals[1]}, {c: vals[2], c2: vals[3]}
        if seen & set(t):
            return [], "a field appears in more than one condition"
        seen |= set(t)
        atoms.append((t, f))
    if rule.get("require_populated") and any(v == "" for t, _ in atoms for v in t.values()):
        return [], "require_populated excludes the blank defect"
    return atoms, None


# ── per-class injection ───────────────────────────────────────────────────────────────────
def _plan(rule: dict) -> tuple[list[dict], set[int]] | str:
    """(per-record values, defect indices) or the reason the rule is not benchmarkable."""
    cls = rule.get("check_class")
    field = rule.get("field")
    if rule.get("dedupe_on"):
        return "dedupe_on collapses records before the check"
    if cls == "null_check":
        k = _kind(D, field)
        return [{field: "" if i in DEFECT else _CLEAN[k]} for i in range(N)], DEFECT
    if cls == "regex_check":
        pat = rule["pattern"]
        good = sample_regex(pat)
        bad = next((v for v in (sample_regex_violation(pat), sample_regex_overflow(pat), "§§§", "~~~", "  ")
                    if v and v.strip() and not re.match(pat, v.strip())), None)
        if not good or not good.strip() or not re.match(pat, good.strip()) or bad is None:
            return "no matching and non-matching sample derivable from the pattern"
        return [{field: bad if i in DEFECT else good.strip()} for i in range(N)], DEFECT
    if cls == "domain_value_check":
        if rule.get("reference_key") or rule.get("reference_table") or rule.get("reference_values"):
            return "allowed values come from the live configuration snapshot"
        allowed = [str(v).strip() for v in rule.get("allowed_values") or []]
        if allowed:
            bad = next(v for v in ("ZQ9", "ZQ8", "ZQ7") if v not in allowed)
            good = next((v for v in allowed if v), None)
            if good is None:
                return "allowed_values holds only blank"
        elif rule.get("format") == "email":
            good, bad = "ap@example.co.za", "not-an-email"
        elif rule.get("format") == "date":
            good, bad = "20200101", "20201399"
        else:
            return "allowed values come from the DDIC domain or live configuration"
        return [{field: bad if i in DEFECT else good} for i in range(N)], DEFECT
    if cls == "uniqueness_check":
        cols = list(rule.get("fields") or [field])
        across = rule.get("unique_across")
        if rule.get("normalize") == "name":
            return "name normalisation is a fuzzy key"
        tabs = {c.split(".")[0] for c in cols}
        if all({f"{t}.{k}" for k in D.keys(t)} <= set(cols) for t in tabs):
            return "the fields are the full table key, so a duplicate is a repeated row the extract collapses"

        def val(c: str, i: int) -> str:
            k = _kind(D, c)
            return {"num": str(1000 + i), "date": f"2020{1 + i // 28:02d}{1 + i % 28:02d}",
                    "timestamp": f"2020{1 + i // 28:02d}{1 + i % 28:02d}000000"}.get(k, f"UQ{i:03d}")
        recs = []
        for i in range(N):
            src = i - 1 if i in DEFECT else i  # a defect record repeats its predecessor's key
            r = {c: val(c, src) for c in cols}
            if across:
                r[across] = f"OWN{i:03d}"
            recs.append(r)
        return recs, DEFECT | {i - 1 for i in DEFECT}
    if cls == "cross_field_check":
        atoms, why = _cross_atoms(rule)
        if why:
            return why
        recs = []
        for i in range(N):
            r: dict = {}
            for j, (t, f) in enumerate(atoms):
                r.update(f if i not in DEFECT and j == i % len(atoms) else t)
            recs.append(r)
        return recs, DEFECT
    return f"{cls} needs reference data or a second dataset"


def bench_rule(rule: dict) -> dict:
    planned = _plan(rule)
    row = {"rule_id": rule["id"], "module": rule.get("module"), "check_class": rule.get("check_class")}
    if isinstance(planned, str):
        return {**row, "benchmarkable": False, "reason": planned}
    values, truth = planned
    scope = rule.get("applies_when") or {}
    clash = set(scope) & {k for v in values for k in v}
    if clash:
        return {**row, "benchmarkable": False, "reason": f"scope and check share field {sorted(clash)[0]}"}
    in_scope = {}
    for f, cond in scope.items():
        v = _scope_value(f, cond)
        if v is None:
            return {**row, "benchmarkable": False, "reason": f"no in-scope value derivable for {f}"}
        in_scope[f] = v
    values = [{**in_scope, **v} for v in values]
    df = _rows(rule, D, values)
    # the records must carry exactly the injected values (a join key would be re-keyed per record)
    for i, v in enumerate(values):
        for c, x in v.items():
            if str(df.at[i, c]).strip() != x.strip():
                return {**row, "benchmarkable": False, "reason": f"{c} is a key or join field"}
    _, res = run_rule(rule, TableFrames.from_flat(df, D, module=rule.get("module")), {})
    if res is None or res.error:
        got = set()
        row["error"] = (res.error if res else "rule did not evaluate")[:200]
    else:
        got = _failing_rows(res, df, D)
    tp, fp, fn = len(got & truth), len(got - truth), len(truth - got)
    p = tp / (tp + fp) if tp + fp else (1.0 if not truth else 0.0)
    r = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * p * r / (p + r) if p + r else 0.0
    return {**row, "benchmarkable": True, "records": N, "injected": len(truth), "true_positives": tp,
            "false_positives": fp, "false_negatives": fn, "precision": round(p, 4), "recall": round(r, 4),
            "f1": round(f1, 4)}


def run(modules=MODULES) -> dict:
    rules, modules_out = [], {}
    for m in modules:
        enabled = [r for r in module_rules(m) if r.get("enabled", True)]
        res = [bench_rule({**r, "module": r.get("module") or m}) for r in enabled]
        rules += res
        b = [x for x in res if x["benchmarkable"]]
        modules_out[m] = {"rules": len(enabled), "benchmarked": len(b),
                          "perfect": sum(x["precision"] == 1 and x["recall"] == 1 for x in b)}
    return {"method": "per-rule synthetic injection, truth derived from the rule's own YAML",
            "records_per_rule": N, "modules": modules_out, "rules": rules}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modules", default=",".join(MODULES))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    out = run(tuple(args.modules.split(",")))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    for m, s in out["modules"].items():
        print(f"{m:22s} {s['benchmarked']:4d}/{s['rules']:4d} benchmarked, {s['perfect']:4d} at 1.0/1.0")
    for x in out["rules"]:
        if x["benchmarkable"] and (x["precision"] < 1 or x["recall"] < 1):
            print(f"  {x['rule_id']:10s} {x['check_class']:20s} p={x['precision']:.3f} r={x['recall']:.3f} "
                  f"fp={x['false_positives']} fn={x['false_negatives']} {x.get('error', '')}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
