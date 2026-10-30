"""PC-2 and PC-3 payloads: the measured score beside the capped one (and ranking by it), and where the money's
cost model comes from (the tenant's own, or the shipped defaults).

Seed: tests/landscape_seed.py (material_master held at 70.0 with 71.8 measured; fi_gl 92.5 uncapped).
"""
import json
import os

import pytest
from sqlalchemy import create_engine, text

from tests.landscape_seed import seed
from tests.test_landscape_pg import HEADERS, client_for  # noqa: F401 - the fixture

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture
def seeded():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng, seed(eng)
    eng.dispose()


async def _get(client_for, tid: str, path: str) -> dict:  # noqa: F811
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        r = await client.get(path, headers=HEADERS)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.anyio
async def test_objects_rank_by_measured_score_beside_the_capped_one(seeded, client_for):  # noqa: F811
    _eng, s = seeded
    body = await _get(client_for, s["tid"], f"/api/v1/objects?run={s['run']}")
    assert body["sort"] == "-measured"
    assert [(o["module"], o["composite_score"], o["measured_score"]) for o in body["objects"]] == [
        ("fi_gl", 92.5, 92.5), ("material_master", 70.0, 71.8)]
    asc = await _get(client_for, s["tid"], f"/api/v1/objects?run={s['run']}&sort=measured")
    assert [o["module"] for o in asc["objects"]] == ["material_master", "fi_gl"]
    detail = await _get(client_for, s["tid"], f"/api/v1/objects/material_master?run={s['run']}")
    assert detail["measured_score"] == 71.8 and detail["composite_score"] == 70.0


@pytest.mark.anyio
async def test_landscape_cells_carry_measured_and_sort_by_it(seeded, client_for):  # noqa: F811
    _eng, s = seeded
    body = await _get(client_for, s["tid"], "/api/v1/landscape")
    assert body["sort"] == "position"
    cells = {c["module"]: c for c in body["cells"]}
    assert cells["material_master"]["measured_score"] == 71.8 and cells["material_master"]["score"] == 70.0
    ranked = await _get(client_for, s["tid"], "/api/v1/landscape?sort=-measured")
    assert [c["module"] for c in ranked["cells"]] == ["fi_gl", "material_master"]


@pytest.mark.anyio
async def test_money_says_whether_the_cost_model_is_the_default(seeded, client_for):  # noqa: F811
    eng, s = seeded
    land = await _get(client_for, s["tid"], "/api/v1/landscape")
    assert land["cost_model"]["source"] == "default" and land["cost_model"]["is_default"] is True
    assert land["status_strip"]["cost_model_source"] == "default"  # what the status strip and money cells read
    receipt = await _get(client_for, s["tid"], f"/api/v1/objects/material_master/receipt?run={s['run']}")
    assert receipt["cost_model"] == {"source": "default", "is_default": True, "currency": receipt["currency"]}
    assert receipt["cost_model_source"] == "default"
    work = await _get(client_for, s["tid"], f"/api/v1/work/records?version_id={s['run']}")
    assert work["cost_model"]["is_default"] is True

    with eng.begin() as c:
        c.execute(text("UPDATE tenants SET cost_model = CAST(:m AS jsonb) WHERE id = :t"),
                  {"m": json.dumps({"currency": "EUR"}), "t": s["tid"]})
    from api.middleware import cache
    cache._memo.clear()
    receipt = await _get(client_for, s["tid"], f"/api/v1/objects/material_master/receipt?run={s['run']}")
    assert receipt["cost_model"] == {"source": "tenant", "is_default": False, "currency": "EUR"}
    assert receipt["cost_model_source"] == "tenant"
    land = await _get(client_for, s["tid"], "/api/v1/landscape?sort=measured")
    assert land["cost_model"]["source"] == "tenant" and land["status_strip"]["cost_model_source"] == "tenant"
