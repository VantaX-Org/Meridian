"""POST /writeback/reject/{id} against Postgres: reason required, one decision per row, audit row, requester told."""
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
ME = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def pending():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid, fid, req, wid = (str(uuid.uuid4()) for _ in range(5))
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, is_active) "
                       "VALUES (:u, :t, :e, 'Requester', 'admin', true)"), {"u": req, "t": tid, "e": f"{req}@example.com"})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                  {"v": vid, "t": tid})
        c.execute(text("""INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension,
                          affected_count, total_count, pass_rate) VALUES (:f, :v, :t, 'business_partner', 'BP_TAX_001',
                          'high', 'completeness', 3, 10, 70)"""), {"f": fid, "v": vid, "t": tid})
        c.execute(text("""INSERT INTO write_back_log (id, tenant_id, finding_id, version_id, requested_by,
                          records_updated, dry_run, sap_host) VALUES (:w, :t, :f, :v, :r, 3, false, 'sap-host')"""),
                  {"w": wid, "t": tid, "f": fid, "v": vid, "r": req})
    yield engine, tid, wid, req
    with engine.begin() as c:
        for t in ("notifications", "audit_log", "write_back_log", "findings", "analysis_versions", "users"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


async def _post(monkeypatch, tid, wid, body):
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
        "sub": ME, "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(f"/api/v1/writeback/reject/{wid}", json=body, headers=HEADERS)


@pytest.mark.anyio
async def test_reject_records_who_why_audits_notifies_and_leaves_pending(pending, monkeypatch):
    engine, tid, wid, req = pending
    r = await _post(monkeypatch, tid, wid, {"reason": "Wrong plant"})
    assert r.status_code == 200, r.text
    with engine.begin() as c:
        row = c.execute(text("SELECT rejected_by, rejected_at, reject_reason FROM write_back_log WHERE id = :w"),
                        {"w": wid}).one()
        audit = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND action = 'writeback_reject' "
                               "AND entity_id = :w"), {"t": tid, "w": wid}).scalar()
        note = c.execute(text("SELECT count(*) FROM notifications WHERE tenant_id = :t AND user_id = :u"),
                         {"t": tid, "u": req}).scalar()
    assert row[0] == ME and row[1] is not None and row[2] == "Wrong plant"
    assert audit == 1 and note == 1
    again = await _post(monkeypatch, tid, wid, {"reason": "again"})
    assert again.status_code == 409


@pytest.mark.anyio
async def test_reject_needs_a_reason(pending, monkeypatch):
    _, tid, wid, _ = pending
    assert (await _post(monkeypatch, tid, wid, {})).status_code == 422
    assert (await _post(monkeypatch, tid, wid, {"reason": "   "})).status_code == 422
