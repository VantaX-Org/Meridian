"""Match review queue: score bands, pair detail, merge with per-field picks (and its dry-run preview),
not-a-match, bulk merge above a score, and the unmerge preview. Real Postgres with RLS.

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest

from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

DOMAIN = "business_partner"
RECORDS = {
    "A1": ({"NAME_ORG1": "North Mill", "CITY": "Durban", "TAXNUM": ""}, 0.9),
    "A2": ({"NAME_ORG1": "North Mill Ltd", "CITY": "", "TAXNUM": "T1"}, 0.6),
    "B1": ({"NAME_ORG1": "River Supply", "CITY": "Cape Town"}, 0.8),
    "B2": ({"NAME_ORG1": "River Supplies", "CITY": "Cape Town"}, 0.7),
    "C1": ({"NAME_ORG1": "Hill Farm"}, 0.5),
    "C2": ({"NAME_ORG1": "Hill Farms"}, 0.5),
    "D1": ({"NAME_ORG1": "Delta"}, 0.5),
    "D2": ({"NAME_ORG1": "Delta Group"}, 0.5),
}
PAIRS = (("A1", "A2", 0.70), ("B1", "B2", 0.97), ("C1", "C2", 0.96), ("D1", "D2", 0.10))


def test_match_review_queue(app_engine, monkeypatch):  # noqa: F811
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.merge_explain import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    owner, app_eng = app_engine
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'R1'), (:b, 'R2')"), {"a": tid, "b": other})
    ids: dict[str, str] = {}
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for k, (f, conf) in RECORDS.items():
            c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status, "
                           "overall_confidence) VALUES (:t, :d, :k, CAST(:f AS jsonb), 'golden', :c)"),
                      {"t": tid, "d": DOMAIN, "k": k, "f": json.dumps(f), "c": conf})
        for a, b, total in PAIRS:
            expl = {"attributes": [{"field": "NAME_ORG1", "similarity": total, "weight": 1}], "total": total}
            ids[a[0]] = str(c.execute(text(
                "INSERT INTO match_scores (tenant_id, candidate_a_key, candidate_b_key, domain, total_score, "
                "auto_action, explanation) VALUES (:t, :a, :b, :d, :s, 'queued', CAST(:e AS jsonb)) RETURNING id"),
                {"t": tid, "a": a, "b": b, "d": DOMAIN, "s": total, "e": json.dumps(expl)}).scalar())
    with app_eng.begin() as c:  # another tenant's pair never shows
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": other})
        c.execute(text("INSERT INTO match_scores (tenant_id, candidate_a_key, candidate_b_key, domain, total_score, "
                       "auto_action) VALUES (:t, 'X', 'Y', :d, 0.5, 'queued')"), {"t": other, "d": DOMAIN})

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "R1", [])

    def golden(key):
        with app_eng.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            return c.execute(text("SELECT golden_fields, merged_into FROM master_records WHERE sap_object_key = :k"),
                             {"k": key}).first()

    async def scenario():
        steward, analyst = {"X-User-Role": "steward"}, {"X-User-Role": "analyst"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r0 = await c.get("/api/v1/match-scores", headers=analyst)
            assert r0.status_code == 200, r0.text
            q = r0.json()
            assert q["bands"] == {"auto_merge": 2, "review": 1, "low": 1} and q["total"] == 4
            assert [p["a"] for p in q["pairs"]] == ["B1", "C1", "A1", "D1"]
            unc = (await c.get("/api/v1/match-scores", headers=analyst, params={"band": "review"})).json()
            assert unc["total"] == 1 and unc["pairs"][0]["band"] == "review"
            assert (await c.get("/api/v1/match-scores", headers=analyst,
                                params={"max_score": 0.5})).json()["total"] == 1
            # one record's pairs: either side, by the whole key or the bare value of its first part
            mine = (await c.get("/api/v1/match-scores", headers=analyst, params={"record": "B2"})).json()
            assert [p["a"] for p in mine["pairs"]] == ["B1"] and mine["bands"] == {"auto_merge": 1, "review": 0,
                                                                                   "low": 0}
            bare = (await c.get("/api/v1/match-scores", headers=analyst,
                                params={"record": "PARTNER=A1|X=1", "domain": DOMAIN})).json()
            assert [p["a"] for p in bare["pairs"]] == ["A1"]
            assert (await c.get("/api/v1/match-scores", headers=analyst,
                                params={"record": "A1", "domain": "material_master"})).json()["total"] == 0

            d = (await c.get(f"/api/v1/match-scores/{ids['A']}", headers=analyst)).json()
            assert d["default_survivor"] == "A1" and d["record_b"]["fields"]["TAXNUM"] == "T1"
            assert d["explanation"]["attributes"][0]["field"] == "NAME_ORG1"

            # preview picks A2's name; nothing is stored
            body = {"overrides": {"NAME_ORG1": "North Mill Ltd"}, "dry_run": True}
            assert (await c.post(f"/api/v1/match-scores/{ids['A']}/merge", headers=analyst,
                                 json=body)).status_code == 403
            pv = (await c.post(f"/api/v1/match-scores/{ids['A']}/merge", headers=steward, json=body)).json()
            assert pv["dry_run"] and pv["golden_fields"] == {"NAME_ORG1": "North Mill Ltd", "CITY": "Durban",
                                                            "TAXNUM": "T1"}
            assert pv["survivorship"]["NAME_ORG1"]["rule"] == "steward_override"
            assert golden("A2").merged_into is None and golden("A1").golden_fields["TAXNUM"] == ""

            # a real merge needs a reason, then stores exactly the preview
            assert (await c.post(f"/api/v1/match-scores/{ids['A']}/merge", headers=steward,
                                 json={**body, "dry_run": False})).status_code == 422
            m = (await c.post(f"/api/v1/match-scores/{ids['A']}/merge", headers=steward,
                              json={**body, "dry_run": False, "reason": "same company"})).json()
            assert m["golden_fields"] == pv["golden_fields"] and golden("A2").merged_into is not None
            assert (await c.post(f"/api/v1/match-scores/{ids['A']}/merge", headers=steward,
                                 json={"reason": "again"})).status_code == 409

            # not a match is remembered and leaves the queue
            assert (await c.post(f"/api/v1/match-scores/{ids['D']}/decision", headers=steward,
                                 json={"decision": "reject", "reason": "different firms"})).status_code == 200
            q = (await c.get("/api/v1/match-scores", headers=analyst)).json()
            assert q["bands"] == {"auto_merge": 2, "review": 0, "low": 0}

            # bulk merge at or above 0.95
            assert (await c.post("/api/v1/match-scores/bulk-merge", headers=steward,
                                 json={"min_score": 0.2, "reason": "x"})).status_code == 422
            bulk = (await c.post("/api/v1/match-scores/bulk-merge", headers=steward,
                                 json={"min_score": 0.95, "reason": "clear duplicates"})).json()
            assert bulk == {"considered": 2, "merged": 2, "already_together": 0, "blocked": 0, "missing_record": 0}
            assert (await c.get("/api/v1/match-scores", headers=analyst)).json()["total"] == 0
            assert (await c.get("/api/v1/match-scores", headers=analyst,
                                params={"include_decided": True})).json()["total"] == 4

            # unmerge preview: shows what stays, keeps the cluster
            gid = m["golden_record_id"]
            un = (await c.post(f"/api/v1/master-records/{gid}/unmerge", headers=steward,
                               json={"keys": ["A2"], "reason": "check", "dry_run": True})).json()
            assert un["dry_run"] and un["remaining_keys"] == [] and un["golden_fields"]["TAXNUM"] == ""
            assert golden("A2").merged_into is not None
        await aeng.dispose()

    asyncio.run(scenario())
