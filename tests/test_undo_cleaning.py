"""Cleaning decisions record the queue rows' prior state, and undo writes it back (mocked DB, no Postgres)."""
import json
import uuid

import pytest

import api.services.undo as undo
from api.deps import Tenant

QID = str(uuid.uuid4())
BEFORE = {"id": QID, "status": "recommended", "approved_by": None, "applied_at": None,
          "rollback_deadline": None, "record_data_after": None}


class _Res:
    def __init__(self, rows=(), rowcount=0):
        self.rows, self.rowcount = list(rows), rowcount

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _DB:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, dict(params or {})))
        if sql.startswith("SELECT id::text AS id, status"):
            return _Res([BEFORE])
        return _Res(rowcount=1)


TENANT = Tenant(uuid.uuid4(), "T", [])


@pytest.mark.asyncio
async def test_snapshot_is_saved_and_undo_restores_it():
    db = _DB()
    rec = undo.Recorder()
    await rec.cleaning_rows(db, TENANT, [QID, QID])
    await rec.cleaning_rows(db, TENANT, [QID])  # first snapshot wins, no second read
    assert sum(1 for s, _ in db.calls if s.startswith("SELECT")) == 1
    assert not rec.empty() and rec.inverse()["cleaning"] == [BEFORE]
    aid = await rec.save(db, TENANT, None, "cleaning_approve", {"id": QID})
    assert aid and any("INSERT INTO undo_actions" in s for s, _ in db.calls)

    db2 = _DB()
    done = await undo.apply_inverse(db2, TENANT, None, {"id": aid, "inverse": rec.inverse()})
    assert done["cleaning"] == 1
    upd = next((s, p) for s, p in db2.calls if s.startswith("UPDATE cleaning_queue"))
    assert json.loads(upd[1]["rows"]) == [BEFORE]
    assert any("INSERT INTO cleaning_audit" in s and "'undone'" in s for s, _ in db2.calls)


@pytest.mark.asyncio
async def test_nothing_changed_gives_no_action_id():
    assert await undo.Recorder().save(_DB(), TENANT, None, "cleaning_approve", {}) is None
