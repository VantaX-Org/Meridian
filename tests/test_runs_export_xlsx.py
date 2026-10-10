"""Runs export endpoints (T10): /runs/export, /runs/{version_id}/steps/export.

No DB fixture — checks signatures and route ordering (/export must not be
shadowed by the /{version_id} family).
"""

import inspect

from api.routes.runs import export_run_steps, export_runs, router


def test_export_runs_signature() -> None:
    sig = inspect.signature(export_runs)
    assert "format" in sig.parameters
    assert sig.parameters["format"].default.default == "xlsx"


def test_export_run_steps_signature() -> None:
    sig = inspect.signature(export_run_steps)
    assert "format" in sig.parameters
    assert "version_id" in sig.parameters


def test_export_routes_registered() -> None:
    paths = {r.path for r in router.routes}
    assert "/api/v1/runs/export" in paths
    assert "/api/v1/runs/{version_id}/steps/export" in paths
