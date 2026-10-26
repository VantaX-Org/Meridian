"""Risk, ROI and config-impact amounts are priced from the tenant's cost model, in its currency.

The defaults (checks/cost_model.yaml) are the rand figures Meridian shipped with; a tenant's
``tenants.cost_model`` (PUT /api/v1/settings/cost-model) overlays them, and every money payload
names the tenant currency.
"""
import os
import uuid

import pytest

from api.models.config_intelligence import ConfigElement
from api.services.config_intelligence.alignment_validator import AlignmentValidator
from checks import cost


def test_defaults_are_the_shipped_rand_values() -> None:
    model = cost.effective(None)
    assert model["currency"] == "ZAR"
    assert model["subscription_monthly"] is None
    assert model["impact"]["warranty_miss"] == {"unit_cost": 35000, "factor": 1, "mitigation": 0.6}
    assert model["impact"]["labour_displacement"]["unit_cost"] * model["impact"]["labour_displacement"]["factor"] \
        == 450 * 0.25 * 12
    assert set(model["impact"]) == set(cost.IMPACT_TYPES)
    assert model["config_alignment"]["number_range_exhaustion"] == 100000
    assert model["config_alignment"]["ghost_config"] == 500


def test_tenant_overlay_merges_impact_fields_and_keeps_subscription() -> None:
    model = cost.effective({"currency": "USD", "impact": {"warranty_miss": {"unit_cost": 10}},
                            "config_alignment": {"ghost_config": 7}, "subscription_monthly": 99})
    assert model["currency"] == "USD"
    assert model["impact"]["warranty_miss"] == {"unit_cost": 10, "factor": 1, "mitigation": 0.6}
    assert model["config_alignment"]["ghost_config"] == 7
    assert model["config_alignment"]["org_gap_plant_purch"] == 50000
    assert model["subscription_monthly"] == 99.0


def test_validate_impact() -> None:
    assert cost.validate_impact("warranty_miss", {"unit_cost": 1, "factor": 2, "mitigation": 0.5}) is None
    assert cost.validate_impact("bogus", {"unit_cost": 1}) is not None
    assert cost.validate_impact("warranty_miss", {"unit_cost": -1}) is not None
    assert cost.validate_impact("warranty_miss", {"mitigation": 1.5}) is not None
    assert cost.validate_impact("warranty_miss", {"price": 1}) is not None


def test_alignment_findings_price_from_the_tenant_model() -> None:
    plants = [ConfigElement(module="MM", element_type="plant", element_value="1000", transaction_count=5)]
    [default] = AlignmentValidator()._check_org_structure_gaps(plants)
    assert default.estimated_impact_zar == 50000
    [own] = AlignmentValidator({"config_alignment": {"org_gap_plant_purch": 1234}})._check_org_structure_gaps(plants)
    assert own.estimated_impact_zar == 1234


# ── API: the tenant's model drives the payloads ────────────────────────────

requires_db = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pytest.fixture
def tenant_row():
    from sqlalchemy import create_engine, text
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
    yield t
    with engine.begin() as conn:
        for table in ("config_alignment_findings", "config_health_scores", "config_process_steps",
                      "config_processes", "config_inventory"):
            try:
                with conn.begin_nested():
                    conn.execute(text(f"DELETE FROM {table} WHERE tenant_id = :id"), {"id": t})
            except Exception:
                pass
        conn.execute(text("DELETE FROM tenants WHERE id = :id"), {"id": t})


def _patch_tenant(monkeypatch, tenant_id: str) -> None:
    from api.deps import Tenant, get_tenant
    from api.main import app
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr(
        "api.middleware.local_auth.decode_access_token",
        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"},
    )
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tenant_id), "T", []))


@requires_db
@pytest.mark.anyio
async def test_tenant_currency_and_subscription_flow_to_roi_and_config_responses(tenant_row, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from api import deps as api_deps
    from api.main import app

    _patch_tenant(monkeypatch, tenant_row)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # defaults: rand, no subscription
        r = await client.get("/api/v1/analytics/impact", headers=headers)
        assert r.status_code == 200 and r.json()["roi"]["currency"] == "ZAR"
        assert r.json()["roi"]["subscription_annual"] is None

        bad = await client.put("/api/v1/settings/cost-model", headers=headers,
                               json={"impact": {"not_a_type": {"unit_cost": 1}}})
        assert bad.status_code == 422
        bad = await client.put("/api/v1/settings/cost-model", headers=headers,
                               json={"config_alignment": {"not_a_type": 1}})
        assert bad.status_code == 422

        r = await client.put("/api/v1/settings/cost-model", headers=headers, json={
            "currency": "EUR", "subscription_monthly": 2000,
            "impact": {"warranty_miss": {"unit_cost": 900}}, "config_alignment": {"ghost_config": 3},
        })
        assert r.status_code == 200, r.text
        eff = (await client.get("/api/v1/settings/cost-model", headers=headers)).json()["effective"]
        assert eff["currency"] == "EUR" and eff["subscription_monthly"] == 2000
        assert eff["impact"]["warranty_miss"] == {"unit_cost": 900, "factor": 1, "mitigation": 0.6}
        assert eff["config_alignment"]["ghost_config"] == 3

        r = await client.get("/api/v1/analytics/impact", headers=headers)
        roi = r.json()["roi"]
        assert roi["currency"] == "EUR" and roi["subscription_annual"] == 24000.0

        r = await client.get("/api/v1/analytics/roi", headers=headers)
        assert r.status_code == 200 and r.json()["roi"]["currency"] == "EUR"

        r = await client.post("/api/v1/config/discover", headers=headers, json={"records": []})
        assert r.status_code == 200, r.text
        assert r.json()["summary"]["currency"] == "EUR"
        r = await client.get("/api/v1/config/alignment", headers=headers, params={"run_id": r.json()["run_id"]})
        assert r.status_code == 200, r.text
        assert r.json()["currency"] == "EUR"
