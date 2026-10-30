"""Policy packs against a real Postgres (MERIDIAN_TEST_DB_URL): the catalogue with the tenant's coverage, apply and
unapply (manage_rules, audited, materialised), the evidence per class, and ``policy_breaches`` on the landscape cell
and the receipt. Another tenant sees nothing of it."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_step10_seed import seed_run, seed_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def test_catalogue_shape():
    from api.services import policy_packs as pp

    ids = [p["id"] for p in pp.catalogue()]
    assert ids == ["gdpr", "sox", "gxp"]
    gdpr = pp.pack("gdpr")
    identity = next(c for c in gdpr["classes"] if c["id"] == "identity")
    assert {"BUT000.NAME_FIRST", "BUT000.NAME_LAST", "BUT000.BIRTHDT"} <= set(identity["fields"])
    assert "Article" in identity["authority"] and "http" not in identity["authority"]
    sox = pp.pack("sox")
    vb = next(c for c in sox["classes"] if c["id"] == "vendor_bank")
    assert "AP039" in vb["rules"] and "LFBK.BANKN" in vb["fields"]
    assert pp.class_of_field("lfbk.bankn") == [("sox", "vendor_bank")]


def test_class_evidence_maths():
    from api.services import policy_packs as pp

    c = {"id": "x", "label": "X", "authority": "A", "fields": ["T.F"], "rules": ["R1", "R2", "R3"]}
    found = [{"check_id": "R1", "module": "m", "severity": "critical", "affected_count": 4, "total_count": 200,
              "pass_rate": 98.0},
             {"check_id": "R2", "module": "m", "severity": "high", "affected_count": 0, "total_count": 200,
              "pass_rate": 100.0}]
    e = pp.class_evidence(c, found)
    assert e["rules_measured"] == 2 and e["pass_rate"] == 99.0 and e["failing_records"] == 4 and e["breached"]
    assert [r["measured"] for r in e["rules"]] == [True, True, False]


@pytest.mark.anyio
async def test_policy_packs(owner, monkeypatch):
    s = seed_tenant(owner)
    tid = s["tid"]
    run = seed_run(owner, tid, s["ecc"])
    other = seed_tenant(owner)
    seed_run(owner, other["tid"], other["ecc"])

    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/policy-packs", headers=headers("viewer"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["applied"] == 0
        sox = next(p for p in body["packs"] if p["id"] == "sox")
        assert sox["applied"] is False
        vb = next(c for c in sox["classes"] if c["id"] == "vendor_bank")
        assert vb["rules_measured"] == 2 and vb["failing_records"] == 4 and vb["breached"] is True  # AP039 4, AP018 0
        pt = next(c for c in sox["classes"] if c["id"] == "payment_terms")
        assert pt["failing_records"] == 2 and pt["breached"] is False  # AP016 is high, not critical
        assert sox["coverage"]["classes_breached"] == 1 and sox["coverage"]["failing_records"] == 6

        # not applied: no policy breach on the cell
        cell = (await client.get("/api/v1/landscape", headers=headers("viewer"))).json()["cells"][0]
        assert cell["policy_breaches"] == 0

        assert (await client.post("/api/v1/policy-packs/sox/apply", headers=headers("viewer"))).status_code == 403
        assert (await client.post("/api/v1/policy-packs/nope/apply", headers=headers())).status_code == 404
        r = await client.post("/api/v1/policy-packs/sox/apply", headers=headers("data_steward"))
        assert r.status_code == 200 and r.json() == {"id": "sox", "applied": True, "classes": 5}
        r = await client.post("/api/v1/policy-packs/sox/apply", headers=headers())  # idempotent
        assert r.status_code == 200

        cell = (await client.get("/api/v1/landscape", headers=headers("viewer"))).json()["cells"][0]
        assert cell["module"] == "accounts_payable" and cell["policy_breaches"] == 1
        rc = (await client.get("/api/v1/objects/accounts_payable/receipt", headers=headers("viewer"))).json()
        assert rc["policy_breaches"] == 1
        assert rc["policy_breach_classes"][0]["class_id"] == "vendor_bank"
        assert rc["policy_breach_classes"][0]["rules"] == ["AP039"]

        ev = (await client.get("/api/v1/policy-packs/sox/evidence", headers=headers("viewer"))).json()
        assert ev["applied"] is True and ev["scope"] == "current"
        vb = next(c for c in ev["classes"] if c["id"] == "vendor_bank")
        ap039 = next(r for r in vb["rules"] if r["check_id"] == "AP039")
        assert ap039 == {"check_id": "AP039", "measured": True, "module": "accounts_payable", "severity": "critical",
                         "pass_rate": 98.0, "failing_records": 4, "total_records": 200}
        assert vb["pass_rate"] == 99.0 and vb["authority"].startswith("SOX Section 404")
        ev_run = (await client.get(f"/api/v1/policy-packs/sox/evidence?run={run}", headers=headers("viewer"))).json()
        assert ev_run["scope"] == "run" and ev_run["coverage"] == ev["coverage"]
        assert (await client.get(f"/api/v1/policy-packs/sox/evidence?run={other['ecc']}",
                                 headers=headers())).status_code == 404

        body = (await client.get("/api/v1/policy-packs", headers=headers("viewer"))).json()
        assert body["applied"] == 1 and next(p for p in body["packs"] if p["id"] == "sox")["applied_by"]

        r = await client.post("/api/v1/policy-packs/sox/unapply", headers=headers())
        assert r.status_code == 200
        cell = (await client.get("/api/v1/landscape", headers=headers("viewer"))).json()["cells"][0]
        assert cell["policy_breaches"] == 0

        # re-apply for the isolation check below
        assert (await client.post("/api/v1/policy-packs/sox/apply", headers=headers())).status_code == 200

    # the other tenant sees nothing of this tenant's packs
    deps, client = make_client(monkeypatch, other["tid"], other["ann"])
    async with client:
        body = (await client.get("/api/v1/policy-packs", headers=headers("viewer"))).json()
        assert body["applied"] == 0
        cell = (await client.get("/api/v1/landscape", headers=headers("viewer"))).json()["cells"][0]
        assert cell["policy_breaches"] == 0

    with owner.connect() as c:
        actions = [r[0] for r in c.execute(text(
            "SELECT action FROM audit_log WHERE tenant_id = :t AND entity_type = 'policy_pack' ORDER BY created_at"),
            {"t": tid}).fetchall()]
        n = c.execute(text("SELECT count(*) FROM policy_field_classes WHERE tenant_id = :t"), {"t": tid}).scalar()
    assert actions == ["policy_pack_applied", "policy_pack_applied", "policy_pack_unapplied", "policy_pack_applied"]
    assert n == 5
