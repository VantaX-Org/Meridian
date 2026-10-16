"""POST /api/v1/me/notifications/test and GET /api/v1/me/notifications/deliveries: the caller only."""

import uuid

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import me_notifications
from api.routes.me_notifications import router
from api.services import rate_limiter

UID = uuid.uuid4()
TENANT = Tenant(uuid.uuid4(), "D", [])


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


class _Row:
    def __init__(self, **kw):
        self._mapping = kw


class _DB:
    """One user row, a delivery log (claims honour the key, updates mutate the claimed row),
    and a record of every statement. ``fail_update`` breaks the second transaction."""

    def __init__(self, email="me@example.com", exists=True, deliveries=(), fail_update=False):
        self.email = email
        self.exists = exists
        self.rows = list(deliveries)
        self.fail_update = fail_update
        self.calls = []
        self.log: dict[str, dict] = {}  # notification_deliveries rows written, by id
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if sql.startswith("SET "):
            return _Result([])
        p = dict(params or {})
        self.calls.append((sql, p))
        if sql.startswith("SELECT email FROM users"):
            return _Result([(self.email,)] if self.exists else [])
        if "FROM notification_deliveries" in sql:
            return _Result([_Row(**r) for r in self.rows])
        if sql.startswith("INSERT INTO notification_deliveries") and "ON CONFLICT" in sql:
            assert "'pending'" in sql and "RETURNING id" in sql
            self.log[p["id"]] = dict(p, status="pending", error=None)
            return _Result([(p["id"],)])
        if sql.startswith("INSERT INTO notification_deliveries"):
            self.log[p["id"]] = dict(p)
        if sql.startswith("UPDATE notification_deliveries"):
            if self.fail_update:
                raise RuntimeError("connection lost")
            assert self.log[p["id"]]["status"] == "pending"
            self.log[p["id"]].update(status=p["status"], error=p["error"])
        return _Result([])

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


class _FakeRedis:
    def __init__(self):
        self.store = {}

    def incr(self, key):
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def expire(self, key, seconds):
        pass


@pytest.fixture
def redis(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(rate_limiter, "get_redis", lambda: fake)
    return fake


def _client(db: _DB, monkeypatch, uid=str(UID), backend="smtp", send=True) -> TestClient:
    monkeypatch.setattr(me_notifications, "current_user_id", lambda _r=None: uid)
    monkeypatch.setattr(me_notifications, "email_backend_name", lambda: backend)
    sent = []

    def _send(recipient):
        sent.append((recipient, db.commits))  # how many commits had happened when the send ran
        if isinstance(send, Exception):
            raise send
        return send

    monkeypatch.setattr(me_notifications, "_send_test_email", _send)
    api = FastAPI()
    api.include_router(router)

    @api.middleware("http")
    async def _auth(request: Request, call_next):  # what LocalAuthMiddleware sets for the limiter
        request.state.local_user_id = uid
        return await call_next(request)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: TENANT
    c = TestClient(api)
    c.sent = sent  # type: ignore[attr-defined]
    return c


def _deliveries(db):
    return list(db.log.values())


def _sent_to(c):
    return [recipient for recipient, _ in c.sent]


def _notifications(db):
    return [p for sql, p in db.calls if sql.startswith("INSERT INTO notifications")]


def test_test_send_emails_the_caller_and_writes_addressed_in_app(monkeypatch, redis):
    db = _DB()
    c = _client(db, monkeypatch)
    r = c.post("/api/v1/me/notifications/test")
    assert r.status_code == 200 and r.json() == {"email": "sent", "in_app": True}
    assert _sent_to(c) == ["me@example.com"]
    n = _notifications(db)
    assert len(n) == 1 and n[0]["uid"] == str(UID) and n[0]["tid"] == str(TENANT.id)
    d = {p["channel"]: p for p in _deliveries(db)}
    assert d["in_app"]["status"] == "sent" and d["email"]["status"] == "sent"
    assert all(p["uid"] == str(UID) and p["kind"] == "test" for p in d.values())
    assert d["email"]["key"].startswith("test:")
    assert db.commits == 2


def test_in_app_and_pending_claim_are_committed_before_the_email_goes_out(monkeypatch, redis):
    db = _DB()
    c = _client(db, monkeypatch)
    c.post("/api/v1/me/notifications/test")
    assert c.sent == [("me@example.com", 1)], "one commit before the send"
    first_commit = next(i for i, (sql, _) in enumerate(db.calls) if sql.startswith("UPDATE notification_deliveries"))
    before = [sql.split()[0] + " " + sql.split()[2] for sql, _ in db.calls[:first_commit]]
    assert "INSERT notifications" in before and before.count("INSERT notification_deliveries") == 2
    assert db.commits == 2, "the outcome lands in a second transaction"


def test_email_sent_but_outcome_not_recorded_is_reported_not_raised(monkeypatch, redis):
    db = _DB(fail_update=True)
    c = _client(db, monkeypatch)
    r = c.post("/api/v1/me/notifications/test")
    assert r.status_code == 200 and r.json() == {"email": "sent_unrecorded", "in_app": True}
    assert _sent_to(c) == ["me@example.com"]
    assert db.commits == 1 and db.rollbacks == 1
    assert len(_notifications(db)) == 1
    assert {p["channel"]: p["status"] for p in _deliveries(db)} == {"in_app": "sent", "email": "pending"}


def test_failed_send_with_unrecorded_outcome_stays_failed(monkeypatch, redis):
    c = _client(_DB(fail_update=True), monkeypatch, send=False)
    assert c.post("/api/v1/me/notifications/test").json()["email"] == "failed"


def test_test_send_without_backend_is_in_app_only(monkeypatch, redis):
    db = _DB()
    c = _client(db, monkeypatch, backend=None)
    assert c.post("/api/v1/me/notifications/test").json() == {"email": "no_backend", "in_app": True}
    assert c.sent == []
    assert len(_notifications(db)) == 1
    d = {p["channel"]: p for p in _deliveries(db)}
    assert d["email"]["status"] == "no_backend" and d["in_app"]["status"] == "sent"
    assert db.commits == 1


def test_test_send_without_an_address_is_no_backend(monkeypatch, redis):
    c = _client(_DB(email=""), monkeypatch)
    assert c.post("/api/v1/me/notifications/test").json()["email"] == "no_backend"
    assert c.sent == []


@pytest.mark.parametrize("send", [False, RuntimeError("token expired")])
def test_failed_send_is_reported_not_raised(monkeypatch, redis, send):
    db = _DB()
    c = _client(db, monkeypatch, send=send)
    assert c.post("/api/v1/me/notifications/test").json() == {"email": "failed", "in_app": True}
    email_row = next(p for p in _deliveries(db) if p["channel"] == "email")
    assert email_row["status"] == "failed"
    assert email_row["error"] == ("RuntimeError" if isinstance(send, Exception) else None)


def test_test_send_is_limited_to_three_per_hour_per_user(monkeypatch, redis):
    c = _client(_DB(), monkeypatch)
    for _ in range(3):
        assert c.post("/api/v1/me/notifications/test").status_code == 200
    r = c.post("/api/v1/me/notifications/test")
    assert r.status_code == 429 and r.headers["Retry-After"]
    assert r.json()["detail"]["window_s"] == 3600 and r.json()["detail"]["limit"] == 3
    key = next(iter(redis.store))
    assert f":user:{UID}:" in key, "the bucket is per user, not per tenant"
    assert len(c.sent) == 3


def test_unauthenticated_is_401(monkeypatch, redis):
    c = _client(_DB(), monkeypatch, uid=None)
    assert c.post("/api/v1/me/notifications/test").status_code == 401
    assert c.get("/api/v1/me/notifications/deliveries").status_code == 401


def test_unknown_user_is_404_and_sends_nothing(monkeypatch, redis):
    db = _DB(exists=False)
    c = _client(db, monkeypatch)
    assert c.post("/api/v1/me/notifications/test").status_code == 404
    assert c.sent == [] and _deliveries(db) == []


def test_deliveries_are_scoped_to_the_caller(monkeypatch, redis):
    rows = [{"id": uuid.uuid4(), "channel": "email", "kind": "test", "status": "sent", "error": None,
             "created_at": "2026-10-15T08:00:00+00:00"}]
    db = _DB(deliveries=rows)
    c = _client(db, monkeypatch)
    r = c.get("/api/v1/me/notifications/deliveries", params={"limit": 5})
    assert r.status_code == 200
    assert r.json()["items"][0]["status"] == "sent" and r.json()["items"][0]["channel"] == "email"
    sql, params = db.calls[-1]
    assert "user_id = :uid" in sql and "tenant_id = :tid" in sql and "user_id IS NULL" not in sql
    assert params == {"tid": str(TENANT.id), "uid": str(UID), "limit": 5}


def test_deliveries_limit_is_bounded(monkeypatch, redis):
    c = _client(_DB(), monkeypatch)
    assert c.get("/api/v1/me/notifications/deliveries", params={"limit": 0}).status_code == 422
    assert c.get("/api/v1/me/notifications/deliveries", params={"limit": 101}).status_code == 422


def test_health_reports_the_email_backend(monkeypatch):
    from api.routes import health

    monkeypatch.setattr(health, "email_backend_name", lambda: None)
    monkeypatch.setattr(health, "get_cached_licence", lambda: {})
    api = FastAPI()
    api.include_router(health.router)
    body = TestClient(api).get("/health").json()
    assert "email_backend" in body and body["email_backend"] is None
