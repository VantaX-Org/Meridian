import logging
import os
from dataclasses import asdict
from pathlib import Path

import pandas as pd
import yaml

from checks.base import BaseCheck, CheckResult
from checks.fix_generator import FixGenerator
from checks.types.null_check import NullCheck
from checks.types.regex_check import RegexCheck
from checks.types.domain_value_check import DomainValueCheck
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.referential_check import ReferentialCheck
from checks.types.freshness_check import FreshnessCheck

logger = logging.getLogger("meridian.checks")

# CHECK_ENGINE toggle: "pandas", "polars", or "auto" (default).
# When "auto", the engine is chosen per-DataFrame by row count — pandas wins
# at small scale (no setup overhead) and polars wins above the threshold.
CHECK_ENGINE = os.getenv("CHECK_ENGINE", "auto").lower()

# Row count at or above which "auto" mode switches to polars.
# Tuned for 400k-row extracts: polars is ~4-8x faster on null/regex/domain
# at that size, and the setup cost crosses over around 30-60k rows.
CHECK_ENGINE_POLARS_THRESHOLD = int(os.getenv("CHECK_ENGINE_POLARS_THRESHOLD", "50000"))


def _select_engine(row_count: int) -> str:
    """Resolve the engine for a given DataFrame size.

    `CHECK_ENGINE=pandas` or `=polars` forces that engine regardless of size.
    `CHECK_ENGINE=auto` (default) picks polars when row_count >= threshold.
    """
    if CHECK_ENGINE in ("pandas", "polars"):
        return CHECK_ENGINE
    return "polars" if row_count >= CHECK_ENGINE_POLARS_THRESHOLD else "pandas"

REGISTRY: dict[str, type[BaseCheck]] = {
    "null_check": NullCheck,
    "regex_check": RegexCheck,
    "domain_value_check": DomainValueCheck,
    "cross_field_check": CrossFieldCheck,
    "referential_check": ReferentialCheck,
    "freshness_check": FreshnessCheck,
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


def get_required_columns(module_name: str) -> set[str]:
    """Return every column name referenced by the rules of a module.

    Used by run_checks to only load the parquet columns that will actually
    be validated, which dramatically reduces memory and I/O for modules
    with hundreds of columns but fewer checked fields.
    """
    yaml_path = _find_module_yaml(module_name)
    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)
    cols: set[str] = set()
    for rule in config.get("rules", []):
        field = rule.get("field")
        if field:
            cols.add(field)
        for f in rule.get("fields", []) or []:
            cols.add(f)
    return cols


def run_checks(module_name: str, df: pd.DataFrame, tenant_id: str) -> list[CheckResult]:
    """Load YAML rules for a module and run all checks against the DataFrame.

    Engine is selected by _select_engine — pandas for small frames,
    polars above CHECK_ENGINE_POLARS_THRESHOLD (default 50k rows). On large
    extracts (400k+) polars is ~4-8x faster. Explicit CHECK_ENGINE env var
    overrides the heuristic.
    """
    yaml_path = _find_module_yaml(module_name)

    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)

    rules = config.get("rules", [])
    module = config.get("module", module_name)

    engine = _select_engine(len(df))
    logger.info(f"Module '{module}': {len(df):,} rows, engine={engine}")

    # ---------- Polars fast path ----------
    if engine == "polars":
        try:
            from checks.polars_engine import run_checks_polars_df

            raw_results = run_checks_polars_df(df, module, rules)
            return [
                CheckResult(
                    check_id=r.get("check_id", "UNKNOWN"),
                    module=r.get("module", module),
                    field=r.get("field", ""),
                    severity=r.get("severity", "medium"),
                    dimension=r.get("dimension", ""),
                    passed=r.get("passed", False),
                    affected_count=r.get("affected_count", 0),
                    total_count=r.get("total_count", 0),
                    pass_rate=r.get("pass_rate", 0.0),
                    message=r.get("message", ""),
                    details=r.get("details", {}),
                    error=r.get("error"),
                )
                for r in raw_results
            ]
        except ImportError:
            logger.warning("Polars not installed — falling back to pandas engine")
        except Exception as e:
            logger.error(f"Polars engine failed — falling back to pandas: {e}", exc_info=True)
    # ---------- End Polars fast path ----------

    results: list[CheckResult] = []
    result_rules: list[dict] = []  # parallel list — the rule that produced each result
    skipped = 0

    for rule in rules:
        # Inject module name into each rule dict
        rule["module"] = module

        check_class_name = rule.get("check_class", "")
        check_cls = REGISTRY.get(check_class_name)

        if check_cls is None:
            logger.warning(f"Unknown check_class '{check_class_name}' in rule {rule.get('id')}")
            results.append(
                CheckResult(
                    check_id=rule.get("id", "UNKNOWN"),
                    module=module,
                    field=rule.get("field", ""),
                    severity=rule.get("severity", "medium"),
                    dimension=rule.get("dimension", ""),
                    passed=False,
                    affected_count=0,
                    total_count=len(df),
                    pass_rate=0.0,
                    message=rule.get("message", ""),
                    details={},
                    error=f"Unknown check_class: {check_class_name}",
                )
            )
            result_rules.append(rule)
            continue

        try:
            check = check_cls(rule)
            result = check.run(df)
            if result is None:
                # Field not in partial extract — skip silently
                skipped += 1
                continue
            results.append(result)
            result_rules.append(rule)
        except Exception as e:
            logger.error(f"Exception in check {rule.get('id')}: {e}", exc_info=True)
            results.append(
                CheckResult(
                    check_id=rule.get("id", "UNKNOWN"),
                    module=module,
                    field=rule.get("field", ""),
                    severity=rule.get("severity", "medium"),
                    dimension=rule.get("dimension", ""),
                    passed=False,
                    affected_count=0,
                    total_count=len(df),
                    pass_rate=0.0,
                    message=rule.get("message", ""),
                    details={},
                    error=str(e),
                )
            )
            result_rules.append(rule)

    if skipped:
        logger.info(f"Module '{module}': skipped {skipped} checks (fields not in extract)")
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
                id_field = result.details.get("id_field_used", df.columns[0])
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
