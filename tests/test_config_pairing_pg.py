"""Config pairing on Postgres: migration 075, SQL helpers, load_config, enqueue, routes and reports.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so tenant policies are really exercised.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_pairing_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def app_engine():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
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


def _tenant(owner) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"P-{tid[:8]}"})
    return tid


def _system(app, tid: str, name: str, system_type: str = "ecc", role: str = "source",
            target: str | None = None) -> str:
    from sqlalchemy import text

    sid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, role, target_system_id) "
                       "VALUES (:s, :t, :n, :st, :r, CAST(:tg AS uuid))"),
                  {"s": sid, "t": tid, "n": name, "st": system_type, "r": role, "tg": target})
    return sid


def _load(app, tid: str, sid: str, items: list[tuple[str, str, dict]], origin: str = "connection",
          status: str = "completed", minutes_ago: int = 0) -> str:
    """One config_loads row plus its items; finished_at orders loads oldest first by minutes_ago."""
    import json

    from sqlalchemy import text

    lid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO config_loads (id, tenant_id, system_id, system_type, origin, status, "
                       "created_at, finished_at) SELECT :l, :t, id, system_type, :o, :st, "
                       "now() - make_interval(mins => :m), "
                       "CASE WHEN :st = 'completed' THEN now() - make_interval(mins => :m) END "
                       "FROM sap_systems WHERE id = :s"),
                  {"l": lid, "t": tid, "s": sid, "o": origin, "st": status, "m": minutes_ago})
        for obj, key, vals in items:
            c.execute(text('INSERT INTO config_items (tenant_id, load_id, object, key, "values") '
                           "VALUES (:t, :l, :o, :k, CAST(:v AS jsonb))"),
                      {"t": tid, "l": lid, "o": obj, "k": key, "v": json.dumps(vals)})
    return lid


@pg
def test_system_role_defaults_to_source_and_is_checked(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, app = app_engine
    tid = _tenant(owner)
    sid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'PRD')"), {"s": sid, "t": tid})
        assert c.execute(text("SELECT role FROM sap_systems WHERE id = :s"), {"s": sid}).scalar() == "source"
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET role = 'archive' WHERE id = :s"), {"s": sid})
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET target_system_id = id WHERE id = :s"), {"s": sid})


@pg
def test_deleting_a_target_clears_the_source_pointer(app_engine):
    from sqlalchemy import text

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM sap_systems WHERE id = :s"), {"s": tgt})
        assert c.execute(text("SELECT target_system_id FROM sap_systems WHERE id = :s"), {"s": src}).scalar() is None


@pg
def test_value_map_scope_is_unique_with_null_scope(app_engine):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    ins = ("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, "
           "source_system_id, status) VALUES (gen_random_uuid(), :t, 'config', 'T077K.KTOKK', 'LIEF', 'KRED', "
           "CAST(:s AS uuid), :st)")
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text(ins), {"t": tid, "s": None, "st": "confirmed"})
        c.execute(text(ins), {"t": tid, "s": src, "st": "proposed"})  # scoped row coexists with the global row
        assert c.execute(text("SELECT status FROM transfer_value_mappings WHERE source_system_id IS NULL")).scalar() \
            == "confirmed"
    with pytest.raises(IntegrityError):  # a second global row is a duplicate (NULLS NOT DISTINCT)
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text(ins), {"t": tid, "s": None, "st": "confirmed"})
    with pytest.raises(IntegrityError):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE transfer_value_mappings SET status = 'maybe'"))


@pg
def test_migration_075_downgrades_cleanly(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    _alembic("downgrade", "068")
    with owner.begin() as c:
        cols = {r[0] for r in c.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'sap_systems'"))}
        assert "role" not in cols and "target_system_id" not in cols
        assert c.execute(text("SELECT 1 FROM pg_constraint WHERE conname = 'uq_transfer_value_mappings'")).scalar()
    _alembic("upgrade", "head")


def _session(app, tid: str):
    from workers.db import tenant_session

    return tenant_session(app, tid)


@pg
def test_config_basis_reads_completed_then_fresh_running(app_engine):
    from api.services.config_pairing import config_basis

    owner, app = app_engine
    tid = _tenant(owner)
    a, b, c = (_system(app, tid, n) for n in ("PRD", "QAS", "DEV"))
    _load(app, tid, a, [], status="completed")
    _load(app, tid, b, [], status="running", minutes_ago=5)
    _load(app, tid, c, [], status="running", minutes_ago=45)  # stale
    with _session(app, tid) as s:
        assert [config_basis(s, x) for x in (a, b, c)] == ["loaded", "loading", "none"]
    with _session(app, _tenant(owner)) as s:  # another tenant never sees these loads
        assert config_basis(s, a) == "none"


@pg
def test_resolve_target_prefers_a_completed_load_then_the_baseline(app_engine):
    from api.services.config_pairing import BASELINE_LABEL, resolve_target

    owner, app = app_engine
    tid = _tenant(owner)
    lone = _system(app, tid, "DEV")
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    with _session(app, tid) as s:
        t = resolve_target(s, lone)
        assert (t.system_id, t.baseline, t.label, t.system_type) == (None, True, BASELINE_LABEL, "s4hana_cloud")
        t = resolve_target(s, src)
        assert (t.system_id, t.baseline, t.label) == (tgt, True, f"S4D ({BASELINE_LABEL})")
    lid = _load(app, tid, tgt, [("T001", "BUKRS=1000", {"BUKRS": "1000"})])
    with _session(app, tid) as s:
        t = resolve_target(s, src)
        assert (t.load_id, t.baseline, t.label) == (lid, False, "S4D")


@pg
def test_compare_counts_objects_and_returns_rows_for_one_object(app_engine):
    from api.services.config_pairing import compare

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    _load(app, tid, src, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"}), ("T077K", "KTOKK=0001", {"KTOKK": "0001"}),
                          ("T001", "BUKRS=1000", {"BUKRS": "1000"}), ("TVAK", "AUART=ZOR", {"AUART": "ZOR"})])
    _load(app, tid, tgt, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"}), ("T077K", "KTOKK=1", {"KTOKK": "1"}),
                          ("T001", "BUKRS=2000", {"BUKRS": "2000"})])
    with _session(app, tid) as s:
        out = compare(s, src, "T077K")
    assert out["target"] == {"system_id": tgt, "label": "S4D", "baseline": False}
    assert [o["object"] for o in out["objects"]] == ["T001", "T077K"]  # TVAK is not in the target
    t077k = next(o for o in out["objects"] if o["object"] == "T077K")
    assert (t077k["exists"], t077k["key_match"], t077k["missing"], t077k["proposable"]) == (1, 1, 0, 1)
    assert {r["source_key"] for r in out["rows"]} == {"KTOKK=KRED", "KTOKK=0001"}


@pg
def test_compare_with_no_source_load_is_empty(app_engine):
    from api.services.config_pairing import compare

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    with _session(app, tid) as s:
        out = compare(s, src)
    assert out["source_load_id"] is None and out["objects"] == [] and out["target"]["baseline"] is True


@pg
def test_write_drift_diffs_against_the_previous_completed_load(app_engine):
    from sqlalchemy import text

    from api.services.config_pairing import write_drift

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "PRD")
    first = _load(app, tid, sid, [("T001", "BUKRS=1000", {"BUTXT": "A"}), ("T001", "BUKRS=2000", {"BUTXT": "B"})],
                  minutes_ago=10)
    with _session(app, tid) as s:
        assert write_drift(s, tid, sid, first) == 0  # first load: nothing to diff
        s.commit()
    second = _load(app, tid, sid, [("T001", "BUKRS=1000", {"BUTXT": "A2"}), ("T001", "BUKRS=3000", {"BUTXT": "C"})])
    with _session(app, tid) as s:
        assert write_drift(s, tid, sid, second) == 3
        assert write_drift(s, tid, sid, second) == 3  # idempotent per load
        s.commit()
        rows = s.execute(text("SELECT element_value, change_type FROM config_drift_log WHERE run_id = :l "
                              "ORDER BY element_value"), {"l": second}).fetchall()
    assert [tuple(r) for r in rows] == [("BUKRS=1000", "changed"), ("BUKRS=2000", "removed"),
                                        ("BUKRS=3000", "added")]


@pg
def test_propose_scopes_to_the_pair_and_queues_once(app_engine):
    from sqlalchemy import text

    from api.services.config_pairing import propose

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    _load(app, tid, src, [("T077K", "KTOKK=0001", {"KTOKK": "0001"})])
    _load(app, tid, tgt, [("T077K", "KTOKK=1", {"KTOKK": "1"})])
    with _session(app, tid) as s:
        assert propose(s, tid, src) == {"proposed": 1, "skipped": 0, "target": "S4D"}
        s.commit()
        assert propose(s, tid, src) == {"proposed": 0, "skipped": 1, "target": "S4D"}
        s.commit()
        m = s.execute(text("SELECT target_field, source_value, target_value, status, source_system_id::text, "
                           "target_system_id::text FROM transfer_value_mappings")).fetchone()
        q = s.execute(text("SELECT item_type, domain, ai_recommendation, ai_confidence FROM stewardship_queue")).fetchall()
    assert tuple(m) == ("T077K.KTOKK", "0001", "1", "proposed", src, tgt)
    assert [tuple(r) for r in q] == [("config_value_match", "config", "T077K.KTOKK: 0001 → 1 (key match)", 1.0)]


@pg
def test_finding_context_uses_the_rule_condition_object(app_engine, monkeypatch):
    import json

    from sqlalchemy import text

    from api.services import config_applicability
    from api.services.config_pairing import finding_context

    owner, app = app_engine
    tid = _tenant(owner)
    src = _system(app, tid, "PRD")
    _load(app, tid, src, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"}), ("T077K", "KTOKK=ZZZZ", {"KTOKK": "ZZZZ"})])
    vid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": src})})
    monkeypatch.setattr(config_applicability, "condition",
                        lambda module, check_id: {"requires": {"object": "T077K"}})
    with _session(app, tid) as s:
        ctx = finding_context(s, "AP-001", "accounts_payable", vid, [])
    assert ctx["object"] == "T077K" and ctx["system_id"] == src and ctx["baseline"] is True
    assert ctx["source"] == ["KTOKK=KRED", "KTOKK=ZZZZ"]
    assert "KTOKK=ZZZZ" in ctx["missing"] and ctx["missing_total"] == len(ctx["missing"])


@pg
def test_finding_context_ignores_another_tenants_version_without_rls(app_engine, monkeypatch):
    import json

    from sqlalchemy import text

    from api.services import config_applicability
    from api.services.config_pairing import finding_context
    from workers.db import tenant_session

    owner, app = app_engine
    ta, tb = _tenant(owner), _tenant(owner)
    src = _system(app, tb, "PRD")
    _load(app, tb, src, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED"})])
    vid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tb})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tb, "m": json.dumps({"system_id": src})})
    monkeypatch.setattr(config_applicability, "condition",
                        lambda module, check_id: {"requires": {"object": "T077K"}})
    # the owner role bypasses RLS, so only the explicit tenant predicate can hide tenant B's rows
    with tenant_session(owner, ta) as s:
        ctx = finding_context(s, "AP-001", "accounts_payable", vid, [])
    assert ctx["system_id"] is None and ctx["source"] == []


@pg
def test_scope_sql_matches_only_global_and_exact_pair(app_engine):
    from sqlalchemy import text

    from api.services.config_pairing import SCOPE_SQL

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    rows = {"global": (None, None), "pair": (src, tgt), "src_only": (src, None), "tgt_only": (None, tgt)}
    with _session(app, tid) as s:
        for name, (a, b) in rows.items():
            s.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                           "target_value, note, source_system_id, target_system_id, status) VALUES "
                           "(gen_random_uuid(), CAST(:t AS uuid), 'config', 'T.F', 'a', 'b', :n, "
                           "CAST(:a AS uuid), CAST(:b AS uuid), 'confirmed')"), {"t": tid, "n": name, "a": a, "b": b})
        q = f"SELECT note FROM transfer_value_mappings WHERE {SCOPE_SQL} ORDER BY note"
        assert [r[0] for r in s.execute(text(q), {"src": src, "tgt": tgt})] == ["global", "pair", "src_only"]
        assert [r[0] for r in s.execute(text(q), {"src": src, "tgt": None})] == ["global", "src_only"]


@pg
def test_queue_proposal_conflict_ignores_open_dupes_but_not_resolved(app_engine):
    from sqlalchemy import text

    from api.services.config_pairing import _queue_proposal

    owner, app = app_engine
    tid = _tenant(owner)
    mid = str(uuid.uuid4())
    count = "SELECT count(*) FROM stewardship_queue WHERE source_id = CAST(:m AS uuid) AND status != 'resolved'"
    with _session(app, tid) as s:
        _queue_proposal(s, tid, mid, 1.0, "first")
        _queue_proposal(s, tid, mid, 1.0, "again")  # hits the ON CONFLICT clause
        assert s.execute(text(count), {"m": mid}).scalar() == 1
        s.execute(text("UPDATE stewardship_queue SET status = 'resolved' WHERE source_id = CAST(:m AS uuid)"),
                  {"m": mid})
        _queue_proposal(s, tid, mid, 1.0, "reopened")  # a resolved row does not block a new open one
        assert s.execute(text(count), {"m": mid}).scalar() == 1
        assert s.execute(text("SELECT count(*) FROM stewardship_queue WHERE source_id = CAST(:m AS uuid)"),
                         {"m": mid}).scalar() == 2


class _NoApiConnector:
    def load_config(self, system_type: str, progress=None):
        from sap.config_snapshot import NOT_AVAILABLE, ConfigSnapshot

        snap = ConfigSnapshot(system_type)
        snap.mark("T001", NOT_AVAILABLE, "no configuration API")
        return snap

    def close(self) -> None:
        pass


@pg
def test_load_config_stores_the_baseline_once_per_load(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.connectivity_manager import ConnectivityManager

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4C", "s4hana_cloud", "target")
    lid = _load(app, tid, sid, [], status="running")
    for _ in range(2):  # a retried task reruns load_config on the same load id
        with Session(app) as s:
            m = ConnectivityManager(s, tid)
            m._load_system = lambda system_id: {}
            m._build_connection_params = lambda row: {"system_type": "s4hana_cloud"}
            m._get_connector = lambda system_type, params: _NoApiConnector()
            out = m.load_config(sid, lid)
    assert out["origin"] == "best_practice" and out["items"] > 0
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        n = c.execute(text("SELECT count(*) FROM config_items WHERE load_id = :l"), {"l": lid}).scalar()
        origin, objects = c.execute(text("SELECT origin, objects FROM config_loads WHERE id = :l"), {"l": lid}).one()
    assert n == out["items"] and origin == "best_practice"
    assert objects[0]["detail"] == "SAP standard baseline; no configuration API"


def _patch_connector(monkeypatch) -> None:
    from api.services.connectivity_manager import ConnectivityManager

    monkeypatch.setattr(ConnectivityManager, "_load_system", lambda self, system_id: {})
    monkeypatch.setattr(ConnectivityManager, "_build_connection_params",
                        lambda self, row: {"system_type": "s4hana_cloud"})
    monkeypatch.setattr(ConnectivityManager, "_get_connector", lambda self, system_type, params: _NoApiConnector())


@pg
def test_load_config_writes_drift_once_per_load(app_engine, monkeypatch):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.connectivity_manager import ConnectivityManager

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4C", "s4hana_cloud", "target")
    _load(app, tid, sid, [("T001", "ZZZZ", {"WAERS": "USD"})], minutes_ago=10)  # prior completed load, differs
    lid = _load(app, tid, sid, [], status="running")
    _patch_connector(monkeypatch)
    counts = []
    for _ in range(2):  # a retried task reruns load_config on the same load id
        with Session(app) as s:
            ConnectivityManager(s, tid).load_config(sid, lid)
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            counts.append(c.execute(text("SELECT count(*) FROM config_drift_log WHERE run_id = CAST(:l AS uuid)"),
                                    {"l": lid}).scalar())
    assert counts[0] > 0 and counts[0] == counts[1]


@pg
def test_run_load_config_reads_role_and_upserts_the_load(app_engine, monkeypatch):
    from sqlalchemy import text

    from workers.tasks import run_load_config as task

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4C", "s4hana_cloud", "target")
    lid, job = str(uuid.uuid4()), str(uuid.uuid4())
    _patch_connector(monkeypatch)
    monkeypatch.setattr(task, "get_sync_engine", lambda: app)
    monkeypatch.setattr(task.jobs, "update_job", lambda *a, **k: None)
    monkeypatch.setattr(task.jobs, "finish_job", lambda *a, **k: None)
    for _ in range(2):  # redelivery: the row does not exist the first time, exists the second
        out = task.run_load_config.run(tid, sid, lid, job)
        assert "error" not in out and out["load_id"] == lid
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        rows = c.execute(text("SELECT role, status, system_type FROM config_loads WHERE id = :l"), {"l": lid}).all()
    assert [tuple(r) for r in rows] == [("target", "completed", "s4hana_cloud")]


def test_run_load_config_keeps_redelivery_safety_and_limits():
    from workers.tasks.run_load_config import run_load_config

    # the load is idempotent (items replaced, load row upserted), so late ack stays on (controller ruling L7)
    assert run_load_config.acks_late and run_load_config.reject_on_worker_lost
    assert run_load_config.soft_time_limit == 1500 and run_load_config.time_limit == 1560


@pg
def test_enqueue_config_load_once_unless_forced(app_engine, monkeypatch):
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.services import config_pairing, jobs
    from workers.tasks import run_load_config as task_mod

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4D", "s4hana_onprem", "target")
    sent: list[str] = []
    monkeypatch.setattr(jobs, "start_job", lambda *a, **k: None)
    monkeypatch.setattr(task_mod.run_load_config, "apply_async", lambda args, task_id: sent.append(task_id))

    async def main() -> tuple:
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(aeng, expire_on_commit=False)() as db:
                await db.execute(text(f"SET app.tenant_id = '{tid}'"))
                first = await config_pairing.enqueue_config_load(db, tid, sid)
                second = await config_pairing.enqueue_config_load(db, tid, sid)
                forced = await config_pairing.enqueue_config_load(db, tid, sid, force=True)
                role = (await db.execute(text("SELECT role FROM config_loads WHERE id = :l"),
                                         {"l": first["load_id"]})).scalar()
                return first, second, forced, role
        finally:
            await aeng.dispose()

    first, second, forced, role = asyncio.run(main())
    assert first["status"] == "queued" and first["system_type"] == "s4hana_onprem"
    assert second is None  # a fresh running load exists
    assert forced is not None and sent == [first["load_id"], forced["load_id"]]
    assert role == "target"


@pg
def test_enqueue_config_load_marks_failed_when_queueing_raises(app_engine, monkeypatch):
    import asyncio

    import pytest
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.services import config_pairing, jobs
    from workers.tasks import run_load_config as task_mod

    owner, app = app_engine
    tid = _tenant(owner)
    sid = _system(app, tid, "S4F", "s4hana_onprem", "target")
    monkeypatch.setattr(jobs, "start_job", lambda *a, **k: None)

    def boom(args, task_id):
        raise RuntimeError("broker down")

    monkeypatch.setattr(task_mod.run_load_config, "apply_async", boom)

    async def main() -> tuple:
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(aeng, expire_on_commit=False)() as db:
                await db.execute(text(f"SET app.tenant_id = '{tid}'"))
                with pytest.raises(RuntimeError):
                    await config_pairing.enqueue_config_load(db, tid, sid, force=True)
                status = (await db.execute(text("SELECT status FROM config_loads WHERE system_id = :s"),
                                           {"s": sid})).scalar()
                monkeypatch.setattr(task_mod.run_load_config, "apply_async", lambda args, task_id: None)
                retry = await config_pairing.enqueue_config_load(db, tid, sid)
                return status, retry
        finally:
            await aeng.dispose()

    status, retry = asyncio.run(main())
    assert status == "failed"
    assert retry is not None  # a failed load does not block the next attempt


def _client_run(app, tid: str, router, calls, monkeypatch):
    """Run ``calls(client)`` against a mini app with ``router``, as a steward with tenant ``tid``."""
    import asyncio

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    async def main():
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        maker = async_sessionmaker(aeng, expire_on_commit=False)
        api = FastAPI()
        api.include_router(router)

        async def _db():
            async with maker() as s:
                yield s

        api.dependency_overrides[get_db] = _db
        api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T", [])
        try:
            async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t",
                                   headers={"X-User-Role": "admin"}) as client:
                return await calls(client)
        finally:
            await aeng.dispose()

    return asyncio.run(main())


@pg
def test_update_system_assigns_and_clears_a_target(app_engine, monkeypatch):
    from api.routes.systems import router

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    other = _system(app, tid, "QAS")
    src = _system(app, tid, "PRD")

    async def calls(c):
        ok = await c.put(f"/api/v1/systems/{src}", json={"target_system_id": tgt})
        bad = await c.put(f"/api/v1/systems/{src}", json={"target_system_id": other})
        listed = await c.get("/api/v1/systems")
        cleared = await c.put(f"/api/v1/systems/{src}", json={"target_system_id": ""})
        flipped = await c.put(f"/api/v1/systems/{tgt}", json={"role": "source"})
        return ok, bad, listed, cleared, flipped

    ok, bad, listed, cleared, flipped = _client_run(app, tid, router, calls, monkeypatch)
    assert ok.status_code == 200 and ok.json()["target_system_id"] == tgt
    assert bad.status_code == 400 and bad.json()["detail"] == "The assigned system must have the target role."
    row = next(s for s in listed.json() if s["id"] == src)
    assert row["role"] == "source" and row["target_system_id"] == tgt
    assert cleared.json()["target_system_id"] is None
    assert flipped.json()["role"] == "source"


@pg
def test_flipping_a_target_to_source_unpoints_its_sources(app_engine, monkeypatch):
    from api.routes.systems import router

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)

    async def calls(c):
        await c.put(f"/api/v1/systems/{tgt}", json={"role": "source"})
        return (await c.get("/api/v1/systems")).json()

    rows = _client_run(app, tid, router, calls, monkeypatch)
    assert next(s for s in rows if s["id"] == src)["target_system_id"] is None


@pg
def test_load_value_maps_merges_module_config_and_pair_scope(app_engine):
    from sqlalchemy import text

    from workers.tasks.run_migration import load_value_maps

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    other = _system(app, tid, "QAS")
    ins = ("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, "
           "source_system_id, target_system_id, status) VALUES (gen_random_uuid(), :t, :m, :f, :sv, :tv, "
           "CAST(:s AS uuid), CAST(:g AS uuid), :st)")
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for m, f, sv, tv, s_, g, st in [
            ("accounts_payable", "BUT000.BU_GROUP", "KRED", "BP01", None, None, "confirmed"),
            ("config", "T077K.KTOKK", "LIEF", "GLOBAL", None, None, "confirmed"),
            ("config", "T077K.KTOKK", "LIEF", "KRED", src, tgt, "confirmed"),
            ("config", "T077K.KTOKK", "ZZZZ", "KRED", src, tgt, "proposed"),
            ("config", "T077K.KTOKK", "OTHR", "KRED", other, tgt, "confirmed"),
        ]:
            c.execute(text(ins), {"t": tid, "m": m, "f": f, "sv": sv, "tv": tv, "s": s_, "g": g, "st": st})
    with _session(app, tid) as s:
        scoped = load_value_maps(s, "accounts_payable", src, tgt)
        global_only = load_value_maps(s, "accounts_payable")
    assert scoped == {"BUT000.BU_GROUP": {"KRED": "BP01"}, "T077K.KTOKK": {"LIEF": "KRED"}}
    assert global_only["T077K.KTOKK"] == {"LIEF": "GLOBAL"}


@pg
def test_explicit_module_map_wins_over_config_map(app_engine):
    from sqlalchemy import text

    from workers.tasks.run_migration import load_value_maps

    owner, app = app_engine
    tid = _tenant(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for m, tv in [("config", "FROM_CONFIG"), ("accounts_payable", "EXPLICIT")]:
            c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                           "target_value, status) VALUES (gen_random_uuid(), :t, :m, 'T077K.KTOKK', 'LIEF', :tv, "
                           "'confirmed')"), {"t": tid, "m": m, "tv": tv})
    with _session(app, tid) as s:
        assert load_value_maps(s, "accounts_payable")["T077K.KTOKK"] == {"LIEF": "EXPLICIT"}
        assert load_value_maps(s, "material_master")["T077K.KTOKK"] == {"LIEF": "FROM_CONFIG"}


@pg
def test_load_target_config_reports_its_basis(app_engine):
    from workers.tasks.run_migration import load_target_config

    owner, app = app_engine
    tid = _tenant(owner)
    live = _system(app, tid, "S4D", "s4hana_onprem", "target")
    base = _system(app, tid, "S4C", "s4hana_cloud", "target")
    _load(app, tid, live, [("T077K", "KTOKK=KRED", {"KTOKK": "KRED", "TXT30": ""})])
    _load(app, tid, base, [("T077K", "KTOKK=SUPL", {"KTOKK": "SUPL"})], origin="best_practice")
    with _session(app, tid) as s:
        cfg, basis = load_target_config(s, live)
        assert (cfg["T077K.KTOKK"], basis) == ({"KRED"}, "live") and "T077K.TXT30" not in cfg
        assert load_target_config(s, base)[1] == "baseline"
        cfg, basis = load_target_config(s, None)
        assert basis == "baseline" and "SUPL" in cfg["T077K.KTOKK"]


@pg
def test_source_only_map_survives_target_assignment_and_pair_row_wins(app_engine):
    from sqlalchemy import text

    from workers.tasks.run_migration import load_value_maps

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD")
    ins = ("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, target_value, "
           "source_system_id, target_system_id, status) VALUES (gen_random_uuid(), :t, 'config', 'T077K.KTOKK', "
           ":sv, :tv, CAST(:s AS uuid), CAST(:g AS uuid), 'confirmed')")
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, status) VALUES (gen_random_uuid(), :t, 'config', 'T077K.KTOKK', 'LIEF', "
                       "'GLOBAL', 'confirmed')"), {"t": tid})
        c.execute(text(ins), {"t": tid, "sv": "LIEF", "tv": "SRC_ONLY", "s": src, "g": None})
        c.execute(text(ins), {"t": tid, "sv": "KRED", "tv": "KEPT", "s": src, "g": None})
    with _session(app, tid) as s:
        assert load_value_maps(s, "x", src, tgt)["T077K.KTOKK"] == {"LIEF": "SRC_ONLY", "KRED": "KEPT"}
    with app.begin() as c:  # the source gets a target; a pair row for one key now wins
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text(ins), {"t": tid, "sv": "LIEF", "tv": "PAIR", "s": src, "g": tgt})
    with _session(app, tid) as s:
        assert load_value_maps(s, "x", src, tgt)["T077K.KTOKK"] == {"LIEF": "PAIR", "KRED": "KEPT"}


@pg
def test_value_map_routes_upsert_confirm_and_hide_proposed(app_engine, monkeypatch):
    from sqlalchemy import text

    from api.routes.migration import router

    owner, app = app_engine
    tid = _tenant(owner)
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, status) VALUES (gen_random_uuid(), :t, 'accounts_payable', 'BUT000.BU_GROUP', "
                       "'PROP', 'X', 'proposed'), (gen_random_uuid(), :t, 'accounts_payable', 'BUT000.BU_GROUP', "
                       "'LIEF', 'OLD', 'proposed')"), {"t": tid})

    def body(tv: str) -> dict:
        return {"module": "accounts_payable", "target_field": "but000.bu_group",
                "entries": [{"source_value": "LIEF", "target_value": tv}]}

    async def calls(c):
        await c.put("/api/v1/migration/value-map", json=body("BP01"))
        await c.put("/api/v1/migration/value-map", json=body("BP02"))
        return (await c.get("/api/v1/migration/value-map", params={"module": "accounts_payable"})).json()

    entries = _client_run(app, tid, router, calls, monkeypatch)["entries"]
    assert [(e["source_value"], e["target_value"]) for e in entries] == [("LIEF", "BP02")]  # one row, proposed hidden
    with _session(app, tid) as s:
        n = s.execute(text("SELECT count(*) FROM transfer_value_mappings WHERE source_value = 'LIEF'")).scalar()
    assert n == 1  # the PUT updated the proposed row in place instead of duplicating it


@pg
def test_enqueue_run_defaults_dest_to_the_sources_target(app_engine, monkeypatch):
    import asyncio
    from types import SimpleNamespace

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.routes.migration import _enqueue_run
    from workers.tasks import run_migration as rm

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    monkeypatch.setattr(rm.run_migration, "delay", lambda *a, **k: SimpleNamespace(id="t"))

    async def main() -> list[tuple[str, str | None]]:
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        out = []
        try:
            async with async_sessionmaker(aeng, expire_on_commit=False)() as db:
                await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
                for mode, dest in [("source_to_destination", None), ("source_to_destination", src),
                                   ("source_to_source", None)]:
                    r = await _enqueue_run(db, uuid.UUID(tid), None, mode, src, dest, ["accounts_payable"], None, "s4hana")
                    out.append((mode, (await db.execute(text("SELECT dest_system_id::text FROM migration_runs "
                                                              "WHERE id = :i"), {"i": r["run_id"]})).scalar()))
        finally:
            await aeng.dispose()
        return out

    got = asyncio.run(main())
    assert got == [("source_to_destination", tgt), ("source_to_destination", src), ("source_to_source", None)]


@pg
def test_export_uses_scoped_maps_and_target_dict(app_engine, monkeypatch):
    import io
    import zipfile

    import pandas as pd
    from sqlalchemy import text

    import workers.dataset
    import workers.db
    from api.routes.migration import router
    from api.services.migration.engine import Mapping
    from checks.frames import TableFrames
    from sap.ddic import get_dictionary
    from workers.tasks import run_migration as rm

    ecc, s4 = get_dictionary("ecc6"), get_dictionary("s4hana")
    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    vid, rid = str(uuid.uuid4()), str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, metadata) VALUES (:v, :t, "
                       "CAST('{\"dataset_path\": \"x\"}' AS jsonb))"), {"v": vid, "t": tid})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, modules, "
                       "status, source_version_id, target_release) VALUES (:r, :t, 'source_to_destination', :s, :d, "
                       "ARRAY['accounts_payable'], 'analysed', :v, 's4hana')"), {"r": rid, "t": tid, "s": src, "d": tgt, "v": vid})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, source_system_id, target_system_id, status) VALUES (gen_random_uuid(), :t, "
                       "'config', 'T077K.KTOKK', 'LIEF', 'KRED', :s, :d, 'confirmed')"), {"t": tid, "s": src, "d": tgt})
    frames = TableFrames({"LFA1": pd.DataFrame({"LFA1.LIFNR": ["1", "2"], "LFA1.KTOKK": ["LIEF", "KRED"]})}, ecc)
    monkeypatch.setattr(workers.dataset, "load_dataset", lambda *a, **k: (frames, None, None, None))
    monkeypatch.setattr(workers.db, "get_sync_engine", lambda: app)
    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: s4 if sid == tgt else ecc)
    monkeypatch.setattr(rm, "module_source_tables", lambda m, f: ["LFA1"])
    monkeypatch.setattr(rm, "load_mappings", lambda s, m, t: [Mapping("LFA1.LIFNR", "LFA1.LIFNR"),
                                                              Mapping("LFA1.KTOKK", "LFA1.KTOKK")])

    async def calls(c):
        return await c.get(f"/api/v1/migration/export/{rid}/csv")

    resp = _client_run(app, tid, router, calls, monkeypatch)
    assert resp.status_code == 200, resp.text
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        assert z.read("LFA1.csv").decode().split() == ["SOURCE_RECORD,LIFNR,KTOKK", "LIFNR=1,1,KRED", "LIFNR=2,2,KRED"]


@pg
def test_config_pairing_routes(app_engine, monkeypatch):
    from api.routes.config_pairing import router

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    _load(app, tid, src, [("T077K", "KTOKK=0001", {"KTOKK": "0001"})])
    _load(app, tid, tgt, [("T077K", "KTOKK=1", {"KTOKK": "1"})])

    async def calls(c):
        cmp_ = await c.get(f"/api/v1/config-pairing/compare/{src}", params={"object": "T077K"})
        missing = await c.get("/api/v1/config-pairing/compare/not-a-uuid")
        prop = await c.post(f"/api/v1/config-pairing/propose/{src}")
        ctx = await c.get("/api/v1/config-pairing/finding-context",
                          params={"rule_id": "X-1", "module": "accounts_payable"})
        return cmp_, missing, prop, ctx

    cmp_, missing, prop, ctx = _client_run(app, tid, router, calls, monkeypatch)
    assert cmp_.status_code == 200 and cmp_.json()["rows"][0]["status"] == "key_match"
    assert missing.status_code == 404 and missing.json()["detail"] == "System not found"
    assert prop.json() == {"proposed": 1, "skipped": 0, "target": "S4D"}
    assert ctx.status_code == 200 and ctx.json()["source"] == []


@pg
def test_steward_approve_confirms_a_config_match(app_engine):
    import asyncio
    from types import SimpleNamespace

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.routes.stewardship import _apply_source_action

    owner, app = app_engine
    tid = _tenant(owner)
    mid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, status) VALUES (:i, :t, 'config', 'T077K.KTOKK', 'LIEF', 'KRED', 'proposed')"),
                  {"i": mid, "t": tid})

    async def main() -> str:
        aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
        try:
            async with async_sessionmaker(aeng, expire_on_commit=False)() as db:
                await db.execute(text(f"SET app.tenant_id = '{tid}'"))
                item = SimpleNamespace(item_type="config_value_match", source_id=mid, tenant_id=tid)
                await _apply_source_action(db, item, "approve", None, None)
                await db.commit()
                return (await db.execute(text("SELECT status FROM transfer_value_mappings WHERE id = :i"),
                                         {"i": mid})).scalar()
        finally:
            await aeng.dispose()

    assert asyncio.run(main()) == "confirmed"


@pg
def test_realignment_report_sheets_and_formats(app_engine, monkeypatch):
    from sqlalchemy import text

    from api.routes.migration import router
    from api.services import pdf_reports
    from api.services.config_pairing import realignment_sheets

    owner, app = app_engine
    tid = _tenant(owner)
    tgt = _system(app, tid, "S4D", "s4hana_onprem", "target")
    src = _system(app, tid, "PRD", target=tgt)
    rid = str(uuid.uuid4())
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, modules, "
                       "status) VALUES (:r, :t, 'source_to_destination', :s, :d, ARRAY['accounts_payable'], "
                       "'analysed')"), {"r": rid, "t": tid, "s": src, "d": tgt})
        for key in ("LIFNR=1", "LIFNR=2"):
            c.execute(text("INSERT INTO migration_gap_findings (id, tenant_id, run_id, module, record_key, field, "
                           "gap_type, severity, source_value, provenance) VALUES (gen_random_uuid(), :t, :r, "
                           "'accounts_payable', :k, 'LFA1.KTOKK', 'check_table_value', 'high', 'LIEF', "
                           "'target_live_config')"), {"t": tid, "r": rid, "k": key})
        c.execute(text("INSERT INTO transfer_value_mappings (id, tenant_id, module, target_field, source_value, "
                       "target_value, source_system_id, target_system_id, status) VALUES (gen_random_uuid(), :t, "
                       "'config', 'T077K.KTOKK', 'ZZZZ', 'KRED', :s, :d, 'confirmed')"), {"t": tid, "s": src, "d": tgt})
    with _session(app, tid) as s:
        run, unmapped, applied = realignment_sheets(s, rid)
        assert run is not None and realignment_sheets(s, str(uuid.uuid4()))[0] is None
    assert list(unmapped["records"]) == [2] and list(unmapped["source_value"]) == ["LIEF"]
    assert list(applied["scope"]) == ["pair"] and list(applied["target_value"]) == ["KRED"]

    monkeypatch.setattr(pdf_reports, "render", lambda tpl, ctx: b"%PDF-" + tpl.encode())

    async def calls(c):
        return (await c.get(f"/api/v1/migration/runs/{rid}/realignment.xlsx"),
                await c.get(f"/api/v1/migration/runs/{rid}/realignment.pdf"),
                await c.get(f"/api/v1/migration/runs/{rid}/realignment.csv"))

    xlsx, pdf, bad = _client_run(app, tid, router, calls, monkeypatch)
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"
    assert pdf.content == b"%PDF-config_realignment_report.html"
    assert bad.status_code == 404 and bad.json()["detail"] == "Unknown report format."


def test_realignment_template_renders():
    import pandas as pd

    from api.services.config_pairing import realignment_context
    from api.services.pdf_reports import render

    run = {"id": "r1", "modules": ["accounts_payable"], "status": "analysed", "source_name": "PRD",
           "dest_name": "S4D"}
    unmapped = pd.DataFrame([{"module": "accounts_payable", "field": "LFA1.KTOKK", "gap_type": "check_table_value",
                              "severity": "high", "provenance": "target_live_config", "source_value": "LIEF",
                              "records": 2}])
    applied = pd.DataFrame(columns=["module", "target_field", "source_value", "target_value", "scope"])
    pdf = render("config_realignment_report.html", realignment_context(run, unmapped, applied, "Tenant"))
    assert pdf[:5] == b"%PDF-"
