"""ExtractionTarget.from_date: backward-compat default, and wiring through
ConnectivityManager._extract_target to the SuccessFactors connector's OData
fromDate param (so EmpJob history is pulled as "all records", not just the
current effective record)."""
from dataclasses import fields

from api.services.connectivity_manager import ConnectivityManager
from sap.extraction_registry import SF_EXTRACTIONS, ExtractionTarget


def test_from_date_defaults_to_none():
    """Existing targets that never set from_date keep today's-record-only behaviour."""
    assert ExtractionTarget(source="X", fields=["a"]).from_date is None
    assert "from_date" in {f.name for f in fields(ExtractionTarget)}


def test_empjob_target_requests_full_history():
    emp_job = next(t for t in SF_EXTRACTIONS["employee_central"] if t.source == "EmpJob")
    assert emp_job.from_date == "1900-01-01"


def test_extract_target_passes_from_date_to_successfactors_connector():
    calls = []

    class FakeConnector:
        def read_entity_set(self, source, select=None, filter_expr=None, top=0, from_date=None):
            calls.append(from_date)
            return __import__("pandas").DataFrame()

    mgr = ConnectivityManager.__new__(ConnectivityManager)
    target = ExtractionTarget(source="EmpJob", fields=["userId"], from_date="1900-01-01")
    mgr._extract_target(FakeConnector(), "successfactors", target, max_rows=0)
    assert calls == ["1900-01-01"]

    calls.clear()
    default_target = ExtractionTarget(source="EmpEmployment", fields=["userId"])
    mgr._extract_target(FakeConnector(), "successfactors", default_target, max_rows=0)
    assert calls == [None]
