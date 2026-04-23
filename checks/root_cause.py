"""Root-cause classification for DQ findings.

Bridges the YAML-rule channel and the Config Intelligence channel. Without
this bridge, a finding like "4,200 vendors have invalid account group 0099"
doesn't tell the steward WHY 0099 is invalid: is it because the tenant's
SPRO config doesn't have 0099 configured (a config gap — rule is stricter
than reality), or because 0099 is a valid config and the records shouldn't
be using it (a genuine data issue)? Two completely different remediation
paths.

This module loads the tenant's latest config_inventory (produced by the
Config Intelligence engine) and classifies each failing finding:

  - bad_data: flagged values ARE in SPRO config; records are the problem
  - bad_config: flagged values are NOT in SPRO config; rule is stricter
    than config allows (could be an outdated rule or a config gap)
  - bad_data_and_config: mixed — some flagged values config, some not
  - unknown: no config_inventory for this tenant (backwards-compatible)

The classification is attached to finding.details.root_cause so the
Workbench drawer, Fix Playbook, and PDF report can surface it. No DB
schema change — uses the existing JSONB details column.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("meridian.checks.root_cause")


def load_tenant_config_values(engine: Any, tenant_id: str) -> dict[str, set[str]]:
    """Load the tenant's most-recent config inventory as {element_type: {values}}.

    Returns an empty dict if the tenant has no Config Intelligence run yet,
    which is the common case for new tenants — classification falls back
    to "unknown" and the pipeline proceeds unchanged.
    """
    index: dict[str, set[str]] = {}
    try:
        # Lazy import — a missing sqlalchemy means this function is a no-op,
        # not a crash, which keeps root-cause enrichment optional.
        from sqlalchemy import text
        from sqlalchemy.orm import Session

        with Session(engine) as s:
            s.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            latest = s.execute(
                text(
                    "SELECT run_id FROM config_inventory "
                    "WHERE tenant_id = :tid "
                    "ORDER BY last_seen DESC NULLS LAST, first_seen DESC NULLS LAST "
                    "LIMIT 1"
                ),
                {"tid": tenant_id},
            ).fetchone()
            if not latest:
                return index
            run_id = latest[0]
            rows = s.execute(
                text(
                    "SELECT element_type, element_value FROM config_inventory "
                    "WHERE tenant_id = :tid AND run_id = :rid"
                ),
                {"tid": tenant_id, "rid": run_id},
            ).fetchall()
            for etype, eval_ in rows:
                index.setdefault(str(etype), set()).add(str(eval_))
    except Exception as e:
        # Config Intelligence table may not exist on older deployments;
        # never fail the analysis over root-cause enrichment.
        logger.info(f"root_cause: config_inventory unavailable ({e}) — skipping")
        return index
    return index


def _extract_flagged_values(finding: dict) -> set[str]:
    """Pull out the specific values the rule flagged as problematic.

    Domain checks populate `details.distinct_invalid_values` (dict or list).
    Referential checks populate `details.missing_values` (list).
    Null / regex / cross_field / freshness have no enumerable flagged
    values — return empty.
    """
    details = finding.get("details") or {}
    flagged: set[str] = set()

    inv = details.get("distinct_invalid_values")
    if isinstance(inv, dict):
        flagged.update(str(k) for k in inv.keys())
    elif isinstance(inv, list):
        flagged.update(str(v) for v in inv)

    missing = details.get("missing_values")
    if isinstance(missing, list):
        flagged.update(str(v) for v in missing)

    return flagged


def classify_root_cause(
    finding: dict,
    config_values: dict[str, set[str]],
) -> dict:
    """Classify one finding against the tenant's config inventory.

    Returns a dict suitable for attaching as finding.details.root_cause.
    Always returns a result (even "unknown") so callers can attach
    unconditionally.
    """
    if not config_values:
        return {
            "root_cause_type": "unknown",
            "reasoning": "No Config Intelligence run available for this tenant.",
        }

    flagged = _extract_flagged_values(finding)
    if not flagged:
        # Check class doesn't produce enumerable values (null_check etc.)
        return {
            "root_cause_type": "unknown",
            "reasoning": "Check type does not produce enumerable flagged values.",
        }

    # Match the finding's field to a config element_type. The element_type
    # in config_inventory is typically the SAP field name without the
    # table prefix (e.g. "KTOKK" for LFA1.KTOKK).
    field = finding.get("field") or ""
    element_type = field.split(".")[-1] if "." in field else field
    tenant_values = config_values.get(element_type, set())

    in_config = flagged & tenant_values
    not_in_config = flagged - tenant_values

    if in_config and not not_in_config:
        return {
            "root_cause_type": "bad_data",
            "reasoning": (
                f"All flagged values are valid in your SPRO config — the records "
                f"are the problem, not the configuration. Apply a cleaning rule."
            ),
            "element_type": element_type,
            "flagged_values_in_config": sorted(in_config)[:20],
        }
    if not_in_config and not in_config:
        return {
            "root_cause_type": "bad_config",
            "reasoning": (
                f"Flagged values are not present in your SPRO config — the rule's "
                f"reference list may be stricter than your configuration, or the "
                f"config itself has drifted from what the rule expects. Review "
                f"SPRO before cleaning records."
            ),
            "element_type": element_type,
            "flagged_values_not_in_config": sorted(not_in_config)[:20],
        }
    return {
        "root_cause_type": "bad_data_and_config",
        "reasoning": (
            f"Mixed: {len(in_config)} flagged value(s) exist in SPRO config "
            f"(data issue), {len(not_in_config)} do not (config issue). "
            f"Split remediation: clean data for the former, review SPRO for "
            f"the latter."
        ),
        "element_type": element_type,
        "flagged_values_in_config": sorted(in_config)[:20],
        "flagged_values_not_in_config": sorted(not_in_config)[:20],
    }


def enrich_results_with_root_cause(
    engine: Any,
    tenant_id: str,
    results: list,  # list[CheckResult]
) -> None:
    """Mutate each failing CheckResult in `results`, attaching a
    `details.root_cause` entry from classify_root_cause.

    No-ops for passing results and for tenants without config inventory.
    """
    config_values = load_tenant_config_values(engine, tenant_id)
    if not config_values:
        return  # skip silently; nothing to classify against

    for result in results:
        if getattr(result, "passed", True):
            continue
        try:
            finding_dict = {
                "field": getattr(result, "field", ""),
                "details": dict(getattr(result, "details", None) or {}),
            }
            rc = classify_root_cause(finding_dict, config_values)
            new_details = dict(getattr(result, "details", None) or {})
            new_details["root_cause"] = rc
            # CheckResult is a pydantic model — use model_copy for the update
            # without mutating the original shared reference.
            replacement = result.model_copy(update={"details": new_details})
            # The caller holds results by-reference; mutate in place where
            # possible so callers see the enrichment.
            idx = results.index(result)
            results[idx] = replacement
        except Exception as e:
            logger.warning(
                f"root_cause: enrichment failed for "
                f"{getattr(result, 'check_id', '?')}: {e}"
            )
