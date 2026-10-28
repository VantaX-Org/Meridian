from unittest.mock import MagicMock, patch

import pytest


def test_run_checks_skips_version_already_running():
    from workers.tasks import run_checks as mod

    engine = MagicMock()
    engine.connect.return_value.execute.return_value.scalar.return_value = False  # lock held elsewhere
    with patch.object(mod, "get_sync_engine", return_value=engine), patch.object(mod, "_run_checks") as body:
        out = mod.run_checks.run("v1", "t1", "path")
    assert out == {"version_id": "v1", "status": "already_running"}
    body.assert_not_called()
    engine.connect.return_value.close.assert_called_once()


class _Redis:
    """The INCR / EXPIRE / DELETE subset of a redis client."""

    def __init__(self) -> None:
        self.store: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def expire(self, key: str, seconds: int) -> bool:
        return True

    def delete(self, key: str) -> int:
        return int(self.store.pop(key, None) is not None)


def _deliver(mod, redis: _Redis, body: MagicMock) -> dict:
    engine = MagicMock()
    engine.connect.return_value.execute.return_value.scalar.return_value = True  # lock acquired
    with patch.object(mod, "get_sync_engine", return_value=engine), patch.object(mod, "_run_checks", body), \
            patch.object(mod, "_redis_client", return_value=redis), patch.object(mod, "_mark_failed") as failed:
        mod.run_checks.push_request(id="task-1")
        try:
            out = mod.run_checks.run("v1", "t1", "path")
        finally:
            mod.run_checks.pop_request()
    _deliver.failed = failed
    return out


def test_third_delivery_after_two_lost_workers_fails_the_job_without_running():
    from workers.tasks import run_checks as mod

    # the OOM killer's SIGKILL runs no Python handler: each lost delivery leaves its count
    redis = _Redis()
    redis.store[mod._delivery_key("task-1")] = 2
    body = MagicMock()
    out = _deliver(mod, redis, body)
    body.assert_not_called()
    assert out["status"] == "failed"
    _deliver.failed.assert_called_once()
    assert "worker lost 2 times" in _deliver.failed.call_args.args[-1]
    assert redis.store == {}  # the aborted delivery is acknowledged; a re-run starts afresh


@pytest.mark.parametrize("stop", [SystemExit, KeyboardInterrupt, RuntimeError])
def test_a_run_ended_by_any_exception_is_not_a_lost_delivery(stop: type[BaseException]):
    from workers.tasks import run_checks as mod

    redis = _Redis()
    with pytest.raises(stop):
        _deliver(mod, redis, MagicMock(side_effect=stop))
    assert redis.store == {}


def test_completed_runs_do_not_count_as_lost_deliveries():
    from workers.tasks import run_checks as mod

    redis = _Redis()
    body = MagicMock(return_value={"status": "complete"})
    for _ in range(4):
        assert _deliver(mod, redis, body) == {"status": "complete"}
    assert body.call_count == 4 and redis.store == {}


def test_a_queued_run_is_never_dropped_for_waiting_on_the_checks_slot():
    """Waiting for the single checks slot is not a failure and must not be capped.

    The wait retries this task for as long as another run holds the slot, which is
    hours for a large object (material_master took 3.5 h). Celery's ``retry()``
    ignores a call-site ``max_retries=None`` and falls back to the task's own
    attribute, so if that attribute is finite the wait exhausts it and the queued
    run dies with MaxRetriesExceededError — the version then sits at "pending"
    forever with nothing left in the queue to run it. Two runs were lost exactly
    that way while material_master held the slot.
    """
    from workers.tasks import run_checks as mod

    assert mod.run_checks.max_retries is None

    # the slot-wait path itself still retries rather than failing the version
    engine = MagicMock()
    engine.connect.return_value.execute.return_value.scalar.return_value = True
    with patch.object(mod, "get_sync_engine", return_value=engine), \
            patch.object(mod, "_CHECKS_SLOTS", 0), \
            patch.object(mod, "_run_checks") as body, \
            patch.object(mod.run_checks, "retry", side_effect=mod.run_checks.MaxRetriesExceededError) as retry:
        mod.run_checks.push_request(id="task-queued")
        try:
            with pytest.raises(mod.run_checks.MaxRetriesExceededError):
                mod.run_checks.run("v1", "t1", "path")
        finally:
            mod.run_checks.pop_request()
    body.assert_not_called()  # never started; it only ever waited
    assert retry.call_args.kwargs["countdown"] == mod._SLOT_WAIT_S

def test_the_run_ceiling_clears_the_issue_lifecycle_and_stays_configurable():
    """The limit has to clear the whole run, and the tail is the issue lifecycle.

    On a pilot customer's sandbox the ECC system needed over 5 h 50 m in
    api/services/record_issues.py::track (2.78M record_issues rows) and was killed at
    the old 6 h default, leaving a `partial` version whose scores were never written
    out even though all four modules had finished. The default must leave headroom
    above that, and a deployment whose largest object needs longer must be able to
    say so.
    """
    from workers.tasks import run_checks as mod

    assert mod._CHECKS_LIMIT >= 12 * 3600, f"default ceiling is {mod._CHECKS_LIMIT}s"
    # the task carries the limit, with the hard kill one minute behind the soft one
    assert mod.run_checks.soft_time_limit == mod._CHECKS_LIMIT
    assert mod.run_checks.time_limit == mod._CHECKS_LIMIT + 60

    # and the environment overrides it (checked in a subprocess so this module's
    # import-time constant is never mutated for the rest of the suite)
    import os
    import subprocess
    import sys

    out = subprocess.run(
        [sys.executable, "-c",
         "import workers.tasks.run_checks as m; print(m._CHECKS_LIMIT)"],
        capture_output=True, text=True, check=True,
        env={**os.environ, "MERIDIAN_CHECKS_TIME_LIMIT": "7200"})
    assert out.stdout.strip() == "7200", out
