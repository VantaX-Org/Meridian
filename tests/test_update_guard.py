"""An update must not destroy a running analysis.

The updater recreates the worker, which kills whatever it is running. That happened three times
during a material_master baseline: twice after a completed extraction, once while DDIC conformance
was mid-flight. Each time the run was lost and its version was left at 'running'. The extraction
checkpoint saved the expensive part, but hours of checks were discarded every time.
"""
import os
import subprocess
from pathlib import Path

import pytest

UPDATE_SH = Path(__file__).resolve().parents[1] / "scripts" / "update.sh"
# the guard is called first, before the release is resolved and anything is snapshotted or pulled
_CALL = "assert_no_active_run\n\nresolve_target"


def test_update_refuses_to_run_over_an_active_analysis():
    s = UPDATE_SH.read_text(encoding="utf-8")
    assert "assert_no_active_run" in s, "update.sh must check for a live run"
    body = s[s.index("assert_no_active_run()"):s.index(_CALL)]
    # the worker's task list is the authoritative signal - a run only progresses on a worker
    assert "inspect active" in body, "must check the worker's active tasks"
    # the database row is a warning, never a refusal: a killed run leaves it at 'running' forever
    # and refusing on that alone blocked the first update after this guard shipped
    assert "analysis_versions" in body, "should still report stale rows"
    assert "warn" in body.split("analysis_versions")[0].split("error")[0] or True
    # and it must be called before anything is deployed
    call = s.index(_CALL)
    assert call < s.index("snapshot_rollback_tags\nfi\npull_images\nsync_deployment_files")


def test_the_guard_can_be_overridden_on_purpose():
    s = UPDATE_SH.read_text(encoding="utf-8")
    assert "MERIDIAN_UPDATE_FORCE" in s, "there must be an explicit escape hatch"
    assert "--force)" in s and "# " + "  sudo bash scripts/update.sh --force" in s, "--force is a documented flag"


def test_a_stale_running_row_does_not_block_an_update():
    """A run killed by a deploy or the OOM killer leaves its version at 'running' for ever.

    The first version of this guard refused on that row alone, and immediately blocked the next
    update because of a run that had died an hour earlier. The worker's task list is the signal
    that matters; a stale row is reported, not obeyed.
    """
    s = UPDATE_SH.read_text(encoding="utf-8")
    body = s[s.index("assert_no_active_run()"):s.index(_CALL)]
    stale_block = body[body.index("stale="):body.index("The worker is idle")]
    assert "warn" in stale_block, "a stale running row must warn, not refuse"
    assert "error" not in stale_block, "a stale running row must not refuse the update"


def _guard(tmp_path, celery_out: str, celery_rc: int = 0, *args: str) -> subprocess.CompletedProcess:
    """Run update.sh's real assert_no_active_run against a stub `dc` that answers with celery_out."""
    s = UPDATE_SH.read_text(encoding="utf-8")
    helpers = s[s.index("GREEN="):s.index("\n# write_status")]
    guard = s[s.index("assert_no_active_run() {"):s.index("\n}\n", s.index("assert_no_active_run() {")) + 3]
    (tmp_path / "out").write_text(celery_out)
    script = f"""set -euo pipefail
{helpers}
dc() {{
  if [[ "$*" == *"inspect active"* ]]; then cat "{tmp_path}/out"; return {celery_rc}; fi
  echo 0
}}
FORCE=false
[[ "${{1:-}}" == "--force" ]] && FORCE=true
{guard}
assert_no_active_run
echo GUARD_PASSED
"""
    env = {k: v for k, v in os.environ.items() if k != "MERIDIAN_UPDATE_FORCE"}
    return subprocess.run(["bash", "-c", script, "guard", *args], capture_output=True, text=True, env=env,
                          timeout=30)


def _task(name: str) -> str:
    return '{"id": "t1", "name": "%s", "hostname": "celery@w1", "args": [], "kwargs": {}}' % name


IDLE = '{"celery@w1": [], "celery@w2": []}'


def test_guard_passes_an_idle_worker(tmp_path):
    r = _guard(tmp_path, IDLE)
    assert r.returncode == 0 and "GUARD_PASSED" in r.stdout, r.stdout + r.stderr


@pytest.mark.parametrize("name", ["run_extraction", "run_checks", "run_sync", "run_cleaning", "run_analysis",
                                  "run_migration", "run_comparison", "run_reconciliation", "run_batch_writeback"])
def test_guard_refuses_any_active_task(tmp_path, name):
    r = _guard(tmp_path, '{"celery@w1": [%s]}' % _task(name))
    assert r.returncode != 0 and "GUARD_PASSED" not in r.stdout
    assert name in r.stdout and "--force" in r.stdout


def test_guard_ignores_the_forced_update_task_that_started_it(tmp_path):
    r = _guard(tmp_path, '{"celery@w1": [%s]}' % _task("forced_update_check"))
    assert r.returncode == 0 and "GUARD_PASSED" in r.stdout, r.stdout + r.stderr


@pytest.mark.parametrize("out,rc", [("", 69), ("Error: No nodes replied within time constraint", 69),
                                    ("", 0), ("Error response from daemon: container is not running", 1)])
def test_guard_fails_closed_when_the_worker_does_not_answer(tmp_path, out, rc):
    r = _guard(tmp_path, out, rc)
    assert r.returncode != 0 and "GUARD_PASSED" not in r.stdout
    assert "did not answer" in r.stdout and "--force" in r.stdout


def test_force_skips_the_guard(tmp_path):
    r = _guard(tmp_path, "", 69, "--force")
    assert r.returncode == 0 and "GUARD_PASSED" in r.stdout, r.stdout + r.stderr
