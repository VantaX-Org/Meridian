"""write_audit names the person who acted: the users row's email wins over an empty session context ("system")."""
import asyncio
import uuid
from types import SimpleNamespace

from api.services import rbac

TENANT = uuid.UUID("00000000-0000-0000-0000-000000000001")
USER = "0714a662-738f-4bd1-880c-0f8c01e0241c"


class FakeDB:
    def __init__(self, email):
        self.email, self.inserted = email, None

    async def execute(self, stmt, params):
        if str(stmt).startswith("SELECT email"):
            return SimpleNamespace(fetchone=lambda: (self.email,) if self.email is not None else None)
        self.inserted = params
        return None


def _request():
    return SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/v1/users/x/invite/resend"),
                           state=SimpleNamespace(local_user_id=USER))


def test_known_user_email_beats_empty_context(monkeypatch):
    monkeypatch.setattr("api.middleware.local_auth.get_current_user", lambda: None)
    db = FakeDB("admin@example.com")
    asyncio.run(rbac.write_audit(db, TENANT, _request(), "user.invite_resend", "user", "x", None, None))
    assert db.inserted["e"] == "admin@example.com" and db.inserted["u"] == USER


def test_unknown_user_falls_back_to_system(monkeypatch):
    monkeypatch.setattr("api.middleware.local_auth.get_current_user", lambda: None)
    db = FakeDB(None)
    asyncio.run(rbac.write_audit(db, TENANT, _request(), "user.invite_resend", "user", "x", None, None))
    assert db.inserted["e"] == "system" and db.inserted["u"] is None
