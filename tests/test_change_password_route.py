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

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, stmt, _params=None):
        sql = str(stmt)
        if "jwt_secret" in sql:
            return _Row(("secret",))
        if "password_hash, is_active" in sql:
            return _Row(("u1", self.password_hash, True))
        if sql.startswith("UPDATE users"):
            self.updated = True
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
