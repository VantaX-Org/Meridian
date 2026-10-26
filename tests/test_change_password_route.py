"""POST /api/v1/auth/change-password: a wrong current password is a validation error, not a 401.

The frontend's API client treats any non-login 401 as an expired session and signs the
user out, so a typo in the current password must not answer 401.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import auth
from api.services.local_auth import hash_password


class _Row:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    def __init__(self, password_hash: str):
        self.password_hash = password_hash
        self.updated = False
        self.audit: list = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, stmt, _params=None):
        sql = str(stmt)
        if "jwt_secret" in sql:
            return _Row(("secret",))
        if "password_hash, is_active" in sql:
            return _Row(("u1", self.password_hash, True, "u1@example.com", "viewer"))
        if sql.startswith("UPDATE users"):
            self.updated = True
            return _Row((1,))
        if sql.startswith("INSERT INTO audit_log"):
            self.audit.append(_params)
        return _Row(None)

    def commit(self):
        pass


class _Engine:
    def __init__(self, conn: _Conn):
        self.conn = conn

    def connect(self):
        return self.conn


def _client(monkeypatch, current: str) -> tuple[TestClient, _Conn]:
    conn = _Conn(hash_password(current))
    monkeypatch.setattr(auth, "get_sync_engine_or_create", lambda: _Engine(conn))
    monkeypatch.setattr(auth, "_ensure_local_auth_schema", lambda _c: None)
    monkeypatch.setattr(auth, "decode_access_token", lambda _t, _s: {"sub": "u1"})
    api = FastAPI()
    api.include_router(auth.router)
    return TestClient(api), conn


def _post(client: TestClient, current: str):
    return client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": "a-brand-new-password"},
        headers={"Authorization": "Bearer t"},
    )


def test_wrong_current_password_is_422_not_401(monkeypatch):
    client, conn = _client(monkeypatch, "the-real-password")
    r = _post(client, "not-the-password")
    assert r.status_code == 422
    assert r.json()["detail"] == "Current password is incorrect"
    assert not conn.updated


def test_right_current_password_changes_it(monkeypatch):
    client, conn = _client(monkeypatch, "the-real-password")
    r = _post(client, "the-real-password")
    assert r.status_code == 200
    assert conn.updated
    assert len(conn.audit) == 1
    assert conn.audit[0]["u"] == "u1" and conn.audit[0]["e"] == "u1@example.com"


def test_wrong_current_password_writes_no_audit_row(monkeypatch):
    client, conn = _client(monkeypatch, "the-real-password")
    _post(client, "nope-nope-nope")
    assert conn.audit == []


def test_change_password_is_rate_limited_per_user(monkeypatch):
    """Five tries a minute per signed-in user, then 429: a stolen session cannot brute-force the current password."""
    import api.services.rate_limiter as rl

    class _Redis:
        def __init__(self):
            self.counts: dict[str, int] = {}

        def incr(self, key):
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]

        def expire(self, key, ttl):
            pass

    redis = _Redis()
    monkeypatch.setattr(rl, "get_redis", lambda: redis)
    client, conn = _client(monkeypatch, "the-real-password")

    @client.app.middleware("http")
    async def _who(request, call_next):  # LocalAuthMiddleware sets this from the session token
        request.state.local_user_id = request.headers.get("x-test-user")
        return await call_next(request)

    def post(user):
        return client.post("/api/v1/auth/change-password",
                           json={"current_password": "guess-guess-guess", "new_password": "a-brand-new-password"},
                           headers={"Authorization": "Bearer t", "x-test-user": user})

    assert [post("u1").status_code for _ in range(5)] == [422] * 5
    assert post("u1").status_code == 429
    assert post("u2").status_code == 422  # another user has their own bucket
    assert all(":user:" in k for k in redis.counts)
