"""Source and target system comparison: record reconciliation, field differences, config and DQS on both sides.

Any two connected systems are paired per module (``system_pairs``). One comparison reads the latest complete
extraction of each, and per table of the module reports records in source, in target, missing in target, extra in
target and matched, and for matched records every common field: equal, equal after a known transformation, or
different. Records are matched on the target table's DDIC key, or on the pair's ``key_map`` override
(``{"MARA": {"source": ["MATNR"], "target": ["BISMT"]}}``: the old number is held in the target's BISMT). A key
field with confirmed code maps in ``transfer_value_mappings`` is translated old to new before matching.

Transformations, tried in this order, each only explains a pair of values and never changes stored data:
``leading_zeros`` (both numeric, equal without leading zeros), ``case`` (equal ignoring case and inner spacing),
``code_map`` (a confirmed value mapping for the target field turns the source value into the target value),
``date_format`` (YYYYMMDD, ISO, DD.MM.YYYY and OData /Date(ms)/ name the same day), ``numeric_format`` (same
number, with SAP trailing minus and decimal comma read). ALPHA / MATN1 padding and CUNIT / AUART conversions are
applied to both sides first by ``checks.frames.internal_format``, each with its own system's dictionary.

Pure and deterministic: same inputs, same output, sorted everywhere. No model sees any value. A personal field
(``is_pii_field``) is counted with values withheld. Only columns both extractions hold are compared, so no SAP field
name is ever invented here.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

import pandas as pd

from api.utils.pii_fields import is_pii_field
from checks.frames import internal_format
from sap.ddic import Dictionary

RECORD_CAP = 100  # records kept per table and kind; record pairs kept per table
TRANSFORMS = ("leading_zeros", "case", "code_map", "date_format", "numeric_format")
KINDS = ("missing", "extra", "differing")


def _day(v: str) -> Optional[str]:
    if m := re.fullmatch(r"/Date\((-?\d+)[^)]*\)/", v):
        return datetime.fromtimestamp(int(m[1]) / 1000, tz=timezone.utc).strftime("%Y%m%d")
    if m := re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?", v):
        return m[1] + m[2] + m[3]
    if m := re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", v):
        return m[3] + m[2] + m[1]
    return v if re.fullmatch(r"\d{8}", v) else None


def _number(v: str) -> Optional[Decimal]:
    s = v.replace(" ", "")
    if s.endswith("-"):
        s = "-" + s[:-1]
    if "," in s and "." not in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def explain(a: str, b: str, code_map: Optional[dict[str, str]] = None) -> Optional[str]:
    """The transformation under which source value ``a`` equals target value ``b``; "equal", or None when they differ."""
    if a == b:
        return "equal"
    if a.isdigit() and b.isdigit() and a.lstrip("0") == b.lstrip("0"):
        return "leading_zeros"
    if " ".join(a.split()).upper() == " ".join(b.split()).upper():
        return "case"
    if code_map and code_map.get(a) == b:
        return "code_map"
    da = _day(a)
    if da is not None and da == _day(b):
        return "date_format"
    na = _number(a)
    if na is not None and na == _number(b):
        return "numeric_format"
    return None


def _strings(df: pd.DataFrame, table: str, fields: list[str], dictionary: Dictionary,
             conversions: Optional[dict] = None) -> pd.DataFrame:
    q = internal_format(df[[f"{table}.{f}" for f in fields]], dictionary, conversions)
    out = q.apply(lambda c: c.astype("string").str.strip()).fillna("")
    out.columns = fields
    return out


def _unpad(v: str) -> str:
    return (v.lstrip("0") or "0") if v.isdigit() else v


def _keyed(df: pd.DataFrame, cols: list[str], names: list[str], maps: list[dict[str, str]]) -> tuple[pd.Series, int]:
    """Key strings named by the target key fields, source values mapped old to new; and how many rows a map changed."""
    changed = pd.Series(False, index=df.index)
    parts = []
    for c, n, m in zip(cols, names, maps):
        # Numeric key parts lose ALPHA / MATN1 padding, so an old number held in a plain field (BISMT) still matches.
        v = df[c].map(_unpad)
        if m:
            m = {_unpad(k): x for k, x in m.items()}
            mapped = v.map(lambda x: _unpad(m.get(x, x)))
            changed |= mapped != v
            v = mapped
        parts.append(n + "=" + v)
    key = parts[0]
    for p in parts[1:]:
        key = key + "|" + p
    return key, int(changed.sum())


def compare_table(table: str, source: Optional[pd.DataFrame], target: Optional[pd.DataFrame],
                  source_dict: Dictionary, target_dict: Dictionary,
                  value_maps: Optional[dict[str, dict[str, str]]] = None, key_map: Optional[dict] = None,
                  *, source_conv: Optional[dict] = None, target_conv: Optional[dict] = None,
                  not_comparable: Optional[str] = None, cap: int = RECORD_CAP) -> dict:
    """Reconcile one table between the two systems' extractions."""
    value_maps = value_maps or {}
    t = target_dict.table(table) or source_dict.table(table)
    tgt_keys = list((key_map or {}).get("target") or target_dict.keys(table))
    src_keys = list((key_map or {}).get("source") or tgt_keys)
    out: dict = {
        "table": table, "description": t.description if t else "", "comparable": False, "reason": not_comparable,
        "source_keys": src_keys, "target_keys": tgt_keys, "key_mapped": 0,
        "in_source": 0 if source is None else len(source), "in_target": 0 if target is None else len(target),
        "matched": 0, "missing_in_target": 0, "extra_in_target": 0, "duplicate_source": 0, "duplicate_target": 0,
        "fields": [], "records_total": dict.fromkeys(KINDS, 0), "capped": False, "records": [], "pairs": {},
    }
    if not_comparable:
        return out
    if source is None or target is None:
        out["reason"] = "table_not_extracted"
        return out
    if not tgt_keys or len(src_keys) != len(tgt_keys):
        out["reason"] = "no_key_in_dictionary" if not tgt_keys else "key_map_mismatch"
        return out
    absent = [f"source:{k}" for k in src_keys if f"{table}.{k}" not in source.columns] + \
             [f"target:{k}" for k in tgt_keys if f"{table}.{k}" not in target.columns]
    if absent:
        out["reason"], out["absent_keys"] = "key_not_extracted", absent
        return out

    names = lambda df: {c.split(".", 1)[1] for c in df.columns if c.startswith(table + ".")}  # noqa: E731
    fields = sorted((names(source) & names(target)) - set(src_keys) - set(tgt_keys))
    s = _strings(source, table, sorted(set(src_keys) | set(fields)), source_dict, source_conv)
    g = _strings(target, table, sorted(set(tgt_keys) | set(fields)), target_dict, target_conv)
    s["_key"], out["key_mapped"] = _keyed(s, src_keys, tgt_keys, [value_maps.get(f"{table}.{k}", {}) for k in tgt_keys])
    g["_key"], _ = _keyed(g, tgt_keys, tgt_keys, [{} for _ in tgt_keys])
    out["duplicate_source"], out["duplicate_target"] = int(s["_key"].duplicated().sum()), int(g["_key"].duplicated().sum())
    s = s.drop_duplicates("_key").set_index("_key").sort_index()
    g = g.drop_duplicates("_key").set_index("_key").sort_index()
    both = s.index.intersection(g.index)
    missing, extra = s.index.difference(g.index), g.index.difference(s.index)
    out.update(comparable=True, matched=len(both), missing_in_target=len(missing), extra_in_target=len(extra))
    rows: dict[str, list[dict]] = {k: [] for k in KINDS}

    def add(kind: str, row: dict) -> None:
        out["records_total"][kind] += 1
        if len(rows[kind]) < cap:
            rows[kind].append({"kind": kind, **row})
        else:
            out["capped"] = True

    for k in missing:
        add("missing", {"key": k, "field": None, "source": None, "target": None})
    for k in extra:
        add("extra", {"key": k, "field": None, "source": None, "target": None})
    a, b = s.loc[both], g.loc[both]
    diff_keys: list[str] = []
    for f in fields:
        fd = target_dict.field(table, f) or source_dict.field(table, f)
        personal = is_pii_field(f"{table}.{f}")
        info = {"field": f, "description": fd.description if fd else "", "compared": len(both), "equal": 0,
                "transformed": {}, "differing": 0, "withheld": personal}
        same = a[f] == b[f]
        info["equal"] = int(same.sum())
        cmap = value_maps.get(f"{table}.{f}")
        for k in same.index[~same]:
            how = explain(a.at[k, f], b.at[k, f], cmap)
            if how:
                info["transformed"][how] = info["transformed"].get(how, 0) + 1
                continue
            info["differing"] += 1
            diff_keys.append(k)
            add("differing", {"key": k, "field": f, "source": None if personal else a.at[k, f],
                              "target": None if personal else b.at[k, f], "withheld": personal})
        out["fields"].append(info)

    def side(df: pd.DataFrame, k: str) -> dict:
        return {f: None if is_pii_field(f"{table}.{f}") else df.at[k, f] for f in df.columns}

    for k in sorted(set(diff_keys))[:cap] + list(missing[:cap]) + list(extra[:cap]):
        out["pairs"][k] = {"source": side(s, k) if k in s.index else None,
                           "target": side(g, k) if k in g.index else None}
    out["records"] = [r for k in KINDS for r in rows[k]]
    return out


def totals(tables: list[dict]) -> dict:
    ok = [t for t in tables if t["comparable"]]
    return {"tables": len(tables), "comparable": len(ok),
            **{k: sum(t[k] for t in ok) for k in ("in_source", "in_target", "matched", "missing_in_target",
                                                  "extra_in_target", "key_mapped")},
            "differing_fields": sum(f["differing"] for t in ok for f in t["fields"]),
            "transformed_fields": sum(sum(f["transformed"].values()) for t in ok for f in t["fields"])}


def config_summary(by_object: dict[str, list], target_counts: dict[str, int], cap: int = 50) -> list[dict]:
    """Per config object (org units, value lists, check tables): source keys found in the target exactly, by
    normalised key, by description, or missing; and how many keys only the target has. ``by_object`` is
    ``config_pairing.compare_object`` output per object."""
    out = []
    for obj in sorted(by_object):
        rows = by_object[obj]
        counts = {st: sum(r.status == st for r in rows) for st in ("exists", "key_match", "desc_match", "missing")}
        out.append({"object": obj, **counts, "in_source": len(rows), "in_target": target_counts.get(obj, 0),
                    "only_in_target": max(target_counts.get(obj, 0) - counts["exists"] - counts["key_match"]
                                          - counts["desc_match"], 0),
                    "rows": [r.as_dict() for r in rows if r.status != "exists"][:cap]})
    return out


if __name__ == "__main__":
    assert explain("00012", "12") == "leading_zeros"
    assert explain("20260101", "2026-01-01") == "date_format"
    assert explain("/Date(1767225600000)/", "20260101") == "date_format"
    assert explain("12,50-", "-12.5") == "numeric_format"
    assert explain("PC", "ST", {"PC": "ST"}) == "code_map"
    assert explain("A", "B") is None
    print("ok")
