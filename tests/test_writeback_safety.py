"""Write-back safety: frozen approval snapshot, atomic claim, expiry, reject, stale-value skip (synthetic, no SAP).

Every SAP call goes to a fake connector; every database call to a fake session that answers by SQL text.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import HTTPException

from api.routes import remediation as rem
from api.routes import writeback as wb
from sap import bapi_writeback as bw
from tests.test_bapi_writeback import MAT_KEY, FakeRFC
from workers.tasks.run_batch_writeback import classify

TENANT = SimpleNamespace(id=uuid.uuid4(), name="t")
FIX = {"auto_fix": True, "record_key": MAT_KEY, "field": "MARC.PLIFZ", "invalid_value": "0", "proposed_value": 12}


# ── stale-value skip (sap/bapi_writeback.py) ────────────────────────────────


class ReadRFC(FakeRFC):
    """FakeRFC that also answers RFC_READ_TABLE reads with the given current values (None = not readable)."""

    def __init__(self, current: dict | None, **kw):
        super().__init__(testrun=True, **kw)
        self.current, self.reads = current, []

    def read_table(self, table, fields, where="", max_rows=0):
        self.reads.append((table, fields, where))
        if self.current is None:
            raise RuntimeError("not authorised")
        return pd.DataFrame([{f: self.current.get(f"{table}.{f}", "") for f in fields}])


def test_a_value_changed_in_sap_is_skipped_and_nothing_is_sent():
    conn = ReadRFC({"MARC.PLIFZ": "5"})
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True, based_on={"MARC.PLIFZ": "0"})
    assert r.stale == [{"field": "MARC.PLIFZ", "expected": "0", "found": "5"}]
    assert "BAPI_MATERIAL_SAVEDATA" not in conn.names() and bw.COMMIT not in conn.names()
    assert not r.applied and not r.committed and "Changed in SAP" in r.error
    assert conn.reads[0][0] == "MARC" and "WERKS = '1000'" in conn.reads[0][2]
    assert classify(r)[0] == "stale"


def test_an_unchanged_value_is_written():
    conn = ReadRFC({"MARC.PLIFZ": "000"})  # SAP pads numbers; 000 == 0
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True, based_on={"MARC.PLIFZ": "0"})
    assert r.stale == [] and r.committed and classify(r)[0] == "committed"


def test_a_field_that_cannot_be_read_is_never_overwritten():
    conn = ReadRFC(None)
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True, based_on={"MARC.PLIFZ": "0"})
    assert r.stale and r.stale[0]["found"] is None and "could not be read back" in r.error
    assert "BAPI_MATERIAL_SAVEDATA" not in conn.names()


def test_without_based_on_the_old_path_is_unchanged():
    conn = ReadRFC({})
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True)
    assert r.committed and conn.reads == []


def test_apply_records_passes_based_on_per_record():
    conn = ReadRFC({"MARC.PLIFZ": "7"})
    out = wb.apply_records(conn, "material_master", {MAT_KEY: {"MARC.PLIFZ": 12}}, {MAT_KEY: {"MARC.PLIFZ": "0"}})
    assert out[0]["stale"] and not out[0]["committed"]


# ── migration ───────────────────────────────────────────────────────────────


def test_migration_173_keeps_one_alembic_head():
    versions = Path(__file__).resolve().parent.parent / "db/migrations/versions"
    revs, downs, parent = set(), set(), {}
    for p in versions.glob("*.py"):
        ns: dict = {}
        src = p.read_text()
        for line in src.splitlines():
            if line.startswith(("revision", "down_revision")):
                exec(line.split(":", 1)[0].strip() + " = " + line.split("=", 1)[1], {}, ns)  # noqa: S102
        if "revision" in ns:
            revs.add(ns["revision"])
            d = ns.get("down_revision")
            parent[ns["revision"]] = d
            downs.update(d if isinstance(d, (tuple, list)) else [d])
    assert len(revs - downs) == 1, f"expected one alembic head, got {sorted(revs - downs)}"
    assert parent.get("173") == "167"


# ── single write-back approval (api/routes/writeback.py) ────────────────────


class FakeDB:
    """write_back_log with one row, the finding, and the claim answered atomically (the database's row lock)."""

    def __init__(self, row: dict, finding_fixes: list):
        self.row, self.finding_fixes, self.sql = row, finding_fixes, []

    async def execute(self, stmt, params=None):
        s, p = str(stmt), params or {}
        self.sql.append(s)
        one = None
        if s.startswith("SET "):
            pass
        elif "UPDATE write_back_log SET approved_by" in s:
            await asyncio.sleep(0)  # let a concurrent approval run up to here
            r = self.row
            if (r["status"] == "pending" and r["approved_by"] is None and not r["dry_run"]
                    and r["requested_by"] != p["approver"] and r["expires_at"] > datetime.now(timezone.utc)):
                r.update(status="approved", approved_by=p["approver"])
                one = (r["finding_id"], r["system_id"], r["record_fixes"], r["fixes_sha256"])
        elif "SET status = 'rejected'" in s:
            if self.row["status"] == "pending":
                self.row.update(status="rejected", reject_reason=p["r"])
                one = (self.row["id"],)
        elif "UPDATE write_back_log SET status = :st" in s:
            self.row["status"] = p["st"]
            self.row["errors"] = p["errors"]
        elif "SET status = 'expired'" in s:
            self.row["status"] = "expired"
        elif "SELECT requested_by, status" in s:
            r = self.row
            one = (r["requested_by"], r["status"], r["dry_run"], r["expires_at"] <= datetime.now(timezone.utc))
        elif "SELECT status FROM write_back_log" in s:
            one = (self.row["status"],)
        elif "FROM findings" in s:
            one = ("material_master", self.finding_fixes)
        return SimpleNamespace(fetchone=lambda: one)

    async def commit(self):
        pass

    async def rollback(self):
        pass


def _row(**kw) -> dict:
    snap = [FIX]
    row = {"id": str(uuid.uuid4()), "finding_id": uuid.uuid4(), "system_id": uuid.uuid4(), "record_fixes": snap,
           "fixes_sha256": wb.fixes_sha256(snap), "status": "pending", "approved_by": None, "dry_run": False,
           "requested_by": "alice", "expires_at": datetime.now(timezone.utc) + timedelta(days=7)}
    row.update(kw)
    return row


def _req(user: str):
    return SimpleNamespace(state=SimpleNamespace(local_user_id=user))


@pytest.fixture
def sap(monkeypatch):
    """Live write-back on, no sandbox, credentials by system id; records every apply instead of calling SAP."""
    from api.config import settings
    from api.services import sandbox

    monkeypatch.setattr(settings, "live_writeback_enabled", True)

    async def no_hold(*a, **k):
        return False

    monkeypatch.setattr(sandbox, "held_back", no_hold)
    seen = SimpleNamespace(systems=[], applied=[])

    async def params(db, tid, system_id):
        seen.systems.append(system_id)
        return object()

    class Conn:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def connect(self, p):
            pass

    def apply(conn, module, by_record, based_on=None):
        seen.applied.append((by_record, based_on))
        return [{"record_key": k, "committed": True, "error": None, "export": []} for k in by_record]

    monkeypatch.setattr(wb, "_system_params", params)
    monkeypatch.setattr(wb, "apply_records", apply)
    monkeypatch.setattr("sap.get_connector", lambda: Conn())
    return seen


def test_approval_runs_the_frozen_snapshot_against_its_system(sap):
    row = _row()
    db = FakeDB(row, [FIX, {**FIX, "field": "MARC.EKGRP", "proposed_value": "001"}])  # live has more: subset is fine
    out = asyncio.run(wb.approve_writeback(_req("bob"), row["id"], db, TENANT))
    assert out.applied == 1 and row["status"] == "approved" and row["approved_by"] == "bob"
    assert sap.systems == [str(row["system_id"])]
    assert sap.applied == [({MAT_KEY: {"MARC.PLIFZ": 12}}, {MAT_KEY: {"MARC.PLIFZ": "0"}})]


def test_two_concurrent_approvals_never_both_run(sap):
    row = _row()
    db = FakeDB(row, [FIX])

    async def both():
        return await asyncio.gather(wb.approve_writeback(_req("bob"), row["id"], db, TENANT),
                                    wb.approve_writeback(_req("carol"), row["id"], db, TENANT),
                                    return_exceptions=True)

    results = asyncio.run(both())
    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(refused) == 1 and refused[0].status_code == 409 and "already approved" in refused[0].detail
    assert len(sap.applied) == 1


def test_the_requester_cannot_approve_their_own_request(sap):
    row = _row()
    with pytest.raises(HTTPException) as e:
        asyncio.run(wb.approve_writeback(_req("alice"), row["id"], FakeDB(row, [FIX]), TENANT))
    assert e.value.status_code == 403 and row["status"] == "pending" and not sap.applied


def test_fixes_changed_since_submit_block_the_approval(sap):
    row = _row()
    db = FakeDB(row, [{**FIX, "proposed_value": 99}])
    with pytest.raises(HTTPException) as e:
        asyncio.run(wb.approve_writeback(_req("bob"), row["id"], db, TENANT))
    assert e.value.status_code == 409 and "changed after this request was submitted" in e.value.detail
    assert row["status"] == "blocked" and not sap.applied


def test_a_tampered_snapshot_is_blocked(sap):
    row = _row(record_fixes=[{**FIX, "proposed_value": 99}])  # hash is of the original
    with pytest.raises(HTTPException) as e:
        asyncio.run(wb.approve_writeback(_req("bob"), row["id"], FakeDB(row, [FIX]), TENANT))
    assert e.value.status_code == 409 and row["status"] == "blocked" and not sap.applied


def test_a_request_without_snapshot_or_system_is_never_run(sap):
    row = _row(system_id=None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(wb.approve_writeback(_req("bob"), row["id"], FakeDB(row, [FIX]), TENANT))
    assert e.value.status_code == 409 and row["status"] == "blocked" and not sap.applied


def test_an_expired_request_cannot_be_approved(sap):
    row = _row(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    with pytest.raises(HTTPException) as e:
        asyncio.run(wb.approve_writeback(_req("bob"), row["id"], FakeDB(row, [FIX]), TENANT))
    assert e.value.status_code == 409 and "expired" in e.value.detail
    assert row["status"] == "expired" and not sap.applied


def test_reject_with_reason_closes_the_request(sap):
    row = _row()
    db = FakeDB(row, [FIX])
    out = asyncio.run(wb.reject_writeback(_req("bob"), row["id"], wb.RejectRequest(reason=" wrong plant "), db, TENANT))
    assert out == {"id": row["id"], "status": "rejected", "reason": "wrong plant"}
    assert row["reject_reason"] == "wrong plant"
    with pytest.raises(HTTPException) as e:  # a rejected request is never approved later
        asyncio.run(wb.approve_writeback(_req("carol"), row["id"], db, TENANT))
    assert e.value.status_code == 409 and "rejected" in e.value.detail and not sap.applied


def test_reject_of_an_approved_request_is_refused(sap):
    row = _row(status="approved", approved_by="bob")
    with pytest.raises(HTTPException) as e:
        asyncio.run(wb.reject_writeback(_req("carol"), row["id"], wb.RejectRequest(reason="late"), FakeDB(row, []),
                                        TENANT))
    assert e.value.status_code == 409


# ── batch approval and send (api/routes/remediation.py, writeback.py) ───────


ITEMS = [{"module": "material_master", "record_key": MAT_KEY, "field": "MARC.PLIFZ", "proposed_value": 12,
          "current_value": "0", "scope": "s1"},
         {"module": "material_master", "record_key": "MATNR=1", "field": "MARA.MATKL", "proposed_value": "001",
          "current_value": "", "scope": "s1"}]


def test_items_hash_is_stable_and_order_free_and_sees_edits():
    h = rem.items_sha256(ITEMS)
    assert h == rem.items_sha256(list(reversed(ITEMS)))
    assert h != rem.items_sha256([{**ITEMS[0], "proposed_value": 13}, ITEMS[1]])
    assert h == rem.items_sha256([*ITEMS, {**ITEMS[0], "field": "MARC.X", "proposed_value": ""}])  # blank never sent


def _guards(monkeypatch, batch: dict, items: list):
    from api.config import settings
    from api.services import sandbox

    monkeypatch.setattr(settings, "live_writeback_enabled", True)

    async def approved(db, tenant, bid):
        return batch, items

    async def no_hold(*a, **k):
        return False

    monkeypatch.setattr(wb, "_approved_batch", approved)
    monkeypatch.setattr(sandbox, "held_back", no_hold)
    return asyncio.run(wb._send_guards(_req("bob"), None, TENANT, uuid.uuid4()))


def _batch(**kw) -> dict:
    b = {"status": "approved", "created_by": "alice", "approved_at": datetime.now(timezone.utc),
         "approved_sha256": rem.items_sha256(ITEMS)}
    b.update(kw)
    return b


def test_send_of_the_approved_items_passes(monkeypatch):
    b, items, user = _guards(monkeypatch, _batch(), ITEMS)
    assert user == "bob" and items == ITEMS


def test_send_of_items_changed_after_approval_is_refused(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _guards(monkeypatch, _batch(), [{**ITEMS[0], "proposed_value": 13}, ITEMS[1]])
    assert e.value.status_code == 409 and "differ from the ones that were approved" in e.value.detail


def test_send_of_an_expired_approval_is_refused(monkeypatch):
    with pytest.raises(HTTPException) as e:
        _guards(monkeypatch, _batch(approved_at=(datetime.now(timezone.utc) - timedelta(days=8)).isoformat()), ITEMS)
    assert e.value.status_code == 409 and "expired" in e.value.detail


def test_a_second_batch_approval_at_the_same_moment_gets_409(monkeypatch):
    """The first approval moved the batch out of draft between the read and the claim: the claim gets no row."""
    sql = []

    class DB:
        async def execute(self, stmt, params=None):
            sql.append(str(stmt))
            return SimpleNamespace(fetchone=lambda: None, first=lambda: None)

        async def run_sync(self, fn):
            return {"status": "approved", "instance": None}

        async def rollback(self):
            pass

    async def batch(db, tenant, bid):
        return {"status": "draft", "created_by": "alice"}

    async def items(db, bid):
        return ITEMS

    async def nothing(*a, **k):
        return {}

    monkeypatch.setattr(rem, "_batch", batch)
    monkeypatch.setattr(rem, "_items", items)
    monkeypatch.setattr(rem, "batch_facts", nothing)
    monkeypatch.setattr(rem.undo, "batch_snapshot", nothing)
    monkeypatch.setattr(rem, "current_user_id", lambda r: "bob")
    monkeypatch.setattr(rem, "current_user_label", lambda: "Bob")
    with pytest.raises(HTTPException) as e:
        asyncio.run(rem.approve_batch(uuid.uuid4(), _req("bob"), DB(), TENANT, "approve", None))
    assert e.value.status_code == 409
    claim = next(s for s in sql if "UPDATE remediation_batches" in s)
    assert "status = 'draft'" in claim and "RETURNING id" in claim and "approved_sha256" in claim
