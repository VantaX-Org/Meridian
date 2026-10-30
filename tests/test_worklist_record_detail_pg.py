"""The record panel's detail (GET /api/v1/work/records/{module}/{key}) against a real Postgres.

Two kept runs of one system, material master, 10 records each:
  previous run  MATNR=2 fails MM001 and MM003
  this run      MM001 critical  MARA.MEINS  MATNR=1, MATNR=2   cost at risk 500, a tenant rules row
                MM002 medium    MARA.MTART  MATNR=2           the rule lists its valid values (rule_context)
MATNR=2 has a golden record (sap_object_key 2) and two open duplicate candidates (one more already merged).
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000b7"
ROLE = "meridian_detail_app"


@pytest.fixture(scope="module")
def engines():
    from urllib.parse import urlparse, urlunparse

    url = os.environ["MERIDIAN_TEST_DB_URL"]
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


def _run(c, tid: str, sid: str, vid: str, age: str, findings: list[tuple], records: list[tuple]) -> None:
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) "
                   "VALUES (:v, :t, 'complete', now() - CAST(:age AS interval), CAST(:m AS jsonb), "
                   "CAST('{\"material_master\": {}}' AS jsonb))"),
              {"v": vid, "t": tid, "age": age, "m": json.dumps({"system_id": sid, "modules": ["material_master"]})})
    for check, sev, field, n, cost, ctx in findings:
        c.execute(text("""
            INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                  total_count, pass_rate, details, cost_at_risk, rule_context)
            VALUES (:v, :t, 'material_master', :c, :s, 'completeness', :n, 10, :pr, CAST(:d AS jsonb), :cost,
                    CAST(:ctx AS jsonb))"""),
                  {"v": vid, "t": tid, "c": check, "s": sev, "n": n, "pr": (10 - n) * 10.0, "cost": cost,
                   "d": json.dumps({"message": f"{field} is wrong", "field_checked": field}), "ctx": json.dumps(ctx)})
    for check, key, values in records:
        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                       "field_values) VALUES (:t, :v, :c, 'material_master', 'MARA', :k, CAST(:fv AS jsonb))"),
                  {"t": tid, "v": vid, "c": check, "k": key, "fv": json.dumps(values)})


@pytest.fixture
def run(engines):
    owner, app = engines
    tid, sid, prev, vid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'Steward', 'admin') "
                       "ON CONFLICT (id) DO NOTHING"), {"u": USER, "t": tid, "e": f"{tid[:8]}@example.com"})
        _run(c, tid, sid, prev, "1 day",
             [("MM001", "critical", "MARA.MEINS", 1, None, None), ("MM003", "high", "MARA.MATKL", 1, None, None)],
             [("MM001", "MATNR=2", {"MARA.MEINS": ""}), ("MM003", "MATNR=2", {"MARA.MATKL": ""})])
        _run(c, tid, sid, vid, "0 seconds",
             [("MM001", "critical", "MARA.MEINS", 2, 500, {"rule_authority": "sap_hard_constraint"}),
              ("MM002", "medium", "MARA.MTART", 1, None,
               {"valid_values_with_labels": {"FERT": "Finished product", "ROH": "Raw material"}})],
             [("MM001", "MATNR=1", {"MARA.MEINS": None}), ("MM001", "MATNR=2", {"MARA.MEINS": ""}),
              ("MM002", "MATNR=2", {"MARA.MTART": "XX"})])
        for check, key, reopened, due in (("MM001", "MATNR=1", 0, None), ("MM001", "MATNR=2", 2, "2026-11-01T00:00:00+00:00"),
                                          ("MM002", "MATNR=2", 0, None), ("MM003", "MATNR=2", 0, None)):
            c.execute(text("""
                INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status,
                                           first_seen_version, last_seen_version, first_seen_at, reopened_count,
                                           due_at, sla_state)
                VALUES (:t, :s, 'material_master', :c, :k, 'MARA', 'high', 'open', :p, :v,
                        CAST('2026-10-12T08:00:00+00:00' AS timestamptz), :r, CAST(:due AS timestamptz), :sla)"""),
                      {"t": tid, "s": sid, "c": check, "k": key, "p": prev, "v": vid, "r": reopened, "due": due,
                       "sla": "on_track" if due else None})
        c.execute(text("INSERT INTO rules (tenant_id, name, module, category, severity) "
                       "VALUES (:t, 'MM001: Base unit must be set', 'material_master', 'ecc', 'critical')"), {"t": tid})
        golden = str(uuid.uuid4())
        c.execute(text("INSERT INTO master_records (id, tenant_id, domain, sap_object_key, status) "
                       "VALUES (:id, :t, 'material_master', '2', 'golden')"), {"id": golden, "t": tid})
        for a, b, st in (("2", "7", "pending"), ("9", "2", "pending"), ("2", "8", "merged"), ("1", "7", "pending")):
            c.execute(text("INSERT INTO dedup_candidates (id, tenant_id, object_type, record_key_a, record_key_b, "
                           "match_score, match_method, status) VALUES (gen_random_uuid(), :t, 'material_master', "
                           ":a, :b, 90, 'fuzzy', :st)"), {"t": tid, "a": a, "b": b, "st": st})
    from api.services import worklist
    with Session(app) as s:
        worklist.build(s, tid, prev)
        worklist.build(s, tid, vid)
    rule_id = None
    with owner.begin() as c:
        rule_id = str(c.execute(text("SELECT id FROM rules WHERE tenant_id = :t"), {"t": tid}).scalar())
    yield tid, prev, vid, golden, rule_id


@pytest.fixture
def client_for(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    def make(tid):
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                            lambda token, secret: {"sub": USER, "email": "steward@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return make


@pytest.mark.anyio
async def test_record_detail_counts_rule_history_and_mdm_links(run, client_for):
    tid, prev, vid, golden, rule_id = run
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/work/records/material_master/MATNR=2", params={"version_id": vid}, headers=HEADERS)
        assert r.status_code == 200, r.text
        rec = r.json()
        by = {i["check_id"]: i for i in rec["issues"]}
        mm1, mm2 = by["MM001"], by["MM002"]

        assert mm1["rule"] == {"id": rule_id, "name": "Base unit must be set", "dimension": "completeness",
                               "authority": "sap_hard_constraint", "cost_at_risk": 500.0, "cost_per_record": 250.0}
        assert (mm1["failing"], mm1["others_failing"], mm1["population"], mm1["pass_rate"]) == (2, 1, 10, 80.0)
        assert mm1["first_seen_at"].startswith("2026-10-12T08:00:00") and mm1["reopened_count"] == 2
        assert mm1["due_at"].startswith("2026-11-01") and mm1["sla_state"] == "on_track"
        assert mm1["allowed_values"] is None  # MM001 is not in the shipped library and its context lists none

        assert mm2["rule"]["id"] is None and mm2["rule"]["cost_at_risk"] is None and mm2["rule"]["cost_per_record"] is None
        assert (mm2["failing"], mm2["others_failing"], mm2["population"], mm2["pass_rate"]) == (1, 0, 10, 90.0)
        assert sorted(mm2["allowed_values"], key=lambda v: v["value"]) == [{"value": "FERT", "label": "Finished product"},
                                         {"value": "ROH", "label": "Raw material"}]
        assert mm2["reopened_count"] == 0 and mm2["due_at"] is None

        o = rec["other_runs"]
        assert o["version_id"] == prev and o["on_list"] is True and o["issues"] == 2
        assert o["checks"] == ["MM001", "MM003"] and o["fixed_since"] == ["MM003"] and o["new_since"] == ["MM002"]
        assert o["status"] == "to_fix"

        assert rec["golden_record"] == {"id": golden, "status": "golden", "key": "2", "href": f"/o/_/material-master/golden?open=golden:{golden}"}
        assert rec["duplicates"] == {
            "open": 2, "href": "/o/_/material-master/golden"}
        assert rec["currency"] == "ZAR"  # the default cost model: the tenant sets none

        # MATNR=1 was not on the previous run's list: it passed then. No golden record, no duplicates for key 1
        # beyond the one open pair.
        one = (await client.get("/api/v1/work/records/material_master/MATNR=1", params={"version_id": vid},
                                headers=HEADERS)).json()
        assert one["other_runs"]["on_list"] is False and one["other_runs"]["issues"] == 0
        assert one["other_runs"]["new_since"] == ["MM001"] and one["other_runs"]["fixed_since"] == []
        assert one["golden_record"] is None and one["duplicates"] == {
            "open": 1, "href": "/o/_/material-master/golden"}

        # The previous run itself has no earlier run to compare with.
        old = (await client.get("/api/v1/work/records/material_master/MATNR=2", params={"version_id": prev},
                                headers=HEADERS)).json()
        assert old["other_runs"] is None and old["currency"] is None  # nothing priced in that run
        assert {i["check_id"] for i in old["issues"]} == {"MM001", "MM003"}


def test_allowed_values_fall_back_to_the_shipped_rule():
    from api.routes.work import _allowed_values, _key_candidates, _pass_rate

    assert _allowed_values(None, "accounts_payable", "AP011") == [
        {"value": "X", "label": "Marked for deletion at central level"},
        {"value": "", "label": "Active — not marked for deletion"}]
    assert _allowed_values({"A": "Active"}, "accounts_payable", "AP011") == [{"value": "A", "label": "Active"}]
    assert _allowed_values(None, "material_master", "NOPE") is None
    assert _key_candidates("LIFNR=100|BUKRS=10") == ["LIFNR=100|BUKRS=10", "100"]
    assert _key_candidates("12345") == ["12345"]
    assert _pass_rate(None, 3, 8) == 62.5 and _pass_rate(97.25, 3, None) == 97.2 and _pass_rate(None, 1, 0) is None


@pytest.mark.anyio
async def test_a_failing_mdm_lookup_leaves_the_rest_of_the_record(run, client_for, monkeypatch):
    tid, _prev, vid, _golden, _rule_id = run
    # A key list Postgres refuses: the MDM lookups fail inside their savepoint; the rest of the answer stands.
    monkeypatch.setattr("api.routes.work._key_candidates", lambda key: [object()])
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/work/records/material_master/MATNR=2", params={"version_id": vid}, headers=HEADERS)
    assert r.status_code == 200, r.text
    rec = r.json()
    assert rec["golden_record"] is None and rec["duplicates"] is None
    assert rec["currency"] == "ZAR" and rec["other_runs"]["issues"] == 2
