"""GET /migration/waves/{id}/cockpit and POST /signoff on Postgres.

Seed: wave 'Wave 1' (PRD -> S4D, material_master + accounts_payable), two analysed runs.
  run 1 (3 days ago) score 80
  run 2 (1 hour ago) score 97: material_master go 100, accounts_payable conditional 94 with gaps
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
H = {"Authorization": "Bearer test-token"}


@pytest.fixture
def seeded():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, prd, s4d, wid, vid, r1, r2 = (str(uuid.uuid4()) for _ in range(7))
    summary = {
        "material_master": {"records": 50, "blocked_records": 0, "score": 100.0, "verdict": "go", "gaps": {}},
        "accounts_payable": {"records": 50, "blocked_records": 3, "score": 94.0, "verdict": "conditional",
                             "gaps": {"value_unmapped": 3, "unmapped_field": 1}},
    }
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES "
                       "('00000000-0000-0000-0000-000000000002', :t, 'dev@example.com', 'Dev', 'admin')"),
                  {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES "
                       "(:p, :t, 'PRD', 'ecc6'), (:s, :t, 'S4D', 's4hana')"), {"p": prd, "s": s4d, "t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                       "(:v, :t, 'complete', now(), CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                  {"v": vid, "t": tid, "m": json.dumps({"system_id": prd}),
                   "q": json.dumps({"material_master": {"composite_score": 91.0},
                                    "accounts_payable": {"composite_score": 72.0}})})
        c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, source_system_id, target_system_id, modules) "
                       "VALUES (:w, :t, 'Wave 1', :p, :s, '{material_master,accounts_payable}')"),
                  {"w": wid, "t": tid, "p": prd, "s": s4d})
        for rid, score, ago, gs in ((r1, 80.0, "3 days", {}), (r2, 97.0, "1 hour", summary)):
            c.execute(text("INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, "
                           "modules, status, readiness_verdict, readiness_score, records_total, records_blocked, "
                           "gap_summary, source_version_id, wave_id, completed_at) VALUES (:r, :t, "
                           "'source_to_destination', :p, :s, '{material_master,accounts_payable}', 'analysed', "
                           "'conditional', :sc, 100, 3, CAST(:gs AS jsonb), :v, :w, now() - CAST(:ago AS interval))"),
                      {"r": rid, "t": tid, "p": prd, "s": s4d, "sc": score, "gs": json.dumps(gs), "v": vid,
                       "w": wid, "ago": ago})
        for key in ("LIFNR=1", "LIFNR=2", "LIFNR=3"):
            c.execute(text("INSERT INTO migration_gap_findings (tenant_id, run_id, module, record_key, field, "
                           "gap_type, severity) VALUES (:t, :r, 'accounts_payable', :k, 'BUT000.BU_GROUP', "
                           "'value_unmapped', 'critical')"), {"t": tid, "r": r2, "k": key})
        c.execute(text("INSERT INTO migration_gap_findings (tenant_id, run_id, module, field, gap_type, severity) "
                       "VALUES (:t, :r, 'accounts_payable', 'LFA1.ZZOLD', 'unmapped_field', 'medium')"),
                  {"t": tid, "r": r2})
    yield {"tid": tid, "wid": wid, "vid": vid, "r2": r2, "engine": engine}
    with engine.begin() as c:
        c.execute(text("DELETE FROM audit_log WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM migration_runs WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM migration_waves WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000002'"))
        c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    engine.dispose()


async def _client(monkeypatch, tenant_id: str) -> AsyncClient:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002",
                                               "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))
    await api_deps.engine.dispose()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_cockpit(seeded, monkeypatch):
    async with await _client(monkeypatch, seeded["tid"]) as c:
        r = await c.get(f"/api/v1/migration/waves/{seeded['wid']}/cockpit", headers={**H, "X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["run_id"] == seeded["r2"] and b["source_version_id"] == seeded["vid"]
    assert b["dest_system_type"] == "s4hana"
    assert b["verdict"] == "at_risk" and b["score"] == 97.0
    assert [(o["module"], o["label"], o["verdict"], o["blocker_count"], o["dqs"]) for o in b["objects"]] == [
        ("material_master", "Material", "go", 0, 91.0),
        ("accounts_payable", "BP supplier", "at_risk", 3, 72.0),
    ]
    assert [p["score"] for p in b["trend"]] == [80.0, 97.0]
    assert b["blockers"] == [{"module": "accounts_payable", "label": "BP supplier", "gap_type": "value_unmapped",
                              "field": "BUT000.BU_GROUP", "severity": "critical", "records": 3, "gaps": 3}]


@pytest.mark.anyio
async def test_signoff_needs_go_and_approve_and_is_audited(seeded, monkeypatch):
    url = f"/api/v1/migration/waves/{seeded['wid']}/signoff"
    async with await _client(monkeypatch, seeded["tid"]) as c:
        assert (await c.post(url, headers={**H, "X-User-Role": "analyst"})).status_code == 403
        assert (await c.post(url, headers={**H, "X-User-Role": "approver"})).status_code == 409  # at_risk
        with seeded["engine"].begin() as conn:
            conn.execute(text("UPDATE migration_waves SET min_readiness = 90 WHERE id = :w"), {"w": seeded["wid"]})
            conn.execute(text("UPDATE migration_runs SET gap_summary = jsonb_set(gap_summary, "
                              "'{accounts_payable,verdict}', '\"go\"') WHERE id = :r"), {"r": seeded["r2"]})
        r = await c.post(url, headers={**H, "X-User-Role": "approver"})
        assert r.status_code == 200, r.text
        assert r.json()["signed_off_at"] is not None
        assert (await c.post(url, headers={**H, "X-User-Role": "approver"})).status_code == 409  # already signed
    with seeded["engine"].begin() as conn:
        row = conn.execute(text("SELECT before_json, after_json FROM audit_log WHERE tenant_id = :t "
                                "AND action = 'signoff' AND entity_type = 'migration_wave'"),
                           {"t": seeded["tid"]}).one()
    assert row.before_json["signed_off_at"] is None
    assert row.after_json["signed_off_at"] is not None and row.after_json["verdict"] == "go"
