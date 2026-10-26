"""POST /api/v1/systems/{id}/test-connection tries the edit form's unsaved fields, with the
stored secret standing in for one the user left empty, read from this tenant's row only. A
changed endpoint (host, client, sysnr, base URL, token URL, auth type) never gets a stored
secret: every secret the connection uses must be retyped, else 422."""

import uuid

import pytest
from fastapi import HTTPException

import api.routes.systems as systems
from api.deps import Tenant
from api.routes.systems import RegisterSystemRequest

ConnResult = systems.TestConnectionResponse
edited_test = systems.test_edited_connection

TENANT = Tenant(uuid.uuid4(), "Acme", [])
SID = str(uuid.uuid4())


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    """The stored system: an ECC row with an encrypted password, or none (another tenant's id)."""

    def __init__(self, row):
        self.row = row
        self.calls: list[tuple[str, dict | None]] = []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, params))
        return _Result(self.row if sql.startswith("SELECT") else None)


@pytest.fixture
def captured(monkeypatch):
    seen: dict = {}

    def fake_run(system_type: str, params: dict, secrets: list[str]) -> ConnResult:
        seen.update(system_type=system_type, params=params, secrets=secrets)
        return ConnResult(connected=True, message="Connection successful")

    monkeypatch.setattr(systems, "_run_connection_test", fake_run)
    import api.services.credential_store as store
    monkeypatch.setattr(store, "decrypt_password", lambda tid, value: f"plain:{value}:{tid}")
    return seen


def _body(**kw) -> RegisterSystemRequest:
    return RegisterSystemRequest(name="ECC Prod", system_type="ecc", environment="PRD", **kw)


ECC_ROW = ("ecc", "rfc", None, None, None, "enc-pw", "old-host.internal", "200", "01", None, None)
SF_ROW = ("successfactors", "basic", "enc-id", "enc-secret", None, "enc-pw", None, None, None,
          "https://api.old.example", None)


@pytest.mark.asyncio
async def test_unchanged_endpoint_is_tried_with_the_stored_password(captured):
    db = _DB(ECC_ROW)
    res = await edited_test(
        SID, _body(host="old-host.internal", client="200", sysnr="01", username="NEWUSER"),
        db=db, tenant=TENANT, role="admin",
    )
    assert res.connected
    assert captured["system_type"] == "ecc"
    assert captured["params"]["host"] == "old-host.internal"
    assert captured["params"]["user"] == "NEWUSER"
    assert captured["params"]["password"] == f"plain:enc-pw:{TENANT.id}"
    assert captured["params"]["password"] in captured["secrets"]  # masked in any error message
    select = next((sql, p) for sql, p in db.calls if sql.startswith("SELECT"))
    assert "s.tenant_id = :tid" in select[0]
    assert select[1] == {"sid": SID, "tid": str(TENANT.id)}


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("host", "attacker.example"), ("client", "300"), ("sysnr", "99"),
])
async def test_a_changed_rfc_endpoint_without_the_password_is_refused(captured, field, value):
    fields = {"host": "old-host.internal", "client": "200", "sysnr": "01", field: value}
    with pytest.raises(HTTPException) as e:
        await edited_test(SID, _body(**fields), db=_DB(ECC_ROW), tenant=TENANT, role="admin")
    assert e.value.status_code == 422
    assert "Re-enter the password" in e.value.detail
    assert captured == {}  # nothing was sent anywhere


@pytest.mark.asyncio
async def test_a_changed_host_with_the_password_retyped_is_tried_with_it(captured):
    await edited_test(
        SID, _body(host="new-host.internal", client="200", sysnr="01", credentials={"password": "typed"}),
        db=_DB(ECC_ROW), tenant=TENANT, role="admin",
    )
    assert captured["params"]["host"] == "new-host.internal"
    assert captured["params"]["password"] == "typed"


@pytest.mark.asyncio
async def test_a_typed_secret_wins_over_the_stored_one(captured):
    db = _DB(ECC_ROW)
    await edited_test(
        SID, _body(host="old-host.internal", client="200", sysnr="01", credentials={"password": "typed"}),
        db=db, tenant=TENANT, role="admin",
    )
    assert captured["params"]["password"] == "typed"


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [
    ("base_url", "https://attacker.example"), ("token_url", "https://attacker.example/token"),
    ("auth_type", "oauth2_client_credentials"),
])
async def test_a_changed_cloud_endpoint_without_the_secrets_is_refused(captured, field, value):
    fields = {"base_url": "https://api.old.example", field: value}
    body = RegisterSystemRequest(name="SF", system_type="successfactors", username="svc", **fields)
    with pytest.raises(HTTPException) as e:
        await edited_test(SID, body, db=_DB(SF_ROW), tenant=TENANT, role="admin")
    assert e.value.status_code == 422
    assert "Re-enter" in e.value.detail
    assert captured == {}


@pytest.mark.asyncio
async def test_a_changed_cloud_endpoint_never_falls_back_to_a_stored_secret(captured):
    body = RegisterSystemRequest(
        name="SF", system_type="successfactors", base_url="https://api.new.example", username="svc",
        credentials={"password": "typed"},
    )
    await edited_test(SID, body, db=_DB(SF_ROW), tenant=TENANT, role="admin")
    p = captured["params"]
    assert p["password"] == "typed"
    assert p["client_id"] == "" and p["client_secret"] == ""  # stored ones stay home


@pytest.mark.asyncio
async def test_cloud_falls_back_per_secret_and_keeps_the_stored_type_and_auth(captured):
    db = _DB(SF_ROW)
    body = RegisterSystemRequest(
        name="SF", system_type="ecc", base_url="https://api.old.example", company_id="ACME", username="svc",
        credentials={"client_secret": "typed-secret"},
    )
    await edited_test(SID, body, db=db, tenant=TENANT, role="admin")
    assert captured["system_type"] == "successfactors"  # never the body's type
    p = captured["params"]
    assert p["base_url"] == "https://api.old.example"
    assert p["auth_type"] == "basic"
    assert p["username"] == "svc"
    assert p["client_secret"] == "typed-secret"
    assert p["client_id"] == f"plain:enc-id:{TENANT.id}"
    assert p["password"] == f"plain:enc-pw:{TENANT.id}"


@pytest.mark.asyncio
async def test_a_system_outside_the_tenant_is_not_found(captured):
    db = _DB(None)
    with pytest.raises(HTTPException) as e:
        await edited_test(SID, _body(host="h"), db=db, tenant=TENANT, role="admin")
    assert e.value.status_code == 404
    assert captured == {}


@pytest.mark.asyncio
async def test_a_stored_secret_that_cannot_be_decrypted_says_so_without_detail(captured, monkeypatch):
    import api.services.credential_store as store

    def boom(tid, value):
        raise ValueError("bad key material abc123")

    monkeypatch.setattr(store, "decrypt_password", boom)
    db = _DB(ECC_ROW)
    res = await edited_test(SID, _body(host="old-host.internal"), db=db, tenant=TENANT, role="admin")
    assert not res.connected
    assert "abc123" not in res.message
    assert captured == {}
