"""Live run events: workers publish {type, step, pct} on events:{tenant}:{version} (api/routes/events.py reads it)."""
from __future__ import annotations

import json

import pytest

from api.services import run_events
from workers.tasks import run_checks

TENANT, VERSION = "t-1", "v-1"
CHANNEL = f"events:{TENANT}:{VERSION}"


class FakeRedis:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[tuple[str, dict]] = []
        self.fail = fail

    def publish(self, channel: str, message: str) -> int:
        if self.fail:
            raise ConnectionError("redis is down")
        self.sent.append((channel, json.loads(message)))
        return 1


@pytest.fixture
def redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr(run_events, "_redis_client", lambda: r)
    return r


def test_progress_event_goes_to_the_runs_channel(redis):
    run_events.publish_run_event(TENANT, VERSION, "progress", "Running data quality checks", 37)
    assert redis.sent == [(CHANNEL, {"type": "progress", "event": "progress", "step": "Running data quality checks", "pct": 37})]


def test_complete_and_failed_name_the_sse_events_that_close_the_stream(redis):
    run_events.publish_run_event(TENANT, VERSION, "complete", "Analysis complete", 100)
    run_events.publish_run_event(TENANT, VERSION, "failed", "Data quality checks failed")
    (_, done), (_, failed) = redis.sent
    assert done["type"] == "complete" and done["event"] == "complete" and done["pct"] == 100
    assert failed["type"] == "failed" and failed["event"] == "error" and "pct" not in failed
    # events.py closes the stream on these SSE event names
    assert {done["event"], failed["event"]} <= {"complete", "error", "cancelled"}


def test_pct_is_clamped(redis):
    run_events.publish_run_event(TENANT, VERSION, "progress", "x", 140)
    assert redis.sent[0][1]["pct"] == 100


def test_no_redis_and_a_failing_redis_never_raise(monkeypatch):
    monkeypatch.setattr(run_events, "_redis_client", lambda: None)
    run_events.publish_run_event(TENANT, VERSION, "progress", "x", 1)
    monkeypatch.setattr(run_events, "_redis_client", lambda: FakeRedis(fail=True))
    run_events.publish_run_event(TENANT, VERSION, "progress", "x", 1)

    def boom():
        raise RuntimeError("no client")
    monkeypatch.setattr(run_events, "_redis_client", boom)
    run_events.publish_run_event(TENANT, VERSION, "failed", "x")


def test_progress_write_maps_the_status_and_computes_the_percent(redis):
    run_events.publish_progress_write(TENANT, VERSION, status="processing", current_step="Running data quality checks",
                                      step_number=3, total_steps=6, rows_processed=500, total_rows=1000)
    run_events.publish_progress_write(TENANT, VERSION, status="completed", current_step="Analysis complete", step_number=6)
    run_events.publish_progress_write(TENANT, VERSION, status="failed", current_step="Data quality checks failed",
                                      error="boom")
    run_events.publish_progress_write(TENANT, VERSION, current_step="DDIC conformance", step_number=3, total_steps=6,
                                      percent_complete=64)
    kinds = [m["type"] for _, m in redis.sent]
    assert kinds == ["progress", "complete", "failed", "progress"]
    assert redis.sent[0][1]["pct"] == 41  # step 3 of 6 starts at 33, half of a 16-point step on top
    assert redis.sent[1][1]["pct"] == 100
    assert redis.sent[3][1]["pct"] == 64
    assert "error" not in redis.sent[2][1]  # no error text on the wire, only the step


def test_run_checks_writes_progress_and_the_event_together(redis, monkeypatch):
    written: list[tuple[str, dict]] = []
    monkeypatch.setattr(run_checks, "update_task_progress", lambda vid, **kw: written.append((vid, kw)))
    run_checks._progress(TENANT, VERSION, status="processing", current_step="Running data quality checks",
                         step_number=3, total_steps=6)
    assert written[0][0] == VERSION and written[0][1]["step_number"] == 3
    assert redis.sent[0][0] == CHANNEL and redis.sent[0][1]["type"] == "progress"


def test_run_checks_progress_survives_redis_down(monkeypatch):
    written: list[str] = []
    monkeypatch.setattr(run_checks, "update_task_progress", lambda vid, **kw: written.append(vid))
    monkeypatch.setattr(run_events, "_redis_client", lambda: FakeRedis(fail=True))
    run_checks._progress(TENANT, VERSION, status="failed", current_step="x", error="boom")
    assert written == [VERSION]
