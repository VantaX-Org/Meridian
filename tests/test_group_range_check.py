import pandas as pd

from checks.runner import REGISTRY
from checks.types.dependency_check import DependencyCheck
from checks.types.group_range_check import GroupRangeCheck


def test_frozen_allowed_mapping_ignores_current_majority():
    df = pd.DataFrame({"MARA.MTART": ["ROH", "ROH", "ROH", "FERT", "HAWA", None],
                       "MARC.BESKZ": ["E", "E", "F", "X", "Q", "E"]})
    rule = {"id": "LR-000001", "check_class": "dependency_check", "determinant": "MARA.MTART",
            "field": "MARC.BESKZ", "allowed": {"ROH": ["F"], "FERT": ["E", "X"]}}
    ev = DependencyCheck(rule).evaluate(df)
    assert ev.population.tolist() == [True, True, True, True, False, False]   # HAWA not frozen, blank out
    assert ev.failing.tolist() == [True, True, False, False, False, False]  # majority E no longer wins


def test_dependency_without_allowed_is_unchanged():
    df = pd.DataFrame({"A.X": ["1", "1", "1"], "A.Y": ["a", "a", "b"]})
    ev = DependencyCheck({"id": "HR-1", "determinant": "A.X", "field": "A.Y"}).evaluate(df)
    assert ev.failing.tolist() == [False, False, True]


def test_group_range_flags_outside_and_skips_unknown_groups():
    df = pd.DataFrame({"MARA.MTART": ["ROH", "ROH", "FERT", "HAWA", "ROH"],
                       "MARA.BRGEW": ["5", "50", "150", "1", "abc"]})
    rule = {"id": "LR-000002", "check_class": "group_range_check", "group_by": "MARA.MTART",
            "field": "MARA.BRGEW", "ranges": {"ROH": [0.1, 10.9], "FERT": [90.0, 210.0]}}
    ev = GroupRangeCheck(rule).evaluate(df)
    assert ev.population.tolist() == [True, True, True, False, False]
    assert ev.failing.tolist() == [False, True, False, False, False]
    assert REGISTRY["group_range_check"] is GroupRangeCheck
