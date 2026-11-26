"""Domain rules without an authored auto_fix still clean themselves: a value that differs from
exactly one allowed code only by case or surrounding space snaps to that code, verified by the rule."""

import pandas as pd

from checks import auto_fix
from checks.types.domain_value_check import DomainValueCheck

RULE = {"id": "D1", "field": "T.F", "check_class": "domain_value_check", "allowed_values": ["Y", "N"]}


def test_case_and_space_snap_to_the_single_allowed_code():
    assert auto_fix.propose(RULE, {"T.F": " y "}) == ("Y", "high")
    assert auto_fix.enabled(RULE)


def test_ambiguous_or_unknown_values_get_no_proposal():
    rule = {**RULE, "allowed_values": ["true", "True", "false"]}
    assert auto_fix.propose(rule, {"T.F": "TRUE"}) is None  # two codes fold to it
    assert auto_fix.propose(RULE, {"T.F": "maybe"}) is None


def test_live_reference_set_is_the_snap_target():
    rule = {**RULE, "allowed_values": None, "_live_reference": {"KG", "EA"}}
    assert auto_fix.propose(rule, {"T.F": "kg"}) == ("KG", "high")


def test_authored_auto_fix_wins_and_other_classes_stay_off():
    authored = {**RULE, "auto_fix": {"steps": [{"op": "set", "value": "N"}], "confidence": "low"}}
    assert auto_fix.propose(authored, {"T.F": "y"}) == ("N", "low")
    assert not auto_fix.enabled({**RULE, "check_class": "regex_check"})


def test_snap_proposals_are_self_verified():
    df = pd.DataFrame({"T.F": ["Y", "n", "x"]})
    ev = DomainValueCheck(RULE).evaluate(df)
    assert auto_fix.proposals(RULE, df, ev.failing, evaluate=DomainValueCheck(RULE).evaluate) == {1: ("N", "high")}
