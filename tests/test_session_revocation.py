"""Session revocation without a database: the ``tv`` claim, LocalAuthMiddleware's check against
users.token_version (lookup stubbed) and the change-password response's replacement token.

tests/test_session_revocation_pg.py drives the same flow against a real Postgres.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.middleware.local_auth as mw
from api.services.local_auth import (
    create_access_token,
    decode_access_token,
    token_version_claim,
)

pytestmark = pytest.mark.session_revocation

SECRET = "unit-test-secret-of-at-least-32-bytes!"
UID = str(uuid.uuid4())
TID = mw.DEV_TENANT_ID


def _legacy_token() -> str:
    """An access token as issued before migration 092: no ``tv`` claim."""
    from datetime import datetime, timedelta, timezone

    import jwt

    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": UID, "tenant_id": TID, "email": "u@example.test", "role": "viewer",
                       "iat": now, "exp": now + timedelta(hours=1)}, SECRET, algorithm="HS256")


def _token(tv: int) -> str:
    return create_access_token(UID, TID, "u@example.test", "viewer", SECRET, token_version=tv)


class _Users:
    """users.token_version by user id, as the stubbed lookup sees it."""

    def __init__(self) -> None:
        self.version: dict[str, int] = {UID: 0}
        self.calls: list[str] = []
        self.down = False

    def lookup(self, uid: str, _tid: str) -> int | None:
        self.calls.append(uid)
        if self.down:
            raise mw.TokenVersionUnavailable("db down")
        return self.version.get(uid)


@pytest.fixture
def users(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Users]:
    u = _Users()
    mw._token_version_cache.clear()
    monkeypatch.setattr(mw, "_lookup_token_version", u.lookup)
    monkeypatch.setattr(mw, "_load_jwt_secret", lambda: SECRET)
    yield u
    mw._token_version_cache.clear()


def _client() -> TestClient:
    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(mw.LocalAuthMiddleware)
    return TestClient(app)


def _get(client: TestClient, token: str) -> int:
    return client.get("/api/v1/ping", headers={"Authorization": f"Bearer {token}"}).status_code


def test_access_token_carries_tv() -> None:
    payload = decode_access_token(_token(3), SECRET)
    assert payload is not None and payload["tv"] == 3 and token_version_claim(payload) == 3
    assert token_version_claim({"sub": UID}) == 0  # issued before 092
    assert token_version_claim({"tv": "7"}) == 0 and token_version_claim({"tv": True}) == 0


def test_current_token_accepted(users: _Users) -> None:
    assert _get(_client(), _token(0)) == 200


def test_older_token_rejected_after_bump(users: _Users) -> None:
    client = _client()
    old = _token(0)
    assert _get(client, old) == 200
    users.version[UID] = 1
    mw.forget_token_version(UID)  # what the bumping route does in its own process
    r = client.get("/api/v1/ping", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401 and "revoked" in r.json()["detail"]
    assert _get(client, _token(1)) == 200


def test_legacy_token_without_claim_is_version_zero(users: _Users) -> None:
    client = _client()
    assert _get(client, _legacy_token()) == 200  # the upgrade signs nobody out
    users.version[UID] = 1
    mw.forget_token_version(UID)
    assert _get(client, _legacy_token()) == 401  # but a revocation still ends it


def test_cookie_token_is_checked_too(users: _Users) -> None:
    users.version[UID] = 2
    client = _client()
    client.cookies.set("mn_auth_token", _token(1))
    assert client.get("/api/v1/ping").status_code == 401
    client.cookies.set("mn_auth_token", _token(2))
    assert client.get("/api/v1/ping").status_code == 200


def test_unknown_user_rejected(users: _Users) -> None:
    del users.version[UID]
    assert _get(_client(), _token(0)) == 401


def test_lookup_failure_is_503_not_401(users: _Users) -> None:
    """A 401 signs the browser out (frontend/lib/api/client.ts); a database outage must not."""
    users.down = True
    assert _get(_client(), _token(0)) == 503


def test_lookup_cached_briefly(users: _Users) -> None:
    client = _client()
    for _ in range(3):
        assert _get(client, _token(0)) == 200
    assert len(users.calls) == 1  # one lookup per user per TTL, not one per request
    users.version[UID] = 1  # bumped by another API process: this one sees it once its entry expires
    assert _get(client, _token(0)) == 200
    mw._token_version_cache[UID] = (0, 0.0)
    assert _get(client, _token(0)) == 401
    assert len(users.calls) == 2


def test_non_uuid_subject_rejected(users: _Users) -> None:
    token = create_access_token("not-a-uuid", TID, "u@example.test", "viewer", SECRET)
    assert _get(_client(), token) == 401
    assert users.calls == []


# ── change-password hands back the replacement session ─────────────────────────


def test_change_password_returns_token_at_new_version(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.routes import auth
    from api.services.local_auth import hash_password

    class _Row:
        def __init__(self, row: tuple | None) -> None:
            self._row = row

        def fetchone(self) -> tuple | None:
            return self._row

    class _Conn:
        sql: list[str] = []

        def __enter__(self) -> _Conn:
            return self

        def __exit__(self, *_exc: object) -> bool:
            return False

        def execute(self, stmt: object, _params: dict | None = None) -> _Row:
            sql = str(stmt)
            self.sql.append(sql)
            if "jwt_secret" in sql:
                return _Row((SECRET,))
            if "password_hash, is_active" in sql:
                return _Row((UID, hash_password("the-old-password"), True, "u@example.test", "viewer"))
            if sql.startswith("UPDATE users"):
                return _Row((4,))
            return _Row(None)

        def commit(self) -> None:
            pass

    conn = _Conn()
    forgotten: list[str] = []
    monkeypatch.setattr(auth, "get_sync_engine_or_create", lambda: type("E", (), {"connect": lambda _s: conn})())
    monkeypatch.setattr(auth, "_ensure_local_auth_schema", lambda _c: None)
    monkeypatch.setattr(auth, "forget_token_version", forgotten.append)
    app = FastAPI()
    app.include_router(auth.router)
    r = TestClient(app).post("/api/v1/auth/change-password",
                             json={"current_password": "the-old-password", "new_password": "a-brand-new-password"},
                             headers={"Authorization": f"Bearer {_token(3)}"})
    assert r.status_code == 200, r.text
    payload = decode_access_token(r.json()["token"], SECRET)
    assert payload is not None and payload["sub"] == UID and payload["tv"] == 4 and payload["role"] == "viewer"
    assert r.cookies.get("mn_auth_token") == r.json()["token"]
    assert any("token_version = token_version + 1" in s for s in conn.sql)
    assert forgotten == [UID]
