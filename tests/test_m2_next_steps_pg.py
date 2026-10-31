"""GET /api/v1/people/next and POST /api/v1/people/{id}/remind against a real Postgres (seed: tests/m2_seed.py).

Ann (admin, the caller) may approve both draft batches (Bob's and the base seed's) and has nothing overdue; Bob
(steward) has one overdue record, may approve the base seed's batch, and sees his own batch once it is sent back.
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.m2_seed import seed_m2

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


def mine(items, *kinds):
    return [i for i in items if i["kind"] in kinds]


@pytest.mark.anyio
async def test_next_steps_per_person(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"], s["user"])  # Ann
    async with client:
        r = await client.get("/api/v1/people/next", headers=headers())
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        approve = mine(items, "approve_batch")
        assert len(approve) == 2 and s["bob_batch"] in {i["id"] for i in approve}
        assert all(i["href"] == f"/?open=batch:{i['id']}" for i in approve)
        assert not mine(items, "overdue", "sent_back")

    with owner.begin() as c:
        c.execute(text("UPDATE remediation_batches SET filter = jsonb_build_object('returned', jsonb_build_object("
                       "'note', 'Wrong unit')) WHERE id = CAST(:b AS uuid)"), {"b": s["bob_batch"]})
    client = await start(monkeypatch, s["tid"], s["bob"])
    async with client:
        items = (await client.get("/api/v1/people/next", headers=headers("steward"))).json()["items"]
        kinds = [i["kind"] for i in items if i["kind"] != "job_failed"]
        assert kinds == ["approve_batch", "sent_back", "overdue"]  # the fixed order
        assert mine(items, "sent_back")[0]["id"] == s["bob_batch"]
        late = mine(items, "overdue")[0]
        assert (late["count"], late["href"]) == (1, "/work?assigned=me&due=overdue")


@pytest.mark.anyio
async def test_remind_once_a_day(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"], s["user"])  # Ann reminds Bob
    async with client:
        for _ in range(2):
            r = await client.post(f"/api/v1/people/{s['bob']}/remind", headers=headers())
            assert r.status_code == 200, r.text
        assert (await client.post(f"/api/v1/people/{s['user'][:-4]}0000/remind", headers=headers())).status_code == 404
        assert (await client.post(f"/api/v1/people/{s['bob']}/remind", headers=headers("viewer"))).status_code == 403
    with owner.connect() as c:
        rows = c.execute(text("SELECT link FROM notifications WHERE user_id = CAST(:u AS uuid) AND type = 'reminder'"),
                         {"u": s["bob"]}).fetchall()
    assert [r[0] for r in rows] == [f"/work?assigned={s['bob']}&due=overdue"]
