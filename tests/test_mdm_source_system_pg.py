"""Source-system tags on golden-record values, trusted-system survivorship, merge tags, migration 091's
backfill and cleaning-engine merge reasons, against a real Postgres as a non-superuser (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import uuid
from datetime import datetime, timezone

import pytest

from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

DOMAIN = "business_partner"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _seed_tenant(owner, app_eng):
    from sqlalchemy import text

    tid, prd, s4p = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    v_prd, v_s4p = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'SRC')"), {"t": tid})
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES "
                       "(:p, :t, 'PRD', 'ecc'), (:s, :t, 'S4P', 's4hana')"), {"p": prd, "s": s4p, "t": tid})
        for vid, sid in ((v_prd, prd), (v_s4p, s4p)):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                           "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                      {"v": vid, "t": tid, "m": json.dumps({"system_id": sid, "source": "extraction"})})
    return tid, prd, s4p, v_prd, v_s4p


def _session_factory(app_eng):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    return aeng, async_sessionmaker(aeng, expire_on_commit=False)


async def _rls(db, tid):
    from sqlalchemy import text

    await db.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
    await db.commit()


def _rows(app_eng, tid):
    from sqlalchemy import text

    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        return {r.sap_object_key: r for r in c.execute(text("SELECT * FROM master_records"))}


def test_trusted_system_wins_across_runs_and_through_merges(app_engine):  # noqa: F811
    from sqlalchemy import text

    from api.services import mdm_merge
    from api.services.golden_record_engine import process_sync_batch
    from workers.tasks.build_golden_records import _rows_to_incoming, _run_system

    import pandas as pd

    owner, app_eng = app_engine
    tid, prd, s4p, v_prd, v_s4p = _seed_tenant(owner, app_eng)
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO survivorship_rules (tenant_id, domain, field, rule_type, trusted_sources) "
                       "VALUES (:t, :d, 'NAME_ORG1', 'trusted_source', '{PRD,S4P}')"), {"t": tid, "d": DOMAIN})
    aeng, factory = _session_factory(app_eng)

    async def batch(db, vid, key, fields, when):
        sid, name = await _run_system(db, vid, tid)
        rec = _rows_to_incoming(pd.DataFrame([fields]), f"upload:{vid[:8]}", sid, name)
        for r in rec:
            r["extracted_at"] = when
        return await process_sync_batch(db, tid, DOMAIN, key, rec, use_ai=False)

    async def scenario():
        async with factory() as db:
            await _rls(db, tid)
            assert await _run_system(db, v_prd, tid) == (prd, "PRD")
            assert await _run_system(db, str(uuid.uuid4()), tid) == (None, None)
            # PRD first, then a newer S4P extraction of the same partner
            await batch(db, v_prd, "100", {"NAME_ORG1": "Acme", "CITY1": "Durban"}, "2026-01-01T00:00:00+00:00")
            await batch(db, v_s4p, "100", {"NAME_ORG1": "ACME Ltd", "CITY1": "Cape Town"}, "2026-02-01T00:00:00+00:00")
        r = _rows(app_eng, tid)["100"]
        # PRD is trusted above S4P: its value stays; a field without a rule takes the newest value
        assert r.golden_fields["NAME_ORG1"] == "Acme"
        assert r.source_contributions["NAME_ORG1"]["source_system_id"] == prd
        assert r.source_contributions["NAME_ORG1"]["source_system_name"] == "PRD"
        assert r.golden_fields["CITY1"] == "Cape Town"
        assert r.source_contributions["CITY1"]["source_system_name"] == "S4P"

        # the rule names systems: a rename keeps it matching (resolved to the system id)
        with app_eng.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE sap_systems SET name = 'PRD-OLD' WHERE id = :p"), {"p": prd})
            c.execute(text("UPDATE survivorship_rules SET trusted_sources = '{S4P,PRD-OLD}' WHERE tenant_id = :t"),
                      {"t": tid})
        async with factory() as db:
            await _rls(db, tid)
            await batch(db, v_s4p, "100", {"NAME_ORG1": "ACME Ltd"}, "2026-03-01T00:00:00+00:00")
            # two records, one from each system, merged: the trusted system's value survives the merge
            await batch(db, v_prd, "200", {"NAME_ORG1": "Acme 200", "TAXNUM": "ZA1"}, "2026-01-01T00:00:00+00:00")
            await batch(db, v_s4p, "300", {"NAME_ORG1": "ACME 300", "TAXNUM": ""}, "2026-01-01T00:00:00+00:00")
        assert _rows(app_eng, tid)["100"].golden_fields["NAME_ORG1"] == "ACME Ltd"  # S4P now ranks first

        with app_eng.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            c.execute(text("UPDATE survivorship_rules SET trusted_sources = '{PRD-OLD}' WHERE tenant_id = :t"),
                      {"t": tid})
        async with factory() as db:
            await _rls(db, tid)
            await mdm_merge.merge_master_records(db, tid, DOMAIN, "300", "200", None, reason="same partner")
            await db.commit()
        rows = _rows(app_eng, tid)
        head, member = rows["300"], rows["200"]
        assert head.golden_fields["NAME_ORG1"] == "Acme 200"  # from 200, a PRD value
        c_name = head.source_contributions["NAME_ORG1"]
        assert (c_name["source_system"], c_name["source_system_id"], c_name["merged_from"]) == ("merge:200", prd, "200")
        assert head.source_contributions["TAXNUM"]["source_system_name"] == "PRD-OLD"  # its name at extraction
        assert head.survivorship_explanation["NAME_ORG1"]["rule"] == "trusted_source"
        assert head.own_contributions["NAME_ORG1"]["source_system_id"] == s4p
        assert member.own_contributions["NAME_ORG1"]["source_system_id"] == prd

        # unmerge: the head gets its own S4P value and tags back
        async with factory() as db:
            await _rls(db, tid)
            await mdm_merge.unmerge(db, tid, str(head.id), ["200"], None, "different partner")
            await db.commit()
        rows = _rows(app_eng, tid)
        assert rows["300"].golden_fields["NAME_ORG1"] == "ACME 300"
        assert rows["300"].source_contributions["NAME_ORG1"]["source_system_id"] == s4p
        assert rows["200"].source_contributions["NAME_ORG1"]["source_system_id"] == prd

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    asyncio.run(main())


def test_migration_091_backfills_upload_and_merge_entries(app_engine):  # noqa: F811
    from sqlalchemy import text

    owner, app_eng = app_engine
    tid, prd, s4p, v_prd, v_s4p = _seed_tenant(owner, app_eng)
    v_none = str(uuid.uuid4())
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', '{}'::jsonb)"), {"v": v_none, "t": tid})
        legacy = {
            "A": {"NAME_ORG1": {"value": "Acme", "source_system": f"upload:{v_prd[:8]}"},
                  "CITY1": {"value": "Durban", "source_system": f"upload:{v_none[:8]}"},
                  "TAXNUM": {"value": "ZA1", "source_system": f"merge:B"}},
            "B": {"TAXNUM": {"value": "ZA1", "source_system": f"upload:{v_s4p[:8]}"}},
            "C": {"NAME_ORG1": {"value": "x", "source_system": "upload:zzzzzzzz"},
                  "BU_GROUP": {"value": "y", "source_system": "steward_override"}},
        }
        for k, contrib in legacy.items():
            c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, "
                           "source_contributions) VALUES (:t, :d, :k, '{}'::jsonb, CAST(:c AS jsonb))"),
                      {"t": tid, "d": DOMAIN, "k": k, "c": json.dumps(contrib)})

    spec = importlib.util.spec_from_file_location("m091", os.path.join(ROOT, "db/migrations/versions/091_mdm_source_system.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    for _ in range(2):  # idempotent
        with app_eng.begin() as c:  # as the app role: the backfill sets the tenant per iteration
            c.execute(text(m.BACKFILL_SQL))
        rows = _rows(app_eng, tid)
        a, b, cc = rows["A"].source_contributions, rows["B"].source_contributions, rows["C"].source_contributions
        assert (a["NAME_ORG1"]["source_system_id"], a["NAME_ORG1"]["source_system_name"]) == (prd, "PRD")
        assert "source_system_id" not in a["CITY1"]  # an upload attached to no system stays untagged
        assert (b["TAXNUM"]["source_system_id"], b["TAXNUM"]["source_system_name"]) == (s4p, "S4P")
        assert a["TAXNUM"]["source_system_id"] == s4p  # merge:B takes B's tags
        assert cc == legacy["C"]


def test_cleaning_merge_takes_and_keeps_a_reason(app_engine):  # noqa: F811
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.cleaning import router

    owner, app_eng = app_engine
    tid, *_ = _seed_tenant(owner, app_eng)
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        for k, f in (("10", {"NAME_ORG1": "Acme"}), ("20", {"NAME_ORG1": "ACME", "TAXNUM": "ZA1"})):
            c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields) "
                           "VALUES (:t, :d, :k, CAST(:f AS jsonb))"), {"t": tid, "d": DOMAIN, "k": k, "f": json.dumps(f)})
        cand = str(c.execute(text("INSERT INTO dedup_candidates (tenant_id, object_type, record_key_a, record_key_b, "
                                  "match_score, match_method) VALUES (:t, :d, '10', '20', 95, 'fuzzy') RETURNING id"),
                             {"t": tid, "d": DOMAIN}).scalar())
    aeng, factory = _session_factory(app_eng)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "SRC", [])
    h = {"X-User-Role": "approver"}

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            url = "/api/v1/dedup/merge"
            assert (await c.post(url, headers=h, json={"candidate_id": cand, "survivor_key": "10"})).status_code == 422
            assert (await c.post(url, headers=h, json={"candidate_id": cand, "survivor_key": "10",
                                                       "reason": "   "})).status_code == 422
            r = await c.post(url, headers=h, json={"candidate_id": cand, "survivor_key": "10",
                                                   "reason": "Same tax number"})
            assert r.status_code == 200, r.text
            assert r.json()["merge_reason"] == "Same tax number"
            listed = (await c.get("/api/v1/dedup/candidates", headers=h, params={"status": "merged"})).json()
            assert [i["merge_reason"] for i in listed["items"]] == ["Same tax number"]
        with app_eng.begin() as conn:
            conn.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
            ev = conn.execute(text("SELECT event_type, reason FROM mdm_merge_events")).fetchall()
            assert [(e.event_type, e.reason) for e in ev] == [("merge", "Same tax number")]

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


def test_survivorship_save_keeps_ai_inferred_on_postgres(app_engine):  # noqa: F811
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.survivorship_rules import router

    owner, app_eng = app_engine
    tid, *_ = _seed_tenant(owner, app_eng)
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO survivorship_rules (tenant_id, domain, field, rule_type, trusted_sources, ai_inferred) "
                       "VALUES (:t, :d, 'NAME_ORG1', 'trusted_source', '{PRD}', true), "
                       "(:t, :d, 'CITY1', 'most_recent', NULL, true)"), {"t": tid, "d": DOMAIN})
    aeng, factory = _session_factory(app_eng)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "SRC", [])

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            r = await c.put("/api/v1/survivorship-rules", headers={"X-User-Role": "steward"}, json={
                "domain": DOMAIN, "rules": [
                    {"field": "NAME_ORG1", "rule_type": "trusted_source", "trusted_sources": ["PRD"]},
                    {"field": "CITY1", "rule_type": "most_frequent"}]})
            assert r.status_code == 200, r.text
            assert {x["field"]: x["ai_inferred"] for x in r.json()["rules"]} == {"NAME_ORG1": True, "CITY1": False}

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


def test_an_upload_attached_to_a_trusted_system_never_wins_as_it_nor_becomes_a_writeback_target(app_engine):  # noqa: F811
    """A hand-made file attached to PRD carries origin "upload": it loses to a lower-trust system's
    extraction, and golden write-back never targets PRD for it (also for a legacy untagged entry)."""
    from sqlalchemy import text

    from api.services.golden_record_engine import process_sync_batch
    from api.services.golden_writeback import resolve_targets
    from workers.tasks.build_golden_records import _rows_to_incoming, _run_origin, _run_system

    import pandas as pd

    owner, app_eng = app_engine
    tid, prd, s4p, v_prd, v_s4p = _seed_tenant(owner, app_eng)
    v_up = str(uuid.uuid4())
    with app_eng.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tid})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": v_up, "t": tid, "m": json.dumps({"system_id": prd, "upload_path": "uploads/x.csv"})})
        c.execute(text("INSERT INTO survivorship_rules (tenant_id, domain, field, rule_type, trusted_sources) "
                       "VALUES (:t, :d, 'NAME_ORG1', 'trusted_source', '{PRD,S4P}')"), {"t": tid, "d": DOMAIN})
    aeng, factory = _session_factory(app_eng)

    async def batch(db, vid, key, fields, when):
        sid, name = await _run_system(db, vid, tid)
        origin = await _run_origin(db, vid, tid)
        rec = _rows_to_incoming(pd.DataFrame([fields]), f"upload:{vid[:8]}", sid, name, origin)
        for r in rec:
            r["extracted_at"] = when
        return await process_sync_batch(db, tid, DOMAIN, key, rec, use_ai=False)

    async def scenario():
        async with factory() as db:
            await _rls(db, tid)
            assert await _run_origin(db, v_up, tid) == "upload"
            assert await _run_origin(db, v_prd, tid) is None
            await batch(db, v_s4p, "500", {"NAME_ORG1": "From S4P"}, "2026-01-01T00:00:00+00:00")
            await batch(db, v_up, "500", {"NAME_ORG1": "Forged"}, "2026-02-01T00:00:00+00:00")
            await batch(db, v_up, "600", {"NAME_ORG1": "Only upload"}, "2026-02-01T00:00:00+00:00")
        rows = _rows(app_eng, tid)
        assert rows["500"].golden_fields["NAME_ORG1"] == "From S4P"  # PRD ranks first, but the file is not PRD
        up = rows["600"].source_contributions["NAME_ORG1"]
        assert up["origin"] == "upload" and up["source_system_id"] == prd
        async with factory() as db:
            await _rls(db, tid)
            targets, _ = await resolve_targets(db, tid, rows["600"].source_contributions)
            assert targets == []
            legacy = {"NAME_ORG1": {k: v for k, v in up.items() if k != "origin"}}  # written before tagging
            targets, unresolved = await resolve_targets(db, tid, legacy)
            assert targets == [] and unresolved == [f"upload:{v_up[:8]}"]
            extracted = {"NAME_ORG1": {"value": "x", "source_system": f"upload:{v_prd[:8]}"}}
            targets, _ = await resolve_targets(db, tid, extracted)
            assert [t["system_id"] for t in targets] == [prd]

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    asyncio.run(main())
