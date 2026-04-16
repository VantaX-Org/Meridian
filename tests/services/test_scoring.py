import pytest

from api.services.scoring import score_module, score_all_modules, DQSResult
from checks.base import CheckResult


def _make_result(
    check_id: str = "T001",
    module: str = "test",
    passed: bool = True,
    severity: str = "medium",
    dimension: str = "completeness",
) -> CheckResult:
    return CheckResult(
        check_id=check_id,
        module=module,
        field="test_field",
        severity=severity,
        dimension=dimension,
        passed=passed,
        affected_count=0 if passed else 10,
        total_count=100,
        pass_rate=100.0 if passed else 90.0,
        message="test",
        details={},
    )


def test_clean_data_scores_100():
    findings = [
        _make_result("T001", dimension="completeness"),
        _make_result("T002", dimension="accuracy"),
        _make_result("T003", dimension="consistency"),
        _make_result("T004", dimension="timeliness"),
        _make_result("T005", dimension="uniqueness"),
        _make_result("T006", dimension="validity"),
    ]
    result = score_module(findings, {})
    assert result.composite_score == 100.0
    assert result.capped is False
    assert result.critical_count == 0


def test_one_critical_failure_caps_at_85():
    findings = [
        _make_result("T001", dimension="completeness", passed=True),
        _make_result("T002", dimension="accuracy", passed=True),
        _make_result("T003", dimension="consistency", passed=True),
        _make_result("T004", dimension="timeliness", passed=True),
        _make_result("T005", dimension="uniqueness", passed=True),
        _make_result("T006", dimension="validity", passed=False, severity="critical"),
    ]
    result = score_module(findings, {})
    # validity score = 0/1 = 0%, weighted 0.10 → 90% composite before cap
    # But 1 critical failure caps at 85
    assert result.composite_score <= 85.0
    assert result.capped is True
    assert result.critical_count == 1


def test_two_critical_failures_cap_at_70():
    # Use many passing checks so that weighted score exceeds 70 before cap
    findings = [
        _make_result("T001", dimension="completeness", passed=True),
        _make_result("T002", dimension="completeness", passed=True),
        _make_result("T003", dimension="completeness", passed=True),
        _make_result("T004", dimension="completeness", passed=False, severity="critical"),
        _make_result("T005", dimension="accuracy", passed=True),
        _make_result("T006", dimension="accuracy", passed=True),
        _make_result("T007", dimension="accuracy", passed=True),
        _make_result("T008", dimension="accuracy", passed=False, severity="critical"),
        _make_result("T009", dimension="consistency", passed=True),
        _make_result("T010", dimension="timeliness", passed=True),
        _make_result("T011", dimension="uniqueness", passed=True),
        _make_result("T012", dimension="validity", passed=True),
    ]
    result = score_module(findings, {})
    # Before cap: completeness 3/4=75%*0.25=18.75, accuracy 3/4=75%*0.25=18.75
    # + consistency/timeliness/uniqueness/validity all 100% = 50
    # Total = 87.5, capped to 70
    assert result.composite_score == 70.0
    assert result.capped is True
    assert result.critical_count == 2


def test_mixed_severities_no_critical_no_cap():
    findings = [
        _make_result("T001", dimension="completeness", passed=True),
        _make_result("T002", dimension="completeness", passed=False, severity="high"),
        _make_result("T003", dimension="accuracy", passed=True),
        _make_result("T004", dimension="accuracy", passed=False, severity="medium"),
    ]
    result = score_module(findings, {})
    assert result.capped is False
    assert result.critical_count == 0
    assert result.high_count == 1
    assert result.medium_count == 1
    # Scoring uses record-level pass_rate, not binary pass/fail.
    # _make_result sets pass_rate=90.0 when passed=False, else 100.0.
    # completeness dim avg = (100 + 90) / 2 = 95.0, × 0.25 = 23.75
    # accuracy dim avg    = (100 + 90) / 2 = 95.0, × 0.25 = 23.75
    # consistency 100 × 0.20 = 20, timeliness 100 × 0.10 = 10,
    # uniqueness 100 × 0.10 = 10, validity 100 × 0.10 = 10
    expected = 23.75 + 23.75 + 20 + 10 + 10 + 10
    assert result.composite_score == expected


def test_custom_tenant_weights():
    findings = [
        _make_result("T001", dimension="completeness", passed=True),
        _make_result("T002", dimension="accuracy", passed=False, severity="high"),
    ]
    custom_weights = {
        "completeness": 0.50,
        "accuracy": 0.50,
        "consistency": 0.00,
        "timeliness": 0.00,
        "uniqueness": 0.00,
        "validity": 0.00,
    }
    result = score_module(findings, custom_weights)
    # Scoring uses record-level pass_rate, not binary.
    # completeness: [100] avg 100, × 0.50 = 50
    # accuracy:     [90]  avg 90,  × 0.50 = 45  (passed=False → pass_rate=90)
    # others: 100 × 0.00 = 0
    assert result.composite_score == 95.0


def test_score_all_modules():
    findings = [
        _make_result("T001", module="mod_a", dimension="completeness"),
        _make_result("T002", module="mod_a", dimension="accuracy"),
        _make_result("T003", module="mod_b", dimension="completeness", passed=False, severity="critical"),
    ]
    results = score_all_modules(findings)
    assert "mod_a" in results
    assert "mod_b" in results
    assert results["mod_a"].composite_score == 100.0
    assert results["mod_b"].critical_count == 1
