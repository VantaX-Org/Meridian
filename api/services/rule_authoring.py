"""AI-assisted rule authoring: plain English in, validated rule YAML out.

The LLM sees metadata only: table/field names, DDIC attributes and aggregate
profile statistics (counts, lengths, formats). It never sees a row value —
``prompt_context`` whitelists what goes in and ``assert_no_values`` re-checks it.
The dry run evaluates the rule locally; its masked sample never reaches the LLM.
"""

from __future__ import annotations

import json
import time
from typing import Optional

import yaml

from checks.profiling import is_sensitive
from checks.runner import REGISTRY, rule_columns, run_rule
from api.services.remediation import module_rules
from api.utils.pii_fields import PII_EXCLUDED_FIELDS

SEVERITIES = {"critical", "high", "medium", "low"}
REQUIRED = ("id", "check_class", "severity", "dimension", "message")
DIMENSIONS = {"completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"}

# profile stats that are counts / lengths / formats — never values
SAFE_STATS = {"rows", "table_rows", "sampled", "blank", "blank_pct", "distinct", "min_length", "max_length",
              "ddic_type", "ddic_length", "description", "shapes", "shape_count", "masked"}
# narrative keys of example rules: long, and they quote sample values
_NARRATIVE = {"why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template",
              "valid_values_with_labels"}
EXAMPLES = 6


def safe_stats(stats: dict) -> dict:
    out = {k: v for k, v in (stats or {}).items() if k in SAFE_STATS}
    if isinstance(stats.get("numeric"), dict):
        out["non_numeric"] = stats["numeric"].get("non_numeric")
    if isinstance(stats.get("dates"), dict):
        out["invalid_dates"] = stats["dates"].get("invalid")
    return out


def field_context(qualified: str, dictionary, stats: Optional[dict]) -> dict:
    """What the LLM may know about one TABLE.FIELD."""
    f = dictionary.resolve(qualified) if dictionary is not None else None
    ctx = {"field": qualified}
    if f is not None:
        ctx.update(type=f.type, length=f.length, description=f.description, check_table=f.check_ref,
                   key=f.key, fixed_values=[{"low": v.low, "high": v.high, "text": v.text}
                                            for v in f.fixed_values][:30])
    if stats:
        ctx["profile"] = safe_stats(stats)
    return ctx


def prompt_context(module: str, profiles: dict[str, dict], dictionary) -> dict:
    """Fields (profiled, else the module's rule columns) with metadata + example rules."""
    rules = list(module_rules(module).values())
    fields = sorted(profiles) or sorted({c for r in rules for c in rule_columns(r)})
    examples = [{k: v for k, v in r.items() if k not in _NARRATIVE} for r in rules[:EXAMPLES]]
    return {"module": module, "fields": [field_context(q, dictionary, profiles.get(q)) for q in fields],
            "check_classes": sorted(REGISTRY), "examples": examples}


def assert_no_values(ctx: dict) -> None:
    """Guard: profile blocks may only carry whitelisted aggregate keys."""
    allowed = SAFE_STATS | {"non_numeric", "invalid_dates"}
    for f in ctx["fields"]:
        leaked = set(f.get("profile", {})) - allowed
        if leaked:
            raise ValueError(f"profile keys not allowed in an LLM prompt: {sorted(leaked)}")


def build_prompt(description: str, ctx: dict) -> str:
    assert_no_values(ctx)
    return (
        "You write SAP data quality rules for the Meridian check engine.\n"
        "Return ONLY one YAML mapping for a single rule (no list, no prose, no code fences).\n"
        f"Required keys: {', '.join(REQUIRED)}. severity is one of {sorted(SEVERITIES)}; "
        f"dimension is one of {sorted(DIMENSIONS)}; check_class is one of {ctx['check_classes']}.\n"
        "Use only TABLE.FIELD names listed below. Follow the shape of the example rules.\n"
        "Optional: fix_value — the corrected value, or a map {current: corrected, __blank__: x, __other__: y}.\n\n"
        f"Module: {ctx['module']}\n"
        f"Fields (metadata and aggregate statistics only):\n{json.dumps(ctx['fields'], default=str)}\n\n"
        f"Example rules:\n{yaml.safe_dump(ctx['examples'], sort_keys=False)}\n"
        f"Rule to write: {description.strip()}\n"
    )


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else ""
        s = s.rsplit("```", 1)[0]
    return s.strip()


def generate(tenant_id: str, description: str, ctx: dict) -> Optional[str]:
    """Rule YAML from the LLM, or None when AI is unavailable. Sync: run in a threadpool."""
    from api.utils.llm_logger import log_llm_call
    from llm.provider import get_llm, safe_invoke
    prompt = build_prompt(description, ctx)
    llm = get_llm()
    t0 = time.monotonic()
    out = safe_invoke(llm, prompt, timeout_seconds=90, max_tokens=1500)
    log_llm_call(tenant_id, "rule_authoring", prompt, getattr(llm, "model", "unknown"),
                 len(prompt) // 4, int((time.monotonic() - t0) * 1000), out is not None)
    return _strip_fences(out) if out else None


def validate_rule_yaml(text_: str, module: str, dictionary) -> tuple[Optional[dict], list[str]]:
    """(rule, errors) — the rule parses, names a known check class and only real fields."""
    try:
        rule = yaml.safe_load(text_)
    except yaml.YAMLError as e:
        return None, [f"not valid YAML: {e}"]
    if isinstance(rule, list) and len(rule) == 1:
        rule = rule[0]
    if not isinstance(rule, dict):
        return None, ["expected one YAML mapping"]
    errors = [f"missing {k}" for k in REQUIRED if not rule.get(k)]
    if rule.get("check_class") and rule["check_class"] not in REGISTRY:
        errors.append(f"unknown check_class {rule['check_class']}")
    if rule.get("severity") and rule["severity"] not in SEVERITIES:
        errors.append(f"severity must be one of {sorted(SEVERITIES)}")
    if rule.get("dimension") and rule["dimension"] not in DIMENSIONS:
        errors.append(f"dimension must be one of {sorted(DIMENSIONS)}")
    if rule.get("id") in module_rules(module):
        errors.append(f"id {rule['id']} already exists in {module}")
    if rule.get("check_class") in REGISTRY:
        try:
            cols = rule_columns(rule)
        except Exception as e:  # check class rejects its own config
            return rule, [f"invalid {rule['check_class']} config: {e}"]
        if not cols:
            errors.append("rule reads no TABLE.FIELD")
        for c in cols:
            t, _, f = c.partition(".")
            custom = f.upper().startswith(("Z", "Y")) and dictionary.table(t) is not None
            if dictionary.resolve(c) is None and not custom:
                errors.append(f"unknown field {c}")
    return rule, errors


def _mask(table_field: str, value: str, dictionary) -> str:
    t, _, f = table_field.partition(".")
    fd = dictionary.resolve(table_field) if f else None
    if f.upper() in PII_EXCLUDED_FIELDS or (f and is_sensitive(t, f, fd.data_element if fd else None)):
        return "***"
    return value


def dry_run(rule: dict, frames) -> dict:
    """Run the rule locally against an extraction: counts plus a masked sample (not sent to any LLM)."""
    _, result = run_rule(rule, frames)
    if result is None:
        return {"evaluated": False, "reason": "the extraction holds no records for this rule's fields"}
    if result.error:
        return {"evaluated": False, "reason": str(result.error)}
    d, field = frames.dictionary, result.details.get("field_checked") or ""
    table = field.split(".")[0]

    def masked(k: str, v: str) -> str:
        if k == "record_key":  # "BUKRS=1000|LIFNR=..." — mask sensitive key parts
            return "|".join(p if _mask(f"{table}.{p.split('=')[0]}", p, d) == p else p.split("=")[0] + "=***"
                            for p in v.split("|"))
        return _mask(field if k == "invalid_value" else k, v, d)

    sample = [{k: masked(k, v) for k, v in rec.items()} for rec in result.details.get("sample_failing_records", [])]
    return {"evaluated": True, "hits": result.affected_count, "population": result.total_count,
            "pass_rate": result.pass_rate, "sample": sample}
