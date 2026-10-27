"""GET /writeback/approvals against Postgres: the rule message comes from the finding's details.

The check engine writes a finding's message to findings.details->>'message' (workers/tasks/run_checks.py);
rule_context->>'message' is never set, so reading only that left every approval without its rule.
"""
import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


@pytest.fixture
def pending():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid, fid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("""
            INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                  total_count, pass_rate, details)
            VALUES (:f, :v, :t, 'business_partner', 'BP_TAX_001', 'high', 'completeness', 3, 10, 70,
                    CAST(:d AS jsonb))"""),
                  {"f": fid, "v": vid, "t": tid, "d": json.dumps({"message": "Tax number is missing"})})
        c.execute(text("""
            INSERT INTO write_back_log (id, tenant_id, finding_id, version_id, requested_by, records_updated, dry_run,
                                        sap_host)
            VALUES (gen_random_uuid(), :t, :f, :v, 'someone', 3, false, 'sap-host')"""),
                  {"t": tid, "f": fid, "v": vid})
    yield tid
    with engine.begin() as c:
        for t in ("write_back_log", "findings", "analysis_versions"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


@pytest.mark.anyio
async def test_pending_write_back_names_its_rule_from_the_finding_details(pending, monkeypatch):
    tid = pending
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
        "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/writeback/approvals", headers=HEADERS)
    assert r.status_code == 200, r.text
    [a] = r.json()["approvals"]
    assert (a["check_id"], a["rule_message"]) == ("BP_TAX_001", "Tax number is missing")
