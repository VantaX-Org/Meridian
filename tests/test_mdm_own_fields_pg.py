"""A merge cluster's own_fields across sync and unmerge, against a real Postgres (RLS enforced).

- a sync of a cluster head refreshes its own pre-merge values from its own base, never from the fused
  golden values, so merged members' values do not leak into the head's own_fields;
- unmerge clears own_fields / own_contributions on split records and on a head left with no members,
  so they take sync updates to golden_fields again.

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from tests.test_mdm_source_system_pg import _rls, _rows, _session_factory
from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

DOMAIN = "business_partner"


def test_sync_and_unmerge_keep_own_fields_own(app_engine):  # noqa: F811
    from sqlalchemy import text

    from api.services import mdm_merge
    from api.services.golden_record_engine import process_sync_batch

    owner, app_eng = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'OWN')"), {"t": tid})
    aeng, factory = _session_factory(app_eng)

    async def sync(db, key, fields, when):
        rec = [{"source_system": "PRD", "extracted_at": when, "fields": fields}]
        assert await process_sync_batch(db, tid, DOMAIN, key, rec, use_ai=False)

    async def scenario():
        async with factory() as db:
            await _rls(db, tid)
            await sync(db, "A", {"NAME_ORG1": "Acme", "CITY1": "Durban"}, "2026-01-01T00:00:00+00:00")
            await sync(db, "B", {"NAME_ORG1": "ACME", "TAXNUM": "ZA1"}, "2026-01-01T00:00:00+00:00")
            await mdm_merge.merge_master_records(db, tid, DOMAIN, "A", "B", None, reason="same partner")
            await db.commit()
        head = _rows(app_eng, tid)["A"]
        assert head.golden_fields["TAXNUM"] == "ZA1"
        assert "TAXNUM" not in head.own_fields

        # a sync of the head refreshes its own values only; B's TAXNUM stays out of A's own_fields
        async with factory() as db:
            await _rls(db, tid)
            await sync(db, "A", {"CITY1": "Cape Town"}, "2026-02-01T00:00:00+00:00")
        head = _rows(app_eng, tid)["A"]
        assert head.own_fields == {"NAME_ORG1": "Acme", "CITY1": "Cape Town"}
        assert "TAXNUM" not in head.own_contributions
        assert head.golden_fields["TAXNUM"] == "ZA1"  # the fused value stays on the golden record

        async with factory() as db:
            await _rls(db, tid)
            await mdm_merge.unmerge(db, tid, str(head.id), ["B"], None, "different partner")
            await db.commit()
        rows = _rows(app_eng, tid)
        for k in ("A", "B"):
            assert rows[k].own_fields is None and rows[k].own_contributions is None, k
        assert rows["A"].golden_fields == {"NAME_ORG1": "Acme", "CITY1": "Cape Town"}
        assert rows["B"].golden_fields == {"NAME_ORG1": "ACME", "TAXNUM": "ZA1"}

        # both are standalone again: a sync updates their golden values
        async with factory() as db:
            await _rls(db, tid)
            await sync(db, "A", {"CITY1": "Joburg"}, "2026-03-01T00:00:00+00:00")
            await sync(db, "B", {"TAXNUM": "ZA2"}, "2026-03-01T00:00:00+00:00")
        rows = _rows(app_eng, tid)
        assert rows["A"].golden_fields["CITY1"] == "Joburg" and rows["A"].own_fields is None
        assert rows["B"].golden_fields["TAXNUM"] == "ZA2" and rows["B"].own_fields is None

    async def main():
        try:
            await scenario()
        finally:
            await aeng.dispose()

    asyncio.run(main())
