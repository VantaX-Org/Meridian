"""Audited end-to-end journey breaks: stale Inbox tasks, scoped invites, merge -> Inbox."""
import asyncio
import uuid
from typing import Any

import pytest
from fastapi import HTTPException

from api.routes import merge_explain, stewardship
from api.routes.users import InviteGrant, InviteUserBody, invite_users_role
from workers.tasks import populate_stewardship_queue as psq


class _Result:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class _SyncSession:
    """Records every statement; reports `rowcount` affected rows."""

    def __init__(self, rowcount: int = 0) -> None:
        self.sql: list[tuple[str, dict[str, Any]]] = []
        self.rowcount = rowcount

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _Result:
        self.sql.append((str(stmt), params or {}))
        return _Result(self.rowcount)


class _AsyncSession(_SyncSession):
    async def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _Result:  # type: ignore[override]
        return _SyncSession.execute(self, stmt, params)


def _norm(sql: str) -> str:
    return " ".join(sql.split())


# ── 1. Writeback approvals and contract breaches auto-resolve ────────────────

def test_mark_resolved_closes_writeback_once_cleaning_row_left_approved() -> None:
    s = _SyncSession(rowcount=1)
    total = psq._mark_resolved_items(s, "t1")  # type: ignore[arg-type]
    stmts = [_norm(q) for q, _ in s.sql]
    wb = next(q for q in stmts if "item_type = 'writeback_approval'" in q)
    assert "NOT EXISTS" in wb and "cq.status = 'approved'" in wb and "cq.tenant_id = :tid" in wb
    # idempotent: resolved rows are left alone; escalated ones close too
    assert "sq.status IN ('open', 'in_progress', 'escalated')" in wb
    cb = next(q for q in stmts if "item_type = 'contract_breach'" in q)
    assert "c.status = 'active'" in cb and "ORDER BY cch.recorded_at DESC LIMIT 1" in cb and "IS NOT TRUE" in cb
    assert all(p == {"tid": "t1"} for _, p in s.sql)
    assert total == len(s.sql) == 5


def _item() -> stewardship.QueueItemOut:
    return stewardship.QueueItemOut(
        id=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()), item_type="writeback_approval", source_id=str(uuid.uuid4()),
        domain="material_master", priority=3, status="open", created_at="2026-10-25", updated_at="2026-10-25",
    )


def _last(db: _SyncSession) -> tuple[str, dict[str, Any]]:
    sql, params = db.sql[-1]
    return _norm(sql), params


@pytest.mark.parametrize("action", ["approve", "reject"])
def test_writeback_action_on_a_moved_on_fix_is_a_409(action: str) -> None:
    item = _item()
    db = _AsyncSession(rowcount=0)
    with pytest.raises(HTTPException) as e:
        asyncio.run(stewardship._apply_source_action(db, item, action, "u1", None))  # type: ignore[arg-type]
    assert e.value.status_code == 409 and "already applied, rejected or rolled back" in e.value.detail
    sql, params = _last(db)
    assert "status = 'approved'" in sql and "tenant_id = :tid" in sql and params["tid"] == item.tenant_id


def test_writeback_approve_applies_only_an_approved_row() -> None:
    item = _item()
    db = _AsyncSession(rowcount=1)
    asyncio.run(stewardship._apply_source_action(db, item, "approve", "u1", None))  # type: ignore[arg-type]
    sql, _ = _last(db)
    assert "SET status = 'applied'" in sql and "AND status = 'approved'" in sql


# ── 2. A scoped-only invite never widens users.role ──────────────────────────

def test_scoped_only_invite_keeps_users_role_viewer() -> None:
    body = InviteUserBody(email="s@example.test", grants=[
        InviteGrant(role_key="data_steward", system_id=uuid.uuid4()), InviteGrant(role_key="steward", module="hcm")])
    assert invite_users_role(body) == "viewer"


def test_unscoped_first_grant_becomes_users_role() -> None:
    body = InviteUserBody(email="s@example.test", grants=[
        InviteGrant(role_key="steward", system_id=uuid.uuid4()), InviteGrant(role_key="data_steward")])
    assert invite_users_role(body) == "data_steward"
    assert invite_users_role(InviteUserBody(email="x@example.test", grants=[InviteGrant(role_key="custom:x")])) == "viewer"
    assert invite_users_role(InviteUserBody(email="x@example.test", role="analyst")) == "analyst"


# ── 6. Merging a pair resolves its Inbox merge_decision task ─────────────────

def test_merge_accept_resolves_the_merge_decision_task(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _decided(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(merge_explain.mdm_merge, "record_pair_decision", _decided)
    db = _AsyncSession(rowcount=1)
    asyncio.run(merge_explain._accept(db, "t1", "ms1", "same vendor"))  # type: ignore[arg-type]
    sql, params = _last(db)
    assert sql.startswith("UPDATE stewardship_queue SET status = 'resolved'")
    assert "item_type = 'merge_decision'" in sql and "source_id = :id" in sql and "tenant_id = :tid" in sql
    assert "status IN ('open', 'in_progress', 'escalated')" in sql and params == {"tid": "t1", "id": "ms1"}
