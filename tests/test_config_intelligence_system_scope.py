"""Config intelligence routes take an optional ``system_id``: the latest run, or the
given run, must belong to a version downloaded from that system."""

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import config_intelligence as ci

RUN = str(uuid.uuid4())


class _Result:
    def __init__(self, row: tuple | None) -> None:
        self._row = row

    def first(self) -> tuple | None:
        return self._row


class _DB:
    """Records SQL; answers SELECTs with ``row``."""

    def __init__(self, row: tuple | None) -> None:
        self.row, self.sql = row, []

    async def execute(self, stmt: object, params: dict | None = None) -> _Result:
        self.sql.append((str(stmt), params or {}))
        return _Result(self.row)


def _client(db: _DB) -> TestClient:
    api = FastAPI()
    api.include_router(ci.router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


def _stub_processes(monkeypatch) -> list[str]:
    seen: list[str] = []

    async def load(_db, _tid, rid):
        seen.append(rid)
        return []

    monkeypatch.setattr(ci.persistence, "load_processes", load)
    return seen


def test_latest_run_scoped_to_system(monkeypatch):
    seen = _stub_processes(monkeypatch)
    db = _DB((RUN,))
    r = _client(db).get("/api/v1/config/processes", params={"system_id": "SYS1"})
    assert r.status_code == 200 and seen == [RUN]
    sql, params = db.sql[-1]
    assert "analysis_versions" in sql and "metadata->>'system_id' = :sid" in sql and params["sid"] == "SYS1"


def test_latest_run_unscoped_without_system(monkeypatch):
    _stub_processes(monkeypatch)
    db = _DB((RUN,))
    assert _client(db).get("/api/v1/config/processes").status_code == 200
    assert "analysis_versions" not in db.sql[-1][0]


def test_no_run_for_system_is_404(monkeypatch):
    _stub_processes(monkeypatch)
    r = _client(_DB(None)).get("/api/v1/config/processes", params={"system_id": "SYS1"})
    assert r.status_code == 404


def test_explicit_run_checked_against_system(monkeypatch):
    seen = _stub_processes(monkeypatch)
    ok = _client(_DB((1,))).get("/api/v1/config/processes", params={"run_id": RUN, "system_id": "SYS1"})
    assert ok.status_code == 200 and seen == [RUN]
    other = _client(_DB(None)).get("/api/v1/config/processes", params={"run_id": RUN, "system_id": "SYS2"})
    assert other.status_code == 404 and other.json()["detail"] == "Run not found for this system"


def test_explicit_run_without_system_skips_lookup(monkeypatch):
    seen = _stub_processes(monkeypatch)
    db = _DB(None)
    assert _client(db).get("/api/v1/config/processes", params={"run_id": "anything"}).status_code == 200
    assert seen == ["anything"] and db.sql == []


def test_malformed_run_id_with_system_is_404_not_500(monkeypatch):
    _stub_processes(monkeypatch)
    db = _DB((1,))
    r = _client(db).get("/api/v1/config/processes", params={"run_id": "not-a-uuid", "system_id": "SYS1"})
    assert r.status_code == 404 and db.sql == []
