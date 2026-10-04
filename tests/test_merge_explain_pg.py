"""Merge explain / unmerge / undo / re-merge / pair decisions against a real Postgres (RLS enforced).

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
    "100": {"NAME_ORG1": "Acme", "BU_GROUP": "", "TAXNUM": ""},
    "200": {"NAME_ORG1": "ACME Ltd", "BU_GROUP": "BP01", "TAXNUM": ""},
    "300": {"NAME_ORG1": "Acme (Pty) Ltd", "BU_GROUP": "BP02", "TAXNUM": "ZA3"},
}


def test_explain_unmerge_undo_remerge_round_trip(app_engine):  # noqa: F811
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.merge_explain import router
    from api.services import mdm_merge

    owner, app_eng = app_engine
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'M1'), (:b, 'M2')"), {"a": tid, "b": other})
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for k, f in RECORDS.items():
            c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) "
                           "VALUES (:t, :d, :k, CAST(:f AS jsonb), 'golden')"),
                      {"t": tid, "d": DOMAIN, "k": k, "f": json.dumps(f)})
        ids = {}
        for a, b, total, action in (("100", "200", 0.97, "merged"), ("200", "300", 0.96, "merged"),
                                    ("100", "300", 0.40, "queued")):
            expl = {"attributes": [{"field": "NAME_ORG1", "similarity": total, "weight": 1}], "total": total}
            ids[(a, b)] = c.execute(text(
                "INSERT INTO match_scores (tenant_id, candidate_a_key, candidate_b_key, domain, total_score, "
                "auto_action, explanation) VALUES (:t, :a, :b, :d, :s, :act, CAST(:e AS jsonb)) RETURNING id"),
                {"t": tid, "a": a, "b": b, "d": DOMAIN, "s": total, "act": action,
                 "e": json.dumps(expl)}).scalar()

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "M1", [])

    def rows():
        with app_eng.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            return {r.sap_object_key: r for r in c.execute(text("SELECT * FROM master_records"))}

    async def merge(survivor, merged):
        async with factory() as db:
            await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
            res = await mdm_merge.merge_master_records(db, tid, DOMAIN, survivor, merged, None)
            await db.commit()
            return res

    async def scenario():
        await merge("100", "200")
        await merge("100", "300")  # 300 joins the cluster headed by 100
        head = rows()["100"]
        assert head.golden_fields == {"NAME_ORG1": "Acme", "BU_GROUP": "BP01", "TAXNUM": "ZA3"}
        assert rows()["300"].merged_into == head.id
        gid = str(head.id)

        steward, analyst = {"X-User-Role": "steward"}, {"X-User-Role": "analyst"}
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            ex = (await c.get(f"/api/v1/master-records/{rows()['300'].id}/explain", headers=analyst)).json()
            assert ex["golden_record_id"] == gid and ex["members"] == ["200", "300"]
            sv = ex["survivorship"]
            assert sv["BU_GROUP"]["winner_key"] == "200"
            assert {x["key"]: x["reason"] for x in sv["BU_GROUP"]["losers"]} == {
                "100": "blank", "300": "lower source priority (rank 3)"}
            assert len(ex["pairs"]) == 3

            g = (await c.get(f"/api/v1/master-records/{gid}/cluster-graph", headers=analyst)).json()
            assert {(w["a"], w["via"], w["b"]): w["reason"] for w in g["weak_chains"]} == {
                ("100", "200", "300"): "direct_score_below_threshold"}
            assert [n["key"] for n in g["nodes"] if n["is_survivor"]] == ["100"]

            # analysts cannot unmerge; the survivor cannot be split out
            body = {"keys": ["300"], "reason": "different legal entity"}
            assert (await c.post(f"/api/v1/master-records/{gid}/unmerge", headers=analyst,
                                 json=body)).status_code == 403
            assert (await c.post(f"/api/v1/master-records/{gid}/unmerge", headers=steward,
                                 json={"keys": ["100"], "reason": "x"})).status_code == 409
            assert (await c.post(f"/api/v1/master-records/{gid}/unmerge", headers=steward,
                                 json={"keys": ["300"]})).status_code == 422
            un = (await c.post(f"/api/v1/master-records/{gid}/unmerge", headers=steward, json=body)).json()
            assert un["remaining_keys"] == ["200"] and un["do_not_match_pairs"] == 2
            r = rows()
            # both sides recomputed: head loses 300's tax number, 300 gets its own values back
            assert r["100"].golden_fields == {"NAME_ORG1": "Acme", "BU_GROUP": "BP01", "TAXNUM": ""}
            assert r["300"].merged_into is None and r["300"].golden_fields == RECORDS["300"]

            cons = (await c.get("/api/v1/pair-constraints", headers=analyst, params={"key": "300"})).json()
            assert sorted((x["key_lo"], x["key_hi"], x["kind"]) for x in cons) == [
                ("100", "300", "do_not_match"), ("200", "300", "do_not_match")]

            # do-not-match blocks a re-merge from any path
            with pytest.raises(mdm_merge.PairConstraintError):
                await merge("200", "300")

            # revert the unmerge: constraints dropped, 300 back in the cluster
            rv = (await c.post(f"/api/v1/merge-events/{un['event_id']}/revert", headers=steward,
                               json={"reason": "split in error"})).json()
            assert rv["constraints_removed"] == 2 and rows()["300"].merged_into == head.id
            assert rows()["100"].golden_fields["TAXNUM"] == "ZA3"
            assert (await c.post(f"/api/v1/merge-events/{un['event_id']}/revert", headers=steward,
                                 json={})).status_code == 409

            # undo the latest merge (the re-merge of 300), no do-not-match pairs added
            undo = (await c.post(f"/api/v1/master-records/{gid}/undo-last-merge", headers=steward,
                                 json={})).json()
            assert undo["split_keys"] == ["300"] and undo["do_not_match_pairs"] == 0
            ev = (await c.get(f"/api/v1/master-records/{gid}/merge-events", headers=analyst)).json()
            assert [e["event_type"] for e in ev] == ["undo", "remerge", "unmerge", "merge", "merge"]
            assert ev[1]["reversed"] and ev[2]["reversed"] and not ev[3]["reversed"]
            assert ev[2]["before"]["golden_fields"]["TAXNUM"] == "ZA3" and ev[2]["after"]["split"]["300"]["TAXNUM"] == "ZA3"

            # steward override then pair decision
            ov = (await c.post(f"/api/v1/master-records/{gid}/overrides", headers=steward,
                               json={"overrides": {"NAME_ORG1": "Acme Holdings"}, "reason": "legal name"})).json()
            assert ov["golden_fields"]["NAME_ORG1"] == "Acme Holdings"
            sid = str(ids[("100", "300")])
            assert (await c.post(f"/api/v1/match-scores/{sid}/decision", headers=steward,
                                 json={"decision": "maybe", "reason": "x"})).status_code == 422
            d = (await c.post(f"/api/v1/match-scores/{sid}/decision", headers=steward,
                              json={"decision": "reject", "reason": "separate branch"})).json()
            assert d["kind"] == "do_not_match"
            assert (await c.post(f"/api/v1/match-scores/{uuid.uuid4()}/decision", headers=steward,
                                 json={"decision": "accept", "reason": "x"})).status_code == 404

            # dry-run: nothing changes, reject wins over the score
            before = {k: (v.golden_fields, v.merged_into) for k, v in rows().items()}
            dr = (await c.post("/api/v1/match-tuning/dry-run", headers=analyst,
                               json={"domain": DOMAIN, "weights": {}, "auto_merge": 0.965})).json()
            assert dr["applied"] is False and dr["pairs"] == 3
            assert dr["pairs_unlinked"] == 1 and dr["clusters_that_would_split"] == 1
            assert (await c.post("/api/v1/match-tuning/dry-run", headers=analyst,
                                 json={"domain": DOMAIN, "auto_merge": 0.3, "review_floor": 0.5})).status_code == 422
            assert {k: (v.golden_fields, v.merged_into) for k, v in rows().items()} == before

            dnm = next(x for x in (await c.get("/api/v1/pair-constraints", headers=analyst,
                                                params={"kind": "do_not_match"})).json())
            assert (await c.delete(f"/api/v1/pair-constraints/{dnm['id']}", headers=steward,
                                   params={"reason": "wrong"})).status_code == 200

        # history is append-only; other tenants see nothing
        with app_eng.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            with pytest.raises(Exception, match="append-only"):
                with c.begin_nested():
                    c.execute(text("UPDATE mdm_merge_events SET reason = 'x'"))
        with app_eng.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": other})
            assert c.execute(text("SELECT count(*) FROM mdm_merge_events")).scalar() == 0
            assert c.execute(text("SELECT count(*) FROM mdm_pair_constraints")).scalar() == 0

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"
    try:
        asyncio.run(main())
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)


def test_do_not_match_survives_cleaning_rerun(app_engine):  # noqa: F811
    """The cleaning worker drops blocked pairs and re-proposes always_match pairs on every rerun."""
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.merge_explain import drop_blocked_pairs, pair_key

    owner, app_eng = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'M3')"), {"a": tid})
    with Session(app_eng) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        for lo, hi, kind in (("1", "2", "do_not_match"), ("3", "4", "always_match")):
            s.execute(text("INSERT INTO mdm_pair_constraints (tenant_id, domain, key_lo, key_hi, kind) "
                           "VALUES (:t, :d, :a, :b, :k)"), {"t": tid, "d": DOMAIN, "a": lo, "b": hi, "k": kind})
        s.commit()
        for _ in range(2):  # two reruns, same answer
            blocked = {(r[0], r[1]) for r in s.execute(text(
                "SELECT key_lo, key_hi FROM mdm_pair_constraints WHERE tenant_id = :t AND domain = :d "
                "AND kind = 'do_not_match'"), {"t": tid, "d": DOMAIN})}
            kept = drop_blocked_pairs([{"category": "dedup", "record_key": "2|1"},
                                       {"category": "dedup", "record_key": "1|5"}], blocked)
            assert [c["record_key"] for c in kept] == ["1|5"] and pair_key("2", "1") in blocked
