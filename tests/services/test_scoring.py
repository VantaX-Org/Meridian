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
    # Severity-weighted (medium w2, high w3) with severity multipliers (high k2):
    # completeness = (2*100 + 3*(100 − 2*10)) / 5 = 88.0
    # accuracy     = (2*100 + 2*90) / 4 = 95.0
    # Unmeasured dimensions (coverage 0) are excluded from the composite —
    # absence of evidence is not a pass — so weights renormalise over the two.
    assert result.composite_score == 91.5
    assert result.weights == {"completeness": 0.5, "accuracy": 0.5}


def test_errored_checks_excluded_from_score():
    bad = _make_result("T9", dimension="completeness", passed=False).model_copy(
        update={"error": "boom", "pass_rate": 0.0})
    result = score_module([_make_result("T1", dimension="completeness", passed=True), bad], {})
    assert result.composite_score == 100.0
    assert result.errored_checks == 1


def test_tenant_weights_ignore_non_dimension_keys_and_normalise():
    from api.services.scoring import effective_weights
    w = effective_weights({"completeness": 2, "accuracy": 2, "notification_config": {"x": 1}})
    assert abs(sum(w.values()) - 1.0) < 1e-9
    assert w["completeness"] == w["accuracy"]


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
    # accuracy:     [90] high, multiplier 2 → 100 − 2*10 = 80, × 0.50 = 40
    # others: 100 × 0.00 = 0
    assert result.composite_score == 90.0


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


def test_score_all_modules_maps_field_unmaintained_to_not_applicable():
    """A presence check on an unmaintained field is not a defect and not a coverage miss.

    It must surface as not_applicable, not silently disappear from the DQS model (the
    runner reports it under "field_unmaintained", which score_all_modules had never read).
    A field hidden by the system's field-status config ("field_suppressed") scores the
    same way — blank by design, not a defect and not a coverage miss.
    """
    findings = [_make_result("T001", module="mod_a", dimension="completeness")]
    skips = {"mod_a": {"not_evaluable": 2, "not_applicable": 3, "field_unmaintained": 7, "field_suppressed": 5}}

    results = score_all_modules(findings, skips=skips)

    r = results["mod_a"]
    assert r.skipped_checks == 2
    assert r.not_applicable_checks == 15, "field_unmaintained and field_suppressed must fold into not_applicable"
    assert r.coverage == round(1.0 / (1 + 2), 4), "coverage = findings / (findings + not_evaluable)"
    assert r.total_checks == 1, "the suppressed rule must not count as a finding"

def test_a_module_with_nothing_measured_has_no_score_not_a_perfect_one():
    """Nothing checked is not a pass.

    A module whose rules all skipped (missing field, empty population) measured
    nothing. ``composite_score``/``raw_score`` already say so (None), and the
    ``legacy`` view must agree: it used to coerce "nothing measured" to 100.0 with
    tier "pass", which is how the SuccessFactors learning_management and
    time_attendance modules came to read 100/100 on coverage 0.0 in the UI.
    """
    result = score_module([], {}, module="learning_management", skipped=80)
    assert result.raw_score is None and result.composite_score is None
    assert result.tier is None
    assert result.legacy["composite_score"] is None
    assert result.legacy["tier"] is None
    # a partially measured module still scores, and says how much it covered
    partial = score_module([_make_result("T1", dimension="completeness")], {}, module="m", skipped=3)
    assert partial.composite_score == 100.0 and partial.coverage == 0.25
    assert partial.low_confidence is True
