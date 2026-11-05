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


async def validate(monkeypatch, w, module, records, route=True, hold=None):
    deps, client = make_client(monkeypatch, w["tid"], w["requester"])
    await deps.engine.dispose()
    body = {"module": module, "records": records, "route_to_steward": route}
    if hold:
        body["hold"] = hold
    async with client:
        return await client.post("/api/v1/dq-firewall/validate", headers=HEAD, json=body)


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


def set_status(eng, rid, status):
    with eng.begin() as c:
        c.execute(text("UPDATE change_requests SET status = :s WHERE id = :i"), {"s": status, "i": rid})


@pytest.mark.anyio
async def test_failed_keeps_the_content_until_cancelled(monkeypatch, worlds):
    eng, a, _ = worlds
    first = (await validate(monkeypatch, a, "material_master", [BAD])).json()["records"][0]["steward_request"]
    set_status(eng, first["request_id"], "failed")  # retry would move it back to creating
    again = (await validate(monkeypatch, a, "material_master", [BAD])).json()["records"][0]["steward_request"]
    assert again["request_id"] == first["request_id"] and again["status"] == "failed" and again["existing"] is True
    set_status(eng, first["request_id"], "cancelled")
    new = (await validate(monkeypatch, a, "material_master", [BAD])).json()["records"][0]["steward_request"]
    assert new["request_id"] != first["request_id"] and not new.get("existing")
    assert count(eng, a) == 2


@pytest.mark.anyio
async def test_parallel_open_returns_the_winner(monkeypatch, worlds):
    """The other call commits after this call's lookup and before its insert: the unique index decides."""
    from api.routes import change_requests as cr_routes

    eng, a, _ = worlds
    first = (await validate(monkeypatch, a, "material_master", [BAD])).json()["records"][0]["steward_request"]
    set_status(eng, first["request_id"], "cancelled")
    real = cr_routes.draft_request

    async def lose_the_race(*args, **kw):
        set_status(eng, first["request_id"], "in_approval")
        return await real(*args, **kw)

    monkeypatch.setattr(cr_routes, "draft_request", lose_the_race)
    r = await validate(monkeypatch, a, "material_master", [BAD])
    assert r.status_code == 200, r.text
    sr = r.json()["records"][0]["steward_request"]
    assert sr["request_id"] == first["request_id"] and sr["existing"] is True
    assert count(eng, a) == 1


# ── hold: stage the candidate, stop the SAP save, release the approved one ────


async def hold(monkeypatch, w, records, mode="blocked", module="material_master"):
    r = await validate(monkeypatch, w, module, records, route=False, hold=mode)
    assert r.status_code == 200, r.text
    return r.json()


def stamp(eng, rid, **cols):
    sets = ", ".join(f"{k} = {v}" for k, v in cols.items())
    with eng.begin() as c:
        c.execute(text(f"UPDATE change_requests SET {sets} WHERE id = :i"), {"i": rid})


def row_of(eng, rid):
    with eng.begin() as c:
        return c.execute(text("SELECT status, entry_released_at, export_downloaded_at FROM change_requests WHERE id = :i"),
                         {"i": rid}).first()


@pytest.mark.anyio
async def test_hold_off_answers_as_before(monkeypatch, worlds):
    eng, a, _ = worlds
    for route in (False, True):
        r = await validate(monkeypatch, a, "material_master", [BAD, GOOD], route=route)
        body = r.json()
        assert "save" not in body and all("hold" not in rec for rec in body["records"])
        assert set(body) == {"verdict", "block_severity", "module", "rules_run", "records", "duplicate_search"}
        assert set(body["records"][0]) == {"index", "verdict", "failures", "duplicates", "steward_request"}
    r = await validate(monkeypatch, a, "material_master", [BAD, GOOD], hold="off")
    assert "save" not in r.json()


@pytest.mark.anyio
async def test_blocked_candidate_is_held_and_the_verdict_stands(monkeypatch, worlds):
    eng, a, _ = worlds
    out = await hold(monkeypatch, a, [BAD, WARN, GOOD])
    assert out["verdict"] == "block" and out["save"] == "stop"
    bad, warn, good = out["records"]
    assert bad["verdict"] == "block" and bad["hold"]["state"] == "held" and bad["hold"]["request_id"]
    assert bad["steward_request"]["request_id"] == bad["hold"]["request_id"]
    assert "hold" not in warn and "hold" not in good  # blocked mode: the warned record has no hold entry
    assert count(eng, a) == 2  # the warned record is routed as route_to_steward does
    again = await hold(monkeypatch, a, [BAD])
    assert again["records"][0]["hold"] == bad["hold"] and count(eng, a) == 2


@pytest.mark.anyio
async def test_blocked_mode_lets_a_warned_record_go(monkeypatch, worlds):
    eng, a, _ = worlds
    out = await hold(monkeypatch, a, [WARN, GOOD])
    assert out["save"] == "go" and "hold" not in out["records"][0]


@pytest.mark.anyio
async def test_flagged_mode_holds_warned_records(monkeypatch, worlds):
    eng, a, _ = worlds
    out = await hold(monkeypatch, a, [WARN, GOOD], mode="flagged")
    assert out["records"][0]["verdict"] == "pass" and out["records"][0]["hold"]["state"] == "held"
    assert out["save"] == "stop" and "hold" not in out["records"][1]
    assert (await hold(monkeypatch, a, [GOOD], mode="flagged"))["save"] == "go"


@pytest.mark.anyio
async def test_waiting_states_stay_held(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    for st in ("draft", "submitted", "in_approval", "failed"):
        set_status(eng, rid, st)
        h = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]
        assert h["state"] == "held" and h["request_id"] == rid, st
    assert count(eng, a) == 1


@pytest.mark.anyio
async def test_rejected_stays_rejected_and_hides_the_comment(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "rejected")
    with eng.begin() as c:
        c.execute(text("INSERT INTO change_request_comments (tenant_id, request_id, author_label, body) "
                       "VALUES (:t, :r, 'x', 'Material ZZZ-NOT-LOGGED is wrong')"), {"t": a["tid"], "r": rid})
    out = await hold(monkeypatch, a, [BAD])
    h = out["records"][0]["hold"]
    assert h["state"] == "rejected" and h["request_id"] == rid and out["save"] == "stop"
    assert "ZZZ-NOT-LOGGED" not in str(out["records"][0]["hold"])
    assert count(eng, a) == 1
    other = await hold(monkeypatch, a, [{**BAD, "MAKT.MAKTX": "Hex bolt M10"}])  # changed content: a new request
    assert other["records"][0]["hold"]["state"] == "held" and count(eng, a) == 2


@pytest.mark.anyio
async def test_creating_and_created_are_written_and_stop(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "creating")
    h = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]
    assert h["state"] == "written" and h["request_id"] == rid and not h.get("sap_key")
    stamp(eng, rid, status="'created'", sap_key="'4711'")
    out = await hold(monkeypatch, a, [BAD])
    assert out["records"][0]["hold"]["state"] == "written" and out["records"][0]["hold"]["sap_key"] == "4711"
    assert out["save"] == "stop" and count(eng, a) == 1


@pytest.mark.anyio
async def test_cancelled_opens_a_new_request(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "cancelled")
    h = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]
    assert h["state"] == "held" and h["request_id"] != rid and count(eng, a) == 2


@pytest.mark.anyio
async def test_approved_is_released_once_and_a_block_verdict_may_save(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "approved")
    out = await hold(monkeypatch, a, [BAD, GOOD])
    rec = out["records"][0]
    assert rec["verdict"] == "block" and out["verdict"] == "block"
    assert rec["hold"]["state"] == "released" and rec["hold"]["request_id"] == rid and out["save"] == "go"
    first = row_of(eng, rid)[1]
    assert first is not None
    again = await hold(monkeypatch, a, [BAD])
    assert again["records"][0]["hold"]["state"] == "released" and row_of(eng, rid)[1] == first
    with eng.begin() as c:
        audits = c.execute(text("SELECT after_json::text FROM audit_log WHERE tenant_id = :t AND action = 'dq_firewall.release'"),
                           {"t": a["tid"]}).scalars().all()
    assert len(audits) == 1 and rid in audits[0] and "ZZZ-NOT-LOGGED" not in audits[0] and "4711" not in audits[0]


@pytest.mark.anyio
async def test_release_expires_after_the_window(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "approved")
    await hold(monkeypatch, a, [BAD])
    stamp(eng, rid, entry_released_at="now() - interval '25 hours'")
    out = await hold(monkeypatch, a, [BAD])
    h = out["records"][0]["hold"]
    assert h["state"] == "held" and h["request_id"] != rid and out["save"] == "stop"
    assert count(eng, a) == 2
    assert row_of(eng, rid)[0] == "approved"  # the old request is untouched


@pytest.mark.anyio
async def test_a_released_request_is_not_exported_and_an_exported_one_is_not_released(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    stamp(eng, rid, status="'approved'", export="'{\"rows\": 1}'::jsonb")
    await hold(monkeypatch, a, [BAD])  # released
    deps, client = make_client(monkeypatch, a["tid"], a["requester"])
    await deps.engine.dispose()
    async with client:
        r = await client.get(f"/api/v1/change-requests/{rid}/export", headers=HEAD)
    assert r.status_code == 409 and row_of(eng, rid)[2] is None
    # the other order: the file was taken first
    bad2 = {**BAD, "MAKT.MAKTX": "Hex bolt M10"}
    rid2 = (await hold(monkeypatch, a, [bad2]))["records"][0]["hold"]["request_id"]
    stamp(eng, rid2, status="'approved'", export="'{\"rows\": 1}'::jsonb")
    deps, client = make_client(monkeypatch, a["tid"], a["requester"])
    await deps.engine.dispose()
    async with client:
        r = await client.get(f"/api/v1/change-requests/{rid2}/export", headers=HEAD)
    assert r.status_code == 200 and row_of(eng, rid2)[2] is not None
    out = await hold(monkeypatch, a, [bad2])
    h = out["records"][0]["hold"]
    assert h["state"] == "written" and h["reason"] == "exported_as_load_file" and out["save"] == "stop"
    assert row_of(eng, rid2)[1] is None


@pytest.mark.anyio
async def test_a_released_request_cannot_be_cancelled(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "approved")
    await hold(monkeypatch, a, [BAD])
    deps, client = make_client(monkeypatch, a["tid"], a["requester"])
    await deps.engine.dispose()
    async with client:
        r = await client.post(f"/api/v1/change-requests/{rid}/cancel", headers=HEAD, json={})
    assert r.status_code == 409


@pytest.mark.anyio
async def test_not_held_reasons(monkeypatch, worlds):
    eng, a, _ = worlds
    out = await hold(monkeypatch, a, [{f: "" for f in fw.module_fields("employee_central")}], module="employee_central")
    holds = [r["hold"] for r in out["records"] if "hold" in r]
    assert holds and all(h["state"] == "not_held" and h["reason"] == "module_has_no_change_request" for h in holds)
    assert out["save"] == "stop"  # a block verdict with no hold: the plain verdict decides
    from api.routes import dq_firewall as route
    monkeypatch.setattr(route, "MAX_ROUTED", 1)
    out = await hold(monkeypatch, a, [BAD, {**BAD, "MAKT.MAKTX": "two"}])
    assert [r["hold"]["state"] for r in out["records"]] == ["held", "not_held"]
    assert out["records"][1]["hold"]["reason"] == "over_limit" and out["save"] == "stop"

    async def boom(*args, **kw):
        raise RuntimeError("db gone")

    monkeypatch.setattr("api.routes.change_requests.start_approval", boom)
    out = await hold(monkeypatch, a, [{**BAD, "MAKT.MAKTX": "three"}])
    assert out["records"][0]["hold"] == {"state": "not_held", "request_id": None, "reason": "not_opened", "sap_key": None}
    assert count(eng, a) == 1


@pytest.mark.anyio
async def test_parallel_hold_opens_one(monkeypatch, worlds):
    from api.routes import change_requests as cr_routes

    eng, a, _ = worlds
    first = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    set_status(eng, first, "cancelled")
    real = cr_routes.draft_request

    async def lose_the_race(*args, **kw):
        set_status(eng, first, "in_approval")
        return await real(*args, **kw)

    monkeypatch.setattr(cr_routes, "draft_request", lose_the_race)
    h = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]
    assert h["state"] == "held" and h["request_id"] == first and count(eng, a) == 1


@pytest.mark.anyio
async def test_hold_audit_has_counts_and_no_values(monkeypatch, worlds):
    eng, a, _ = worlds
    rid = (await hold(monkeypatch, a, [BAD, WARN], mode="flagged"))["records"][0]["hold"]["request_id"]
    set_status(eng, rid, "approved")
    await hold(monkeypatch, a, [BAD, WARN], mode="flagged")
    with eng.begin() as c:
        rows = c.execute(text("SELECT action, after_json FROM audit_log WHERE tenant_id = :t AND action LIKE 'dq_firewall.%' "
                              "ORDER BY created_at"), {"t": a["tid"]}).all()
    last = [r for r in rows if r[0] == "dq_firewall.validate"][-1][1]
    assert last["hold"] == "flagged" and last["hold_states"] == {"held": 1, "released": 1} and last["save"] == "stop"
    assert "ZZZ-NOT-LOGGED" not in " ".join(str(r[1]) for r in rows)


@pytest.mark.anyio
async def test_summary_holds(monkeypatch, worlds):
    eng, a, _ = worlds
    empty = (await summary(monkeypatch, a))["holds"]
    assert empty == {"held": 0, "released": 0, "rejected": 0, "written": 0, "oldest_held_hours": None,
                     "median_decision_hours": None, "latest": []}
    r1 = (await hold(monkeypatch, a, [BAD]))["records"][0]["hold"]["request_id"]
    r2 = (await hold(monkeypatch, a, [{**BAD, "MAKT.MAKTX": "b"}]))["records"][0]["hold"]["request_id"]
    r3 = (await hold(monkeypatch, a, [{**BAD, "MAKT.MAKTX": "c"}]))["records"][0]["hold"]["request_id"]
    r4 = (await hold(monkeypatch, a, [{**BAD, "MAKT.MAKTX": "d"}]))["records"][0]["hold"]["request_id"]
    stamp(eng, r1, status="'approved'", decided_at="created_at + interval '2 hours'")
    await hold(monkeypatch, a, [BAD])  # released
    stamp(eng, r2, status="'rejected'", decided_at="created_at + interval '4 hours'")
    set_status(eng, r3, "created")
    h = (await summary(monkeypatch, a))["holds"]
    assert (h["held"], h["released"], h["rejected"], h["written"]) == (1, 1, 1, 1)
    assert [x["id"] for x in h["latest"]] == [r4] and h["oldest_held_hours"] is not None
    assert h["median_decision_hours"] == 3.0
