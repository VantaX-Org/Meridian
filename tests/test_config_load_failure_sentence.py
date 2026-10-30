"""A failed configuration load reads as a sentence on the job line, not as a connector code (acceptance run)."""

from workers.tasks.run_load_config import failure_sentence


def test_pyrfc_code_becomes_a_sentence() -> None:
    s = failure_sentence("pyrfc_not_installed: build the API image with INSTALL_PYRFC=true")
    assert s.startswith("The SAP RFC library is not installed") and "pyrfc_not_installed" not in s


def test_other_codes_are_dropped_and_plain_messages_kept() -> None:
    assert failure_sentence("logon_failed: the user is locked") == "The user is locked"
    assert failure_sentence("Connection refused") == "Connection refused"
    assert failure_sentence("Timeout: 30 s") == "Timeout: 30 s"
