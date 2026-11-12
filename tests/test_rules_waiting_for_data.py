"""Rules whose table was not loaded (upload required, preview source) never run: they are skipped by the
runner, kept out of the score, and counted per module as waiting for data. Synthetic data only."""

import pandas as pd

from api.services.scoring import score_module
from checks.base import CheckResult
from checks.frames import TableFrames, tables_of
from checks.overrides import apply
from checks.runner import module_rules, rule_columns, run_rule, waiting_for_data
from sap.ddic import get_dictionary


def _payresult_rules() -> list[dict]:
    return [r for r in apply(module_rules("payroll_integration"), None)
            if "PAYRESULT" in tables_of(rule_columns(r))]


def test_waiting_count_for_an_upload_required_table():
    n = len(_payresult_rules())
    assert n > 0
    cov = [{"table": "PAYRESULT", "status": "upload_required"}]
    assert waiting_for_data(["payroll_integration", "material_master"], cov) == {
        "payroll_integration": n, "material_master": 0}
    # once the file is uploaded and read live, nothing waits
    assert waiting_for_data(["payroll_integration"], cov + [{"table": "PAYRESULT", "status": "live"}]) == {
        "payroll_integration": 0}


def test_preview_module_waits_on_every_table_not_read_live():
    cov = [{"table": "SomePreviewSource", "status": "preview", "module": "payroll_integration"}]
    assert waiting_for_data(["payroll_integration"], cov)["payroll_integration"] >= len(_payresult_rules())


def test_rule_on_a_missing_table_produces_no_result():
    frames = TableFrames({"EMPEMPLOYMENT": pd.DataFrame({"EMPEMPLOYMENT.USERID": ["U1"]})}, get_dictionary("s4hana"))
    for rule in _payresult_rules()[:10]:
        assert run_rule(rule, frames)[1] is None


def _finding(dim: str, rate: float) -> CheckResult:
    return CheckResult(check_id=f"c-{dim}", module="payroll_integration", field="f", severity="low",
                       dimension=dim, passed=rate == 100.0, affected_count=0, total_count=10,
                       pass_rate=rate, message="", details={})


def test_skipped_rules_leave_the_score_unchanged():
    findings = [_finding("completeness", 100.0), _finding("validity", 50.0)]
    ran = score_module(findings, {}, module="payroll_integration")
    waiting = score_module(findings, {}, module="payroll_integration", skipped=len(_payresult_rules()))
    assert waiting.composite_score == ran.composite_score
    assert waiting.dimension_scores == ran.dimension_scores
    # only the coverage ratio shows that rules did not run
    assert waiting.coverage < ran.coverage
