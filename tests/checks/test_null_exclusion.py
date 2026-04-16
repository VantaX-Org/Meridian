"""Phase 2 verification: regex_check and domain_value_check must exclude nulls.
Null detection is the sole responsibility of null_check."""

import pandas as pd

from checks.types.regex_check import RegexCheck
from checks.types.domain_value_check import DomainValueCheck


def test_regex_check_excludes_nulls_and_blanks():
    """Pattern ^[A-Z]+$ on [ABC, None, '', XYZ]: only non-null non-blank values are
    checked. All 2 non-nulls match — expect 0 failures."""
    df = pd.DataFrame({"LFA1.NAME1": ["ABC", None, "", "XYZ"]})
    rule = {
        "id": "TEST_REGEX",
        "field": "LFA1.NAME1",
        "pattern": r"^[A-Z]+$",
        "severity": "medium",
        "dimension": "validity",
    }
    result = RegexCheck(rule).run(df)
    assert result.affected_count == 0
    # total_count now reflects non-null/non-blank rows only
    assert result.total_count == 2
    assert result.pass_rate == 100.0


def test_regex_check_counts_only_non_null_failures():
    """Two non-null values don't match — expect 2 failures out of 3 non-null total."""
    df = pd.DataFrame({"LFA1.LIFNR": ["V001", "bad value", None, "not-valid"]})
    rule = {
        "id": "TEST_REGEX_FAIL",
        "field": "LFA1.LIFNR",
        "pattern": r"^V\d{3}$",
        "severity": "medium",
        "dimension": "validity",
    }
    result = RegexCheck(rule).run(df)
    assert result.affected_count == 2
    assert result.total_count == 3


def test_domain_value_check_excludes_nulls():
    """Allowed values ['A','B']; records [A, None, '', B]: non-nulls all match, 0 failures."""
    df = pd.DataFrame({"MARA.MTART": ["A", None, "", "B"]})
    rule = {
        "id": "TEST_DOMAIN",
        "field": "MARA.MTART",
        "allowed_values": ["A", "B"],
        "severity": "medium",
        "dimension": "validity",
    }
    result = DomainValueCheck(rule).run(df)
    assert result.affected_count == 0
    assert result.total_count == 2


def test_domain_value_email_format_excludes_nulls():
    df = pd.DataFrame({
        "LFA1.SMTP_ADDR": ["user@example.com", None, "", "not-an-email"],
    })
    rule = {
        "id": "TEST_EMAIL",
        "field": "LFA1.SMTP_ADDR",
        "format": "email",
        "severity": "medium",
        "dimension": "validity",
    }
    result = DomainValueCheck(rule).run(df)
    assert result.affected_count == 1  # only "not-an-email"
    assert result.total_count == 2  # nulls and blanks excluded


def test_domain_value_date_format_excludes_nulls():
    df = pd.DataFrame({
        "VBAK.ERDAT": ["2024-01-15", None, "", "not-a-date", "2023-06-01"],
    })
    rule = {
        "id": "TEST_DATE",
        "field": "VBAK.ERDAT",
        "format": "date",
        "severity": "medium",
        "dimension": "validity",
    }
    result = DomainValueCheck(rule).run(df)
    assert result.affected_count == 1  # only "not-a-date"
    assert result.total_count == 3  # nulls and blanks excluded
