"""GET /versions?status=failed filters failed runs on the server, inside the tenant, before paging and the total."""
import asyncio
import uuid
from typing import Any

from fastapi import FastAPI
from sqlalchemy.dialects import postgresql

from api.deps import Tenant
from api.routes import versions


class _Result:
    def __init__(self, scalar: Any = None) -> None:
        self._scalar = scalar

    def scalar(self) -> Any:
        return self._scalar

    def scalars(self) -> "_Result":
        return self

    def all(self) -> list:
        return []


class _Session:
    """Records every statement the route runs; returns an empty page with a total of 0."""

    def __init__(self) -> None:
        self.sql: list[str] = []

    async def execute(self, stmt: Any, params: Any = None) -> _Result:
        self.sql.append(str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
                        if hasattr(stmt, "compile") and not hasattr(stmt, "text") else str(stmt))
        return _Result(0)


def _run(status: Any) -> list[str]:
    db = _Session()
    tenant = Tenant(uuid.UUID("00000000-0000-0000-0000-0000000000aa"), "t", [])
    body = asyncio.run(versions.list_versions(limit=100, offset=0, module=None, system_id="sys-1",
                                              include_archived=False, status=status, db=db, tenant=tenant))
    assert body == {"versions": [], "total": 0}
    return db.sql


def test_failed_filter_scopes_count_and_page_to_tenant_and_failed_statuses():
    sql = _run("failed")
    count_sql, page_sql = sql[1], sql[2]
    for q in (count_sql, page_sql):
        assert "analysis_versions.tenant_id = '00000000-0000-0000-0000-0000000000aa'" in q
        assert "analysis_versions.status IN ('failed', 'agents_failed', 'error', 'errored')" in q
        assert "'sys-1'" in q
    assert "LIMIT 100" in page_sql


def test_no_status_filter_by_default():
    sql = _run(None)
    assert all("analysis_versions.status IN" not in q for q in sql)


def test_status_param_only_accepts_failed():
    app = FastAPI()
    app.include_router(versions.router)
    op = app.openapi()["paths"]["/api/v1/versions"]["get"]
    p = next(p for p in op["parameters"] if p["name"] == "status")
    allowed = p["schema"]["anyOf"][0]
    assert allowed.get("enum", [allowed.get("const")]) == ["failed"]
