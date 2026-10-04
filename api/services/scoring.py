from typing import Optional

from pydantic import BaseModel

from checks.base import CheckResult

DEFAULT_WEIGHTS = {
    "completeness": 0.25,
    "accuracy": 0.25,
    "consistency": 0.20,
    "timeliness": 0.10,
    "uniqueness": 0.10,
    "validity": 0.10,
}
# Composite DQS at or above ``pass`` passes, at or above ``warn`` warns, else fails.
DEFAULT_THRESHOLDS = {"pass": 90.0, "warn": 75.0}


class DQSResult(BaseModel):
    module: str
    composite_score: float  # 0.0 to 100.0
    dimension_scores: dict  # {dimension: score} for all 6 dimensions
    dimension_coverage: dict = {}  # {dimension: n_checks backing the score}
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    total_checks: int
    passing_checks: int
    capped: bool
    cap_reason: Optional[str] = None
    errored_checks: int = 0          # checks that could not be evaluated — excluded from the score
    weights: dict = {}               # effective (normalised) weights over measured dimensions
    tier: Optional[str] = None       # pass | warn | fail against the tenant's thresholds


def effective_weights(tenant_weights: dict | None) -> dict:
    """Tenant DQS weights (only the six dimension keys), normalised to sum 1."""
    w = {**DEFAULT_WEIGHTS}
    for dim, val in (tenant_weights or {}).items():
        if dim in DEFAULT_WEIGHTS and isinstance(val, (int, float)) and val >= 0:
            w[dim] = float(val)
    total = sum(w.values())
    return {d: v / total for d, v in w.items()} if total > 0 else dict(DEFAULT_WEIGHTS)


def scoring_config(raw: dict | None) -> dict:
    """The tenant's scoring config (stored in ``tenants.dqs_weights``) with defaults filled:
    normalised dimension weights, module weights (default 1) and pass/warn thresholds."""
    raw = raw or {}
    mw = raw.get("module_weights") or {}
    return {
        "dimension_weights": {d: round(w, 4) for d, w in effective_weights(raw).items()},
        "module_weights": {m: float(w) for m, w in mw.items() if isinstance(w, (int, float)) and w >= 0},
        "thresholds": {**DEFAULT_THRESHOLDS, **{k: float(v) for k, v in (raw.get("thresholds") or {}).items()
                                                if k in DEFAULT_THRESHOLDS and isinstance(v, (int, float))}},
    }


def tier(score: float | None, thresholds: dict | None = None) -> str | None:
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    if score is None:
        return None
    return "pass" if score >= t["pass"] else "warn" if score >= t["warn"] else "fail"


def _composite(dimension_scores: dict, dimension_coverage: dict, critical_failures: int,
               weights: dict) -> tuple[float, bool, str | None, dict]:
    """(composite, capped, cap_reason, measured weights) — weighted over measured
    dimensions, then the critical caps."""
    measured = {d: w for d, w in weights.items() if dimension_coverage.get(d)}
    total_w = sum(measured.values())
    composite = (
        sum(dimension_scores[d] * w for d, w in measured.items()) / total_w if total_w else 100.0
    )
    capped, cap_reason = False, None
    if critical_failures >= 2 and composite > 70:
        composite, capped = 70.0, True
        cap_reason = f"{critical_failures} critical failures — score capped at 70"
    elif critical_failures == 1 and composite > 85:
        composite, capped = 85.0, True
        cap_reason = "1 critical failure — score capped at 85"
    return composite, capped, cap_reason, ({d: round(w / total_w, 4) for d, w in measured.items()} if total_w else {})


def rescore(summary: dict, raw_config: dict | None) -> dict:
    """A stored module DQSResult dict re-weighted under another scoring config."""
    composite, capped, cap_reason, w = _composite(
        summary.get("dimension_scores") or {}, summary.get("dimension_coverage") or {},
        int(summary.get("critical_count") or 0), effective_weights(raw_config))
    return {**summary, "composite_score": round(composite, 2), "capped": capped, "cap_reason": cap_reason,
            "weights": w, "tier": tier(composite, scoring_config(raw_config)["thresholds"])}


def score_module(findings: list[CheckResult], tenant_config: dict) -> DQSResult:
    """Calculate DQS score for a single module from its check results."""
    if not findings:
        return DQSResult(
            module="",
            composite_score=100.0,
            dimension_scores={d: 100.0 for d in DEFAULT_WEIGHTS},
            dimension_coverage={d: 0 for d in DEFAULT_WEIGHTS},
            critical_count=0,
            high_count=0,
            medium_count=0,
            low_count=0,
            total_checks=0,
            passing_checks=0,
            capped=False,
        )

    module = findings[0].module
    weights = effective_weights(tenant_config)
    errored = [f for f in findings if f.error]
    findings = [f for f in findings if not f.error]

    # Count severities (treat "warning" as low)
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        sev = f.severity if f.severity in severity_counts else "low"
        if not f.passed:
            severity_counts[sev] += 1

    # Calculate per-dimension scores using record-level pass rate
    dimension_findings: dict[str, list[CheckResult]] = {}
    for f in findings:
        dim = f.dimension
        dimension_findings.setdefault(dim, []).append(f)

    dimension_scores = {}
    dimension_coverage = {}
    for dim in DEFAULT_WEIGHTS:
        dim_list = dimension_findings.get(dim, [])
        dimension_coverage[dim] = len(dim_list)
        if dim_list:
            # Record-level averaging: weight each check's pass_rate by the
            # number of records it actually assessed (total_count), so a check
            # over 1M rows outweighs one over 10. Falls back to an unweighted
            # mean when total_counts are unavailable (all zero).
            weight = sum(f.total_count for f in dim_list)
            if weight > 0:
                dimension_scores[dim] = sum(f.pass_rate * f.total_count for f in dim_list) / weight
            else:
                dimension_scores[dim] = sum(f.pass_rate for f in dim_list) / len(dim_list)
        else:
            # No checks for this dimension — shown as 100 with coverage 0, but
            # excluded from the composite: absence of evidence is not a pass.
            dimension_scores[dim] = 100.0

    # Weighted composite over the dimensions actually measured, then the critical caps
    critical_failures = severity_counts["critical"]
    composite, capped, cap_reason, measured_weights = _composite(
        dimension_scores, dimension_coverage, critical_failures, weights)

    total_checks = len(findings)
    passing_checks = sum(1 for f in findings if f.passed)

    return DQSResult(
        module=module,
        composite_score=round(composite, 2),
        dimension_scores={k: round(v, 2) for k, v in dimension_scores.items()},
        dimension_coverage=dimension_coverage,
        critical_count=critical_failures,
        high_count=severity_counts["high"],
        medium_count=severity_counts["medium"],
        low_count=severity_counts["low"],
        total_checks=total_checks,
        passing_checks=passing_checks,
        capped=capped,
        cap_reason=cap_reason,
        errored_checks=len(errored),
        weights=measured_weights,
        tier=tier(composite, scoring_config(tenant_config)["thresholds"]),
    )


def score_all_modules(all_results: list[CheckResult], tenant_weights: dict | None = None) -> dict[str, DQSResult]:
    """Group results by module and score each one with the tenant's DQS weights."""
    by_module: dict[str, list[CheckResult]] = {}
    for r in all_results:
        by_module.setdefault(r.module, []).append(r)

    return {module: score_module(findings, tenant_weights or {}) for module, findings in by_module.items()}
