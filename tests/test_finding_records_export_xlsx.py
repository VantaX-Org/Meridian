"""Finding records export (T9): /versions/{version_id}/findings/{check_id}/records/export.

No DB fixture — checks the endpoint signature only.
"""

import inspect

from api.routes.versions import export_finding_records


def test_export_finding_records_signature() -> None:
    sig = inspect.signature(export_finding_records)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"
    assert "version_id" in sig.parameters
    assert "check_id" in sig.parameters
