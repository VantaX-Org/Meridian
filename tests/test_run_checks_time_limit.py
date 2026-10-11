"""A run_checks task that hits its soft time limit must end with the version marked
'failed'. The engine used to turn SoftTimeLimitExceeded into a rule error and run
on, so the hard limit killed the worker with the version still 'running'."""

from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from checks.runner import run_checks as engine_run_checks
from tests.checks.test_runner import _make_bp_dataframe


def test_engine_does_not_swallow_the_soft_time_limit() -> None:
    from checks.types.null_check import NullCheck

    with patch.object(NullCheck, "evaluate", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks("business_partner", _make_bp_dataframe(20), "t1")


def test_soft_time_limit_marks_the_version_failed() -> None:
    from workers.tasks import run_checks as mod

    engine = MagicMock()
    engine.connect.return_value.execute.return_value.scalar.return_value = True  # lock acquired
    with patch.object(mod, "get_sync_engine", return_value=engine), \
            patch.object(mod, "_run_checks", side_effect=SoftTimeLimitExceeded()), \
            patch.object(mod, "_redis_client", return_value=None), \
            patch.object(mod, "_mark_failed") as failed:
        mod.run_checks.push_request(id="task-1")
        try:
            with pytest.raises(SoftTimeLimitExceeded):
                mod.run_checks.run("v1", "t1", "path")
        finally:
            mod.run_checks.pop_request()
    failed.assert_called_once()
    assert failed.call_args.args[1:3] == ("t1", "v1")
    assert "time limit" in failed.call_args.args[3]
