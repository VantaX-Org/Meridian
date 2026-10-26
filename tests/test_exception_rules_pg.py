"""Exception rules + billing against a real Postgres (RLS enforced, non-superuser role).

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
Covers: enabled custom rules raise one exception per scan (a re-scan adds none), disabled
rules never fire, rule update null semantics, and the billing permission gate.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

ROLE = "meridian_exc_app"


@pytest.fixture(scope="module")
def engines():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {ROLE}"))
        c.execute(text(f"CREATE ROLE {ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, "", u.query, "")))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {ROLE}"))
    owner.dispose()


def _rule(c, tid, name, active, assignee=None) -> str:
    from sqlalchemy import text

    return str(c.execute(text(
        "INSERT INTO exception_rules (id, tenant_id, name, description, rule_type, object_type, condition, "
        "severity, auto_assign_to, is_active) VALUES (gen_random_uuid(), :t, :n, 'd', 'field_condition', "
        "'vendor', 'check_id == CHK-X', 'high', :a, :act) RETURNING id"),
        {"t": tid, "n": name, "a": assignee, "act": active}).scalar())


def _custom_exceptions(app, tid):
    from sqlalchemy import text

    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return c.execute(text("SELECT source_reference, assigned_to, billing_tier FROM exceptions "
                              "WHERE type = 'custom_business'")).fetchall()


def test_enabled_rule_fires_once_disabled_never(engines, monkeypatch):
    from sqlalchemy import text

    import workers.tasks.run_exception_scan as scan

    owner, app = engines
    tid, other, vid, assignee = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'E1'), (:b, 'E2')"), {"a": tid, "b": other})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                       "affected_count, total_count) VALUES (:v, :t, 'accounts_payable', 'CHK-X', 'high', "
                       "'completeness', 2, 3)"), {"v": vid, "t": tid})
        enabled = _rule(c, tid, "enabled", True, assignee)
        _rule(c, tid, "disabled", False)
        _rule(c, other, "other tenant", True)  # same condition, other tenant: must not fire here

    monkeypatch.setattr(scan, "get_sync_engine", lambda: app)
    first = scan.run_exception_scan(vid, tid)
    assert "error" not in first and first["exceptions"] == 1
    rows = _custom_exceptions(app, tid)
    assert [(r[0], str(r[1]), r[2]) for r in rows] == [(enabled, assignee, 4)]

    again = scan.run_exception_scan(vid, tid)
    assert "error" not in again and again["exceptions"] == 0
    assert len(_custom_exceptions(app, tid)) == 1
    assert _custom_exceptions(app, other) == []


def test_monitor_rescan_keeps_one_exception_and_resolution(engines, monkeypatch):
    """Monitor exceptions are upserted on (tenant, type, monitor): a re-scan adds none and
    keeps a steward's resolution; a later version that still fails re-opens the same row."""
    from sqlalchemy import text

    import workers.tasks.run_exception_scan as scan

    owner, app = engines
    tid, vid, vid2 = (str(uuid.uuid4()) for _ in range(3))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'E4')"), {"t": tid})
        for v, at in ((vid, "now() - interval '1 day'"), (vid2, "now() + interval '1 day'")):
            c.execute(text(f"INSERT INTO analysis_versions (id, tenant_id, status, run_at) "
                           f"VALUES (:v, :t, 'complete', {at})"), {"v": v, "t": tid})
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count, details) VALUES (:v, :t, 'idoc', 'CHK-IDOC', 'high', "
                           "'validity', 1, 2, CAST(:d AS jsonb))"),
                      {"v": v, "t": tid, "d": '{"field_checked": "EDIDC.STATUS"}'})

    def monitor_rows():
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            return c.execute(text("SELECT id, status FROM exceptions WHERE type = 'sap_transaction'")).fetchall()

    def run(v):
        r = scan.run_exception_scan(v, tid)
        assert "error" not in r, r
        return r["exceptions"]

    monkeypatch.setattr(scan, "get_sync_engine", lambda: app)
    assert run(vid) == 1
    (first,) = monitor_rows()
    assert run(vid) == 0
    assert monitor_rows() == [first]

    with owner.begin() as c:
        c.execute(text("UPDATE exceptions SET status = 'resolved', resolved_at = now() WHERE id = :i"),
                  {"i": first.id})
    assert run(vid) == 0  # same data, scanned before the fix
    assert monitor_rows() == [(first.id, "resolved")]
    assert run(vid2) == 1  # fails again after the resolution
    assert monitor_rows() == [(first.id, "open")]


def test_rule_update_and_billing_routes(engines, monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.exceptions import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, assignee = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'E3')"), {"a": tid})
        rid = _rule(c, tid, "r", True, assignee)

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "E3", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            steward = {"X-User-Role": "steward"}
            url = f"/api/v1/exceptions/rules/{rid}"

            # omitted fields are kept
            r = (await c.put(url, headers=steward, json={"description": "new"})).json()
            assert (r["description"], str(r["auto_assign_to"]), r["name"]) == ("new", assignee, "r")
            # explicit null clears the assignee, leaves the rest
            r = (await c.put(url, headers=steward, json={"auto_assign_to": None})).json()
            assert r["auto_assign_to"] is None and r["description"] == "new" and r["is_active"] is True
            # null is invalid for non-nullable fields
            assert (await c.put(url, headers=steward, json={"name": None})).status_code == 422
            assert (await c.put(url, headers=steward, json={})).status_code == 400

            billing = "/api/v1/exceptions/billing?period=2026-09"
            assert (await c.get(billing, headers={"X-User-Role": "analyst"})).status_code == 403
            r = await c.get(billing, headers={"X-User-Role": "admin"})
            assert r.status_code == 200 and r.json()["period"] == "2026-09"
            assert r.json()["currency"] == "ZAR"  # the price list's currency, on computed and stored reads
            assert (await c.get(billing, headers={"X-User-Role": "admin"})).json()["currency"] == "ZAR"
        await aeng.dispose()

    asyncio.run(scenario())

    with owner.begin() as c:
        assert c.execute(text("SELECT count(*) FROM exception_billing WHERE tenant_id = :t AND period = '2026-09'"),
                         {"t": tid}).scalar() == 1


def test_monitor_signal_names_its_system_and_objects(engines, monkeypatch):
    """The SAP monitor's Re-extract needs the system the run read and the objects whose findings raised it."""
    import json

    from sqlalchemy import text

    import workers.tasks.run_exception_scan as scan

    owner, app = engines
    tid, vid, sid = (str(uuid.uuid4()) for _ in range(3))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'E5')"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": sid})})
        c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                       "affected_count, total_count, details) VALUES (:v, :t, 'idoc', 'CHK-IDOC', 'high', "
                       "'validity', 1, 2, CAST(:d AS jsonb))"),
                  {"v": vid, "t": tid, "d": '{"field_checked": "EDIDC.STATUS"}'})
    monkeypatch.setattr(scan, "get_sync_engine", lambda: app)
    assert scan.run_exception_scan(vid, tid)["exceptions"] == 1
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        affected = c.execute(text("SELECT affected_records FROM exceptions WHERE type = 'sap_transaction'")).scalar()
    assert affected["system_id"] == sid and affected["version_id"] == vid
    assert affected["modules"] == ["idoc"] and affected["matched_fields"] == ["EDIDC.STATUS"]


def test_system_manager_claims_and_resolves_only_sap_raised_exceptions(engines, monkeypatch):
    """sap_basis has manage_systems but neither assign nor approve: it may claim and resolve an exception raised
    from an SAP system (source_system set), never another; a viewer may do neither."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.exceptions import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, sap_exc, own_exc = (str(uuid.uuid4()) for _ in range(3))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'E6')"), {"a": tid})
        for eid, src in ((sap_exc, "SAP MM"), (own_exc, None)):
            c.execute(text("INSERT INTO exceptions (id, tenant_id, type, category, severity, status, title, "
                           "description, source_system, escalation_tier, created_at) VALUES (:i, :t, "
                           "'sap_transaction', 'operational', 'high', 'open', 'x', 'd', :s, 1, now())"),
                      {"i": eid, "t": tid, "s": src})

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "E6", [])
    claim = {"user_id": str(uuid.uuid4()), "user_name": "Basis"}
    resolve = {"resolution_type": "steward", "resolution_notes": "Job restarted", "root_cause_category": "system"}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            basis, viewer, steward = ({"X-User-Role": r} for r in ("sap_basis", "viewer", "steward"))
            for h, code in ((viewer, 403), (basis, 200)):
                assert (await c.put(f"/api/v1/exceptions/{sap_exc}/assign", headers=h, json=claim)).status_code == code
            assert (await c.put(f"/api/v1/exceptions/{own_exc}/assign", headers=basis, json=claim)).status_code == 403
            assert (await c.put(f"/api/v1/exceptions/{own_exc}/resolve", headers=basis, json=resolve)).status_code == 403
            assert (await c.put(f"/api/v1/exceptions/{sap_exc}/resolve", headers=viewer, json=resolve)).status_code == 403
            r = await c.put(f"/api/v1/exceptions/{sap_exc}/resolve", headers=basis, json=resolve)
            assert r.status_code == 200 and r.json()["status"] == "resolved"
            missing = str(uuid.uuid4())
            assert (await c.put(f"/api/v1/exceptions/{missing}/resolve", headers=basis, json=resolve)).status_code == 404
            # assign/approve holders keep acting on every exception
            assert (await c.put(f"/api/v1/exceptions/{own_exc}/assign", headers=steward, json=claim)).status_code == 200
            assert (await c.put(f"/api/v1/exceptions/{own_exc}/resolve", headers=steward, json=resolve)).status_code == 200
        await aeng.dispose()

    asyncio.run(scenario())


def test_only_system_managers_raise_sap_source_exceptions_and_links_stay_in_the_tenant(engines, monkeypatch):
    """POST /exceptions: an analyst cannot mint an SAP-source exception (source_system, the SAP monitor type or
    a foreign source_reference) that sap_basis could then resolve; linked_finding_id must be this tenant's
    finding; GET never reads another tenant's finding or cleaning item; a client row that only claims a
    source_system is not an SAP monitor row for the system-manager guard."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.exceptions import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = engines
    tid, other, fid, foreign_fid, vid, vid2, forged, foreign_clean = (str(uuid.uuid4()) for _ in range(8))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'E7'), (:b, 'E7b')"), {"a": tid, "b": other})
        for f, v, t in ((fid, vid, tid), (foreign_fid, vid2, other)):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                      {"v": v, "t": t})
            c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension) "
                           "VALUES (:f, :v, :t, 'material_master', 'mm_missing_desc', 'high', 'completeness')"),
                      {"f": f, "v": v, "t": t})
        c.execute(text("INSERT INTO cleaning_queue (id, tenant_id, object_type, record_key, status) "
                       "VALUES (:i, :t, 'material_master', 'M1', 'pending')"), {"i": foreign_clean, "t": other})
        # a row a client created with a source_system before this fix: not an SAP monitor row
        c.execute(text("INSERT INTO exceptions (id, tenant_id, type, category, severity, status, title, "
                       "description, source_system, escalation_tier, created_at, linked_finding_id, linked_cleaning_id) "
                       "VALUES (:i, :t, 'dq_rule', 'x', 'high', 'open', 'x', 'd', 'SAP MM', 1, now(), :f, :c)"),
                  {"i": forged, "t": tid, "f": foreign_fid, "c": foreign_clean})

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "E7", [])
    base = {"type": "dq_rule", "category": "material_master", "severity": "high", "title": "t", "description": "d"}
    resolve = {"resolution_type": "steward", "resolution_notes": "n", "root_cause_category": "system"}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            analyst, basis = {"X-User-Role": "analyst"}, {"X-User-Role": "sap_basis"}

            async def post(h, **kw):
                return await c.post("/api/v1/exceptions", headers=h, json={**base, **kw})

            for kw in ({"source_system": "SAP MM"}, {"type": "sap_transaction"},
                       {"source_reference": "failed_confirmation"},
                       {"linked_finding_id": fid, "source_reference": f"{vid}:other_check"}):
                r = await post(analyst, **kw)
                assert r.status_code == 422, (kw, r.text)
            # the Raise exception button: the linked finding and its own reference
            r = await post(analyst, linked_finding_id=fid, source_reference=f"{vid}:mm_missing_desc")
            assert r.status_code == 201, r.text
            for bad in (foreign_fid, "not-a-uuid"):
                assert (await post(analyst, linked_finding_id=bad)).status_code == 422
            # a system manager may raise one
            r = await post(basis, type="sap_transaction", source_system="SAP MM", source_reference="manual-1")
            assert r.status_code == 201, r.text
            minted = r.json()["id"]
            assert (await c.put(f"/api/v1/exceptions/{minted}/resolve", headers=basis, json=resolve)).status_code == 200
            # source_system alone on a non-monitor row does not open it to system managers
            assert (await c.put(f"/api/v1/exceptions/{forged}/resolve", headers=basis, json=resolve)).status_code == 403
            got = (await c.get(f"/api/v1/exceptions/{forged}", headers=analyst)).json()
            assert got["linked_finding"] is None and got["linked_cleaning"] is None
        await aeng.dispose()

    asyncio.run(scenario())
