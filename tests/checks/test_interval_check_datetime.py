"""interval_check on typed date columns.

A parquet written from a CSV holds dates as ``datetime64[s]`` (or ``[us]``), not SAP
``YYYYMMDD`` text. The check once compared the parsed start dates against an untyped
empty group result and failed with "Invalid comparison between dtype=datetime64[s] and
ndarray" (EC271, EC379, PUR328 on real data). Both sides are now ``datetime64[ns]``."""

import glob
from pathlib import Path

import pandas as pd
import pytest
import yaml

from checks.runner import REGISTRY, rule_columns
from checks.types.interval_check import IntervalCheck

ROOT = Path(__file__).resolve().parents[2]

RULE = {"id": "T001", "field": "EMPJOBHIST.START_DATE", "check_class": "interval_check",
        "group_by": ["EMPJOBHIST.USERID"], "start": "EMPJOBHIST.START_DATE", "end": "EMPJOBHIST.END_DATE",
        "mode": "continuous", "severity": "high", "dimension": "consistency", "message": "gap",
        "module": "employee_central"}


def _frame(users, starts, ends, unit="s"):
    return pd.DataFrame({
        "EMPJOBHIST.USERID": pd.Series(users, dtype="string"),
        "EMPJOBHIST.START_DATE": pd.to_datetime(starts).astype(f"datetime64[{unit}]"),
        "EMPJOBHIST.END_DATE": pd.to_datetime(ends).astype(f"datetime64[{unit}]"),
    })


@pytest.mark.parametrize("unit", ["s", "us", "ns"])
def test_no_valid_rows_with_typed_dates_evaluates_without_error(unit):
    # every row invalid (end before start) -> nothing to compare, which is where the dtype clash was
    df = _frame(["u1", "u2"], ["2021-01-01", "2021-06-01"], ["2020-12-31", "2020-12-31"], unit)
    res = IntervalCheck(RULE).run(df)
    assert res is not None and res.error is None, res.error
    assert res.affected_count == 0

    empty = _frame([], [], [], unit)
    res = IntervalCheck(RULE).run(empty)
    assert res is not None and res.error is None, res.error


@pytest.mark.parametrize("unit", ["s", "us"])
def test_typed_dates_find_the_same_gaps_as_text_dates(unit):
    users = ["u1", "u1", "u2", "u2"]
    starts = ["2020-01-01", "2021-01-05", "2020-01-01", "2020-07-01"]  # u1: 4-day gap; u2: continuous
    ends = ["2020-12-31", "9999-12-31", "2020-06-30", "9999-12-31"]
    typed = IntervalCheck(RULE).run(_frame(users, starts, ends, unit))
    text = IntervalCheck(RULE).run(pd.DataFrame({
        "EMPJOBHIST.USERID": pd.Series(users, dtype="string"),
        "EMPJOBHIST.START_DATE": pd.Series([s.replace("-", "") for s in starts], dtype="string"),
        "EMPJOBHIST.END_DATE": pd.Series([e.replace("-", "") for e in ends], dtype="string"),
    }))
    assert typed.error is None and text.error is None
    assert typed.affected_count == text.affected_count == 1
    assert typed.failing_record_keys == text.failing_record_keys


def test_null_dates_are_out_of_scope_not_failures():
    df = _frame(["u1", "u1"], ["2020-01-01", pd.NaT], ["2020-12-31", "9999-12-31"])
    res = IntervalCheck(RULE).run(df)
    assert res.error is None and res.affected_count == 0
    assert res.total_count == 1  # the NaT row is excluded from the evaluated population


def _rule(rule_id: str) -> dict:
    for path in glob.glob(str(ROOT / "checks/rules/**/*.yaml"), recursive=True):
        if path.endswith("column_map.yaml"):
            continue
        doc = yaml.safe_load(Path(path).read_text()) or {}
        for rule in doc.get("rules", []):
            if rule["id"] == rule_id:
                return {**rule, "module": doc.get("module")}
    raise LookupError(rule_id)


@pytest.mark.parametrize("rule_id", ["EC271", "EC379", "PUR328"])
def test_shipped_rules_evaluate_on_typed_date_frames(rule_id):
    rule = _rule(rule_id)
    assert rule["check_class"] == "interval_check"
    cols = rule_columns(rule)
    date_cols = {rule["start"], rule["end"]}
    n = 3
    data = {}
    for c in cols:
        if c == rule["start"]:
            data[c] = pd.to_datetime(["2020-01-01", "2020-06-01", "2021-01-01"]).astype("datetime64[s]")
        elif c == rule["end"]:
            data[c] = pd.to_datetime(["2020-05-31", "2020-12-31", "9999-12-31"]).astype("datetime64[s]")
        else:
            data[c] = pd.Series(["K1"] * n, dtype="string")
    df = pd.DataFrame(data)
    assert date_cols <= set(df.columns)
    res = REGISTRY["interval_check"](rule).run(df)
    assert res is not None and res.error is None, res.error
    # and on a frame where no row is in scope
    for c in date_cols:
        df[c] = pd.Series([pd.NaT] * n, dtype="datetime64[s]")
    res = REGISTRY["interval_check"](rule).run(df)
    assert res is not None and res.error is None, res.error
