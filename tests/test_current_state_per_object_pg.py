"""The current state keeps every object of a system when its objects are run apart (acceptance run, October 2026).

A system's business partner and material master uploaded one after the other are two runs of one lineage. Taking
only the system's newest run dropped material master from the current state, and an older upload without a system
stood in for it on Work, Home and every scope=current screen, while the landscape showed the system's own run.

PG tests are skipped without MERIDIAN_TEST_DB_URL.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from api.services.current_state import CURRENT_PAIRS_AS_OF_SQL, CURRENT_PAIRS_SQL, CURRENT_RUNS_SQL

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

T0 = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


@pytest.fixture
def tenant():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t, sid = str(uuid.uuid4()), str(uuid.uuid4())
    ids = {k: str(uuid.uuid4()) for k in ("upload_mm", "sys_mm", "sys_bp1", "sys_bp2")}
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})

        def run(name: str, minutes: int, module: str, system: str | None) -> None:
            md = {"modules": [module], **({"system_id": system} if system else {})}
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:id, :t, :l, 'complete', :r, CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                      {"id": ids[name], "t": t, "l": name, "r": T0 + timedelta(minutes=minutes),
                       "m": json.dumps(md), "q": json.dumps({module: {"composite_score": 70.0}})})

        run("upload_mm", 0, "material_master", None)
        run("sys_bp1", 10, "business_partner", sid)
        run("sys_mm", 20, "material_master", sid)
        run("sys_bp2", 30, "business_partner", sid)
    yield engine, t, ids
    with engine.begin() as c:
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": t})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})


def test_each_object_of_a_system_is_read_from_its_own_newest_run(tenant) -> None:
    engine, t, ids = tenant
    with engine.connect() as c:
        pairs = dict(c.execute(text(CURRENT_PAIRS_SQL), {"t": t, "m": None}).fetchall())
        runs = {str(r[0]) for r in c.execute(text(CURRENT_RUNS_SQL), {"t": t}).fetchall()}
    assert pairs == {"business_partner": ids["sys_bp2"], "material_master": ids["sys_mm"]}
    assert ids["sys_bp1"] not in runs and {ids["sys_bp2"], ids["sys_mm"]} <= runs


def test_as_of_an_earlier_run_reads_the_state_then(tenant) -> None:
    engine, t, ids = tenant
    with engine.connect() as c:
        pairs = dict(c.execute(text(CURRENT_PAIRS_AS_OF_SQL), {"t": t, "m": None, "asof": ids["sys_bp1"]}).fetchall())
    assert pairs == {"business_partner": ids["sys_bp1"], "material_master": ids["upload_mm"]}
