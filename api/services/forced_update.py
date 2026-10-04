"""Forced platform update: decide whether this deployment updates itself now.

HQ sets min_version (and optionally force_now for a security release). A
deployment below min_version updates only when no Celery job is running, and
only inside MERIDIAN_UPDATE_WINDOW unless force_now is set. The update itself
is scripts/update.sh via the updater sidecar: pg_dump first, volumes kept,
rollback on a failed health check.
"""

from datetime import datetime

from api.services.version import version_tuple

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def in_window(now: datetime, window: str) -> bool:
    """True when `now` (UTC) is inside `window`: "Sun 02:00-04:00", "02:00-04:00"
    or "" (always). A window that crosses midnight ("22:00-02:00") is allowed;
    its day refers to the start. An unparseable window never matches."""
    window = window.strip()
    if not window:
        return True
    parts = window.split()
    day = None
    if len(parts) == 2:
        day = parts[0][:3].lower()
        if day not in _DAYS:
            return False
    try:
        start_s, end_s = parts[-1].split("-")
        sh, sm = (int(x) for x in start_s.split(":"))
        eh, em = (int(x) for x in end_s.split(":"))
    except ValueError:
        return False
    start, end, cur = sh * 60 + sm, eh * 60 + em, now.hour * 60 + now.minute
    weekday = now.weekday()
    if start <= end:
        return start <= cur < end and (day is None or _DAYS[weekday] == day)
    # Crosses midnight: before midnight counts for the start day, after for the next.
    if cur >= start:
        return day is None or _DAYS[weekday] == day
    if cur < end:
        return day is None or _DAYS[(weekday - 1) % 7] == day
    return False


def decide(min_version: str, current: str, force_now: bool, now: datetime,
           window: str, busy: bool) -> str:
    """"none" | "wait_window" | "wait_jobs" | "go"."""
    min_t, cur_t = version_tuple(min_version or ""), version_tuple(current)
    if not min_version or min_t is None or cur_t is None or cur_t >= min_t:
        return "none"
    if not force_now and not in_window(now, window):
        return "wait_window"
    if busy:
        return "wait_jobs"
    return "go"
