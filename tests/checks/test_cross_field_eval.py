"""Phase 3 verification: cross_field_check must support method calls
(.duplicated(), .notna()), comparison operators, and NaN-safe semantics."""

import pandas as pd

from checks.types.cross_field_check import CrossFieldCheck


def _run(condition: str, df: pd.DataFrame, fields: list[str]) -> object:
    rule = {
        "id": "CF_TEST",
        "fields": fields,
        "condition": condition,
        "severity": "medium",
        "dimension": "consistency",
        "message": "test",
    }
    return CrossFieldCheck(rule).run(df)


def test_duplicated_method_call():
    """Detect duplicate values in a column (all copies fail)."""
    df = pd.DataFrame({"CODE": ["A", "B", "A", "C", "B"]})
    # Passing = not duplicated at all (unique rows). 'A' and 'B' each appear twice.
    result = _run("~CODE.duplicated(keep=False)", df, ["CODE"])
    assert result.affected_count == 4  # Two A's + two B's
    assert result.total_count == 5


def test_comparison_operator():
    df = pd.DataFrame({"A": [10, 5, 20, 15], "B": [20, 10, 15, 15]})
    # Passing when A <= B
    result = _run("A <= B", df, ["A", "B"])
    # rows: (10,20) pass, (5,10) pass, (20,15) fail, (15,15) pass
    assert result.affected_count == 1


def test_notna_and_non_empty():
    df = pd.DataFrame({"NAME": ["Alice", None, "", "Bob"]})
    result = _run("NAME.notna() & (NAME != '')", df, ["NAME"])
    # NaN rows get .fillna(False) → count as failing. "" also fails.
    assert result.affected_count == 2


def test_and_or_combinations():
    df = pd.DataFrame({
        "QTY": [10, -5, 0, 100],
        "PRICE": [1.5, 2.0, 3.0, -1.0],
    })
    # Passing when QTY > 0 AND PRICE > 0
    result = _run("(QTY > 0) & (PRICE > 0)", df, ["QTY", "PRICE"])
    # row 0: 10,1.5 pass | row 1: -5 fail | row 2: 0 fail | row 3: -1 fail
    assert result.affected_count == 3


def test_nan_comparison_counts_as_failing():
    """NaN in numeric comparison should count as failing, not silently drop."""
    df = pd.DataFrame({"A": [1, 2, None, 4], "B": [10, 20, 30, 40]})
    result = _run("A < B", df, ["A", "B"])
    # The None row fails under NaN-to-False coercion.
    assert result.affected_count == 1
