"""Aletheia anomaly-to-rule: a statistically detected anomaly in, a deterministic rule draft out.

Deterministic template first (outlier -> cross_field_check bound, null spike -> null_check, unexpected code ->
domain_value_check); the LLM is only a fallback through ``rule_authoring.generate`` and sees the anomaly summary
(field, statistic, counts), never a record. Every proposal goes through ``rule_authoring.validate_rule_yaml`` so it
names only DDIC fields; the dry run and the draft are the existing rule-authoring ones.
"""

from __future__ import annotations

import re
from typing import Literal, Optional

import yaml

KINDS = ("outlier", "null_spike", "unexpected_code")
Kind = Literal["outlier", "null_spike", "unexpected_code"]
MAX_CODES = 50  # a domain list longer than this is not a code field


def _id(prefix: str, field: str) -> str:
    return f"ANOM_{prefix}_" + re.sub(r"[^A-Z0-9]+", "_", field.upper()).strip("_")


def _num(v: float) -> str:
    return repr(float(v)).removesuffix(".0")


def template_rule(a: dict) -> Optional[dict]:
    """The rule a template maps ``a`` to, or None when the anomaly lacks what the template needs.

    ``a``: kind, field (TABLE.FIELD), severity, and per kind: lower/upper (outlier), known_values
    (unexpected_code: the codes the baseline held, never invented)."""
    kind, field = a.get("kind"), a.get("field") or ""
    if "." not in field:
        return None
    base = {"field": field, "severity": a.get("severity") or "medium"}
    if kind == "outlier":
        lo, hi = a.get("lower"), a.get("upper")
        parts = ([f"`{field}` < {_num(lo)}"] if lo is not None else []) + \
                ([f"`{field}` > {_num(hi)}"] if hi is not None else [])
        if not parts:
            return None
        if lo is not None and hi is not None:
            rng = f"{_num(lo)} to {_num(hi)}"
        else:
            rng = f"at least {_num(lo)}" if lo is not None else f"at most {_num(hi)}"
        return {"id": _id("OUT", field), **base, "check_class": "cross_field_check", "dimension": "accuracy",
                "fail_when": " | ".join(f"({p})" for p in parts), "require_populated": True,
                "message": f"{field} outside the usual range ({rng})"}
    if kind == "null_spike":
        return {"id": _id("NULL", field), **base, "check_class": "null_check", "dimension": "completeness",
                "message": f"{field} must be filled"}
    if kind == "unexpected_code":
        known = sorted({str(v).strip() for v in a.get("known_values") or [] if str(v).strip()})
        if not known or len(known) > MAX_CODES:
            return None
        return {"id": _id("DOM", field), **base, "check_class": "domain_value_check", "dimension": "validity",
                "allowed_values": known, "message": f"{field} holds a code outside the baseline set"}
    return None


def describe(a: dict) -> str:
    """Aggregate-only description for the LLM fallback: field, statistic, counts. No record keys or values."""
    bits = [f"Statistical anomaly of kind {a.get('kind')} on {a.get('field')} in module {a.get('module')}."]
    for k in ("method", "z_score", "lower", "upper", "count"):
        if a.get(k) is not None:
            bits.append(f"{k}: {a[k]}.")
    bits.append("Write one deterministic rule that would flag the records behind it.")
    return " ".join(bits)


def to_yaml(rule: dict) -> str:
    return yaml.safe_dump(rule, sort_keys=False)


def confidence(source: str, valid: bool, dry: dict) -> dict:
    """Origin (template or LLM) and whether the dry run evaluated and hit anything: high only for a template that hits."""
    if not valid or not dry.get("evaluated"):
        return {"basis": source, "level": "low"}
    hits = dry.get("hits") or 0
    return {"basis": source, "level": "high" if source == "template" and hits else "medium" if hits else "low"}
