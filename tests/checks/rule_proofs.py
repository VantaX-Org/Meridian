"""Prove a rule: find one record it fails and one it passes, then re-run those
two alone and require exactly (population 2, failing 1). A rule that cannot
fail tests nothing; one that cannot pass condemns every record.

Candidate values per column come from the rule itself (allowed/reference
values, applies_when values, literals in its expression, a string generated
from its regex) plus typed SAP probes (blank, 0, X, dates old/today/future).
"""

from __future__ import annotations

import itertools
import re
try:  # Python ≥ 3.11 moved the regex parser
    from re import _constants as sre_constants, _parser as sre_parse
except ImportError:  # pragma: no cover
    import sre_constants
    import sre_parse
from datetime import date, datetime, timezone

import pandas as pd

from checks.frames import TableFrames, _graph, tables_of
from checks.runner import rule_columns, run_rule

TODAY = date.today().strftime("%Y%m%d")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
_PROBES = {
    "date": ["", "20000101", TODAY, "20991231", "99991231", NOW],
    "num": ["", "0", "1", "-1", "100", "1000000"],
    "char": ["", "X", "A", "1", "ZZ", "§§§"],
    "timestamp": ["", "20000101000000", NOW.replace("-", "").replace("T", "").replace(":", ""), "0"],
}
_DATE_TYPES = {"DATS", "DATE", "DATETIME", "TIMS"}
_NUM_TYPES = {"NUMC", "DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP", "DECIMAL", "INTEGER",
              "DF16_DEC", "DF34_DEC"}
MAX_ROWS = 3000


def sample_regex(pattern: str) -> str | None:
    """One string matching ``pattern`` (anchored like re.match), or None."""
    try:
        tree = sre_parse.parse(pattern)
    except Exception:
        return None

    def gen(items) -> str:
        out = []
        for op, av in items:
            if op is sre_constants.LITERAL:
                out.append(chr(av))
            elif op is sre_constants.NOT_LITERAL:
                out.append("A" if av != ord("A") else "B")
            elif op is sre_constants.ANY:
                out.append("A")
            elif op is sre_constants.IN:
                out.append(_in(av))
            elif op in (sre_constants.MAX_REPEAT, sre_constants.MIN_REPEAT):
                lo, hi, sub = av
                out.append(gen(sub) * max(lo, 1 if hi and hi >= 1 else 0))
            elif op is sre_constants.SUBPATTERN:
                out.append(gen(av[-1]))
            elif op is sre_constants.BRANCH:
                out.append(gen(av[1][0]))
            elif op in (sre_constants.AT, sre_constants.ASSERT, sre_constants.ASSERT_NOT):
                continue
            elif op is sre_constants.GROUPREF:
                out.append("")
            else:
                raise ValueError(op)
        return "".join(out)

    def _in(items) -> str:
        for op, av in items:
            if op is sre_constants.NEGATE:
                return "A"
            if op is sre_constants.LITERAL:
                return chr(av)
            if op is sre_constants.RANGE:
                return chr(av[0])
            if op is sre_constants.CATEGORY:
                return {"CATEGORY_DIGIT": "1", "CATEGORY_WORD": "A", "CATEGORY_SPACE": " "}.get(str(av).split(".")[-1], "A")
        return "A"

    try:
        s = gen(tree)
    except Exception:
        return None
    return s if re.match(pattern, s) else None


def _kind(dictionary, col: str) -> str:
    f = dictionary.resolve(col)
    t = (f.type or "").upper() if f else ""
    if f is not None and ("TSTMP" in f"{f.data_element}{f.domain}".upper() or (f.data_element or "") == "TIMESTAMP"):
        return "timestamp"
    return "date" if t in _DATE_TYPES else "num" if t in _NUM_TYPES else "char"


_PLACEMENT_SAMPLES = {"misplaced": ["ap@example.co.za", "www.acme.com", "0115551234", "GB82WEST12345698765432", "Acme"], "placeholder": ["N/A", "Acme"],
                      "swap": ["2196", "JOHANNESBURG"], "status_text": ["DO NOT USE", "Acme"],
                      "date_range": ["20991231", "20200101"], "change_before_create": ["20200101", "20210101"],
                      "vat_checksum": ["DE136695977", "DE136695976"]}
_FORMAT_SAMPLES = {"gtin": "4006381333931", "ean": "4006381333931", "iban": "GB82WEST12345698765432",
                   "luhn": "4539148803436467", "email": "ap@example.co.za", "date": TODAY}



def candidates(rule: dict, dictionary) -> dict[str, list[str]]:
    cols = rule_columns(rule)
    expr = rule.get("fail_when") or rule.get("condition") or ""
    literals = [a or b for a, b in re.findall(r"'([^']*)'|\"([^\"]*)\"", expr)]
    # columns compared with each other: also try "the same value as the other side"
    paired: dict[str, list[str]] = {}
    for a, b in re.findall(r"`([^`]+)`\s*(?:==|!=|<=|>=|<|>)\s*`([^`]+)`", expr):
        paired.setdefault(a, []).append(f"@={b}")
        paired.setdefault(b, []).append(f"@={a}")
    numbers = re.findall(r"(?<![\w.`])(-?\d+(?:\.\d+)?)(?![\w`])", expr)
    out = {}
    for c in cols:
        if c in (rule.get("group_by") or []):
            continue  # a group key (document number): each generated record is its own group
        vals: list[str] = []
        if c == rule.get("field") and expr and f"`{c}`" not in expr and not (rule.get("applies_when") or {}).get(c):
            continue  # a cross-field rule's anchor: keep the record id
        if rule.get("check_class") == "value_placement_check" and c in (rule.get("fields") or [rule["field"]]):
            vals += _PLACEMENT_SAMPLES[rule["family"]]
        if c == rule.get("split_field"):
            vals += [str(v) for v in rule["left_values"][:1] + rule["right_values"][:1]]
        if c == rule.get("field"):
            vals += [str(v) for v in (rule.get("allowed_values") or [])][:4]
            vals += [str(v) for v in (rule.get("reference_values") or [])][:4]
            if rule.get("format"):
                vals += [_FORMAT_SAMPLES.get(str(rule["format"]).lower(), "")]
            if rule.get("_live_value"):
                vals.insert(0, rule["_live_value"])
            if rule.get("pattern"):
                s = sample_regex(rule["pattern"])
                vals += [s] if s is not None else []
            f = dictionary.resolve(c)
            vals += sorted(f.allowed_values())[:3] if f is not None and f.allowed_values() else []
        aw = (rule.get("applies_when") or {}).get(c)
        if isinstance(aw, list):
            vals += [str(v) for v in aw[:3]]
        elif isinstance(aw, dict):
            vals += [str(v) for v in (aw.get("contains_any") or [])[:2]]
            vals += [""] if aw.get("blank") else ["N0"] if "not_in" in aw else ["X"]  # inside the scope
            if "gt" in aw:
                vals.append(str(float(aw["gt"]) + 1))
        if f"`{c}`" in expr:
            vals += literals[:4] + numbers[:4]
        vals += paired.get(c, [])[:1] + _PROBES[_kind(dictionary, c)]
        out[c] = list(dict.fromkeys(vals))[:10]
    return out


def _rows(rule: dict, dictionary, values: list[dict[str, str]]) -> pd.DataFrame:
    """Rows with every key/join field of the tables involved set to a per-row id."""
    cols = rule_columns(rule)
    tables = set(tables_of(cols))
    edges, _ = _graph()
    tf = TableFrames({t: pd.DataFrame() for t in tables | {x for e in edges for x in (e.parent, e.child)}},
                     dictionary, module=rule.get("module"))
    tables |= tf.path_tables(cols, grain=rule.get("grain")) or set()
    joined = {f"{e.child}.{c}" for e in edges if e.parent in tables and e.child in tables for c, _ in e.on} | \
             {f"{e.parent}.{p}" for e in edges if e.parent in tables and e.child in tables for _, p in e.on}
    recs = []
    for i, v in enumerate(values):
        r = {f"{t}.{k}": f"K{i}" for t in tables for k in dictionary.keys(t)}
        for e in edges:
            if e.parent in tables and e.child in tables:
                for c, p in e.on:
                    r[f"{e.child}.{c}"] = r[f"{e.parent}.{p}"] = r.get(f"{e.parent}.{p}", f"K{i}")
                for f, fv in e.filter + e.prefer:
                    r[f"{e.child}.{f}"] = fv
        same = {k: x[2:] for k, x in v.items() if isinstance(x, str) and x.startswith("@=")}
        v = {k: x for k, x in v.items() if k not in same}
        for k, x in v.items():  # a join field keeps its partner in step, so records still link
            if x and k in joined and x != rule.get("_live_value"):  # the live code must stay as the reference has it
                x = f"{x}{i}"
            r[k] = x
            for e in edges:
                if e.parent in tables and e.child in tables:
                    for c, p in e.on:
                        if k == f"{e.child}.{c}":
                            r[f"{e.parent}.{p}"] = x
                        elif k == f"{e.parent}.{p}":
                            r[f"{e.child}.{c}"] = x
        for k, other in same.items():  # "the same value as the other side", after every other value is set
            r[k] = r.get(other, "")
        recs.append(r)
    return pd.DataFrame(recs)


def _failing_rows(result, df: pd.DataFrame, dictionary) -> set[int]:
    failing = set(result.failing_record_keys or [])
    keys = [k for k in (result.details or {}).get("record_key_fields") or [] if k in df.columns]
    if not keys:
        return {int(m) for k in failing for m in re.findall(r"K(\d+)", k)[:1]}
    rk = df[keys].astype("string").fillna("").apply(lambda s: s.str.strip())
    strings = rk.apply(lambda r: "|".join(f"{c.split('.')[-1]}={r[c]}" for c in keys), axis=1)
    return {i for i, v in strings.items() if v in failing}


def prove(rule: dict, dictionary) -> tuple[str, str]:
    """(verdict, detail): proven | never_fails | never_passes | not_applicable | error."""
    live = {}
    if rule.get("check_class") in ("referential_check", "domain_value_check") and not (
            rule.get("allowed_values") or rule.get("reference_values") or rule.get("format")):
        from checks.runner import _with_reference
        key = _with_reference(rule, dictionary, {}).get("_reference_key")
        if key:
            live = {key: {"LV1", "L", "V", "1"}}  # single characters for multi-value code lists
            rule = {**rule, "_live_value": "LV1"}
    cand = candidates(rule, dictionary)
    cols = list(cand)
    if rule.get("check_class") == "uniqueness_check":
        aw = rule.get("applies_when") or {}
        dup = {c: cand[c][0] if c in aw else (cand[c][1] if len(cand[c]) > 1 else "X") for c in cols}
        # two records sharing the value but differing elsewhere (not a repeated flat row)
        grain = tables_of(cols)[0]
        other = next((f"{grain}.{f.name}" for f in dictionary.table(grain).fields.values()
                      if f.name not in dictionary.keys(grain) and f"{grain}.{f.name}" not in cols), None)
        a, b = dict(dup), dict(dup)
        if other:
            a[other], b[other] = "D1", "D2"
        rows = [{**{c: dup[c] if c in aw else f"U{c[-3:]}" for c in cols}, **({other: "D3"} if other else {})}, a, b]
        return _verify(rule, dictionary, rows, (3, 2), live)
    if rule.get("check_class") == "interval_check":
        # one group: two adjoining periods, then a third starting inside the first
        g = {c: "G1" for c in rule["group_by"]}
        s, e = rule["start"], rule["end"]
        rows = [{**g, s: "20200101", e: "20201231"}, {**g, s: "20210101", e: "99991231"},
                {**g, s: "20200601", e: "20200630"}]
        return _verify(rule, dictionary, rows, (3, 1), live)
    if rule.get("check_class") == "aggregate_check":
        return _prove_aggregate(rule, dictionary, cand, live)
    if rule.get("check_class") == "exists_check":
        return _prove_exists(rule, dictionary, cand, live)
    if rule.get("check_class") == "similarity_check":
        # one block: a typo'd near-duplicate pair and an unrelated name (expected: 3 in scope, 2 failing)
        block = {c: "B1" for c in rule.get("block_by") or []}
        rows = [{**block, rule["field"]: n} for n in ("ACME ENGINEERING WORKS", "ACME ENGINERING WORKS",
                                                       "ZULU FREIGHT SERVICES")]
        return _verify(rule, dictionary, rows, (3, 2), live)
    combos = itertools.product(*(cand[c] for c in cols))
    values = [dict(zip(cols, combo)) for combo in itertools.islice(combos, MAX_ROWS)]
    df = _rows(rule, dictionary, values)
    frames = TableFrames.from_flat(df, dictionary, module=rule.get("module"))
    _, result = run_rule(rule, frames, live)
    if result is None:
        return "not_applicable", "no result on generated records"
    if result.error:
        return "error", result.error
    failing = _failing_rows(result, df, dictionary)
    if not failing:
        return "never_fails", f"no candidate record fails ({len(values)} tried)"
    must_blank = {c for c, a in (rule.get("applies_when") or {}).items() if isinstance(a, dict) and a.get("blank")}
    # populated records first (a blank the rule's scope requires does not count)
    blanks = lambda i: sum(1 for c, x in values[i].items() if x == "" and c not in must_blank)  # noqa: E731
    passing = sorted((i for i in range(len(values)) if i not in failing), key=blanks)
    bad = sorted(failing, key=blanks)
    for tries, p in enumerate(passing[:600]):
        for f in bad[: 1 if tries >= 50 else 4]:  # the first failing record may sit outside the population
            verdict = _verify(rule, dictionary, [values[p], values[f]], (2, 1), live)
            if verdict[0] == "proven":
                return verdict
    return ("never_passes" if len(failing) >= result.total_count else "not_applicable",
            f"{len(failing)}/{result.total_count} fail; no passing record in the population")


def _verify(rule, dictionary, rows, expected, live=None) -> tuple[str, str]:
    frames = TableFrames.from_flat(_rows(rule, dictionary, rows), dictionary, module=rule.get("module"))
    _, r = run_rule(rule, frames, live or {})
    if r is None:
        return "not_applicable", "no result on the proof records"
    if r.error:
        return "error", r.error
    got = (r.total_count, r.affected_count)
    return ("proven", f"good={rows[0]} bad={rows[-1]}") if got == expected else ("unproven", f"{got} != {expected}")


def _prove_aggregate(rule, dictionary, cand, live) -> tuple[str, str]:
    """Two groups in the rule's scope: one whose totals agree, one whose totals differ
    the way the rule looks for (expected: 2 groups, 1 failing)."""
    aw = rule.get("applies_when") or {}
    row = {c: cand[c][0] for c in cand if c in aw}
    if rule.get("sign_field"):
        row[rule["sign_field"]] = rule.get("debit_value", "S")
    left, right, amt = rule["left_values"][0], rule["right_values"][0], rule["amount"]
    off = "16" if rule.get("compare") == "right_gt_left" else "4"
    rows = [{**row, rule["split_field"]: left, amt: "10"}, {**row, rule["split_field"]: right, amt: "10"},
            {**row, rule["split_field"]: left, amt: "10"}, {**row, rule["split_field"]: right, amt: off}]
    df = _rows(rule, dictionary, rows)
    edges, _ = _graph()
    for c in rule["group_by"]:  # each pair of rows is one group, on both sides of every join
        same = {c} | {f"{e.parent}.{p}" for e in edges for ch, p in e.on if f"{e.child}.{ch}" == c} | \
               {f"{e.child}.{ch}" for e in edges for ch, p in e.on if f"{e.parent}.{p}" == c}
        for col in same & set(df.columns):
            df[col] = ["G1", "G1", "G2", "G2"]
    _, r = run_rule(rule, TableFrames.from_flat(df, dictionary, module=rule.get("module")), live or {})
    if r is None:
        return "not_applicable", "no result on the proof records"
    if r.error:
        return "error", r.error
    got = (r.total_count, r.affected_count)
    return ("proven", f"groups={rows}") if got == (2, 1) else ("unproven", f"{got} != (2, 1)")


def _prove_exists(rule, dictionary, cand, live) -> tuple[str, str]:
    """One record referencing an existing, active target and one referencing a record that
    is not there (expected: 2 in scope, 1 failing). A third target record is inactive."""
    aw = rule.get("applies_when") or {}
    refs = list(rule.get("fields") or [rule["field"]])
    # an in-scope value: the field's own candidates lead with its dictionary values, not the scope's
    row = {c: str(aw[c][0]) if isinstance(aw[c], list) else cand[c][0] for c in cand if c in aw}
    rows = [{**row, **{c: f"T1{i}" for i, c in enumerate(refs)}},
            {**row, **{c: f"T9{i}" for i, c in enumerate(refs)}}]
    df = _rows(rule, dictionary, rows)
    frames = TableFrames.from_flat(df, dictionary, module=rule.get("module"))
    t = rule["target_table"]
    target = {f"{t}.{k}": ["TK1"] for k in dictionary.keys(t)}
    for i, f in enumerate(rule["target_fields"]):
        target[f"{t}.{f}"] = [f"T1{i}"]
    for f, cond in (rule.get("target_when") or {}).items():
        target[f"{t}.{f}"] = ["" if isinstance(cond, dict) and cond.get("blank") else str((cond or [""])[0])]
    extra = pd.DataFrame(target)
    have = frames.frames.get(t)
    frames.frames[t] = extra if have is None else pd.concat([have, extra], ignore_index=True)
    _, r = run_rule(rule, frames, live or {})
    if r is None:
        return "not_applicable", "no result on the proof records"
    if r.error:
        return "error", r.error
    got = (r.total_count, r.affected_count)
    return ("proven", f"refs={rows}") if got == (2, 1) else ("unproven", f"{got} != (2, 1)")
