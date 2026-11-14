"""Audit integrity: the hash-chain walk, the checkpoint purge, the download audit and the security write-ahead.

No database: the chain walk is pure, the purge runs on a fake session and the middleware on a tiny Starlette app
with the insert faked. tests/test_audit_chain_pg.py runs the migration's trigger and guard against real Postgres."""
from __future__ import annotations

import uuid

import pytest
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from api.middleware import audit as mw
from api.services.audit_chain import GENESIS, check_chain, purge_prefix

TENANT = uuid.uuid4()


def _chain(n: int, start: int = 1, prev: str = GENESIS) -> list[dict]:
    rows = []
    for seq in range(start, start + n):
        h = f"{seq:064x}"
        rows.append({"chain_seq": seq, "prev_hash": prev, "row_hash": h, "hash_ok": True})
        prev = h
    return rows


def _head(rows):
    return {"last_seq": rows[-1]["chain_seq"], "last_hash": rows[-1]["row_hash"]}


# ── the chain walk ──────────────────────────────────────────────────────────

def test_intact_chain_verifies():
    rows = _chain(5)
    out = check_chain(rows, _head(rows), [])
    assert out == {"ok": True, "rows_checked": 5, "first_seq": 1, "last_seq": 5, "errors": []}


def test_edited_row_is_found():
    rows = _chain(5)
    rows[2]["hash_ok"] = False
    out = check_chain(rows, _head(rows), [])
    assert not out["ok"] and out["errors"] == ["row 3: its contents no longer match its hash"]


def test_removed_row_is_found():
    rows = _chain(5)
    del rows[2]
    out = check_chain(rows, _head(rows), [])
    assert not out["ok"]
    assert "rows 3 to 3 are missing" in out["errors"] and "row 4: it does not link to row 2" in out["errors"]


def test_removed_tail_is_found_by_the_head():
    rows = _chain(5)
    head = _head(rows)
    out = check_chain(rows[:3], head, [])
    assert out["errors"] == ["the last row is 3 but the chain head is at row 5"]


def test_removed_head_rows_need_a_checkpoint():
    rows = _chain(6)
    kept = rows[3:]
    assert check_chain(kept, _head(rows), [])["errors"] == [
        "row 4: the chain starts here without a checkpoint for the rows before it"]
    cp = {"through_seq": 3, "through_hash": rows[2]["row_hash"]}
    assert check_chain(kept, _head(rows), [cp])["ok"]
    forged = {"through_seq": 3, "through_hash": "f" * 64}  # a checkpoint that names another hash does not cover it
    assert not check_chain(kept, _head(rows), [forged])["ok"]


def test_everything_purged_verifies_from_the_checkpoint():
    assert check_chain([], {"last_seq": 9, "last_hash": "a" * 64}, [{"through_seq": 9, "through_hash": "a" * 64}])["ok"]
    assert not check_chain([], {"last_seq": 9, "last_hash": "a" * 64}, [])["ok"]


def test_errors_are_capped():
    rows = _chain(50)
    for r in rows:
        r["hash_ok"] = False
    assert len(check_chain(rows, _head(rows), [])["errors"]) == 20


# ── the checkpoint purge ────────────────────────────────────────────────────

class _Res:
    def __init__(self, rows=(), rowcount=0):
        self._rows, self.rowcount = list(rows), rowcount

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._rows[0][0] if self._rows else None


class _Session:
    def __init__(self, last_seq, first_kept):
        self.last_seq, self.first_kept, self.sql, self.inserts = last_seq, first_kept, [], []

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.sql.append((sql, params))
        if sql.startswith("SELECT last_seq"):
            return _Res([(self.last_seq,)] if self.last_seq is not None else [])
        if sql.startswith("SELECT min(chain_seq)"):
            return _Res([(self.first_kept,)])
        if sql.startswith("SELECT row_hash"):
            return _Res([(f"{params['s']:064x}",)])
        if sql.startswith("DELETE FROM audit_log"):
            return _Res(rowcount=params["s"])
        if sql.startswith("INSERT INTO audit_log"):
            self.inserts.append(params)
        return _Res()


def test_purge_deletes_the_prefix_under_the_flag_and_writes_a_checkpoint():
    from datetime import datetime, timezone

    s = _Session(last_seq=10, first_kept=7)
    assert purge_prefix(s, str(TENANT), datetime(2026, 1, 1, tzinfo=timezone.utc)) == 6
    stmts = [q for q, _ in s.sql]
    i = stmts.index("DELETE FROM audit_log WHERE tenant_id = :t AND chain_seq <= :s")
    assert stmts[i - 1] == "SET LOCAL app.audit_purge = 'on'" and stmts[i + 1] == "SET LOCAL app.audit_purge = 'off'"
    (cp,) = s.inserts
    assert cp["a"] == "audit.checkpoint" and f'"through_hash": "{6:064x}"' in cp["af"] and '"through_seq": 6' in cp["af"]


def test_purge_without_cutoff_takes_everything_and_nothing_when_no_chain():
    s = _Session(last_seq=4, first_kept=None)
    assert purge_prefix(s, str(TENANT)) == 4
    assert purge_prefix(_Session(last_seq=None, first_kept=None), str(TENANT)) == 0
    s = _Session(last_seq=4, first_kept=1)  # the oldest row is still in the window: nothing goes
    assert purge_prefix(s, str(TENANT), __import__("datetime").datetime.now()) == 0 and not s.inserts


# ── the middleware ──────────────────────────────────────────────────────────

class _Tenant(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request.state.tenant_id = TENANT
        request.state.local_user_id = None
        request.state.local_user_email = "auditor@example.com"
        return await call_next(request)


ran: list[str] = []


async def _csv(request):
    return Response("id,name\n1,a\n2,b\n3,c\n", media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="rules.csv"'})


async def _json(request):
    return JSONResponse({"items": []})


async def _self_audited(request):
    request.state.audit_written = True
    return Response(b"PK..", media_type="application/zip")


async def _user(request):
    ran.append("handler")
    return JSONResponse({"ok": True})


@pytest.fixture()
def client(monkeypatch):
    rows: list[dict] = []
    state = {"fail": False}

    def insert(row):
        if state["fail"]:
            raise RuntimeError("db down")
        rows.append(row)

    monkeypatch.setattr(mw, "_insert_audit_row", insert)
    ran.clear()
    app = Starlette(routes=[Route("/api/v1/rules/export", _csv), Route("/api/v1/rules", _json),
                            Route("/api/v1/processes/x/export/signavio", _self_audited),
                            Route("/api/v1/users/{uid}", _user, methods=["PUT"])],
                    middleware=[Middleware(_Tenant), Middleware(mw.AuditMiddleware)])
    with TestClient(app) as c:
        yield c, rows, state


def test_download_is_audited_with_who_what_and_how_many(client):
    c, rows, _ = client
    r = c.get("/api/v1/rules/export?module=material_master&api_key=hunter2")
    assert r.status_code == 200 and r.text.startswith("id,name")
    (row,) = rows
    assert row["action"] == "download" and row["method"] == "GET" and row["actor_email"] == "auditor@example.com"
    assert row["after_json"]["row_count"] == 3 and row["after_json"]["filename"] == "rules.csv"
    assert row["after_json"]["query"]["module"] == "material_master"
    assert row["after_json"]["query"]["api_key"] != "hunter2"  # secret-named parameters are masked


def test_download_is_withheld_when_its_audit_row_cannot_be_written(client):
    c, rows, state = client
    state["fail"] = True
    r = c.get("/api/v1/rules/export")
    assert r.status_code == 503 and "id,name" not in r.text and rows == []


def test_plain_reads_and_self_audited_exports_add_no_row(client):
    c, rows, _ = client
    assert c.get("/api/v1/rules").status_code == 200
    assert c.get("/api/v1/processes/x/export/signavio").status_code == 200
    assert rows == []


def test_security_change_is_written_ahead_or_refused(client):
    c, rows, state = client
    assert c.put("/api/v1/users/u1", json={"role": "admin"}).status_code == 200
    # the outcome row is a background task; the write-ahead row is already in
    assert rows[0]["status_code"] == 0 and rows[0]["before_json"] == {"role": "admin"} and ran == ["handler"]
    state["fail"] = True
    ran.clear()
    assert c.put("/api/v1/users/u1", json={"role": "admin"}).status_code == 503
    assert ran == []  # the change never ran
