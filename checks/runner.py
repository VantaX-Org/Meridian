import logging
from typing import Any
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

import pandas as pd
import yaml

from checks import cost
from checks.base import BaseCheck, CheckResult, as_of_time, sap_number
from checks.frames import TableFrames, tables_of
from checks.population import exclude, exclusions, fields_for
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
from checks.types.value_placement_check import ValuePlacementCheck
from checks.types.balance_check import BalanceCheck
from checks.types.country_format_check import CountryFormatCheck
from checks.types.aggregate_check import AggregateCheck
from checks.types.interval_check import IntervalCheck
from checks.types.exists_check import ExistsCheck, key_of
from checks.types.dependency_check import DependencyCheck
from checks.types.hierarchy_check import HierarchyCheck
from checks.types.similarity_check import SimilarityCheck
from checks.types.group_sum_check import GroupSumCheck, child_sums

logger = logging.getLogger("meridian.checks")


def apply_context(df: pd.DataFrame, applies_when: dict | None, as_of: Any = None) -> pd.DataFrame:
    """Filter `df` to rows that satisfy every condition in `applies_when`.

    `applies_when` is a dict of {field: allowed_values}; AND-combined.
    Returns:
      - df unchanged if applies_when is None/empty
      - df.iloc[:0] (zero rows) if any field in applies_when is missing (a
        {blank: true} condition on a missing field holds: nothing carries a value)
        from the extract — lets the caller treat the rule as "not applicable
        to this extract" via the existing None-result pathway
      - filtered df otherwise

    `as_of` is the date `older_than_days` counts back from (the run's snapshot
    date; now when None).

    Example: a rule with `applies_when: {MARA.MTART: ["FERT", "HALB"]}`
    runs only against finished/semi-finished materials; total_count and
    pass_rate reflect that scoped population, not the whole extract.
    """
    if not applies_when:
        return df
    mask = pd.Series(True, index=df.index)
    for field, allowed in applies_when.items():
        if field not in df.columns:
            if isinstance(allowed, dict) and set(allowed) == {"blank"}:
                continue  # not extracted: no record is known to carry a value (e.g. no branch accounts)
            return df.iloc[:0]
        values = df[field].astype("string").str.strip()
        if isinstance(allowed, dict):
            # Operators: contains_any (multi-value code strings such as
            # LFB1.ZWELS "CT"), not_in, populated, gt (numeric), startswith,
            # older_than_days / within_days (dates relative to the run's as-of date).
            if "contains_any" in allowed:
                chars = {str(v) for v in allowed["contains_any"]}
                mask &= values.map(lambda v: isinstance(v, str) and any(c in v for c in chars)).astype(bool)
            if "not_in" in allowed:
                mask &= ~values.isin({str(v).strip() for v in allowed["not_in"]}).fillna(False)
            if allowed.get("populated"):
                mask &= values.fillna("").ne("") & ~values.isin(("00000000",)).fillna(False)
            if allowed.get("blank"):
                mask &= values.fillna("").eq("") | values.isin(("00000000",)).fillna(False)
            if "gt" in allowed:
                mask &= sap_number(values).gt(float(allowed["gt"])).fillna(False)
            if "startswith" in allowed:
                prefixes = tuple(str(v) for v in allowed["startswith"])
                mask &= values.str.startswith(prefixes).fillna(False).astype(bool)
            if "older_than_days" in allowed or "within_days" in allowed:
                # SAP dates (YYYYMMDD or ISO) relative to the as-of date; blank / 00000000 never match
                age = (as_of_time(as_of).normalize() - pd.to_datetime(
                    values.str.replace("-", "", regex=False), format="%Y%m%d", errors="coerce")).dt.days
                if "older_than_days" in allowed:
                    mask &= age.gt(int(allowed["older_than_days"])).fillna(False)
                if "within_days" in allowed:
                    mask &= age.le(int(allowed["within_days"])).fillna(False)
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
    "value_placement_check": ValuePlacementCheck,
    "balance_check": BalanceCheck,
    "country_format_check": CountryFormatCheck,
    "aggregate_check": AggregateCheck,
    "interval_check": IntervalCheck,
    "exists_check": ExistsCheck,
    "similarity_check": SimilarityCheck,
    "dependency_check": DependencyCheck,
    "hierarchy_check": HierarchyCheck,
    "group_sum_check": GroupSumCheck,
}

# check types judging a group of rows together: only sound on a complete extract
_WHOLE_GROUP = {"balance_check", "aggregate_check", "interval_check", "hierarchy_check", "group_sum_check"}

RULES_DIR = Path(__file__).parent / "rules"
CATEGORIES = ["ecc", "successfactors", "warehouse", "concur", "ariba"]


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


@lru_cache(maxsize=None)
def is_overlay(module_name: str) -> bool:
    """An overlay module (``overlay: true``) re-judges tables other modules extract,
    e.g. S/4HANA readiness: it runs its rules only, with no generated rules, profiling,
    cleaning, dedup, mining or golden records of its own."""
    try:
        with open(_find_module_yaml(module_name), "r") as f:
            return bool((yaml.safe_load(f) or {}).get("overlay"))
    except FileNotFoundError:
        return False


S4_KEYS = ("s4_area", "s4_impact", "simplification_item")


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
    # live values replace the baseline unless the rule's list is narrower by design (weight units ⊂ T006)
    if key and key in reference_values and rule.get("live_reference") is not False:
        out["_live_reference"] = reference_values[key]
    return out


def target_of(rule: dict) -> str:
    """The system the data is judged fit for: ``s4hana`` for S/4HANA readiness rules, else ``ecc``."""
    return "s4hana" if baseline_of(rule) == "s4_target" else "ecc"


def baseline_of(rule: dict) -> str:
    """What a rule judges the data against: ``s4_target`` (S/4HANA readiness),
    ``sap_standard`` (a value-list rule whose check table was not extracted live,
    so it fell back to SAP's standard list) or ``live_config`` (the system's own
    configuration and master data)."""
    if rule.get("baseline"):
        return rule["baseline"]
    if rule.get("check_class") in ("referential_check", "domain_value_check") and "_live_reference" not in rule:
        return "sap_standard"
    return "live_config"


def rule_columns(rule: dict) -> list[str]:
    """Every ``TABLE.FIELD`` column a rule reads (field, fields, condition, applies_when)."""
    check_cls = REGISTRY.get(rule.get("check_class", ""))
    cols = check_cls(rule).columns() if check_cls else [rule["field"]] if rule.get("field") else []
    return list(dict.fromkeys(cols + list((rule.get("applies_when") or {}).keys())))


def target_columns(rule: dict) -> list[str]:
    """Columns of the table an exists_check looks references up in, or a group_sum_check
    sums (read in full, not joined)."""
    if rule.get("check_class") == "group_sum_check":
        return list(dict.fromkeys([rule["amount"], *rule["group_keys"], *(rule.get("child_when") or {})]
                                  + ([rule["sign_field"]] if rule.get("sign_field") else [])))
    if rule.get("check_class") != "exists_check":
        return []
    t = rule["target_table"]
    return [f"{t}.{f}" for f in list(rule["target_fields"]) + list(rule.get("target_when") or {})]


def _with_targets(rule: dict, frames: TableFrames, as_of: Any = None) -> dict | str | None:
    """The rule with its target key set; None when the target table was not read; a reason
    when it was read incompletely (a reference to a record outside the read is not missing)."""
    t = rule["target_table"]
    if t in getattr(frames, "incomplete", set()) | getattr(frames, "partial", set()):
        return f"not evaluated: {t} was not read in full (incomplete, windowed or scoped download)"
    target = frames.frames.get(t)
    if target is None or any(c not in target.columns for c in target_columns(rule)):
        return None
    when = {f"{t}.{k}": v for k, v in (rule.get("target_when") or {}).items()}
    target = apply_context(target, when, as_of)
    return {**rule, "_target_values": set(key_of(target, [f"{t}.{f}" for f in rule["target_fields"]]))}


def _with_child_sums(rule: dict, frames: TableFrames) -> dict | None:
    """The rule with its child totals per parent key; None when the child table was not read."""
    child = frames.frames.get(tables_of([rule["amount"]])[0])
    if child is None or any(c not in child.columns for c in target_columns(rule)):
        return None
    return {**rule, "_child_sums": child_sums(rule, apply_context(child, rule.get("child_when")))}


def get_required_columns(module_name: str) -> set[str]:
    """Return every column referenced by the rules of a module (for column pruning)."""
    with open(_find_module_yaml(module_name), "r") as f:
        config = yaml.safe_load(f)
    cols = {c for rule in config.get("rules", []) for c in rule_columns(rule) + target_columns(rule)}
    return cols | {f"{t}.{f}" for t in tables_of(cols) for f in fields_for(t)}


def run_rule(rule: dict, frames: TableFrames, reference_values: dict[str, set[str]] | None = None,
             suppressed: dict[str, tuple[list[str], set[str]]] | None = None, *,
             as_of: Any = None) -> tuple[dict, CheckResult | None]:
    """Evaluate one rule at its grain: (rule as evaluated, result or None when not applicable).

    ``as_of`` is the date date-relative rules measure age against (the version's
    snapshot date); None means now."""
    if as_of is not None:
        as_of = as_of_time(as_of)
        rule = {**rule, "_as_of": as_of.isoformat()}
    check_cls = REGISTRY[rule["check_class"]]
    partial = sorted(set(tables_of(rule_columns(rule) + target_columns(rule))) & getattr(frames, "incomplete", set()))
    if rule.get("check_class") in _WHOLE_GROUP and partial:
        # a group missing rows in the extract (document lines, PO history, validity
        # periods) is not an unbalanced / unmatched / interrupted group
        return rule, check_cls(rule)._error(frames.flat if frames.flat is not None else pd.DataFrame(),
                                            f"not evaluated: extraction of {', '.join(partial)} is incomplete")
    if rule.get("check_class") in ("referential_check", "domain_value_check"):
        rule = _with_reference(rule, frames.dictionary, reference_values or {})
    if rule.get("check_class") == "exists_check":
        resolved = _with_targets(rule, frames, as_of)
        if resolved is None:
            return rule, None  # the referenced table is not in the extract
        if isinstance(resolved, str):
            return rule, check_cls(rule)._error(frames.flat if frames.flat is not None else pd.DataFrame(), resolved)
        rule = resolved
    try:
        if rule.get("check_class") == "group_sum_check":
            summed = _with_child_sums(rule, frames)
            if summed is None:
                return rule, None  # the child table is not in the extract
            rule = summed
        built = frames.frame_for(rule_columns(rule), grain=rule.get("grain"))
        if built is None:
            return rule, None  # a table/field this rule needs is not in the extract
        frame, grain, key_cols = built
        cols = rule_columns(rule)
        excl = exclusions(rule, [grain] if grain else tables_of(cols), cols)
        hidden = (suppressed or {}).get(rule.get("field", ""))
        if hidden and rule.get("check_class") != "field_status_check":
            # the system's own field status hides this field for these groups: nothing to fill there
            excl = excl + [{"id": "hidden_by_field_status", "fields": hidden[0], "values": sorted(hidden[1])}]
        need = [c for x in excl for c in (x.get("fields") or [x["field"]]) if c not in frame.columns]
        if need and grain:
            try:  # parent-table flags (LFA1.LOEVM for an LFB1 rule) join at the same grain
                wider = frames.frame_for(cols + need, grain=grain)
                frame = wider[0] if wider is not None else frame
            except ValueError:
                pass
        cf = (rule.get("_cost") or {}).get("field")
        if cf and cf not in frame.columns and grain:
            try:  # the cost field (EKPO.NETWR) joins at the same grain; else cost falls back to severity
                wider = frames.frame_for(list(dict.fromkeys(cols + need + [cf])), grain=grain)
                frame = wider[0] if wider is not None else frame
            except ValueError:
                pass
        frame, excluded = exclude(frame, excl, frames)
        scoped = apply_context(frame, rule.get("applies_when"), as_of)
        if len(scoped) == 0:
            return rule, None  # no records in the rule's population
        result = check_cls(rule).run(scoped, key_cols=key_cols, grain=grain)
        if result is not None and excluded:
            result.details["population_excluded"] = excluded
        if result is not None:
            result.details["baseline"] = baseline_of(rule)
            result.details.update({"target": target_of(rule), **{k: rule[k] for k in S4_KEYS if rule.get(k)}})
        return rule, result
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
    suppressed: dict[str, tuple[list[str], set[str]]] | None = None,
    cost_model: dict | None = None,
    *,
    as_of: Any = None,
) -> list[CheckResult]:
    """Load a module's YAML rules and evaluate each at its correct record grain.

    ``data`` is either per-table frames (live extraction) or a flat
    ``TABLE.FIELD`` frame (upload), which is split by DDIC key where possible.
    ``reference_values`` maps ``TABLE.FIELD`` of a configuration table (e.g.
    ``T077Y.KTOKK``) to the values read live from the source system; referential
    rules naming that ``reference_table`` use them instead of their SAP-standard list.
    ``as_of`` is the snapshot date that ageing, freshness and future-date rules
    measure against; None means now (wall clock).
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
        rule["_cost"] = cost.resolve(rule, cost_model)
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

        rule, result = run_rule(rule, frames, reference_values, suppressed, as_of=as_of)
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
            for key in ("why_it_matters", "rule_authority", "sap_impact", "valid_values_with_labels",
                        *S4_KEYS):
                if rule.get(key):
                    rule_context[key] = rule[key]
            if target_of(rule) == "s4hana":
                rule_context["target"] = "s4hana"

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
