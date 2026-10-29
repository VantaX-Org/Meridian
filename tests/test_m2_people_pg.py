"""GET /api/v1/people against a real Postgres (seed: tests/m2_seed.py).

Ann (admin, the caller) has one open record, Bob (steward) two of which one is overdue, Cara (approver) owns
material master; Dan (viewer) has nothing and is not listed. Two draft batches wait for a second person: Bob's, and the
base seed's, which has no human creator.
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine

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


@pytest.mark.anyio
async def test_people_with_the_caller_first(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"], s["user"])  # signed in as Ann
    async with client:
        r = await client.get("/api/v1/people", headers=headers())
        assert r.status_code == 200, r.text
        people = r.json()["people"]
        # the caller first, then by open work (Bob 2), approvals waiting (Cara 2), name
        assert [p["name"] for p in people] == ["Ann Steward", "Bob Steward", "Cara Owner"]
        assert [p["is_me"] for p in people] == [True, False, False]
        ann, bob, cara = people
        assert (ann["id"], ann["role"]) == (s["user"], "admin") and ann["email"]

        assert (ann["open_work"], ann["overdue"], ann["objects_owned"]) == (1, 0, [])
        assert (bob["open_work"], bob["overdue"]) == (2, 1)
        assert bob["objects_owned"] == [{"module": "material_master", "label": "Material master", "as": "steward"}]
        assert cara["objects_owned"] == [{"module": "material_master", "label": "Material master", "as": "owner"}]
        assert (cara["open_work"], cara["overdue"]) == (0, 0)

        # approvals waiting: a draft batch not made by them, for someone who may approve (Bob made one of the two)
        assert (ann["approvals_waiting"], bob["approvals_waiting"], cara["approvals_waiting"]) == (2, 1, 2)
        # SLA: the strictest resolve time of the policies for the severities of their open work (critical 1440 min)
        assert (ann["sla_hours"], bob["sla_hours"], cara["sla_hours"]) == (24.0, 24.0, None)
        assert (ann["breaches_this_month"], bob["breaches_this_month"], cara["breaches_this_month"]) == (0, 2, 0)
        assert ann["last_action_at"] is None and bob["last_action_at"].startswith("2026-10-16T05:17:00")
        assert cara["last_action_at"] is None


@pytest.mark.anyio
async def test_order_follows_the_caller(owner, monkeypatch):
    s = seed_m2(owner)
    client = await start(monkeypatch, s["tid"], s["bob"])  # signed in as Bob
    async with client:
        people = (await client.get("/api/v1/people", headers=headers())).json()["people"]
        assert [p["name"] for p in people] == ["Bob Steward", "Ann Steward", "Cara Owner"]
        assert people[0]["is_me"] is True and sum(p["is_me"] for p in people) == 1
    client = await start(monkeypatch, s["tid"], s["dan"])  # a viewer who owns and fixes nothing is listed, first, with zeros
    async with client:
        people = (await client.get("/api/v1/people", headers=headers("viewer"))).json()["people"]
        assert people[0]["name"] == "Dan Viewer" and people[0]["approvals_waiting"] == 0 and people[0]["open_work"] == 0
        assert [p["name"] for p in people[1:]] == ["Bob Steward", "Ann Steward", "Cara Owner"]


@pytest.mark.anyio
async def test_people_are_tenant_scoped(owner, monkeypatch):
    s, t2 = seed_m2(owner), seed_m2(owner)
    from tests.landscape_seed import seed
    bare = seed(owner, with_run=False)
    # a tenant with users but no owners, no assigned work and a caller that is not one of its users: nobody is listed
    client = await start(monkeypatch, bare["tid"], "00000000-0000-0000-0000-0000000000b7")
    async with client:
        assert (await client.get("/api/v1/people", headers=headers())).json() == {"people": []}
    # the second full tenant lists its own people only
    client = await start(monkeypatch, t2["tid"], t2["user"])
    async with client:
        people = (await client.get("/api/v1/people", headers=headers())).json()["people"]
        ids = {p["id"] for p in people}
        assert ids == {t2["user"], t2["bob"], t2["cara"]} and not ids & {s["user"], s["bob"], s["cara"]}
