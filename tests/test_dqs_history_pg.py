"""dqs_history keeps one row per tenant, system (or upload), module and UTC day; the
latest run of the day wins (workers/tasks/run_checks.DQS_HISTORY_UPSERT, migration 067).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py); skipped otherwise."""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


def _row(tid, system_id, score):
    return {"tenant_id": tid, "system_id": system_id, "module_id": "accounts_payable", "dqs_score": score,
            "completeness": score, "accuracy": 0, "consistency": 0, "timeliness": 0, "uniqueness": 0,
            "validity": 0, "finding_count": 1}


def test_upsert_per_system_latest_of_day_wins():
    from sqlalchemy import create_engine, text

    from workers.tasks.run_checks import DQS_HISTORY_UPSERT

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    engine = create_engine(url)
    tid, prd, qas = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-history')"), {"t": tid})
            for row in (_row(tid, prd, 80.0), _row(tid, prd, 85.0), _row(tid, qas, 70.0),
                        _row(tid, None, 60.0), _row(tid, None, 61.0)):
                c.execute(DQS_HISTORY_UPSERT, row)
            got = c.execute(text("SELECT COALESCE(system_id::text, 'upload'), dqs_score, completeness "
                                 "FROM dqs_history WHERE tenant_id = :t ORDER BY 2"), {"t": tid}).fetchall()
        assert [(s, float(d), float(cp)) for s, d, cp in got] == [
            ("upload", 61.0, 61.0), (qas, 70.0, 70.0), (prd, 85.0, 85.0)]
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM dqs_history WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
        engine.dispose()


def test_reader_aggregates_three_days_two_systems():
    """Controller ruling: readers must aggregate to one value per (module, day) unless
    explicitly per-system. Exercises the real shared aggregation SQL
    (api.services.analytics_engine.DQS_HISTORY_DAILY_SQL) used by analytics.py,
    report_pdf.py and scheduler.py directly, not a copy of it — if that query is reverted
    to an un-aggregated per-row SELECT, this test fails. Two systems scoring the same
    module on each of three different UTC days must collapse into exactly three points."""
    from sqlalchemy import create_engine, text

    from workers.tasks.run_checks import DQS_HISTORY_UPSERT
    from api.services.analytics_engine import DQS_HISTORY_DAILY_SQL, PredictiveAnalytics

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    engine = create_engine(url)
    tid, prd, qas = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    # 3 UTC days x 2 systems; each day's two systems must average into one data point.
    days = [(-2, 60.0, 80.0), (-1, 70.0, 90.0), (0, 80.0, 100.0)]
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-history-3')"), {"t": tid})
            for offset, prd_score, qas_score in days:
                c.execute(DQS_HISTORY_UPSERT, _row(tid, prd, prd_score))
                c.execute(DQS_HISTORY_UPSERT, _row(tid, qas, qas_score))
                if offset != 0:
                    # move today's pair back by `offset` days so the next pair (inserted at
                    # "now") doesn't collide with it on the per-day upsert conflict target
                    c.execute(text(
                        "UPDATE dqs_history SET recorded_at = recorded_at + make_interval(days => :off) "
                        "WHERE tenant_id = :t AND system_id IN (:prd, :qas) "
                        "AND (recorded_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date"
                    ), {"off": offset, "t": tid, "prd": prd, "qas": qas})

            rows = c.execute(text(DQS_HISTORY_DAILY_SQL.format(module_filter="")),
                              {"tid": tid}).mappings().all()
        history = [dict(row) for row in rows]
        assert len(history) == 3
        assert [round(float(h["dqs_score"]), 1) for h in history] == [70.0, 80.0, 90.0]
        assert all(int(h["finding_count"]) == 2 for h in history)

        forecasts = PredictiveAnalytics().forecast_dqs(history)
        assert len(forecasts) == 1
        assert forecasts[0]["module_id"] == "accounts_payable"
        assert forecasts[0]["points"] == 3
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM dqs_history WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
        engine.dispose()
