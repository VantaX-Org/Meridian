"""Report history and scheduled reports (migration 089) against a real Postgres, RLS enforced.

Routes run as a NOBYPASSRLS role over LocalAuthMiddleware; the object store is an in-memory dict
and report rendering is stubbed (the builders have their own tests). Covers: the migration
(tables, ENABLE + FORCE RLS, policy), tenant isolation, history list/download/delete with the
creator-or-admin rule, the download hook that stores files, schedule CRUD and validation, run
now, and the beat task (due slots in the schedule's time zone, idempotency per slot).
Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, time, timedelta, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_report_lib_app"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TABLES = ("report_files", "report_schedules", "report_schedule_runs")


@pytest.fixture(scope="module")
def engines():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


@pytest.fixture()
def store(monkeypatch):
    """The object store as a dict."""
    from api.services import report_history as rh

    objects: dict[str, bytes] = {}
    monkeypatch.setattr(rh.storage, "upload_file", lambda b, k, d, ct="": objects.__setitem__(k, d) or k)
    monkeypatch.setattr(rh.storage, "download_file", lambda b, k: objects[k])
    monkeypatch.setattr(rh.storage, "delete_file", lambda b, k: objects.pop(k, None))
    return objects


def _tenant(owner, name="T"):
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": name})
    return tid


def _user(owner, tid, name):
    from sqlalchemy import text

    uid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, 'analyst')"),
                  {"u": uid, "t": tid, "e": f"{name}@example.test", "n": name})
    return uid


def _run(owner, tid, label="Run 1", report_json=None, system_id=None):
    from sqlalchemy import text
    import json

    vid = str(uuid.uuid4())
    meta = {"system_id": system_id} if system_id else {}
    with owner.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, metadata) "
                       "VALUES (:v, :t, :l, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "l": label, "m": json.dumps(meta)})
        if report_json is not None:
            c.execute(text("INSERT INTO reports (version_id, tenant_id, report_json) VALUES (:v, :t, CAST(:j AS jsonb))"),
                      {"v": vid, "t": tid, "j": json.dumps(report_json)})
    return vid


def _channel(owner, tid, kind="email", target="ops@example.test"):
    from sqlalchemy import text

    with owner.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return str(c.execute(text("INSERT INTO alert_channels (tenant_id, kind, target) VALUES (:t, :k, :x) RETURNING id"),
                             {"t": tid, "k": kind, "x": target}).scalar())


# ── migration ────────────────────────────────────────────────────────────────

def test_migration_creates_tables_with_forced_rls_and_tenant_policy(engines):
    from sqlalchemy import text

    owner, _ = engines
    with owner.connect() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() == "089"
        for t in _TABLES:
            rls, force = c.execute(text("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = :t"),
                                   {"t": t}).one()
            assert rls and force, t
            qual = c.execute(text("SELECT qual FROM pg_policies WHERE tablename = :t AND policyname = :p"),
                             {"t": t, "p": f"{t}_rls"}).scalar()
            assert qual and "app.tenant_id" in qual, t
        unique = c.execute(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                                "WHERE conname = 'uq_report_schedule_runs_slot'")).scalar()
        assert unique == "UNIQUE (schedule_id, due_at)"


def test_rls_isolates_history_and_schedules_between_tenants(engines, store):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services import report_history as rh
    from workers.db import tenant_session

    owner, app = engines
    a, b = _tenant(owner, "A"), _tenant(owner, "B")
    for tid in (a, b):
        with tenant_session(app, tid) as s:
            rh.store_report_file(s, tid, kind="board", data=b"%PDF a", file_name="x.pdf")
            s.execute(text("INSERT INTO report_schedules (tenant_id, name, kind, format, cadence) "
                           "VALUES (:t, 'S', 'board', 'pdf', 'daily')"), {"t": tid})
            s.commit()
    with tenant_session(app, a) as s:
        for t in ("report_files", "report_schedules"):
            assert s.execute(text(f"SELECT count(*) FROM {t}")).scalar() == 1
            assert s.execute(text(f"SELECT count(*) FROM {t} WHERE tenant_id = :b"), {"b": b}).scalar() == 0
        # writing another tenant's row is refused by the policy
        with pytest.raises(Exception):
            s.execute(text("INSERT INTO report_files (tenant_id, kind, name, format, file_name, content_type, "
                           "size_bytes, sha256, content) VALUES (:b, 'board', 'x', 'pdf', 'x.pdf', 'application/pdf', "
                           "1, 'x', '\\x00')"), {"b": b})
    # no tenant set: nothing is visible
    with Session(app) as s:
        s.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": str(uuid.uuid4())})
        assert s.execute(text("SELECT count(*) FROM report_files")).scalar() == 0


def test_store_falls_back_to_postgres_under_the_cap_only(engines, monkeypatch):
    from sqlalchemy import text

    from api.services import report_history as rh
    from workers.db import tenant_session

    owner, app = engines
    tid = _tenant(owner)

    def boom(*a, **k):
        raise ConnectionError("store down")

    monkeypatch.setattr(rh.storage, "upload_file", boom)
    monkeypatch.setattr(rh, "DB_FALLBACK_MAX_BYTES", 10)
    with tenant_session(app, tid) as s:
        small = rh.store_report_file(s, tid, kind="json", data=b'{"a":1}', file_name="r.json")
        big = rh.store_report_file(s, tid, kind="json", data=b"x" * 11, file_name="r.json")
        s.commit()
        assert big is None
        row = s.execute(text("SELECT storage_key, content, format, size_bytes FROM report_files WHERE id = :i"),
                        {"i": small}).one()
    assert row.storage_key is None and bytes(row.content) == b'{"a":1}' and row.format == "json" and row.size_bytes == 7


# ── routes ───────────────────────────────────────────────────────────────────

def _client(app_eng, tid, users: dict[str, str]):
    """An app with both report routers over LocalAuthMiddleware; tokens are user ids."""
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    import api.middleware.local_auth as local_auth
    from api.deps import Tenant, get_db, get_tenant
    from api.middleware.local_auth import LocalAuthMiddleware
    from api.routes.report_library import router as lib_router
    from api.routes.reports import router as reports_router

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.add_middleware(LocalAuthMiddleware)
    api.include_router(lib_router)
    api.include_router(reports_router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T", [])
    local_auth._load_jwt_secret = lambda: "test-secret"
    local_auth.decode_access_token = lambda token, secret: (
        {"sub": token, "email": f"{users[token]}@example.test"} if token in users else None)
    return api, aeng


def _go(coro, aeng):
    """Run a scenario and dispose its engine on the same event loop."""
    async def main():
        try:
            return await coro
        finally:
            await aeng.dispose()

    return asyncio.run(main())


@pytest.fixture()
def auth_patch(monkeypatch):
    import api.middleware.local_auth as local_auth

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(local_auth, "_load_jwt_secret", local_auth._load_jwt_secret)
    monkeypatch.setattr(local_auth, "decode_access_token", local_auth.decode_access_token)


def _h(uid, role):
    return {"Authorization": f"Bearer {uid}", "X-User-Role": role}


def test_history_routes_list_download_and_delete_by_creator_or_admin(engines, store, auth_patch):
    from httpx import ASGITransport, AsyncClient

    from api.services import report_history as rh
    from workers.db import tenant_session

    owner, app_eng = engines
    tid = _tenant(owner)
    ana, bob, adm = _user(owner, tid, "ana"), _user(owner, tid, "bob"), _user(owner, tid, "adm")
    vid = _run(owner, tid, "Run A")
    with tenant_session(app_eng, tid) as s:
        f1 = rh.store_report_file(s, tid, kind="board", data=b"%PDF board", file_name="board.pdf", version_id=vid,
                                  created_by=ana, created_by_email="ana@example.test")
        s.commit()  # its own transaction, so created_at orders the two
        f2 = rh.store_report_file(s, tid, kind="workbook", data=b"PK book", file_name="book.xlsx", created_by=ana)
        s.commit()
    other = _tenant(owner, "Other")
    with tenant_session(app_eng, other) as s:
        foreign = rh.store_report_file(s, other, kind="board", data=b"%PDF other", file_name="o.pdf")
        s.commit()
    api, aeng = _client(app_eng, tid, {ana: "ana", bob: "bob", adm: "adm"})

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r = await c.get("/api/v1/reports/history", headers=_h(ana, "analyst"))
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["total"] == 2 and [i["id"] for i in body["items"]] == [f2, f1]
            board = next(i for i in body["items"] if i["id"] == f1)
            assert board["run_label"] == "Run A" and board["format"] == "pdf" and board["size_bytes"] == 10
            assert board["created_by_label"] == "ana" and board["can_delete"] is True
            r = await c.get("/api/v1/reports/history?kind=workbook", headers=_h(bob, "analyst"))
            assert [i["id"] for i in r.json()["items"]] == [f2] and r.json()["items"][0]["can_delete"] is False
            # viewers without export see nothing
            assert (await c.get("/api/v1/reports/history", headers=_h(bob, "viewer"))).status_code == 403

            r = await c.get(f"/api/v1/reports/history/{f1}/download", headers=_h(bob, "analyst"))
            assert r.status_code == 200 and r.content == b"%PDF board"
            assert 'filename="board.pdf"' in r.headers["content-disposition"]
            # another tenant's file is not found, not forbidden
            assert (await c.get(f"/api/v1/reports/history/{foreign}/download", headers=_h(ana, "analyst"))).status_code == 404
            assert (await c.delete(f"/api/v1/reports/history/{foreign}", headers=_h(adm, "admin"))).status_code == 404

            assert (await c.delete(f"/api/v1/reports/history/{f1}", headers=_h(bob, "analyst"))).status_code == 403
            assert (await c.delete(f"/api/v1/reports/history/{f1}", headers=_h(ana, "analyst"))).status_code == 204
            assert (await c.delete(f"/api/v1/reports/history/{f2}", headers=_h(adm, "admin"))).status_code == 204
            assert (await c.get("/api/v1/reports/history", headers=_h(ana, "analyst"))).json()["total"] == 0

    _go(scenario(), aeng)
    assert not any(k.startswith(f"history/{tid}/") for k in store)  # objects removed with their rows
    assert any(k.startswith(f"history/{other}/") for k in store)


def test_a_report_download_is_kept_in_the_history(engines, store, auth_patch):
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    owner, app_eng = engines
    tid = _tenant(owner)
    ana = _user(owner, tid, "ana")
    vid = _run(owner, tid, "Run J", report_json={"summary": {"dqs": 81}})
    api, aeng = _client(app_eng, tid, {ana: "ana"})

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r = await c.get(f"/api/v1/reports/{vid}/export.json", headers=_h(ana, "analyst"))
            assert r.status_code == 200
            return r.content

    content = _go(scenario(), aeng)
    with owner.connect() as c:
        row = c.execute(text("SELECT kind, format, version_id, created_by, created_by_email, source, storage_key, size_bytes "
                             "FROM report_files WHERE tenant_id = :t"), {"t": tid}).one()
    assert (row.kind, row.format, str(row.version_id), str(row.created_by), row.source) == ("json", "json", vid, ana, "download")
    assert row.created_by_email == "ana@example.test" and row.size_bytes == len(content)
    assert store[row.storage_key] == content


def test_schedule_crud_validation_permissions_and_run_now(engines, store, auth_patch, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    import api.routes.report_library as lib

    owner, app_eng = engines
    tid = _tenant(owner)
    ana, bob, adm = _user(owner, tid, "ana"), _user(owner, tid, "bob"), _user(owner, tid, "adm")
    ch = _channel(owner, tid, "slack", "https://hooks.example.test/secret-token")
    foreign_ch = _channel(owner, _tenant(owner, "Other"))
    queued: list[tuple] = []
    monkeypatch.setattr(lib, "_enqueue_run", lambda t, s, d: queued.append((t, s, d)))
    api, aeng = _client(app_eng, tid, {ana: "ana", bob: "bob", adm: "adm"})
    body = {"name": "Monday board", "kind": "board", "cadence": "weekly", "weekday": 0, "time_of_day": "07:30",
            "timezone": "Africa/Johannesburg", "recipient_user_ids": [bob], "recipient_channel_ids": [ch]}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            opts = (await c.get("/api/v1/reports/schedules/options", headers=_h(ana, "analyst"))).json()
            assert {t["id"] for t in opts["types"]} >= {"board", "workbook", "trend"}
            assert "compare" not in {t["id"] for t in opts["types"]}
            assert opts["timezone"] == "UTC"
            assert [x["label"] for x in opts["channels"]] == ["Slack"]  # never the webhook URL
            assert "secret-token" not in str(opts)

            r = await c.post("/api/v1/reports/schedules", json=body, headers=_h(ana, "analyst"))
            assert r.status_code == 201, r.text
            s = r.json()
            assert s["format"] == "pdf" and s["params"] == {"scope": "latest"} and s["time_of_day"] == "07:30"
            assert s["summary"] == "Every Monday at 07:30 (Africa/Johannesburg)" and s["can_edit"]
            nxt = datetime.fromisoformat(s["next_run_at"])
            assert nxt.astimezone(timezone(timedelta(hours=2))).time() == time(7, 30)
            assert nxt.astimezone(timezone.utc).weekday() == 0 and nxt > datetime.now(timezone.utc)

            for bad, why in (({"kind": "compare"}, "cannot be scheduled"), ({"kind": "object"}, "needs one"),
                             ({"kind": "board", "format": "xlsx"}, "PDF only"),
                             ({"timezone": "Mars/Base"}, ""), ({"recipient_channel_ids": [foreign_ch]}, "not found"),
                             ({"recipient_user_ids": [str(uuid.uuid4())]}, "not active"),
                             ({"params": {"scope": str(uuid.uuid4())}}, "System not found")):
                r = await c.post("/api/v1/reports/schedules", json={**body, **bad}, headers=_h(ana, "analyst"))
                assert r.status_code == 422, (bad, r.text)
                assert why in r.text, (bad, r.text)
            assert (await c.post("/api/v1/reports/schedules", json=body, headers=_h(bob, "viewer"))).status_code == 403

            sid = s["id"]
            listed = (await c.get("/api/v1/reports/schedules", headers=_h(bob, "analyst"))).json()
            assert [x["id"] for x in listed] == [sid] and listed[0]["can_edit"] is False
            upd = {**body, "cadence": "monthly", "day_of_month": 31, "enabled": False}
            assert (await c.put(f"/api/v1/reports/schedules/{sid}", json=upd, headers=_h(bob, "analyst"))).status_code == 403
            r = await c.put(f"/api/v1/reports/schedules/{sid}", json=upd, headers=_h(ana, "analyst"))
            assert r.status_code == 200 and r.json()["day_of_month"] == 31 and r.json()["weekday"] is None
            assert r.json()["enabled"] is False

            assert (await c.post(f"/api/v1/reports/schedules/{sid}/run", headers=_h(bob, "analyst"))).status_code == 403
            r = await c.post(f"/api/v1/reports/schedules/{sid}/run", headers=_h(adm, "admin"))
            assert r.status_code == 202 and r.json()["queued"] is True
            assert queued and queued[0][:2] == (tid, sid)

            assert (await c.delete(f"/api/v1/reports/schedules/{sid}", headers=_h(bob, "analyst"))).status_code == 403
            assert (await c.delete(f"/api/v1/reports/schedules/{sid}", headers=_h(ana, "analyst"))).status_code == 204
            assert (await c.get("/api/v1/reports/schedules", headers=_h(ana, "analyst"))).json() == []

    _go(scenario(), aeng)


# ── the beat task ────────────────────────────────────────────────────────────

def _schedule(owner, tid, *, created_by=None, users=(), channels=(), next_run_at, tz="Europe/London",
              cadence="daily", at=time(6, 0), kind="board", scope="latest"):
    from sqlalchemy import text
    import json

    with owner.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return str(c.execute(text("""
            INSERT INTO report_schedules (tenant_id, name, kind, format, params, cadence, time_of_day, timezone,
                                          recipient_user_ids, recipient_channel_ids, next_run_at, created_by)
            VALUES (:t, 'Daily board', :kind, 'pdf', CAST(:p AS jsonb), :cad, :at, :tz, CAST(:u AS uuid[]),
                    CAST(:c AS uuid[]), :n, CAST(:by AS uuid)) RETURNING id
        """), {"t": tid, "kind": kind, "p": json.dumps({"scope": scope}), "cad": cadence, "at": at, "tz": tz,
               "u": list(users), "c": list(channels), "n": next_run_at, "by": created_by}).scalar())


def test_beat_generates_due_slot_once_stores_and_delivers_then_advances_in_tenant_tz(engines, store):
    from sqlalchemy import text

    from api.services import report_history as rh
    from workers.db import tenant_session
    from workers.tasks import report_schedules as task

    owner, app_eng = engines
    tid = _tenant(owner)
    ana = _user(owner, tid, "ana")
    vid = _run(owner, tid, "Run B")
    mail_ch = _channel(owner, tid, "email", "ops@example.test")
    slack = _channel(owner, tid, "slack", "https://hooks.example.test/x")
    # 06:00 London in summer is 05:00 UTC; the slot is due.
    due = datetime(2026, 7, 1, 5, 0, tzinfo=timezone.utc)
    sid = _schedule(owner, tid, created_by=ana, users=[ana], channels=[mail_ch, slack], next_run_at=due)
    later = _schedule(owner, tid, next_run_at=datetime(2026, 7, 2, 5, 0, tzinfo=timezone.utc))
    now = datetime(2026, 7, 1, 5, 7, tzinfo=timezone.utc)

    emails, posts, generated = [], [], []

    def gen(session, t, kind, params):
        generated.append((t, kind, params))
        return rh.Generated(b"%PDF scheduled", f"meridian_{kind}_{vid}.pdf", "application/pdf", vid)

    kw = dict(base_url="https://meridian.example.test", generate=gen,
              send_email=lambda to, subj, html, att: emails.append((to, subj, att)) or True,
              post=lambda ch, payload, summary, link: posts.append((ch["kind"], payload, link)) or True)

    with tenant_session(app_eng, tid) as s:
        first = task.process_tenant(s, tid, now, **kw)
        again = task.process_tenant(s, tid, now, **kw)  # beat fires twice: nothing more happens
    assert first == {"due": 1, "ran": 1, "already_claimed": 0}
    assert again == {"due": 0, "ran": 0, "already_claimed": 0}
    assert len(generated) == 1 and generated[0][2] == {"scope": "latest"}
    assert sorted(e[0] for e in emails) == ["ana@example.test", "ops@example.test"]
    assert all(e[2] == [(f"meridian_board_{vid}.pdf", b"%PDF scheduled", "application/pdf")] for e in emails)
    assert posts[0][0] == "slack" and posts[0][2] == "https://meridian.example.test/insights/reports"
    assert posts[0][1]["event"] == "meridian.report_ready"

    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        run = c.execute(text("SELECT status, delivered, failed, report_file_id, manual FROM report_schedule_runs "
                             "WHERE schedule_id = :s"), {"s": sid}).one()
        f = c.execute(text("SELECT source, schedule_id, version_id, created_by, name FROM report_files WHERE id = :f"),
                      {"f": run.report_file_id}).one()
        sched = c.execute(text("SELECT next_run_at, last_status, last_run_at FROM report_schedules WHERE id = :s"),
                          {"s": sid}).one()
        untouched = c.execute(text("SELECT next_run_at, last_run_at FROM report_schedules WHERE id = :s"),
                              {"s": later}).one()
        notes = c.execute(text("SELECT count(*) FROM notifications WHERE tenant_id = :t AND user_id = :u "
                               "AND type = 'report'"), {"t": tid, "u": ana}).scalar()
    assert (run.status, run.delivered, run.failed, run.manual) == ("sent", 3, 0, False)
    assert (f.source, str(f.schedule_id), str(f.version_id), str(f.created_by), f.name) == ("schedule", sid, vid, ana, "Daily board")
    assert notes == 1
    # next slot: tomorrow 06:00 London (BST) = 05:00 UTC
    assert sched.next_run_at == datetime(2026, 7, 2, 5, 0, tzinfo=timezone.utc) and sched.last_status == "sent"
    assert untouched.last_run_at is None and untouched.next_run_at == datetime(2026, 7, 2, 5, 0, tzinfo=timezone.utc)


def test_a_slot_claimed_elsewhere_is_not_run_again_and_next_run_still_advances(engines, store):
    from sqlalchemy import text

    from workers.db import tenant_session
    from workers.tasks import report_schedules as task

    owner, app_eng = engines
    tid = _tenant(owner)
    # winter: 06:00 London = 06:00 UTC
    due = datetime(2026, 12, 1, 6, 0, tzinfo=timezone.utc)
    sid = _schedule(owner, tid, next_run_at=due)
    with tenant_session(app_eng, tid) as s:
        assert task.claim_slot(s, tid, sid, due, False)  # another worker took the slot
        s.commit()
        calls = []
        res = task.process_tenant(s, tid, due + timedelta(minutes=1),
                                  generate=lambda *a: calls.append(a), send_email=lambda *a: True)
    assert res == {"due": 1, "ran": 0, "already_claimed": 1} and calls == []
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        assert c.execute(text("SELECT count(*) FROM report_schedule_runs WHERE schedule_id = :s"), {"s": sid}).scalar() == 1
        assert c.execute(text("SELECT next_run_at FROM report_schedules WHERE id = :s"), {"s": sid}).scalar() == \
            datetime(2026, 12, 2, 6, 0, tzinfo=timezone.utc)


def test_no_finished_run_skips_the_slot_and_a_channel_failure_is_partial(engines, store):
    from sqlalchemy import text

    from api.services import report_history as rh
    from workers.db import tenant_session
    from workers.tasks import report_schedules as task

    owner, app_eng = engines
    tid = _tenant(owner)
    due = datetime(2026, 12, 1, 6, 0, tzinfo=timezone.utc)
    empty = _schedule(owner, tid, next_run_at=due)  # no run yet: generate_report raises NoRun
    with tenant_session(app_eng, tid) as s:
        task.process_tenant(s, tid, due, send_email=lambda *a: True)
    vid = _run(owner, tid)
    ch = _channel(owner, tid, "webhook", "https://hooks.example.test/w")
    sid = _schedule(owner, tid, channels=[ch, _channel(owner, tid, "email", "x@example.test")], next_run_at=due)
    with tenant_session(app_eng, tid) as s:
        task.process_tenant(s, tid, due, generate=lambda *a: rh.Generated(b"%PDF", "r.pdf", "application/pdf", vid),
                            send_email=lambda *a: True, post=lambda *a: False)
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        st = dict(c.execute(text("SELECT schedule_id::text, status FROM report_schedule_runs "
                                     "WHERE tenant_id = :t"), {"t": tid}).fetchall())
        detail = c.execute(text("SELECT detail FROM report_schedule_runs WHERE schedule_id = :s"), {"s": sid}).scalar()
    assert st == {empty: "skipped", sid: "partial"}
    assert "Webhook not delivered" in detail and "hooks.example.test" not in detail


def test_run_now_uses_its_own_slot(engines, store, monkeypatch):
    from sqlalchemy import text

    from api.services import report_history as rh
    from workers.tasks import report_schedules as task

    owner, app_eng = engines
    tid = _tenant(owner)
    vid = _run(owner, tid)
    due = datetime(2026, 12, 1, 6, 0, tzinfo=timezone.utc)
    sid = _schedule(owner, tid, next_run_at=due)
    monkeypatch.setattr(task, "get_sync_engine", lambda: app_eng)
    orig = task.run_slot
    gen = lambda *a: rh.Generated(b"%PDF now", "n.pdf", "application/pdf", vid)  # noqa: E731
    monkeypatch.setattr(task, "run_slot", lambda *a, **k: orig(*a, **{**k, "generate": gen,
                                                                       "send_email": lambda *x: True}))
    stamp = "2026-11-30T09:15:00+00:00"
    first = task.run_report_schedule.run(tid, sid, stamp)
    second = task.run_report_schedule.run(tid, sid, stamp)
    assert first["status"] == "sent" and second == {"status": "already_claimed"}
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        rows = c.execute(text("SELECT due_at, manual FROM report_schedule_runs WHERE schedule_id = :s"), {"s": sid}).all()
        src = c.execute(text("SELECT source FROM report_files WHERE schedule_id = :s"), {"s": sid}).scalar()
        nxt = c.execute(text("SELECT next_run_at FROM report_schedules WHERE id = :s"), {"s": sid}).scalar()
    assert [(r.due_at.isoformat(), r.manual) for r in rows] == [(stamp, True)]
    assert src == "run_now" and nxt == due  # the scheduled slot is untouched

