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


class _Stored:
    def __init__(self, token_url):
        self.token_url = token_url

    def fetchone(self):
        return ("btp", "oauth2_client_credentials", "enc-id", "enc-secret", None, None,
                None, None, None, "https://api.example", self.token_url)


class _DB:
    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []
        self.token_url = "https://old.example/oauth/token"

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, params))
        if "client_id_encrypted" in sql and sql.startswith("SELECT"):  # the stored endpoint + secrets
            return _Stored(self.token_url)
        if sql.startswith("UPDATE sap_systems SET") and params and "token_url" in params:
            self.token_url = params["token_url"]
        return _Row(self.token_url)

    async def commit(self):
        pass


@pytest.fixture(autouse=True)
def _plain_encrypt(monkeypatch):
    import api.services.credential_store as store
    monkeypatch.setattr(store, "encrypt_password", lambda tid, value: f"enc:{value}")


async def _update(db, **body):
    return await update_system(SID, UpdateSystemRequest(**body), request=None, db=db, tenant=TENANT, role="admin")


@pytest.mark.asyncio
async def test_token_url_is_updated_on_the_system_row():
    db = _DB()
    res = await _update(db, token_url=" https://new.example/oauth/token ",
                        credentials={"client_id": "id", "client_secret": "secret"})
    update = next((sql, p) for sql, p in db.calls if sql.startswith("UPDATE sap_systems SET"))
    assert "token_url = :token_url" in update[0] and "tenant_id = :tid" in update[0]
    assert update[1]["token_url"] == "https://new.example/oauth/token"
    assert update[1]["tid"] == str(TENANT.id)
    assert res.token_url == "https://new.example/oauth/token"


@pytest.mark.asyncio
async def test_empty_token_url_clears_it_and_absent_keeps_it():
    db = _DB()
    await _update(db, token_url="", credentials={"client_id": "id", "client_secret": "secret"})
    assert db.token_url is None

    db = _DB()
    res = await _update(db, name="BTP")
    assert all("token_url" not in sql for sql, _ in db.calls if sql.startswith("UPDATE"))
    assert res.token_url == "https://old.example/oauth/token"


@pytest.mark.asyncio
async def test_a_token_url_change_without_new_secrets_is_refused():
    """The stored client secret would otherwise be posted to the new token URL on the next sync."""
    from fastapi import HTTPException

    db = _DB()
    with pytest.raises(HTTPException) as e:
        await _update(db, token_url="https://attacker.example/oauth/token")
    assert e.value.status_code == 422
    assert "Re-enter the client ID, client secret" in e.value.detail
    assert not any(sql.startswith("UPDATE") for sql, _ in db.calls)
    assert db.token_url == "https://old.example/oauth/token"


@pytest.mark.asyncio
async def test_a_base_url_change_without_new_secrets_is_refused_but_a_rename_is_not():
    from fastapi import HTTPException

    db = _DB()
    with pytest.raises(HTTPException) as e:
        await _update(db, base_url="https://attacker.example", credentials={"client_id": "id"})
    assert e.value.status_code == 422 and "client secret" in e.value.detail
    res = await _update(_DB(), name="Renamed", base_url="https://api.example", token_url="https://old.example/oauth/token")
    assert res.id == SID
