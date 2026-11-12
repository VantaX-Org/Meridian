"""GET /api/v1/contact-verification and PUT .../settings: shape, per-record reasons, permission gates, audit."""
import datetime as dt
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import contact_verification as route

ROW = {"check_id": "SDCM941", "module": "sd_customer_master", "affected_count": 2, "total_count": 3,
       "pass_rate": 33.3, "fixes": 1, "created_at": dt.datetime(2026, 11, 1, 8, 0),
       "details": {"message": "Customer phone number is not plausible", "field_checked": "KNA1.TELF1",
                   "reasons": {"phone_length": {"count": 2, "text": "Number has the wrong length for its country"}},
                   "sample_failing_records": [{"record_key": "KUNNR=C2", "invalid_value": "***",
                                               "reason": "phone_length", "reason_text": "Wrong length"}]}}


class _Result:
    def mappings(self):
        return self

    def all(self):
        return [ROW, {**ROW, "check_id": "PC-KNA1-ORT01", "details": {}, "created_at": None}]


class _DB:
    committed = False

    async def execute(self, _stmt, _params=None):
        return _Result()

    async def commit(self):
        self.committed = True


@pytest.fixture
def ctx(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    store, audit = {}, []

    async def _noop(*_a, **_k):
        return None

    async def _get(_db, _t, key):
        return store.get(key)

    async def _put(_db, _t, key, value, _u):
        store[key] = value

    async def _audit(*a, **_k):
        audit.append(a[3:])

    monkeypatch.setattr(route, "_rls", _noop)
    monkeypatch.setattr(route, "get_setting", _get)
    monkeypatch.setattr(route, "put_setting", _put)
    monkeypatch.setattr(route, "write_audit", _audit)
    api = FastAPI()
    api.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), store, audit, db


def test_get_lists_rules_with_record_reasons(ctx):
    client, *_ = ctx
    body = client.get("/api/v1/contact-verification", headers={"X-User-Role": "viewer"}).json()
    assert body["settings"] == {"mx": False}
    first, generated = body["rules"]
    assert first["samples"] == [{"record_key": "KUNNR=C2", "value": "***", "reason": "phone_length",
                                 "reason_text": "Wrong length"}]
    assert first["fixes"] == 1 and first["reasons"]["phone_length"]["count"] == 2
    assert generated["message"] != "PC-KNA1-ORT01"  # generated rules get their words from country_rules


def test_put_needs_manage_settings_and_is_audited(ctx):
    client, store, audit, db = ctx
    assert client.put("/api/v1/contact-verification/settings", json={"mx": True},
                      headers={"X-User-Role": "viewer"}).status_code == 403
    r = client.put("/api/v1/contact-verification/settings", json={"mx": True}, headers={"X-User-Role": "admin"})
    assert r.status_code == 200 and r.json() == {"mx": True}
    assert store["contact_verify"] == {"mx": True} and db.committed
    assert audit[0][0] == "contact_verify_settings" and audit[0][-2:] == ({"mx": False}, {"mx": True})
