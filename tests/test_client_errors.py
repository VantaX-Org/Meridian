"""POST /api/v1/client-errors: the browser's error report lands in audit_log."""

import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes.client_errors import router
from api.services import rate_limiter

BODY = {
    "digest": "abc123",
    "message": "Cannot read properties of undefined",
    "stack": "TypeError: x\n  at Page (page.tsx:10)",
    "pathname": "/objects",
    "user_agent": "Mozilla/5.0",
    "time": "2026-10-13T12:00:00.000Z",
}


class _DB:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))

    async def commit(self) -> None:
        self.commits += 1


def _client(db: _DB) -> TestClient:
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def _post(client: TestClient, body: dict = BODY, role: str = "viewer"):
    return client.post("/api/v1/client-errors", json=body, headers={"X-User-Role": role})


def test_any_role_can_report_and_a_client_error_row_is_written() -> None:
    db = _DB()
    r = _post(_client(db))
    assert r.status_code == 202 and r.json() == {"status": "recorded"}
    inserts = [c for c in db.calls if "INSERT INTO audit_log" in c[0]]
    assert len(inserts) == 1 and db.commits == 1
    params = inserts[0][1]
    assert params["a"] == "client_error"
    assert params["et"] == "client_error" and params["ei"] == "abc123"
    after = json.loads(params["af"])
    assert after["pathname"] == "/objects" and after["message"] == BODY["message"]


def test_stack_is_optional() -> None:
    body = {k: v for k, v in BODY.items() if k != "stack"}
    assert _post(_client(_DB()), body).status_code == 202


def test_invalid_bodies_are_rejected_before_any_write() -> None:
    db = _DB()
    client = _client(db)
    assert _post(client, {**BODY, "digest": ""}).status_code == 422
    assert _post(client, {**BODY, "message": "x" * 2001}).status_code == 422
    assert _post(client, {k: v for k, v in BODY.items() if k != "pathname"}).status_code == 422
    assert not [c for c in db.calls if "INSERT INTO audit_log" in c[0]]


def test_rate_limited_callers_get_429(monkeypatch) -> None:
    class _Redis:
        def __init__(self) -> None:
            self.n = 0

        def incr(self, _key: str) -> int:
            self.n += 1
            return self.n

        def expire(self, _key: str, _ttl: int) -> None:
            return None

    fake = _Redis()
    monkeypatch.setattr(rate_limiter, "get_redis", lambda: fake)
    client = _client(_DB())
    codes = [_post(client).status_code for _ in range(21)]
    assert codes[:20] == [202] * 20
    assert codes[20] == 429
