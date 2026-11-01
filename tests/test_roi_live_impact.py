"""ROI and monthly cost avoidance price one run live; nothing sums impact rows across runs.

GET /analytics/roi used to add the latest 20 impact_records over every run, so the same risk counted once
per run, and the monthly job read impact_records.created_at, a column the table does not have. Nothing
wrote impact_records at all, so both were empty on every deployment.
"""

import uuid

import pytest

import api.routes.analytics as analytics
import workers.scheduler as scheduler
from api.deps import Tenant


class _Row:
    def __init__(self, **kw):
        self._mapping = kw


class _Res:
    def __init__(self, rows=(), scalar=None):
        self._rows, self._scalar = list(rows), scalar

    def all(self):
        return self._rows

    def scalar(self):
        return self._scalar

    def __iter__(self):
        return iter(self._rows)


_FINDINGS = [_Row(module="material_master", check_id="MM001", dimension="uniqueness", affected_count=10)]


class _AsyncDB:
    def __init__(self):
        self.calls = 0

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "cost_model" in sql:
            return _Res(scalar=None)
        if "analysis_versions" in sql:
            return _Res(scalar=uuid.uuid4())
        if "FROM findings" in sql:
            return _Res(_FINDINGS)
        return _Res()


@pytest.mark.asyncio
async def test_roi_prices_the_latest_run_once():
    tenant = Tenant(uuid.uuid4(), "T", [])
    roi = await analytics.get_roi(db=_AsyncDB(), tenant=tenant)
    impact = await analytics.get_impact_analytics(version_id=None, db=_AsyncDB(), tenant=tenant)
    assert roi["roi"] == impact["roi"]
    assert roi["impacts"] == impact["impacts"]
    dup = next(i for i in roi["impacts"] if i["category"] == "duplicate_payment")
    assert dup["finding_count"] == 1
    assert roi["cost_avoidance_history"] == []


class _SyncSession:
    def __init__(self):
        self.sql = []

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.sql.append((sql, params))
        if "cost_model" in sql:
            return _Res(scalar=None)
        if "FROM findings" in sql:
            return _Res(_FINDINGS)
        return _Res()


def test_monthly_job_replaces_one_runs_impact_rows():
    s = _SyncSession()
    vid = str(uuid.uuid4())
    total = scheduler._record_impact(s, "t1", vid)
    statements = [q for q, _ in s.sql]
    delete = next(i for i, q in enumerate(statements) if q.startswith("DELETE FROM impact_records"))
    insert = next(i for i, q in enumerate(statements) if "INSERT INTO impact_records" in q)
    assert delete < insert
    rows = s.sql[insert][1]
    assert len(rows) == 8 and {r["vid"] for r in rows} == {vid}
    assert total == pytest.approx(sum(r["mitigated"] for r in rows))
    assert not any("created_at" in q for q in statements)
