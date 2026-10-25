"""PUT /api/v1/systems/{id} changes the OAuth token URL in the sap_systems column it was
stored in at connect time, and the system's response carries it back to the edit form."""

import uuid

import pytest

from api.deps import Tenant
from api.routes.systems import UpdateSystemRequest, update_system

TENANT = Tenant(uuid.uuid4(), "Acme", [])
SID = str(uuid.uuid4())


class _Row:
    def __init__(self, token_url):
        self.token_url = token_url

    def fetchone(self):
        return (SID, "BTP", "btp", None, None, None, None, "https://api.example", None,
                "oauth2_client_credentials", None, "PRD", True, "2026-01-01", "2026-01-02",
                "source", None, self.token_url)


class _DB:
    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []
        self.token_url = "https://old.example/oauth/token"

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, params))
        if sql.startswith("UPDATE sap_systems SET") and params and "token_url" in params:
            self.token_url = params["token_url"]
        return _Row(self.token_url)

    async def commit(self):
        pass


async def _update(db, **body):
    return await update_system(SID, UpdateSystemRequest(**body), request=None, db=db, tenant=TENANT, role="admin")


@pytest.mark.asyncio
async def test_token_url_is_updated_on_the_system_row():
    db = _DB()
    res = await _update(db, token_url=" https://new.example/oauth/token ")
    update = next((sql, p) for sql, p in db.calls if sql.startswith("UPDATE sap_systems SET"))
    assert "token_url = :token_url" in update[0] and "tenant_id = :tid" in update[0]
    assert update[1]["token_url"] == "https://new.example/oauth/token"
    assert update[1]["tid"] == str(TENANT.id)
    assert res.token_url == "https://new.example/oauth/token"


@pytest.mark.asyncio
async def test_empty_token_url_clears_it_and_absent_keeps_it():
    db = _DB()
    await _update(db, token_url="")
    assert db.token_url is None

    db = _DB()
    res = await _update(db, name="BTP")
    assert all("token_url" not in sql for sql, _ in db.calls if sql.startswith("UPDATE"))
    assert res.token_url == "https://old.example/oauth/token"
