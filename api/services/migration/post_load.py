"""Post-load reconciliation: did the records the load files carried land in the target system.

The expected side is whatever the caller passes: the parquet snapshot of the files handed over at export when one
exists (``snapshot.py``), else a rebuild from the current mappings by ``export.build_load_tables``, in which case a
mapping changed after export shows up as a difference. Both carry target tables, target field names, values after value
mapping and SOURCE_RECORD. The found side is the target system's latest extraction. Records are
matched on the target table's DDIC key, with ALPHA / MATN1 keys padded to their internal form on both sides
(``checks.frames.internal_format``) and values trimmed. Nothing else is normalised before the comparison: a value that
differs only in number format or case is reported as different, and the classifier below says why.

Claims are limited to the loaded key set. A target record that is not in the load is not "unexpected"; only a record
whose key matches a record the blocking gaps held back is, because that one was meant to stay out. A table is reported
not comparable, with the reason, when it cannot be judged honestly: no usable key, table not extracted, or the target
extraction of it was windowed, scoped or incomplete (``partial``). A table that merely lost non-key columns is
compared on the fields present; the lost ones carry ``in_target_extract`` false. A missing key column is a table-level
``key_not_in_target_extract``. A field the load left blank is not compared, since the target may fill
its own default. Pure and deterministic; no model sees any value. A differing personal field (``is_pii_field``) is
counted and listed with ``withheld`` set and no values, so a stored result never repeats personal data.

Every differing value is then classified (``classify_difference``) as an expected difference, with the cause and the
target DDIC evidence for it, or as real. Expected causes: ALPHA / MATN1 conversion padding, case on a field the
dictionary does not mark lowercase (SAP uppercases it on input), a confirmed value mapping, truncation at the target
field length, and number or date format equivalence on a numeric or DATS field. Anything else is real, and the
verdict counts real differences only. Classification runs before personal values are dropped, so a withheld row
still carries its cause.
"""

from __future__ import annotations

from typing import Any, Optional

from datetime import datetime

import pandas as pd

from api.utils.pii_fields import is_pii_field

from api.services.scoring import score_module
from checks.base import CheckResult, record_keys
from checks.frames import TableFrames, internal_format
from sap.ddic import Dictionary, Field

RECORD_CAP = 100  # record rows kept per table and kind (missing, differing, unexpected)
REASON_TOP = 10
KINDS = ("missing", "differing", "unexpected")
NO_TARGET_ANALYSIS = "The target system has no completed analysis. Extract the target first."
EXPECTED_CAUSES = ("alpha_padding", "case", "value_mapping", "truncation", "number_format", "date_format")
NUMERIC_TYPES = {"QUAN", "CURR", "DEC", "FLTP", "INT1", "INT2", "INT4", "INT8", "NUMC"}
_DATE_FORMATS = ("%Y%m%d", "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y")


def _number(v: str) -> Optional[float]:
    """A number written with a thousands separator, a decimal comma or SAP's trailing minus, else None."""
    s = v.strip().replace(" ", "")
    if s.endswith("-"):
        s = "-" + s[:-1]
    if "," in s and "." in s:  # the later one is the decimal mark
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _date(v: str) -> Optional[str]:
    s = v.strip()[:10]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    return None


def ddic_evidence(field: Optional[Field]) -> dict:
    """The target DDIC attributes a cause rests on."""
    if field is None:
        return {"description": "", "type": None, "length": None, "conversion_exit": None, "lowercase": None}
    return {"description": field.description, "type": field.type, "length": field.length,
            "conversion_exit": field.conversion_exit or None, "lowercase": field.lowercase}


def classify_difference(expected: str, found: str, field: Optional[Field],
                        mapping: Optional[dict[str, str]] = None) -> str:
    """Why a loaded value differs from the one in the target: one of EXPECTED_CAUSES, or "real".

    Every cause is read from the target field's DDIC entry or a confirmed value mapping, never guessed. A field the
    dictionary does not know can still be explained by a mapping; otherwise it is real."""
    e, f = (expected or "").strip(), (found or "").strip()
    if mapping and (mapping.get(e) == f or mapping.get(f) == e):
        return "value_mapping"
    if field is None:
        return "real"
    if field.conversion_exit in ("ALPHA", "MATN1") and e.lstrip("0") == f.lstrip("0") and (e or f):
        return "alpha_padding"
    if not field.lowercase and field.type in ("CHAR", "SSTR", "STRG", "LANG", "CUKY", "UNIT") and e.upper() == f.upper():
        return "case"
    if field.length and len(e) > field.length and e[:field.length].rstrip() == f:
        return "truncation"
    if field.type in NUMERIC_TYPES:
        a, b = _number(e), _number(f)
        if a is not None and b is not None and abs(a - b) <= 10 ** -(field.decimals or 0) / 2:
            return "number_format"
    if field.type == "DATS" and _date(e) is not None and _date(e) == _date(f):
        return "date_format"
    return "real"


def _mapping_for(value_maps: Optional[dict[str, dict[str, str]]], table: str, field: Optional[Field],
                 name: str) -> Optional[dict[str, str]]:
    """The confirmed map for the target field, else for the check table field it is validated against."""
    if not value_maps:
        return None
    own = value_maps.get(f"{table}.{name}")
    if own is None and field is not None and field.check_table and field.check_field:
        own = value_maps.get(f"{field.check_table}.{field.check_field}")
    return own


def _prepare(df: pd.DataFrame, table: str, fields: list[str], dictionary: Dictionary) -> pd.DataFrame:
    """The given fields as trimmed strings in SAP internal format, columns named by field."""
    qualified = pd.DataFrame({f"{table}.{f}": df[f"{table}.{f}"] if f"{table}.{f}" in df.columns else df[f]
                              for f in fields})
    out = internal_format(qualified, dictionary)
    out = out.apply(lambda c: c.astype("string").str.strip()).fillna("")
    out.columns = fields
    return out


def _comparison(table: str, exp: pd.DataFrame, held: Optional[pd.DataFrame], target: TableFrames,
                dictionary: Dictionary, cap: int, value_maps: Optional[dict[str, dict[str, str]]] = None) -> dict:
    t = dictionary.table(table)
    out: dict = {
        "table": table, "description": t.description if t else "", "comparable": False, "reason": None,
        "key_fields": [], "expected": 0, "found": 0, "missing": 0, "unexpected": 0, "duplicate_expected": 0,
        "duplicate_found": 0, "fields": [], "records": [], "records_total": dict.fromkeys(KINDS, 0), "capped": False,
        "expected_differences": 0, "real_differences": 0, "causes": {},
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
                "in_target_extract": f in in_target, "compared": 0, "matched": 0, "differing": 0,
                "expected_differences": 0, "real_differences": 0, "ddic": ddic_evidence(fd)}
        mapping = _mapping_for(value_maps, table, fd, f)
        if f in in_target and len(hit):
            sel = hit[f] != ""  # a blank in the load is not a claim about the target
            info["compared"] = int(sel.sum())
            same = (hit[f] == landed[f])[sel]
            info["matched"] = int(same.sum())
            info["differing"] = info["compared"] - info["matched"]
            personal = is_pii_field(f"{table}.{f}")
            for i in same.index[~same]:
                cause = classify_difference(hit.at[i, f], landed.at[i, f], fd, mapping)
                side = "real_differences" if cause == "real" else "expected_differences"
                info[side] += 1
                out[side] += 1
                out["causes"][cause] = out["causes"].get(cause, 0) + 1
                add("differing", {"key": hit.at[i, "_key"], "source_record": hit.at[i, "SOURCE_RECORD"], "field": f,
                                  "expected": None if personal else hit.at[i, f],
                                  "found": None if personal else landed.at[i, f], "withheld": personal,
                                  "cause": cause, "ddic": info["ddic"]})
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
              dictionary: Dictionary, cap: int = RECORD_CAP,
              value_maps: Optional[dict[str, dict[str, str]]] = None) -> dict:
    """Per target table: expected, found, missing, unexpected, per-field match counts, expected vs real
    differences by cause, and capped record rows. ``value_maps`` is {TABLE.FIELD: {source: target}}, confirmed only."""
    tables = [_comparison(t, df, held_back.get(t), target, dictionary, cap, value_maps)
              for t, df in sorted(expected.items())]
    ok = [t for t in tables if t["comparable"]]
    return {
        "tables": tables,
        "record_cap": cap,
        "totals": {
            "tables": len(tables), "comparable": len(ok),
            **{k: sum(t[k] for t in ok) for k in ("expected", "found", "missing", "unexpected")},
            "differing_fields": sum(f["differing"] for t in ok for f in t["fields"]),
            "expected_differences": sum(t["expected_differences"] for t in ok),
            "real_differences": sum(t["real_differences"] for t in ok),
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
