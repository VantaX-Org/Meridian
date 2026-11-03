"""Migration scenario mapping over the real shipped rule packs, and its route."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import rule_depth
from api.services import rbac
from api.services.tenant_seed import raw_rules
from checks import migration_scenarios as ms


def test_every_area_in_yaml_is_mapped():
    areas = {r["s4_area"] for *_, r in raw_rules() if r.get("s4_area")}
    assert areas and not areas - set(ms.AREAS), f"unmapped s4_area: {areas - set(ms.AREAS)}"


def test_counts_nonzero_and_sum_to_enabled():
    s = ms.summary()
    total = sum(1 for _ in ms.enabled_rules())
    assert set(s) == set(ms.SCENARIOS)
    for sc in s.values():
        assert sc["counts"]["required"] > 0 and sc["counts"]["recommended"] > 0 and sc["blocking"] > 0
        assert sum(sc["counts"].values()) == total


def test_precedence():
    blocking = {"s4_impact": "blocking", "s4_area": "archiving"}
    assert ms.classify(blocking)["system_conversion"][0] == ms.REQUIRED
    assert ms.classify(blocking)["new_implementation"][0] == ms.NOT_APPLICABLE
    hard = ms.classify({"rule_authority": "sap_hard_constraint"})
    assert {v[0] for v in hard.values()} == {ms.REQUIRED}
    assert {v[0] for v in ms.classify({"rule_authority": "best_practice"}).values()} == {ms.RECOMMENDED}
    assert ms._impact({"s4_impact": "Material master cannot be written"}) == ("warning", "Material master cannot be written")


@pytest.fixture
def client(monkeypatch):
    async def role(*a, **k):
        return "admin"

    monkeypatch.setattr(rbac, "_get_user_role", role)
    app = FastAPI()
    app.include_router(rule_depth.router)
    return TestClient(app)


def test_route(client):
    r = client.get("/api/v1/rules/migration-scenarios")
    assert r.status_code == 200
    body = r.json()
    assert len(body["scenarios"]) == 4 and body["rules"] is None
    r = client.get("/api/v1/rules/migration-scenarios", params={"scenario": "carve_out", "relevance": "not_applicable"})
    rules = r.json()["rules"]
    assert rules and all(x["relevance"] == "not_applicable" and x["rationale"] for x in rules)
    assert client.get("/api/v1/rules/migration-scenarios", params={"scenario": "x"}).status_code == 422
