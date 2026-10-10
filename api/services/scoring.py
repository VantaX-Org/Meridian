import re
from collections.abc import Iterable
from typing import Optional

import pandas as pd
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
# The one band set. Composite DQS at or above ``target`` passes (go), at or above
# ``warning`` warns (conditional), else fails; below ``critical`` is the deepest band.
DEFAULT_THRESHOLDS = {"target": 90.0, "warning": 75.0, "critical": 60.0}
_LEGACY_THRESHOLD_KEYS = {"pass": "target", "warn": "warning"}  # configs saved before the rename
# C1: a rule's weight in its dimension. C2: how hard its failing share counts.
DEFAULT_SEVERITY_WEIGHTS = {"critical": 4.0, "high": 3.0, "medium": 2.0, "low": 1.0}
DEFAULT_SEVERITY_MULTIPLIERS = {"critical": 5.0, "high": 2.0, "medium": 1.0, "low": 1.0}
# C3: a failing critical rule caps the score only at or above this failing share or row count.
DEFAULT_CRITICAL_TOLERANCE = {"pct": 0.1, "rows": 25}
LOW_CONFIDENCE_COVERAGE = 0.70
# ponytail: clean-record key sets are held in memory; past this many failing driving-object
# keys the figure is reported as null. Spill to disk / a bitmap if large tenants need it.
CLEAN_KEY_CEILING = 5_000_000


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
    # C3: failing critical rules over tolerance, e.g. "MM140: 3.2% of MARA rows"
    critical_breaches: list[str] = []
    # C2: severity-scaled rule score r' where it differs from the pass rate r (failing rules)
    rule_scores: dict[str, float] = {}
    # C5: executed / (executed + not evaluable + errored); not applicable rules are out of it
    skipped_checks: int = 0          # not evaluable: a table, field or value list missing
    not_applicable_checks: int = 0   # no records in the rule's population
    coverage: Optional[float] = None
    low_confidence: bool = False
    # C9: share of driving-object records with no failing rule at any grain
    clean_record_pct: Optional[float] = None
    clean_records: Optional[dict] = None
    # the pre-calibration formula's result, kept for one release to show the change
    legacy: Optional[dict] = None


def effective_weights(tenant_weights: dict | None) -> dict:
    """Tenant DQS weights (only the six dimension keys), normalised to sum 1."""
    w = {**DEFAULT_WEIGHTS}
    for dim, val in (tenant_weights or {}).items():
        if dim in DEFAULT_WEIGHTS and isinstance(val, (int, float)) and val >= 0:
            w[dim] = float(val)
    total = sum(w.values())
    return {d: v / total for d, v in w.items()} if total > 0 else dict(DEFAULT_WEIGHTS)


def _numbers(defaults: dict, raw: object) -> dict:
    """``defaults`` with the non-negative numeric overrides of ``raw`` for known keys."""
    over = raw if isinstance(raw, dict) else {}
    return {**defaults, **{k: float(v) for k, v in over.items()
                           if k in defaults and isinstance(v, (int, float)) and v >= 0}}


def _thresholds(raw: object) -> dict:
    over = raw if isinstance(raw, dict) else {}
    return _numbers(DEFAULT_THRESHOLDS, {_LEGACY_THRESHOLD_KEYS.get(k, k): v for k, v in over.items()})


def scoring_config(raw: dict | None) -> dict:
    """The tenant's scoring config (stored in ``tenants.dqs_weights``) with defaults filled:
    normalised dimension weights, module weights (default 1), the band thresholds, and the
    severity weights, multipliers and critical-cap tolerance."""
    raw = raw or {}
    mw = raw.get("module_weights") or {}
    return {
        "dimension_weights": {d: round(w, 4) for d, w in effective_weights(raw).items()},
        "module_weights": {m: float(w) for m, w in mw.items() if isinstance(w, (int, float)) and w >= 0},
        "thresholds": _thresholds(raw.get("thresholds")),
        "severity_weights": _numbers(DEFAULT_SEVERITY_WEIGHTS, raw.get("severity_weights")),
        "severity_multipliers": _numbers(DEFAULT_SEVERITY_MULTIPLIERS, raw.get("severity_multipliers")),
        "critical_tolerance": _numbers(DEFAULT_CRITICAL_TOLERANCE, raw.get("critical_tolerance")),
    }


def tier(score: float | None, thresholds: dict | None = None) -> str | None:
    t = _thresholds(thresholds)
    if score is None:
        return None
    return "pass" if score >= t["target"] else "warn" if score >= t["warning"] else "fail"


def critical_over_tolerance(summary: dict) -> int:
    """Failing critical rules that trigger the cap; summaries stored before tolerance
    gating count every failing critical."""
    breaches = summary.get("critical_breaches")
    return len(breaches) if breaches is not None else int(summary.get("critical_count") or 0)


def readiness_status(score: float, criticals_over_tolerance: int, thresholds: dict | None = None) -> str:
    """go = score >= target and no critical over tolerance; conditional = score >= warning; else no-go."""
    t = _thresholds(thresholds)
    if score >= t["target"] and not criticals_over_tolerance:
        return "go"
    return "conditional" if score >= t["warning"] else "no-go"


def _cap(composite: float, breaches: list[str]) -> tuple[float, bool, str | None]:
    if len(breaches) >= 2 and composite > 70:
        return 70.0, True, f"{len(breaches)} critical failures over tolerance ({'; '.join(breaches)}) — score capped at 70"
    if len(breaches) == 1 and composite > 85:
        return 85.0, True, f"{breaches[0]} — score capped at 85"
    return composite, False, None


def _composite(dimension_scores: dict, dimension_coverage: dict, breaches: list[str],
               weights: dict) -> tuple[float, bool, str | None, dict]:
    """(composite, capped, cap_reason, measured weights) — weighted over measured
    dimensions, then the critical caps (one cap-triggering rule per ``breaches`` entry)."""
    measured = {d: w for d, w in weights.items() if dimension_coverage.get(d)}
    total_w = sum(measured.values())
    composite = (
        sum(dimension_scores[d] * w for d, w in measured.items()) / total_w if total_w else 100.0
    )
    composite, capped, cap_reason = _cap(composite, breaches)
    return composite, capped, cap_reason, ({d: round(w / total_w, 4) for d, w in measured.items()} if total_w else {})


def rescore(summary: dict, raw_config: dict | None) -> dict:
    """A stored module DQSResult dict re-weighted under another scoring config."""
    breaches = summary.get("critical_breaches")
    if breaches is None:  # stored before tolerance-gated caps: every failing critical caps
        breaches = ["critical failure"] * int(summary.get("critical_count") or 0)
    composite, capped, cap_reason, w = _composite(
        summary.get("dimension_scores") or {}, summary.get("dimension_coverage") or {},
        breaches, effective_weights(raw_config))
    return {**summary, "composite_score": round(composite, 2), "capped": capped, "cap_reason": cap_reason,
            "weights": w, "tier": tier(composite, scoring_config(raw_config)["thresholds"])}


def _severity(f: CheckResult) -> str:
    return f.severity if f.severity in DEFAULT_SEVERITY_WEIGHTS else "low"  # "warning" etc. count as low


def scaled_rate(f: CheckResult, multipliers: dict) -> float:
    """C2: r' = max(0, 100 - k_sev * (100 - r))."""
    return max(0.0, 100.0 - multipliers[_severity(f)] * (100.0 - f.pass_rate))


def rule_weight(f: CheckResult, weights: dict) -> float:
    """C1: severity weight; DDIC conformance (one result per table and kind) weighs 1."""
    return 1.0 if f.check_id.startswith("DDIC-") else weights[_severity(f)]


def breach(f: CheckResult, tolerance: dict) -> str | None:
    """C3: why a failing critical rule triggers the cap, or None when within tolerance."""
    if f.passed or _severity(f) != "critical":
        return None
    pct = f.affected_count / f.total_count * 100 if f.total_count else 100.0
    if pct < tolerance["pct"] and f.affected_count < tolerance["rows"]:
        return None
    return f"{f.check_id}: {pct:.1f}% of {f.grain or 'checked'} rows"


def _legacy(findings: list[CheckResult], weights: dict, thresholds: dict, critical: int) -> dict:
    """The pre-calibration score: record-weighted pass rates, a cap on any failing critical."""
    dims: dict[str, float] = {}
    coverage: dict[str, int] = {}
    for dim in DEFAULT_WEIGHTS:
        rows = [f for f in findings if f.dimension == dim]
        coverage[dim] = len(rows)
        n = sum(f.total_count for f in rows)
        dims[dim] = (sum(f.pass_rate * f.total_count for f in rows) / n if n
                     else sum(f.pass_rate for f in rows) / len(rows) if rows else 100.0)
    composite, capped, cap_reason, _ = _composite(dims, coverage, ["critical failure"] * critical, weights)
    return {"composite_score": round(composite, 2), "dimension_scores": {k: round(v, 2) for k, v in dims.items()},
            "capped": capped, "cap_reason": cap_reason, "tier": tier(composite, thresholds)}


def score_module(findings: list[CheckResult], tenant_config: dict, *, module: str = "",
                 skipped: int = 0, not_applicable: int = 0) -> DQSResult:
    """Calculate DQS score for a single module from its check results.

    ``skipped`` = rules that could not be evaluated (missing table / field / value list)
    and ``not_applicable`` = rules with no records in their population, from the runner."""
    cfg = scoring_config(tenant_config)
    weights = effective_weights(tenant_config)
    module = findings[0].module if findings else module
    errored = [f for f in findings if f.error]
    findings = [f for f in findings if not f.error]
    attempted = len(findings) + skipped + len(errored)
    coverage = round(len(findings) / attempted, 4) if attempted else None

    # Count failing rules per severity (unknown severities count as low)
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        if not f.passed:
            severity_counts[_severity(f)] += 1
    breaches = [b for f in findings if (b := breach(f, cfg["critical_tolerance"]))]

    # C1 + C2: severity-weighted mean of severity-scaled rule scores per dimension
    dimension_scores: dict[str, float] = {}
    dimension_coverage: dict[str, int] = {}
    rule_scores: dict[str, float] = {}
    for dim in DEFAULT_WEIGHTS:
        dim_list = [f for f in findings if f.dimension == dim]
        dimension_coverage[dim] = len(dim_list)
        if not dim_list:
            # No checks for this dimension — shown as 100 with coverage 0, but
            # excluded from the composite: absence of evidence is not a pass.
            dimension_scores[dim] = 100.0
            continue
        num = den = 0.0
        for f in dim_list:
            w, r = rule_weight(f, cfg["severity_weights"]), scaled_rate(f, cfg["severity_multipliers"])
            num, den = num + w * r, den + w
            if r != f.pass_rate:
                rule_scores[f.check_id] = round(r, 2)
        dimension_scores[dim] = num / den if den else 100.0

    composite, capped, cap_reason, measured_weights = _composite(
        dimension_scores, dimension_coverage, breaches, weights)

    return DQSResult(
        module=module,
        composite_score=round(composite, 2),
        dimension_scores={k: round(v, 2) for k, v in dimension_scores.items()},
        dimension_coverage=dimension_coverage,
        critical_count=severity_counts["critical"],
        high_count=severity_counts["high"],
        medium_count=severity_counts["medium"],
        low_count=severity_counts["low"],
        total_checks=len(findings),
        passing_checks=sum(1 for f in findings if f.passed),
        capped=capped,
        cap_reason=cap_reason,
        errored_checks=len(errored),
        weights=measured_weights,
        tier=tier(composite, cfg["thresholds"]),
        critical_breaches=breaches,
        rule_scores=rule_scores,
        skipped_checks=skipped,
        not_applicable_checks=not_applicable,
        coverage=coverage,
        low_confidence=coverage is not None and coverage < LOW_CONFIDENCE_COVERAGE,
        legacy=_legacy(findings, weights, cfg["thresholds"], severity_counts["critical"]),
    )


def score_all_modules(all_results: list[CheckResult], tenant_weights: dict | None = None,
                      skips: dict[str, dict[str, int]] | None = None) -> dict[str, DQSResult]:
    """Group results by module and score each one with the tenant's DQS weights.
    ``skips`` = {module: {"not_evaluable": n, "not_applicable": n}} from the runner."""
    by_module: dict[str, list[CheckResult]] = {m: [] for m in (skips or {})}
    for r in all_results:
        by_module.setdefault(r.module, []).append(r)
    return {module: score_module(findings, tenant_weights or {}, module=module,
                                 skipped=(skips or {}).get(module, {}).get("not_evaluable", 0),
                                 not_applicable=(skips or {}).get(module, {}).get("not_applicable", 0))
            for module, findings in by_module.items()}


class CleanRecords:
    """C9: driving-object records (e.g. MARA keys) with zero failing rules at any grain.

    Each rule's full failing keys (``"MATNR=1|WERKS=1000"``) are projected onto the
    driving object's key fields as they stream in, so only the union is held."""

    def __init__(self, anchor: str | None, key_fields: Iterable[str], records: int):
        self.anchor = anchor
        self.fields = tuple(k for k in key_fields if k not in ("MANDT", "CLIENT"))
        self.records = records
        self.failing: set[tuple[str, ...]] | None = set()
        self.unattributed: list[str] = []
        self.reason: str | None = None if anchor and self.fields and records else "driving object not in the extract"

    def add(self, check_id: str, keys: pd.Series) -> None:
        """Fold one rule's failing record keys (a string Series from checks.base.record_keys)."""
        if self.failing is None or self.reason or not len(keys):
            return
        keys = keys.astype("string")
        parts = [keys.str.extract(rf"(?:^|\|){re.escape(k)}=([^|]*)", expand=False) for k in self.fields]
        if any(p.isna().any() for p in parts):
            self.unattributed.append(check_id)  # failing records keyed without the driving object's key
            return
        self.failing.update(zip(*parts))
        if len(self.failing) > CLEAN_KEY_CEILING:
            self.failing, self.reason = None, f"more than {CLEAN_KEY_CEILING:,} failing {self.anchor} records"

    def result(self) -> dict:
        failing = len(self.failing) if self.failing is not None else None
        pct = (round(max(0, self.records - failing) / self.records * 100, 2)
               if not self.reason and failing is not None else None)
        return {"clean_record_pct": pct,
                "clean_records": {"driving_object": self.anchor, "records": self.records,
                                  "failing_records": failing if not self.reason else None,
                                  "unattributed_rules": sorted(set(self.unattributed)), "reason": self.reason}}
