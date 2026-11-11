"""Governance process analytics: cycle and approval times, step dwell, SLA breaches, backlog aging, route window."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import process_analytics as route
from api.services import process_analytics as pa

NOW = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)


def _h(n):
    return NOW - timedelta(hours=n)


REQUESTS = [
    # created: submitted 50h ago, approved 40h ago, created 30h ago -> cycle 20h, approval 10h
    {"id": "a", "object": "material", "kind": "create", "status": "created", "created_at": _h(60),
     "submitted_at": _h(50), "decided_at": _h(40), "completed_at": _h(30), "instance_id": "i1"},
    # created: cycle 4h, approval 2h
    {"id": "b", "object": "material", "kind": "change", "status": "created", "created_at": _h(10),
     "submitted_at": _h(8), "decided_at": _h(6), "completed_at": _h(4), "instance_id": "i2"},
    {"id": "c", "object": "customer", "kind": "create", "status": "rejected", "created_at": _h(30),
     "submitted_at": _h(29), "decided_at": _h(5), "completed_at": None, "instance_id": "i3"},
    # open for 5 days
    {"id": "d", "object": "customer", "kind": "create", "status": "in_approval", "created_at": _h(121),
     "submitted_at": _h(120), "decided_at": None, "completed_at": None, "instance_id": "i4"},
    {"id": "e", "object": "vendor", "kind": "create", "status": "draft", "created_at": _h(1),
     "submitted_at": None, "decided_at": None, "completed_at": None, "instance_id": None},
]

TASKS = [
    {"instance_id": "i1", "step_name": "Data steward", "step_index": 0, "status": "approved",
     "activated_at": _h(50), "decided_at": _h(45), "due_at": _h(42), "sla_hours": 8},
    {"instance_id": "i1", "step_name": "Finance", "step_index": 1, "status": "approved",
     "activated_at": _h(45), "decided_at": _h(40), "due_at": _h(41), "sla_hours": 4},  # late by 1h
    {"instance_id": "i3", "step_name": "Data steward", "step_index": 0, "status": "rejected",
     "activated_at": _h(29), "decided_at": _h(5), "due_at": _h(21), "sla_hours": 8},  # late
    {"instance_id": "i4", "step_name": "Data steward", "step_index": 0, "status": "pending",
     "activated_at": _h(120), "decided_at": None, "due_at": _h(112), "sla_hours": 8},  # pending past due
]


def test_percentile_is_nearest_rank():
    assert pa.percentile([], 50) is None
    assert pa.percentile([4, 1, 3, 2], 50) == 2
    assert pa.percentile([4, 1, 3, 2], 90) == 4


def test_analyse_counts_every_figure():
    out = pa.analyse(REQUESTS, TASKS, NOW)
    assert out["total"] == 5
    assert out["by_status"] == {"created": 2, "draft": 1, "in_approval": 1, "rejected": 1}
    assert out["cycle"] == {"n": 2, "median_hours": 4.0, "p90_hours": 20.0}
    assert out["approval"]["n"] == 3 and out["approval"]["median_hours"] == 10.0
    assert out["rates"] == {"closed": 3, "rejection": 0.3333, "failure": 0.0, "cancellation": 0.0}
    assert out["sla"] == {"with_sla": 4, "breached": 3, "rate": 0.75}
    steward = next(s for s in out["steps"] if s["step"] == "Data steward")
    assert steward["tasks"] == 3 and steward["pending"] == 1 and steward["breached"] == 2
    assert steward["overdue_open"] == 1 and steward["median_dwell_hours"] == 5.0
    assert out["bottleneck"] == "Data steward"
    assert out["aging"] == {"lt_1d": 0, "d1_3": 0, "d3_7": 1, "gt_7d": 0}
    mat = next(o for o in out["objects"] if o["object"] == "material")
    assert mat["created"] == 2 and mat["median_cycle_hours"] == 4.0
    assert sum(w["submitted"] for w in out["weekly"]) == 4
    assert sum(w["created"] for w in out["weekly"]) == 2


def test_empty_window_has_no_figures():
    out = pa.analyse([], [], NOW)
    assert out["total"] == 0 and out["bottleneck"] is None and out["sla"]["rate"] is None


class _DB:
    def __init__(self):
        self.calls = []

    async def execute(self, stmt, params=None):
        self.calls.append(params or {})
        sql = str(stmt)

        class R:
            def __init__(self, rows):
                self.rows = rows

            def mappings(self):
                return self.rows

        if "FROM change_requests" in sql:
            return R(REQUESTS)
        if "FROM workflow_tasks" in sql:
            return R([t for t in TASKS if t["instance_id"] in params["ids"]])
        return R([])


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    api = FastAPI()
    api.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    c = TestClient(api)
    c.db = db
    return c


def test_route_returns_analytics_for_the_window(client):
    r = client.get("/api/v1/governance/process-analytics", params={"days": 30}, headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 30 and body["total"] == 5 and body["bottleneck"] == "Data steward"
    assert any(c.get("days") == 30 for c in client.db.calls)


def test_route_filters_by_object_and_validates(client):
    r = client.get("/api/v1/governance/process-analytics", params={"object": "customer"},
                   headers={"X-User-Role": "viewer"})
    assert r.status_code == 200 and r.json()["total"] == 2
    assert client.get("/api/v1/governance/process-analytics", params={"object": "x"},
                      headers={"X-User-Role": "viewer"}).status_code == 422
    assert client.get("/api/v1/governance/process-analytics", params={"days": 2},
                      headers={"X-User-Role": "viewer"}).status_code == 422


# ── approval forecast ────────────────────────────────────────────────────────

def _hist(rid, obj, kind, step, dwell, ago=200):
    return {"request_id": rid, "title": f"CR {rid}", "object": obj, "kind": kind, "step_name": step,
            "activated_at": _h(ago), "decided_at": _h(ago - dwell)}


HISTORY = [_hist(f"m{i}", "material", "create", "Data steward", d) for i, d in enumerate([2, 4, 6, 10, 30])] + [
    _hist("c1", "customer", "change", "Finance", 3), _hist("c2", "customer", "change", "Finance", 5)]

OPEN_REQ = [
    {"id": "r1", "title": "New pump", "object": "material", "kind": "create", "status": "in_approval",
     "object_key": None, "instance_id": "j1"},
    {"id": "r2", "title": "Late one", "object": "vendor", "kind": "create", "status": "in_approval",
     "object_key": None, "instance_id": "j2"},
    {"id": "r3", "title": "Approved", "object": "material", "kind": "create", "status": "creating",
     "object_key": None, "instance_id": "j3"},
]

OPEN_TASKS = [
    {"instance_id": "j1", "step_name": "Data steward", "step_index": 0, "status": "pending", "sla_hours": 8,
     "activated_at": _h(1), "decided_at": None, "due_at": _h(1) + timedelta(hours=8)},
    {"instance_id": "j1", "step_name": "Finance", "step_index": 1, "status": "waiting", "sla_hours": 4,
     "activated_at": None, "decided_at": None, "due_at": None},
    {"instance_id": "j2", "step_name": "Data steward", "step_index": 0, "status": "pending", "sla_hours": 8,
     "activated_at": _h(20), "decided_at": None, "due_at": _h(12)},
]


def test_forecast_eta_breach_and_remaining_steps():
    out = pa.forecast(OPEN_REQ, OPEN_TASKS, HISTORY, NOW)
    assert out["open"] == 3 and out["without_pending"] == 1 and out["breached"] == 1
    r1 = next(r for r in out["requests"] if r["request_id"] == "r1")
    # waited 1h: all 5 material/create/steward tasks took longer, so the pool is all 5
    assert r1["basis"] == "object_kind_step" and r1["conditioned"] and r1["n"] == 5
    assert r1["p50_hours"] == 6 and r1["p90_hours"] == 30
    assert r1["eta"] == _h(1) + timedelta(hours=6)
    assert r1["breach_probability"] == 0.4  # 10h and 30h exceed the 8h SLA
    fin = r1["remaining"][0]
    assert fin["step"] == "Finance" and fin["basis"] == "step" and fin["n"] == 2 and fin["p50_hours"] == 3
    assert r1["request_eta"] == r1["eta"] + timedelta(hours=3)
    assert len(r1["evidence"]) == 5 and {e["request_id"] for e in r1["evidence"]} == {f"m{i}" for i in range(5)}
    r2 = next(r for r in out["requests"] if r["request_id"] == "r2")
    # vendor has no history of its own: falls back to the step; waited 20h, only the 30h task survives
    assert r2["basis"] == "step" and r2["n"] == 1 and r2["breached"] and r2["breach_probability"] == 1.0
    assert out["requests"][0]["request_id"] == "r2"  # riskiest first


def test_forecast_without_history_has_no_eta():
    out = pa.forecast(OPEN_REQ[:1], OPEN_TASKS[:2], [], NOW)
    r = out["requests"][0]
    assert r["basis"] == "none" and r["n"] == 0 and r["eta"] is None and r["request_eta"] is None
    assert r["breach_probability"] is None


class _ForecastDB:
    async def execute(self, stmt, params=None):
        sql = str(stmt)

        class R:
            def __init__(self, rows):
                self.rows = rows

            def mappings(self):
                return self.rows

        if "JOIN change_requests" in sql:
            assert params["days"] == 365
            return R(HISTORY)
        if "FROM change_requests" in sql:
            assert "in_approval" in params["open"]
            return R(OPEN_REQ)
        if "FROM workflow_tasks" in sql:
            return R([t for t in OPEN_TASKS if t["instance_id"] in params["ids"]])
        return R([])


def test_forecast_route(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    api = FastAPI()
    api.include_router(route.router)

    async def _db():
        yield _ForecastDB()

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    r = TestClient(api).get("/api/v1/governance/approval-forecast", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["open"] == 3 and len(body["requests"]) == 2 and body["requests"][0]["evidence"]
