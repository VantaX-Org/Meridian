"""GET/PUT /survivorship-rules and GET /audit/llm (mocked session, no Postgres)."""

import asyncio
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import get_db, get_tenant
from api.routes import audit as audit_routes
from api.routes import survivorship_rules as sr_routes
from api.routes.audit import list_llm_audit
from api.services import rbac
from api.routes.survivorship_rules import (
    SurvivorshipRuleBody,
    SurvivorshipRulesPut,
    list_survivorship_rules,
    replace_survivorship_rules,
)

TENANT = SimpleNamespace(id=uuid.uuid4(), name="t")


def _row(mapping=None, tup=None):
    r = MagicMock()
    if mapping is not None:
        r._mapping = mapping
    if tup is not None:
        r.__getitem__.side_effect = lambda i: tup[i]
    return r


def test_rule_body_validation() -> None:
    with pytest.raises(ValidationError):
        SurvivorshipRuleBody(field="NAME1", rule_type="bogus")
    with pytest.raises(ValidationError):
        SurvivorshipRuleBody(field="NAME1", weight=101)


def test_list_rules() -> None:
    row = (uuid.uuid4(), "customer", "NAME1", "trusted_source", ["ECC"], 70, True, False)
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[MagicMock(), MagicMock(fetchall=lambda: [row])])
    out = asyncio.run(list_survivorship_rules(domain="customer", db=db, tenant=TENANT))
    assert out.total == 1 and out.rules[0].trusted_sources == ["ECC"]


def test_list_rules_maps_legacy_rule_type_instead_of_failing() -> None:
    row = (uuid.uuid4(), "customer", "NAME1", "hand_written_legacy", None, 50, True, False)
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[MagicMock(), MagicMock(fetchall=lambda: [row])])
    out = asyncio.run(list_survivorship_rules(domain=None, db=db, tenant=TENANT))
    assert out.rules[0].rule_type == "most_recent"


def test_put_replaces_domain() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(fetchall=lambda: []))
    body = SurvivorshipRulesPut(
        domain="customer",
        rules=[SurvivorshipRuleBody(field="NAME1"), SurvivorshipRuleBody(field="LAND1", rule_type="most_frequent")],
    )
    asyncio.run(replace_survivorship_rules(body=body, db=db, tenant=TENANT))
    sqls = [str(c.args[0]) for c in db.execute.call_args_list]
    assert sum("DELETE FROM survivorship_rules" in s for s in sqls) == 1
    assert sum("INSERT INTO survivorship_rules" in s for s in sqls) == 2
    db.commit.assert_awaited_once()


def test_put_rejects_duplicate_fields_naming_them() -> None:
    with pytest.raises(ValidationError, match="NAME1"):
        SurvivorshipRulesPut(domain="customer", rules=[SurvivorshipRuleBody(field="NAME1"), SurvivorshipRuleBody(field="NAME1")])


def test_llm_audit_pages_and_summarises_cache() -> None:
    entry = {"id": uuid.uuid4(), "service_name": "mdm", "called_at": datetime(2026, 1, 1),
             "model_version": "m", "prompt_hash": "h", "token_count": 3, "latency_ms": 9,
             "success": True, "deterministic_hit": False, "skip_reason": None}
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(),
        MagicMock(scalar=lambda: 1),
        MagicMock(fetchall=lambda: [_row(mapping=entry)]),
        MagicMock(fetchall=lambda: [_row(mapping={"service_name": "mdm", "decisions": 4, "deterministic": 3})]),
    ])
    out = asyncio.run(list_llm_audit(service_name=None, success=None, limit=50, offset=0, db=db, tenant=TENANT))
    assert out.total == 1 and out.entries[0].called_at.startswith("2026-01-01")
    assert out.cache[0].decisions == 4


def test_audit_path_contains_filter_escapes_wildcards() -> None:
    from api.routes.audit import _filters

    where, params = _filters(TENANT, None, None, None, None, None, None, None, "50%_x")
    assert "ILIKE :pathlike" in where
    assert params["pathlike"] == "%50\\%\\_x%"


class _Recorder:
    """Session double that records every statement and its bound parameters."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        self.calls.append((str(stmt), params or {}))
        return MagicMock(fetchall=lambda: [], scalar=lambda: 0)

    async def commit(self) -> None:
        pass


def _client(monkeypatch, role: str) -> tuple[TestClient, _Recorder]:
    async def fake_role(*a, **k):
        return role

    monkeypatch.setattr(rbac, "_get_user_role", fake_role)
    rec = _Recorder()
    app = FastAPI()
    app.include_router(sr_routes.router)
    app.include_router(audit_routes.router)
    app.dependency_overrides[get_tenant] = lambda: TENANT
    app.dependency_overrides[get_db] = lambda: rec
    return TestClient(app), rec


PUT_BODY = {"domain": "customer", "rules": [{"field": "NAME1"}]}


def test_put_survivorship_rules_forbidden_without_mdm_write(monkeypatch) -> None:
    client, rec = _client(monkeypatch, "viewer")
    r = client.put("/api/v1/survivorship-rules", json=PUT_BODY)
    assert r.status_code == 403
    assert not any("survivorship_rules" in sql for sql, _ in rec.calls)  # nothing was touched


def test_put_duplicate_fields_is_422(monkeypatch) -> None:
    client, _ = _client(monkeypatch, "admin")
    body = {"domain": "customer", "rules": [{"field": "NAME1"}, {"field": "NAME1"}]}
    r = client.put("/api/v1/survivorship-rules", json=body)
    assert r.status_code == 422 and "NAME1" in r.text


def test_llm_audit_forbidden_without_manage_users(monkeypatch) -> None:
    client, rec = _client(monkeypatch, "viewer")
    assert client.get("/api/v1/audit/llm").status_code == 403
    assert not any("llm_audit_log" in sql for sql, _ in rec.calls)


def test_path_contains_is_length_bounded(monkeypatch) -> None:
    client, _ = _client(monkeypatch, "admin")
    assert client.get("/api/v1/audit", params={"path_contains": "x" * 201}).status_code == 422


def test_queries_set_rls_and_bind_the_callers_tenant(monkeypatch) -> None:
    client, rec = _client(monkeypatch, "admin")
    assert client.put("/api/v1/survivorship-rules", json=PUT_BODY).status_code == 200
    assert client.get("/api/v1/survivorship-rules").status_code == 200
    assert client.get("/api/v1/audit/llm").status_code == 200
    tid = str(TENANT.id)
    sqls = [sql for sql, _ in rec.calls]
    assert sum(f"SET app.tenant_id = '{tid}'" in sql for sql in sqls) == 3
    scoped = [(sql, p) for sql, p in rec.calls if "app.tenant_id" not in sql]
    assert scoped and all(p.get("tid") == tid for _, p in scoped)
