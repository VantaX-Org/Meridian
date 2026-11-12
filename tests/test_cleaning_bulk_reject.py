"""POST /cleaning/bulk-reject rejects a group with one reason and one audit row per proposal."""

import uuid

import pytest
from fastapi import HTTPException

import api.routes.cleaning as cleaning
from api.deps import Tenant


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class _DB:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, dict(params or {})))
        return _Res([("a", "K1", "material_master"), ("b", "K2", "material_master")] if "UPDATE cleaning_queue" in sql else [])

    async def commit(self):
        pass


def _run(body):
    db = _DB()
    return db, cleaning.bulk_reject(body, db=db, tenant=Tenant(uuid.uuid4(), "T", []), _role="steward")


@pytest.mark.asyncio
async def test_rejects_group_and_audits_each(monkeypatch):
    audits = []

    async def fake_audit(*a, **k):
        audits.append((a[3], k["metadata"]))

    monkeypatch.setattr(cleaning, "_create_audit", fake_audit)
    monkeypatch.setattr(cleaning, "mark_work_changed", lambda *a: None)
    db, co = _run(cleaning.BulkRejectBody(reason=" wrong plant ", kind="duplicate", version_id=uuid.uuid4()))
    assert (await co) == {"rejected_count": 2}
    sql = next(s for s, _ in db.calls if "UPDATE cleaning_queue" in s)
    assert "status IN ('detected', 'recommended')" in sql and "tenant_id = :tid" in sql
    assert [a[0] for a in audits] == ["rejected", "rejected"]
    assert audits[0][1] == {"reason": "wrong plant", "bulk": True}


@pytest.mark.asyncio
async def test_needs_reason_and_a_scope():
    with pytest.raises(HTTPException) as e:
        await _run(cleaning.BulkRejectBody(reason="  ", kind="duplicate"))[1]
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        await _run(cleaning.BulkRejectBody(reason="x"))[1]
