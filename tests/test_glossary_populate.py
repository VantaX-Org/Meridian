"""Glossary terms are drafted from the rule library, after each analysis and on demand.

Before, only db/seeds/populate_glossary.py wrote glossary_terms, so a live deployment's glossary
stayed empty while its empty state said terms are "drafted from analysed SAP fields".
"""
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app
from api.services.glossary_populate import library, parse_field, populate


def test_library_has_one_term_per_module_field_with_its_rules():
    terms, links = library()
    keys = [(t["domain"], t["sap_table"], t["sap_field"]) for t in terms]
    assert len(keys) == len(set(keys)) and len(terms) > 1000
    ap = [t for t in terms if t["domain"] == "accounts_payable"]
    assert ap and all(t["business_name"] for t in ap)
    assert any(lk["domain"] == "accounts_payable" for lk in links)


def test_parse_field():
    assert parse_field("LFB1.AKONT", "accounts_payable") == ("LFB1.AKONT", "LFB1", "AKONT")
    assert parse_field("userId", "employee_central") == ("userId", "employee_central", "userId")


pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture
def tenant():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
    # glossary_change_log is append-only (a trigger refuses DELETE), so the throwaway tenant stays.
    yield engine, tid


@pg
def test_populate_is_scoped_to_modules_and_idempotent(tenant):
    engine, tid = tenant
    with Session(engine) as s:
        first = populate(s, tid, ["accounts_payable"])
        again = populate(s, tid, ["accounts_payable"])
        s.commit()
        domains = s.execute(text("SELECT DISTINCT domain FROM glossary_terms WHERE tenant_id = :t"), {"t": tid}).scalars().all()
    assert first["created"] > 0 and first["linked"] > 0
    assert again == {"created": 0, "linked": 0}
    assert domains == ["accounts_payable"]


@pg
@pytest.mark.anyio
async def test_populate_endpoint_drafts_terms_for_analysed_objects(tenant, monkeypatch):
    engine, tid = tenant
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        none_yet = await client.post("/api/v1/glossary/populate", headers=headers)
        assert none_yet.status_code == 409
        with engine.begin() as c:
            c.execute(text("""INSERT INTO analysis_versions (id, tenant_id, status, metadata)
                              VALUES (gen_random_uuid(), :t, 'complete', CAST('{"modules": ["accounts_payable"]}' AS jsonb))"""), {"t": tid})
        r = await client.post("/api/v1/glossary/populate", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["objects"] == 1 and r.json()["created"] > 0
