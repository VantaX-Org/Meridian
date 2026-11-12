"""Data collection: value checks, permission gates, progress status, and submit queueing proposals with audit."""
import datetime as dt
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import data_collection as route

RID, OWNER, ITEM_A, ITEM_B = (str(uuid.uuid4()) for _ in range(4))
HEAD = {"id": RID, "version_id": str(uuid.uuid4()), "module": "material_master", "owner_id": OWNER, "owner_name": "Owner",
        "due_date": dt.date(2030, 1, 1), "note": "Please fill", "created_at": dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc),
        "total": 2, "open": 2, "submitted": 0, "approved": 0, "rejected": 0}


def _item(i, state="open"):
    return {"id": i, "check_id": "FS-MARA-REQ", "record_key": f"M{i[:2]}", "field": "MARA.MTART", "current_value": None,
            "new_value": None, "state": state, "valid_values": ["ROH", "FERT"]}


class _Result:
    def __init__(self, rows=(), scalar=None):
        self.rows, self._s = list(rows), scalar

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows

    def scalar(self):
        return self._s


class _DB:
    def __init__(self):
        self.inserts, self.updates, self.committed = [], [], False

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "FROM data_requests r" in sql:
            return _Result([HEAD])
        if "FROM data_request_items i" in sql:
            return _Result([_item(ITEM_A), _item(ITEM_B)])
        if "INSERT INTO cleaning_queue" in sql:
            self.inserts.append(params)
        elif "UPDATE data_request_items" in sql:
            self.updates.append(params)
        elif "SELECT created_by" in sql:
            return _Result(scalar=str(uuid.uuid4()))
        return _Result()

    async def commit(self):
        self.committed = True


@pytest.fixture
def ctx(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    audit, notes, me = [], [], {"id": OWNER}

    async def _noop(*_a, **_k):
        return None

    async def _audit(*a, **k):
        audit.append((a[3], k.get("metadata")))

    async def _note(*a, **_k):
        notes.append(a[3])

    monkeypatch.setattr(route, "_rls", _noop)
    monkeypatch.setattr(route, "_create_audit", _audit)
    monkeypatch.setattr(route, "create_notification", _note)
    monkeypatch.setattr(route, "mark_work_changed", lambda *_a: None)
    monkeypatch.setattr(route, "current_user_id", lambda _r=None: me["id"])
    app = FastAPI()
    app.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(app), db, audit, notes, me


def test_check_value_length_and_allowed():
    allowed = [{"value": "ROH"}, {"value": "FERT"}]
    assert route.check_value("  ", None, None) == "Enter a value"
    assert route.check_value("ABCDE", 4, None) == "At most 4 characters"
    assert route.check_value("XXX", 4, allowed) == "Use one of the allowed values"
    assert route.check_value(" ROH ", 4, allowed) is None
    assert route.check_value("anything", None, None) is None


def test_status_derivation():
    assert route._status(2, 2, 0, 0) == "approved"
    assert route._status(2, 0, 0, 0) == "submitted"
    assert route._status(2, 0, 1, 0) == "open"
    assert route._status(2, 1, 0, 1) == "open"
    assert route._status(0, 0, 0, 0) == "open"


def test_gates(ctx):
    client, *_ = ctx
    v = {"X-User-Role": "viewer"}
    assert client.get("/api/v1/data-requests/findings?module=m", headers=v).status_code == 403
    assert client.post("/api/v1/data-requests", json={}, headers=v).status_code in (403, 422)
    assert client.get("/api/v1/data-requests", headers=v).status_code == 403  # all requests need assign
    assert client.get("/api/v1/data-requests?mine=true", headers=v).status_code == 200


def test_detail_shows_rule_values_and_hides_other_owners(ctx):
    client, _db, _a, _n, me = ctx
    body = client.get(f"/api/v1/data-requests/{RID}", headers={"X-User-Role": "viewer"}).json()
    assert body["total"] == 2 and body["items"][0]["allowed_values"][0]["value"] == "ROH"
    me["id"] = str(uuid.uuid4())
    assert client.get(f"/api/v1/data-requests/{RID}", headers={"X-User-Role": "viewer"}).status_code == 403
    assert client.get(f"/api/v1/data-requests/{RID}", headers={"X-User-Role": "admin"}).status_code == 200


def test_submit_queues_valid_values_audits_and_reports_errors(ctx):
    client, db, audit, notes, me = ctx
    h = {"X-User-Role": "viewer"}
    r = client.post(f"/api/v1/data-requests/{RID}/submit", headers=h,
                    json={"values": [{"item_id": ITEM_A, "value": "ROH"}, {"item_id": ITEM_B, "value": "BAD"}]})
    assert r.status_code == 200 and r.json()["submitted"] == 1
    assert r.json()["errors"] == [{"item_id": ITEM_B, "error": "Use one of the allowed values"}]
    assert len(db.inserts) == 1 and '"ROH"' in db.inserts[0]["a"] and db.inserts[0]["c"] == "FS-MARA-REQ"
    assert db.updates[0]["i"] == ITEM_A and audit == [("proposed", {"source": "data_request", "request_id": RID})]
    assert db.committed and notes
    me["id"] = str(uuid.uuid4())
    other = client.post(f"/api/v1/data-requests/{RID}/submit", headers={"X-User-Role": "admin"},
                        json={"values": [{"item_id": ITEM_A, "value": "ROH"}]})
    assert other.status_code == 403
