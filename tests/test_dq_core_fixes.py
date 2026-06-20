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
    # Naive mean = 50; record-weighted = (100*1000+0*10)/1010 ≈ 99.01.
    findings = [_finding("completeness", 100.0, 1000),
                _finding("completeness", 0.0, 10, passed=False)]
    res = score_module(findings, {})
    assert abs(res.dimension_scores["completeness"] - 99.01) < 0.1
    assert res.dimension_coverage["completeness"] == 2
    # dimensions with no checks report coverage 0 (not a fabricated pass count)
    assert res.dimension_coverage["accuracy"] == 0


def test_pandas_polars_blank_parity():
    """pandas and polars must score identically — otherwise a module's DQS
    silently changes when it crosses the 50k-row engine threshold. Blanks ('')
    are null_check's job in BOTH engines; regex/domain/referential exclude them.
    """
    import polars as pl

    from checks.polars_engine import (
        run_domain_check,
        run_referential_check,
        run_regex_check,
    )
    from checks.types.domain_value_check import DomainValueCheck

    # 1 valid, 1 invalid, 1 blank, 1 null — the blank is the divergence trap.
    df = pd.DataFrame({"F": ["ABC", "xx", "", None]})
    lf = pl.from_pandas(df).lazy()

    rr = {"id": "r", "field": "F", "pattern": r"^[A-Z]+$", "dimension": "validity"}
    pan = RegexCheck(rr).run(df)
    pol = run_regex_check(lf, "F", r"^[A-Z]+$", rr)
    assert (pan.affected_count, pan.total_count) == (pol["affected_count"], pol["total_count"]) == (1, 2)

    dr = {"id": "d", "field": "F", "allowed_values": ["ABC"], "dimension": "validity"}
    pan2 = DomainValueCheck(dr).run(df)
    pol2 = run_domain_check(lf, "F", ["ABC"], dr)
    assert (pan2.affected_count, pan2.total_count) == (pol2["affected_count"], pol2["total_count"]) == (1, 2)

    fr = {"id": "f", "field": "F", "reference_values": ["ABC"], "dimension": "consistency"}
    pan3 = ReferentialCheck(fr).run(df)
    pol3 = run_referential_check(lf, "F", ["ABC"], fr)
    assert (pan3.affected_count, pan3.total_count) == (pol3["affected_count"], pol3["total_count"]) == (1, 2)


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
