"""Runnable checks for two live DQ-engine correctness fixes.

1. referential_check excludes nulls — a missing value is null_check's job, not
   referential's, else it's counted as a failure by both (double-count).
2. scoring record-weights each dimension's pass_rate by total_count, and reports
   dimension_coverage so a "100 from zero checks" is visible, not silent.

Run: pytest tests/test_dq_core_fixes.py
"""

import pandas as pd

from api.services.scoring import score_module
from checks.base import CheckResult
from checks.types.referential_check import ReferentialCheck
from checks.types.regex_check import RegexCheck


def _ref_rule(**over):
    rule = {
        "id": "R1", "module": "m", "field": "LAND1", "dimension": "consistency",
        "severity": "medium", "reference_values": ["US", "DE"],
    }
    rule.update(over)
    return rule


def test_referential_ignores_nulls():
    # 3 valid, 1 out-of-domain, 1 null/blank. Null must NOT be a failure here.
    df = pd.DataFrame({"LIFNR": ["1", "2", "3", "4", "5"],
                       "LAND1": ["US", "DE", "US", "FR", None]})
    res = ReferentialCheck(_ref_rule()).run(df)
    assert res.affected_count == 1          # only "FR", not the null
    assert res.pass_rate == 75.0            # 3 pass of 4 non-null, blanks excluded


def test_referential_all_null_passes():
    # All null → nothing for referential to judge → 100 (null_check owns these).
    df = pd.DataFrame({"LIFNR": ["1", "2"], "LAND1": [None, ""]})
    res = ReferentialCheck(_ref_rule()).run(df)
    assert res.affected_count == 0 and res.pass_rate == 100.0


def _finding(dim, pass_rate, total, passed=True):
    return CheckResult(check_id="c", module="m", field="f", severity="low",
                       dimension=dim, passed=passed, affected_count=0,
                       total_count=total, pass_rate=pass_rate, message="", details={})


def test_scoring_record_weights_by_total_count():
    # Two completeness checks: 100% over 1000 rows, 0% over 10 rows.
    # Dimensions weight rules by severity, not row count: a rule that fails on
    # every one of its rows counts as much as one that passes on many, so the
    # equal-severity mean is (100 + 0) / 2 = 50.
    findings = [_finding("completeness", 100.0, 1000),
                _finding("completeness", 0.0, 10, passed=False)]
    res = score_module(findings, {})
    assert res.dimension_scores["completeness"] == 50.0
    assert res.dimension_coverage["completeness"] == 2
    # dimensions with no checks report coverage 0 (not a fabricated pass count)
    assert res.dimension_coverage["accuracy"] == 0


def test_blanks_excluded_from_non_null_checks():
    """Blanks ('' / whitespace / None) are null_check's job alone — regex,
    domain and referential checks judge only populated values."""
    from checks.types.domain_value_check import DomainValueCheck

    df = pd.DataFrame({"F": ["ABC", "xx", "  ", None]})
    rr = {"id": "r", "field": "F", "pattern": r"^[A-Z]+$", "dimension": "validity"}
    dr = {"id": "d", "field": "F", "allowed_values": ["ABC"], "dimension": "validity"}
    fr = {"id": "f", "field": "F", "reference_values": ["ABC"], "dimension": "consistency"}
    for res in (RegexCheck(rr).run(df), DomainValueCheck(dr).run(df), ReferentialCheck(fr).run(df)):
        assert (res.affected_count, res.total_count) == (1, 2)


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))


def test_a_module_with_no_checks_has_no_dimension_scores():
    """An unmeasured dimension must be None, not 100.

    It used to be 100.0 "with coverage 0", relying on each consumer to check the coverage first.
    The object API does; the PDF report does not - `dimension_scores()` weights by
    max(1, total_checks or 1), so an object with no checks contributed a 100 to the report's
    average. A client reading that report sees a perfect score for an object nothing was tested
    on. None cannot be misread.
    """
    from api.services.scoring import score_module

    out = score_module([], {}, module="learning_management")
    assert out.composite_score is None
    assert all(v is None for v in out.dimension_scores.values()), out.dimension_scores
    assert all(v == 0 for v in out.dimension_coverage.values())
