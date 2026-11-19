"""POST /api/v1/auth/forgot-password: an invitee who never set a password gets a fresh invite, not silence."""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from api.middleware.local_auth import DEV_TENANT_ID

DB = os.environ.get("MERIDIAN_TEST_DB_URL")
pytestmark = pytest.mark.skipif(not DB, reason="needs MERIDIAN_TEST_DB_URL")
SECRET = "forgot-invitee-secret"


@pytest.fixture()
def client_and_user(monkeypatch):
    eng = create_engine(DB)
    uid = str(uuid.uuid4())
    email = f"{uid}@example.com"
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'T') ON CONFLICT (id) DO NOTHING"), {"t": DEV_TENANT_ID})
        c.execute(text("UPDATE tenants SET jwt_secret = :s WHERE id = :t"), {"s": SECRET, "t": DEV_TENANT_ID})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'N', 'viewer')"),
                  {"u": uid, "t": DEV_TENANT_ID, "e": email})
    sent: dict[str, list] = {"invite": [], "reset": []}
    monkeypatch.setattr("workers.tasks.send_user_invitation.send_invitation_email.delay",
                        lambda **kw: sent["invite"].append(kw))
    monkeypatch.setattr("workers.tasks.send_password_reset.send_password_reset_email.delay",
                        lambda **kw: sent["reset"].append(kw))
    from api.main import app
    yield TestClient(app), uid, email, eng, sent
    with eng.begin() as c:
        c.execute(text("DELETE FROM users WHERE id = :u"), {"u": uid})


def test_invitee_without_password_gets_new_invite(client_and_user):
    client, uid, email, eng, sent = client_and_user
    r = client.post("/api/v1/auth/forgot-password", json={"email": email.upper()})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert len(sent["invite"]) == 1 and sent["invite"][0]["user_id"] == uid and sent["invite"][0]["invite_token"]
    assert sent["reset"] == []
    with eng.connect() as c:
        status = c.execute(text("SELECT invite_status FROM users WHERE id = :u"), {"u": uid}).scalar_one()
    assert status == "queued"


def test_user_with_password_gets_reset_link(client_and_user):
    client, uid, email, eng, sent = client_and_user
    with eng.begin() as c:
        c.execute(text("UPDATE users SET password_hash = 'x' WHERE id = :u"), {"u": uid})
    r = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    assert len(sent["reset"]) == 1 and sent["invite"] == []
