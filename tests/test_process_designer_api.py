"""Process designer: reference document, validator (pure) and the model API against a real Postgres.

The API scenario runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import uuid
from urllib.parse import urlparse, urlunparse

import pytest

from api.models.process_model import ProcessModelDocument
from api.services.process_model_validator import validate_document
from sap.process_definitions import reference_document


def _counts(doc: ProcessModelDocument) -> dict:
    l2 = [b for a in doc.l1 for b in a.l2]
    l3 = [c for b in l2 for c in b.l3]
    return {"l1": len(doc.l1), "l2": len(l2), "l3": len(l3), "l4": len(doc.all_l4())}


def test_reference_counts_and_diagrams():
    doc = reference_document()
    assert _counts(doc) == {"l1": 2, "l2": 8, "l3": 8, "l4": 8}
    gateways = 0
    for l4 in doc.all_l4():
        types = [n.type for n in l4.diagram.nodes]
        assert "startEvent" in types and "endEvent" in types
        tasks = [n.activity_id for n in l4.diagram.nodes if n.type == "task"]
        assert sorted(tasks) == sorted(a.id for a in l4.activities)
        gateways += types.count("exclusiveGateway")
    assert gateways == 2


def test_reference_validates_without_errors():
    assert validate_document(reference_document()).errors == []


def test_unknown_field_is_an_error_with_path():
    doc = reference_document()
    doc.l1[0].l2[0].l3[0].l4[0].activities[0].fields[0].field = "MARA.NOPE"
    errors = validate_document(doc).errors
    assert [e.path for e in errors] == ["l1[0].l2[0].l3[0].l4[0].activities[0].fields[0].field"]


def test_unknown_check_id_is_only_a_warning():
    doc = reference_document()
    doc.l1[0].l2[0].l3[0].l4[0].activities[0].fields[0].check_id = "NOPE999"
    r = validate_document(doc)
    assert r.errors == [] and any("NOPE999" in w.message for w in r.warnings)


def test_flow_to_missing_node_names_the_flow():
    doc = reference_document()
    flow = doc.all_l4()[0].diagram.flows[0]
    flow.target = "NOWHERE"
    errors = validate_document(doc).errors
    assert any(flow.id in e.message and "NOWHERE" in e.message for e in errors)


def test_structure_rules():
    doc = reference_document()
    l4 = doc.all_l4()[0]
    task = next(n for n in l4.diagram.nodes if n.type == "task")
    l4.diagram.nodes.append(task.model_copy(update={"id": "EXTRA-T"}))  # second task for one activity
    l4.diagram.nodes.append(task.model_copy(update={"id": "ORPHAN", "activity_id": "OTHER"}))
    messages = " ".join(e.message for e in validate_document(doc).errors)
    assert "expected exactly 1" in messages and "not an activity of" in messages and "not reachable" in messages
    doc = reference_document()
    doc.all_l4()[0].diagram.nodes[0].id = doc.all_l4()[1].diagram.nodes[0].id
    assert any("more than once" in e.message for e in validate_document(doc).errors)


pytestmark_pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROLE = "meridian_designer_app"


@pytest.fixture(scope="module")
def app_engine():
    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
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


@pytestmark_pg
def test_model_api(app_engine, monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.process_designer import router

    owner, app_eng = app_engine
    tid, stranger = str(uuid.uuid4()), str(uuid.uuid4())
    vid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'D1'), (:b, 'D2')"), {"a": tid, "b": stranger})
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO process_variants (tenant_id, version_id, process_id, sap_table, sap_field, "
                       "value, doc_count, classification) VALUES (:t, :v, 'OTC', 'VBAK', 'AUART', 'OR', 3, "
                       "'implemented')"), {"t": tid, "v": vid})

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    who = {"tenant": tid}
    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(who["tenant"]), "D", [])
    base = "/api/v1/process-designer"

    async def scenario():
        h = {"X-User-Role": "analyst"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            ref = (await c.get(f"{base}/reference", headers=h)).json()
            assert len(ref["l1"]) == 2

            r = await c.post(f"{base}/models", headers=h, json={"name": "Mine", "from": "reference"})
            assert r.status_code == 201 and r.json()["version_no"] == 1
            mid = r.json()["model"]["id"]
            assert (await c.post(f"{base}/models", headers=h, json={"name": "Mine", "from": "reference"})).status_code == 409

            doc = (await c.get(f"{base}/models/{mid}", headers=h)).json()["document"]
            doc["l1"][0]["l2"][0]["l3"][0]["l4"][0]["activities"][0]["name"] = "Renamed"
            r = await c.put(f"{base}/models/{mid}", headers=h, json={"document": doc, "note": "rename", "base_version": 1})
            assert r.status_code == 200 and r.json()["version_no"] == 2
            stale = await c.put(f"{base}/models/{mid}", headers=h, json={"document": doc, "base_version": 1})
            assert stale.status_code == 409

            bad = (await c.get(f"{base}/models/{mid}", headers=h)).json()["document"]
            bad["l1"][0]["l2"][0]["l3"][0]["l4"][0]["activities"][0]["fields"][0]["field"] = "MARA.NOPE"
            r = await c.put(f"{base}/models/{mid}", headers=h, json={"document": bad, "base_version": 2})
            assert r.status_code == 422
            assert r.json()["errors"][0]["path"].endswith("activities[0].fields[0].field")

            bad = (await c.get(f"{base}/models/{mid}", headers=h)).json()["document"]
            l4 = bad["l1"][0]["l2"][0]["l3"][0]["l4"][0]
            fid = l4["diagram"]["flows"][0]["id"]
            l4["diagram"]["flows"][0]["target"] = "GONE"
            r = await c.put(f"{base}/models/{mid}", headers=h, json={"document": bad, "base_version": 2})
            assert r.status_code == 422 and any(fid in e["message"] for e in r.json()["errors"])

            versions = (await c.get(f"{base}/models/{mid}/versions", headers=h)).json()
            assert [v["version_no"] for v in versions] == [2, 1]
            assert (await c.get(f"{base}/models/{mid}", headers=h, params={"version": 1})).json()["version_no"] == 1

            # discovery results, overlay, adopt
            vs = (await c.get(f"{base}/variants/{vid}", headers=h)).json()
            assert [v["value"] for v in vs] == ["OR"]
            ov = (await c.get(f"{base}/models/{mid}/overlay/{vid}", headers=h)).json()
            assert set(ov["l4"]) == {l["id"] for l in
                                     [x for a in doc["l1"] for b in a["l2"] for c3 in b["l3"] for x in c3["l4"]]}
            r = await c.post(f"{base}/models/{mid}/adopt-variant", headers=h,
                             json={"variant_id": vs[0]["id"], "l4_id": "OTC-SO-VA01"})
            assert r.status_code == 200 and r.json()["version_no"] == 3
            adopted = (await c.get(f"{base}/models/{mid}", headers=h)).json()["document"]
            l4s = {x["id"]: x for a in adopted["l1"] for b in a["l2"] for c3 in b["l3"] for x in c3["l4"]}
            assert l4s["OTC-SO-VA01"]["variants"][0]["value"] == "OR"

            # tenant isolation
            who["tenant"] = stranger
            assert (await c.get(f"{base}/models/{mid}", headers=h)).status_code == 404
            assert (await c.get(f"{base}/models", headers=h)).json() == []
            who["tenant"] = tid

            r = await c.patch(f"{base}/models/{mid}", headers=h, json={"status": "published", "name": "Mine2"})
            assert r.json()["status"] == "published" and r.json()["name"] == "Mine2"
            assert (await c.delete(f"{base}/models/{mid}", headers=h)).status_code == 204
            assert (await c.get(f"{base}/models/{mid}", headers=h)).status_code == 404

    asyncio.run(scenario())
    asyncio.run(aeng.dispose())
