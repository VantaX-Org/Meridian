"""How often an object is checked and whether its last check is recent enough.

``sync_profiles.schedule_cron`` is the cadence. Staleness is relative to it: a run is stale once it is older
than 1.5 intervals (never under 2 hours, so an hourly schedule tolerates a late run). Intervals are read in the
tenant's time zone, so a daylight-saving day (23 or 25 hours) does not shift a "daily at 09:00" schedule.
Deterministic; croniter is a hard dependency, a cadence is never guessed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter

Freshness = Literal["fresh", "due", "stale", "failed", "paused", "manual"]

STALE_FACTOR = 1.5
MIN_TOLERANCE_S = 2 * 3600
DUE_WINDOW_S = 15 * 60
# Occurrences read to find the longest gap: a weekday schedule is 24 h apart on Tuesday and 72 h apart on Friday.
_LOOKAHEAD = 8


def _zone(tz: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(tz or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def interval_seconds(cron: Optional[str], tz: Optional[str] = "UTC", now: Optional[datetime] = None) -> Optional[int]:
    """Seconds between runs of ``cron`` in time zone ``tz``: the longest gap among the next occurrences after ``now``.
    None for a manual object (no cron) or an expression croniter rejects."""
    if not cron or not cron.strip() or not croniter.is_valid(cron):
        return None
    it = croniter(cron, _aware(now or datetime.now(timezone.utc)).astimezone(_zone(tz)))
    times = [it.get_next(datetime) for _ in range(_LOOKAHEAD)]
    # timestamps, not datetime subtraction: same-zone aware datetimes subtract by wall clock, hiding a 23/25 h day
    return int(max(b.timestamp() - a.timestamp() for a, b in zip(times, times[1:])))


def freshness(last_run_at: Optional[datetime], cron: Optional[str], active: bool, last_sync_status: Optional[str],
              now: datetime, tz: Optional[str] = "UTC", next_run_at: Optional[datetime] = None) -> Freshness:
    """One of fresh, due, stale, failed, paused, manual.

    paused: the profile is switched off (a pause is a decision, never stale, even after a failed run).
    failed: the latest sync run failed (wins over stale).
    manual: no cron; the age is shown, no verdict is made.
    stale: older than max(1.5 x interval, 2 h). A scheduled object that never ran is due, not stale.
    due: ``next_run_at`` passed less than 15 minutes ago and the run is not yet stale."""
    if not active:
        return "paused"
    if last_sync_status == "failed":
        return "failed"
    interval = interval_seconds(cron, tz, now)
    if interval is None:
        return "manual"
    now = _aware(now)
    if last_run_at is None:
        return "due"
    if (now - _aware(last_run_at)).total_seconds() > max(STALE_FACTOR * interval, MIN_TOLERANCE_S):
        return "stale"
    if next_run_at is not None and timedelta(0) <= now - _aware(next_run_at) < timedelta(seconds=DUE_WINDOW_S):
        return "due"
    return "fresh"
