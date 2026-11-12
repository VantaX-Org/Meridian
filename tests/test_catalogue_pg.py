"""Data catalogue routes against a real Postgres with RLS enforced (api/routes/catalogue.py).

Two tenants each connect a system, profile MARA, name a business term, own an object and discover a customer table.
Every answer of one tenant must carry its own facts and none of the other's.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_rls_integration.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import uuid

import pandas as pd
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_catalogue_app"


@pytest.fixture(scope="module")
def engines():
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{_ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    app = create_engine(make_url(url).set(username=_ROLE, password="pw"))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _mara_rule() -> tuple[str, str]:
    from api.services.catalogue import rule_index

    ref = rule_index().by_field[("MARA", "MATNR")][0]
    return ref.check_id, ref.module


def _tenant(owner, app, label: str, z_table: str) -> dict:
    """A tenant with one ECC system, a profiled run of material_master, a term, an owner and a customer table."""
    from sqlalchemy import text

    from api.services.field_profiles import profile_and_store
    from checks.frames import TableFrames
    from sap.ddic import get_dictionary

    tid, sid, vid, uid, snap = (str(uuid.uuid4()) for _ in range(5))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, :n)"), {"a": tid, "n": f"Tenant {label}"})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name) VALUES (:u, :t, :e, :n)"),
                  {"u": uid, "t": tid, "e": f"steward-{label}@example.test", "n": f"Steward {label}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, :n, 'ecc')"),
                  {"s": sid, "t": tid, "n": f"ECC {label}"})
        c.execute(text("INSERT INTO system_module_map (tenant_id, system_id, module) VALUES (:t, :s, 'material_master')"),
                  {"t": tid, "s": sid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": sid, "modules": ["material_master"]})})
        c.execute(text("INSERT INTO glossary_terms (tenant_id, domain, sap_table, sap_field, technical_name, "
                       "business_name, data_steward_id) VALUES (:t, 'material_master', 'MARA', 'MATNR', 'MARA.MATNR', "
                       ":b, :u)"), {"t": tid, "b": f"Catalogue term {label}", "u": uid})
        c.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) "
                       "VALUES (:t, 'object', 'material_master', :u)"), {"t": tid, "u": uid})
        c.execute(text("INSERT INTO ddic_snapshots (id, tenant_id, system_id, status, source) "
                       "VALUES (:i, :t, :s, 'complete', 'rfc')"), {"i": snap, "t": tid, "s": sid})
        c.execute(text("INSERT INTO ddic_tables (tenant_id, snapshot_id, table_name, description, customer_table, "
                       "field_count, definition) VALUES (:t, :i, :z, :d, true, 1, CAST(:defn AS jsonb))"),
                  {"t": tid, "i": snap, "z": z_table, "d": f"Customer table of {label}",
                   "defn": json.dumps({"fields": [{"name": "ZZKEY", "key": True, "type": "CHAR", "length": 10,
                                                   "description": f"Customer key of {label}"}]})})
    n = 40
    mara = pd.DataFrame({"MARA.MATNR": [f"{i + 1:018d}" for i in range(n)], "MARA.MTART": ["FERT"] * n})
    frames = TableFrames({"MARA": mara}, get_dictionary("ecc6"), module="material_master")
    assert profile_and_store(app, tid, vid, "material_master", frames, frames.dictionary)["fields"] == 2
    return {"tid": tid, "sid": sid, "vid": vid, "label": label, "z": z_table}


def _client(app_engine, tid: str):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.catalogue import router

    aeng = create_async_engine(app_engine.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "T", [])
    return AsyncClient(transport=ASGITransport(app=api), base_url="http://t", headers={"X-User-Role": "viewer"}), aeng


def test_catalogue_is_tenant_scoped(engines, monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app = engines
    a = _tenant(owner, app, "A", "ZMRD_A")
    b = _tenant(owner, app, "B", "ZMRD_B")
    rule, module = _mara_rule()
    from sqlalchemy import text

    with app.begin() as c:  # tenant A switched the rule off; B keeps the shipped state
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a["tid"]})
        c.execute(text("INSERT INTO rules (tenant_id, name, module, category, enabled, source) "
                       "VALUES (:t, :n, :m, 'ecc', false, 'yaml')"), {"t": a["tid"], "n": f"{rule}: test", "m": module})

    async def scenario():
        ca, ea = _client(app, a["tid"])
        async with ca:
            r = await ca.get("/api/v1/catalogue/tables", params={"q": "mara", "limit": 5})
            assert r.status_code == 200, r.text
            body = r.json()
            assert [s["id"] for s in body["systems"]] == [a["sid"]]
            mara = body["tables"][0]
            assert mara["table"] == "MARA" and mara["systems"] == [a["sid"]]
            assert "material_master" in mara["objects"] and mara["rule_count"] > 0

            names = {t["table"] for t in (await ca.get("/api/v1/catalogue/tables", params={"q": "zmrd"})).json()["tables"]}
            assert names == {"ZMRD_A"}
            only = (await ca.get("/api/v1/catalogue/tables", params={"system": a["sid"], "limit": 500})).json()
            assert only["total"] > 0 and all(a["sid"] in t["systems"] for t in only["tables"])
            assert (await ca.get("/api/v1/catalogue/tables", params={"system": b["sid"]})).status_code == 404

            r = await ca.get("/api/v1/catalogue/tables/MARA")
            assert r.status_code == 200, r.text
            t = r.json()
            assert t["keys"] == ["MATNR"] and t["systems"][0]["id"] == a["sid"]
            assert [o["owner_name"] for o in t["owners"]] == ["Steward A"]
            fields = {f["field"]: f for f in t["fields"]}
            matnr = fields["MATNR"]
            assert matnr["description"] and matnr["type"] == "CHAR"
            assert [x["business_name"] for x in matnr["terms"]] == ["Catalogue term A"]
            assert matnr["terms"][0]["steward_name"] == "Steward A"
            assert matnr["profile"]["version_id"] == a["vid"] and matnr["profile"]["stats"]["rows"] == 40
            assert matnr["profile"]["system_id"] == a["sid"]
            hit = next(x for x in matnr["rules"] if (x["check_id"], x["module"]) == (rule, module))
            assert hit["enabled"] is False
            assert matnr["lineage_node"] == "field:MARA.MATNR"
            assert fields["MTART"]["profile"] is not None and fields["ERSDA"]["profile"] is None

            z = (await ca.get("/api/v1/catalogue/tables/ZMRD_A")).json()
            assert z["source"] == "live" and z["system"] == a["sid"] and z["fields"][0]["field"] == "ZZKEY"
            assert (await ca.get("/api/v1/catalogue/tables/ZMRD_B")).status_code == 404
            assert (await ca.get("/api/v1/catalogue/tables/NOPE_TABLE")).status_code == 404

            hits = (await ca.get("/api/v1/catalogue/fields", params={"q": "customer key"})).json()["fields"]
            assert [(h["table"], h["field"]) for h in hits] == [("ZMRD_A", "ZZKEY")]
            by_term = (await ca.get("/api/v1/catalogue/fields", params={"q": "catalogue term a"})).json()["fields"]
            assert [(h["table"], h["field"]) for h in by_term] == [("MARA", "MATNR")]
            assert (await ca.get("/api/v1/catalogue/fields", params={"q": "catalogue term b"})).json()["fields"] == []
            exact = (await ca.get("/api/v1/catalogue/fields", params={"q": "mara.matnr"})).json()["fields"]
            assert (exact[0]["table"], exact[0]["field"]) == ("MARA", "MATNR")
        await ea.dispose()

        cb, eb = _client(app, b["tid"])
        async with cb:
            t = (await cb.get("/api/v1/catalogue/tables/MARA")).json()
            matnr = next(f for f in t["fields"] if f["field"] == "MATNR")
            assert [x["business_name"] for x in matnr["terms"]] == ["Catalogue term B"]
            assert matnr["profile"]["version_id"] == b["vid"]
            assert next(x for x in matnr["rules"] if (x["check_id"], x["module"]) == (rule, module))["enabled"] is True
            assert [s["id"] for s in t["systems"]] == [b["sid"]]
            names = {x["table"] for x in (await cb.get("/api/v1/catalogue/tables", params={"q": "zmrd"})).json()["tables"]}
            assert names == {"ZMRD_B"}
        await eb.dispose()

    asyncio.run(scenario())


def test_catalogue_validates_its_input(engines, monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    _owner, app = engines

    async def scenario():
        c, e = _client(app, str(uuid.uuid4()))
        async with c:
            assert (await c.get("/api/v1/catalogue/fields", params={"q": "m"})).status_code == 422
            assert (await c.get("/api/v1/catalogue/tables", params={"limit": 0})).status_code == 422
            assert (await c.get("/api/v1/catalogue/tables/MA%3BRA")).status_code == 422
            assert (await c.get("/api/v1/catalogue/tables", params={"system": "not-a-uuid"})).status_code == 422
            empty = (await c.get("/api/v1/catalogue/tables", params={"q": "mara"})).json()
            assert empty["systems"] == [] and empty["tables"][0]["systems"] == []
        await e.dispose()

    asyncio.run(scenario())
