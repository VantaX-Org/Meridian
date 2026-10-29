"""Feature impact in money over time against a real Postgres (MERIDIAN_TEST_DB_URL): null without a cost model,
the monthly cost from the cost model, the cost since first blocked over the run history, and the rankings."""
from __future__ import annotations

import json
import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, text

from api.services.impact_money import DAYS_PER_MONTH, NOT_BLOCKED, blocked_streak
from tests.m2_client import headers, make_client
from tests.m2_step9_seed import RUN_AT, seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

MONTH = timedelta(days=DAYS_PER_MONTH)


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def test_streak_only_counts_the_unbroken_tail():
    t0 = RUN_AT - 3 * MONTH
    hist = [(t0, 50.0), (t0 + MONTH, NOT_BLOCKED), (t0 + 2 * MONTH, 10.0), (t0 + 3 * MONTH, 20.0)]
    first, months, cost = blocked_streak(hist, t0 + 4 * MONTH)
    assert first == t0 + 2 * MONTH and months == 2.0 and cost == 30.0
    assert blocked_streak([(t0, 10.0), (t0 + MONTH, None)], t0 + 2 * MONTH)[2] is None  # an unpriced run
    assert blocked_streak([(t0, NOT_BLOCKED)], t0 + MONTH) == (None, 0.0, None)


def _older_run(owner, s, at, blocked: dict[str, int]) -> None:
    rid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                       "(:v, :t, 'complete', :at, CAST(:m AS jsonb), CAST(:s AS jsonb))"),
                  {"v": rid, "t": s["tid"], "at": at, "m": json.dumps({"system_id": s["ecc"], "modules": ["material_master"]}),
                   "s": json.dumps({"material_master": {"composite_score": 60.0}})})
        for feature in ("Material Creation", "MRP Planning"):
            status = "blocked" if feature in blocked else "ok"
            c.execute(text("INSERT INTO config_impact_results (version_id, tenant_id, feature, system, status, "
                           "blocking_findings, total_affected_records) VALUES (:v, :t, :f, 'ecc', :st, '[]', :n)"),
                      {"v": rid, "t": s["tid"], "f": feature, "st": status, "n": blocked.get(feature, 0)})


@pytest.mark.anyio
async def test_money(owner, monkeypatch):
    s = seed_step9(owner)
    _older_run(owner, s, RUN_AT - 4 * MONTH, {})
    _older_run(owner, s, RUN_AT - 2 * MONTH, {"Material Creation": 80})
    as_of = (RUN_AT + MONTH).isoformat()
    deps, client = make_client(monkeypatch, s["tid"], s["ann"])
    await deps.engine.dispose()
    async with client:
        # no cost model: statuses and rules, no money
        r = await client.get("/api/v1/impact/money", params={"scope": "landscape", "as_of": as_of}, headers=headers())
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["cost_model"] is False and b["totals"]["opportunity_cost_per_month"] is None
        assert [(f["feature"], f["status"], f["blocking_rules"]) for f in b["features"]] == [
            ("Account Determination", "degraded", ["MM015"]), ("MRP Planning", "blocked", ["MM005"]),
            ("Material Creation", "blocked", ["MM001"])]
        assert all(f["opportunity_cost_per_month"] is None and f["cumulative_cost"] is None for f in b["features"])
        assert b["ranking"]["objects"][0]["value_unblocked_per_month"] is None

        with owner.begin() as c:
            c.execute(text("UPDATE tenants SET cost_model = CAST(:m AS jsonb) WHERE id = :t"),
                      {"t": s["tid"], "m": json.dumps({"currency": "EUR",
                                                       "features": {"Material Creation": 10, "MRP Planning": 100}})})
        r = await client.get("/api/v1/impact/money", params={"scope": "landscape", "as_of": as_of}, headers=headers())
        b = r.json()
        f = {x["feature"]: x for x in b["features"]}
        assert b["currency"] == "EUR" and b["cost_model"] is True
        mc = f["Material Creation"]
        # 100 records x 10 a month; blocked since two months before the run: 80 x 10 x 2 + 100 x 10 x 1
        assert mc["opportunity_cost_per_month"] == 1000.0 and mc["months_blocked"] == 3.0
        assert mc["first_blocked_at"] == (RUN_AT - 2 * MONTH).isoformat() and mc["cumulative_cost"] == 2600.0
        mrp = f["MRP Planning"]  # 30 x 100, blocked since this run only
        assert mrp["opportunity_cost_per_month"] == 3000.0 and mrp["cumulative_cost"] == 3000.0
        assert mrp["first_blocked_at"] == RUN_AT.isoformat()
        ad = f["Account Determination"]  # degraded and not priced
        assert ad["opportunity_cost_per_month"] is None and ad["first_blocked_at"] is None
        assert b["totals"] == {"opportunity_cost_per_month": 4000.0, "cumulative_cost": 5600.0,
                               "features_blocked": 2, "features_degraded": 1}
        assert b["ranking"]["objects"] == [{"id": "material_master", "name": "material_master",
                                            "value_unblocked_per_month": 4000.0,
                                            "features": ["MRP Planning", "Material Creation"]}]
        assert b["ranking"]["waves"][0]["id"] == s["wave"] and b["ranking"]["waves"][0]["value_unblocked_per_month"] == 4000.0

        # the wave and the object read the same features; another object has none
        for scope, ident in (("wave", s["wave"]), ("object", "material_master")):
            r = await client.get("/api/v1/impact/money", params={"scope": scope, "id": ident, "as_of": as_of}, headers=headers())
            assert r.json()["totals"]["opportunity_cost_per_month"] == 4000.0 and r.json()["ranking"]["waves"] == []
        r = await client.get("/api/v1/impact/money", params={"scope": "object", "id": "fi_gl"}, headers=headers())
        assert r.json()["features"] == [] and r.json()["totals"]["opportunity_cost_per_month"] == 0
        assert (await client.get("/api/v1/impact/money", params={"scope": "wave"}, headers=headers())).status_code == 422
        r = await client.get("/api/v1/impact/money", params={"scope": "wave", "id": str(uuid.uuid4())}, headers=headers())
        assert r.status_code == 404
