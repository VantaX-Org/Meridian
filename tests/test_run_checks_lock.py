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

    redis = _Redis()
    # stands in for the OOM killer's SIGKILL: no Python exception handler runs after it
    killed = MagicMock(side_effect=KeyboardInterrupt)
    for _ in range(2):
        with pytest.raises(KeyboardInterrupt):
            _deliver(mod, redis, killed)
    assert killed.call_count == 2
    body = MagicMock()
    out = _deliver(mod, redis, body)
    body.assert_not_called()
    assert out["status"] == "failed"
    _deliver.failed.assert_called_once()
    assert "ran out of memory twice" in _deliver.failed.call_args.args[-1]
    assert redis.store == {}  # the aborted delivery is acknowledged; a re-run starts afresh


def test_completed_runs_do_not_count_as_lost_deliveries():
    from workers.tasks import run_checks as mod

    redis = _Redis()
    body = MagicMock(return_value={"status": "complete"})
    for _ in range(4):
        assert _deliver(mod, redis, body) == {"status": "complete"}
    assert body.call_count == 4 and redis.store == {}
