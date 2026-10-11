"""GET/PUT /survivorship-rules and GET /audit/llm (mocked session, no Postgres)."""

import asyncio
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from api.routes.audit import list_llm_audit
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


def test_put_replaces_domain_and_dedupes_fields() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(fetchall=lambda: []))
    body = SurvivorshipRulesPut(
        domain="customer",
        rules=[SurvivorshipRuleBody(field="NAME1"), SurvivorshipRuleBody(field="NAME1"),
               SurvivorshipRuleBody(field="LAND1", rule_type="most_frequent")],
    )
    asyncio.run(replace_survivorship_rules(body=body, db=db, tenant=TENANT))
    sqls = [str(c.args[0]) for c in db.execute.call_args_list]
    assert sum("DELETE FROM survivorship_rules" in s for s in sqls) == 1
    assert sum("INSERT INTO survivorship_rules" in s for s in sqls) == 2
    db.commit.assert_awaited_once()


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
    assert out["total"] == 1 and out["entries"][0]["called_at"].startswith("2026-01-01")
    assert out["cache"][0]["decisions"] == 4


def test_audit_path_contains_filter_escapes_wildcards() -> None:
    from api.routes.audit import _filters

    where, params = _filters(TENANT, None, None, None, None, None, None, None, "50%_x")
    assert "ILIKE :pathlike" in where
    assert params["pathlike"] == "%50\\%\\_x%"
