"""A locked SAP user must be reported as a lock, with the action required - not as a bad password.

The ECC user was locked on the Komatsu sandbox ("Password logon no longer possible - too many
failed attempts") after repeated extraction restarts, and the only message anyone saw was the raw
RFC text. A locked user and a wrong password look identical there, and the wrong response - retry,
or re-enter the password - extends the lock, because SAP counts every failed attempt.
"""

import pytest

from sap.rfc import _logon_advice


@pytest.mark.parametrize("message", [
    "2 (rc=2): key=RFC_LOGON_FAILURE, message=Password logon no longer possible - too many failed attempts",
    "key=RFC_LOGON_FAILURE, message=user is locked",
    "Logon currently not possible",
])
def test_a_locked_user_says_unlock_in_su01(message: str) -> None:
    out = _logon_advice(message)
    assert "SU01" in out
    assert "does not retry" in out


def test_the_original_error_is_kept() -> None:
    """The operator still needs SAP's own words to act on."""
    original = "key=RFC_LOGON_FAILURE, message=Password logon no longer possible - too many failed attempts"
    assert original in _logon_advice(original)


def test_other_errors_are_passed_through_untouched() -> None:
    assert _logon_advice("host unreachable") == "host unreachable"
