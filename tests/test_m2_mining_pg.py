"""Rule mining from fixes against a real Postgres (MERIDIAN_TEST_DB_URL): values stewards enter through /work/decide
become learned-rule proposals (null or invalid-value checks) with evidence once the same fix repeats in N records,
in the existing review flow, never enabled without a person's approval."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from api.services import fix_mining
from tests.m2_client import headers, make_client
from tests.m2_step9_seed import KEYS, seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def test_patterns():
    assert fix_mining.pattern_of([None, "", "  "]) == ("null", None)
    assert fix_mining.pattern_of(["XX", " XX"]) == ("invalid_value", "XX")
    assert fix_mining.pattern_of(["XX", "YY"]) is None and fix_mining.pattern_of(["XX", None]) is None
    body = fix_mining.body_of("invalid_value", "MARA.GEWEI", "K.G", "KG")
    assert body["check_class"] == "regex_check" and body["pattern"] == r"^(?!K\.G$)" and body["fix_value"] == "KG"
    import re
    assert re.match(body["pattern"], "K.G") is None and re.match(body["pattern"], "KG") and re.match(body["pattern"], "KXG")


def _items(owner, tid, ecc, field, pairs, label="bob@example.com"):
    with owner.begin() as c:
        bid = c.execute(text("INSERT INTO remediation_batches (tenant_id, name, created_by_label) VALUES (:t, 'Fixes', :l) "
                             "RETURNING id"), {"t": tid, "l": label}).scalar()
        for n, (cur, new) in enumerate(pairs):
            c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, field, "
                           "current_value, proposed_value, proposal_source) VALUES (:t, :b, :s, 'material_master', 'MM900', "
                           ":k, :f, :cur, :new, 'steward')"),
                      {"t": tid, "b": bid, "s": ecc, "k": f"MATNR={field}{n:04d}", "f": field, "cur": cur, "new": new})


@pytest.mark.anyio
async def test_mine_from_decide_edits(owner, monkeypatch):
    s = seed_step9(owner)
    tid, run = s["tid"], s["run"]
    _items(owner, tid, s["ecc"], "MARA.GEWEI", [("XX", "KG")] * 26)            # same invalid value -> proposal
    _items(owner, tid, s["ecc"], "MARA.BRGEW", [(str(n), "1") for n in range(30)])  # mixed old values -> nothing
    _items(owner, tid, s["ecc"], "MARA.NTGEW", [(None, "0")] * 10)              # too few
    _items(owner, tid, s["ecc"], "MARA.MATKL", [(None, "01")] * 30, label="")   # a non-steward source is ignored
    with owner.begin() as c:
        c.execute(text("UPDATE remediation_items SET proposal_source = 'rule' WHERE tenant_id = :t AND field = 'MARA.MATKL'"),
                  {"t": tid})

    deps, client = make_client(monkeypatch, tid, s["bob"])
    await deps.engine.dispose()
    async with client:
        # Bob fixes all 30 MM005 records with the same unit through the work list: the field was blank in each
        r = await client.post("/api/v1/work/decide", headers=headers("steward"), json={
            "version_id": run, "items": [{"module": "material_master", "record_key": k, "check_id": "MM005",
                                          "action": "edit", "value": "EA"} for k in KEYS]})
        assert r.status_code == 200, r.text
        assert (await client.post("/api/v1/learned-rules/mine", json={}, headers=headers("viewer"))).status_code == 403
        r = await client.post("/api/v1/learned-rules/mine", json={}, headers=headers("steward"))
        assert r.status_code == 202, r.text
        out = r.json()
        assert out["source"] == "fixes" and out["min_records"] == 25 and (out["proposed"], out["refreshed"]) == (2, 0)
        items = (await client.get("/api/v1/learned-rules", params={"source": "fixes"}, headers=headers("steward"))).json()["items"]
    by = {i["field"]: i for i in items}
    assert set(by) == {"MARA.MEINS", "MARA.GEWEI"}
    meins = by["MARA.MEINS"]
    assert meins["kind"] == "null" and meins["status"] == "pending" and meins["support_rows"] == 30
    assert meins["body"]["check_class"] == "null_check" and meins["body"]["fix_value"] == "EA"
    ev = meins["evidence"]
    assert ev["count"] == 30 and len(ev["sample_keys"]) == 5 and set(ev["sample_keys"]) <= set(KEYS)
    assert ev["first_at"] and ev["last_at"] and ev["who"] and ev["pattern"] == "blank"
    gewei = by["MARA.GEWEI"]
    assert gewei["kind"] == "invalid_value" and gewei["evidence"]["invalid_value"] == "XX"
    assert gewei["body"]["check_class"] == "regex_check" and gewei["evidence"]["who"] == ["bob@example.com"]
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        assert c.execute(text("SELECT count(*) FROM rule_versions WHERE tenant_id = :t"), {"t": tid}).scalar() == 0  # never auto-enabled

    # the existing review flow: a second person approves one
    deps, client = make_client(monkeypatch, tid, s["cara"])
    await deps.engine.dispose()
    async with client:
        r = await client.post(f"/api/v1/learned-rules/{gewei['id']}/approve", json={"severity": "high"}, headers=headers("approver"))
        assert r.status_code == 200, r.text
        rule_id = r.json()["rule_id"]
        # mining again refreshes the pending one and leaves the decided one alone
        r = await client.post("/api/v1/learned-rules/mine", json={"source": "fixes"}, headers=headers("admin"))
        assert (r.json()["proposed"], r.json()["refreshed"]) == (0, 1)
        r = await client.put("/api/v1/settings/automation", json={"rule_mining": {"min_records": 40}}, headers=headers("admin"))
        assert r.json()["rule_mining"] == {"min_records": 40}
        r = await client.post("/api/v1/learned-rules/mine", json={}, headers=headers("admin"))
        assert (r.json()["proposed"], r.json()["refreshed"]) == (0, 0)
        r = await client.post("/api/v1/learned-rules/mine", json={"version_id": str(uuid.uuid4())}, headers=headers("admin"))
        assert r.status_code == 404  # the data miner, as before
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        body = c.execute(text("SELECT body FROM rule_versions WHERE rule_id = :r"), {"r": rule_id}).scalar()
    assert body["check_class"] == "regex_check" and body["severity"] == "high" and body["module"] == "material_master"


def test_daily_beat(owner):
    from workers.scheduler import celery_app
    from workers.tasks.fix_mining import mine_all

    s = seed_step9(owner)
    _items(owner, s["tid"], s["ecc"], "MARA.SPART", [(None, "00")] * 25)
    out = mine_all(owner)
    assert out[s["tid"]]["proposed"] == 1
    assert mine_all(owner)[s["tid"]]["refreshed"] == 1  # idempotent
    entry = celery_app.conf.beat_schedule["learned-rules-from-fixes-0145"]
    assert entry["task"] == "workers.tasks.fix_mining.mine_rules_from_fixes"
