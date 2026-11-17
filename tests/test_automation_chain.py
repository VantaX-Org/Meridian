"""Automation chain (api/routes/automation_chain.py): beat entries to rows, stage mapping, next run, tenant filter."""
from datetime import datetime, timezone
from pathlib import Path

from celery.schedules import crontab

from api.routes.automation_chain import STAGE_OF, STAGES, cron_of, describe


NOW = datetime(2026, 11, 15, 10, 3, tzinfo=timezone.utc)


def test_cron_of_crontab_and_interval():
    assert cron_of(crontab(hour=0, minute=0)) == "0 0 * * *"
    assert cron_of(crontab(minute="*/5")) == "*/5 * * * *"
    assert cron_of(60.0) is None


def test_describe_maps_stage_and_next_run_sorted():
    beat = {
        "daily": {"task": "workers.scheduler.daily_analysis", "schedule": crontab(hour=0, minute=0)},
        "sync": {"task": "workers.scheduler.sync_profile_scheduler", "schedule": crontab(minute="*/5")},
        "other": {"task": "workers.scheduler.reap_orphans", "schedule": 600.0},
    }
    rows = describe(beat, NOW)
    assert [r["key"] for r in rows] == ["sync", "daily", "other"]
    assert rows[0]["stage"] == "extract" and rows[0]["next_run_at"] == "2026-11-15T10:05:00+00:00"
    assert rows[1]["stage"] == "checks" and rows[1]["next_run_at"] == "2026-11-16T00:00:00+00:00"
    assert rows[2]["stage"] == "platform" and rows[2]["next_run_at"] is None


def test_real_beat_schedule_covers_every_stage():
    from workers.scheduler import celery_app
    rows = describe(dict(celery_app.conf.beat_schedule), NOW)
    assert {r["stage"] for r in rows} >= set(STAGES)
    tasks = {r["task"] for r in rows}
    assert set(STAGE_OF) <= tasks, set(STAGE_OF) - tasks


def test_every_stage_query_filters_tenant():
    src = Path("api/routes/automation_chain.py").read_text()
    for table in ("sync_runs", "analysis_versions", "stewardship_queue", "exceptions", "reports", "webhook_deliveries"):
        for m in __import__("re").finditer(rf"FROM {table}\b([^)]*)", src):
            assert "tenant_id = :t" in m.group(1), (table, m.group(0)[:80])
