from unittest.mock import MagicMock, patch


def test_run_checks_skips_version_already_running():
    from workers.tasks import run_checks as mod

    engine = MagicMock()
    engine.connect.return_value.execute.return_value.scalar.return_value = False  # lock held elsewhere
    with patch.object(mod, "get_sync_engine", return_value=engine), patch.object(mod, "_run_checks") as body:
        out = mod.run_checks.run("v1", "t1", "path")
    assert out == {"version_id": "v1", "status": "already_running"}
    body.assert_not_called()
    engine.connect.return_value.close.assert_called_once()
