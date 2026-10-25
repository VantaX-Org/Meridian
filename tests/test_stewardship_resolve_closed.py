"""POST /stewardship/{id}/resolve on a task that is no longer open returns 409 before touching the source record."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import api.routes.stewardship as st
from api.deps import Tenant

TENANT = Tenant(uuid.uuid4(), "Acme", [])


def _row(status: str) -> tuple:
    now = datetime.now(timezone.utc)
    return (uuid.uuid4(), TENANT.id, "writeback_approval", uuid.uuid4(), "material_master", 2, None, None, status,
            24, now, now, None, None) + (None,) * 8


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, row):
        self.row = row
        self.calls: list[str] = []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append(sql)
        return _Result(self.row if sql.startswith("SELECT") else None)

    async def commit(self):
        pass


@pytest.fixture(autouse=True)
def _roles(monkeypatch):
    async def role(*a, **k):
        return "steward"

    async def uid(*a, **k):
        return str(uuid.uuid4())

    applied: list = []

    async def apply(*a, **k):
        applied.append(a)

    monkeypatch.setattr(st, "_get_user_role", role)
    monkeypatch.setattr(st, "_resolve_user_id", uid)
    monkeypatch.setattr(st, "_apply_source_action", apply)
    return applied


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["resolved", "accepted", "dismissed"])
async def test_closed_task_is_409_and_nothing_applied(status, _roles):
    db = _DB(_row(status))
    with pytest.raises(HTTPException) as exc:
        await st.resolve_queue_item(str(uuid.uuid4()), st.ResolveBody(action="approve"), SimpleNamespace(state=SimpleNamespace()),
                                    db=db, tenant=TENANT, _role="steward")
    assert exc.value.status_code == 409
    assert _roles == []
    assert not any(sql.startswith("UPDATE") for sql in db.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["open", "in_progress", "escalated"])
async def test_open_task_is_resolved(status, _roles):
    db = _DB(_row(status))
    res = await st.resolve_queue_item(str(uuid.uuid4()), st.ResolveBody(action="approve"), SimpleNamespace(state=SimpleNamespace()),
                                      db=db, tenant=TENANT, _role="steward")
    assert res["status"] == "resolved"
    assert len(_roles) == 1
