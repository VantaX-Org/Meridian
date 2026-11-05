"""Route to steward from the entry gate, over the API on Postgres (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import text

from api.services import dq_firewall as fw
from tests import workflow_seed as seed
from tests.m2_client import make_client

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

GOOD = {"MARA.MTART": "FERT", "MARA.MBRSH": "M", "MARA.MEINS": "EA", "MAKT.MAKTX": "Hex bolt M8", "MAKT.SPRAS": "E",
        "MARA.BRGEW": "5", "MARA.NTGEW": "4", "MARA.GEWEI": "KG"}
BAD = {**GOOD, "MARA.MTART": "", "MAKT.MAKTX": "ZZZ-NOT-LOGGED"}  # a critical failure: blocked
WARN = {**GOOD, "MARA.NTGEW": "7"}  # net above gross: a pass with a failure
HEAD = {"X-User-Role": "data_steward", "Authorization": "Bearer t"}


def _world(eng):
    w = seed.seed_tenant(eng)
    with eng.begin() as c:
        c.execute(text("UPDATE tenants SET jwt_secret = :s WHERE id = :t"), {"s": "k" * 32, "t": w["tid"]})
    return w


@pytest.fixture
def worlds():
    eng = seed.engine()
    a, b = _world(eng), _world(eng)
    yield eng, a, b
    seed.drop_tenant(eng, a["tid"])
    seed.drop_tenant(eng, b["tid"])
    eng.dispose()


async def validate(monkeypatch, w, module, records, route=True):
    deps, client = make_client(monkeypatch, w["tid"], w["requester"])
    await deps.engine.dispose()
    async with client:
        return await client.post("/api/v1/dq-firewall/validate", headers=HEAD,
                                 json={"module": module, "records": records, "route_to_steward": route})


async def summary(monkeypatch, w):
    deps, client = make_client(monkeypatch, w["tid"], w["requester"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/dq-firewall/summary", headers=HEAD)
    assert r.status_code == 200, r.text
    return r.json()


def count(eng, w):
    with seed.tenant_conn(eng, w["tid"]) as c:
        return c.execute(text("SELECT count(*) FROM change_requests WHERE tenant_id = :t "
                              "AND entry_fingerprint IS NOT NULL"), {"t": w["tid"]}).scalar()


@pytest.mark.anyio
async def test_clean_pass_opens_nothing(monkeypatch, worlds):
    eng, a, _ = worlds
    r = await validate(monkeypatch, a, "material_master", [GOOD])
    assert r.status_code == 200, r.text
    assert r.json()["records"][0].get("steward_request") is None
    assert count(eng, a) == 0


@pytest.mark.anyio
async def test_off_by_default(monkeypatch, worlds):
    eng, a, _ = worlds
    r = await validate(monkeypatch, a, "material_master", [BAD], route=False)
    assert r.status_code == 200
    assert r.json()["records"][0].get("steward_request") is None
    assert count(eng, a) == 0


@pytest.mark.anyio
async def test_block_opens_one_and_is_idempotent(monkeypatch, worlds):
    eng, a, _ = worlds
    r1 = await validate(monkeypatch, a, "material_master", [BAD])
    assert r1.status_code == 200, r1.text
    sr = r1.json()["records"][0]["steward_request"]
    assert sr["request_id"] and not sr.get("existing"), sr
    assert sr["status"] in ("in_approval", "submitted")
    r2 = await validate(monkeypatch, a, "material_master", [BAD])
    sr2 = r2.json()["records"][0]["steward_request"]
    assert sr2["request_id"] == sr["request_id"] and sr2["existing"] is True
    assert count(eng, a) == 1
    with seed.tenant_conn(eng, a["tid"]) as c:
        # The request body is kept by the generic audit middleware for every POST; the gate's own rows must hold none.
        audit = c.execute(text("SELECT coalesce(string_agg(coalesce(after_json::text, '') || action, ' '), '') FROM audit_log "
                               "WHERE tenant_id = :t"), {"t": a["tid"]}).scalar()
    assert "ZZZ-NOT-LOGGED" not in audit
    s = await summary(monkeypatch, a)
    assert [x["id"] for x in s["requests"]] == [sr["request_id"]]


@pytest.mark.anyio
async def test_other_content_is_a_new_request(monkeypatch, worlds):
    eng, a, _ = worlds
    await validate(monkeypatch, a, "material_master", [BAD])
    await validate(monkeypatch, a, "material_master", [{**BAD, "MAKT.MAKTX": "Hex bolt M10"}])
    await validate(monkeypatch, a, "material_master", [WARN])
    assert count(eng, a) == 3


@pytest.mark.anyio
async def test_tenant_isolation(monkeypatch, worlds):
    eng, a, b = worlds
    ra = await validate(monkeypatch, a, "material_master", [BAD])
    rb = await validate(monkeypatch, b, "material_master", [BAD])
    ia = ra.json()["records"][0]["steward_request"]
    ib = rb.json()["records"][0]["steward_request"]
    assert ia["request_id"] != ib["request_id"] and not ib.get("existing")
    assert count(eng, a) == 1 and count(eng, b) == 1
    sb = await summary(monkeypatch, b)
    assert [x["id"] for x in sb["requests"]] == [ib["request_id"]]


@pytest.mark.anyio
async def test_module_without_change_request(monkeypatch, worlds):
    eng, a, _ = worlds
    r = await validate(monkeypatch, a, "employee_central", [{f: "" for f in fw.module_fields("employee_central")}])
    assert r.status_code == 200, r.text
    srs = [rec.get("steward_request") for rec in r.json()["records"]]
    assert any(s and s["reason"] == "module_has_no_change_request" and not s.get("request_id") for s in srs), srs
    assert count(eng, a) == 0


@pytest.mark.anyio
async def test_open_failure_keeps_the_verdict(monkeypatch, worlds):
    eng, a, _ = worlds

    async def boom(*args, **kw):
        raise RuntimeError("db gone")

    monkeypatch.setattr("api.routes.change_requests.start_approval", boom)
    r = await validate(monkeypatch, a, "material_master", [BAD])
    assert r.status_code == 200, r.text
    sr = r.json()["records"][0]["steward_request"]
    assert sr["reason"] == "not_opened" and not sr.get("request_id")
    assert count(eng, a) == 0
