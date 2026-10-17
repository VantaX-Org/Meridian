"""Operations analytics read the cleaning queue as per-stage aggregates (one grouped query, no
row load), and mdm-health binds its window as an interval that asyncpg accepts."""

import os
import re
import uuid
from types import SimpleNamespace

import pytest

from api.routes import analytics
from api.services.analytics_engine import OperationalAnalytics


class _Res:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def all(self):
        return self._rows


class _FakeDB:
    """Answers the grouped queue query; refuses any query that would load queue rows one by one."""

    def __init__(self, stages):
        self.stages, self.calls = stages, []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "cleaning_queue" in sql:
            assert "GROUP BY status" in sql, "the queue must be aggregated in SQL"
            return _Res(self.stages)
        return _Res([])


TENANT = SimpleNamespace(id=uuid.uuid4())
STAGES = [("approved", 3, 300.0), ("detected", 61906, 61906 * 4.0)]


def test_stage_totals_give_the_same_bottlenecks_as_rows():
    rows = [{"status": "detected", "age_hours": 4.0}] * 60 + [{"status": "approved", "age_hours": 100.0}] * 3
    ops = OperationalAnalytics()
    stages = {"detected": {"count": 60, "total_age": 240.0}, "approved": {"count": 3, "total_age": 300.0}}
    assert ops.bottlenecks_from_stages(stages) == ops.identify_bottlenecks(rows)


@pytest.mark.asyncio
async def test_bottlenecks_route_aggregates_the_queue():
    db = _FakeDB(STAGES)
    out = await analytics.get_bottlenecks(db=db, tenant=TENANT)
    assert out["total_queue_size"] == 61909
    detected = next(b for b in out["bottlenecks"] if b["stage"] == "detected")
    assert detected["count"] == 61906 and detected["avg_age_hours"] == 4.0
    approved = next(b for b in out["bottlenecks"] if b["stage"] == "approved")
    assert approved["avg_age_hours"] == 100.0  # aging, not volume


@pytest.mark.asyncio
async def test_operational_route_aggregates_the_queue():
    out = await analytics.get_operational_analytics(period_type="daily", db=_FakeDB(STAGES), tenant=TENANT)
    assert {b["stage"] for b in out["bottlenecks"]} == {"detected", "approved"}
    assert set(out) == {"kpis", "bottlenecks", "capacity"}


@pytest.mark.asyncio
async def test_mdm_health_binds_days_as_an_interval():
    db = _FakeDB([])
    out = await analytics.get_mdm_health(days=56, request=None, db=db, tenant=TENANT)
    assert out == {"data": [], "days": 56}
    sql, params = next(c for c in db.calls if "mdm_metrics" in c[0])
    # asyncpg rejects an int bound into text concatenation ("expected str, got int")
    assert "make_interval(days => :days)" in sql and not re.search(r":days\s*\|\|", sql)
    assert params["days"] == 56


@pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
@pytest.mark.asyncio
async def test_mdm_health_and_queue_queries_run_on_asyncpg():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    eng = create_async_engine(os.environ["MERIDIAN_TEST_DB_URL"].replace("postgresql://", "postgresql+asyncpg://", 1))
    try:
        async with eng.connect() as c:
            assert (await c.execute(text("SELECT now() - make_interval(days => :days) < now()"), {"days": 56})).scalar()
            await c.execute(text(analytics._QUEUE_STAGES_SQL), {"tid": str(uuid.uuid4())})
    finally:
        await eng.dispose()
