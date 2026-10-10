"""Extraction waits for a running config load, then proceeds with a flagged baseline."""

from types import SimpleNamespace

import pytest
from celery.exceptions import Retry

from workers.tasks import run_extraction


def _task(retries: int) -> SimpleNamespace:
    return SimpleNamespace(request=SimpleNamespace(retries=retries),
                           retry=lambda countdown, max_retries: Retry(f"in {countdown}s"))


@pytest.mark.parametrize("basis,retries,expected", [
    ("loaded", 0, "loaded"), ("none", 0, "baseline"), ("loading", 50, "baseline"),
])
def test_wait_for_config_returns_the_basis(monkeypatch, basis, retries, expected):
    monkeypatch.setattr("api.services.config_pairing.config_basis", lambda s, sid: basis)
    assert run_extraction.wait_for_config(_task(retries), None, "sys-1") == expected


def test_wait_for_config_retries_while_a_load_runs(monkeypatch):
    monkeypatch.setattr("api.services.config_pairing.config_basis", lambda s, sid: "loading")
    with pytest.raises(Retry, match="in 30s"):
        run_extraction.wait_for_config(_task(3), None, "sys-1")
