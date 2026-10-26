"""Scheduled reports: when a slot is due, in the schedule's own time zone (no database).

Also pins the beat entry, the task time limits, and that every report download route is mapped
to a report kind so its file is kept in the history."""

from __future__ import annotations

from datetime import datetime, time, timezone

import pytest

from api.services import report_history as rh

UTC = timezone.utc


def _n(cadence, at, tz, after, **kw):
    return rh.next_run_at(cadence, at, tz, after, **kw)


def test_daily_is_today_when_still_ahead_else_tomorrow_in_local_time():
    jhb = "Africa/Johannesburg"  # UTC+2, no daylight saving
    assert _n("daily", time(7, 0), jhb, datetime(2026, 10, 26, 4, 0, tzinfo=UTC)) == datetime(2026, 10, 26, 5, 0, tzinfo=UTC)
    # exactly at the slot: the next one (strictly after)
    assert _n("daily", time(7, 0), jhb, datetime(2026, 10, 26, 5, 0, tzinfo=UTC)) == datetime(2026, 10, 27, 5, 0, tzinfo=UTC)
    # 23:30 UTC is already the next local day in Johannesburg
    assert _n("daily", time(7, 0), jhb, datetime(2026, 10, 26, 23, 30, tzinfo=UTC)) == datetime(2026, 10, 27, 5, 0, tzinfo=UTC)


def test_daily_follows_daylight_saving():
    ny = "America/New_York"
    # 08:00 New York is 12:00 UTC in summer (EDT) and 13:00 UTC in winter (EST); DST ends 2026-11-01
    assert _n("daily", time(8, 0), ny, datetime(2026, 10, 31, 13, 0, tzinfo=UTC)) == datetime(2026, 11, 1, 13, 0, tzinfo=UTC)
    assert _n("daily", time(8, 0), ny, datetime(2026, 10, 30, 13, 0, tzinfo=UTC)) == datetime(2026, 10, 31, 12, 0, tzinfo=UTC)


def test_a_wall_time_skipped_by_spring_forward_still_runs_that_day():
    # London skips 01:00-02:00 on 2026-03-29; 01:30 maps forward, never to the next day
    got = _n("daily", time(1, 30), "Europe/London", datetime(2026, 3, 28, 12, 0, tzinfo=UTC))
    assert got.date().isoformat() == "2026-03-29" and got == datetime(2026, 3, 29, 1, 30, tzinfo=UTC)


def test_weekly_lands_on_the_weekday_in_local_time():
    # Monday 2026-10-26; Tuesday 23:00 UTC is Wednesday 01:00 in Johannesburg
    got = _n("weekly", time(6, 0), "Africa/Johannesburg", datetime(2026, 10, 27, 23, 0, tzinfo=UTC), weekday=2)
    assert got == datetime(2026, 10, 28, 4, 0, tzinfo=UTC)  # that same local Wednesday, 06:00 still ahead
    got = _n("weekly", time(6, 0), "Africa/Johannesburg", datetime(2026, 10, 26, 8, 0, tzinfo=UTC), weekday=0)
    assert got == datetime(2026, 11, 2, 4, 0, tzinfo=UTC)
    assert got.astimezone(rh.zone("Africa/Johannesburg")).weekday() == 0


def test_monthly_clamps_to_the_last_day_of_short_months():
    after = datetime(2026, 1, 31, 12, 0, tzinfo=UTC)
    feb = _n("monthly", time(9, 0), "UTC", after, day_of_month=31)
    assert feb == datetime(2026, 2, 28, 9, 0, tzinfo=UTC)
    assert _n("monthly", time(9, 0), "UTC", feb, day_of_month=31) == datetime(2026, 3, 31, 9, 0, tzinfo=UTC)
    # December rolls into January
    assert _n("monthly", time(9, 0), "UTC", datetime(2026, 12, 2, tzinfo=UTC), day_of_month=1) == \
        datetime(2027, 1, 1, 9, 0, tzinfo=UTC)


def test_unknown_zone_falls_back_to_utc_and_unknown_cadence_raises():
    assert _n("daily", time(7, 0), "Not/AZone", datetime(2026, 1, 1, tzinfo=UTC)) == datetime(2026, 1, 1, 7, 0, tzinfo=UTC)
    with pytest.raises(ValueError):
        _n("hourly", time(7, 0), "UTC", datetime(2026, 1, 1, tzinfo=UTC))


def test_schedule_next_reads_a_row():
    row = {"cadence": "weekly", "time_of_day": time(7, 30), "timezone": "Europe/London", "weekday": 4, "day_of_month": None}
    assert rh.schedule_next(row, datetime(2026, 7, 1, tzinfo=UTC)) == datetime(2026, 7, 3, 6, 30, tzinfo=UTC)


def test_descriptions_and_labels_never_show_a_webhook_url():
    assert rh.describe_cadence("weekly", time(7, 0), "UTC", 0) == "Every Monday at 07:00 (UTC)"
    assert rh.describe_cadence("monthly", time(7, 0), "UTC", None, 15) == "Monthly on day 15 at 07:00 (UTC)"
    assert rh.channel_label("slack", "https://hooks.slack.com/services/T/B/secret") == "Slack"
    assert rh.channel_label("email", "jane@example.test") == "Email j***@example.test"


def test_format_and_storage_key():
    assert rh.format_of("a.xlsx") == "xlsx" and rh.format_of("noext", "application/json") == "json"
    assert rh.history_key("t", "f", "a b/../c.pdf") == "history/t/f/a_b_.._c.pdf"


def test_every_download_route_maps_to_a_report_kind():
    from api.routes.reports import HistoryRoute, router

    names = {r.name for r in router.routes if r.name != "report_catalogue"}
    assert names == set(rh.ENDPOINT_KINDS)
    assert all(isinstance(r, HistoryRoute) for r in router.routes)
    assert set(rh.ENDPOINT_KINDS.values()) <= set(rh.REPORT_TYPES)


def test_beat_entry_and_time_limits():
    from workers.celery_app import celery_app
    from workers.tasks import report_schedules as task

    entry = celery_app.conf.beat_schedule["report-schedules-every-15min"]
    assert entry["task"] == "workers.tasks.report_schedules.run_due_report_schedules"
    assert len(entry["schedule"].minute) == 4
    for t in (task.run_due_report_schedules, task.run_report_schedule):
        assert t.soft_time_limit and t.time_limit and t.soft_time_limit < t.time_limit
