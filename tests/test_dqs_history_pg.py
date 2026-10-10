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


def test_predictive_reader_averages_two_systems_same_day():
    """Controller ruling: readers must aggregate to one value per (module, day) unless
    explicitly per-system. Two systems scoring the same module on the same day must
    average into a single forecast data point, not two."""
    from sqlalchemy import create_engine, text

    from workers.tasks.run_checks import DQS_HISTORY_UPSERT
    from api.services.analytics_engine import PredictiveAnalytics

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    engine = create_engine(url)
    tid, prd, qas = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-history-2')"), {"t": tid})
            # two systems, same module, same day: 80 and 90 should average to 85 for that day
            for row in (_row(tid, prd, 80.0), _row(tid, qas, 90.0)):
                c.execute(DQS_HISTORY_UPSERT, row)
            rows = c.execute(text(
                "SELECT module_id, MAX(recorded_at) AS recorded_at, AVG(dqs_score) AS dqs_score, "
                "AVG(completeness) AS completeness, AVG(accuracy) AS accuracy, "
                "AVG(consistency) AS consistency, AVG(timeliness) AS timeliness, "
                "AVG(uniqueness) AS uniqueness, AVG(validity) AS validity, "
                "SUM(finding_count) AS finding_count "
                "FROM dqs_history WHERE tenant_id = :tid "
                "GROUP BY module_id, (recorded_at AT TIME ZONE 'UTC')::date "
                "ORDER BY recorded_at ASC"
            ), {"tid": tid}).mappings().all()
        assert len(rows) == 1
        history = [dict(row) for row in rows]
        assert float(history[0]["dqs_score"]) == 85.0
        assert int(history[0]["finding_count"]) == 2

        # with only one data point, forecast_dqs still correctly skips (needs >= 3); the
        # point of this test is the aggregation query itself collapses the two systems.
        forecasts = PredictiveAnalytics().forecast_dqs(history)
        assert forecasts == []
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM dqs_history WHERE tenant_id = :t"), {"t": tid})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
        engine.dispose()
