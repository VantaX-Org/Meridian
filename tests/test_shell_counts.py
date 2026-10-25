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
    def __init__(self, fix_count, inbox_count, latest=None, to_fix=None):
        self.fix_count = fix_count
        self.inbox_count = inbox_count
        self.latest, self.to_fix = latest, to_fix
        self.calls = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "FROM analysis_versions" in sql:
            return _Res(self.latest)
        if "FROM work_groups" in sql:
            return _Res(1 if self.to_fix is not None else None)
        if "FROM work_records" in sql:
            return _Res(self.to_fix)
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


def test_fix_counts_records_to_fix_of_the_latest_run(monkeypatch):
    db = _Db(fix_count=99, inbox_count=0, latest=str(uuid.uuid4()), to_fix=7)
    res = _get(_app(db, monkeypatch), "/api/v1/shell/counts")
    assert res.json()["fix"] == 7
    assert not any("cleaning_queue" in s for s, _ in db.calls)


def test_fix_falls_back_to_cleaning_proposals_without_a_work_list(monkeypatch):
    db = _Db(fix_count=4, inbox_count=0, latest=str(uuid.uuid4()), to_fix=None)
    assert _get(_app(db, monkeypatch), "/api/v1/shell/counts").json()["fix"] == 4
