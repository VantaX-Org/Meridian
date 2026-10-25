"""PUT /exceptions/{id}/assign: the assignee is notified only when it is a user of this tenant; any other id
(exceptions.assigned_to has no FK) is assigned without a notification instead of a 500 on notifications' FK."""

import uuid

import pytest

import api.routes.exceptions as exc
from api.deps import Tenant

TENANT = Tenant(uuid.uuid4(), "Acme", [])


class _Res:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return self.value

    def scalar(self):
        return self.value


class _DB:
    def __init__(self, is_user: bool):
        self.is_user = is_user
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, dict(params or {})))
        if sql.startswith("UPDATE exceptions"):
            return _Res(("e1",))
        if "FROM users" in sql:
            return _Res(1 if self.is_user else None)
        if "SELECT title" in sql:
            return _Res("Duplicate vendor")
        return _Res(None)

    async def commit(self):
        pass


@pytest.fixture
def sent(monkeypatch):
    out: list[tuple] = []

    async def fake(*a, **k):
        out.append(a)

    monkeypatch.setattr(exc, "create_notification", fake)
    return out


@pytest.mark.asyncio
async def test_a_non_user_assignee_is_assigned_without_a_notification(sent):
    db = _DB(is_user=False)
    res = await exc.assign_exception(str(uuid.uuid4()), exc.AssignBody(user_id="finance-team", user_name="Finance"),
                                     db=db, tenant=TENANT)
    assert res["assigned_to"] == "finance-team"
    assert sent == []
    check = next((sql, p) for sql, p in db.calls if "FROM users" in sql)
    assert "id::text = :uid" in check[0] and check[1]["tid"] == str(TENANT.id)


@pytest.mark.asyncio
async def test_a_user_assignee_is_notified(sent):
    uid = str(uuid.uuid4())
    await exc.assign_exception(str(uuid.uuid4()), exc.AssignBody(user_id=uid, user_name="Pat"), db=_DB(is_user=True), tenant=TENANT)
    assert len(sent) == 1 and sent[0][1] == uid and "Duplicate vendor" in sent[0][3]
