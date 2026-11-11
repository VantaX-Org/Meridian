"""DDIC-anchored review of mined house rules (learned_rule_proposals).

Every function here is pure: the route reads the proposal, the version's field profiles, the system's
dictionary and its configuration snapshots, and these functions turn them into the evidence a reviewer
needs before approving. Nothing is estimated: a figure that the stored profiles cannot support is
returned as None with the reason, never guessed.

- ``lift``: the proposal's confidence over the share of dependent rows that would hold an allowed value
  anyway (the base rate, from the dependent field's value counts). Lift near 1 means the determinant
  adds nothing; the rule only restates how common the values are.
- ``anchor``: DDIC text, data element, domain and check table of a ``TABLE.FIELD`` column.
- ``out_of_dictionary``: mined values that are not in the domain fixed values or the check table
  (live configuration snapshot first, SAP-standard baseline second).
- ``redundant``: the proposal is already enforced by the DDIC, so SAP refuses the violating records itself.
"""
from __future__ import annotations

from typing import Any, Optional

PAIRED = ("dependency", "value_set")
CLIENT = "MANDT"


def split(col: Optional[str]) -> tuple[str, str]:
    """``TABLE.FIELD`` into (table, field); a bare name gives ("", name)."""
    table, _, field = (col or "").partition(".")
    return (table, field) if field else ("", table)


def _counts(stats: Optional[dict]) -> tuple[Optional[dict[str, int]], bool, Optional[str]]:
    """(value -> count, exhaustive, reason) of a profile; counts are None when the profile lists no values."""
    if not stats:
        return None, False, "no field profile for this version"
    tv = stats.get("top_values")
    if stats.get("masked") or tv is None:
        return None, False, f"values are masked ({stats.get('mask_reason') or 'privacy'})"
    counts = {str(v["value"]): int(v["count"]) for v in tv}
    return counts, int(stats.get("distinct", 0)) <= len(counts), None


def _share(values: list[str], counts: dict[str, int], exhaustive: bool) -> Optional[int]:
    """Rows holding any of ``values``, or None when one of them may be hidden past the listed top values."""
    total = 0
    for v in values:
        if v in counts:
            total += counts[v]
        elif not exhaustive:
            return None
    return total


def lift(kind: str, body: dict, confidence: Optional[float], det_stats: Optional[dict],
         dep_stats: Optional[dict], same_table: bool) -> dict:
    """``{lift, expected, reason, sampled}``. ``expected`` is the share of the dependent's filled rows that hold
    an allowed value regardless of the determinant, weighted over the determinant groups the rule covers."""
    out: dict[str, Any] = {"lift": None, "expected": None, "reason": None,
                           "sampled": bool((det_stats or {}).get("sampled") or (dep_stats or {}).get("sampled"))}
    allowed = body.get("allowed") if isinstance(body, dict) else None
    if kind not in PAIRED or not isinstance(allowed, dict) or not allowed:
        out["reason"] = "lift applies to dependency and value-set proposals only"
        return out
    if confidence is None:
        out["reason"] = "the proposal has no confidence"
        return out
    dep, dep_exh, why = _counts(dep_stats)
    if dep is None:
        out["reason"] = f"dependent field: {why}"
        return out
    filled = int(dep_stats.get("rows", 0)) - int(dep_stats.get("blank", 0))
    if filled <= 0:
        out["reason"] = "the dependent field has no filled rows in the profile"
        return out
    bases: dict[str, float] = {}
    for a, bs in allowed.items():
        n = _share([str(b) for b in bs], dep, dep_exh)
        if n is None:
            out["reason"] = "an allowed value is not among the dependent field's listed top values"
            return out
        bases[str(a)] = n / filled
    if len(bases) == 1:
        expected = next(iter(bases.values()))
    else:
        if not same_table:
            out["reason"] = "the determinant sits in another table, so its counts do not weigh the dependent rows"
            return out
        det, det_exh, why = _counts(det_stats)
        if det is None:
            out["reason"] = f"determinant field: {why}"
            return out
        weights = {}
        for a in bases:
            w = _share([a], det, det_exh)
            if w is None:
                out["reason"] = "a determinant value is not among its listed top values"
                return out
            weights[a] = w
        if not sum(weights.values()):
            out["reason"] = "the determinant values the rule covers have no rows in the profile"
            return out
        expected = sum(weights[a] * bases[a] for a in bases) / sum(weights.values())
    out["expected"] = round(expected, 4)
    if expected <= 0:
        out["reason"] = "no dependent row holds an allowed value in the profile"
        return out
    out["lift"] = round(float(confidence) / expected, 2)
    return out


def anchor(dictionary: Any, col: Optional[str]) -> dict:
    """What the dictionary says about one ``TABLE.FIELD``; ``known`` is False when it has no such field."""
    table, name = split(col)
    fld = dictionary.field(table, name) if table and name else None
    tab = dictionary.table(table) if table else None
    if fld is None:
        return {"column": col or "", "known": False, "table_text": (tab.description if tab else "") or "",
                "description": "", "data_element": None, "domain": None, "check_table": None,
                "check_field": None, "fixed_values": 0}
    ct = fld.check_table or None
    return {"column": col or "", "known": True, "table_text": (tab.description if tab else "") or "",
            "description": fld.description or "", "data_element": fld.data_element or None,
            "domain": fld.domain or None, "check_table": ct,
            "check_field": (fld.check_field or fld.name) if ct else None,
            "fixed_values": len(fld.fixed_values or ())}


def out_of_dictionary(values: list[str], fld: Any, live: dict[str, list[dict]],
                      baseline: dict[str, list[dict]]) -> dict:
    """``{values, source, checked}``: the ``values`` that the DDIC does not know. ``source`` names the reference
    used (domain, live, baseline) or why there is none (no_reference, unverified); ``checked`` how many codes it holds."""
    vals = sorted({str(v) for v in values if str(v).strip()})
    if fld is None:
        return {"values": [], "source": "unverified", "checked": 0}
    fixed = fld.allowed_values() if fld.fixed_values else None
    if fixed is not None:
        return {"values": [v for v in vals if v not in fixed], "source": "domain", "checked": len(fixed)}
    if not fld.check_table:
        return {"values": [], "source": "no_reference", "checked": 0}
    cf = fld.check_field or fld.name
    for source, rows in (("live", live.get(fld.check_table)), ("baseline", baseline.get(fld.check_table))):
        codes = {str(r[cf]).strip() for r in rows or [] if r.get(cf) not in (None, "")}
        if codes:
            return {"values": [v for v in vals if v not in codes], "source": source, "checked": len(codes)}
    return {"values": [], "source": "unverified", "checked": 0}


def redundant(kind: str, dictionary: Any, det_col: Optional[str], dep_col: Optional[str]) -> tuple[bool, str]:
    """(redundant, why). A dependency or value set is redundant when the dependent's check table is keyed by the
    determinant field too, so SAP accepts only values set up for that determinant. A format rule is redundant
    when the field is already limited to a check table or to domain fixed values."""
    dt, dn = split(dep_col)
    fld = dictionary.field(dt, dn) if dt and dn else None
    if fld is None:
        return False, f"{dep_col or 'the field'} is not in the dictionary"
    if kind in PAIRED:
        _, det = split(det_col)
        if not fld.check_table:
            return False, (f"{dep_col} has no check table, so only this rule ties it to {det_col}" if det
                           else f"{dep_col} has no check table, so only this rule limits its values")
        if not det:
            return False, (f"{fld.check_table} admits every code set up there; the mined value set is narrower, "
                           f"so SAP does not enforce it")
        keys = [k for k in dictionary.keys(fld.check_table) if k != CLIENT]
        if det and det in keys:
            return True, (f"{fld.check_table} is keyed by {', '.join(keys)}, so SAP already accepts only "
                          f"{dn} values set up for the {det}")
        return False, (f"{fld.check_table} is keyed by {', '.join(keys) or 'no fields'}, "
                       f"not by {det}, so SAP does not tie {dn} to {det}")
    if kind == "format":
        if fld.check_table:
            return True, f"{dep_col} already takes its values from check table {fld.check_table}"
        if fld.fixed_values:
            return True, f"{dep_col} already takes its values from domain {fld.domain} fixed values"
        return False, f"{dep_col} has no check table or fixed values"
    return False, "the dictionary does not enforce value ranges or blanks"


def mined_values(body: dict) -> tuple[list[str], list[str]]:
    """(determinant values, dependent values) a dependency or value-set body names."""
    allowed = body.get("allowed") if isinstance(body, dict) else None
    if not isinstance(allowed, dict):
        return [], []
    return [str(a) for a in allowed], sorted({str(b) for bs in allowed.values() for b in bs})


def review(p: dict, dictionary: Any, profiles: dict[tuple[str, str], dict], live: dict[str, list[dict]],
           baseline: dict[str, list[dict]]) -> dict:
    """The review of one proposal row (``id, kind, determinant, field, body, confidence, support_rows, violations,
    sample_keys, ...``); ``profiles`` maps (table, field) to the version's field statistics."""
    kind, body = p.get("kind") or "", p.get("body") or {}
    det_col, dep_col = p.get("determinant"), p.get("field")
    dt, dn = split(det_col)
    ft, fn = split(dep_col)
    det_vals, dep_vals = mined_values(body)
    det_fld = dictionary.field(dt, dn) if dt and dn else None
    dep_fld = dictionary.field(ft, fn) if ft and fn else None
    is_red, why = redundant(kind, dictionary, det_col, dep_col)
    keys = p.get("sample_keys") or []
    return {
        "id": str(p["id"]), "module": p.get("module") or "", "kind": kind, "source": p.get("source") or "data",
        "status": p.get("status") or "pending", "table_name": p.get("table_name") or "",
        "determinant": det_col, "field": dep_col or "",
        "confidence": p.get("confidence"), "support_rows": p.get("support_rows"), "violations": p.get("violations"),
        "lift": lift(kind, body, p.get("confidence"), profiles.get((dt, dn)), profiles.get((ft, fn)), dt == ft),
        "determinant_anchor": anchor(dictionary, det_col) if det_col else None,
        "field_anchor": anchor(dictionary, dep_col),
        "out_of_dictionary": out_of_dictionary(dep_vals, dep_fld, live, baseline) if dep_vals else None,
        "determinant_out_of_dictionary": out_of_dictionary(det_vals, det_fld, live, baseline) if det_vals else None,
        "redundant": is_red, "redundant_reason": why,
        "sample_keys": [k if isinstance(k, dict) else {"key": str(k)} for k in keys][:10],
    }
