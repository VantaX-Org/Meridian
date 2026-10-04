from datetime import datetime, timezone

from api.services.forced_update import decide, in_window

SUN_3AM = datetime(2026, 10, 4, 3, 0, tzinfo=timezone.utc)  # a Sunday
MON_3AM = datetime(2026, 10, 5, 3, 0, tzinfo=timezone.utc)


def test_in_window():
    assert in_window(SUN_3AM, "")
    assert in_window(SUN_3AM, "Sun 02:00-04:00")
    assert not in_window(MON_3AM, "Sun 02:00-04:00")
    assert in_window(MON_3AM, "02:00-04:00")
    assert not in_window(MON_3AM, "04:00-05:00")
    assert in_window(MON_3AM, "Sun 22:00-04:00")  # after midnight belongs to Sunday
    assert not in_window(MON_3AM, "garbage")


def test_decide():
    assert decide("", "1.0.0", True, MON_3AM, "", False) == "none"
    assert decide("1.0.0", "1.0.0", True, MON_3AM, "", False) == "none"
    assert decide("v1.2.0", "1.1.9", False, MON_3AM, "Sun 02:00-04:00", False) == "wait_window"
    assert decide("1.2.0", "1.1.9", True, MON_3AM, "Sun 02:00-04:00", False) == "go"
    assert decide("1.2.0", "1.1.9", True, MON_3AM, "", True) == "wait_jobs"
    assert decide("1.2.0", "1.1.9", False, SUN_3AM, "Sun 02:00-04:00", False) == "go"
