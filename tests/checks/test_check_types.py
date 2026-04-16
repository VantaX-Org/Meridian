from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from checks.types.null_check import NullCheck
from checks.types.regex_check import RegexCheck
from checks.types.domain_value_check import DomainValueCheck
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.referential_check import ReferentialCheck
from checks.types.freshness_check import FreshnessCheck


# --- NullCheck ---

class TestNullCheck:
    def test_clean_data_passes(self):
        rule = {"id": "N001", "field": "name", "severity": "high", "dimension": "completeness", "message": "test"}
        df = pd.DataFrame({"name": ["Alice", "Bob", "Carol"]})
        result = NullCheck(rule).run(df)
        assert result.passed is True
        assert result.affected_count == 0
        assert result.pass_rate == 100.0

    def test_dirty_data_fails(self):
        rule = {"id": "N002", "field": "name", "severity": "critical", "dimension": "completeness", "message": "test"}
        df = pd.DataFrame({"name": ["Alice", None, "", "Dave"]})
        result = NullCheck(rule).run(df)
        assert result.passed is False
        assert result.affected_count == 2  # None and ""
        assert result.pass_rate == 50.0

    def test_missing_column_returns_error(self):
        rule = {"id": "N003", "field": "missing_col", "severity": "medium", "dimension": "completeness", "message": "test"}
        df = pd.DataFrame({"other": [1, 2]})
        result = NullCheck(rule).run(df)
        assert result.passed is False
        assert result.error is not None


# --- RegexCheck ---

class TestRegexCheck:
    def test_matching_data_passes(self):
        rule = {"id": "R001", "field": "code", "pattern": "^[0-9]{5}$", "severity": "high", "dimension": "validity", "message": "test"}
        df = pd.DataFrame({"code": ["12345", "67890", "00001"]})
        result = RegexCheck(rule).run(df)
        assert result.passed is True
        assert result.pass_rate == 100.0

    def test_non_matching_data_fails(self):
        rule = {"id": "R002", "field": "code", "pattern": "^[0-9]{5}$", "severity": "critical", "dimension": "validity", "message": "test"}
        df = pd.DataFrame({"code": ["12345", "ABCDE", None, "123"]})
        result = RegexCheck(rule).run(df)
        assert result.passed is False
        # Nulls are now excluded (null_check owns null detection).
        # Only non-null non-matching values count: ABCDE, 123 → 2 failures
        assert result.affected_count == 2
        assert result.total_count == 3  # non-null count


# --- DomainValueCheck ---

class TestDomainValueCheck:
    def test_valid_domain_passes(self):
        rule = {"id": "D001", "field": "status", "allowed_values": ["A", "B", "C"], "severity": "high", "dimension": "validity", "message": "test"}
        df = pd.DataFrame({"status": ["A", "B", "C", "A"]})
        result = DomainValueCheck(rule).run(df)
        assert result.passed is True

    def test_invalid_domain_fails(self):
        rule = {"id": "D002", "field": "status", "allowed_values": ["A", "B"], "severity": "critical", "dimension": "validity", "message": "test"}
        df = pd.DataFrame({"status": ["A", "X", None, "B"]})
        result = DomainValueCheck(rule).run(df)
        assert result.passed is False
        # Nulls excluded (null_check owns null detection). Only "X" is invalid.
        assert result.affected_count == 1
        assert result.total_count == 3  # non-null count

    def test_email_format_valid(self):
        rule = {"id": "D003", "field": "email", "format": "email", "severity": "medium", "dimension": "completeness", "message": "test"}
        df = pd.DataFrame({"email": ["user@example.com", "test@test.co.za"]})
        result = DomainValueCheck(rule).run(df)
        assert result.passed is True

    def test_email_format_invalid(self):
        rule = {"id": "D004", "field": "email", "format": "email", "severity": "medium", "dimension": "completeness", "message": "test"}
        df = pd.DataFrame({"email": ["user@example.com", "not-an-email", None]})
        result = DomainValueCheck(rule).run(df)
        assert result.passed is False
        # Nulls excluded. Only "not-an-email" is invalid.
        assert result.affected_count == 1
        assert result.total_count == 2


# --- CrossFieldCheck ---

class TestCrossFieldCheck:
    def test_condition_all_pass(self):
        rule = {
            "id": "C001", "field": "a", "fields": ["a", "b"],
            "condition": "a > 0 and b > 0",
            "severity": "high", "dimension": "consistency", "message": "test",
        }
        df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
        result = CrossFieldCheck(rule).run(df)
        assert result.passed is True

    def test_condition_some_fail(self):
        rule = {
            "id": "C002", "field": "a", "fields": ["a", "b"],
            "condition": "a > 0 and b > 0",
            "severity": "critical", "dimension": "consistency", "message": "test",
        }
        df = pd.DataFrame({"a": [1, -1, 3], "b": [4, 5, -1]})
        result = CrossFieldCheck(rule).run(df)
        assert result.passed is False
        assert result.affected_count == 2


# --- ReferentialCheck ---

class TestReferentialCheck:
    def test_all_values_valid(self):
        rule = {
            "id": "REF001", "field": "country",
            "reference_field": "country", "reference_values": ["ZA", "US", "UK"],
            "severity": "high", "dimension": "consistency", "message": "test",
        }
        df = pd.DataFrame({"country": ["ZA", "US", "UK"]})
        result = ReferentialCheck(rule).run(df)
        assert result.passed is True

    def test_invalid_references_fail(self):
        rule = {
            "id": "REF002", "field": "country",
            "reference_field": "country", "reference_values": ["ZA", "US"],
            "severity": "critical", "dimension": "consistency", "message": "test",
        }
        df = pd.DataFrame({"country": ["ZA", "XX", None, "US"]})
        result = ReferentialCheck(rule).run(df)
        assert result.passed is False
        assert result.affected_count == 2


# --- FreshnessCheck ---

class TestFreshnessCheck:
    def test_recent_data_passes(self):
        now = datetime.now(timezone.utc)
        rule = {
            "id": "F001", "field": "updated_at", "max_age_hours": 24,
            "severity": "medium", "dimension": "timeliness", "message": "test",
        }
        df = pd.DataFrame({"updated_at": [
            (now - timedelta(hours=1)).isoformat(),
            (now - timedelta(hours=2)).isoformat(),
        ]})
        result = FreshnessCheck(rule).run(df)
        assert result.passed is True

    def test_stale_data_fails(self):
        now = datetime.now(timezone.utc)
        rule = {
            "id": "F002", "field": "updated_at", "max_age_hours": 24,
            "severity": "low", "dimension": "timeliness", "message": "test",
        }
        df = pd.DataFrame({"updated_at": [
            (now - timedelta(hours=1)).isoformat(),
            (now - timedelta(hours=48)).isoformat(),
            (now - timedelta(hours=72)).isoformat(),
        ]})
        result = FreshnessCheck(rule).run(df)
        assert result.passed is False
        assert result.affected_count == 2
