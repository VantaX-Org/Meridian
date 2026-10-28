"""Per-L1 process discovery health: fitness drift, freshness, never-run L1s (no database)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from api.services.process_discovery.health import fitness_drift, l1_health

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def _run(rid: str, status: str = "completed", fitness: float | None = 0.9, age_h: float = 1) -> dict:
    return {"id": rid, "status": status, "fitness": fitness, "finished_at": NOW - timedelta(hours=age_h)}


def _sched(cron: str = "0 * * * *", active: bool = True, nxt: datetime | None = None) -> dict:
    return {"id": "s1", "schedule_cron": cron, "active": active, "next_run_at": nxt or NOW + timedelta(minutes=30)}


def test_fitness_drift_is_latest_minus_previous() -> None:
    h = l1_health("PTP", [_run("b", fitness=0.82, age_h=1), _run("a", fitness=0.9, age_h=25)], None, NOW, "UTC")
    assert h.last_run.fitness == 0.82 and h.previous_fitness == 0.9
    assert h.fitness_drift == -0.08
    assert fitness_drift(0.9, None) is None and fitness_drift(None, 0.9) is None


def test_one_mined_run_has_no_drift() -> None:
    h = l1_health("PTP", [_run("a", fitness=0.9)], None, NOW, "UTC")
    assert h.fitness_drift is None and h.previous_fitness is None and h.last_run.fitness == 0.9


def test_runs_without_fitness_are_skipped_for_drift() -> None:
    # a reference-coverage run completes without a conformance block
    runs = [_run("c", fitness=0.7, age_h=1), _run("r", fitness=None, age_h=5), _run("a", fitness=0.8, age_h=9)]
    h = l1_health("PTP", runs, None, NOW, "UTC")
    assert h.previous_fitness == 0.8 and h.fitness_drift == -0.1


def test_failed_last_run_wins_freshness_and_carries_no_fitness() -> None:
    runs = [_run("f", status="failed", fitness=None, age_h=0.5), _run("a", fitness=0.9, age_h=2),
            _run("z", fitness=0.85, age_h=30)]
    h = l1_health("PTP", runs, _sched(), NOW, "UTC")
    assert h.freshness == "failed" and h.last_run.status == "failed" and h.last_run.fitness is None
    assert h.fitness_drift == 0.05  # between the two latest completed runs


def test_freshness_follows_the_schedule() -> None:
    fresh = l1_health("PTP", [_run("a", age_h=1)], _sched(), NOW, "UTC")
    assert fresh.freshness == "fresh" and fresh.schedule.cron == "0 * * * *"
    assert l1_health("PTP", [_run("a", age_h=5)], _sched(), NOW, "UTC").freshness == "stale"
    assert l1_health("PTP", [_run("a", age_h=5)], _sched(active=False), NOW, "UTC").freshness == "paused"
    assert l1_health("PTP", [_run("a", age_h=500)], None, NOW, "UTC").freshness == "manual"
    due = l1_health("PTP", [_run("a", age_h=1)], _sched(nxt=NOW - timedelta(minutes=5)), NOW, "UTC")
    assert due.freshness == "due"


def test_never_run_l1() -> None:
    unscheduled = l1_health("OTC", [], None, NOW, "UTC")
    assert unscheduled.last_run is None and unscheduled.schedule is None
    assert unscheduled.fitness_drift is None and unscheduled.freshness == "manual"
    assert l1_health("OTC", [], _sched(), NOW, "UTC").freshness == "due"  # scheduled, nothing yet: due, not stale
