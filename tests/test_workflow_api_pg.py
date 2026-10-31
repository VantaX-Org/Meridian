"""The workflow definitions API: list, read, create, new version, activate and validate (a dry run), with the
administrator managing and everyone else reading; and the steps waiting, decided through the generic endpoint."""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import text

from api.services.rbac import VALID_ROLES, has_permission
from tests import workflow_seed as seed
from tests.m2_client import make_client

needs_pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


def test_only_the_administrator_manages_workflows_and_every_role_reads_them():
    assert {r for r in VALID_ROLES if has_permission(r, "manage_workflows")} == {"admin", "platform_admin"}
    assert all(has_permission(r, "view") for r in VALID_ROLES)


GXP = {"steps": [
    {"name": "Four eyes", "assignee": {"rule": "role", "action": "approve"}},
    {"name": "GxP second approver", "assignee": {"rule": "role", "roles": ["programme_lead"]},
     "when": [{"fact": "policy_classes", "op": "contains", "value": "gxp"}]}]}


@pytest.fixture
def world():
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO policy_field_classes (tenant_id, pack_id, class_id, label, authority, fields) "
                       "VALUES (:t, 'gxp', 'shelf_life', 'Shelf life', 'EU GMP Annex 11', ARRAY['MARA.MHDHB'])"),
                  {"t": w["tid"]})
    yield eng, w
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


async def _call(monkeypatch, w, who, role, method, path, body=None):
    deps, client = make_client(monkeypatch, w["tid"], w[who])
    await deps.engine.dispose()
    async with client:
        return await client.request(method, f"/api/v1/workflows{path}", json=body,
                                    headers={"X-User-Role": role, "Authorization": "Bearer t"})


@needs_pg
@pytest.mark.anyio
async def test_definitions_lifecycle_and_permissions(world, monkeypatch):
    eng, w = world
    listed = await _call(monkeypatch, w, "dave", "viewer", "GET", "/definitions")
    assert listed.status_code == 200, listed.text
    defaults = {d["key"]: d for d in listed.json()["items"]}
    assert set(defaults) == {"default-fix-batch", "default-change-request"}
    assert all(d["active"] and d["version"] == 1 for d in defaults.values())

    body = {"name": "GxP materials", "object_kind": "change_request", "definition": GXP}
    for role in ("viewer", "data_owner", "data_steward", "programme_lead"):
        assert (await _call(monkeypatch, w, "dave", role, "POST", "/definitions", body)).status_code == 403, role
    bad = await _call(monkeypatch, w, "admin", "admin", "POST", "/definitions",
                      {**body, "definition": {"steps": [{"name": "X", "assignee": {"rule": "users"}}]}})
    assert bad.status_code == 422 and bad.json()["detail"]["problems"] == ["Step 1 (X) assignee: name at least one user."]

    made = await _call(monkeypatch, w, "admin", "admin", "POST", "/definitions", body)
    assert made.status_code == 200, made.text
    d1 = made.json()
    assert (d1["key"], d1["version"], d1["active"]) == ("gxp-materials", 1, False)
    dup = await _call(monkeypatch, w, "admin", "admin", "POST", "/definitions", body)
    assert dup.status_code == 409

    v2_doc = json.loads(json.dumps(GXP))
    v2_doc["steps"][1]["sla_hours"] = 24
    v2 = await _call(monkeypatch, w, "admin", "admin", "POST", f"/definitions/{d1['id']}/versions",
                     {"definition": v2_doc})
    assert v2.status_code == 200 and (v2.json()["version"], v2.json()["key"]) == (2, "gxp-materials")
    assert (await _call(monkeypatch, w, "dave", "viewer", "POST", f"/definitions/{d1['id']}/activate")).status_code == 403
    act = await _call(monkeypatch, w, "admin", "admin", "POST", f"/definitions/{v2.json()['id']}/activate")
    assert act.status_code == 200 and act.json()["active"]
    actives = [(d["key"], d["version"]) for d in (await _call(
        monkeypatch, w, "dave", "viewer", "GET", "/definitions?object_kind=change_request")).json()["items"] if d["active"]]
    assert actives == [("gxp-materials", 2)]
    read = await _call(monkeypatch, w, "dave", "viewer", "GET", f"/definitions/{d1['id']}")
    assert read.status_code == 200 and read.json()["definition"]["steps"][1]["name"] == "GxP second approver"
    with seed.tenant_conn(eng, w["tid"]) as c:
        audits = [r[0] for r in c.execute(text("SELECT action FROM audit_log WHERE tenant_id = :t "
                                               "AND entity_type = 'workflow_definition' ORDER BY created_at"),
                                          {"t": w["tid"]})]
    assert audits == ["workflow_definition.create", "workflow_definition.version", "workflow_definition.activate"]


@needs_pg
@pytest.mark.anyio
async def test_validate_is_a_dry_run_any_reader_may_ask(world, monkeypatch):
    eng, w = world
    sample = {"definition": GXP, "object_kind": "change_request", "requester_id": w["requester"],
              "facts": {"object": "material", "kind": "create"}, "payload": {"MARA.MHDHB": "30", "MARA.MATKL": "01"}}
    r = await _call(monkeypatch, w, "dave", "viewer", "POST", "/definitions/validate", sample)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["valid"] and out["facts"]["policy_classes"] == ["gxp", "gxp:shelf_life"]
    steps = {s["name"]: s for s in out["steps"]}
    assert steps["GxP second approver"]["applies"] and [a["name"] for a in steps["GxP second approver"]["assignees"]] \
        == ["Boss"]
    assert "Requester" not in [a["name"] for a in steps["Four eyes"]["assignees"]]
    plain = await _call(monkeypatch, w, "dave", "viewer", "POST", "/definitions/validate",
                        {**sample, "payload": {"MARA.MATKL": "01"}})
    assert [s["applies"] for s in plain.json()["steps"]] == [True, False]
    assert plain.json()["steps"][1]["reason"] == 'Condition not met: policy_classes contains "gxp"'
    invalid = await _call(monkeypatch, w, "dave", "viewer", "POST", "/definitions/validate",
                          {"definition": {"steps": []}})
    assert invalid.status_code == 200 and not invalid.json()["valid"] and invalid.json()["problems"]
    with seed.tenant_conn(eng, w["tid"]) as c:
        assert c.execute(text("SELECT count(*) FROM workflow_instances WHERE tenant_id = :t"), {"t": w["tid"]}).scalar() == 0
    facts = await _call(monkeypatch, w, "dave", "viewer", "GET", "/facts")
    assert "value_at_risk" in facts.json()["facts"] and "contains_any" in facts.json()["ops"]


@needs_pg
@pytest.mark.anyio
async def test_waiting_steps_are_listed_for_their_approvers_and_decided_through_the_batch(world, monkeypatch):
    eng, w = world
    tid, bid = w["tid"], str(uuid.uuid4())
    doc = {"steps": [{"name": "Four eyes", "assignee": {"rule": "role", "action": "approve"}},
                     {"name": "Material owner", "assignee": {"rule": "users", "users": [w["bob"]]}}]}
    with seed.tenant_conn(eng, tid) as c:
        c.execute(text("INSERT INTO workflow_definitions (tenant_id, key, name, object_kind, version, active, definition) "
                       "VALUES (:t, 'mat', 'Mat', 'fix_batch', 1, true, CAST(:d AS jsonb))"), {"t": tid, "d": json.dumps(doc)})
        c.execute(text("INSERT INTO remediation_batches (id, tenant_id, name, status, created_by) VALUES "
                       "(:b, :t, 'Units', 'draft', :u)"), {"b": bid, "t": tid, "u": w["requester"]})
    deps, client = make_client(monkeypatch, tid, w["alice"])
    await deps.engine.dispose()
    async with client:
        r = await client.post(f"/api/v1/remediation/batches/{bid}/approve",
                              headers={"X-User-Role": "data_owner", "Authorization": "Bearer t"})
        assert r.status_code == 200 and r.json()["status"] == "draft", r.text
    mine = await _call(monkeypatch, w, "bob", "data_owner", "GET", "/tasks")
    items = mine.json()["items"]
    assert [(t["step_name"], t["object_kind"], t["object_id"], t["may_decide"]) for t in items] == [
        ("Material owner", "fix_batch", bid, True)]
    assert (await _call(monkeypatch, w, "carol", "data_steward", "GET", "/tasks")).json()["items"] == []
    everyone = (await _call(monkeypatch, w, "carol", "data_steward", "GET", "/tasks?scope=all")).json()["items"]
    assert [t["may_decide"] for t in everyone] == [False]
    no_reason = await _call(monkeypatch, w, "bob", "data_owner", "POST", f"/tasks/{items[0]['id']}/decide",
                            {"decision": "reject"})
    assert no_reason.status_code == 422
    viewer = await _call(monkeypatch, w, "dave", "viewer", "POST", f"/tasks/{items[0]['id']}/decide",
                         {"decision": "approve"})
    assert viewer.status_code == 403
    ok = await _call(monkeypatch, w, "bob", "data_owner", "POST", f"/tasks/{items[0]['id']}/decide",
                     {"decision": "approve"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved", ok.text
    inst = await _call(monkeypatch, w, "dave", "viewer", "GET", f"/instances/{ok.json()['workflow']['instance_id']}")
    assert inst.status_code == 200 and inst.json()["status"] == "approved"
    assert [h["action"] for h in inst.json()["history"]][-1] == "approved"
