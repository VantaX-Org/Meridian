"""GET /api/v1/shell/counts returns tenant-scoped Fix and Inbox badge counts. Fix is records to fix, or null when
no work list is built (never cleaning proposals)."""
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

    def scalars(self):
        return self

    def mappings(self):
        return self

    def all(self):
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
        if "jsonb_object_keys" in sql:  # the current state: one object, read from the latest run
            return _Res([{"module": "material_master", "version_id": self.latest}] if self.latest else [])
        if "worklist_built_at" in sql:  # the runs whose work list finished building
            return _Res([self.latest] if self.to_fix is not None else [])
        if "FROM work_counts" in sql:
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
    latest = str(uuid.uuid4())
    db = _Db(fix_count=99, inbox_count=5, latest=latest, to_fix=3)
    app = _app(db, monkeypatch)

    res = _get(app, "/api/v1/shell/counts")

    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"fix", "inbox"}  # fix_source is gone
    assert body["fix"] == 3
    assert body["inbox"] == 5


def test_shell_counts_queries_are_tenant_scoped(monkeypatch):
    latest = str(uuid.uuid4())
    db = _Db(fix_count=1, inbox_count=1, latest=latest, to_fix=1)
    app = _app(db, monkeypatch)

    _get(app, "/api/v1/shell/counts")

    count_calls = [(s, p) for s, p in db.calls if "COUNT" in s.upper()]
    assert len(count_calls) == 2
    for sql, params in count_calls:
        assert "tenant_id = :tid" in sql
        assert params["tid"] == str(TID)

    inbox_sql = next(s for s, _ in count_calls if "stewardship_queue" in s)
    # the inbox lists open, in-progress and escalated items; the badge counts the same three
    assert "status IN ('open', 'in_progress', 'escalated')" in inbox_sql


def test_shell_counts_none_scalar_yields_zero(monkeypatch):
    db = _Db(fix_count=None, inbox_count=None, latest=str(uuid.uuid4()), to_fix=None)
    app = _app(db, monkeypatch)

    res = _get(app, "/api/v1/shell/counts")

    assert res.json() == {"fix": None, "inbox": 0}


def test_fix_counts_records_to_fix_of_the_current_state(monkeypatch):
    latest = str(uuid.uuid4())
    db = _Db(fix_count=99, inbox_count=0, latest=latest, to_fix=7)
    res = _get(_app(db, monkeypatch), "/api/v1/shell/counts")
    assert res.json()["fix"] == 7
    assert not any("cleaning_queue" in s for s, _ in db.calls)
    # the count reads each object of the current state at its own run, as Fix work does without ?run=
    sql, params = next((s, p) for s, p in db.calls if "FROM work_counts" in s)  # pre-aggregated, migration 108
    assert "unnest(CAST(:cm AS text[]), CAST(:cv AS uuid[]))" in sql
    assert params["cm"] == ["material_master"] and params["cv"] == [latest] and params["tid"] == str(TID)


def test_fix_is_null_without_a_work_list_and_never_cleaning_proposals(monkeypatch):
    # a run exists, its work list is not built: the badge is hidden (null), not the 4 cleaning proposals
    db = _Db(fix_count=4, inbox_count=2, latest=str(uuid.uuid4()), to_fix=None)
    body = _get(_app(db, monkeypatch), "/api/v1/shell/counts").json()
    assert body == {"fix": None, "inbox": 2}
    assert not any("cleaning_queue" in s or "FROM work_counts" in s for s, _ in db.calls)


def test_fix_is_null_without_any_run(monkeypatch):
    db = _Db(fix_count=4, inbox_count=0)
    assert _get(_app(db, monkeypatch), "/api/v1/shell/counts").json() == {"fix": None, "inbox": 0}
