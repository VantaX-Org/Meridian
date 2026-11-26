"""Implicit snap fix for referential rules and SAP leading-zero (ALPHA) variants."""
import time

from checks import auto_fix
from checks.types.referential_check import ReferentialCheck

import pandas as pd

F = "KNVV.KUNNR"


def _ref(values, **kw):
    return {"id": "R1", "check_class": "referential_check", "field": F, "_live_reference": set(values), **kw}


def test_referential_rule_snaps_case_variant():
    assert auto_fix.propose(_ref({"ZA01", "ZA02"}), {F: " za01"}) == ("ZA01", "high")


def test_numeric_value_missing_leading_zeros_snaps_to_padded_key():
    assert auto_fix.propose(_ref({"0000012345", "0000099999"}), {F: "12345"}) == ("0000012345", "high")


def test_padded_value_snaps_to_unpadded_key():
    assert auto_fix.propose(_ref({"12345"}), {F: "0012345"}) == ("12345", "high")


def test_two_keys_equal_after_zero_strip_is_ambiguous():
    assert auto_fix.propose(_ref({"012", "0012"}), {F: "12"}) is None


def test_exact_case_match_wins_over_zero_match():
    assert auto_fix.propose(_ref({"A1", "0A1"}), {F: "a1"}) == ("A1", "high")


def test_non_numeric_value_is_not_zero_normalised():
    assert auto_fix.propose(_ref({"0AB"}), {F: "AB"}) is None


def test_multi_value_chars_rule_gets_no_snap():
    assert not auto_fix.enabled(_ref({"C", "T"}, multi_value="chars"))


def test_baseline_reference_values_used_without_live():
    rule = {"id": "R2", "check_class": "referential_check", "field": F, "reference_values": ["EUR", "USD"]}
    assert auto_fix.propose(rule, {F: "eur"}) == ("EUR", "high")


def test_large_reference_set_stays_fast():
    keys = {f"{i:010d}" for i in range(50_000)}
    rule = _ref(keys)
    df = pd.DataFrame({F: [str(i) for i in range(0, 50_000, 5)]})
    t = time.perf_counter()
    hits = auto_fix.proposals(rule, df, pd.Series([True] * len(df)), None, ReferentialCheck(rule).evaluate)
    assert len(hits) == len(df)
    assert time.perf_counter() - t < 5
