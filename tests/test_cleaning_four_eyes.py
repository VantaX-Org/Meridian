"""Four-eyes on cleaning: the weekly scheduler applies only what automation approved and audits each step; a person
approves only a waiting item they did not propose; a run verifies applied items it proves fixed."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

import api.routes.cleaning as cleaning
from api.deps import Tenant
from api.services import batch_verification
from workers import scheduler


class _Res:
    def __init__(self, row=None, rowcount=0):
        self.row, self.rowcount = row, rowcount

    def fetchone(self):
        return self.row

    def first(self):
        return self.row

    def fetchall(self):
        return []

    def scalar(self):
        return self.row


class _Row:
    def __init__(self, **kw):
        self._mapping = kw


class _DB:
    """Answers the approve route: the item, then whether the caller proposed it."""

    def __init__(self, status: str, proposer: bool):
        self.status, self.proposer, self.calls = status, proposer, []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append(sql)
        if sql.startswith("SELECT * FROM cleaning_queue"):
            return _Res(_Row(id="i1", status=self.status, record_key="K1", object_type="material_master"))
        if "action = 'proposed'" in sql:
            return _Res((1,) if self.proposer else None)
        return _Res()

    async def commit(self):
        pass


async def _approve(monkeypatch, status="detected", proposer=False):
    monkeypatch.setattr(cleaning, "_set_rls", lambda *a: _noop())
    monkeypatch.setattr(cleaning, "_create_audit", lambda *a, **k: _noop())
    monkeypatch.setattr(cleaning, "mark_work_changed", lambda *a: None)
    monkeypatch.setattr(cleaning, "current_user_label", lambda: "steward@example.com")
    db = _DB(status, proposer)
    out = await cleaning.approve_cleaning_item("i1", cleaning.ApproveBody(), db=db,
                                               tenant=Tenant(uuid.uuid4(), "T", []), _role="approver")
    return db, out


async def _noop():
    return None


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["approved", "applied", "verified", "rejected", "rolled_back"])
async def test_only_a_waiting_item_can_be_approved(monkeypatch, status):
    with pytest.raises(HTTPException) as e:
        await _approve(monkeypatch, status=status)
    assert e.value.status_code == 409 and status in e.value.detail


@pytest.mark.asyncio
async def test_the_proposer_cannot_approve(monkeypatch):
    with pytest.raises(HTTPException) as e:
        await _approve(monkeypatch, proposer=True)
    assert e.value.status_code == 403 and "another user" in e.value.detail


@pytest.mark.asyncio
async def test_another_user_approves_a_waiting_item(monkeypatch):
    db, out = await _approve(monkeypatch, status="recommended")
    assert out == {"id": "i1", "status": "approved"}
    update = next(s for s in db.calls if s.startswith("UPDATE cleaning_queue"))
    assert "status IN ('detected', 'recommended')" in update


def test_bulk_approve_excludes_the_proposer():
    assert "action = 'proposed'" in cleaning._NOT_PROPOSER and ":me <> 'system'" in cleaning._NOT_PROPOSER


class _Session:
    """Records the scheduler's SQL and stops the tenant after the auto-apply step."""

    def __init__(self, calls):
        self.calls = calls

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, stmt, params=None):
        self.calls.append(" ".join(str(stmt).split()))
        if len(self.calls) > 2:
            raise RuntimeError("stop")
        return _Res(rowcount=3)

    def commit(self):
        pass


def test_scheduler_applies_only_automation_approved_items_and_audits_both_steps(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: None)
    monkeypatch.setattr(scheduler, "Session", lambda engine: _Session(calls))
    monkeypatch.setattr(scheduler, "_get_tenants", lambda s: [{"id": uuid.uuid4()}])
    monkeypatch.setattr(scheduler, "_set_rls", lambda *a: None)
    scheduler.weekly_cleaning_batch.run()
    approve, apply = calls[0], calls[1]
    for sql, action in ((approve, "approved"), (apply, "applied")):
        assert "INSERT INTO cleaning_audit" in sql and f"'{action}', 'system:scheduler'" in sql
    assert "cq.approved_by IS NULL" in apply and "cr.automation_level = 'auto'" in apply


class _SyncSession:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, dict(params or {})))
        if sql.startswith("SELECT metadata"):
            return _Res({"system_id": "S1", "sandbox": True})
        return _Res(rowcount=2 if "SET status = 'verified'" in sql else 1)


def test_verify_cleaning_marks_fixed_items_verified_and_audits_still_failing():
    s = _SyncSession()
    assert batch_verification.verify_cleaning(s, "t", "v") == (2, 1)
    verified, failed = s.calls[1], s.calls[2]
    assert verified[1]["scope"] == "sandbox:S1"
    assert "cq.status = 'applied'" in verified[0] and "resolution = 'verified_fixed'" in verified[0]
    assert "'verified', 'system:verification'" in verified[0]
    assert "SET status" not in failed[0] and "'verify_failed'" in failed[0] and "finding_records" in failed[0]
    assert "NOT EXISTS" in failed[0]  # once per run
