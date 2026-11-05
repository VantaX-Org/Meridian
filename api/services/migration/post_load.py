"""Post-load reconciliation: did the records the load files carried land in the target system.

The expected side is rebuilt by ``export.build_load_tables`` when the reconciliation runs (target tables, target field
names, values after value mapping, SOURCE_RECORD for traceability), so it follows the mappings as they stand then: a
mapping changed after the files were exported shows up here as a difference. The found side is the target system's latest extraction. Records are
matched on the target table's DDIC key, with ALPHA / MATN1 keys padded to their internal form on both sides
(``checks.frames.internal_format``) and values trimmed. Nothing else is normalised: a value that differs only in
number format or case is reported as different.

Claims are limited to the loaded key set. A target record that is not in the load is not "unexpected"; only a record
whose key matches a record the blocking gaps held back is, because that one was meant to stay out. A table is reported
not comparable, with the reason, when it cannot be judged honestly: no usable key, table not extracted, or the target
extraction of it was partial or incomplete. A field the load left blank is not compared, since the target may fill
its own default. Pure and deterministic; no model sees any value. A differing personal field (``is_pii_field``) is
counted and listed with ``withheld`` set and no values, so a stored result never repeats personal data.
"""

from __future__ import annotations

from typing import Any, Optional

import pandas as pd

from api.utils.pii_fields import is_pii_field

from api.services.scoring import score_module
from checks.base import CheckResult, record_keys
from checks.frames import TableFrames, internal_format
from sap.ddic import Dictionary

RECORD_CAP = 100  # record rows kept per table and kind (missing, differing, unexpected)
REASON_TOP = 10
KINDS = ("missing", "differing", "unexpected")


def _prepare(df: pd.DataFrame, table: str, fields: list[str], dictionary: Dictionary) -> pd.DataFrame:
    """The given fields as trimmed strings in SAP internal format, columns named by field."""
    qualified = pd.DataFrame({f"{table}.{f}": df[f"{table}.{f}"] if f"{table}.{f}" in df.columns else df[f]
                              for f in fields})
    out = internal_format(qualified, dictionary)
    out = out.apply(lambda c: c.astype("string").str.strip()).fillna("")
    out.columns = fields
    return out


def _comparison(table: str, exp: pd.DataFrame, held: Optional[pd.DataFrame], target: TableFrames,
                dictionary: Dictionary, cap: int) -> dict:
    t = dictionary.table(table)
    out: dict = {
        "table": table, "description": t.description if t else "", "comparable": False, "reason": None,
        "key_fields": [], "expected": 0, "found": 0, "missing": 0, "unexpected": 0, "duplicate_expected": 0,
        "duplicate_found": 0, "fields": [], "records": [], "records_total": dict.fromkeys(KINDS, 0), "capped": False,
    }
    keys = list(dictionary.keys(table))
    out["key_fields"] = keys
    if not keys:
        out["reason"] = "no_key_in_dictionary"
        return out
    unmapped = [k for k in keys if k not in exp.columns]
    if unmapped:
        out["reason"] = "key_not_in_load"
        out["key_fields"] = keys
        out["unmapped_keys"] = unmapped
        return out
    if table in target.incomplete:
        out["reason"] = "target_extract_incomplete"
        return out
    if table in target.partial:
        out["reason"] = "target_extract_partial"
        return out
    frame = target.frames.get(table)
    if frame is None or not isinstance(frame, pd.DataFrame):
        out["reason"] = "table_not_extracted"
        return out
    absent_keys = [k for k in keys if f"{table}.{k}" not in frame.columns]
    if absent_keys:
        out["reason"] = "key_not_in_target_extract"
        out["unmapped_keys"] = absent_keys
        return out

    fields = [c for c in exp.columns if c != "SOURCE_RECORD"]
    e = _prepare(exp, table, fields, dictionary)
    e["SOURCE_RECORD"] = exp["SOURCE_RECORD"].values
    e["_key"] = record_keys(e, keys).values
    out["duplicate_expected"] = int(e["_key"].duplicated().sum())
    e = e.drop_duplicates("_key").reset_index(drop=True)
    in_target = [f for f in fields if f"{table}.{f}" in frame.columns]
    g = _prepare(frame, table, in_target + [k for k in keys if k not in in_target], dictionary)
    g["_key"] = record_keys(g, keys).values
    out["duplicate_found"] = int(g["_key"].duplicated().sum())
    g = g.drop_duplicates("_key").set_index("_key")

    out["comparable"] = True
    out["expected"] = len(e)
    present = e["_key"].isin(g.index)
    out["found"] = int(present.sum())
    out["missing"] = int((~present).sum())
    rows: dict[str, list[dict]] = {k: [] for k in KINDS}

    def add(kind: str, row: dict) -> None:
        out["records_total"][kind] += 1
        if len(rows[kind]) < cap:
            rows[kind].append({"kind": kind, **row})
        else:
            out["capped"] = True

    for key, src in zip(e.loc[~present, "_key"], e.loc[~present, "SOURCE_RECORD"]):
        add("missing", {"key": key, "source_record": src, "field": None, "expected": None, "found": None})

    hit = e[present].reset_index(drop=True)
    landed = g.loc[hit["_key"]].reset_index(drop=True)
    for f in fields:
        if f in keys:
            continue
        fd = dictionary.field(table, f)
        info = {"field": f, "description": fd.description if fd else "",
                "in_target_extract": f in in_target, "compared": 0, "matched": 0, "differing": 0}
        if f in in_target and len(hit):
            sel = hit[f] != ""  # a blank in the load is not a claim about the target
            info["compared"] = int(sel.sum())
            same = (hit[f] == landed[f])[sel]
            info["matched"] = int(same.sum())
            info["differing"] = info["compared"] - info["matched"]
            personal = is_pii_field(f"{table}.{f}")
            for i in same.index[~same]:
                add("differing", {"key": hit.at[i, "_key"], "source_record": hit.at[i, "SOURCE_RECORD"], "field": f,
                                  "expected": None if personal else hit.at[i, f],
                                  "found": None if personal else landed.at[i, f], "withheld": personal})
        out["fields"].append(info)

    if held is not None and not held.empty and all(k in held.columns for k in keys):
        h = _prepare(held, table, keys, dictionary)
        h["_key"] = record_keys(h, keys).values
        h["SOURCE_RECORD"] = held["SOURCE_RECORD"].values
        h = h[h["_key"].isin(g.index) & ~h["_key"].isin(e["_key"])].drop_duplicates("_key")
        for key, src in zip(h["_key"], h["SOURCE_RECORD"]):
            add("unexpected", {"key": key, "source_record": src, "field": None, "expected": None, "found": None})
    out["unexpected"] = out["records_total"]["unexpected"]
    out["records"] = [r for k in KINDS for r in rows[k]]
    return out


def reconcile(expected: dict[str, pd.DataFrame], held_back: dict[str, pd.DataFrame], target: TableFrames,
              dictionary: Dictionary, cap: int = RECORD_CAP) -> dict:
    """Per target table: expected, found, missing, unexpected, per-field match counts and capped record rows."""
    tables = [_comparison(t, df, held_back.get(t), target, dictionary, cap) for t, df in sorted(expected.items())]
    ok = [t for t in tables if t["comparable"]]
    return {
        "tables": tables,
        "record_cap": cap,
        "totals": {
            "tables": len(tables), "comparable": len(ok),
            **{k: sum(t[k] for t in ok) for k in ("expected", "found", "missing", "unexpected")},
            "differing_fields": sum(f["differing"] for t in ok for f in t["fields"]),
        },
    }


def _rates(findings: list[dict], module: str) -> dict[str, CheckResult]:
    from api.services.simulate_fix import rebuild

    return {r.check_id: r for r in rebuild(findings, module)}


def score_sides(modules: list[str], run_summary: dict, target_findings: Optional[dict[str, list[dict]]],
                source_findings: dict[str, list[dict]], cfg: dict, rule_text: dict[str, dict[str, str]]) -> dict:
    """Source, projected and actual target DQS per module, and the rules that moved the actual score.

    Source and projected are the readiness run's stored figures. Actual is ``scoring.score_module`` over the target
    system's own findings for the module, or None with the reason when the target has no completed analysis (or none
    for that module); it is never estimated. Reasons are the rules whose pass rate differs between the source and
    the target findings, largest change first."""
    out = []
    for module in modules:
        dest = (run_summary.get(module) or {}).get("dest_dqs") or {}
        row: dict = {"module": module, "source": dest.get("source_score"), "projected": dest.get("composite_score"),
                     "actual": None, "actual_reason": None, "reasons": []}
        if target_findings is None:
            row["actual_reason"] = "no_target_analysis"
        elif not target_findings.get(module):
            row["actual_reason"] = "no_target_findings_for_module"
        else:
            row["actual"] = score_module(list(_rates(target_findings[module], module).values()), cfg,
                                         module=module).composite_score
            src, tgt = _rates(source_findings.get(module, []), module), _rates(target_findings[module], module)
            text = rule_text.get(module, {})
            deltas: list[dict[str, Any]] = []
            for cid in sorted(set(src) | set(tgt)):
                s, t = src.get(cid), tgt.get(cid)
                s_rate, t_rate = (s.pass_rate if s else None), (t.pass_rate if t else None)
                ref = t or s
                if s_rate == t_rate or ref is None:
                    continue
                deltas.append({
                    "check_id": cid, "description": text.get(cid) or None,
                    "severity": ref.severity, "dimension": ref.dimension,
                    "source_pass_rate": s_rate, "target_pass_rate": t_rate,
                    "source_affected": s.affected_count if s else None,
                    "target_affected": t.affected_count if t else None,
                    "source_total": s.total_count if s else None, "target_total": t.total_count if t else None,
                    "change": round((t_rate if t_rate is not None else 100.0) - (s_rate if s_rate is not None else 100.0), 2),
                })
            deltas.sort(key=lambda d: (abs(d["change"]) * -1, d["check_id"]))
            row["reasons"] = deltas[:REASON_TOP]
        out.append(row)
    return {"modules": out}
