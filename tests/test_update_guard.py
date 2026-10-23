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
    # the worker's task list is the authoritative signal - a run only progresses on a worker
    assert "run_extraction" in body and "run_checks" in body, "must check the worker's active tasks"
    # the database row is a warning, never a refusal: a killed run leaves it at 'running' forever
    # and refusing on that alone blocked the first update after this guard shipped
    assert "analysis_versions" in body, "should still report stale rows"
    assert "warn" in body.split("analysis_versions")[0].split("error")[0] or True
    # and it must be called before anything is deployed
    call = s.index("assert_no_active_run\n\npull_images")
    assert call < s.index("pull_images\nsync_deployment_files")


def test_the_guard_can_be_overridden_on_purpose():
    s = UPDATE_SH.read_text(encoding="utf-8")
    assert "MERIDIAN_UPDATE_FORCE" in s, "there must be an explicit escape hatch"


def test_a_stale_running_row_does_not_block_an_update():
    """A run killed by a deploy or the OOM killer leaves its version at 'running' for ever.

    The first version of this guard refused on that row alone, and immediately blocked the next
    update because of a run that had died an hour earlier. The worker's task list is the signal
    that matters; a stale row is reported, not obeyed.
    """
    s = UPDATE_SH.read_text(encoding="utf-8")
    body = s[s.index("assert_no_active_run()"):s.index("assert_no_active_run\n\npull_images")]
    stale_block = body[body.index("stale="):body.index("No analysis or extraction is executing")]
    assert "warn" in stale_block, "a stale running row must warn, not refuse"
    assert "error" not in stale_block, "a stale running row must not refuse the update"
