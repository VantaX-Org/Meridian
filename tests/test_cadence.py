"""api/services/cadence.py: the interval of a cron in the tenant's time zone, and freshness against it."""
from datetime import datetime, timedelta, timezone

import pytest

from api.services.cadence import freshness, interval_seconds

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)
H = timedelta(hours=1)


def fresh(last, cron="0 2 * * *", active=True, status="completed", now=NOW, tz="UTC", next_run=None):
    return freshness(last, cron, active, status, now, tz, next_run)


def test_interval_of_common_schedules():
    assert interval_seconds("0 * * * *") == 3600
    assert interval_seconds("*/15 * * * *") == 900
    assert interval_seconds("0 2 * * *") == 86400
    assert interval_seconds("0 6 * * 1") == 7 * 86400


def test_manual_and_invalid_have_no_interval():
    assert interval_seconds(None) is None and interval_seconds("") is None and interval_seconds("  ") is None
    assert interval_seconds("not a cron") is None


def test_weekday_schedule_reads_its_longest_gap():
    # Friday to Monday is 72 h; reading only the next two runs on a Tuesday would say 24 h
    assert interval_seconds("0 9 * * 1-5", "UTC", datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)) == 3 * 86400


def test_interval_follows_the_tenant_time_zone():
    # New York turns its clocks back on 1 Nov 2026: "09:00 daily" has a 25-hour gap there, never in UTC
    before = datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc)
    assert interval_seconds("0 9 * * *", "UTC", before) == 86400
    assert interval_seconds("0 9 * * *", "America/New_York", before) == 25 * 3600
    assert interval_seconds("0 9 * * *", "Not/AZone", before) == 86400  # an unknown zone reads as UTC


def test_stale_only_past_one_and_a_half_intervals():
    assert fresh(NOW - 35 * H) == "fresh"
    assert fresh(NOW - 36 * H - timedelta(seconds=1)) == "stale"
    assert fresh(NOW - 90 * timedelta(minutes=1), "0 * * * *") == "fresh"  # an hourly schedule tolerates two hours
    assert fresh(NOW - 2 * H - timedelta(seconds=1), "0 * * * *") == "stale"
    assert fresh(NOW - timedelta(days=8), "0 6 * * 1") == "fresh" and fresh(NOW - timedelta(days=11), "0 6 * * 1") == "stale"


def test_staleness_uses_the_tenant_time_zone():
    now = datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc)
    last = now - 37 * H  # past 1.5 x 24 h, inside 1.5 x 25 h
    assert fresh(last, "0 9 * * *", now=now, tz="UTC") == "stale"
    assert fresh(last, "0 9 * * *", now=now, tz="America/New_York") == "fresh"


def test_failed_wins_over_stale_and_fresh():
    assert fresh(NOW - 100 * H, status="failed") == "failed"
    assert fresh(NOW - H, status="failed") == "failed"


def test_paused_is_never_stale():
    assert fresh(NOW - 400 * H, active=False) == "paused"
    assert fresh(NOW - 400 * H, active=False, status="failed") == "paused"  # a pause is a decision


def test_manual_has_an_age_but_no_verdict():
    assert fresh(NOW - 900 * H, cron=None) == "manual"
    assert fresh(None, cron=None) == "manual"
    assert fresh(NOW - 900 * H, cron="") == "manual"


def test_never_run_but_scheduled_is_due_not_stale():
    assert fresh(None) == "due"


def test_due_for_fifteen_minutes_after_the_slot():
    assert fresh(NOW - H, "0 * * * *", next_run=NOW - timedelta(minutes=5)) == "due"
    assert fresh(NOW - H, "0 * * * *", next_run=NOW - timedelta(minutes=20)) == "fresh"
    assert fresh(NOW - H, "0 * * * *", next_run=NOW + timedelta(minutes=5)) == "fresh"


def test_naive_timestamps_read_as_utc():
    assert fresh(datetime(2026, 10, 28, 10, 0)) == "fresh"
    assert fresh(datetime(2026, 10, 20, 10, 0)) == "stale"


@pytest.mark.parametrize("cron", ["0 2 * * *", "*/5 * * * *"])
def test_croniter_is_required(cron):
    import croniter  # a hard dependency: no silent 24 h fallback

    assert croniter.croniter.is_valid(cron)
