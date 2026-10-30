"""OIDC single sign-on against a real Postgres and a mocked identity provider (no network).

The IdP is an httpx.MockTransport serving discovery, JWKS and the token endpoint; it verifies PKCE (S256), the
redirect URI and the client credentials itself. The app is the auth, auth_oidc and admin SSO routers behind the
real LocalAuthMiddleware.

Runs with MERIDIAN_TEST_DB_URL (a throwaway database; see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (owner is a module-scoped fixture)
from tests.test_session_revocation_pg import DEV  # noqa: F401

ISSUER = "https://idp.example.test/tenant-1"
CLIENT_ID = "meridian-client"
CLIENT_SECRET = "s3cret-value-that-must-never-leak"
KID = "key-1"
PASSWORD = "a-long-enough-password"
BASE = "http://testserver"


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class MockIdp:
    """Serves the three endpoints. `claims` is what the next token carries (the test fills sub/email/nonce)."""

    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.challenge: str | None = None
        self.claims: dict[str, Any] = {}
        self.sign_with = self.key
        self.alg = "RS256"
        self.token_calls = 0
        self.errors: list[str] = []

    def jwks(self) -> dict[str, Any]:
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        return {"keys": [{**jwk, "kid": KID, "use": "sig", "alg": "RS256"}]}

    def id_token(self) -> str:
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "iat": now, "exp": now + 300, **self.claims}
        return jwt.encode(claims, self.sign_with, algorithm=self.alg, headers={"kid": KID})

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(200, json={
                "issuer": ISSUER, "authorization_endpoint": "https://idp.example.test/authorize",
                "token_endpoint": "https://idp.example.test/token", "jwks_uri": "https://idp.example.test/jwks",
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": ["client_secret_basic"]})
        if path == "/jwks":
            return httpx.Response(200, json=self.jwks())
        if path == "/token":
            self.token_calls += 1
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            expect_auth = "Basic " + base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
            if request.headers.get("authorization") != expect_auth:
                self.errors.append("client credentials")
            if form.get("redirect_uri") != f"{BASE}/api/v1/auth/oidc/callback":
                self.errors.append(f"redirect_uri {form.get('redirect_uri')}")
            if _b64u(hashlib.sha256(form.get("code_verifier", "").encode()).digest()) != self.challenge:
                self.errors.append("pkce")
            if self.errors or form.get("code") != "good-code":
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"id_token": self.id_token(), "access_token": "ignored", "token_type": "Bearer"})
        return httpx.Response(404)


@pytest.fixture
def idp(monkeypatch: pytest.MonkeyPatch) -> MockIdp:
    from api.services import oidc

    mock = MockIdp()
    monkeypatch.setattr(oidc, "http_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(mock.handle)))
    return mock


@pytest.fixture
def world(owner: Engine, idp: MockIdp, monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    """The app, an administrator (with password and token) and a viewer, all in the local-auth tenant."""
    import api.middleware.local_auth as mw
    from api.deps import get_db
    from api.routes import auth, auth_oidc
    from api.services.local_auth import create_access_token, generate_jwt_secret, hash_password

    monkeypatch.setenv("MERIDIAN_APP_URL", BASE)
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    monkeypatch.delenv("MERIDIAN_DEV_ROLE_HEADER", raising=False)
    monkeypatch.setattr(mw, "_jwt_secret_cache", {})
    monkeypatch.setattr(mw, "_token_version_cache", {})
    tag = uuid.uuid4().hex[:8]
    ids = {"admin": str(uuid.uuid4()), "viewer": str(uuid.uuid4())}
    emails = {"admin": f"admin-{tag}@corp.test", "viewer": f"viewer-{tag}@corp.test"}
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Dev') ON CONFLICT (id) DO NOTHING"), {"t": DEV})
        c.execute(text("UPDATE tenants SET jwt_secret = COALESCE(jwt_secret, :s), sso_config = NULL WHERE id = :t"),
                  {"s": generate_jwt_secret(), "t": DEV})
        secret = c.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": DEV}).scalar_one()
        for who, role in (("admin", "admin"), ("viewer", "viewer")):
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active, password_hash) "
                           "VALUES (:i, :t, :e, :n, :r, true, :ph)"),
                      {"i": ids[who], "t": DEV, "e": emails[who], "n": who, "r": role, "ph": hash_password(PASSWORD)})

    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"), poolclass=NullPool)
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():  # noqa: ANN202
        async with factory() as s:
            yield s

    app = FastAPI()
    for r in (auth.router, auth_oidc.router, auth_oidc.admin_router):
        app.include_router(r)
    app.add_middleware(mw.LocalAuthMiddleware)
    app.dependency_overrides[get_db] = _db
    for dep in (auth._login_rate_limit, auth_oidc._oidc_rate_limit):
        app.dependency_overrides[dep] = lambda: None
    admin_token = create_access_token(ids["admin"], DEV, emails["admin"], "admin", secret, 0)
    yield {"app": app, "client": TestClient(app, base_url=BASE), "ids": ids, "emails": emails, "tag": tag,
           "admin": {"Authorization": f"Bearer {admin_token}"}, "owner": owner, "secret": secret}
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET sso_config = NULL WHERE id = :t"), {"t": DEV})


def _put(w: dict[str, Any], **over: Any) -> httpx.Response:
    body = {"issuer": ISSUER, "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "display_name": "Corp login",
            "allowed_domains": ["corp.test"], "default_role": "viewer", "enforce": False, **over}
    return w["client"].put("/api/v1/admin/sso", json=body, headers=w["admin"])


def _start(w: dict[str, Any], idp: MockIdp) -> tuple[str, str]:
    """Run /start; returns (state, nonce) from the IdP redirect and records the PKCE challenge."""
    r = w["client"].get("/api/v1/auth/oidc/start", params={"next": "/objects"}, follow_redirects=False)
    assert r.status_code == 302, r.text
    loc = urlparse(r.headers["location"])
    assert f"{loc.scheme}://{loc.netloc}{loc.path}" == "https://idp.example.test/authorize"
    q = {k: v[0] for k, v in parse_qs(loc.query).items()}
    assert q["response_type"] == "code" and q["client_id"] == CLIENT_ID
    assert q["code_challenge_method"] == "S256" and q["scope"] == "openid email profile"
    assert q["redirect_uri"] == f"{BASE}/api/v1/auth/oidc/callback"  # from configuration
    idp.challenge = q["code_challenge"]
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "max-age=600" in cookie and "samesite=lax" in cookie
    return q["state"], q["nonce"]


def _callback(w: dict[str, Any], state: str, code: str = "good-code") -> httpx.Response:
    return w["client"].get("/api/v1/auth/oidc/callback", params={"code": code, "state": state}, follow_redirects=False)


def _signin(w: dict[str, Any], idp: MockIdp, sub: str, email: str, **claims: Any) -> httpx.Response:
    state, nonce = _start(w, idp)
    idp.claims = {"sub": sub, "email": email, "name": "Sam Example", "nonce": nonce, **claims}
    return _callback(w, state)


def _fragment_token(r: httpx.Response) -> str | None:
    loc = r.headers["location"]
    if not loc.startswith("/sign-in#"):
        return None
    return parse_qs(loc.split("#", 1)[1]).get("sso_token", [None])[0]


def _error(r: httpx.Response) -> str:
    assert r.status_code == 302 and r.headers["location"].startswith("/sign-in?"), r.headers.get("location")
    return parse_qs(urlparse(r.headers["location"]).query)["sso_error"][0]


def _rows(owner: Engine, sql: str, **p: Any) -> list[tuple[Any, ...]]:
    with owner.connect() as c:
        return [tuple(r) for r in c.execute(text(sql), p)]


def _audit_actions(owner: Engine) -> list[str]:
    return [r[0] for r in _rows(owner, "SELECT action FROM audit_log WHERE tenant_id = :t ORDER BY created_at", t=DEV)]


def test_code_pkce_happy_path_maps_by_email_then_subject(world: dict[str, Any], idp: MockIdp) -> None:
    w, owner = world, world["owner"]
    assert _put(w).status_code == 200
    pub = w["client"].get("/api/v1/auth/oidc/config").json()  # public: no token
    assert pub == {"enabled": True, "display_name": "Corp login", "enforce": False}

    uid, email = w["ids"]["viewer"], w["emails"]["viewer"]
    with owner.begin() as c:  # a locked account: SSO clears the lockout
        c.execute(text("UPDATE users SET failed_login_count = 7, locked_until = now() + interval '10 minutes' WHERE id = :u"), {"u": uid})
    r = _signin(w, idp, "sub-viewer", email)
    assert r.status_code == 302 and not idp.errors, idp.errors
    token = _fragment_token(r)
    assert token and parse_qs(r.headers["location"].split("#", 1)[1])["next"] == ["/objects"]
    assert "mn_auth_token=" in r.headers["set-cookie"]  # the same session cookie as password login
    me = w["client"].get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["user"]["email"] == email
    sub, last, count, locked = _rows(owner, "SELECT external_subject, last_login, failed_login_count, locked_until FROM users WHERE id = :u", u=uid)[0]
    assert sub == "sub-viewer" and last is not None and count == 0 and locked is None

    # next time the subject alone maps the user, even if the IdP now reports another address
    r = _signin(w, idp, "sub-viewer", f"renamed-{w['tag']}@corp.test")
    assert _fragment_token(r)
    assert _rows(owner, "SELECT COUNT(*) FROM users WHERE tenant_id = :t AND email LIKE :e", t=DEV, e=f"renamed-{w['tag']}%")[0][0] == 0
    assert "auth.sso_login" in _audit_actions(owner)


@pytest.mark.parametrize("case", ["bad_signature", "wrong_aud", "wrong_issuer", "nonce_mismatch", "expired", "hs256", "bad_code"])
def test_invalid_tokens_are_refused_without_a_session(world: dict[str, Any], idp: MockIdp, case: str) -> None:
    w = world
    assert _put(w).status_code == 200
    state, nonce = _start(w, idp)
    idp.claims = {"sub": "sub-x", "email": w["emails"]["viewer"], "nonce": nonce}
    code = "good-code"
    if case == "bad_signature":
        idp.sign_with = idp.other_key  # signed by a key the issuer does not publish
    elif case == "wrong_aud":
        idp.claims["aud"] = "someone-else"
    elif case == "wrong_issuer":
        idp.claims["iss"] = "https://evil.example.test"
    elif case == "nonce_mismatch":
        idp.claims["nonce"] = "not-the-issued-nonce"
    elif case == "expired":
        idp.claims["exp"] = int(time.time()) - 3600
    elif case == "hs256":  # an HMAC token keyed with the public JWKS material must never verify
        idp.alg, idp.sign_with = "HS256", CLIENT_SECRET
    elif case == "bad_code":
        code = "wrong-code"
    r = _callback(w, state, code)
    assert _fragment_token(r) is None and "mn_auth_token" not in r.headers.get("set-cookie", "")
    assert _error(r) in {"invalid_token", "failed"}
    assert _rows(w["owner"], "SELECT external_subject FROM users WHERE id = :u", u=w["ids"]["viewer"])[0][0] is None


def test_state_must_match_and_be_bound_to_the_browser(world: dict[str, Any], idp: MockIdp) -> None:
    w = world
    assert _put(w).status_code == 200
    state, nonce = _start(w, idp)
    idp.claims = {"sub": "sub-s", "email": w["emails"]["viewer"], "nonce": nonce}
    assert _error(_callback(w, "forged-state")) == "expired"
    assert idp.token_calls == 0  # refused before the code was redeemed
    w["client"].cookies.clear()  # another browser, or the state cookie expired
    assert _error(_callback(w, state)) == "expired"
    assert _error(w["client"].get("/api/v1/auth/oidc/callback", follow_redirects=False)) == "expired"
    assert _error(w["client"].get("/api/v1/auth/oidc/callback", params={"error": "access_denied", "state": "x"}, follow_redirects=False)) == "denied"


def test_state_cookie_expires_after_ten_minutes(world: dict[str, Any], idp: MockIdp) -> None:
    import jwt as pyjwt

    w = world
    assert _put(w).status_code == 200
    state, nonce = _start(w, idp)
    old = pyjwt.encode({"purpose": "oidc_state", "state": state, "nonce": nonce, "cv": "x" * 64, "nxt": "/home",
                        "exp": int(time.time()) - 5}, w["secret"], algorithm="HS256")
    w["client"].cookies.clear()
    w["client"].cookies.set("mn_oidc_state", old, path="/api/v1/auth/oidc")
    assert _error(_callback(w, state)) == "expired"


def test_jit_provisions_a_viewer_with_no_grants(world: dict[str, Any], idp: MockIdp) -> None:
    w, owner = world, world["owner"]
    assert _put(w).status_code == 200
    email = f"new-{w['tag']}@Corp.Test"
    r = _signin(w, idp, f"sub-new-{w['tag']}", email)
    token = _fragment_token(r)
    assert token
    uid, role, active, pw, subject = _rows(owner, "SELECT id, role, is_active, password_hash, external_subject FROM users WHERE tenant_id = :t AND email = :e",
                                           t=DEV, e=email.lower())[0]
    assert (role, active, pw, subject) == ("viewer", True, None, f"sub-new-{w['tag']}")
    assert _rows(owner, "SELECT COUNT(*) FROM user_role_scopes WHERE user_id = :u", u=uid)[0][0] == 0
    eff = w["client"].get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["user"]
    assert eff["role"] == "viewer" and "manage_users" not in eff["permissions"]
    actions = _audit_actions(owner)
    assert "auth.sso_user_created" in actions and "auth.sso_login" in actions


def test_disallowed_domain_and_suspended_users_are_refused(world: dict[str, Any], idp: MockIdp) -> None:
    w, owner = world, world["owner"]
    assert _put(w).status_code == 200
    email = f"out-{w['tag']}@other.test"
    assert _error(_signin(w, idp, "sub-out", email)) == "domain_not_allowed"
    assert _rows(owner, "SELECT COUNT(*) FROM users WHERE email = :e", e=email)[0][0] == 0
    # an existing local user on a disallowed domain is not linked by email either
    with owner.begin() as c:
        c.execute(text("UPDATE users SET email = :e WHERE id = :u"), {"e": f"v-{w['tag']}@other.test", "u": w["ids"]["viewer"]})
    assert _error(_signin(w, idp, "sub-v", f"v-{w['tag']}@other.test")) == "domain_not_allowed"

    with owner.begin() as c:
        c.execute(text("UPDATE users SET email = :e, is_active = false WHERE id = :u"), {"e": w["emails"]["viewer"], "u": w["ids"]["viewer"]})
    assert _error(_signin(w, idp, "sub-susp", w["emails"]["viewer"])) == "suspended"
    assert "auth.sso_refused" in _audit_actions(owner)
    from api.routes.auth_oidc import ERROR_SENTENCES
    assert ERROR_SENTENCES["domain_not_allowed"].endswith("Ask an administrator.")

    with owner.begin() as c:  # a linked identity cannot be taken over by a different subject with the same email
        c.execute(text("UPDATE users SET is_active = true, external_subject = 'sub-original' WHERE id = :u"), {"u": w["ids"]["viewer"]})
    assert _error(_signin(w, idp, "sub-other", w["emails"]["viewer"])) == "subject_conflict"


def test_enforce_blocks_password_login_except_administrators(world: dict[str, Any], idp: MockIdp) -> None:
    w = world
    login = lambda who, pw=PASSWORD: w["client"].post("/api/v1/auth/login", json={"email": w["emails"].get(who, who), "password": pw})  # noqa: E731
    assert login("viewer").status_code == 200
    assert _put(w, enforce=True).status_code == 200
    assert w["client"].get("/api/v1/auth/oidc/config").json()["enforce"] is True
    r = login("viewer")
    assert r.status_code == 403 and "single sign-on" in r.json()["detail"] and "token" not in r.json()
    assert login("nobody@corp.test").status_code == 403  # unknown emails learn nothing either
    assert login("admin").status_code == 200  # break-glass
    assert _put(w, enforce=False).status_code == 200
    assert login("viewer").status_code == 200


def test_enforce_needs_a_password_administrator_and_a_reachable_provider(world: dict[str, Any], idp: MockIdp, monkeypatch: pytest.MonkeyPatch) -> None:
    w, owner = world, world["owner"]
    from api.services import oidc

    monkeypatch.setattr(oidc, "http_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503))))
    r = _put(w, enforce=True)
    assert r.status_code == 422 and "reachable" in r.json()["detail"]
    monkeypatch.setattr(oidc, "http_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(idp.handle)))
    with owner.begin() as c:  # no administrator with a password anywhere in the tenant
        before = c.execute(text("SELECT id, password_hash FROM users WHERE tenant_id = :t AND role IN ('admin','platform_admin') AND password_hash IS NOT NULL"), {"t": DEV}).fetchall()
        c.execute(text("UPDATE users SET password_hash = NULL WHERE tenant_id = :t AND role IN ('admin','platform_admin')"), {"t": DEV})
    try:
        r = _put(w, enforce=True)
        assert r.status_code == 422 and "administrator" in r.json()["detail"]
    finally:
        with owner.begin() as c:
            for uid, ph in before:
                c.execute(text("UPDATE users SET password_hash = :p WHERE id = :u"), {"p": ph, "u": uid})


def test_secret_is_encrypted_write_only_and_audited_without_it(world: dict[str, Any], idp: MockIdp) -> None:
    from api.services.crypto import decrypt_api_key

    w, owner = world, world["owner"]
    r = _put(w)
    assert r.status_code == 200 and CLIENT_SECRET not in r.text
    assert r.json()["has_secret"] is True and "client_secret" not in r.json()
    assert r.json()["redirect_uri"] == f"{BASE}/api/v1/auth/oidc/callback"
    got = w["client"].get("/api/v1/admin/sso", headers=w["admin"])
    assert got.status_code == 200 and CLIENT_SECRET not in got.text and "encrypted" not in got.text
    stored = _rows(owner, "SELECT sso_config FROM tenants WHERE id = :t", t=DEV)[0][0]
    assert CLIENT_SECRET not in json.dumps(stored)
    assert stored["client_secret_encrypted"] and decrypt_api_key(stored["client_secret_encrypted"], w["secret"]) == CLIENT_SECRET

    # omitted secret keeps the stored one; changing the issuer without a secret is refused
    kept = _put(w, client_secret=None, display_name="Renamed")
    assert kept.status_code == 200 and kept.json()["display_name"] == "Renamed"
    assert _rows(owner, "SELECT sso_config FROM tenants WHERE id = :t", t=DEV)[0][0]["client_secret_encrypted"] == stored["client_secret_encrypted"]
    moved = _put(w, client_secret=None, issuer="https://other.example.test")
    assert moved.status_code == 422 and "again" in moved.json()["detail"]
    assert _put(w, allowed_domains=["not a domain"]).status_code == 422
    assert _put(w, issuer="http://idp.example.test").status_code == 422  # https only off localhost

    rows = _rows(owner, "SELECT action, before_json, after_json FROM audit_log WHERE tenant_id = :t AND action = 'sso.config_change'", t=DEV)
    assert rows and CLIENT_SECRET not in json.dumps(rows, default=str) and stored["client_secret_encrypted"] not in json.dumps(rows, default=str)
    assert rows[0][2]["has_secret"] is True and rows[0][2]["issuer"] == ISSUER


def test_admin_routes_need_manage_users_and_test_reports_a_sentence(world: dict[str, Any], idp: MockIdp, monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services.local_auth import create_access_token

    w = world
    viewer = {"Authorization": "Bearer " + create_access_token(w["ids"]["viewer"], DEV, w["emails"]["viewer"], "viewer", w["secret"], 0)}
    assert w["client"].get("/api/v1/admin/sso", headers=viewer).status_code == 403
    assert w["client"].put("/api/v1/admin/sso", json={}, headers=viewer).status_code in (403, 422)
    assert w["client"].post("/api/v1/admin/sso/test", json={}, headers=viewer).status_code == 403
    assert w["client"].get("/api/v1/admin/sso").status_code == 401

    ok = w["client"].post("/api/v1/admin/sso/test", json={"issuer": ISSUER}, headers=w["admin"]).json()
    assert ok["ok"] is True and "callback" in ok["message"]
    empty = w["client"].post("/api/v1/admin/sso/test", json={}, headers=w["admin"]).json()
    assert empty == {"ok": False, "message": "Enter the issuer first."}
    from api.services import oidc
    monkeypatch.setattr(oidc, "http_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404))))
    bad = w["client"].post("/api/v1/admin/sso/test", json={"issuer": ISSUER}, headers=w["admin"]).json()
    assert bad["ok"] is False and "404" in bad["message"] and "Traceback" not in bad["message"]


def test_not_configured_and_removed(world: dict[str, Any], idp: MockIdp) -> None:
    w = world
    assert w["client"].get("/api/v1/auth/oidc/config").json() == {"enabled": False, "display_name": None, "enforce": False}
    r = w["client"].get("/api/v1/auth/oidc/start", follow_redirects=False)
    assert _error(r) == "not_configured"
    assert _put(w, enforce=True).status_code == 200
    gone = w["client"].delete("/api/v1/admin/sso", headers=w["admin"])
    assert gone.status_code == 200 and gone.json()["configured"] is False
    assert w["client"].get("/api/v1/auth/oidc/config").json()["enabled"] is False
    assert w["client"].post("/api/v1/auth/login", json={"email": w["emails"]["viewer"], "password": PASSWORD}).status_code == 200
    assert "sso.config_remove" in _audit_actions(w["owner"])


def test_next_is_never_an_open_redirect() -> None:
    from api.services.oidc import safe_next

    for bad in ("https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", None, "/a\nb"):
        assert safe_next(bad) == "/"
    assert safe_next("/work?x=1") == "/work?x=1"


def test_migration_098_up_and_down(owner: Engine) -> None:
    from tests.test_rbac_escalation_pg import _alembic

    def cols() -> set[str]:
        return {r[0] + "." + r[1] for r in _rows(owner, "SELECT table_name, column_name FROM information_schema.columns "
                                                         "WHERE (table_name, column_name) IN (('tenants','sso_config'), ('users','external_subject'))")}

    assert cols() == {"tenants.sso_config", "users.external_subject"}
    _alembic("downgrade", "097")
    assert cols() == set()
    _alembic("upgrade", "head")
    assert cols() == {"tenants.sso_config", "users.external_subject"}
    with owner.begin() as c:  # unique per tenant where set; NULLs repeat freely
        tid = str(uuid.uuid4())
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'U')"), {"t": tid})
        for n in range(2):
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (gen_random_uuid(), :t, :e, 'n', 'viewer')"), {"t": tid, "e": f"n{n}@x.test"})
        c.execute(text("UPDATE users SET external_subject = 's' WHERE email = 'n0@x.test' AND tenant_id = :t"), {"t": tid})
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError), owner.begin() as c:
        c.execute(text("UPDATE users SET external_subject = 's' WHERE email = 'n1@x.test' AND tenant_id = :t"), {"t": tid})
