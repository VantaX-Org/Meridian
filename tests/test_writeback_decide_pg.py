"""Write-back request view and four-eyes decisions against Postgres: detail shows before/after, the requester gets
403 on approve and reject, a rejected request leaves the pending list and cannot be approved (409), every decision
is audit-logged."""
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
REQUESTER, OTHER = "00000000-0000-0000-0000-0000000000a1", "00000000-0000-0000-0000-0000000000a2"


@pytest.fixture
def pending():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, vid, fid, wid = (str(uuid.uuid4()) for _ in range(4))
    fixes = [{"record_key": "LIFNR=0000100001", "field": "LFA1.STCD1", "invalid_value": "12 34", "proposed_value": "1234",
              "auto_fix": True}]
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"), {"v": vid, "t": tid})
        c.execute(text("""INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                          total_count, pass_rate, details, record_fixes)
                          VALUES (:f, :v, :t, 'accounts_payable', 'AP_TAX_001', 'high', 'validity', 1, 10, 90,
                                  CAST(:d AS jsonb), CAST(:rf AS jsonb))"""),
                  {"f": fid, "v": vid, "t": tid, "d": json.dumps({"message": "Tax number has a space"}), "rf": json.dumps(fixes)})
        c.execute(text("""INSERT INTO write_back_log (id, tenant_id, finding_id, version_id, requested_by, records_updated,
                          dry_run, sap_host) VALUES (:w, :t, :f, :v, :r, 1, false, 'sap-host')"""),
                  {"w": wid, "t": tid, "f": fid, "v": vid, "r": REQUESTER})
    yield tid, wid
    with engine.begin() as c:
        for t in ("audit_log", "write_back_log", "findings", "analysis_versions"):
            c.execute(text(f"DELETE FROM {t} WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


def _as(monkeypatch, tid: str, user: str) -> None:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": user, "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))


@pytest.mark.anyio
async def test_detail_shows_before_after_and_requester_is_blocked(pending, monkeypatch):
    tid, wid = pending
    _as(monkeypatch, tid, REQUESTER)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        d = (await client.get(f"/api/v1/writeback/requests/{wid}", headers=HEADERS)).json()
        assert d["state"] == "pending" and d["is_requester"] and not d["can_decide"]
        assert d["cannot_decide_reason"] == "own_request"
        assert [(c["field"], c["before"], c["after"]) for c in d["changes"]] == [("LFA1.STCD1", "12 34", "1234")]
        assert (await client.post(f"/api/v1/writeback/reject/{wid}", json={"reason": "no"}, headers=HEADERS)).status_code == 403
        assert (await client.post(f"/api/v1/writeback/approve/{wid}", headers=HEADERS)).status_code == 403


@pytest.mark.anyio
async def test_other_user_rejects_once_and_it_cannot_be_approved(pending, monkeypatch):
    tid, wid = pending
    _as(monkeypatch, tid, OTHER)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(f"/api/v1/writeback/reject/{wid}", json={"reason": "wrong tax number"}, headers=HEADERS)
        assert r.status_code == 200, r.text
        assert (await client.post(f"/api/v1/writeback/reject/{wid}", json={}, headers=HEADERS)).status_code == 409
        assert (await client.post(f"/api/v1/writeback/approve/{wid}", headers=HEADERS)).status_code == 409
        assert (await client.get("/api/v1/writeback/approvals", headers=HEADERS)).json()["approvals"] == []
        d = (await client.get(f"/api/v1/writeback/requests/{wid}", headers=HEADERS)).json()
        assert d["state"] == "rejected" and d["reject_reason"] == "wrong tax number"
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    with engine.begin() as c:
        n = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND action = 'writeback.reject'"), {"t": tid}).scalar()
    engine.dispose()
    assert n == 1
