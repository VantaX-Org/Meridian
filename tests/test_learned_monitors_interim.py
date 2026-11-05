"""Learned monitors between full runs: the parts that need no database."""
from api.services.learned_monitors_interim import WINDOW_HOURS, interim_sentence
from workers.scheduler import celery_app


def test_sentence_says_it_is_an_extraction_not_a_finished_run():
    s = interim_sentence(4100.0)
    assert "4,100 rows" in s and "not finished" in s and "not with a finished run" in s


def test_beat_runs_the_interim_check_every_15_minutes_with_time_limits():
    entry = celery_app.conf.beat_schedule["learned-monitor-interim-every-15min"]
    assert entry["task"] == "workers.tasks.learned_monitor_interim.check_interim"
    assert entry["schedule"]._orig_minute == "*/15"
    from workers.tasks.learned_monitor_interim import check_interim
    assert check_interim.soft_time_limit < check_interim.time_limit
    assert WINDOW_HOURS == 72
