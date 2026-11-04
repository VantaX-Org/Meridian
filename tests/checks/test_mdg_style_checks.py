"""count_per_parent_check, all_children_check, char_set_check and target_when any_of."""

import pandas as pd

from checks.runner import _target_context
from checks.types.all_children_check import AllChildrenCheck
from checks.types.char_set_check import CharSetCheck
from checks.types.count_per_parent_check import CountPerParentCheck

COUNT = {"id": "T", "check_class": "count_per_parent_check", "field": "A.FLAG", "parent_keys": ["A.P"],
         "max": 1, "severity": "high", "message": "m"}


def _count(rule: dict, p: list, flag: list):
    return CountPerParentCheck(rule).run(pd.DataFrame({"A.P": p, "A.FLAG": flag, "A.K": [str(i) for i in range(len(p))]}))


def test_count_max_multi_parent():
    r = _count(COUNT, ["1", "1", "2", "2", "2", "3"], ["X", "X", "X", "", "", "X"])
    assert (r.total_count, r.affected_count) == (6, 2)  # parent 1 has two flagged rows
    assert r.pass_rate < 100


def test_count_empty_and_null_keys():
    r = _count(COUNT, [], [])
    assert r.total_count == 0
    r = _count(COUNT, [None, "", "1"], ["X", "X", "X"])
    assert (r.total_count, r.affected_count) == (1, 0)  # blank parent keys are out of scope


def test_count_min():
    r = _count({**COUNT, "max": None, "min": 1}, ["1", "1", "2"], ["", "", "X"])
    assert (r.total_count, r.affected_count) == (3, 2)  # parent 1 has no flagged row


ALL = {"id": "T", "check_class": "all_children_check", "field": "P.LOEVM", "group_keys": {"C.K": "P.K"},
       "severity": "medium", "message": "m"}


def _all(parents: list, flags: list, total: dict, match: dict):
    df = pd.DataFrame({"P.K": parents, "P.LOEVM": flags})
    return AllChildrenCheck({**ALL, "_child_total": total, "_child_match": match}).run(df)


def test_all_children_multi_parent():
    # 1: all 2 children flagged, parent not => fail; 2: only 1 of 2 flagged; 3: all flagged and parent flagged; 4: no children
    r = _all(["1", "2", "3", "4"], ["", "", "X", ""], {"1": 2, "2": 2, "3": 1}, {"1": 2, "2": 1, "3": 1})
    assert (r.total_count, r.affected_count) == (3, 1)


def test_all_children_empty_parent_table():
    r = _all([], [], {}, {})
    assert r.total_count == 0


def test_all_children_null_key():
    r = _all([None], [""], {"1": 1}, {"1": 1})
    assert r.total_count == 0


CHARS = {"id": "T", "check_class": "char_set_check", "field": "A.Z", "severity": "low", "message": "m"}


def _chars(rule: dict, values: list):
    return CharSetCheck({**CHARS, **rule}).run(pd.DataFrame({"A.Z": values}))


def test_char_set_allowed_and_required():
    r = _chars({"allowed_chars": ["CT"]}, ["C", "CT", "T C", "CX", "X", None, ""])
    assert (r.total_count, r.affected_count) == (5, 2)  # nulls excluded
    r = _chars({"require_any": ["C"]}, ["C", "TC", "T"])
    assert (r.total_count, r.affected_count) == (3, 1)


def test_char_set_empty():
    assert _chars({"allowed_chars": ["C"]}, []).total_count == 0


def test_target_when_any_of_is_or():
    t = pd.DataFrame({"T.A": ["1", "2", "3", "1"], "T.B": ["x", "y", "z", "q"]})
    rows = _target_context(t, "T", {"any_of": [{"A": ["2"]}, {"B": ["z"]}]}, None)
    assert list(rows.index) == [1, 2]
    rows = _target_context(t, "T", {"A": ["1"], "any_of": [{"B": ["x"]}, {"B": ["z"]}]}, None)
    assert list(rows.index) == [0]
    assert len(_target_context(t, "T", None, None)) == 4
