"""DELETE /api/v1/systems/{id}/profiles/{profile_id}: a non-UUID id is a clean 404, never an asyncpg cast 500."""

import uuid

import pytest
from fastapi import HTTPException

import api.routes.systems as systems
from api.deps import Tenant

TENANT = Tenant(uuid.uuid4(), "Acme", [])


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, row=None):
        self.row = row
        self.calls: list[str] = []
        self.committed = False

    async def execute(self, stmt, params=None):
        self.calls.append(str(stmt))
        return _Result(self.row)

    async def commit(self):
        self.committed = True


@pytest.mark.asyncio
@pytest.mark.parametrize("sid,pid", [("not-a-uuid", str(uuid.uuid4())), (str(uuid.uuid4()), "nope")])
async def test_non_uuid_ids_are_404_without_a_query(sid, pid):
    db = _DB()
    with pytest.raises(HTTPException) as exc:
        await systems.delete_sync_profile(sid, pid, db=db, tenant=TENANT, role="admin")
    assert exc.value.status_code == 404 and exc.value.detail == "Schedule not found"
    assert db.calls == []


@pytest.mark.asyncio
async def test_a_valid_profile_is_deleted_in_this_tenant():
    db = _DB(row=("p",))
    await systems.delete_sync_profile(str(uuid.uuid4()), str(uuid.uuid4()), db=db, tenant=TENANT, role="admin")
    assert db.committed
    assert any("tenant_id = :tid" in sql for sql in db.calls if sql.startswith("DELETE"))
