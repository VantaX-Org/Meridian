"""Fix simulation (what-if): apply proposed fixes to a COPY of the extracted frames,
re-run the checks and report what would change.

Nothing here touches SAP or the stored extraction: the patched frames live only in
the worker's memory for the duration of the task. Fix sources:

* uploaded value maps — ``{"LFB1.ZTERM": {"0001": "Z030", "__blank__": "Z030"}}``,
  applied to every row of the column;
* a rule's ``auto_fix`` / ``fix_value`` (checks/auto_fix.propose) or its
  single-option ``value_fix_map`` suggestion, applied to the rule's failing records;
* remediation batch items (``field``, ``record_key``, ``proposed_value``), applied per record.

Pure functions only — the Celery task (workers/tasks/run_simulation.py) does the I/O.
"""

from __future__ import annotations

import copy
from typing import Iterable, Optional

import pandas as pd

from checks import auto_fix
from checks.base import CheckResult, is_blank, pass_rate_of, record_keys
from checks.frames import TableFrames

BLANK = "__blank__"
OTHER = "__other__"


# ── fix plan ─────────────────────────────────────────────────────────────────


def _suggested(result: CheckResult, current: Optional[str]) -> Optional[str]:
    """The FixGenerator's single-option suggestion for this invalid value, if any."""
    entry = (result.value_fix_map or {}).get("" if current is None else str(current).strip())
    return (entry or {}).get("suggested_value") or None


def _frame(frames: TableFrames, cols: list[str], grain: Optional[str]):
    try:
        return frames.frame_for(list(dict.fromkeys(cols)), grain=grain)
    except ValueError:
        return None


def rule_record_fixes(rule: dict, result: CheckResult, frames: TableFrames) -> list[dict]:
    """Record fixes for one failing rule: ``[{field, record_key, new_value}]``.

    The proposal comes from the rule's ``auto_fix`` / ``fix_value`` (checks/auto_fix.propose), else from the value fix map's
    single-option suggestion. Records with no proposal are left alone."""
    field, keys = rule.get("field") or result.field, set(result.failing_record_keys or [])
    if not field or "." not in field or not keys:
        return []
    built = _frame(frames, [field, *auto_fix.columns(rule)], result.grain or rule.get("grain")) \
        or _frame(frames, [field], result.grain or rule.get("grain"))
    if built is None:
        return []
    df, _, key_cols = built
    rk = record_keys(df, key_cols)
    hit = rk.isin(keys)
    out = []
    for key, rec in zip(rk[hit], df[hit].to_dict("records")):
        cur = None if pd.isna(rec[field]) else str(rec[field])
        p = auto_fix.propose(rule, rec, frames.frames)
        new = _suggested(result, cur) if p is None else p[0]
        if new is not None and new != (cur or "").strip():
            out.append({"field": field, "record_key": str(key), "new_value": new})
    return out


# ── patching ─────────────────────────────────────────────────────────────────


def _key_parts(record_key: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in record_key.split("|") if "=" in p)


def _map_column(s: pd.Series, mapping: dict[str, str]) -> tuple[pd.Series, int]:
    cur = s.astype("string").str.strip()
    plain = {k: v for k, v in mapping.items() if k not in (BLANK, OTHER)}
    new = cur.map(plain)
    if BLANK in mapping:
        new = new.mask(is_blank(s) & new.isna(), mapping[BLANK])
    changed = new.notna() & (new != cur.fillna(""))
    if not changed.any():
        return s, 0
    out = s.astype("object").copy()
    out[changed] = new[changed]
    return out, int(changed.sum())


def _patch_records(df: pd.DataFrame, table: str, field: str, fixes: dict[str, str],
                   key_names: list[str]) -> tuple[pd.DataFrame, int, int]:
    """Set ``field`` on the rows whose ``table`` key matches. Returns (df, cells changed, unmatched fixes).

    A record key at a child grain (LFB1: LIFNR|BUKRS) narrows to the parent's key (LFA1: LIFNR)."""
    cols = [f"{table}.{k}" for k in key_names]
    want: dict[str, str] = {}
    narrowed: list[Optional[str]] = []
    for rk, val in fixes.items():
        parts = _key_parts(rk)
        key = "|".join(f"{k}={parts[k].strip()}" for k in key_names) \
            if key_names and all(k in parts for k in key_names) else None
        narrowed.append(key)
        if key is not None:
            want[key] = val
    if not want or field not in df.columns or any(c not in df.columns for c in cols):
        return df, 0, len(fixes)
    rk = record_keys(df, cols)
    hit = rk.isin(want)
    found = set(rk[hit])
    unmatched = sum(1 for k in narrowed if k not in found)  # row:i keys or keys with no record
    new = rk[hit].map(want)
    idx = new[new != df.loc[hit, field].astype("string").str.strip().fillna("")].index
    if not len(idx):
        return df, 0, unmatched
    df = df.copy()
    df[field] = df[field].astype("object")
    df.loc[idx, field] = new[idx]
    return df, len(idx), unmatched


def apply_fixes(frames: TableFrames, value_maps: dict[str, dict[str, str]] | None = None,
                record_fixes: Iterable[dict] | None = None) -> tuple[TableFrames, dict]:
    """A patched copy of ``frames`` (untouched tables shared, touched ones copied).

    Returns (patched frames, stats) with stats = {cells_changed, by_field, unmatched,
    tables}. ``frames`` itself is never modified."""
    out = copy.copy(frames)
    out.frames = dict(frames.frames)
    out._cache = {}
    out.flat = frames.flat
    by_field: dict[str, int] = {}
    unmatched = 0
    touched: set[str] = set()

    def bump(field: str, n: int) -> None:
        if n:
            by_field[field] = by_field.get(field, 0) + n
            touched.add(field.split(".")[0])

    for field, mapping in (value_maps or {}).items():
        table = field.split(".")[0]
        if table in out.frames and field in out.frames[table].columns:
            col, n = _map_column(out.frames[table][field], mapping)
            if n:
                out.frames[table] = out.frames[table].assign(**{field: col})
            bump(field, n)
        if out.flat is not None and field in out.flat.columns:
            col, n = _map_column(out.flat[field], mapping)
            if n:
                out.flat = out.flat.assign(**{field: col})
                if table not in out.frames:
                    bump(field, n)  # flat-only table; split tables already counted

    grouped: dict[str, dict[str, str]] = {}
    for f in record_fixes or []:
        grouped.setdefault(f["field"], {})[f["record_key"]] = str(f["new_value"])
    for field, fixes in grouped.items():
        table = field.split(".")[0]
        names = list(out.dictionary.keys(table))
        if table in out.frames:
            out.frames[table], n, miss = _patch_records(out.frames[table], table, field, fixes, names)
        elif out.flat is not None:
            out.flat, n, miss = _patch_records(out.flat, table, field, fixes, names)
        else:
            n, miss = 0, len(fixes)
        bump(field, n)
        unmatched += miss
    return out, {"cells_changed": sum(by_field.values()), "by_field": by_field,
                 "unmatched_records": unmatched, "tables": sorted(touched)}


# ── before / after ───────────────────────────────────────────────────────────


def _status(b: Optional[CheckResult], a: Optional[CheckResult]) -> str:
    if b is None:
        return "newly_evaluated"
    if a is None:
        return "not_evaluated"
    if b.passed and not a.passed:
        return "newly_failing"
    if a.affected_count < b.affected_count:
        return "resolved" if a.passed else "improved"
    if a.affected_count > b.affected_count:
        return "regressed"
    return "unchanged"


def diff_results(before: list[CheckResult], after: list[CheckResult],
                 targeted: set[str] | None = None) -> dict:
    """Per-rule before/after counts, records resolved / introduced and side effects.

    A side effect is a rule outside ``targeted`` whose failing records grew."""
    targeted = targeted or set()
    b = {(r.module, r.check_id): r for r in before if not r.error}
    a = {(r.module, r.check_id): r for r in after if not r.error}
    rules = []
    for key in sorted(b.keys() | a.keys()):
        rb, ra = b.get(key), a.get(key)
        kb, ka = set((rb and rb.failing_record_keys) or []), set((ra and ra.failing_record_keys) or [])
        ref = ra or rb
        rules.append({
            "module": key[0], "check_id": key[1], "field": ref.field, "severity": ref.severity,
            "dimension": ref.dimension, "targeted": key[1] in targeted,
            "before": None if rb is None else {"failing": rb.affected_count, "total": rb.total_count,
                                               "pass_rate": rb.pass_rate, "passed": rb.passed},
            "after": None if ra is None else {"failing": ra.affected_count, "total": ra.total_count,
                                              "pass_rate": ra.pass_rate, "passed": ra.passed},
            "records_resolved": len(kb - ka), "records_introduced": len(ka - kb),
            "status": _status(rb, ra),
        })
    changed = [r for r in rules if r["status"] != "unchanged" or r["records_introduced"]]
    side = [r for r in changed if not r["targeted"]
            and (r["records_introduced"] or r["status"] in ("newly_failing", "regressed"))
            and (r["after"] or {}).get("failing", 0) > 0]
    failing_b = {k for k, r in b.items() if not r.passed}
    failing_a = {k for k, r in a.items() if not r.passed}
    return {
        "rules": changed,
        "unchanged_rules": len(rules) - len(changed),
        "side_effects": side,
        "findings": {"before": len(failing_b), "after": len(failing_a),
                     "resolved": len(failing_b - failing_a), "introduced": len(failing_a - failing_b)},
        "records": {"resolved": sum(r["records_resolved"] for r in rules),
                    "introduced": sum(r["records_introduced"] for r in rules)},
    }


def dqs_summary(results: list[CheckResult], weights: dict | None) -> dict:
    """{composite, dimension_scores, modules, capped} with the tenant's DQS weights."""
    from api.routes.findings import composite_dqs
    from api.services.scoring import score_all_modules
    return composite_dqs([{m: r.model_dump() for m, r in score_all_modules(results, weights).items()}])


def _delta(b: Optional[float], a: Optional[float]) -> Optional[float]:
    return None if b is None or a is None else round(a - b, 2)


def dqs_delta(before: list[CheckResult], after: list[CheckResult], weights: dict | None) -> dict:
    """DQS before vs after: overall, per module and per dimension."""
    sb, sa = dqs_summary(before, weights), dqs_summary(after, weights)
    mods = sorted(sb.get("modules", {}).keys() | sa.get("modules", {}).keys())
    dims = sorted(sb.get("dimension_scores", {}).keys() | sa.get("dimension_scores", {}).keys())
    return {
        "overall": {"before": sb.get("composite"), "after": sa.get("composite"),
                    "delta": _delta(sb.get("composite"), sa.get("composite")),
                    "capped_before": sb.get("capped", False), "capped_after": sa.get("capped", False)},
        "modules": [{"module": m, "before": sb["modules"].get(m), "after": sa["modules"].get(m),
                     "delta": _delta(sb["modules"].get(m), sa["modules"].get(m))} for m in mods],
        "dimensions": [{"dimension": d, "before": sb["dimension_scores"].get(d),
                        "after": sa["dimension_scores"].get(d),
                        "delta": _delta(sb["dimension_scores"].get(d), sa["dimension_scores"].get(d))}
                       for d in dims],
    }


def feature_impact(results: list[CheckResult], impact_rules: dict[str, list[dict]]) -> dict[tuple, str]:
    """(module, target_feature) -> worst impact type over the failing checks."""
    from agents.config_impact import _worst_impact
    out: dict[tuple, str] = {}
    for r in results:
        if r.passed or r.error:
            continue
        for rule in impact_rules.get(r.check_id, []):
            k = (rule["module"], rule["target_feature"])
            out[k] = _worst_impact(out.get(k, "ok"), rule.get("impact_type", "cosmetic"))
    return out


def impact_delta(before: list[CheckResult], after: list[CheckResult],
                 impact_rules: dict[str, list[dict]]) -> list[dict]:
    """Config-impact features whose status changes: unblocked, improved or worsened."""
    from agents.config_impact import _IMPACT_RANK
    fb, fa = feature_impact(before, impact_rules), feature_impact(after, impact_rules)
    out = []
    for k in sorted(fb.keys() | fa.keys()):
        b, a = fb.get(k, "ok"), fa.get(k, "ok")
        rb, ra = _IMPACT_RANK.get(b, 0), _IMPACT_RANK.get(a, 0)
        if rb == ra:
            continue
        change = "unblocked" if b == "full_block" else "improved" if ra < rb else "worsened"
        out.append({"module": k[0], "feature": k[1], "before": b, "after": a, "change": change})
    return out


# ── best next fixes ──────────────────────────────────────────────────────────


def _reduce(results: list[CheckResult], resolved: dict[tuple, set[str]]) -> list[CheckResult]:
    out = []
    for r in results:
        gone = resolved.get((r.module, r.check_id))
        if not gone or r.error:
            out.append(r)
            continue
        left = [k for k in (r.failing_record_keys or []) if k not in gone]
        affected = max(0, r.affected_count - ((len(r.failing_record_keys or [])) - len(left)))
        out.append(r.model_copy(update={"affected_count": affected, "failing_record_keys": left,
                                        "passed": affected == 0,
                                        "pass_rate": pass_rate_of(r.total_count, affected)}))
    return out


def rank_fixes(before: list[CheckResult], candidates: list[dict], weights: dict | None,
               limit: int = 10) -> list[dict]:
    """Greedy "best next fixes": repeatedly pick the candidate with the highest DQS
    gain per record changed, given the ones already picked.

    ``candidates``: ``[{id, label, records_changed, resolves: {(module, check_id): set(keys)}}]``."""
    # ponytail: analytic estimate from each fix group's resolved records; it ignores
    # side effects and interaction between groups (re-simulate the picked set for exact numbers)
    current = before
    base = dqs_summary(current, weights).get("composite") or 0.0
    pool = [c for c in candidates if c.get("records_changed") and c.get("resolves")]
    picked: list[dict] = []
    while pool and len(picked) < limit:
        best, best_rate, best_state = None, 0.0, None
        for c in pool:
            state = _reduce(current, c["resolves"])
            gain = (dqs_summary(state, weights).get("composite") or 0.0) - base
            rate = gain / c["records_changed"]
            if gain > 0 and rate > best_rate:
                best, best_rate, best_state = c, rate, state
        if best is None:
            break
        new = dqs_summary(best_state, weights).get("composite") or 0.0
        picked.append({"id": best["id"], "label": best["label"], "records_changed": best["records_changed"],
                       "dqs_gain": round(new - base, 2), "gain_per_1k_records": round(best_rate * 1000, 4),
                       "dqs_after": round(new, 2)})
        current, base = best_state, new
        pool.remove(best)
    return picked
