"""An update must not destroy a running analysis.

The updater recreates the worker, which kills whatever it is running. That happened three times
during a material_master baseline: twice after a completed extraction, once while DDIC conformance
was mid-flight. Each time the run was lost and its version was left at 'running'. The extraction
checkpoint saved the expensive part, but hours of checks were discarded every time.
"""
from pathlib import Path

import pytest

UPDATE_SH = Path(__file__).resolve().parents[1] / "scripts" / "update.sh"


def test_update_refuses_to_run_over_an_active_analysis():
    s = UPDATE_SH.read_text(encoding="utf-8")
    assert "assert_no_active_run" in s, "update.sh must check for a live run"
    body = s[s.index("assert_no_active_run()"):s.index("assert_no_active_run\n\npull_images")]
    # the guard must look at both signals: the version table and the worker's own task list
    assert "analysis_versions" in body, "must check the version table"
    assert "status IN" in body, "must look for running versions"
    assert "run_extraction" in body and "run_checks" in body, "must check the worker's active tasks"
    # and it must be called before anything is deployed
    call = s.index("assert_no_active_run\n\npull_images")
    assert call < s.index("pull_images\nsync_deployment_files")


def test_the_guard_can_be_overridden_on_purpose():
    s = UPDATE_SH.read_text(encoding="utf-8")
    assert "MERIDIAN_UPDATE_FORCE" in s, "there must be an explicit escape hatch"
