"""GET /api/v1/landscape, /status and /objects/{module}/receipt against a real Postgres.

Seed: tests/landscape_seed.py (one tenant, two systems, one run with two objects). A second tenant must see none of it.
"""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine

from tests.landscape_seed import seed

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
USER = "00000000-0000-0000-0000-0000000000b7"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.fixture
def seeded(owner):
    return seed(owner)


@pytest.fixture
def client_for(monkeypatch):
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app
    from api.middleware import cache
    from api.routes import landscape
    cache._memo.clear()
    monkeypatch.setattr(cache, "get_redis", lambda: None)  # the in-process fallback of the status strip cache
    monkeypatch.setattr(landscape, "get_cached_manifest", lambda: {"expiry_date": "2027-03-31T00:00:00+00:00"})

    def make(tid):
        monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
        monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                            lambda token, secret: {"sub": USER, "email": "lead@example.com", "role": "admin"})
        monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
        monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
        return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    return make


@pytest.mark.anyio
async def test_landscape_matrix(seeded, client_for):
    s = seeded
    deps, client = client_for(s["tid"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/landscape", headers=HEADERS)
        assert r.status_code == 200, r.text
        body = r.json()

        assert body["scope"] == "current" and body["run_id"] is None
        assert body["status_strip"]["records_checked"] == 61816 + 5000
        assert body["status_strip"]["rules_measured"] == 913 + 40
        assert body["status_strip"]["scored_in_s"] == 702
        assert body["status_strip"]["cost_model"] == "ZAR"
        assert body["status_strip"]["licence_valid_to"] == "2027-03-31"
        assert body["status_strip"]["run_at"].startswith("2026-10-16T05:17:00")

        by_id = {x["id"]: x for x in body["systems"]}
        assert [x["name"] for x in body["systems"]] == ["ECC production", "Spare system"]
        ecc, spare = by_id[s["ecc"]], by_id[s["spare"]]
        assert (ecc["system_type"], ecc["version"], ecc["client"], ecc["health_status"]) == ("ecc", "ECC 6.0 EHP8", "100", "healthy")
        assert ecc["state"] == "analysed" and ecc["latest_run_id"] == s["run"] and ecc["records"] == 400662
        assert ecc["last_extracted_at"] is not None
        assert spare["state"] == "not_extracted" and spare["latest_run_id"] is None
        assert spare["records"] is None and spare["last_extracted_at"] is None

        assert body["objects"] == [{"module": "fi_gl", "label": "FI general ledger"},
                                   {"module": "material_master", "label": "Material master"}]
        # systems without a run have no cells
        assert {c["system_id"] for c in body["cells"]} == {s["ecc"]}
        cells = {c["module"]: c for c in body["cells"]}
        mm, gl = cells["material_master"], cells["fi_gl"]
        assert (mm["score"], mm["raw_score"], mm["capped"], mm["cap_level"]) == (70.0, 71.8, True, 70)
        assert mm["breaches"] == ["MM014", "MM031"] and mm["verdict"] == "no-go" and mm["run_id"] == s["run"]
        assert (mm["coverage"], mm["low_confidence"], mm["records_checked"], mm["rules_measured"]) == (0.974, False, 61816, 913)
        assert mm["open_work"] == 3  # two to_fix + one proposed; the fixed record is not open work
        assert mm["dimensions"] == {"completeness": 62.0, "accuracy": 72.0, "consistency": 70.0, "timeliness": 88.0,
                                    "uniqueness": 90.0, "validity": 65.0}
        assert (gl["score"], gl["capped"], gl["cap_level"], gl["breaches"], gl["verdict"]) == (92.5, False, None, [], "go")
        assert gl["open_work"] == 0
        assert gl["dimensions"] == {"completeness": 95.0, "accuracy": 90.0}  # unmeasured dimensions are left out

        assert body["counts"] == {"go": 1, "at_risk": 0, "no_go": 1}
        assert body["sentence"] == {"held_under_85": 1, "objects": 2, "critical_over_tolerance": 2,
                                    "release_if_fixed": ["MM014", "MM031"], "released": 1}

        # scope=run reads that one run
        r = await client.get("/api/v1/landscape", params={"scope": "run", "run": s["run"]}, headers=HEADERS)
        assert r.status_code == 200 and r.json()["scope"] == "run" and r.json()["run_id"] == s["run"]
        assert {c["module"] for c in r.json()["cells"]} == {"material_master", "fi_gl"}
        assert (await client.get("/api/v1/landscape", params={"scope": "run"}, headers=HEADERS)).status_code == 422
        assert (await client.get("/api/v1/landscape", params={"scope": "run", "run": str(uuid.uuid4())},
                                 headers=HEADERS)).status_code == 404


@pytest.mark.anyio
async def test_other_tenant_sees_nothing(seeded, owner, client_for):
    s = seeded
    other = seed(owner, with_run=False)  # its own systems, no run
    deps, client = client_for(other["tid"])
    await deps.engine.dispose()
    async with client:
        body = (await client.get("/api/v1/landscape", headers=HEADERS)).json()
        assert body["cells"] == [] and body["objects"] == []
        assert {x["id"] for x in body["systems"]} == {other["ecc"], other["spare"]}
        assert s["ecc"] not in {x["id"] for x in body["systems"]}
        assert {x["state"] for x in body["systems"]} == {"not_extracted"}
        assert body["sentence"] == {"held_under_85": 0, "objects": 0, "critical_over_tolerance": 0,
                                    "release_if_fixed": [], "released": 0}
        assert body["counts"] == {"go": 0, "at_risk": 0, "no_go": 0}
        strip = (await client.get("/api/v1/status", headers=HEADERS)).json()
        assert strip["run_at"] is None and strip["records_checked"] is None and strip["rules_measured"] is None
        # the first tenant's run, asked for by id, is not found for this tenant
        assert (await client.get("/api/v1/landscape", params={"scope": "run", "run": s["run"]}, headers=HEADERS)).status_code == 404
        assert (await client.get("/api/v1/objects/material_master/receipt", params={"run": s["run"]}, headers=HEADERS)).status_code == 404
        assert (await client.get("/api/v1/objects/material_master/receipt", headers=HEADERS)).status_code == 404


@pytest.mark.anyio
async def test_status_strip_and_cache(seeded, client_for, monkeypatch):
    from api.routes import landscape

    deps, client = client_for(seeded["tid"])
    await deps.engine.dispose()
    calls = []
    real = landscape.build_status

    async def counting(db, tenant):
        calls.append(str(tenant.id))
        return await real(db, tenant)
    monkeypatch.setattr(landscape, "build_status", counting)
    async with client:
        first = (await client.get("/api/v1/status", headers=HEADERS)).json()
        again = (await client.get("/api/v1/status", headers=HEADERS)).json()
        assert first == again and len(calls) == 1  # the second read is the cached one
        assert first["records_checked"] == 66816 and first["rules_measured"] == 953 and first["scored_in_s"] == 702
        from api.middleware import cache
        for k, (at, body) in list(cache._memo.items()):
            cache._memo[k] = (at - 31, body)
        await client.get("/api/v1/status", headers=HEADERS)
        assert len(calls) == 2  # older than 30 s: read again


@pytest.mark.anyio
async def test_receipt_arithmetic(seeded, client_for):
    s = seeded
    deps, client = client_for(s["tid"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/objects/material_master/receipt", headers=HEADERS)  # latest run when none is named
        assert r.status_code == 200, r.text
        b = r.json()
        assert (b["module"], b["label"], b["run_id"]) == ("material_master", "Material master", s["run"])
        assert b["weighted"] == b["measured"] == 71.8  # equal by construction
        assert (b["score"], b["capped"], b["cap_level"]) == (70.0, True, 70)
        assert b["weights"] == {"completeness": 0.25, "accuracy": 0.25, "consistency": 0.2, "timeliness": 0.1,
                                "uniqueness": 0.1, "validity": 0.1}
        assert b["formula"] == "DQS = 0.25 × C + 0.25 × A + 0.20 × Cs + 0.10 × T + 0.10 × U + 0.10 × V"
        assert b["severity_weights"] == {"critical": 4.0, "high": 3.0, "medium": 2.0, "low": 1.0}
        assert b["cap_rule"] == "85 at one critical rule over tolerance, 70 at two or more"
        dims = {d["key"]: d for d in b["dimensions"]}
        assert [d["key"] for d in b["dimensions"]] == ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"]
        assert dims["completeness"]["points"] == 15.5 and dims["completeness"]["weight"] == 0.25
        assert dims["completeness"]["rules_measured"] == 310 and dims["completeness"]["records_checked"] == 60000
        assert dims["validity"]["points"] == 6.5 and dims["validity"]["records_checked"] == 61816
        assert round(sum(d["points"] for d in b["dimensions"]), 1) == b["weighted"]
        assert (b["records_checked"], b["rules_measured"], b["coverage"], b["low_confidence"]) == (61816, 913, 0.974, False)
        assert b["tolerance"] == {"pct": 0.1, "rows": 25}
        assert b["breaches"] == [
            {"check_id": "MM014", "name": "Base unit of measure not valid", "failing": 3640, "pct": 5.89,
             "tolerance_rows": 25, "tolerance_pct": 0.1},
            {"check_id": "MM031", "name": "Material group missing", "failing": 1000, "pct": 1.62,
             "tolerance_rows": 25, "tolerance_pct": 0.1}]
        assert b["value_at_risk"] == 4_200_000.0 and b["currency"] == "ZAR"
        assert (b["features_blocked"], b["features_degraded"]) == (1, 1)  # Period close is another object's
        assert b["open_work"] == 3

        # only the measured dimensions are re-weighted: fi_gl has two, each worth half
        gl = (await client.get("/api/v1/objects/fi_gl/receipt", params={"run": s["run"]}, headers=HEADERS)).json()
        assert [(d["key"], d["weight"], d["points"]) for d in gl["dimensions"]] == [("completeness", 0.5, 47.5), ("accuracy", 0.5, 45.0)]
        assert gl["weighted"] == gl["measured"] == 92.5 and gl["capped"] is False and gl["cap_level"] is None
        assert gl["breaches"] == [] and gl["features_blocked"] == 0 and gl["features_degraded"] == 1

        assert (await client.get("/api/v1/objects/nope/receipt", headers=HEADERS)).status_code == 404
        assert (await client.get("/api/v1/objects/fi_gl/receipt", params={"run": "not-a-uuid"}, headers=HEADERS)).status_code == 422


def test_reweigh_unreproducible_summary():
    """A stored summary that cannot reproduce its own score: weighted null, measured = the stored raw score."""
    from api.routes.objects import reweigh
    from api.services.scoring import DEFAULT_WEIGHTS

    summary = {"dimension_scores": {"completeness": 80.0, "accuracy": 60.0}, "dimension_coverage": {"completeness": 3, "accuracy": 3},
               "raw_score": 55.0}
    shares, weighted, measured, reproduced = reweigh(summary, DEFAULT_WEIGHTS)
    assert (weighted, measured, reproduced) == (None, 55.0, False)
    assert reweigh({"raw_score": 12.5}, DEFAULT_WEIGHTS) == ({}, None, 12.5, False)  # no per-dimension values stored
    ok = {**summary, "raw_score": 70.0}  # 0.5 * 80 + 0.5 * 60
    assert reweigh(ok, DEFAULT_WEIGHTS)[1:] == (70.0, 70.0, True)
