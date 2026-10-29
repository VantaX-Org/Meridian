"""The verbs the v2 Admin area needs, against a real Postgres (MERIDIAN_TEST_DB_URL).

Job cancel, analysis options, PATCH /settings/tenant, API key patch, field mapping create and delete, reference list
delete, the schedules CRUD (and its agreement with the older per-system profiles routes), support diagnostics and the
two new preferences. Each has its happy path, its validation, a 403 for a viewer, an audit_log row and a tenant isolation
check. Seed: tests/m2_seed.py; the job registry is an in-memory Redis stand-in; Celery is a recorder.
"""
from __future__ import annotations

import json
import os
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_seed import seed_m2
from tests.test_jobs import FakeRedis

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture
def s(owner):
    return seed_m2(owner)


@pytest.fixture
def redis(monkeypatch):
    from api.services import jobs, task_progress
    r = FakeRedis()
    monkeypatch.setattr(task_progress, "_redis_instance", r)
    monkeypatch.setattr(jobs, "_redis_client", lambda: r)
    return r


def q(owner, sql, **p):
    with owner.begin() as c:
        res = c.execute(text(sql), p)
        return res.fetchall() if res.returns_rows else []


def audit(owner, tid, action):
    return q(owner, "SELECT action, entity_type, entity_id, actor_user_id::text, before_json, after_json FROM audit_log "
                    "WHERE tenant_id = :t AND action = :a ORDER BY created_at", t=tid, a=action)


async def start(monkeypatch, s):
    """A client signed in as the seed's admin user (a real users row, so audit_log's actor foreign key holds)."""
    deps, client = make_client(monkeypatch, s["tid"], s["user"])
    await deps.engine.dispose()
    return client


# ── 1. POST /jobs/{id}/cancel ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_cancel_a_running_job(s, owner, monkeypatch, redis):
    from api.routes import jobs as jobs_route
    from api.services import jobs
    revoked = []
    monkeypatch.setattr(jobs_route, "_revoke", lambda ids: revoked.append(ids) or True)
    vid = str(uuid.uuid4())
    q(owner, "INSERT INTO analysis_versions (id, tenant_id, status, label, metadata) VALUES (:v, :t, 'running', 'x', "
             "CAST(:m AS jsonb))", v=vid, t=s["tid"], m=json.dumps({"system_id": s["ecc"], "modules": ["material_master"]}))
    jobs.start_job(s["tid"], vid, "analysis", "Analysis", status="running", version_id=vid, system_id=s["ecc"])
    jobs.set_task_ids(s["tid"], vid, ["celery-1"])
    redis.published.clear()
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post(f"/api/v1/jobs/{vid}/cancel", headers=headers())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "cancelled" and body["cancelled_by"] == s["user"] and body["cancelled_at"]
        assert body["tasks_revoked"] is True and body["finished_at"]
        assert revoked == [["celery-1"]]
        # the stream saw it, and the job reads cancelled
        assert redis.published and redis.published[-1]["event"] == "job" and redis.published[-1]["status"] == "cancelled"
        assert (await client.get(f"/api/v1/jobs/{vid}", headers=headers())).json()["status"] == "cancelled"
        # a worker that has not stopped yet cannot bring it back
        jobs.update_job(s["tid"], vid, stage="checks", percent=40)
        jobs.finish_job(s["tid"], vid, "completed")
        assert jobs.get_job(s["tid"], vid)["status"] == "cancelled"
        # the version can be analysed again
        st, meta = q(owner, "SELECT status, metadata FROM analysis_versions WHERE id = :v", v=vid)[0]
        assert st == "failed" and meta["cancelled"]["by"] == s["user"]
        # finished: 409; unknown: 404
        assert (await client.post(f"/api/v1/jobs/{vid}/cancel", headers=headers())).status_code == 409
        assert (await client.post("/api/v1/jobs/nope/cancel", headers=headers())).status_code == 404
    rows = audit(owner, s["tid"], "job.cancel")
    assert len(rows) == 1 and rows[0][1:4] == ("job", vid, s["user"]) and rows[0][5]["status"] == "cancelled"


@pytest.mark.anyio
async def test_cancel_a_queued_job_without_tasks_and_a_finished_one(s, owner, monkeypatch, redis):
    from api.services import jobs
    jobs.start_job(s["tid"], "dl-1", "extraction", "x", status="queued", system_id=s["ecc"])
    jobs.start_job(s["tid"], "dl-2", "extraction", "x", status="running", system_id=s["ecc"])
    jobs.finish_job(s["tid"], "dl-2", "failed", error="boom")
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post("/api/v1/jobs/dl-1/cancel", headers=headers())
        assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["tasks_revoked"] is None
        assert (await client.post("/api/v1/jobs/dl-2/cancel", headers=headers())).status_code == 409


@pytest.mark.anyio
async def test_cancel_needs_admin_and_stays_in_its_tenant(s, owner, monkeypatch, redis):
    from api.services import jobs
    other = seed_m2(owner)
    jobs.start_job(s["tid"], "j-a", "extraction", "x", status="running")
    client = await start(monkeypatch, s)
    async with client:
        assert (await client.post("/api/v1/jobs/j-a/cancel", headers=headers("viewer"))).status_code == 403
        assert (await client.post("/api/v1/jobs/j-a/cancel", headers=headers("manager"))).status_code == 403
        assert jobs.get_job(s["tid"], "j-a")["status"] == "running"
    client_b = await start(monkeypatch, other)
    async with client_b:
        assert (await client_b.post("/api/v1/jobs/j-a/cancel", headers=headers())).status_code == 404
    assert jobs.get_job(s["tid"], "j-a")["status"] == "running"
    assert audit(owner, s["tid"], "job.cancel") == []


# ── 2. POST /versions/{id}/analyse with options ──────────────────────────────────────────────────────────────

@pytest.fixture
def queued(monkeypatch):
    from workers.tasks import run_checks as mod
    calls = []
    monkeypatch.setattr(mod.run_checks, "delay", lambda *a, **k: calls.append((a, k)) or SimpleNamespace(id="task-1"))
    return calls


def _analysable(owner, s, status="complete"):
    vid = str(uuid.uuid4())
    q(owner, "INSERT INTO analysis_versions (id, tenant_id, status, label, metadata) VALUES (:v, :t, :st, 'x', CAST(:m AS jsonb))",
      v=vid, t=s["tid"], st=status, m=json.dumps({"system_id": s["ecc"], "modules": ["material_master", "fi_gl"],
                                                   "dataset_path": "staging/x/"}))
    return vid


@pytest.mark.anyio
async def test_analyse_with_options(s, owner, monkeypatch, redis, queued):
    from api.services import jobs
    vid, plain = _analysable(owner, s), _analysable(owner, s)
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post(f"/api/v1/versions/{vid}/analyse", headers=headers(),
                              json={"rule_set_id": "strict-2026", "modules": ["fi_gl", "fi_gl"]})
        assert r.status_code == 202 and r.json()["task_id"] == "task-1"
        assert q(owner, "SELECT status, metadata->'analysis_options' FROM analysis_versions WHERE id = :v", v=vid)[0] == (
            "pending", {"rule_set_id": "strict-2026", "modules": ["fi_gl"]})
        assert jobs.get_job(s["tid"], vid)["task_ids"] == ["task-1"]
        # the default is unchanged: no body, no options
        r = await client.post(f"/api/v1/versions/{plain}/analyse", headers=headers())
        assert r.status_code == 202 and r.json()["status"] == "pending"
        assert q(owner, "SELECT metadata->'analysis_options' FROM analysis_versions WHERE id = :v", v=plain)[0][0] is None
        assert len(queued) == 2


@pytest.mark.anyio
async def test_analyse_options_validation_permission_isolation(s, owner, monkeypatch, redis, queued):
    other = seed_m2(owner)
    vid = _analysable(owner, s)
    client = await start(monkeypatch, s)
    async with client:
        url = f"/api/v1/versions/{vid}/analyse"
        assert (await client.post(url, headers=headers(), json={"modules": ["hcm"]})).status_code == 422
        assert (await client.post(url, headers=headers(), json={"modules": []})).status_code == 422
        assert (await client.post(url, headers=headers(), json={"rule_set": "x"})).status_code == 422
        assert (await client.post(url, headers=headers("viewer"), json={"modules": ["fi_gl"]})).status_code == 403
        assert q(owner, "SELECT status FROM analysis_versions WHERE id = :v", v=vid)[0][0] == "complete"
        assert queued == []
    client_b = await start(monkeypatch, other)
    async with client_b:
        assert (await client_b.post(url, headers=headers(), json={"modules": ["fi_gl"]})).status_code == 404


def test_the_worker_checks_only_the_modules_asked_for():
    import inspect

    from workers.tasks import run_checks
    src = inspect.getsource(run_checks._run_checks)
    assert 'metadata.get("analysis_options")' in src and "if m in only" in src


# ── 3. PATCH /settings/tenant ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_patch_tenant_settings(s, owner, monkeypatch):
    other = seed_m2(owner)
    client = await start(monkeypatch, s)
    async with client:
        before = (await client.get("/api/v1/settings", headers=headers())).json()
        assert before["cap_rule"] == {"one_critical": 85.0, "two_plus": 70.0} and before["tolerance"]["rows"] == 25
        r = await client.patch("/api/v1/settings/tenant", headers=headers(), json={
            "name": "Acme Mining", "currency": "ZAR",
            "scoring_weights": {"completeness": 0.3, "accuracy": 0.3, "consistency": 0.2, "timeliness": 0.1,
                                "uniqueness": 0.05, "validity": 0.05},
            "cap_rule": {"one_critical": 80, "two_plus": 60}, "tolerance": {"pct": 2.5, "rows": 10},
            "retention_days": 400, "cost_model": {"currency": "USD", "severity": {"critical": {"per_record": 12}}}})
        assert r.status_code == 200, r.text
        doc = r.json()
        # currency wins over the cost model's own, and the document is what GET returns
        assert doc["name"] == "Acme Mining" and doc["currency"] == "ZAR" and doc["cost_model"]["currency"] == "ZAR"
        assert doc["cost_model"]["severity"] == {"critical": {"per_record": 12}}
        assert doc["scoring_weights"]["completeness"] == 0.3 and doc["cap_rule"] == {"one_critical": 80.0, "two_plus": 60.0}
        assert doc["tolerance"] == {"pct": 2.5, "rows": 10} and doc["retention_days"] == 400
        assert (await client.get("/api/v1/settings", headers=headers())).json() == doc
        # stored the way the scoring engine reads it: percentages, a fraction for the tolerance
        w, ret = q(owner, "SELECT dqs_weights, retention FROM tenants WHERE id = :t", t=s["tid"])[0]
        assert w["completeness"] == 30.0 and w["critical_tolerance"] == {"pct": 0.025, "rows": 10}
        assert ret["versions_days"] == 400 and ret["updated_at"]
        from api.services.scoring import scoring_config
        assert scoring_config(w)["critical_tolerance"] == {"pct": 0.025, "rows": 10.0}
        # a partial patch leaves the rest alone
        r = await client.patch("/api/v1/settings/tenant", headers=headers(), json={"retention_days": 90})
        assert r.json()["retention_days"] == 90 and r.json()["name"] == "Acme Mining" and r.json()["cap_rule"]["one_critical"] == 80.0
    rows = audit(owner, s["tid"], "tenant_settings.update")
    assert len(rows) == 2 and rows[0][3] == s["user"]
    assert rows[0][4]["name"] == s["tid"] and rows[0][5]["name"] == "Acme Mining" and rows[0][5]["retention_days"] == 400
    # the other tenant is untouched
    assert q(owner, "SELECT name, retention FROM tenants WHERE id = :t", t=other["tid"])[0] == (other["tid"], {})
    assert audit(owner, other["tid"], "tenant_settings.update") == []


@pytest.mark.anyio
async def test_patch_tenant_settings_validation_and_permission(s, owner, monkeypatch):
    client = await start(monkeypatch, s)
    weights = {"completeness": 0.3, "accuracy": 0.3, "consistency": 0.2, "timeliness": 0.1, "uniqueness": 0.1, "validity": 0.1}
    async with client:
        def patch(body, role="admin"):
            return client.patch("/api/v1/settings/tenant", headers=headers(role), json=body)
        assert (await patch({"scoring_weights": weights})).status_code == 422  # sums to 1.1
        assert (await patch({"scoring_weights": {**weights, "completeness": -0.1, "validity": 0.4}})).status_code == 422
        assert (await patch({"scoring_weights": {**weights, "completeness": 0.2}})).status_code == 200  # 1.0
        assert (await patch({"cap_rule": {"one_critical": 101, "two_plus": 70}})).status_code == 422
        assert (await patch({"cap_rule": {"one_critical": 60, "two_plus": 70}})).status_code == 422
        assert (await patch({"cap_rule": {"one_critical": 90, "two_plus": -1}})).status_code == 422
        assert (await patch({"tolerance": {"pct": 100.1, "rows": 1}})).status_code == 422
        assert (await patch({"tolerance": {"pct": -1, "rows": 1}})).status_code == 422
        assert (await patch({"tolerance": {"pct": 5, "rows": -1}})).status_code == 422
        assert (await patch({"tolerance": {"pct": 100, "rows": 0}})).status_code == 200
        assert (await patch({"currency": "zar"})).status_code == 422
        assert (await patch({"retention_days": 0})).status_code == 422
        assert (await patch({"name": "  "})).status_code == 422
        assert (await patch({"name": None})).status_code == 422
        assert (await patch({"cost_model": {"severity": {"urgent": {"per_record": 1}}}})).status_code == 422
        assert (await patch({})).status_code == 422
        assert (await patch({"colour": "red"})).status_code == 422
        assert (await patch({"name": "X"}, "viewer")).status_code == 403
        assert (await patch({"name": "X"}, "manager")).status_code == 403
    assert q(owner, "SELECT name FROM tenants WHERE id = :t", t=s["tid"])[0][0] == s["tid"]


# ── 4. PATCH /admin/api-keys/{id} ───────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_patch_api_key(s, owner, monkeypatch):
    other = seed_m2(owner)
    client = await start(monkeypatch, s)
    async with client:
        made = (await client.post("/api/v1/admin/api-keys", headers=headers(), json={
            "name": "nightly", "grants": [{"role_key": "viewer"}]}))
        assert made.status_code == 201, made.text
        key = made.json()
        url = f"/api/v1/admin/api-keys/{key['id']}"
        r = await client.patch(url, headers=headers(), json={
            "name": "nightly export", "expires_at": "2099-01-01T00:00:00Z",
            "scopes": [{"role_key": "analyst", "system_id": s["ecc"]}, {"role_key": "viewer"}]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "key" not in body and "key_hash" not in json.dumps(body) and key["key"] not in json.dumps(body)
        assert body["name"] == "nightly export" and body["key_prefix"] == key["key_prefix"]
        assert body["expires_at"].startswith("2099-01-01")
        assert sorted((g["role_key"], g["system_id"]) for g in body["grants"]) == [("analyst", s["ecc"]), ("viewer", None)]
        assert q(owner, "SELECT name FROM users WHERE id = :u", u=key["user_id"])[0][0] == "nightly export"
        # only what is sent changes; null removes the expiry
        r = await client.patch(url, headers=headers(), json={"expires_at": None})
        assert r.status_code == 200 and r.json()["expires_at"] is None and len(r.json()["grants"]) == 2
        # the secret still works as before (same digest)
        assert q(owner, "SELECT count(*) FROM api_keys WHERE id = :k", k=key["id"])[0][0] == 1
        # validation
        assert (await client.patch(url, headers=headers(), json={})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"name": ""})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"scopes": []})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"scopes": [{"role_key": "admin"}]})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"scopes": [{"role_key": "nope"}]})).status_code == 400
        assert (await client.patch(url, headers=headers(), json={"expires_at": "2001-01-01T00:00:00Z"})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"secret": "x"})).status_code == 422
        # a failed scope change leaves the grants as they were
        assert len((await client.get("/api/v1/admin/api-keys", headers=headers())).json()[0]["grants"]) == 2
        # permission
        assert (await client.patch(url, headers=headers("viewer"), json={"name": "x"})).status_code == 403
        # revoked keys are frozen
        await client.post(f"{url}/revoke", headers=headers())
        assert (await client.patch(url, headers=headers(), json={"name": "again"})).status_code == 409
    rows = audit(owner, s["tid"], "api_key.update")
    assert len(rows) == 2 and rows[0][2] == key["id"] and rows[0][4]["name"] == "nightly" and rows[0][5]["name"] == "nightly export"
    assert key["key"] not in json.dumps([rows[0][4], rows[0][5]])
    client_b = await start(monkeypatch, other)
    async with client_b:
        assert (await client_b.patch(url, headers=headers(), json={"name": "stolen"})).status_code == 404
    assert audit(owner, other["tid"], "api_key.update") == []


# ── 5. POST /field-mappings and DELETE /field-mappings/{id} ──────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_and_delete_a_field_mapping(s, owner, monkeypatch):
    other = seed_m2(owner)
    client = await start(monkeypatch, s)
    new = {"module": "material_master", "standard_field": "MARA.ZZ_CUSTOM", "standard_label": "Custom flag",
           "customer_field": "MARA.ZZFLAG", "data_type": "boolean", "is_mapped": True, "notes": "added by hand"}
    async with client:
        r = await client.post("/api/v1/field-mappings", headers=headers(), json=new)
        assert r.status_code == 201, r.text
        m = r.json()
        assert m["standard_field"] == "MARA.ZZ_CUSTOM" and m["customer_field"] == "MARA.ZZFLAG" and m["is_mapped"] is True
        assert m["data_type"] == "boolean" and m["updated_at"]
        listed = (await client.get("/api/v1/field-mappings?module=material_master&search=ZZ_CUSTOM", headers=headers())).json()
        assert [x["id"] for x in listed["mappings"]] == [m["id"]]
        # the customer field defaults to the standard one
        d = (await client.post("/api/v1/field-mappings", headers=headers(),
                               json={"module": "fi_gl", "standard_field": "SKA1.ZZ"})).json()
        assert d["customer_field"] == "SKA1.ZZ" and d["data_type"] == "string"
        # PUT still works on it
        assert (await client.put(f"/api/v1/field-mappings/{m['id']}", headers=headers(), json={"notes": "n"})).json()["notes"] == "n"
        # validation
        assert (await client.post("/api/v1/field-mappings", headers=headers(), json=new)).status_code == 409
        assert (await client.post("/api/v1/field-mappings", headers=headers(), json={**new, "standard_field": "B", "data_type": "blob"})).status_code == 400
        assert (await client.post("/api/v1/field-mappings", headers=headers(), json={"module": "x"})).status_code == 422
        assert (await client.post("/api/v1/field-mappings", headers=headers(), json={"module": " ", "standard_field": "A"})).status_code == 422
        assert (await client.post("/api/v1/field-mappings", headers=headers("viewer"), json={**new, "standard_field": "C"})).status_code == 403
        # another tenant cannot delete it, a viewer cannot, the admin can, once
        assert (await client.delete(f"/api/v1/field-mappings/{m['id']}", headers=headers("viewer"))).status_code == 403
        assert (await client.delete("/api/v1/field-mappings/not-a-uuid", headers=headers())).status_code == 400
        client_b = await start(monkeypatch, other)
        async with client_b:
            assert (await client_b.delete(f"/api/v1/field-mappings/{m['id']}", headers=headers())).status_code == 404
            # the same module and field is free in another tenant
            assert (await client_b.post("/api/v1/field-mappings", headers=headers(), json=new)).status_code == 201
        client = await start(monkeypatch, s)
    async with client:
        r = await client.delete(f"/api/v1/field-mappings/{m['id']}", headers=headers())
        assert r.status_code == 200 and r.json() == {"id": m["id"], "status": "deleted"}
        assert (await client.delete(f"/api/v1/field-mappings/{m['id']}", headers=headers())).status_code == 404
    assert q(owner, "SELECT count(*) FROM field_mappings WHERE id = :i", i=m["id"])[0][0] == 0
    created, deleted = audit(owner, s["tid"], "field_mapping.create"), audit(owner, s["tid"], "field_mapping.delete")
    assert len(created) == 2 and created[0][2] == m["id"] and created[0][5]["standard_field"] == "MARA.ZZ_CUSTOM"
    assert len(deleted) == 1 and deleted[0][2] == m["id"] and deleted[0][4]["customer_field"] == "MARA.ZZFLAG" and deleted[0][5] is None
    assert q(owner, "SELECT count(*) FROM field_mappings WHERE tenant_id = :t AND standard_field = 'MARA.ZZ_CUSTOM'", t=other["tid"])[0][0] == 1


# ── 6. DELETE /systems/{id}/reference/{name} ────────────────────────────────────────────────────────────────

def _reference(owner, s, table="REF_POSTAL", rows=None):
    q(owner, "INSERT INTO config_snapshots (id, tenant_id, system_id, module, config_table, config_data, record_count, source, synced_at) "
             "VALUES (gen_random_uuid(), :t, :s, 'reference', :tbl, CAST(:d AS jsonb), 2, 'reference', now())",
      t=s["tid"], s=s["ecc"], tbl=table, d=json.dumps(rows or [{"COUNTRY": "ZA", "POSTCODE": "0001"}, {"COUNTRY": "ZA", "POSTCODE": "0002"}]))


@pytest.mark.anyio
async def test_delete_a_reference_list(s, owner, monkeypatch):
    other = seed_m2(owner)
    _reference(owner, s)
    _reference(owner, s, "REF_BIC", [{"BIC": "ABCDZAJJXXX", "COUNTRY": "ZA"}])
    _reference(owner, other)
    client = await start(monkeypatch, s)
    async with client:
        base = f"/api/v1/systems/{s['ecc']}/reference"
        assert [x["kind"] for x in (await client.get(base, headers=headers())).json()] == ["bic", "postal-codes"]
        # a rule that names the list blocks the delete
        q(owner, "INSERT INTO rules (tenant_id, name, module, category, severity, enabled, conditions, source) "
                 "VALUES (:t, 'PC-1: postcode known', 'business_partner', 'ecc', 'high', true, CAST(:c AS jsonb), 'custom')",
          t=s["tid"], c=json.dumps({"type": "domain", "reference": "REF_POSTAL"}))
        r = await client.delete(f"{base}/postal-codes", headers=headers())
        assert r.status_code == 409 and "PC-1: postcode known" in r.json()["detail"]
        assert len((await client.get(base, headers=headers())).json()) == 2
        q(owner, "UPDATE rules SET enabled = false WHERE tenant_id = :t", t=s["tid"])
        # permission, unknown name, other tenant's system
        assert (await client.delete(f"{base}/postal-codes", headers=headers("viewer"))).status_code == 403
        assert (await client.delete(f"{base}/swift", headers=headers())).status_code == 404
        assert (await client.delete(f"/api/v1/systems/{other['ecc']}/reference/postal-codes", headers=headers())).status_code == 404
        r = await client.delete(f"{base}/postal-codes", headers=headers())
        assert r.status_code == 200 and r.json() == {"kind": "postal-codes", "system_id": s["ecc"], "status": "deleted", "records": 2}
        assert [x["kind"] for x in (await client.get(base, headers=headers())).json()] == ["bic"]
        assert (await client.delete(f"{base}/postal-codes", headers=headers())).status_code == 404
        assert (await client.delete(f"{base}/REF_BIC", headers=headers())).status_code == 200
    rows = audit(owner, s["tid"], "reference_list.delete")
    assert [r[2] for r in rows] == [f"{s['ecc']}:postal-codes", f"{s['ecc']}:bic"] and rows[0][4]["records"] == 2
    assert q(owner, "SELECT count(*) FROM config_snapshots WHERE tenant_id = :t AND source = 'reference'", t=other["tid"])[0][0] == 1


# ── 7. Schedules ────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_schedule_crud(s, owner, monkeypatch):
    client = await start(monkeypatch, s)
    async with client:
        r = await client.post("/api/v1/schedules", headers=headers(), json={
            "system_id": s["ecc"], "name": "Nightly masters", "modules": ["material_master", "business_partner"],
            "preset": "daily", "scope": {"company_codes": ["za01", "ZA02"], "plants": ["3000"], "date_from": "2026-01-01",
                                         "date_to": "2026-06-30"}, "extraction_mode": "delta"})
        assert r.status_code == 201, r.text
        sc = r.json()
        assert sc["cadence"] == {"cron": "0 2 * * *", "preset": "daily"} and sc["schedule_cron"] == "0 2 * * *"
        assert sc["system_name"] == "ECC production" and sc["modules"] == ["material_master", "business_partner"]
        assert sc["domain"] == "material_master" and sc["status"] == "active" and sc["active"] is True
        assert sc["scope"] == {"company_codes": ["ZA01", "ZA02"], "plants": ["3000"], "date_from": "2026-01-01", "date_to": "2026-06-30"}
        assert sc["extraction_mode"] == "delta" and sc["next_run_at"] and sc["last_run_at"] is None
        sid = sc["id"]
        listed = (await client.get("/api/v1/schedules", headers=headers())).json()["schedules"]
        assert [x["id"] for x in listed if x["id"] == sid] == [sid]
        assert (await client.get(f"/api/v1/schedules/{sid}", headers=headers())).json() == sc
        assert (await client.get(f"/api/v1/schedules?system_id={s['spare']}", headers=headers())).json() == {"schedules": []}
        # update: cron replaces the preset and moves next_run_at; the rest stays
        r = await client.patch(f"/api/v1/schedules/{sid}", headers=headers(), json={"cron": "30 4 * * 1", "name": "Mondays"})
        up = r.json()
        assert r.status_code == 200 and up["cadence"] == {"cron": "30 4 * * 1", "preset": None} and up["name"] == "Mondays"
        assert up["scope"] == sc["scope"] and up["modules"] == sc["modules"] and up["next_run_at"] != sc["next_run_at"]
        up = (await client.patch(f"/api/v1/schedules/{sid}", headers=headers(), json={"preset": "weekdays", "scope": {}, "modules": ["fi_gl"]})).json()
        assert up["cadence"]["preset"] == "weekdays" and up["scope"] == {} and up["modules"] == ["fi_gl"] and up["domain"] == "fi_gl"
        # pause and resume
        p = (await client.post(f"/api/v1/schedules/{sid}/pause", headers=headers())).json()
        assert p["active"] is False and p["status"] == "paused"
        assert (await client.post(f"/api/v1/schedules/{sid}/pause", headers=headers())).json()["status"] == "paused"
        q(owner, "UPDATE sync_profiles SET next_run_at = now() - interval '3 days' WHERE id = :i", i=sid)
        rs = (await client.post(f"/api/v1/schedules/{sid}/resume", headers=headers())).json()
        from datetime import datetime, timezone
        assert rs["status"] == "active"
        assert datetime.fromisoformat(rs["next_run_at"]) > datetime.now(timezone.utc)
        # manual: no cadence
        man = (await client.patch(f"/api/v1/schedules/{sid}", headers=headers(), json={"cron": None, "preset": None})).json()
        assert man["cadence"] == {"cron": None, "preset": None} and man["next_run_at"] is None
        # delete
        assert (await client.delete(f"/api/v1/schedules/{sid}", headers=headers())).json() == {"id": sid, "status": "deleted"}
        assert (await client.get(f"/api/v1/schedules/{sid}", headers=headers())).status_code == 404
        assert (await client.delete(f"/api/v1/schedules/{sid}", headers=headers())).status_code == 404
    actions = [r[0] for r in q(owner, "SELECT action FROM audit_log WHERE tenant_id = :t AND entity_type = 'schedule' ORDER BY created_at", t=s["tid"])]
    assert actions == ["schedule.create", "schedule.update", "schedule.update", "schedule.pause", "schedule.resume",
                       "schedule.update", "schedule.delete"]
    first = audit(owner, s["tid"], "schedule.create")[0]
    assert first[2] == sid and first[3] == s["user"] and first[5]["name"] == "Nightly masters"
    assert audit(owner, s["tid"], "schedule.update")[0][4]["name"] == "Nightly masters"


@pytest.mark.anyio
async def test_schedule_validation_permission_and_isolation(s, owner, monkeypatch):
    other = seed_m2(owner)
    client = await start(monkeypatch, s)
    ok = {"system_id": s["ecc"], "modules": ["material_master"], "preset": "hourly"}
    async with client:
        def post(body, role="admin"):
            return client.post("/api/v1/schedules", headers=headers(role), json=body)
        assert (await post({**ok, "cron": "0 1 * * *"})).status_code == 422  # both
        assert (await post({**ok, "preset": "fortnightly"})).status_code == 422
        assert (await post({"system_id": s["ecc"], "modules": ["material_master"], "cron": "not a cron"})).status_code == 422
        assert (await post({**ok, "modules": []})).status_code == 422
        assert (await post({**ok, "modules": ["employee_central"]})).status_code == 422  # a SuccessFactors module on ECC
        assert (await post({**ok, "scope": {"plants": ["3000; DROP"]}})).status_code == 422
        assert (await post({**ok, "scope": {"date_from": "2026-07-01", "date_to": "2026-01-01"}})).status_code == 422
        assert (await post({**ok, "scope": {"date_from": "yesterday"}})).status_code == 422
        assert (await post({**ok, "system_id": other["ecc"]})).status_code == 404  # another tenant's system
        assert (await post({**ok, "colour": "red"})).status_code == 422
        assert (await post(ok, "viewer")).status_code == 403
        made = (await post({"system_id": s["ecc"], "modules": ["material_master"]})).json()
        assert made["cadence"] == {"cron": None, "preset": None} and made["next_run_at"] is None  # manual
        url = f"/api/v1/schedules/{made['id']}"
        assert (await client.patch(url, headers=headers(), json={})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"cron": "bad"})).status_code == 422
        assert (await client.patch(url, headers=headers(), json={"modules": ["hcm_x"]})).status_code == 422
        assert (await client.patch(url, headers=headers("viewer"), json={"name": "x"})).status_code == 403
        for verb, path in (("post", "/pause"), ("post", "/resume"), ("delete", "")):
            assert (await client.request(verb, url + path, headers=headers("viewer"))).status_code == 403
        # a viewer may read
        assert (await client.get("/api/v1/schedules", headers=headers("viewer"))).status_code == 200
    client_b = await start(monkeypatch, other)
    async with client_b:
        assert (await client_b.get(url, headers=headers())).status_code == 404
        assert (await client_b.patch(url, headers=headers(), json={"name": "x"})).status_code == 404
        assert (await client_b.post(url + "/pause", headers=headers())).status_code == 404
        assert (await client_b.delete(url, headers=headers())).status_code == 404
        mine = (await client_b.get("/api/v1/schedules", headers=headers())).json()["schedules"]
        assert made["id"] not in [x["id"] for x in mine] and {x["system_id"] for x in mine} <= {other["ecc"], other["spare"]}
    assert q(owner, "SELECT count(*) FROM sync_profiles WHERE id = :i", i=made["id"])[0][0] == 1


@pytest.mark.anyio
async def test_both_schedule_routes_are_one_service(s, owner, monkeypatch):
    client = await start(monkeypatch, s)
    async with client:
        legacy = await client.post(f"/api/v1/systems/{s['spare']}/profiles", headers=headers(), json={
            "system_id": s["spare"], "domain": "material_master", "tables": ["MARA"], "schedule_cron": "0 3 * * *",
            "active": True, "extraction_mode": "full"})
        assert legacy.status_code == 200, legacy.text
        lp = legacy.json()
        # the older route keeps its shape, and its first run is left to the beat task
        assert set(lp) == {"id", "system_id", "domain", "tables", "schedule_cron", "active", "last_run_at", "next_run_at", "extraction_mode"}
        assert lp["next_run_at"] is None and lp["tables"] == ["MARA"]
        seen = (await client.get(f"/api/v1/schedules?system_id={s['spare']}", headers=headers())).json()["schedules"]
        assert [x["id"] for x in seen] == [lp["id"]] and seen[0]["modules"] == ["material_master"] and seen[0]["tables"] == ["MARA"]
        # a change through the new route shows in the old list; a change through the old route shows in the new one
        await client.post(f"/api/v1/schedules/{lp['id']}/pause", headers=headers())
        assert (await client.get(f"/api/v1/systems/{s['spare']}/profiles", headers=headers())).json()[0]["active"] is False
        up = await client.patch(f"/api/v1/systems/{s['spare']}/profiles/{lp['id']}", headers=headers(), json={"schedule_cron": "0 5 * * *", "active": True})
        assert up.status_code == 200 and up.json()["schedule_cron"] == "0 5 * * *" and up.json()["next_run_at"]
        assert (await client.get(f"/api/v1/schedules/{lp['id']}", headers=headers())).json()["cadence"]["cron"] == "0 5 * * *"
        assert (await client.patch(f"/api/v1/systems/{s['spare']}/profiles/{lp['id']}", headers=headers(), json={"schedule_cron": "x y"})).status_code == 422
        assert (await client.patch(f"/api/v1/systems/{s['spare']}/profiles/{lp['id']}", headers=headers(), json={})).status_code == 422
        assert (await client.patch(f"/api/v1/systems/{s['ecc']}/profiles/{lp['id']}", headers=headers(), json={"active": False})).status_code == 404
        assert (await client.delete(f"/api/v1/systems/{s['spare']}/profiles/{lp['id']}", headers=headers())).status_code == 204
        assert (await client.get(f"/api/v1/schedules/{lp['id']}", headers=headers())).status_code == 404
        # a schedule made by the new route is deleted by the old one
        mine = (await client.post("/api/v1/schedules", headers=headers(), json={"system_id": s["spare"], "modules": ["fi_gl"], "preset": "weekly"})).json()
        assert (await client.delete(f"/api/v1/systems/{s['spare']}/profiles/{mine['id']}", headers=headers())).status_code == 204


@pytest.mark.anyio
async def test_a_scheduled_run_extracts_its_modules_and_scope(s, owner, monkeypatch):
    """The beat task starts run_sync(profile); run_sync reads the profile's modules and scope for the extraction."""
    import inspect

    from workers.tasks import run_sync
    src = inspect.getsource(run_sync)
    assert "sp.modules, sp.scope" in src and "scope=scope" in src and "modules = list(profile_row[5] or []) or [domain]" in src


# ── 8. GET /support/diagnostics ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_support_diagnostics(s, owner, monkeypatch, redis):
    from api.routes import support
    from api.services import jobs
    other = seed_m2(owner)
    monkeypatch.setattr(support, "_ping_workers", lambda: ["celery@w1"])
    monkeypatch.setattr(support, "_ping_sync", lambda: True)
    with owner.begin() as c:
        for i in range(25):
            c.execute(text("INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, method, path, status_code, created_at, after_json) "
                           "VALUES (:t, 'server_error', 'request', :r, 'GET', '/api/v1/x', 500, now() - make_interval(mins => :i), "
                           "CAST(:a AS jsonb))"), {"t": s["tid"], "r": f"ref{i:02d}", "i": i, "a": json.dumps({"reference": f"ref{i:02d}"})})
        c.execute(text("INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, method, path, status_code) "
                       "VALUES (:t, 'server_error', 'request', 'otherref', 'GET', '/api/v1/y', 500)"), {"t": other["tid"]})
    jobs.start_job(s["tid"], "a", "extraction", "x", status="running")
    jobs.start_job(s["tid"], "b", "extraction", "x", status="queued")
    jobs.start_job(s["tid"], "c", "extraction", "x", status="running")
    jobs.finish_job(s["tid"], "c", "failed", error="boom")
    jobs.start_job(other["tid"], "z", "extraction", "x", status="running")
    client = await start(monkeypatch, s)
    async with client:
        r = await client.get("/api/v1/support/diagnostics", headers=headers())
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d) == {"generated_at", "version", "tenant_id", "licence", "health", "server_errors", "jobs"}
        assert d["tenant_id"] == s["tid"] and d["version"]
        assert set(d["licence"]) >= {"valid", "status", "expires_at"}
        assert d["health"]["database"]["status"] == "ok" and d["health"]["cache"]["status"] == "ok"
        assert d["health"]["workers"] == {"status": "ok", "count": 1}
        assert [e["reference"] for e in d["server_errors"]] == [f"ref{i:02d}" for i in range(20)]
        assert set(d["server_errors"][0]) == {"reference", "method", "path", "status_code", "at"}
        assert d["jobs"] == {"total": 3, "queued": 1, "running": 1, "completed": 0, "failed": 1, "cancelled": 0}
        # nothing secret, nothing from SAP
        blob = json.dumps(d).lower()
        for word in ("password", "secret", "token", "postgresql", "authorization"):
            assert word not in blob
        # a worker that does not answer, and a cache that is down, read as such
        monkeypatch.setattr(support, "_ping_workers", list)
        monkeypatch.setattr(support, "_ping_sync", lambda: False)
        d2 = (await client.get("/api/v1/support/diagnostics", headers=headers())).json()
        assert d2["health"]["workers"]["status"] == "fail" and d2["health"]["cache"]["status"] == "fail"
        assert (await client.get("/api/v1/support/diagnostics", headers=headers("viewer"))).status_code == 403
        assert (await client.get("/api/v1/support/diagnostics", headers=headers("manager"))).status_code == 403
    rows = audit(owner, s["tid"], "support.diagnostics")
    assert len(rows) == 2 and rows[0][3] == s["user"] and rows[0][5] == {"errors": 20, "jobs": 3}
    client_b = await start(monkeypatch, other)
    async with client_b:
        d3 = (await client_b.get("/api/v1/support/diagnostics", headers=headers())).json()
        assert [e["reference"] for e in d3["server_errors"]] == ["otherref"] and d3["jobs"]["total"] == 1


# ── 9. /me/preferences: start_screen, keyboard_hints ─────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_preferences_start_screen_and_keyboard_hints(s, owner, monkeypatch):
    other = seed_m2(owner)
    client = await start(monkeypatch, s)
    async with client:
        r = await client.patch("/api/v1/me/preferences", headers=headers(), json={"start_screen": "data_steward", "keyboard_hints": True})
        assert r.status_code == 200 and r.json() == {"start_screen": "data_steward", "keyboard_hints": True}
        assert (await client.get("/api/v1/me/preferences", headers=headers())).json() == r.json()
        # they merge with the others and a viewer-role user may set their own
        r = await client.patch("/api/v1/me/preferences", headers=headers("viewer"), json={"theme": "dark", "keyboard_hints": False})
        assert r.json() == {"start_screen": "data_steward", "keyboard_hints": False, "theme": "dark"}
        assert (await client.patch("/api/v1/me/preferences", headers=headers(), json={"start_screen": "emperor"})).status_code == 422
        assert (await client.patch("/api/v1/me/preferences", headers=headers(), json={"start_screen": ""})).status_code == 422
        assert (await client.patch("/api/v1/me/preferences", headers=headers(), json={"keyboard_hints": "yes please"})).status_code == 422
        # null removes the override
        r = await client.patch("/api/v1/me/preferences", headers=headers(), json={"start_screen": None})
        assert "start_screen" not in r.json() and r.json()["keyboard_hints"] is False
    # another tenant's user has their own document
    client_b = await start(monkeypatch, other)
    async with client_b:
        assert (await client_b.get("/api/v1/me/preferences", headers=headers())).json() == {}
