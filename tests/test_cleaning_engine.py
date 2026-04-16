"""Unit tests for CleaningEngine — one test per detection category."""

import pandas as pd
import pytest
from datetime import datetime, timezone, timedelta

from api.services.cleaning_engine import CleaningEngine


@pytest.fixture
def engine():
    return CleaningEngine()


TENANT_ID = "00000000-0000-0000-0000-000000000001"
VERSION_ID = "00000000-0000-0000-0000-000000000099"


class TestDetectDuplicates:
    def test_exact_match_on_email(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001", "BP002", "BP003"],
            "name": ["Acme Trading Pty Ltd", "Acme Trading (Pty) Ltd", "Unrelated Corp"],
            "email": ["info@acme.co.za", "info@acme.co.za", "other@test.com"],
        })
        results = engine.detect_duplicates(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        match = results[0]
        assert match["category"] == "dedup"
        assert match["confidence"] >= 80

    def test_no_duplicates(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001", "BP002"],
            "name": ["Alpha Corp", "Zeta Holdings"],
            "email": ["alpha@test.com", "zeta@test.com"],
        })
        results = engine.detect_duplicates(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) == 0


class TestDetectStandardisationIssues:
    def test_phone_standardisation(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001"],
            "phone": ["0821234567"],
        })
        results = engine.detect_standardisation_issues(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["category"] == "standardisation"
        assert results[0]["record_data_after"]["phone"] == "+27 82 123 4567"

    def test_name_standardisation(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001"],
            "name": ["ACME TRADING PTY LTD"],
        })
        results = engine.detect_standardisation_issues(df, "business_partner", VERSION_ID, TENANT_ID)
        name_results = [r for r in results if "name" in r["record_data_after"]]
        assert len(name_results) >= 1


class TestDetectEnrichmentGaps:
    def test_missing_currency(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001", "BP002"],
            "currency": [None, "USD"],
        })
        results = engine.detect_enrichment_gaps(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["category"] == "enrichment"
        assert results[0]["record_data_after"].get("currency") == "ZAR"

    def test_missing_base_unit_material(self, engine):
        df = pd.DataFrame({
            "material": ["MAT001"],
            "base_unit": [None],
        })
        results = engine.detect_enrichment_gaps(df, "material", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["confidence"] == 95


class TestDetectValidationErrors:
    def test_invalid_sa_id(self, engine):
        df = pd.DataFrame({
            "employee_id": ["EMP001"],
            "id_number": ["1234567890123"],
        })
        results = engine.detect_validation_errors(df, "employee", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["category"] == "validation"
        assert results[0]["confidence"] == 95

    def test_invalid_vat(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001"],
            "vat_number": ["9999999999"],  # doesn't start with 4
        })
        results = engine.detect_validation_errors(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["confidence"] == 90

    def test_invalid_bank_branch(self, engine):
        df = pd.DataFrame({
            "partner": ["BP001"],
            "branch_code": ["999999"],
        })
        results = engine.detect_validation_errors(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["confidence"] == 85


class TestDetectLifecycleIssues:
    def test_dormant_record(self, engine):
        old_date = (datetime.now(timezone.utc) - timedelta(days=800)).strftime("%Y-%m-%d")
        df = pd.DataFrame({
            "partner": ["BP001"],
            "last_activity": [old_date],
        })
        results = engine.detect_lifecycle_issues(df, "business_partner", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["category"] == "lifecycle"
        assert results[0]["confidence"] == 70

    def test_terminated_employee_active(self, engine):
        past_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        df = pd.DataFrame({
            "employee_id": ["EMP001"],
            "termination_date": [past_date],
            "status": ["A"],
        })
        results = engine.detect_lifecycle_issues(df, "employee", VERSION_ID, TENANT_ID)
        assert len(results) >= 1
        assert results[0]["confidence"] == 95
        assert "access risk" in str(results[0]["record_data_before"].get("issue", ""))


class TestDetectCandidatesIntegration:
    def test_full_pipeline(self, engine):
        """End-to-end: all categories run without error."""
        df = pd.DataFrame({
            "partner": ["BP001", "BP002"],
            "name": ["Acme PTY LTD", "Unrelated Holdings"],
            "phone": ["0821234567", "+27831234567"],
            "country": ["South Africa", "za"],
            "currency": [None, "ZAR"],
        })
        results = engine.detect_candidates(df, "business_partner", VERSION_ID, TENANT_ID)
        assert isinstance(results, list)
        # Should have at least some standardisation/enrichment hits
        categories = {r.get("category") for r in results}
        assert len(categories) >= 1
