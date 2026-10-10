import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api.deps import Tenant, get_tenant
from api.main import app
from api import deps as api_deps

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def seeded():
    """Tenant 1 gets two analysis versions: v_old (no proven_cost_results, older
    run_at) and v_new (ZAR rows for late_po/grir_uom_variance/blocked_sales, plus
    a mixed-currency duplicate_payment row — currency=None, by_currency split
    between ZAR and USD, as api/services/proven_cost.py's _result produces for a
    metric spanning more than one currency — newer run_at). Tenant 2 gets nothing,
    proving isolation."""
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    v_old, v_new = str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO tenants (id, name, cost_model) VALUES (:id, :id, CAST(:cm AS jsonb))"),
            {"id": t1, "cm": json.dumps({"currency": "ZAR"})},
        )
        conn.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t2})
        conn.execute(
            text("INSERT INTO analysis_versions (id, tenant_id, status, run_at) "
                 "VALUES (:v, :t, 'complete', now() - interval '1 day')"),
            {"v": v_old, "t": t1},
        )
        conn.execute(
            text("INSERT INTO analysis_versions (id, tenant_id, status, run_at) "
                 "VALUES (:v, :t, 'complete', now())"),
            {"v": v_new, "t": t1},
        )
        rows = [
            ("late_po", 1000, "ZAR", {"ZAR": 1000}, 3, ["MM140"], []),
            ("grir_uom_variance", 500, "ZAR", {"ZAR": 500}, 2, ["MM200"], []),
            ("blocked_sales", 300, "ZAR", {"ZAR": 300}, 1, ["SD100"], []),
            ("duplicate_payment", 350, None, {"ZAR": 150, "USD": 200}, 1, ["FI050"], []),
        ]
        for metric, amount, currency, by_currency, documents, check_ids, items in rows:
            conn.execute(
                text(
                    "INSERT INTO proven_cost_results "
                    "(id, tenant_id, version_id, metric, amount, currency, by_currency, "
                    " documents, check_ids, items) "
                    "VALUES (:id, :t, :v, :metric, :amount, :currency, CAST(:bc AS jsonb), "
                    " :documents, :check_ids, CAST(:items AS jsonb))"
                ),
                {
                    "id": str(uuid.uuid4()), "t": t1, "v": v_new, "metric": metric,
                    "amount": amount, "currency": currency, "bc": json.dumps(by_currency),
                    "documents": documents, "check_ids": check_ids, "items": json.dumps(items),
                },
            )
    yield {"t1": t1, "t2": t2, "v_old": v_old, "v_new": v_new}
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM proven_cost_results WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        conn.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
    engine.dispose()


def _patch_tenant(monkeypatch, tenant_id: str):
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr(
        "api.middleware.local_auth.decode_access_token",
        lambda token, secret: {
            "sub": "00000000-0000-0000-0000-000000000002",
            "email": "dev@example.com",
            "role": "admin",
        },
    )
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )


@pytest.mark.anyio
async def test_proven_cost_excludes_other_currencies_and_orders_rows(seeded, monkeypatch):
    t1, _t2, _v_old, v_new = seeded["t1"], seeded["t2"], seeded["v_old"], seeded["v_new"]
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/insights/proven-cost?version_id={v_new}", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version_id"] == v_new
    assert body["currency"] == "ZAR"
    # duplicate_payment is a mixed-currency row (currency=None, by_currency split
    # ZAR/USD): only its ZAR share (150) counts toward the total, the USD share (200)
    # is reported in by_currency but never converted or summed.
    assert body["total"] == 1950.0
    assert [r["metric"] for r in body["rows"]] == [
        "late_po", "grir_uom_variance", "blocked_sales", "duplicate_payment",
    ]
    assert body["rows"][0]["label"] == "Late POs (lead-time / info-record defects)"
    assert body["rows"][0]["check_ids"] == ["MM140"]
    assert body["rows"][3]["currency"] is None
    assert body["rows"][3]["by_currency"] == {"ZAR": 150, "USD": 200}
    assert body["value_at_risk_total"] == 0.0


@pytest.mark.anyio
async def test_proven_cost_resolves_latest_version_with_rows(seeded, monkeypatch):
    """v_old has no proven_cost_results rows; v_new (newer run_at) does — the same
    EXISTS + latest-run_at resolution get_impact uses must pick v_new."""
    t1 = seeded["t1"]
    _patch_tenant(monkeypatch, t1)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/proven-cost", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["version_id"] == seeded["v_new"]


@pytest.mark.anyio
async def test_proven_cost_is_tenant_isolated(seeded, monkeypatch):
    t2, v_new = seeded["t2"], seeded["v_new"]
    _patch_tenant(monkeypatch, t2)
    await api_deps.engine.dispose()
    headers = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/proven-cost", headers=headers)
        assert r.status_code == 200
        assert r.json() == {"version_id": None, "currency": None, "total": 0.0, "rows": [], "value_at_risk_total": 0.0}

        r2 = await client.get(f"/api/v1/insights/proven-cost?version_id={v_new}", headers=headers)
        assert r2.status_code == 200
        assert r2.json()["rows"] == []
