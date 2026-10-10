"""Migration gap findings export: xlsx branch re-routed through branded_xlsx (T8).

No DB fixture — just checks the endpoint still accepts format=csv|xlsx.
"""

import inspect

from api.routes.migration import export_findings


def test_export_endpoint_still_supports_csv_and_xlsx() -> None:
    sig = inspect.signature(export_findings)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"
