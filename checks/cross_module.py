"""Cross-module consistency checks — Procure-to-Pay, Order-to-Cash, etc.

Single-module rules (null, regex, domain, cross_field within one extract) can't
catch the failures that hurt most in real SAP tenants: a PO with payment terms
that disagree with the vendor master; a sales order whose customer credit limit
is exceeded by its own line-total; a GL posting whose document type is valid
(T003) but inconsistent with the company-code block on the account.

This module is the orchestrator for rules that span more than one module
extract. It joins the relevant extracts per rule spec and then delegates to the
existing check classes — no new check_class is needed. Rule authors just add
`sources:` and `join_on:` metadata alongside a normal `condition:`.

YAML shape:
    - id: XP2P001
      check_class: cross_field_check
      sources:
        - module: mm_purchasing
          alias: EKKO
        - module: accounts_payable
          alias: LFA1
      join_on:
        - left: LIFNR_x    # EKKO.LIFNR after merge
          right: LIFNR_y   # LFA1.LIFNR after merge
      condition: "ZTERM_x == ZTERM_y"
      ...

The worker task layer (workers/tasks/run_checks.py) is responsible for loading
the referenced module extracts and calling run_cross_module_checks. That
wiring is intentionally out of scope for this PR; the scaffolding and seed
rules land first so the worker work is additive, not architectural.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

import pandas as pd

from checks.base import CheckResult, find_id_field, safe_json

logger = logging.getLogger("meridian.checks.cross_module")


def join_extracts(
    df_map: dict[str, pd.DataFrame],
    sources: list[dict[str, Any]],
    join_on: list[dict[str, str]],
) -> pd.DataFrame | None:
    """Inner-join a list of module extracts into one DataFrame.

    Parameters
    ----------
    df_map : {module_name: DataFrame}
        Extracts keyed by the module name. Missing modules cause the join to
        return None (the caller treats that as "rule not applicable to this
        run").
    sources : list of {module, alias?}
        Order matters — the first source is the left df, each subsequent
        source is inner-joined onto the accumulated result.
    join_on : list of {left, right}
        One spec per join — len(join_on) == len(sources) - 1. Columns are the
        POST-MERGE names (pandas appends _x / _y on collision).

    Returns
    -------
    The merged DataFrame, or None if any source module is missing from df_map
    or the number of join specs doesn't match.
    """
    if not sources:
        return None
    if len(join_on) != max(len(sources) - 1, 0):
        logger.warning(
            f"cross-module rule: join_on has {len(join_on)} entries but "
            f"{len(sources)} sources — expected {len(sources) - 1}"
        )
        return None

    first_module = sources[0]["module"]
    if first_module not in df_map:
        return None

    joined = df_map[first_module].copy()
    for idx, src in enumerate(sources[1:]):
        right_module = src["module"]
        if right_module not in df_map:
            return None
        right_df = df_map[right_module]
        spec = join_on[idx]
        left_col, right_col = spec["left"], spec["right"]
        if left_col not in joined.columns or right_col not in right_df.columns:
            logger.info(
                f"cross-module join: missing key {left_col} or {right_col} — "
                f"skipping rule"
            )
            return None
        joined = joined.merge(right_df, left_on=left_col, right_on=right_col, how="inner")

    return joined


def run_cross_module_check(
    rule: dict,
    df_map: dict[str, pd.DataFrame],
) -> CheckResult | None:
    """Execute a single cross-module rule against a map of extracts.

    Returns None if:
      - rule is missing sources or join_on
      - any required source is absent from df_map
      - the join produces zero rows
    """
    sources = rule.get("sources", [])
    join_on = rule.get("join_on", [])
    if not sources:
        return None

    joined = join_extracts(df_map, sources, join_on)
    if joined is None or len(joined) == 0:
        return None

    if rule.get("check_class", "cross_field_check") != "cross_field_check":
        logger.warning(
            f"cross-module rule {rule.get('id')}: only cross_field_check is "
            f"supported for cross-module; got {rule.get('check_class')}"
        )
        return None

    # Evaluate the condition inline rather than delegating to CrossFieldCheck —
    # CrossFieldCheck validates that rule.field / rule.fields exist as columns,
    # but in cross-module rules the display `field` is a label (e.g. "EKKO.ZTERM")
    # that doesn't match the post-merge column names (_x / _y suffixed).
    condition = rule.get("condition")
    if not condition:
        logger.warning(f"cross-module rule {rule.get('id')}: missing condition")
        return None

    total = len(joined)
    try:
        passing_mask = joined.eval(condition, engine="python")
    except Exception:
        local_ns = {col: joined[col] for col in joined.columns}
        local_ns["pd"] = pd
        passing_mask = eval(condition, {"__builtins__": {}}, local_ns)

    if not isinstance(passing_mask, pd.Series):
        passing_mask = pd.Series(passing_mask, index=joined.index)
    passing_mask = passing_mask.fillna(False).astype(bool)

    passing_count = int(passing_mask.sum())
    affected = total - passing_count
    pass_rate = (passing_count / total * 100) if total > 0 else 0.0

    failing_mask = ~passing_mask
    id_field = find_id_field(joined)
    failing_indices = failing_mask[failing_mask].index[:10]
    sample_cols = [id_field] + [c for c in joined.columns if c.endswith("_x") or c.endswith("_y")][:6]
    sample_cols = [c for c in sample_cols if c in joined.columns]
    sample_rows = joined.loc[failing_indices, sample_cols] if failing_indices.size else joined.iloc[:0]

    details = safe_json({
        "cross_module": True,
        "sources": [s["module"] for s in sources],
        "join_on": join_on,
        "condition": condition,
        "id_field_used": id_field,
        "failing_record_count": int(affected),
        "sample_failing_records": sample_rows.fillna("").astype(str).to_dict(orient="records"),
    })

    display_field = rule.get("field", "")
    threshold = rule.get("threshold", 100.0)
    result = CheckResult(
        check_id=rule.get("id", "UNKNOWN"),
        module=rule.get("module", "cross_module"),
        field=display_field,
        severity=rule.get("severity", "medium"),
        dimension=rule.get("dimension", "consistency"),
        passed=(round(pass_rate, 2) >= threshold),
        affected_count=affected,
        total_count=total,
        pass_rate=round(pass_rate, 2),
        message=rule.get("message", ""),
        details=details,
    )
    return result


def run_cross_module_on_prejoined(
    rule: dict, df: pd.DataFrame
) -> CheckResult | None:
    """Run a cross-module rule against a single pre-joined DataFrame.

    This is the happy-path for the current worker architecture: the
    customer uploads one parquet that already contains the joined data
    across modules (EKKO + LFA1 columns on the same row, keyed by LIFNR).
    Skips the inner merge in join_extracts and evaluates the condition
    directly — but only if every column referenced in the condition is
    present in df (otherwise the rule is not applicable to this extract).
    """
    condition = rule.get("condition")
    if not condition:
        return None

    # Coarse column-presence check: any bare identifier in the condition
    # that looks like a column (letters/digits/dot/underscore) must exist
    # in df. Not perfectly precise (may over-flag identifiers like `pd`)
    # but fail-safe — we return None, so the rule is skipped rather than
    # errored, when column coverage is uncertain.
    import re
    tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_\.]*", condition))
    python_reserved = {"and", "or", "not", "in", "is", "True", "False", "None", "pd", "notna", "isna", "isnull"}
    column_tokens = {t for t in tokens if t not in python_reserved and not t.startswith("'")}
    # A token is "column-like" if it doesn't look like a number or literal
    def looks_like_column(t: str) -> bool:
        if not t or t[0].isdigit():
            return False
        return True

    required_cols = {t for t in column_tokens if looks_like_column(t)}
    # Allow misses on pd.* etc — only fail on names not known to be python
    really_missing = [c for c in required_cols if c not in df.columns and "." not in c]
    if really_missing:
        logger.info(
            f"cross-module rule {rule.get('id')}: columns not in extract "
            f"{really_missing[:3]} — skipping"
        )
        return None

    total = len(df)
    if total == 0:
        return None

    try:
        passing_mask = df.eval(condition, engine="python")
    except Exception as e:
        logger.warning(
            f"cross-module rule {rule.get('id')}: condition eval failed ({e}) — skipping"
        )
        return None

    if not isinstance(passing_mask, pd.Series):
        passing_mask = pd.Series(passing_mask, index=df.index)
    passing_mask = passing_mask.fillna(False).astype(bool)

    passing = int(passing_mask.sum())
    affected = total - passing
    pass_rate = (passing / total * 100) if total > 0 else 0.0
    threshold = rule.get("threshold", 100.0)

    id_field = find_id_field(df)
    failing_idx = (~passing_mask)[~passing_mask].index[:10]
    sample = df.loc[failing_idx, [id_field]] if failing_idx.size else df.iloc[:0]

    details = safe_json({
        "cross_module": True,
        "sources": [s["module"] for s in rule.get("sources", [])],
        "mode": "prejoined",
        "condition": condition,
        "id_field_used": id_field,
        "failing_record_count": int(affected),
        "sample_failing_records": sample.fillna("").astype(str).to_dict(orient="records"),
    })

    return CheckResult(
        check_id=rule.get("id", "UNKNOWN"),
        module=rule.get("module", "cross_module"),
        field=rule.get("field", ""),
        severity=rule.get("severity", "medium"),
        dimension=rule.get("dimension", "consistency"),
        passed=(round(pass_rate, 2) >= threshold),
        affected_count=affected,
        total_count=total,
        pass_rate=round(pass_rate, 2),
        message=rule.get("message", ""),
        details=details,
    )


def discover_cross_module_rules() -> list[dict]:
    """Load every YAML rule from checks/rules/cross_module/.

    Returns a flat list; each rule is stamped with its `module` so findings
    report the owning cross-module pack (e.g. cross_module_p2p).
    """
    import yaml
    from pathlib import Path
    base = Path(__file__).parent / "rules" / "cross_module"
    if not base.exists():
        return []
    rules: list[dict] = []
    for yaml_path in sorted(base.glob("*.yaml")):
        try:
            cfg = yaml.safe_load(yaml_path.read_text()) or {}
            module_name = cfg.get("module", yaml_path.stem)
            for rule in cfg.get("rules", []):
                rule = dict(rule)
                rule.setdefault("module", module_name)
                rules.append(rule)
        except Exception as e:
            logger.warning(f"cross-module rules: failed to load {yaml_path}: {e}")
    return rules


def run_cross_module_checks(
    rules: list[dict],
    df_map: dict[str, pd.DataFrame],
) -> list[CheckResult]:
    """Run every cross-module rule in the list and return the CheckResults.

    Skips rules whose sources aren't in df_map — callers receive only the
    results that genuinely executed.
    """
    results: list[CheckResult] = []
    for rule in rules:
        try:
            res = run_cross_module_check(rule, df_map)
            if res is not None:
                results.append(res)
        except Exception as e:
            logger.error(
                f"cross-module rule {rule.get('id')} failed: {e}", exc_info=True
            )
            results.append(
                CheckResult(
                    check_id=rule.get("id", "UNKNOWN"),
                    module=rule.get("module", "cross_module"),
                    field=rule.get("field", ""),
                    severity=rule.get("severity", "medium"),
                    dimension=rule.get("dimension", "consistency"),
                    passed=False,
                    affected_count=0,
                    total_count=0,
                    pass_rate=0.0,
                    message=rule.get("message", ""),
                    details={"cross_module": True},
                    error=str(e),
                )
            )
    return results
