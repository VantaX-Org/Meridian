"""Deterministic auto-cleansing: a rule's ``auto_fix`` turns a failing record into a
corrected value with a confidence (docs/rules/auto-fix.md).

``propose(rule, record, refs)`` runs the rule's step pipeline on one record.
``proposals(...)`` runs it over a frame's failing rows and keeps only values the
rule itself accepts (the rule is re-evaluated on the corrected rows).
Legacy ``fix_value`` (scalar or map) is sugar for ``set`` / ``map``.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

import numpy as np
import pandas as pd

CONFIDENCE = ("high", "medium", "low")
LEGACY_CONFIDENCE = "medium"  # fix_value is a steward-authored default, never bulk auto-approved
BLANK, OTHER = "__blank__", "__other__"

# op -> {param: (type, required)}
OPS: dict[str, dict[str, tuple[type | tuple, bool]]] = {
    "strip": {}, "collapse_spaces": {}, "upper": {}, "lower": {}, "title": {},
    "pad_left": {"width": (int, True), "char": (str, False)},
    "strip_leading_zeros": {},
    "regex_replace": {"pattern": (str, True), "repl": (str, True)},
    "truncate": {"width": (int, True)},
    "map": {"values": (dict, True)},
    "set": {"value": ((str, int, float), True)},
    "copy": {"from": (str, True)},
    "lookup": {"table": (str, True), "match": (dict, True), "value": (str, True)},
    "date_format": {"to": (str, True)},
    "gtin_check_digit": {},
}

# ponytail: per-rule cap on proposals computed in one run; raise with findings.record_fixes storage
MAX_PROPOSALS = 10_000

_COLUMN = re.compile(r"^[A-Za-z][A-Za-z0-9_/]*\.[A-Za-z][A-Za-z0-9_/]*$")
# quoted / backticked spans pass through; a bare TABLE.FIELD is backticked for df.eval
_GUARD_TOKEN = re.compile(r"('[^']*'|\"[^\"]*\"|`[^`]+`)|\b([A-Z][A-Z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)\b")
_DATE_FORMATS = ("%Y%m%d", "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y",
                 "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%d %b %Y", "%d %B %Y")
_SF_DATE = re.compile(r"^/Date\((-?\d+)(?:[+-]\d+)?\)/$")


def _spec(rule: dict) -> Optional[dict]:
    """The rule's auto_fix, with legacy fix_value desugared; None when it has neither."""
    if rule.get("auto_fix"):
        return rule["auto_fix"]
    fv = rule.get("fix_value")
    if fv is None:
        return None
    step = {"op": "map", "values": fv} if isinstance(fv, dict) else {"op": "set", "value": fv}
    return {"steps": [step], "confidence": LEGACY_CONFIDENCE}


def enabled(rule: dict) -> bool:
    return _spec(rule) is not None


# ── validation ───────────────────────────────────────────────────────────────


def _guard(expr: str) -> str:
    return _GUARD_TOKEN.sub(lambda m: m.group(1) or f"`{m.group(2)}`", expr)


def _guard_columns(expr: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"`([^`]+)`", _guard(expr))))


def columns(rule: dict) -> list[str]:
    """Record columns auto_fix reads besides the rule's field (guard, copy, lookup match)."""
    spec = rule.get("auto_fix") or {}
    cols = _guard_columns(spec["when"]) if isinstance(spec.get("when"), str) else []
    for s in spec.get("steps") or []:
        if isinstance(s, dict) and s.get("op") == "copy":
            cols.append(s.get("from"))
        if isinstance(s, dict) and s.get("op") == "lookup":
            cols += list((s.get("match") or {}).values())
    return [c for c in dict.fromkeys(cols) if isinstance(c, str) and _COLUMN.match(c)]


def reference_columns(rule: dict) -> list[str]:
    """Reference-table columns ``lookup`` reads (kept by extraction column pruning)."""
    out = []
    for s in (rule.get("auto_fix") or {}).get("steps") or []:
        if isinstance(s, dict) and s.get("op") == "lookup" and isinstance(s.get("match"), dict):
            out += [f"{s.get('table')}.{f}" for f in [*s["match"], s.get("value")]]
    return out


def validate_auto_fix(rule: dict) -> list[str]:
    """Errors in the rule's ``auto_fix`` block; [] when valid or absent."""
    spec = rule.get("auto_fix")
    if spec is None:
        return []
    rid = rule.get("id", "?")
    if not isinstance(spec, dict):
        return [f"{rid}: auto_fix must be a mapping"]
    errors = [f"{rid}: auto_fix: unknown key '{k}'" for k in spec if k not in ("when", "steps", "confidence")]
    if rule.get("fix_value") is not None:
        errors.append(f"{rid}: auto_fix and fix_value are exclusive (fix_value is sugar for auto_fix)")
    if not rule.get("field"):
        errors.append(f"{rid}: auto_fix needs the rule's field")
    if spec.get("confidence") not in CONFIDENCE:
        errors.append(f"{rid}: auto_fix.confidence must be one of {', '.join(CONFIDENCE)}")
    if "when" in spec:
        if not isinstance(spec["when"], str) or not spec["when"].strip():
            errors.append(f"{rid}: auto_fix.when must be a non-empty expression")
        else:
            cols = _guard_columns(spec["when"])
            try:
                pd.DataFrame({c: pd.Series(dtype="string") for c in cols}).eval(_guard(spec["when"]), engine="python")
            except Exception as e:
                errors.append(f"{rid}: auto_fix.when does not parse: {e}")
    steps = spec.get("steps")
    if not isinstance(steps, list) or not steps:
        return errors + [f"{rid}: auto_fix.steps must be a non-empty list"]
    for n, step in enumerate(steps, 1):
        where = f"{rid}: auto_fix.steps[{n}]"
        if not isinstance(step, dict) or step.get("op") not in OPS:
            errors.append(f"{where}: unknown op {step.get('op') if isinstance(step, dict) else step!r}")
            continue
        params = OPS[step["op"]]
        errors += [f"{where}: {step['op']} has unknown parameter '{k}'" for k in step if k != "op" and k not in params]
        for k, (typ, required) in params.items():
            if k not in step:
                if required:
                    errors.append(f"{where}: {step['op']} needs '{k}'")
            elif not isinstance(step[k], typ) or isinstance(step[k], bool):
                errors.append(f"{where}: {step['op']}.{k} has the wrong type")
        if step["op"] in ("pad_left", "truncate") and isinstance(step.get("width"), int) and step["width"] <= 0:
            errors.append(f"{where}: width must be positive")
        if step["op"] == "pad_left" and len(step.get("char", "0")) != 1:
            errors.append(f"{where}: pad_left.char must be one character")
        if step["op"] == "regex_replace" and isinstance(step.get("pattern"), str):
            try:
                re.compile(step["pattern"])
            except re.error as e:
                errors.append(f"{where}: bad pattern: {e}")
        if step["op"] == "copy" and isinstance(step.get("from"), str) and not _COLUMN.match(step["from"]):
            errors.append(f"{where}: copy.from must be TABLE.FIELD")
        if step["op"] == "lookup" and isinstance(step.get("match"), dict):
            if not step["match"] or not all(isinstance(v, str) and _COLUMN.match(v) for v in step["match"].values()):
                errors.append(f"{where}: lookup.match must map lookup fields to record TABLE.FIELD columns")
        if step["op"] == "date_format" and isinstance(step.get("to"), str):
            try:
                datetime(2000, 1, 2).strftime(step["to"])
            except ValueError as e:
                errors.append(f"{where}: bad date format: {e}")
    return errors


# ── ops ──────────────────────────────────────────────────────────────────────


def _text(v: Any) -> Optional[str]:
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    return str(v)


def _map(values: dict, cur: str) -> Optional[str]:
    key = cur.strip()
    hit = values[BLANK] if key == "" and BLANK in values else values.get(key, values.get(OTHER))
    return _text(hit)


def _date(v: str, to: str) -> Optional[str]:
    v = v.strip()
    if v in ("", "00000000"):
        return None
    sf = _SF_DATE.match(v)
    if sf:
        return (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=int(sf.group(1)))).strftime(to)
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(v, fmt).strftime(to)
        except ValueError:
            continue
    return None


def gtin_check_digit(v: str) -> Optional[str]:
    """``v`` with its GS1 mod-10 check digit recomputed (EAN-8, UPC-12, EAN-13, GTIN-14)."""
    v = v.strip()
    if not v.isdigit() or len(v) not in (8, 12, 13, 14):
        return None
    body = v[:-1]
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return body + str((10 - total % 10) % 10)


_INDEX: dict[tuple, tuple[pd.DataFrame, dict]] = {}


def _lookup(step: dict, record: dict, refs: dict) -> Optional[str]:
    table = step["table"]
    ref = (refs or {}).get(table)
    if ref is None:
        return None
    fields = [f"{table}.{f}" for f in step["match"]]
    target = f"{table}.{step['value']}"
    if any(c not in ref.columns for c in fields + [target]):
        return None
    ck = (table, tuple(fields), target)
    cached = _INDEX.get(ck)
    if cached is None or cached[0] is not ref:  # rebuilt when the reference frame changes
        rows = ref[fields + [target]].astype("string").apply(lambda s: s.str.strip()).dropna()
        idx: dict[tuple, set] = {}
        for *k, val in rows.itertuples(index=False):
            idx.setdefault(tuple(k), set()).add(val)
        if len(_INDEX) > 64:
            _INDEX.clear()
        _INDEX[ck] = cached = (ref, idx)
    key = tuple((_text(record.get(c)) or "").strip() for c in step["match"].values())
    vals = cached[1].get(key, set())
    return next(iter(vals)) if len(vals) == 1 else None  # absent or ambiguous: no proposal


def _apply(step: dict, v: str, record: dict, refs: dict) -> Optional[str]:
    op = step["op"]
    if op == "strip":
        return v.strip()
    if op == "collapse_spaces":
        return re.sub(r"\s+", " ", v)
    if op in ("upper", "lower", "title"):
        return getattr(v, op)()
    if op == "pad_left":
        return v.rjust(step["width"], step.get("char", "0"))
    if op == "strip_leading_zeros":
        return v.lstrip("0")
    if op == "regex_replace":
        return re.sub(step["pattern"], step["repl"], v)
    if op == "truncate":
        return v[: step["width"]]
    if op == "map":
        return _map(step["values"], v)
    if op == "set":
        return _text(step["value"])
    if op == "copy":
        return _text(record.get(step["from"]))
    if op == "lookup":
        return _lookup(step, record, refs)
    if op == "date_format":
        return _date(v, step["to"])
    if op == "gtin_check_digit":
        return gtin_check_digit(v)
    raise ValueError(f"unknown auto_fix op '{op}'")


def _steps(spec: dict, field: str, record: dict, refs: dict) -> Optional[tuple[str, str]]:
    current = _text(record.get(field))
    v = current or ""
    for step in spec["steps"]:
        out = _apply(step, v, record, refs)
        if out is None or (out == "" and v != ""):
            return None  # a step that cannot produce a value: no proposal
        v = out
    if v == "" or v == current:
        return None
    return v, spec.get("confidence", LEGACY_CONFIDENCE)


def _guard_mask(expr: str, df: pd.DataFrame) -> pd.Series:
    from checks.types.cross_field_check import typed
    cols = _guard_columns(expr)
    if any(c not in df.columns for c in cols):
        return pd.Series(False, index=df.index)  # guard column not extracted: never fires
    out = typed(df, cols).eval(_guard(expr), engine="python")
    out = out if isinstance(out, pd.Series) else pd.Series(out, index=df.index)
    return out.astype("boolean").fillna(False).astype(bool)


# ── public API ───────────────────────────────────────────────────────────────


def propose(rule: dict, record: dict, refs: dict | None = None) -> Optional[tuple[str, str]]:
    """``(proposed value, confidence)`` for one record (``{"TABLE.FIELD": value}``), or None.

    ``refs`` maps table name to its frame (``TableFrames.frames``) for ``lookup``."""
    spec, field = _spec(rule), rule.get("field")
    if spec is None or not field:
        return None
    if spec.get("when") and not _guard_mask(spec["when"], pd.DataFrame([record])).iloc[0]:
        return None
    return _steps(spec, field, record, refs or {})


def proposals(rule: dict, df: pd.DataFrame, rows: pd.Series, refs: dict | None = None,
              evaluate: Callable[[pd.DataFrame], Any] | None = None) -> dict[int, tuple[str, str]]:
    """Self-verified proposals for ``df``'s ``rows`` (bool mask): ``{position: (value, confidence)}``.

    ``evaluate`` is the rule's check (``BaseCheck.evaluate``); the corrected frame is
    re-evaluated and any proposal whose row still fails is dropped. Without
    ``evaluate`` proposals are unverified."""
    spec, field = _spec(rule), rule.get("field")
    if spec is None or not field or field not in df.columns:
        return {}
    pos = np.flatnonzero(np.asarray(rows, dtype=bool))[:MAX_PROPOSALS]
    sub = df.iloc[pos]
    guard = _guard_mask(spec["when"], sub).to_numpy() if spec.get("when") else np.ones(len(sub), bool)
    out = {}
    for p, ok, rec in zip(pos, guard, sub.to_dict("records")):
        hit = _steps(spec, field, rec, refs or {}) if ok else None
        if hit:
            out[int(p)] = hit
    if not out or evaluate is None:
        return out
    fixed = df[field].astype(object).to_numpy(copy=True)
    for p, (v, _) in out.items():
        fixed[p] = v
    try:
        ev = evaluate(df.assign(**{field: fixed}))
    except Exception:
        return {}  # cannot verify: never propose blind
    if ev is None:
        return {}
    still = np.asarray(ev.failing, dtype=bool)
    return {p: v for p, v in out.items() if not still[p]}
