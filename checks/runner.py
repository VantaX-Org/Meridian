import logging
from dataclasses import asdict
from pathlib import Path

import pandas as pd
import yaml

from checks.base import BaseCheck, CheckResult
from checks.frames import TableFrames
from checks.fix_generator import FixGenerator
from checks.types.null_check import NullCheck
from checks.types.regex_check import RegexCheck
from checks.types.domain_value_check import DomainValueCheck
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.referential_check import ReferentialCheck
from checks.types.freshness_check import FreshnessCheck
from checks.types.format_check import FormatCheck
from checks.types.field_status_check import FieldStatusCheck
from checks.types.uniqueness_check import UniquenessCheck

logger = logging.getLogger("meridian.checks")


def apply_context(df: pd.DataFrame, applies_when: dict | None) -> pd.DataFrame:
    """Filter `df` to rows that satisfy every condition in `applies_when`.

    `applies_when` is a dict of {field: allowed_values}; AND-combined.
    Returns:
      - df unchanged if applies_when is None/empty
      - df.iloc[:0] (zero rows) if any field in applies_when is missing
        from the extract — lets the caller treat the rule as "not applicable
        to this extract" via the existing None-result pathway
      - filtered df otherwise

    Example: a rule with `applies_when: {MARA.MTART: ["FERT", "HALB"]}`
    runs only against finished/semi-finished materials; total_count and
    pass_rate reflect that scoped population, not the whole extract.
    """
    if not applies_when:
        return df
    mask = pd.Series(True, index=df.index)
    for field, allowed in applies_when.items():
        if field not in df.columns:
            return df.iloc[:0]
        values = df[field].astype("string").str.strip()
        if isinstance(allowed, dict):
            # Operators: contains_any (multi-value code strings such as
            # LFB1.ZWELS "CT"), not_in, populated, gt (numeric).
            if "contains_any" in allowed:
                chars = {str(v) for v in allowed["contains_any"]}
                mask &= values.map(lambda v: isinstance(v, str) and any(c in v for c in chars)).astype(bool)
            if "not_in" in allowed:
                mask &= ~values.isin({str(v).strip() for v in allowed["not_in"]}).fillna(False)
            if allowed.get("populated"):
                mask &= values.fillna("").ne("") & ~values.isin(("00000000",)).fillna(False)
            if "gt" in allowed:
                mask &= pd.to_numeric(values, errors="coerce").gt(float(allowed["gt"])).fillna(False)
        else:
            mask &= values.isin({str(v).strip() for v in allowed}).fillna(False)
    return df[mask]

REGISTRY: dict[str, type[BaseCheck]] = {
    "null_check": NullCheck,
    "regex_check": RegexCheck,
    "domain_value_check": DomainValueCheck,
    "cross_field_check": CrossFieldCheck,
    "referential_check": ReferentialCheck,
    "freshness_check": FreshnessCheck,
    "format_check": FormatCheck,
    "field_status_check": FieldStatusCheck,
    "uniqueness_check": UniquenessCheck,
}

RULES_DIR = Path(__file__).parent / "rules"
CATEGORIES = ["ecc", "successfactors", "warehouse"]


def _find_module_yaml(module_name: str) -> Path:
    """Find the YAML rule file for a module across all category directories."""
    for category in CATEGORIES:
        path = RULES_DIR / category / f"{module_name}.yaml"
        if path.exists():
            return path
    raise FileNotFoundError(
        f"No YAML rule file found for module '{module_name}' in {RULES_DIR}. "
        f"Searched categories: {CATEGORIES}"
    )


def _with_reference(rule: dict, dictionary, reference_values: dict[str, set[str]]) -> dict:
    """Attach the source system's live allowed values to a value-list rule.

    Resolution: the rule's explicit ``reference_table.reference_field``, else
    the field's DDIC check table (``T134.MTART`` for MARA.MTART), else the SF
    picklist. When the source system's live configuration holds that table,
    its values replace the rule's SAP-standard list — so a customer's own
    Z material types / order types are valid, not findings.
    """
    field = dictionary.resolve(rule.get("field", "")) if rule.get("field") else None
    if rule.get("reference_table") and rule.get("reference_field"):
        key = f"{rule['reference_table']}.{rule['reference_field']}"
    elif field is not None and field.picklist:
        key = f"PICKLIST.{field.picklist}"
    else:
        key = field.check_ref if field is not None else None
    out = {**rule, "_reference_key": key}
    if field is not None and field.allowed_values():
        out["_ddic_fixed"] = sorted(field.allowed_values())  # domain fixed values (DD07L)
    if key and key in reference_values:
        out["_live_reference"] = reference_values[key]
    return out


def rule_columns(rule: dict) -> list[str]:
    """Every ``TABLE.FIELD`` column a rule reads (field, fields, condition, applies_when)."""
    check_cls = REGISTRY.get(rule.get("check_class", ""))
    cols = check_cls(rule).columns() if check_cls else [rule["field"]] if rule.get("field") else []
    return list(dict.fromkeys(cols + list((rule.get("applies_when") or {}).keys())))


def get_required_columns(module_name: str) -> set[str]:
    """Return every column referenced by the rules of a module (for column pruning)."""
    with open(_find_module_yaml(module_name), "r") as f:
        config = yaml.safe_load(f)
    return {c for rule in config.get("rules", []) for c in rule_columns(rule)}


def run_rule(rule: dict, frames: TableFrames, reference_values: dict[str, set[str]] | None = None
             ) -> tuple[dict, CheckResult | None]:
    """Evaluate one rule at its grain: (rule as evaluated, result or None when not applicable)."""
    check_cls = REGISTRY[rule["check_class"]]
    if rule.get("check_class") in ("referential_check", "domain_value_check"):
        rule = _with_reference(rule, frames.dictionary, reference_values or {})
    try:
        built = frames.frame_for(rule_columns(rule), grain=rule.get("grain"))
        if built is None:
            return rule, None  # a table/field this rule needs is not in the extract
        frame, grain, key_cols = built
        scoped = apply_context(frame, rule.get("applies_when"))
        if len(scoped) == 0:
            return rule, None  # no records in the rule's population
        return rule, check_cls(rule).run(scoped, key_cols=key_cols, grain=grain)
    except Exception as e:
        logger.error(f"Exception in check {rule.get('id')}: {e}", exc_info=True)
        return rule, check_cls(rule)._error(frames.flat if frames.flat is not None else pd.DataFrame(), str(e))


def run_checks(
    module_name: str,
    data: pd.DataFrame | TableFrames,
    tenant_id: str,
    reference_values: dict[str, set[str]] | None = None,
    overrides: dict[str, dict] | None = None,
    extra_rules: list[dict] | None = None,
) -> list[CheckResult]:
    """Load a module's YAML rules and evaluate each at its correct record grain.

    ``data`` is either per-table frames (live extraction) or a flat
    ``TABLE.FIELD`` frame (upload), which is split by DDIC key where possible.
    ``reference_values`` maps ``TABLE.FIELD`` of a configuration table (e.g.
    ``T077Y.KTOKK``) to the values read live from the source system; referential
    rules naming that ``reference_table`` use them instead of their SAP-standard list.
    """
    with open(_find_module_yaml(module_name), "r") as f:
        config = yaml.safe_load(f)
    from checks.overrides import apply
    # HQ / tenant governance (checks/overrides.py) applies to generated rules too
    rules = apply(config.get("rules", []) + [r for r in (extra_rules or []) if r.get("module") == module_name],
                  overrides)
    module = config.get("module", module_name)
    frames = data if isinstance(data, TableFrames) else TableFrames.from_flat(data, module=module)
    frames.module = module
    reference_values = reference_values or {}

    results: list[CheckResult] = []
    result_rules: list[dict] = []
    skipped = 0

    for rule in rules:
        rule["module"] = module
        check_cls = REGISTRY.get(rule.get("check_class", ""))
        if check_cls is None:
            results.append(CheckResult(
                check_id=rule.get("id", "UNKNOWN"), module=module, field=rule.get("field", ""),
                severity=rule.get("severity", "medium"), dimension=rule.get("dimension", ""),
                passed=False, affected_count=0, total_count=0, pass_rate=0.0,
                message=rule.get("message", ""), details={},
                error=f"Unknown check_class: {rule.get('check_class')}",
            ))
            result_rules.append(rule)
            continue

        rule, result = run_rule(rule, frames, reference_values)
        if result is None:
            skipped += 1
            continue
        results.append(result)
        result_rules.append(rule)

    if skipped:
        logger.info(f"Module '{module}': skipped {skipped} checks (tables/fields not in extract)")
    logger.info(f"Module '{module}': ran {len(results)} checks, {sum(1 for r in results if r.passed)} passed")

    # Enrich failing results with deterministic fix recommendations
    fix_gen = FixGenerator()
    for i, result in enumerate(results):
        if result.passed or result.error:
            continue

        try:
            rule = result_rules[i]

            # Build rule_context from YAML fields
            rule_context: dict = {}
            for key in ("why_it_matters", "rule_authority", "sap_impact", "valid_values_with_labels"):
                if rule.get(key):
                    rule_context[key] = rule[key]

            fix_map = rule.get("fix_map", {})
            if not fix_map:
                results[i] = result.model_copy(update={"rule_context": rule_context or None})
                continue

            # Build value_fix_map from distinct_invalid_values in details
            value_fix_map = None
            distinct = result.details.get("distinct_invalid_values", {})
            if distinct:
                vfm = fix_gen.build_value_fix_map(
                    distinct, fix_map, rule.get("valid_values_with_labels")
                )
                value_fix_map = {k: asdict(v) for k, v in vfm.items()}

            # Build record_fixes from sample_failing_records in details
            record_fixes = None
            samples = result.details.get("sample_failing_records", [])
            if samples:
                table_name = rule["field"].split(".")[0] if "." in rule["field"] else None
                check_field = rule["field"].split(".")[-1] if "." in rule["field"] else rule["field"]
                id_field = result.details.get("id_field_used") or "record_key"
                rf_list = fix_gen.build_record_fixes(
                    sample_failing_records=samples,
                    id_field=id_field,
                    check_field=check_field,
                    fix_map=fix_map,
                    record_fix_template=rule.get("record_fix_template"),
                    table_name=table_name,
                )
                record_fixes = [asdict(rf) for rf in rf_list]

            results[i] = result.model_copy(update={
                "rule_context": rule_context or None,
                "value_fix_map": value_fix_map,
                "record_fixes": record_fixes,
            })
        except Exception as e:
            logger.warning(f"Fix enrichment failed for {result.check_id}: {e}")

    return results
