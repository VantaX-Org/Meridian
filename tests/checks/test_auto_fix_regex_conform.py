"""Implicit conform fix for regex rules: the first safe reshaping that matches the pattern."""
from checks import auto_fix

F = "LFA1.STCD1"


def _rx(pattern, **kw):
    return {"id": "X1", "check_class": "regex_check", "field": F, "pattern": pattern, **kw}


def test_lower_case_value_is_upper_cased_to_match():
    assert auto_fix.propose(_rx(r"^[A-Z]{2}\d{4}$"), {F: "za1234"}) == ("ZA1234", "medium")


def test_inner_spaces_are_removed_to_match():
    assert auto_fix.propose(_rx(r"^\d{10}$"), {F: "12345 67890"}) == ("1234567890", "medium")


def test_separators_are_removed_to_match():
    assert auto_fix.propose(_rx(r"^\d{9}$"), {F: "123-456-789"}) == ("123456789", "medium")


def test_short_number_is_zero_padded_to_the_fixed_width():
    assert auto_fix.propose(_rx(r"^\d{8}$"), {F: "4711"}) == ("00004711", "medium")


def test_value_no_reshaping_can_fix_gets_no_proposal():
    assert auto_fix.propose(_rx(r"^\d{4}$"), {F: "ABCDE"}) is None


def test_letters_are_never_dropped_to_force_a_match():
    assert auto_fix.propose(_rx(r"^\d+$"), {F: "12A4"}) is None


def test_rule_with_explicit_auto_fix_keeps_it():
    rule = _rx(r"^[A-Z]+$", auto_fix={"steps": [{"op": "set", "value": "X"}], "confidence": "low"})
    assert auto_fix.propose(rule, {F: "abc"}) == ("X", "low")


def test_pattern_python_cannot_compile_gets_no_proposal():
    assert auto_fix.propose(_rx(r"^[A-Z"), {F: "abc"}) is None
