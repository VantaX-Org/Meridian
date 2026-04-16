import pandas as pd
import pytest

from checks.base import BaseCheck, CheckResult


class ConcreteCheck(BaseCheck):
    check_class = "test_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        field = self.rule["field"]
        total = len(df)
        null_count = int(df[field].isna().sum())
        return CheckResult(
            check_id=self.rule["id"],
            module=self.rule.get("module", "test"),
            field=field,
            severity=self.rule.get("severity", "medium"),
            dimension=self.rule.get("dimension", "completeness"),
            passed=(null_count == 0),
            affected_count=null_count,
            total_count=total,
            pass_rate=((total - null_count) / total * 100) if total > 0 else 0.0,
            message=self.rule.get("message", "test check"),
            details={"null_count": null_count},
        )


def test_concrete_check_returns_check_result():
    rule = {
        "id": "TEST001",
        "field": "name",
        "module": "test_module",
        "severity": "high",
        "dimension": "completeness",
        "message": "Name must not be null",
    }
    check = ConcreteCheck(rule)
    df = pd.DataFrame({"name": ["Alice", "Bob", None, "Dave"]})
    result = check.run(df)

    assert isinstance(result, CheckResult)
    assert result.check_id == "TEST001"
    assert result.module == "test_module"
    assert result.field == "name"
    assert result.severity == "high"
    assert result.dimension == "completeness"
    assert result.passed is False
    assert result.affected_count == 1
    assert result.total_count == 4
    assert result.pass_rate == 75.0
    assert result.message == "Name must not be null"
    assert result.details == {"null_count": 1}
    assert result.error is None


def test_concrete_check_all_pass():
    rule = {"id": "TEST002", "field": "value", "module": "test", "message": "ok"}
    check = ConcreteCheck(rule)
    df = pd.DataFrame({"value": [1, 2, 3]})
    result = check.run(df)

    assert result.passed is True
    assert result.affected_count == 0
    assert result.pass_rate == 100.0


def test_base_check_is_abstract():
    with pytest.raises(TypeError):
        BaseCheck({"id": "X"})
