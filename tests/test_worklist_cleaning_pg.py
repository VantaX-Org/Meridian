"""Cleaning-engine value proposals in the work list (api/services/worklist.py), against a real Postgres.

Built on the run of tests/test_worklist_pg.py (MM001 MARA.MEINS, MM002 MARA.MTART). Three more MM001 records:
  MATNR=3  an open cleaning proposal that gives MARA.MEINS a value        -> proposed, in sugg=1
  MATNR=4  a duplicate proposal (merge preview) naming it                  -> not a value: stays in Match review
  MATNR=5  a cleaning proposal that was rejected                           -> not open: not proposed
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.test_worklist_pg import HEADERS, USER, client_for, engines, run  # noqa: F401  (fixtures)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture
def cleaned(run, engines):  # noqa: F811
    owner, app = engines
    _, tid, vid, _ = run
    with owner.begin() as c:
        for key in ("MATNR=3", "MATNR=4", "MATNR=5"):
            c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                           "field_values) VALUES (:t, :v, 'MM001', 'material_master', 'MARA', :k, "
                           "CAST('{\"MARA.MEINS\": \"\"}' AS jsonb))"), {"t": tid, "v": vid, "k": key})
        for key, status, after, preview in (
            ("MATNR=3", "pending", {"MEINS": "PC"}, None),
            ("MATNR=4", "detected", {"MEINS": "XX"}, {"MEINS": {"a": "", "b": "EA", "survivor": "b"}}),
            ("MATNR=5", "rejected", {"MEINS": "PC"}, None),
        ):
            c.execute(text("""
                INSERT INTO cleaning_queue (tenant_id, object_type, record_key, status, confidence, record_data_after,
                                            merge_preview, check_id)
                VALUES (:t, 'material_master', :k, :s, 90, CAST(:a AS jsonb), CAST(:p AS jsonb), 'MM001')"""),
                      {"t": tid, "k": key, "s": status, "a": json.dumps(after), "p": json.dumps(preview)})
    from api.services import worklist
    with Session(app) as s:
        worklist.build(s, tid, vid, None)
    return owner, app, tid, vid


def _records(owner, vid):
    with owner.begin() as c:
        return {r.record_key: r for r in c.execute(text("SELECT * FROM work_records WHERE version_id = :v"), {"v": vid})}


def test_build_counts_an_open_cleaning_value_and_nothing_else(cleaned):
    owner, _, _, vid = cleaned
    recs = _records(owner, vid)
    assert recs["MATNR=3"].proposed == 1
    assert recs["MATNR=4"].proposed == 0  # a duplicate proposal carries no value
    assert recs["MATNR=5"].proposed == 0  # rejected: not open
    assert recs["MATNR=1"].proposed == 1 and recs["MATNR=2"].proposed == 1  # the rule sources are unchanged
    with owner.begin() as c:
        g = c.execute(text("SELECT proposed FROM work_groups WHERE version_id = :v AND check_id = 'MM001'"), {"v": vid}).scalar()
    assert g == 2  # MATNR=1 (auto fix) and MATNR=3 (cleaning)


def test_refresh_keeps_the_cleaning_proposal(cleaned):
    owner, app, tid, vid = cleaned
    from api.services import worklist
    with owner.begin() as c:
        scope = c.execute(text("SELECT scope FROM work_records WHERE version_id = :v LIMIT 1"), {"v": vid}).scalar()
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        worklist.refresh(s, tid, scope, [("MM001", "MATNR=3"), ("MM001", "MATNR=4")])
        s.commit()
    recs = _records(owner, vid)
    assert recs["MATNR=3"].proposed == 1 and recs["MATNR=4"].proposed == 0


@pytest.mark.anyio
async def test_sugg_filter_and_summary_include_the_cleaning_value(cleaned, client_for):  # noqa: F811
    owner, _, tid, vid = cleaned
    deps, client = client_for(tid)
    await deps.engine.dispose()
    async with client:
        get = lambda path, **params: client.get(f"/api/v1/work{path}", params={"version_id": vid, **params}, headers=HEADERS)
        items = (await get("/records", proposed="true")).json()["items"]
        by = {i["record_key"]: i for i in items}
        assert set(by) == {"MATNR=1", "MATNR=2", "MATNR=3"}  # not the duplicate's record, not the rejected one
        assert by["MATNR=3"]["suggested_value"] == "PC" and by["MATNR=3"]["proposed"] == 1
        assert (await get("/records", check_id="MM001", proposed="true")).json()["total"] == 3  # records with a proposal on any check
        groups = {g["check_id"]: g for g in (await get("/groups", proposed="true")).json()["groups"]}
        assert groups["MM001"]["proposed"] == 2
        s = (await get("/summary")).json()
        assert s["totals"]["proposed"] == 3
        # the record panel offers the same value, from the cleaning engine
        panel = (await get("/records/material_master/MATNR=3")).json()
        assert panel["issues"][0]["suggestion"]["value"] == "PC" and panel["issues"][0]["suggestion"]["source"] == "cleaning"
        dup = (await get("/records/material_master/MATNR=4")).json()
        assert dup["issues"][0]["suggestion"] is None  # a duplicate proposal is not a value
