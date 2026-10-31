"""Master data change requests end to end, over the API on Postgres with the fake RFC connector: the rule pre-check
and duplicate detection, the approval workflow, then creation in SAP (success, an E message, a release without the
create function), the export when live write-back is off, sandbox refusal, idempotent retries, a change through the
write-back path, cancel, comments, attachments and the list views."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text

from tests import workflow_seed as seed
from tests.fake_sap_create import FakeSAP
from tests.m2_client import make_client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

ROLE = {"requester": "data_steward", "alice": "data_owner", "bob": "data_owner", "dave": "viewer", "admin": "admin",
        "carol": "data_steward", "boss": "programme_lead"}
MAT = {"MARA.MTART": "FERT", "MARA.MBRSH": "M", "MARA.MEINS": "EA", "MAKT.MAKTX": "Hex bolt M8", "MAKT.SPRAS": "E",
       "MARA.BRGEW": "5", "MARA.NTGEW": "7", "MARA.GEWEI": "KG"}


@pytest.fixture
def world(monkeypatch):
    eng = seed.engine()
    w = seed.seed_tenant(eng)
    w["sys"] = str(uuid.uuid4())
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, host, client, sysnr) "
                       "VALUES (:s, :t, 'ECC', 'ecc', 'sap-host', '100', '00')"), {"s": w["sys"], "t": w["tid"]})
        c.execute(text("INSERT INTO system_credentials (id, system_id, encrypted_password) "
                       "VALUES (gen_random_uuid(), :s, 'enc')"), {"s": w["sys"]})
        c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) VALUES "
                       "(:t, 'material_master', 'MATNR=000000000000000777', CAST(:g AS jsonb), 'golden')"),
                  {"t": w["tid"], "g": '{"MAKT.MAKTX": "Hex bolt M8", "MARA.MEINS": "EA"}'})
        c.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/a', "
                       "'whsec_test_secret_123', ARRAY['*'])"), {"t": w["tid"]})
    monkeypatch.setattr("api.services.credential_store.decrypt_password", lambda t, e: "pw")
    queued: list[str] = []
    monkeypatch.setattr("api.routes.change_requests._queue",
                        lambda tenant, cr: queued.append(cr["id"]) if cr["status"] == "creating" else None)
    w["queued"] = queued
    yield eng, w
    seed.drop_tenant(eng, w["tid"])
    eng.dispose()


async def call(monkeypatch, w, who, method, path, body=None):
    deps, client = make_client(monkeypatch, w["tid"], w[who])
    await deps.engine.dispose()
    async with client:
        return await client.request(method, f"/api/v1{path}", json=body,
                                    headers={"X-User-Role": ROLE[who], "Authorization": "Bearer t"})


def live(monkeypatch, on: bool = True) -> None:
    from api.config import settings
    monkeypatch.setattr(settings, "live_writeback_enabled", on)


def fake(monkeypatch, sap: FakeSAP) -> FakeSAP:
    monkeypatch.setattr("sap.get_connector", lambda *a, **kw: sap)
    return sap


def run_worker(eng, w, cr_id):
    from workers.tasks.change_requests import process
    return process(eng, w["tid"], cr_id)


def q(eng, w, sql, **p):
    with seed.tenant_conn(eng, w["tid"]) as c:
        return c.execute(text(sql), {"t": w["tid"], **p}).fetchall()


async def submitted(monkeypatch, w, obj="material", payload=None, kind="create", key=None) -> str:
    r = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                   {"kind": kind, "object": obj, "target_system_id": w["sys"], "payload": payload or MAT,
                    "object_key": key})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    s = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/submit")
    assert s.status_code == 200, s.text
    assert s.json()["request"]["status"] == "in_approval"
    return cid


async def approve(monkeypatch, w, cid, who="alice"):
    r = await call(monkeypatch, w, who, "POST", f"/change-requests/{cid}/decide", {"decision": "approve"})
    assert r.status_code == 200, r.text
    return r.json()["request"]


@pytest.mark.anyio
async def test_draft_validate_submit_approve_and_export_when_live_is_off(world, monkeypatch):
    eng, w = world
    bad = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                     {"kind": "create", "object": "material", "payload": {"KNA1.NAME1": "x", "MARA.NOPE": "1",
                                                                          "MAKT.MAKTX": "x" * 41}})
    assert bad.status_code == 422
    assert bad.json()["detail"]["problems"] == [
        "KNA1.NAME1: not a field of a material (tables MAKT, MARA, MARC, MARM, MBEW, MVKE).",
        "MARA.NOPE: SAP has no such field.", "MAKT.MAKTX: at most 40 characters."]
    assert (await call(monkeypatch, w, "dave", "POST", "/change-requests",
                       {"kind": "create", "object": "material", "payload": MAT})).status_code == 403
    made = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                      {"kind": "create", "object": "material", "target_system_id": w["sys"], "payload": MAT})
    assert made.status_code == 200 and made.json()["status"] == "draft"
    cid = made.json()["id"]

    v = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/validate")
    assert v.status_code == 200, v.text
    pc = v.json()
    # Meridian's own rule: the net weight is above the gross weight
    assert "MM041" in [f["check_id"] for f in pc["failures"]] and pc["rules_run"] > 5
    # the master record with the same description and unit is a likely duplicate
    assert [(d["sap_object_key"], d["band"]) for d in pc["duplicates"]] == [("MATNR=000000000000000777", "auto_merge")]

    other = await call(monkeypatch, w, "carol", "PATCH", f"/change-requests/{cid}", {"payload": MAT})
    assert other.status_code == 403
    fixed = await call(monkeypatch, w, "requester", "PATCH", f"/change-requests/{cid}",
                       {"payload": {**MAT, "MARA.NTGEW": "4"}})
    assert fixed.status_code == 200 and fixed.json()["precheck"] is None

    s = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/submit")
    assert s.status_code == 200, s.text
    det = s.json()
    assert det["request"]["status"] == "in_approval" and "MM041" not in [
        f["check_id"] for f in det["request"]["precheck"]["failures"]]
    assert det["workflow"]["definition_key"] == "default-change-request"
    assert det["workflow"]["facts"]["duplicates"] == 1 and det["workflow"]["facts"]["object"] == "material"
    assert w["requester"] not in det["workflow"]["tasks"][0]["assigned_users"]
    assert (await call(monkeypatch, w, "requester", "PATCH", f"/change-requests/{cid}", {"title": "x"})).status_code == 409

    own = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/decide", {"decision": "approve"})
    assert own.status_code == 403 and own.json()["detail"] == "The requester cannot decide this step."
    assert (await call(monkeypatch, w, "dave", "POST", f"/change-requests/{cid}/decide",
                       {"decision": "approve"})).status_code == 403
    todo = (await call(monkeypatch, w, "alice", "GET", "/change-requests?view=to_approve")).json()["items"]
    assert [x["id"] for x in todo] == [cid]
    assert (await call(monkeypatch, w, "requester", "GET", "/change-requests?view=to_approve")).json()["items"] == []

    live(monkeypatch, False)
    done = await approve(monkeypatch, w, cid)
    assert (done["status"], done["delivery"], done["has_export"]) == ("approved", "export", True)
    assert "MERIDIAN_LIVE_WRITEBACK_ENABLED" in done["reason"] and w["queued"] == []
    ex = await call(monkeypatch, w, "dave", "GET", f"/change-requests/{cid}/export")  # every reader may fetch it
    assert ex.status_code == 200
    doc = ex.json()
    assert doc["format"] == "meridian.change_request.v1" and doc["reason"] == done["reason"]
    assert {"field": "MARA.MTART", "value": "FERT"} in doc["fields"] and doc["plan"]["problems"] == []

    read = (await call(monkeypatch, w, "dave", "GET", f"/change-requests/{cid}")).json()
    assert [h["action"] for h in read["history"]] == [
        "drafted", "validated", "edited", "submitted", "started", "step_waiting", "in_approval", "step_approved",
        "approved", "approved"]
    events = [r[0] for r in q(eng, w, "SELECT event FROM webhook_deliveries ORDER BY created_at")]
    assert events == ["change_request.submitted", "change_request.approved"]


@pytest.mark.anyio
async def test_live_create_success_is_idempotent(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w)
    out = await approve(monkeypatch, w, cid)
    assert out["status"] == "creating" and w["queued"] == [cid]
    sap = fake(monkeypatch, FakeSAP())
    assert run_worker(eng, w, cid) == {"status": "created"}
    read = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}")).json()["request"]
    assert read["status"] == "created" and read["sap_key"] == "MATNR=000000000000004711" and read["sap_phase"] == "committed"
    assert read["sap_result"]["messages"][0]["message"] == "ok" and read["sap_result"]["simulated"]
    assert sap.names() == ["BAPI_MATERIAL_GETINTNUMBER", "BAPI_MATERIAL_SAVEDATA", "BAPI_MATERIAL_SAVEDATA",
                           "BAPI_TRANSACTION_COMMIT"]
    # a second delivery of the task creates nothing
    assert run_worker(eng, w, cid) == {"status": "created", "skipped": True} and len(sap.names()) == 4
    titles = [r[0] for r in q(eng, w, "SELECT title FROM notifications WHERE user_id = :u", u=w["requester"])]
    assert "New material was created in SAP" in titles


@pytest.mark.anyio
async def test_an_e_message_fails_the_request_and_nothing_is_committed(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w)
    await approve(monkeypatch, w, cid)
    sap = fake(monkeypatch, FakeSAP(sim_returns={"BAPI_MATERIAL_SAVEDATA": {
        "TYPE": "E", "ID": "M3", "NUMBER": "351", "MESSAGE": "Material type FERT not defined"}}))
    assert run_worker(eng, w, cid) == {"status": "failed"}
    assert "BAPI_TRANSACTION_COMMIT" not in sap.names()
    read = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}")).json()["request"]
    assert read["status"] == "failed" and read["sap_key"] is None
    assert read["sap_result"]["simulate_messages"][0]["message"] == "Material type FERT not defined"
    # nothing reached the commit: the requester may send it again once fixed in SAP
    again = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/retry", {})
    assert again.status_code == 200 and again.json()["status"] == "creating"


@pytest.mark.anyio
async def test_a_release_without_the_create_function_ends_approved_with_the_export(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w, "customer", {"KNA1.NAME1": "North Mill Ltd", "KNA1.LAND1": "ZA"})
    await approve(monkeypatch, w, cid)
    fake(monkeypatch, FakeSAP(missing=("BAPI_BUPA_CREATE_FROM_DATA",)))
    assert run_worker(eng, w, cid) == {"status": "approved"}
    read = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}")).json()["request"]
    assert (read["status"], read["delivery"]) == ("approved", "export")
    assert "BAPI_BUPA_CREATE_FROM_DATA is not available" in read["reason"]
    doc = (await call(monkeypatch, w, "alice", "GET", f"/change-requests/{cid}/export")).json()
    assert doc["plan"]["roles"] == ["FLCU00"] and doc["reason"] == read["reason"]


@pytest.mark.anyio
async def test_customer_created_through_its_business_partner(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w, "customer", {"KNA1.NAME1": "North Mill Ltd", "KNA1.LAND1": "ZA"})
    await approve(monkeypatch, w, cid)
    fake(monkeypatch, FakeSAP())
    assert run_worker(eng, w, cid) == {"status": "created"}
    assert q(eng, w, "SELECT sap_key FROM change_requests WHERE id = :i", i=cid) == [
        ("PARTNER=0000100042|KUNNR=0000200077",)]


@pytest.mark.anyio
async def test_sandbox_mode_refuses_live_creation(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w)
    # the tenant entered the sandbox after the request was queued: the worker refuses at send time
    await approve(monkeypatch, w, cid)
    with eng.begin() as c:
        c.execute(text("UPDATE tenants SET sandbox = true WHERE id = :t"), {"t": w["tid"]})
    sap = fake(monkeypatch, FakeSAP())
    assert run_worker(eng, w, cid)["status"] == "approved" and sap.calls == []
    # and an approval while in the sandbox never goes to the worker
    cid2 = await submitted(monkeypatch, w)
    out = await approve(monkeypatch, w, cid2)
    assert out["status"] == "approved" and out["reason"].startswith("Sandbox mode is on") and cid2 not in w["queued"]
    held = q(eng, w, "SELECT kind, ref FROM skipped_deliveries WHERE channel = 'write_back' ORDER BY created_at")
    assert ("change_request", cid) in held and ("change_request", cid2) in held


@pytest.mark.anyio
async def test_an_attempt_that_reached_the_commit_is_never_sent_twice(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w)
    await approve(monkeypatch, w, cid)
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("UPDATE change_requests SET sap_phase = 'committing' WHERE id = :i"), {"i": cid})
    sap = fake(monkeypatch, FakeSAP())
    assert run_worker(eng, w, cid) == {"status": "failed"} and sap.calls == []
    refused = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/retry", {})
    assert refused.status_code == 409 and "check in SAP" in refused.json()["detail"]
    ok = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/retry", {"checked_in_sap": True})
    assert ok.status_code == 200 and ok.json()["status"] == "creating" and ok.json()["sap_phase"] is None


@pytest.mark.anyio
async def test_a_connection_failure_before_the_commit_is_retried(world, monkeypatch):
    from sap.base import SAPConnectorError
    from workers.tasks.change_requests import _Retry, process

    eng, w = world
    live(monkeypatch)
    cid = await submitted(monkeypatch, w)
    await approve(monkeypatch, w, cid)

    class Down(FakeSAP):
        def __enter__(self):
            raise SAPConnectorError("host unreachable")
    fake(monkeypatch, Down())
    with pytest.raises(_Retry):
        process(eng, w["tid"], cid, attempt=0)
    assert q(eng, w, "SELECT status FROM change_requests WHERE id = :i", i=cid) == [("creating",)]
    assert process(eng, w["tid"], cid, attempt=3)["status"] == "failed"


@pytest.mark.anyio
async def test_a_change_goes_through_the_write_back_path(world, monkeypatch):
    eng, w = world
    live(monkeypatch)
    key = "MATNR=000000000000000042|WERKS=1000"
    cid = await submitted(monkeypatch, w, payload={"MARC.PLIFZ": "12", "MARC.NFMAT": "X1"}, kind="change", key=key)
    # the generic step decision does the same as the request's own
    task = (await call(monkeypatch, w, "alice", "GET", "/workflows/tasks")).json()["items"]
    assert [t["object_id"] for t in task] == [cid]
    r = await call(monkeypatch, w, "alice", "POST", f"/workflows/tasks/{task[0]['id']}/decide", {"decision": "approve"})
    assert r.status_code == 200 and r.json()["request"]["status"] == "creating", r.text
    sap = fake(monkeypatch, FakeSAP())
    assert run_worker(eng, w, cid) == {"status": "created"}
    assert sap.names() == ["BAPI_MATERIAL_SAVEDATA", "BAPI_MATERIAL_SAVEDATA", "BAPI_TRANSACTION_COMMIT"]
    read = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}")).json()["request"]
    assert read["sap_key"] == key and read["sap_result"]["export"][0]["field"] == "MARC.NFMAT"
    assert read["has_export"] and "not sent" in read["reason"]


@pytest.mark.anyio
async def test_reject_cancel_comment_attach_and_lists(world, monkeypatch):
    eng, w = world
    cid = await submitted(monkeypatch, w)
    no_reason = await call(monkeypatch, w, "alice", "POST", f"/change-requests/{cid}/decide", {"decision": "reject"})
    assert no_reason.status_code == 422
    c = await call(monkeypatch, w, "alice", "POST", f"/change-requests/{cid}/comments", {"body": "Which plant?"})
    assert c.status_code == 200
    a = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/attachments",
                   {"filename": "spec.pdf", "content_type": "application/pdf", "size_bytes": 1024, "sha256": "a" * 64})
    assert a.status_code == 200
    rej = await call(monkeypatch, w, "alice", "POST", f"/change-requests/{cid}/decide",
                     {"decision": "reject", "comment": "Plant missing"})
    assert rej.status_code == 200 and rej.json()["request"]["status"] == "rejected"
    det = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}")).json()
    assert det["comments"][0]["body"] == "Which plant?" and det["attachments"][0]["filename"] == "spec.pdf"
    assert det["workflow"]["status"] == "rejected" and det["workflow"]["tasks"][0]["comment"] == "Plant missing"
    titles = [r[0] for r in q(eng, w, "SELECT title FROM notifications WHERE user_id = :u", u=w["requester"])]
    assert "Comment on New material" in titles and "New material was rejected" in titles

    cid2 = await submitted(monkeypatch, w)
    assert (await call(monkeypatch, w, "carol", "POST", f"/change-requests/{cid2}/cancel", {})).status_code == 403
    can = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid2}/cancel", {"reason": "Duplicate"})
    assert can.status_code == 200 and can.json()["status"] == "cancelled"
    assert q(eng, w, "SELECT status FROM workflow_instances WHERE object_id = :i", i=cid2) == [("cancelled",)]
    again = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid2}/cancel", {})
    assert again.status_code == 409

    mine = (await call(monkeypatch, w, "requester", "GET", "/change-requests")).json()["items"]
    assert {x["id"] for x in mine} == {cid, cid2}
    assert (await call(monkeypatch, w, "carol", "GET", "/change-requests")).json()["items"] == []
    every = (await call(monkeypatch, w, "carol", "GET", "/change-requests?view=all&status=cancelled")).json()["items"]
    assert [x["id"] for x in every] == [cid2]


@pytest.mark.anyio
async def test_who_may_propose_read_and_decide(world, monkeypatch):
    """mdm.write proposes, mdm.read reads, approve decides (and the engine then checks the step's approvers)."""
    from api.services.rbac import has_permission

    eng, w = world
    body = {"kind": "create", "object": "material", "payload": MAT}
    for role in ("viewer", "data_owner", "analyst", "auditor", "data_steward", "programme_lead", "platform_admin"):
        ROLE["dave"] = role
        try:
            r = await call(monkeypatch, w, "dave", "POST", "/change-requests", body)
            assert (r.status_code == 200) is has_permission(role, "mdm.write"), (role, r.status_code)
            assert (await call(monkeypatch, w, "dave", "GET", "/change-requests?view=all")).status_code == 200, role
        finally:
            ROLE["dave"] = "viewer"
    assert not has_permission("analyst", "approve") and has_permission("data_owner", "approve")
