"""GET /analytics/predictive says why there is no forecast: a module needs scores on three
different days, and the response carries how many runs and days the history holds."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import analytics


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _Db:
    def __init__(self, history, extent):
        self.history, self.extent = history, extent

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "COUNT(DISTINCT recorded_at)" in sql:
            return _Res([self.extent])
        if "GROUP BY module_id" in sql:
            return _Res(self.history)
        return _Res([])


def _client(history, extent) -> TestClient:
    app = FastAPI()
    app.include_router(analytics.router)
    db = _Db(history, extent)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


H = {"X-User-Role": "admin"}


def _point(day: str, score: float) -> dict:
    return {"module_id": "material_master", "recorded_at": f"2026-10-{day}T08:00:00+00:00", "dqs_score": score,
            "completeness": 90, "accuracy": 90, "consistency": 90, "timeliness": 90, "uniqueness": 90,
            "validity": 90, "finding_count": 3}


def test_two_days_explains_the_missing_forecast():
    r = _client([_point("01", 70), _point("02", 72)], (5, 2)).get("/api/v1/analytics/predictive", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["forecasts"] == [] and body["early_warnings"] == []
    assert body["reason"] == "needs_three_days"
    assert (body["runs_seen"], body["days_seen"]) == (5, 2)


def test_no_history_is_its_own_reason():
    body = _client([], (0, 0)).get("/api/v1/analytics/predictive", headers=H).json()
    assert body["reason"] == "no_history" and (body["runs_seen"], body["days_seen"]) == (0, 0)


def test_three_days_forecast_without_a_reason():
    hist = [_point("01", 70), _point("02", 72), _point("03", 74)]
    body = _client(hist, (3, 3)).get("/api/v1/analytics/predictive", headers=H).json()
    assert len(body["forecasts"]) == 1 and "reason" not in body
    assert (body["runs_seen"], body["days_seen"]) == (3, 3)
