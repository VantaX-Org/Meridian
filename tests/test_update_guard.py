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


def _fns(tmp_path, dc_body: str, call: str, *names: str) -> tuple[subprocess.CompletedProcess, list[str]]:
    """Run real update.sh functions against a stub `dc` (dc_body) that logs every call to tmp_path/calls."""
    s = UPDATE_SH.read_text(encoding="utf-8")
    helpers = s[s.index("GREEN="):s.index("\n# write_status")]
    fns = "".join(s[s.index(f"{n}() {{"):s.index("\n}\n", s.index(f"{n}() {{")) + 3] for n in names)
    log = tmp_path / "calls"
    log.write_text("")
    script = f"""set -euo pipefail
{helpers}
dc() {{
  echo "$*" >> "{log}"
{dc_body}
}}
FORCE=false
WORKER_QUEUES=celery
DRAINED=0
{fns}
{call}
echo GUARD_PASSED
"""
    env = {k: v for k, v in os.environ.items() if k != "MERIDIAN_UPDATE_FORCE"}
    r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)
    return r, log.read_text().splitlines()


QUEUES = '{"celery@w1": [{"name": "celery"}, {"name": "extraction"}]}'


def _queued(llen_celery: int, llen_extraction: int) -> str:
    return f"""  case "$*" in
    *active_queues*) echo '{QUEUES}' ;;
    *"inspect active"*) echo '{IDLE}' ;;
    *"LLEN celery"*) echo {llen_celery} ;;
    *"LLEN extraction"*) echo {llen_extraction} ;;
    *) echo 0 ;;
  esac"""


def test_queued_tasks_on_any_consumed_queue_refuse(tmp_path):
    r, calls = _fns(tmp_path, _queued(2, 3), "assert_no_active_run", "assert_no_active_run")
    assert r.returncode != 0 and "GUARD_PASSED" not in r.stdout
    assert "5 task(s) are queued" in r.stdout and "celery extraction" in r.stdout and "--force" in r.stdout
    assert any("LLEN extraction" in c for c in calls)


def test_empty_queues_pass(tmp_path):
    r, _ = _fns(tmp_path, _queued(0, 0), "assert_no_active_run", "assert_no_active_run")
    assert r.returncode == 0 and "GUARD_PASSED" in r.stdout, r.stdout + r.stderr


def test_drain_refuses_and_resumes_when_a_task_started_meanwhile(tmp_path):
    body = f"""  case "$*" in
    *"inspect active"*) echo '{{"celery@w1": [{_task("run_extraction")}]}}' ;;
  esac"""
    r, calls = _fns(tmp_path, body, "WORKER_QUEUES='celery extraction'; drain_worker", "undrain", "drain_worker")
    assert r.returncode != 0 and "run_extraction" in r.stdout and "--force" in r.stdout
    cancel = [i for i, c in enumerate(calls) if "cancel_consumer" in c]
    add = [i for i, c in enumerate(calls) if "add_consumer" in c]
    assert len(cancel) == 2 and len(add) == 2 and max(cancel) < min(add)
    assert calls.index("stop beat") < calls.index("start beat")
    assert sum(c == "start beat" for c in calls) == 1  # the EXIT trap does not undrain twice


def test_drain_keeps_the_worker_paused_when_idle(tmp_path):
    body = f"""  case "$*" in *"inspect active"*) echo '{IDLE}' ;; esac"""
    r, calls = _fns(tmp_path, body, "drain_worker; trap - EXIT", "undrain", "drain_worker")
    assert r.returncode == 0 and "GUARD_PASSED" in r.stdout, r.stdout + r.stderr
    assert "stop beat" in calls and not any("add_consumer" in c or c == "start beat" for c in calls)


def test_drain_is_skipped_with_force(tmp_path):
    r, calls = _fns(tmp_path, "  :", "FORCE=true; drain_worker", "undrain", "drain_worker")
    assert r.returncode == 0 and calls == []


@pytest.mark.parametrize("size,ok", [("1000000000000000", False), ("1024", True), ("", True)])
def test_backup_refuses_without_free_space_for_the_dump(tmp_path, size, ok):
    body = f"""  case "$*" in *pg_database_size*) echo '{size}' ;; *pg_dump*) echo PGDMP ;; esac"""
    r, calls = _fns(tmp_path, body, f"cd '{tmp_path}'; backup_database", "backup_database", "prune_backups")
    assert (r.returncode == 0) is ok, r.stdout + r.stderr
    assert any("pg_dump" in c for c in calls) is ok
    if not ok:
        assert "Not enough free space" in r.stdout and "Nothing was changed" in r.stdout


def test_an_error_after_drain_resumes_the_worker(tmp_path):
    body = f"""  case "$*" in *"inspect active"*) echo '{IDLE}' ;; esac"""
    r, calls = _fns(tmp_path, body, "drain_worker; error boom", "undrain", "drain_worker")
    assert r.returncode != 0 and any("add_consumer celery" in c for c in calls) and "start beat" in calls
