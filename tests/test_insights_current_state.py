"""scope=current on the one-run insight endpoints (overview, root causes, cleansing) and on
GET /findings/s4-readiness: every object at the latest complete run of its lineage, each object once
from the newest run that measured it. PG tests are skipped without MERIDIAN_TEST_DB_URL."""

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app
from api.services import insights_aggregate as agg

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
FEATURE = "Vendor Master Management"  # procure_to_pay
S4_CHECK = "S4-CVI-LFA1"  # a blocking rule of the S/4 readiness pack
HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}


def _summary(score):
    return {"composite_score": score, "dimension_scores": {"completeness": score}, "dimension_coverage": {},
            "critical_count": 0, "total_checks": 5}


# -- pure: the narrative of the current state names no run ------------------------------------

def test_current_narrative_links_carry_no_run():
    dqs = {"composite": 85.0, "previous": None, "delta": None, "tier": "go", "capped": False, "cap_reason": None}
    lines = agg.narrative(run_id=None, dqs=dqs, deltas={}, blockers={"count": 0, "previous": None, "waves": 0},
                          conc=None, wave_names=[], auto={"pct": 50.0, "high_confidence": 1},
                          top_cluster={"module": "material_master", "field": "MATKL", "table": "MARA", "rules": ["X"]})
    assert lines[0]["text"] == "The data quality score across objects, each at its latest run, is 85.0."
    assert [line["href"] for line in lines] == [
        "/insights/trends", "/insights/readiness", "/insights/rules?auto_fixable=true",
        "/insights/rules?field=MARA.MATKL"]


def test_run_narrative_links_unchanged():
    dqs = {"composite": 85.0, "previous": None, "delta": None, "tier": "go", "capped": False, "cap_reason": None}
    lines = agg.narrative(run_id="v1", dqs=dqs, deltas={}, blockers={"count": 0, "previous": None, "waves": 0},
                          conc=None, wave_names=[], auto={"pct": 50.0, "high_confidence": 1},
                          top_cluster={"module": "material_master", "field": "MATKL", "table": "MARA", "rules": ["X"]})
    assert [line["href"] for line in lines] == [
        "/insights/trends?run=v1", "/insights/readiness?run=v1", "/insights/rules?run=v1&auto_fixable=true",
        "/insights/rules?run=v1&field=MARA.MATKL"]


# -- PG ----------------------------------------------------------------------------------------

pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture
def current_tenant():
    """Tenant ``t``: a system read twice (``sys_old`` superseded by ``sys_new``, both accounts payable and material
    master) and a newer upload of accounts payable (``upload``), plus a newer run still running. Current runs:
    ``sys_new`` and ``upload``; accounts payable is measured by both, so it comes from ``upload`` (newer).
    Every row of a run that must not count carries 999. Tenant ``empty`` has no run."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t, empty, sid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    ids = {k: str(uuid.uuid4()) for k in ("sys_old", "sys_new", "upload", "running")}

    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, cost_model) VALUES (:id, :id, CAST(:cm AS jsonb))"),
                  {"id": t, "cm": json.dumps({"currency": "ZAR", "features": {FEATURE: 10.0}})})
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": empty})

        def run(name, minutes, summary, *, system=None, status="complete"):
            md = {"modules": sorted(summary), **({"system_id": system} if system else {})}
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:id, :t, :l, :s, :r, CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                      {"id": ids[name], "t": t, "l": name, "s": status, "r": T0 + timedelta(minutes=minutes),
                       "m": json.dumps(md), "q": json.dumps({m: _summary(v) for m, v in summary.items()})})

        def finding(name, module, check_id, affected, field=None, severity="high"):
            c.execute(text(
                "INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
                "total_count, pass_rate, rule_context) VALUES (:id, :v, :t, :m, :c, :sev, 'completeness', :a, 1000, "
                "50, CAST(:rc AS jsonb))"),
                {"id": str(uuid.uuid4()), "v": ids[name], "t": t, "m": module, "c": check_id, "a": affected,
                 "sev": severity, "rc": json.dumps({"field": field} if field else {})})

        def fix(name, module, check_id, record):
            c.execute(text("INSERT INTO record_fixes (id, tenant_id, version_id, check_id, module, record_id, "
                           "suggested_value) VALUES (:id, :t, :v, :c, :m, :r, 'X')"),
                      {"id": str(uuid.uuid4()), "t": t, "v": ids[name], "c": check_id, "m": module, "r": record})

        def impact(name, records):
            c.execute(text("INSERT INTO config_impact_results (id, version_id, tenant_id, feature, system, status, "
                           "total_affected_records) VALUES (:id, :v, :t, :f, 'ECC', 'blocked', :n)"),
                      {"id": str(uuid.uuid4()), "v": ids[name], "t": t, "f": FEATURE, "n": records})

        run("sys_old", 0, {"accounts_payable": 40.0, "material_master": 40.0}, system=sid)
        for m, cid in (("accounts_payable", "AP-001"), ("material_master", "MM-001"), ("accounts_payable", S4_CHECK)):
            finding("sys_old", m, cid, 999, field="LFA1.STCD1" if m == "accounts_payable" else "MARA.MATKL")
        fix("sys_old", "material_master", "MM-001", "old1")
        impact("sys_old", 999)

        run("sys_new", 60, {"accounts_payable": 60.0, "material_master": 80.0}, system=sid)
        finding("sys_new", "accounts_payable", "AP-001", 10, field="LFA1.STCD1")
        finding("sys_new", "accounts_payable", S4_CHECK, 4)
        finding("sys_new", "material_master", "MM-001", 7, field="MARA.MATKL")
        fix("sys_new", "accounts_payable", "AP-001", "superseded1")  # accounts payable is read from the upload
        fix("sys_new", "material_master", "MM-001", "m1")
        impact("sys_new", 999)

        run("upload", 120, {"accounts_payable": 90.0})
        finding("upload", "accounts_payable", "AP-001", 3, field="LFA1.STCD1")
        finding("upload", "accounts_payable", S4_CHECK, 2)
        fix("upload", "accounts_payable", "AP-001", "u1")
        impact("upload", 5)
        for status in ("approved", "applied"):
            c.execute(text("INSERT INTO cleaning_queue (id, tenant_id, object_type, status, record_key, version_id) "
                           "VALUES (:id, :t, 'accounts_payable', :s, :k, :v)"),
                      {"id": str(uuid.uuid4()), "t": t, "s": status, "k": f"k-{status}", "v": ids["upload"]})

        run("running", 180, {"accounts_payable": 10.0}, system=sid, status="running")
        finding("running", "accounts_payable", "AP-001", 999, field="LFA1.STCD1")

    yield t, empty, ids
    with engine.begin() as c:
        for tbl in ("cleaning_queue", "record_fixes", "config_impact_results", "findings", "analysis_versions"):
            c.execute(text(f"DELETE FROM {tbl} WHERE tenant_id IN (:a, :b)"), {"a": t, "b": empty})
        c.execute(text("DELETE FROM tenants WHERE id IN (:a, :b)"), {"a": t, "b": empty})


def _patch_tenant(monkeypatch, tenant_id: str):
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token", lambda token, secret: {
        "sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))


async def _get(monkeypatch, tenant_id: str, path: str) -> dict:
    _patch_tenant(monkeypatch, tenant_id)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(path, headers=HEADERS)
    assert r.status_code == 200, (path, r.text)
    return r.json()


def _numbers(node):
    if isinstance(node, bool):
        return
    if isinstance(node, (int, float)):
        yield node
    elif isinstance(node, dict):
        for x in node.values():
            yield from _numbers(x)
    elif isinstance(node, list):
        for x in node:
            yield from _numbers(x)


def _no_superseded(body):
    assert all(n < 999 for n in _numbers(body) if isinstance(n, int)), body


def _scope(body, ids, objects):
    assert body["version_id"] is None and body["scope"] == "current"
    assert body["version_ids"] == [ids["upload"], ids["sys_new"]]  # newest first
    assert {o["module"]: o["version_id"] for o in body["objects"]} == {m: ids[r] for m, r in objects.items()}


BOTH = {"accounts_payable": "upload", "material_master": "sys_new"}


@pg
@pytest.mark.anyio
async def test_overview_current_dedupes_objects(current_tenant, monkeypatch):
    t, _, ids = current_tenant
    body = await _get(monkeypatch, t, "/api/v1/insights/overview?scope=current")
    _scope(body, ids, BOTH)
    _no_superseded(body)
    assert body["dqs"]["composite"] == 85.0  # accounts payable 90 (upload), material master 80 (system)
    assert body["dqs"]["previous"] is None and body["dqs"]["delta"] is None and body["previous_version_id"] is None
    # failing: AP-001 3 + S4 2 (upload) + MM-001 7 (system); fixes: u1 (upload) + m1 (system)
    assert body["auto_fixable"]["failing_records"] == 12 and body["auto_fixable"]["records"] == 2
    assert body["blockers"]["count"] == 1  # S4-CVI-LFA1, from the upload only
    # the feature computed by both current runs is taken from the newer one: 5 records x 10
    assert body["value_at_risk"]["worst_l1"] == "procure_to_pay"
    assert body["value_at_risk"]["worst_l1_amount"] == 50.0
    assert all("run=" not in (n.get("href") or "") for n in body["narrative"])


@pg
@pytest.mark.anyio
async def test_overview_current_module_filter(current_tenant, monkeypatch):
    t, _, ids = current_tenant
    body = await _get(monkeypatch, t, "/api/v1/insights/overview?scope=current&module=material_master")
    assert [o["module"] for o in body["objects"]] == ["material_master"]
    assert body["version_ids"] == [ids["sys_new"]]
    assert body["dqs"]["composite"] == 80.0 and body["auto_fixable"]["failing_records"] == 7


@pg
@pytest.mark.anyio
async def test_root_causes_current_dedupes_objects(current_tenant, monkeypatch):
    t, _, ids = current_tenant
    body = await _get(monkeypatch, t, "/api/v1/insights/root-causes?scope=current")
    _scope(body, ids, BOTH)
    _no_superseded(body)
    by_key = {c["key"]: c for c in body["clusters"]}
    assert by_key["accounts_payable:LFA1.STCD1"]["records"] == 3
    assert by_key["accounts_payable:LFA1.STCD1"]["version_id"] == ids["upload"]
    assert by_key["material_master:MARA.MATKL"]["records"] == 7
    assert by_key["material_master:MARA.MATKL"]["version_id"] == ids["sys_new"]
    # one run, unchanged: the system run's own accounts payable
    one = await _get(monkeypatch, t, f"/api/v1/insights/root-causes?version_id={ids['sys_new']}")
    assert one["version_id"] == ids["sys_new"] and "scope" not in one
    assert {c["key"]: c["records"] for c in one["clusters"]}["accounts_payable:LFA1.STCD1"] == 10


@pg
@pytest.mark.anyio
async def test_cleansing_current_dedupes_objects(current_tenant, monkeypatch):
    t, _, ids = current_tenant
    body = await _get(monkeypatch, t, "/api/v1/insights/cleansing?scope=current")
    _scope(body, ids, BOTH)
    assert {s["key"]: s["records"] for s in body["steps"]} == {
        "failing": 12, "proposed": 2, "high": 0, "approved": 2, "applied": 1}
    assert {m["module"]: (m["failing"], m["proposed"]) for m in body["by_module"]} == {
        "accounts_payable": (5, 1), "material_master": (7, 1)}
    assert {r["check_id"]: r["proposed"] for r in body["by_rule"]} == {"AP-001": 1, "MM-001": 1}
    assert body["currency"] == "ZAR"


@pg
@pytest.mark.anyio
async def test_s4_readiness_current_dedupes_objects(current_tenant, monkeypatch):
    t, _, ids = current_tenant
    body = await _get(monkeypatch, t, "/api/v1/findings/s4-readiness?scope=current")
    assert body["version_id"] is None and body["scope"] == "current"
    assert body["version_ids"] == [ids["upload"], ids["sys_new"]]
    assert body["failing"] == 1 and body["failing_records"] == 2 and body["blocking_failing"] == 1
    # one run, unchanged
    one = await _get(monkeypatch, t, f"/api/v1/findings/s4-readiness?version_id={ids['sys_new']}")
    assert one["version_id"] == ids["sys_new"] and one["failing_records"] == 4
    assert one["scope"] is None and one["version_ids"] is None


@pg
@pytest.mark.anyio
async def test_current_scope_for_an_empty_tenant(current_tenant, monkeypatch):
    """Another tenant with no run: 200 and empty payloads, nothing of tenant ``t``."""
    _, empty, _ = current_tenant
    ov = await _get(monkeypatch, empty, "/api/v1/insights/overview?scope=current")
    assert ov["version_ids"] == [] and ov["objects"] == [] and ov["dqs"]["composite"] is None
    assert ov["auto_fixable"]["failing_records"] == 0 and ov["value_at_risk"]["worst_l1"] is None
    rc = await _get(monkeypatch, empty, "/api/v1/insights/root-causes?scope=current")
    assert rc["clusters"] == [] and rc["version_ids"] == []
    cl = await _get(monkeypatch, empty, "/api/v1/insights/cleansing?scope=current")
    assert [s["records"] for s in cl["steps"]] == [0, 0, 0, 0, 0] and cl["by_module"] == [] and cl["by_rule"] == []
    s4 = await _get(monkeypatch, empty, "/api/v1/findings/s4-readiness?scope=current")
    assert s4["version_ids"] == [] and s4["evaluated"] == 0 and s4["failing"] == 0


@pg
@pytest.mark.anyio
async def test_current_scope_rejects_a_version_id(current_tenant, monkeypatch):
    t, _, ids = current_tenant
    _patch_tenant(monkeypatch, t)
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for path in ("/api/v1/insights/overview", "/api/v1/insights/root-causes", "/api/v1/insights/cleansing",
                     "/api/v1/findings/s4-readiness"):
            r = await client.get(f"{path}?scope=current&version_id={ids['upload']}", headers=HEADERS)
            assert r.status_code == 422, (path, r.text)


@pg
@pytest.mark.anyio
async def test_readiness_current_reads_each_object_at_its_own_run(current_tenant, monkeypatch):
    """Waves under scope=current: each wave its own latest migration run, each object's DQS from the run of the
    current state that measured it (accounts payable from the upload, material master from the system), as Home;
    the executive summary's readiness cells answer the same."""
    t, empty, ids = current_tenant
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    wave = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, modules, min_readiness, min_dqs) "
                       "VALUES (:id, :t, 'Wave 1', '{accounts_payable,material_master}', 90, 85)"),
                  {"id": wave, "t": t})
        c.execute(text("INSERT INTO migration_runs (tenant_id, mode, wave_id, status, completed_at, gap_summary) "
                       "VALUES (:t, 'source_to_destination', :w, 'analysed', now(), CAST(:g AS jsonb))"),
                  {"t": t, "w": wave, "g": json.dumps({
                      "accounts_payable": {"verdict": "go", "score": 100.0, "blocked_records": 0, "gaps": {}},
                      "material_master": {"verdict": "go", "score": 100.0, "blocked_records": 0, "gaps": {}}})})
    try:
        body = await _get(monkeypatch, t, "/api/v1/insights/readiness?scope=current")
        assert body["version_id"] is None and body["scope"] == "current"
        assert body["version_ids"] == [ids["upload"], ids["sys_new"]]
        cells = {c["module"]: c for c in body["cells"]}
        assert cells["accounts_payable"]["dqs"] == 90.0 and cells["accounts_payable"]["verdict"] == "go"
        assert cells["material_master"]["dqs"] == 80.0 and cells["material_master"]["verdict"] == "at_risk"
        # one run, unchanged: that run's id and no current-state fields
        one = await _get(monkeypatch, t, f"/api/v1/insights/readiness?version_id={ids['sys_new']}")
        assert one["version_id"] == ids["sys_new"] and "scope" not in one and "version_ids" not in one
        # the executive summary's current state carries the same cells
        ex = await _get(monkeypatch, t, "/api/v1/insights/exec?scope=current")
        assert ex["readiness_cells"] == body["cells"]
        # another tenant sees none of this tenant's waves
        other = await _get(monkeypatch, empty, "/api/v1/insights/readiness?scope=current")
        assert other["cells"] == [] and other["configured"] is False and other["version_ids"] == []
        _patch_tenant(monkeypatch, t)
        await api_deps.engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/api/v1/insights/readiness?scope=current&version_id={ids['upload']}",
                                 headers=HEADERS)
        assert r.status_code == 422, r.text
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM migration_runs WHERE tenant_id = :t"), {"t": t})
            c.execute(text("DELETE FROM migration_waves WHERE tenant_id = :t"), {"t": t})
