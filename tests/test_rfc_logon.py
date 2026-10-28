"""A locked SAP user must be reported as a lock, with the action required - not as a bad password.

The ECC user was locked on a pilot customer's sandbox ("Password logon no longer possible - too many
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


# ── a close that fails must be visible, not swallowed ───────────────────────────────────────────
def test_a_failed_session_close_is_logged(caplog):
    """An uncleaned session is counted by SAP like a failed logon.

    `close()` used to be `try: c.close() except Exception: pass`, so a session that failed to close
    left SAP holding it with no trace anywhere - each attempt looked clean while the account
    drifted toward a lock. This asserts the failure is reported.
    """
    import logging

    from sap.rfc import RFCConnector

    class BadConn:
        def close(self):
            raise RuntimeError("network gone")

    conn = RFCConnector()
    conn._conn = BadConn()
    with caplog.at_level(logging.WARNING, logger="meridian.sap.rfc"):
        conn.close()
    assert any("close FAILED" in r.message or "close FAILED" in str(r.msg) for r in caplog.records), \
        "a failed close must be logged; otherwise the session is lost silently"


def test_a_successful_close_is_logged_with_the_count(caplog):
    import logging

    from sap.rfc import RFCConnector

    class GoodConn:
        def close(self):
            pass

    conn = RFCConnector()
    conn._conn = GoodConn()
    conn._extra = [GoodConn(), GoodConn()]
    with caplog.at_level(logging.INFO, logger="meridian.sap.rfc"):
        conn.close()
    assert any("3 ok" in str(r.getMessage()) for r in caplog.records)
