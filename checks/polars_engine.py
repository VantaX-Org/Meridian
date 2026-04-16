"""Polars-based check engine for high-performance vectorised validation.

Activated by setting CHECK_ENGINE=polars. Uses pl.scan_parquet() for lazy
evaluation so only the columns and rows needed are materialised.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Union

try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False

logger = logging.getLogger("meridian.checks.polars_engine")


def run_null_check(lf: pl.LazyFrame, field: str, rule: dict) -> dict:
    """Vectorised null check in Polars."""
    try:
        stats = (
            lf.select(
                pl.len().alias("total"),
                (pl.col(field).is_null() | (pl.col(field).cast(pl.Utf8) == ""))
                .sum()
                .alias("null_count"),
            )
            .collect()
            .row(0)
        )
    except pl.exceptions.ColumnNotFoundError:
        return None  # field not in extract

    total, null_count = stats
    if total == 0:
        return None

    pass_rate = round((total - null_count) / total * 100, 2)
    threshold = rule.get("threshold", 100.0)
    passed = pass_rate >= threshold

    return {
        "check_id": rule.get("id", "UNKNOWN"),
        "module": rule.get("module", ""),
        "field": field,
        "severity": rule.get("severity", "medium"),
        "dimension": rule.get("dimension", "completeness"),
        "passed": passed,
        "affected_count": null_count,
        "total_count": total,
        "pass_rate": pass_rate,
        "message": rule.get("message", f"Null check on {field}"),
        "details": {"null_count": null_count, "empty_string_included": True},
    }


def run_regex_check(lf: pl.LazyFrame, field: str, pattern: str, rule: dict) -> dict:
    """Vectorised regex in Polars using Rust regex engine."""
    try:
        stats = (
            lf.filter(pl.col(field).is_not_null())
            .select(
                pl.len().alias("total"),
                pl.col(field)
                .cast(pl.Utf8)
                .str.contains(pattern)
                .not_()
                .sum()
                .alias("fail_count"),
            )
            .collect()
            .row(0)
        )
    except pl.exceptions.ColumnNotFoundError:
        return None

    total, fail_count = stats
    if total == 0:
        return None

    pass_rate = round((total - fail_count) / total * 100, 2)
    threshold = rule.get("threshold", 100.0)
    passed = pass_rate >= threshold

    return {
        "check_id": rule.get("id", "UNKNOWN"),
        "module": rule.get("module", ""),
        "field": field,
        "severity": rule.get("severity", "medium"),
        "dimension": rule.get("dimension", "validity"),
        "passed": passed,
        "affected_count": fail_count,
        "total_count": total,
        "pass_rate": pass_rate,
        "message": rule.get("message", f"Regex check on {field}"),
        "details": {"pattern": pattern},
    }


def run_domain_check(lf: pl.LazyFrame, field: str, allowed: list[str], rule: dict) -> dict:
    """Set membership check using Polars hash sets."""
    try:
        stats = (
            lf.filter(pl.col(field).is_not_null())
            .select(
                pl.len().alias("total"),
                pl.col(field)
                .cast(pl.Utf8)
                .is_in(allowed)
                .not_()
                .sum()
                .alias("invalid_count"),
            )
            .collect()
            .row(0)
        )
    except pl.exceptions.ColumnNotFoundError:
        return None

    total, invalid_count = stats
    if total == 0:
        return None

    pass_rate = round((total - invalid_count) / total * 100, 2)
    threshold = rule.get("threshold", 100.0)
    passed = pass_rate >= threshold

    # Collect distinct invalid values (capped at 50)
    distinct_invalid = {}
    if invalid_count > 0:
        try:
            invalid_df = (
                lf.filter(
                    pl.col(field).is_not_null()
                    & pl.col(field).cast(pl.Utf8).is_in(allowed).not_()
                )
                .select(pl.col(field).cast(pl.Utf8))
                .collect()
            )
            counts = invalid_df.group_by(field).len().sort("len", descending=True).head(50)
            distinct_invalid = dict(
                zip(
                    counts.get_column(field).to_list(),
                    counts.get_column("len").to_list(),
                )
            )
        except Exception:
            pass

    return {
        "check_id": rule.get("id", "UNKNOWN"),
        "module": rule.get("module", ""),
        "field": field,
        "severity": rule.get("severity", "medium"),
        "dimension": rule.get("dimension", "validity"),
        "passed": passed,
        "affected_count": invalid_count,
        "total_count": total,
        "pass_rate": pass_rate,
        "message": rule.get("message", f"Domain check on {field}"),
        "details": {
            "allowed_values": allowed,
            "distinct_invalid_values": distinct_invalid,
        },
    }


def run_cross_field_check(lf: pl.LazyFrame, condition: str, rule: dict) -> dict:
    """Cross-field check using Polars expressions.

    Supports simple comparisons (field1 == field2, field1 != '', etc.).
    Falls back to collecting and using pandas eval for complex conditions.
    """
    try:
        df_collected = lf.collect()
    except Exception as e:
        logger.error(f"Cross-field check collection failed: {e}")
        return None

    total = len(df_collected)
    if total == 0:
        return None

    # Try pandas eval as the reliable fallback for arbitrary condition strings
    try:
        pdf = df_collected.to_pandas()
        mask = pdf.eval(condition)
        fail_count = int((~mask).sum())
    except Exception as e:
        logger.warning(f"Cross-field condition '{condition}' eval failed: {e}")
        return {
            "check_id": rule.get("id", "UNKNOWN"),
            "module": rule.get("module", ""),
            "field": rule.get("field", ""),
            "severity": rule.get("severity", "medium"),
            "dimension": rule.get("dimension", "consistency"),
            "passed": False,
            "affected_count": 0,
            "total_count": total,
            "pass_rate": 0.0,
            "message": rule.get("message", "Cross-field check"),
            "details": {},
            "error": f"Condition eval failed: {e}",
        }

    pass_rate = round((total - fail_count) / total * 100, 2)
    threshold = rule.get("threshold", 100.0)
    passed = pass_rate >= threshold

    return {
        "check_id": rule.get("id", "UNKNOWN"),
        "module": rule.get("module", ""),
        "field": rule.get("field", ""),
        "severity": rule.get("severity", "medium"),
        "dimension": rule.get("dimension", "consistency"),
        "passed": passed,
        "affected_count": fail_count,
        "total_count": total,
        "pass_rate": pass_rate,
        "message": rule.get("message", "Cross-field check"),
        "details": {"condition": condition},
    }


def run_freshness_check(lf: pl.LazyFrame, field: str, max_age_hours: float, rule: dict) -> dict:
    """Date freshness check using Polars temporal operations."""
    now = datetime.now(timezone.utc)

    try:
        # Try parsing as datetime, then compute age
        dated = (
            lf.filter(pl.col(field).is_not_null())
            .with_columns(
                pl.col(field).cast(pl.Datetime("us")).alias("_parsed_dt")
            )
            .with_columns(
                ((pl.lit(now) - pl.col("_parsed_dt")).dt.total_hours()).alias("_age_hours")
            )
            .select(
                pl.len().alias("total"),
                (pl.col("_age_hours") > max_age_hours).sum().alias("stale_count"),
            )
            .collect()
            .row(0)
        )
    except pl.exceptions.ColumnNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Freshness check date parse failed for {field}: {e}")
        return None

    total, stale_count = dated
    if total == 0:
        return None

    pass_rate = round((total - stale_count) / total * 100, 2)
    threshold = rule.get("threshold", 100.0)
    passed = pass_rate >= threshold

    return {
        "check_id": rule.get("id", "UNKNOWN"),
        "module": rule.get("module", ""),
        "field": field,
        "severity": rule.get("severity", "medium"),
        "dimension": rule.get("dimension", "timeliness"),
        "passed": passed,
        "affected_count": stale_count,
        "total_count": total,
        "pass_rate": pass_rate,
        "message": rule.get("message", f"Freshness check on {field}"),
        "details": {"max_age_hours": max_age_hours, "stale_count": stale_count},
    }


# ---------------------------------------------------------------------------
# Dispatch map: check_class name -> handler function
# ---------------------------------------------------------------------------

_DISPATCH = {
    "null_check": lambda lf, rule: run_null_check(lf, rule["field"], rule),
    "regex_check": lambda lf, rule: run_regex_check(
        lf, rule["field"], rule.get("pattern", ""), rule
    ),
    "domain_value_check": lambda lf, rule: run_domain_check(
        lf, rule["field"], rule.get("valid_values", []), rule
    ),
    "cross_field_check": lambda lf, rule: run_cross_field_check(
        lf, rule.get("condition", "True"), rule
    ),
    "freshness_check": lambda lf, rule: run_freshness_check(
        lf, rule["field"], rule.get("max_age_hours", 24), rule
    ),
}


def run_checks_polars(
    parquet_path_or_bytes: Union[str, bytes],
    module_name: str,
    rules: list[dict],
) -> list[dict]:
    """Main entry point: run all checks for a module using Polars.

    Accepts either a file path (str) or raw bytes for the parquet data.
    Returns a list of result dicts compatible with CheckResult fields.
    """
    # Build the LazyFrame
    if isinstance(parquet_path_or_bytes, bytes):
        lf = pl.scan_parquet(io.BytesIO(parquet_path_or_bytes))
    else:
        lf = pl.scan_parquet(parquet_path_or_bytes)

    available_cols = set(lf.columns)
    results: list[dict] = []
    skipped = 0

    for rule in rules:
        rule["module"] = module_name
        check_class = rule.get("check_class", "")
        handler = _DISPATCH.get(check_class)

        if handler is None:
            # Unsupported check type (e.g. referential_check) — skip for Polars engine
            logger.warning(
                f"Polars engine does not support check_class '{check_class}' "
                f"(rule {rule.get('id')}), skipping"
            )
            skipped += 1
            continue

        # Skip if the required field is not in the parquet schema
        field = rule.get("field", "")
        if field and field not in available_cols:
            skipped += 1
            continue

        try:
            result = handler(lf, rule)
            if result is None:
                skipped += 1
                continue
            results.append(result)
        except Exception as e:
            logger.error(f"Polars check {rule.get('id')} failed: {e}", exc_info=True)
            results.append({
                "check_id": rule.get("id", "UNKNOWN"),
                "module": module_name,
                "field": field,
                "severity": rule.get("severity", "medium"),
                "dimension": rule.get("dimension", ""),
                "passed": False,
                "affected_count": 0,
                "total_count": 0,
                "pass_rate": 0.0,
                "message": rule.get("message", ""),
                "details": {},
                "error": str(e),
            })

    if skipped:
        logger.info(f"Polars engine '{module_name}': skipped {skipped} checks")
    logger.info(
        f"Polars engine '{module_name}': ran {len(results)} checks, "
        f"{sum(1 for r in results if r.get('passed'))} passed"
    )

    return results
