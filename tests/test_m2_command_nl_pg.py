"""GET /command/nl against a real Postgres (MERIDIAN_TEST_DB_URL): the tenant's own systems and people in the
vocabulary, the filter and href it returns, and /work/records answering that filter (policy classes, due this week).
Another tenant's systems and people never appear."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import create_engine

from tests.m2_client import headers, make_client
from tests.m2_step10_seed import seed_run, seed_tenant

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

K1, K2, K3 = "LIFNR=0000200001", "LIFNR=0000200002", "LIFNR=0000200003"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


@pytest.mark.anyio
async def test_command_nl(owner, monkeypatch):
    s = seed_tenant(owner)
    soon = datetime.now(timezone.utc) + timedelta(days=3)
    seed_run(owner, s["tid"], s["ecc"], keys={"AP039": [K1, K2], "AP016": [K3]}, assignee=s["bob"], due_at=soon)
    other = seed_tenant(owner)
    seed_run(owner, other["tid"], other["ecc"], keys={"AP039": [K1]})

    deps, client = make_client(monkeypatch, s["tid"], s["bob"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/command/nl", params={"q": "rules failing on vendor bank data in ECC production"},
                             headers=headers("viewer"))
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["filter"] == {"policy": "sox:vendor_bank", "system": s["ecc"]} and out["unmatched_words"] == []
        assert out["llm_used"] is False and "vendor bank data" in out["explanation"]
        qs = parse_qs(urlparse(out["href"]).query)
        assert urlparse(out["href"]).path == "/v2/work" and qs == {"policy": ["sox:vendor_bank"], "system": [s["ecc"]]}

        recs = (await client.get("/api/v1/work/records", params=out["filter"], headers=headers("viewer"))).json()
        assert sorted(i["record_key"] for i in recs["items"]) == [K1, K2]  # AP039 evidences vendor bank data

        out = (await client.get("/api/v1/command/nl", params={"q": "critical vendors assigned to Bob due this week"},
                                headers=headers("viewer"))).json()
        assert out["filter"] == {"severity": "critical", "module": "accounts_payable", "assigned": s["bob"], "due": "week"}
        recs = (await client.get("/api/v1/work/records", params=out["filter"], headers=headers("viewer"))).json()
        assert sorted(i["record_key"] for i in recs["items"]) == [K1, K2]

        out = (await client.get("/api/v1/command/nl", params={"q": "payment terms assigned to me"},
                                headers=headers("viewer"))).json()
        assert out["filter"] == {"policy": "sox:payment_terms", "assigned": "me"}
        recs = (await client.get("/api/v1/work/records", params=out["filter"], headers=headers("viewer"))).json()
        assert [i["record_key"] for i in recs["items"]] == [K3]

        assert (await client.get("/api/v1/work/records", params={"policy": "sox:nothing"},
                                 headers=headers())).status_code == 422
        assert (await client.get("/api/v1/command/nl", params={"q": ""}, headers=headers())).status_code == 422

    # the other tenant: its own system, none of this tenant's people
    deps, client = make_client(monkeypatch, other["tid"], other["ann"])
    async with client:
        out = (await client.get("/api/v1/command/nl", params={"q": "ECC production assigned to bob steward"},
                                headers=headers())).json()
        assert out["filter"]["system"] == other["ecc"] and out["filter"].get("assigned") == other["bob"]
        assert s["bob"] not in str(out)
