"""Phase 1 verification: DQS dimension scores must use record-level pass_rate
instead of binary pass/fail counts."""

from api.services.scoring import score_module
from checks.base import CheckResult


def _make_result(check_id: str, pass_rate: float, dimension: str = "completeness") -> CheckResult:
    return CheckResult(
        check_id=check_id,
        module="test",
        field="test_field",
        severity="medium",
        dimension=dimension,
        passed=(pass_rate == 100.0),
        affected_count=int((100 - pass_rate) * 10),
        total_count=1000,
        pass_rate=pass_rate,
        message="test",
        details={},
    )


def test_dimension_score_uses_passrate_not_binary():
    """Three completeness checks with high pass rates should average ~94.83,
    NOT 33.33 (which is what binary counting would give)."""
    findings = [
        _make_result("C001", pass_rate=99.5),   # 5 nulls in 1000
        _make_result("C002", pass_rate=85.0),   # 150 nulls in 1000
        _make_result("C003", pass_rate=100.0),  # all present
    ]
    result = score_module(findings, {})
    completeness = result.dimension_scores["completeness"]
    assert abs(completeness - 94.833333) < 0.01, (
        f"expected ~94.83, got {completeness} — binary counting would give 33.33"
    )


def test_single_critical_failure_score_reflects_passrate():
    """A single check with 99% pass_rate should give ~99 for that dimension,
    not 0 (binary would say 'failed')."""
    findings = [_make_result("U001", pass_rate=99.0, dimension="uniqueness")]
    result = score_module(findings, {})
    assert abs(result.dimension_scores["uniqueness"] - 99.0) < 0.01
