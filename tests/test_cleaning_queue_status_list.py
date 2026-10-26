"""GET /cleaning/queue?status=detected,recommended lists every waiting proposal (the set the groups count)."""

import uuid

import pytest

import api.routes.cleaning as cleaning
from api.deps import Tenant


class _Res:
    def scalar(self):
        return 0

    def fetchall(self):
        return []


class _DB:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        self.calls.append((" ".join(str(stmt).split()), dict(params or {})))
        return _Res()


async def _list(status: str | None) -> _DB:
    cleaning._TOTAL_CACHE.clear()
    db = _DB()
    await cleaning.list_cleaning_queue(status=status, object_type=None, rule_id=None, assigned_to=None, batch_id=None,
                                       version_id=None, kind=None, page=1, per_page=20, db=db,
                                       tenant=Tenant(uuid.uuid4(), "T", []))
    return db


@pytest.mark.asyncio
async def test_several_statuses_are_one_in_list():
    db = await _list("detected,recommended")
    sql, params = next(c for c in db.calls if "FROM cleaning_queue" in c[0] and "COUNT" in c[0])
    assert "status IN (:st0, :st1)" in sql and "tenant_id = :tid" in sql
    assert params["st0"] == "detected" and params["st1"] == "recommended"


@pytest.mark.asyncio
async def test_one_status_is_unchanged():
    db = await _list("approved")
    sql, params = next(c for c in db.calls if "COUNT" in c[0])
    assert "status = :st" in sql and params["st"] == "approved"


@pytest.mark.asyncio
async def test_no_status_filters_nothing():
    db = await _list(None)
    sql, _ = next(c for c in db.calls if "COUNT" in c[0])
    assert "status" not in sql
