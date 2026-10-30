"""PO-5: unknown object slugs and record keys answer 404 with a sentence (and X-Not-Found), not a made-up page.
PO-3: the receipt and object detail carry stable codes beside their English prose (dimension ids, the cap rule
as levels, the formula as terms, breach check ids).

Seed: tests/landscape_seed.py (material_master capped at 70 by two critical rules over tolerance).
"""
import os
from urllib.parse import quote

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


async def _get(client_for, tid: str, path: str):  # noqa: F811
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        return await client.get(path, headers=HEADERS)


@pytest.mark.anyio
@pytest.mark.parametrize("path", [
    "/api/v1/objects/nonexistent?run={run}", "/api/v1/objects/nonexistent/receipt",
    "/api/v1/objects/nonexistent/monitor", "/api/v1/objects/nonexistent/related",
    "/api/v1/objects/nonexistent/contracts", "/api/v1/objects/nonexistent/as-of?run={run}",
    "/api/v1/work/records/nonexistent/X%3D1", "/api/v1/records/nonexistent/X%3D1/links"])
async def test_an_unknown_object_is_a_404_with_a_sentence(seeded, client_for, path):  # noqa: F811
    _eng, s = seeded
    r = await _get(client_for, s["tid"], path.format(run=s["run"]))
    assert r.status_code == 404, r.text
    assert r.headers["X-Not-Found"] == "unknown_object"
    assert r.json()["detail"].startswith("There is no object 'nonexistent'.")


@pytest.mark.anyio
async def test_a_known_object_without_a_result_says_so(seeded, client_for):  # noqa: F811
    _eng, s = seeded
    r = await _get(client_for, s["tid"], "/api/v1/objects/hcm/receipt")
    assert r.status_code == 404 and "X-Not-Found" not in r.headers
    assert r.json()["detail"].endswith("has not been measured in any run yet.")


@pytest.mark.anyio
async def test_an_unknown_record_key_is_not_called_passing(seeded, client_for):  # noqa: F811
    eng, s = seeded
    key = quote("MATNR=NO-SUCH-MATERIAL", safe="")
    for path in (f"/api/v1/work/records/material_master/{key}?version_id={s['run']}",
                 f"/api/v1/records/material_master/{key}/links?run={s['run']}"):
        r = await _get(client_for, s["tid"], path)
        assert r.status_code == 404 and r.headers["X-Not-Found"] == "unknown_record"
        assert "No record with the key MATNR=NO-SUCH-MATERIAL is known in Material master" in r.json()["detail"]

    # a record Meridian has seen (delta extraction) but that fails nothing keeps the passing sentence
    with eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": s["tid"]})
        c.execute(text("INSERT INTO record_hashes (tenant_id, module, record_key, row_hash, version_id) "
                       "VALUES (:t, 'material_master', 'MATNR=CLEAN-1', 'h', :v)"), {"t": s["tid"], "v": s["run"]})
    r = await _get(client_for, s["tid"], f"/api/v1/work/records/material_master/{quote('MATNR=CLEAN-1', safe='')}"
                                         f"?version_id={s['run']}")
    assert r.status_code == 404 and "X-Not-Found" not in r.headers
    assert r.json()["detail"] == "This record does not fail any check in this run."


@pytest.mark.anyio
async def test_receipt_and_detail_carry_codes_beside_the_prose(seeded, client_for):  # noqa: F811
    _eng, s = seeded
    rec = (await _get(client_for, s["tid"], f"/api/v1/objects/material_master/receipt?run={s['run']}")).json()
    assert rec["cap_rule"].startswith("85 at one critical rule")  # prose kept
    assert rec["cap_rule_detail"] == {
        "code": "critical_cap", "critical_over_tolerance": 2, "applied_cap": 70,
        "levels": [{"min_critical_over_tolerance": 1, "cap": 85}, {"min_critical_over_tolerance": 2, "cap": 70}]}
    assert [d["dimension_id"] for d in rec["dimensions"]] == [d["key"] for d in rec["dimensions"]]
    assert [t["dimension_id"] for t in rec["formula_terms"]] == [
        "completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"]
    assert [b["check_id"] for b in rec["breaches"]] == ["MM014", "MM031"]
    det = (await _get(client_for, s["tid"], f"/api/v1/objects/material_master?run={s['run']}")).json()
    assert det["breaches"] == ["MM014", "MM031"] and det["cap_rule_detail"]["applied_cap"] == 70
