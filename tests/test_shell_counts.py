"""GET /api/v1/shell/counts returns tenant-scoped Fix and Inbox badge counts."""
import asyncio
import uuid

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import shell

TID = uuid.uuid4()


class _Res:
    def __init__(self, value):
        self.value = value

    def scalar(self):
        return self.value


class _Db:
    def __init__(self, fix_count, inbox_count):
        self.fix_count = fix_count
        self.inbox_count = inbox_count
        self.calls = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "cleaning_queue" in sql:
            return _Res(self.fix_count)
        if "stewardship_queue" in sql:
            return _Res(self.inbox_count)
        return _Res(None)


def _app(db, monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(shell.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return app


def _get(app, url):
    async def go():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(url, headers={"X-User-Role": "steward"})
    return asyncio.run(go())


def test_shell_counts_shape_and_values(monkeypatch):
    db = _Db(fix_count=3, inbox_count=5)
    app = _app(db, monkeypatch)

    res = _get(app, "/api/v1/shell/counts")

    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"fix", "inbox"}
    assert body["fix"] == 3
    assert body["inbox"] == 5


def test_shell_counts_queries_are_tenant_scoped(monkeypatch):
    db = _Db(fix_count=1, inbox_count=1)
    app = _app(db, monkeypatch)

    _get(app, "/api/v1/shell/counts")

    count_calls = [(s, p) for s, p in db.calls if "COUNT" in s.upper()]
    assert len(count_calls) == 2
    for sql, params in count_calls:
        assert "tenant_id = :tid" in sql
        assert params["tid"] == str(TID)

    fix_sql = next(s for s, _ in count_calls if "cleaning_queue" in s)
    assert "status = 'detected'" in fix_sql

    inbox_sql = next(s for s, _ in count_calls if "stewardship_queue" in s)
    assert "status IN ('open', 'in_progress')" in inbox_sql


def test_shell_counts_none_scalar_yields_zero(monkeypatch):
    db = _Db(fix_count=None, inbox_count=None)
    app = _app(db, monkeypatch)

    res = _get(app, "/api/v1/shell/counts")

    assert res.json() == {"fix": 0, "inbox": 0}
