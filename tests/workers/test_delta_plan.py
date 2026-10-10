"""When a delta may build on the previous version, and from which date."""

from datetime import datetime, timezone

from workers.tasks.run_extraction import delta_plan

NOW = datetime(2026, 10, 10, 1, 0, tzinfo=timezone.utc)


def test_no_baseline_means_a_full_read():
    assert delta_plan(None, NOW, 7) is None
    assert delta_plan({"id": "v0"}, NOW, 7) is None  # no started_at


def test_recent_full_baseline_gives_since_and_full_at():
    b = {"id": "v1", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-09T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) == ("20261008", "2026-10-09T01:00:00+00:00")


def test_delta_baseline_carries_the_last_full_read():
    b = {"id": "v2", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-05T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) == ("20261008", "2026-10-05T01:00:00+00:00")


def test_full_read_older_than_the_limit_forces_a_full_read():
    b = {"id": "v3", "started_at": "2026-10-09T01:00:00+00:00", "delta": {"full_at": "2026-10-01T01:00:00+00:00"}}
    assert delta_plan(b, NOW, 7) is None


def test_versions_before_delta_count_their_start_as_the_full_read():
    assert delta_plan({"id": "v4", "started_at": "2026-10-09T01:00:00+00:00"}, NOW, 7) == \
        ("20261008", "2026-10-09T01:00:00+00:00")
