"""GET /api/v1/auth/invite/{token}: the grants preview shown before the invitee sets a password."""
import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from api.middleware.local_auth import DEV_TENANT_ID
from api.services.local_auth import create_access_token, create_invite_token, create_password_reset_token

DB = os.environ.get("MERIDIAN_TEST_DB_URL")
pytestmark = pytest.mark.skipif(not DB, reason="needs MERIDIAN_TEST_DB_URL")
SECRET = "invite-preview-secret"
PREVIEW = "/api/v1/auth/invite/preview"


@pytest.fixture()
def seeded(monkeypatch):
    eng = create_engine(DB)
    uid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'T') ON CONFLICT (id) DO NOTHING"), {"t": DEV_TENANT_ID})
        c.execute(text("UPDATE tenants SET jwt_secret = :s WHERE id = :t"), {"s": SECRET, "t": DEV_TENANT_ID})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'N', 'viewer')"),
                  {"u": uid, "t": DEV_TENANT_ID, "e": f"{uid}@example.com"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'Sys A', 'ECC')"), {"s": sid, "t": DEV_TENANT_ID})
        c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key, system_id, module) VALUES (:t, :u, 'steward', :s, 'material')"),
                  {"t": DEV_TENANT_ID, "u": uid, "s": sid})
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: SECRET)
    from api.main import app
    yield TestClient(app), uid, sid, eng
    with eng.begin() as c:
        c.execute(text("DELETE FROM user_role_scopes WHERE user_id = :u"), {"u": uid})
        c.execute(text("DELETE FROM users WHERE id = :u"), {"u": uid})
        c.execute(text("DELETE FROM sap_systems WHERE id = :s"), {"s": sid})


def test_valid_token_returns_email_and_grants(seeded):
    client, uid, sid, _ = seeded
    r = client.post(PREVIEW, json={"token": create_invite_token(uid, DEV_TENANT_ID, SECRET)})
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == f"{uid}@example.com"
    assert body["grants"] == [{"role_key": "steward", "role_label": body["grants"][0]["role_label"],
                               "system_id": sid, "system_name": "Sys A", "module": "material"}]
    assert body["grants"][0]["role_label"] != ""


def test_invalid_token_is_generic_404(seeded):
    client, *_ = seeded
    r = client.post(PREVIEW, json={"token": "not-a-token"})
    assert r.status_code == 404 and r.json() == {"detail": "Not found"}


def test_expired_token_is_404(seeded):
    client, uid, *_ = seeded
    now = datetime.now(timezone.utc)
    tok = jwt.encode({"sub": uid, "purpose": "invite_accept", "iat": now - timedelta(days=9), "exp": now - timedelta(days=2)}, SECRET, algorithm="HS256")
    assert client.post(PREVIEW, json={"token": tok}).status_code == 404


def test_used_token_is_404(seeded):
    client, uid, _, eng = seeded
    with eng.begin() as c:
        c.execute(text("UPDATE users SET password_hash = 'x' WHERE id = :u"), {"u": uid})
    assert client.post(PREVIEW, json={"token": create_invite_token(uid, DEV_TENANT_ID, SECRET)}).status_code == 404


def test_inactive_user_is_404_and_cannot_accept(seeded):
    client, uid, _, eng = seeded
    with eng.begin() as c:
        c.execute(text("UPDATE users SET is_active = false WHERE id = :u"), {"u": uid})
    tok = create_invite_token(uid, DEV_TENANT_ID, SECRET)
    assert client.post(PREVIEW, json={"token": tok}).status_code == 404
    r = client.post("/api/v1/auth/accept-invite", json={"token": tok, "password": "a-long-enough-password"})
    assert r.status_code == 409


def test_unauthenticated_posts_reach_handlers(seeded):
    client, *_ = seeded
    for path, body in [
        ("/api/v1/auth/accept-invite", {"token": "x", "password": "a-long-enough-password"}),
        ("/api/v1/auth/forgot-password", {"email": "nobody@example.com"}),
        ("/api/v1/auth/reset-password", {"token": "x", "password": "a-long-enough-password"}),
        (PREVIEW, {"token": "x"}),
    ]:
        r = client.post(path, json=body)
        assert r.json().get("detail") != "Not authenticated", path


def test_purpose_tokens_are_not_bearer_tokens(seeded):
    client, uid, *_ = seeded
    for tok in (create_invite_token(uid, DEV_TENANT_ID, SECRET), create_password_reset_token(uid, DEV_TENANT_ID, SECRET)):
        assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
    session = create_access_token(uid, DEV_TENANT_ID, f"{uid}@example.com", "viewer", SECRET)
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {session}"}).status_code == 200
