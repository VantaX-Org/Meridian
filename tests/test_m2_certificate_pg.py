"""Readiness certificates against a real Postgres (MERIDIAN_TEST_DB_URL): the gate, who may issue and sign, the
content hash, the PDF in the report history, versions and the audit trail."""
from __future__ import annotations

import json
import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step9_seed import RUN_AT, seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

CLEAN = (("MM001", "critical", "validity", 0), ("MM005", "critical", "accuracy", 0),
         ("MM015", "low", "completeness", 50), ("MM200", "medium", "completeness", 0))


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def no_object_store(monkeypatch):
    from api.services import storage

    def down(*_a, **_k):
        raise ConnectionError("object store unreachable in tests")
    monkeypatch.setattr(storage, "upload_file", down)


async def as_user(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


@pytest.mark.anyio
async def test_gate_refuses_a_critical_over_tolerance(owner, monkeypatch):
    s = seed_step9(owner)
    async with await as_user(monkeypatch, s["tid"], s["ann"]) as client:
        r = await client.post(f"/api/v1/migration/waves/{s['wave']}/certificate", headers=headers("programme_lead"))
        assert r.status_code == 409
        assert r.json()["detail"]["objects"] == [{"module": "material_master", "reason": "critical over tolerance",
                                                  "rules": ["MM001", "MM005"]}]
        # F18: the reasons as a list the certificate inspector shows, each with its links
        reasons = r.json()["detail"]["reasons"]
        assert r.json()["detail"]["detail"] == "The wave is not ready to certify."
        assert reasons == [{"module": "material_master", "label": reasons[0]["label"], "reason": "critical over tolerance",
                            "sentence": f"{reasons[0]['label']}: critical over tolerance (MM001, MM005)",
                            "rules": [{"check_id": "MM001", "href": "/r/MM001"}, {"check_id": "MM005", "href": "/r/MM005"}],
                            "href": "/o/_/material-master"}]
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM wave_certificates WHERE tenant_id = :t"), {"t": s["tid"]}).scalar() == 0


@pytest.mark.anyio
async def test_issue_sign_and_list(owner, monkeypatch):
    from api.services.readiness_certificate import content_hash

    s = seed_step9(owner, findings=CLEAN)
    tid, wave = s["tid"], s["wave"]
    with owner.begin() as c:
        iid = c.execute(text(
            "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, resolution, "
            "resolved_at, first_seen_version, last_seen_version) VALUES (:t, :s, 'material_master', 'MM015', 'MATNR=1', "
            "'low', 'accepted', 'accepted_risk', :at, :v, :v) RETURNING id"),
            {"t": tid, "s": s["ecc"], "at": RUN_AT, "v": s["run"]}).scalar()
        c.execute(text("INSERT INTO record_issue_events (tenant_id, issue_id, user_label, action, to_value, note, created_at) "
                       "VALUES (:t, :i, 'cara@example.com', 'status', 'accepted', 'Known', :at)"),
                  {"t": tid, "i": iid, "at": RUN_AT})
        cid = c.execute(text("INSERT INTO contracts (tenant_id, name, producer, consumer, status, quality_contract) "
                             "VALUES (:t, 'MM to S/4', 'SAP material_master', 'S/4 load', 'active', "
                             "'{\"min_dqs\": 80}') RETURNING id"), {"t": tid}).scalar()
        c.execute(text("INSERT INTO contract_compliance_history (tenant_id, contract_id, version_id, overall_compliant) "
                       "VALUES (:t, :c, :v, true)"), {"t": tid, "c": cid, "v": s["run"]})
    base = f"/api/v1/migration/waves/{wave}/certificate"

    # a viewer who owns nothing, and a steward who is not the owner, may not issue
    async with await as_user(monkeypatch, tid, s["dan"]) as client:
        assert (await client.post(base, headers=headers("viewer"))).status_code == 403
    async with await as_user(monkeypatch, tid, s["bob"]) as client:
        assert (await client.post(base, headers=headers("steward"))).status_code == 403

    # the lead issues version 1
    async with await as_user(monkeypatch, tid, s["ann"]) as client:
        r = await client.post(base, headers=headers("programme_lead"))
        assert r.status_code == 201, r.text
        v1 = r.json()
        assert v1["version"] == 1 and v1["status"] == "issued"
        assert v1["measured_on"][0]["run_id"] == s["run"]
        assert v1["required_signers"] == [{"user_id": s["cara"], "name": "Cara Owner", "modules": ["material_master"]}]
    # the owner who must sign is told (inbox), once per certificate
    with owner.connect() as c:
        told = c.execute(text("SELECT user_id::text, title, link FROM notifications WHERE tenant_id = :t AND "
                              "title LIKE 'Readiness certificate%'"), {"t": tid}).fetchall()
    assert told == [(s["cara"], "Readiness certificate of Wave 1 v1 waits for your signature",
                     f"/?view=waves&open=certificate:{wave}")]
    async with await as_user(monkeypatch, tid, s["ann"]) as client:
        pdf = await client.get(f"{base}/{v1['id']}/pdf", headers=headers("programme_lead"))
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    # the owner issues version 2
    async with await as_user(monkeypatch, tid, s["cara"]) as client:
        r = await client.post(base, headers=headers("approver"))
        assert r.status_code == 201 and r.json()["version"] == 2
        v2 = r.json()

    with owner.connect() as c:
        row = c.execute(text("SELECT content, content_sha256, report_file_id FROM wave_certificates WHERE id = :i"),
                        {"i": v1["id"]}).fetchone()
        content, sha, fid = row
        f = c.execute(text("SELECT kind, format, content, params FROM report_files WHERE id = :f"), {"f": fid}).fetchone()
    assert sha == v1["sha256"] == content_hash(content) and len(sha) == 64
    assert content["certificate_id"] == v1["id"] and content["wave"]["name"] == "Wave 1"
    obj = content["objects"][0]
    assert (obj["module"], obj["shown"], obj["measured"], obj["cap_level"], obj["breaches"]) == \
        ("material_master", 99.31, 99.31, None, [])  # (98.333*.25 + 100*.25 + 100*.10) / .60, no cap
    assert content["exceptions"] == [{"module": "material_master", "check_id": "MM015", "resolution": "accepted_risk",
                                      "approver": "cara@example.com", "records": 1,
                                      "approved_at": RUN_AT.isoformat()}]
    assert content["contracts"][0]["name"] == "MM to S/4" and content["contracts"][0]["compliant"] is True
    assert f[0] == "readiness_certificate" and f[1] == "pdf" and bytes(f[2]).startswith(b"%PDF")
    assert f[3]["certificate_id"] == v1["id"]

    # signing: a non-owner may not, the owner may once, and the certificate is then signed
    sign = f"{base}/{v2['id']}/sign"
    async with await as_user(monkeypatch, tid, s["dan"]) as client:
        assert (await client.post(sign, json={}, headers=headers("viewer"))).status_code == 403
    async with await as_user(monkeypatch, tid, s["cara"]) as client:
        r = await client.post(sign, json={"statement": "Ready for mock 2."}, headers=headers("approver"))
        assert r.status_code == 200 and r.json()["status"] == "signed" and r.json()["waiting_for"] == []
        assert (await client.post(sign, json={}, headers=headers("approver"))).status_code == 409
        listed = (await client.get(base, headers=headers("approver"))).json()
    assert [v["version"] for v in listed["versions"]] == [2, 1]
    assert listed["versions"][0]["status"] == "signed" and listed["versions"][1]["status"] == "issued"
    sig = listed["versions"][0]["signatures"][0]
    assert sig["user_id"] == s["cara"] and sig["statement"] == "Ready for mock 2." and sig["signed_at"]

    with owner.connect() as c:
        actions = [r[0] for r in c.execute(text(
            "SELECT action FROM audit_log WHERE tenant_id = :t AND entity_type = 'wave_certificate' ORDER BY created_at"),
            {"t": tid}).fetchall()]
        after = c.execute(text("SELECT after_json FROM audit_log WHERE tenant_id = :t AND action = 'certificate_signed'"),
                          {"t": tid}).scalar()
    assert actions.count("certificate_issued") == 2 and actions.count("certificate_signed") == 1
    assert after["sha256"] == v2["sha256"] and json.dumps(after)

    # another tenant sees nothing of this wave
    other = seed_step9(owner)
    async with await as_user(monkeypatch, other["tid"], other["ann"]) as client:
        assert (await client.get(base, headers=headers("programme_lead"))).status_code == 404
