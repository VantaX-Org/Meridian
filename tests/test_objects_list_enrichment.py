"""Objects list enrichment: blocking rule, trend, worst dimension, owner, blocking total."""
import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.main import app
from tests.route_auth import HEADERS, patch_tenant

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


def _summary(score: float) -> str:
    return json.dumps({"material_master": {"composite_score": score, "dimension_scores":
                                           {"completeness": 90.0, "validity": 40.0, "uniqueness": 10.0},
                                           "dimension_coverage": {"uniqueness": 0}},
                       "vendor": {"composite_score": 70.0, "raw_score": 83.5, "capped": True, "dimension_scores": {}}})


@pytest.fixture
def seeded():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t, user, sys_a, sys_b = (str(uuid.uuid4()) for _ in range(4))
    runs = [str(uuid.uuid4()) for _ in range(10)]
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": t})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role, password_hash) "
                       "VALUES (:u, :t, :e, 'Olive Owner', 'admin', 'x')"), {"u": user, "t": t, "e": f"{user}@x.test"})
        # 9 runs of system A (scores 50..58), 1 run of system B
        for i, v in enumerate(runs[:9]):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary, metadata, run_at) "
                           "VALUES (:v, :t, 'complete', CAST(:s AS jsonb), CAST(:m AS jsonb), now() + :i * interval '1 minute')"),
                      {"v": v, "t": t, "s": _summary(50.0 + i), "m": json.dumps({"system_id": sys_a}), "i": i})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary, metadata, run_at) "
                       "VALUES (:v, :t, 'complete', CAST(:s AS jsonb), CAST(:m AS jsonb), now() + interval '30 minutes')"),
                  {"v": runs[9], "t": t, "s": _summary(99.0), "m": json.dumps({"system_id": sys_b})})
        last = runs[8]
        for cid, sev, aff in [("MM-LOW", "low", 900), ("MM-HIGH-A", "high", 5), ("MM-HIGH-B", "high", 50),
                              ("MM-CRIT-OK", "critical", 0)]:
            c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count) VALUES (gen_random_uuid(), :v, :t, 'material_master', :c, :s, "
                           "'validity', :a, 1000)"), {"v": last, "t": t, "c": cid, "s": sev, "a": aff})
        c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                       "affected_count, total_count) VALUES (gen_random_uuid(), :v, :t, 'vendor', 'V-CRIT', 'critical', "
                       "'validity', 3, 10)"), {"v": last, "t": t})
        c.execute(text("INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, "
                       "affected_count, total_count) VALUES (gen_random_uuid(), :v, :t, 'customer', 'C-LOW', 'low', "
                       "'validity', 40, 100)"), {"v": last, "t": t})
        c.execute(text("INSERT INTO rules (tenant_id, name, module, category, severity, enabled, conditions, source) "
                       "VALUES (:t, 'MM-HIGH-B: Base unit missing', 'material_master', 'completeness', 'high', true, "
                       "'{}'::jsonb, 'builtin')"), {"t": t})
        c.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id) "
                       "VALUES (:t, 'object', 'material_master', :u)"), {"t": t, "u": user})
    yield t, runs
    with engine.begin() as c:
        for tbl in ("findings", "rules", "data_owners", "analysis_versions"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id = :t"), {"t": t})
        c.execute(text("DELETE FROM users WHERE tenant_id = :t"), {"t": t})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})


@pytest.mark.anyio
async def test_objects_list_enrichment(seeded, monkeypatch):
    t, runs = seeded
    patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/v1/objects?run={runs[8]}", headers=HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    by = {o["module"]: o for o in body["objects"]}
    mm = by["material_master"]
    # severity beats count (high over low@900); equal severity: most records failing; 0-affected rows are not failing
    assert mm["blocking_rule_id"] == "MM-HIGH-B"
    assert mm["blocking_rule_name"] == "Base unit missing"
    assert mm["trend"] == [51.0, 52.0, 53.0, 54.0, 55.0, 56.0, 57.0, 58.0]  # last 8 of system A, oldest first
    assert mm["worst_dimension"] == "validity"  # uniqueness (10) has coverage 0, so it is not measured
    assert mm["owner"] == "Olive Owner"
    # failing critical+high: MM-HIGH-A, MM-HIGH-B, V-CRIT; MM-CRIT-OK affects 0 records, low ones do not block
    assert body["blocking_findings_total"] == 3
    assert by["customer"]["failing_checks"] == 1 and by["customer"]["blocking_rule_id"] is None
    assert by["customer"]["blocking_rule_name"] is None
    vendor = by["vendor"]
    assert vendor["blocking_rule_id"] == "V-CRIT" and vendor["blocking_rule_name"] is None
    assert vendor["worst_dimension"] is None and vendor["owner"] is None
    # the list carries the uncapped score so the cap can be drawn as a tick
    assert (vendor["raw_score"], vendor["capped"]) == (83.5, True)
    assert (by["material_master"]["raw_score"], by["material_master"]["capped"]) == (None, False)
    assert len(vendor["trend"]) == 8


@pytest.mark.anyio
async def test_objects_list_dimension_scores(seeded, monkeypatch):
    t, runs = seeded
    patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        body = (await client.get(f"/api/v1/objects?run={runs[8]}", headers=HEADERS)).json()
    by = {o["module"]: o for o in body["objects"]}
    # uniqueness has coverage 0, so it is not measured and not returned
    assert by["material_master"]["dimension_scores"] == {"completeness": 90.0, "validity": 40.0}
    assert by["vendor"]["dimension_scores"] == {}


@pytest.mark.anyio
async def test_objects_list_severity_counts(seeded, monkeypatch):
    t, runs = seeded
    patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        body = (await client.get(f"/api/v1/objects?run={runs[8]}", headers=HEADERS)).json()
    by = {o["module"]: o for o in body["objects"]}
    # MM-CRIT-OK affects 0 records so it is not failing; low does not count in either column
    assert (by["material_master"]["critical_checks"], by["material_master"]["high_checks"]) == (0, 2)
    assert (by["vendor"]["critical_checks"], by["vendor"]["high_checks"]) == (1, 0)
    assert (by["customer"]["critical_checks"], by["customer"]["high_checks"]) == (0, 0)
