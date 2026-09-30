import pandas as pd
import pytest

from checks.base import BaseCheck, CheckResult, Evaluation


class ConcreteCheck(BaseCheck):
    check_class = "test_check"
    default_dimension = "completeness"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        return Evaluation(pd.Series(True, index=df.index), df[self.rule["field"]].isna())


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
    assert result.details["failing_record_count"] == 1
    assert len(result.failing_record_keys) == 1
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


def test_pass_rate_never_rounds_failures_up_to_100():
    df = pd.DataFrame({"value": [1] * 199_999 + [None]})
    result = ConcreteCheck({"id": "T3", "field": "value"}).run(df)
    assert result.affected_count == 1
    assert result.passed is False
    assert result.pass_rate < 100.0


def test_composite_record_keys():
    df = pd.DataFrame({"LFB1.LIFNR": ["1", "1"], "LFB1.BUKRS": ["1000", "2000"], "LFB1.AKONT": [None, "1"]})
    result = ConcreteCheck({"id": "T4", "field": "LFB1.AKONT"}).run(df, key_cols=["LFB1.LIFNR", "LFB1.BUKRS"])
    assert result.failing_record_keys == ["LIFNR=1|BUKRS=1000"]
    assert result.details["sample_failing_records"][0]["record_key"] == "LIFNR=1|BUKRS=1000"
