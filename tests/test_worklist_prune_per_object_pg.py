"""worklist.prune keeps the newest work lists of each object of a system, not of the system (acceptance run, October 2026).

Three runs of one system, objects run apart: material master, then business partner twice. Pruning by system kept
the two business partner runs and dropped material master's only (current) work list.

PG tests are skipped without MERIDIAN_TEST_DB_URL.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api.services.worklist import KEEP_RUNS, prune

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

T0 = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


def test_prune_counts_runs_per_object() -> None:
    assert KEEP_RUNS == 2
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t, sid = str(uuid.uuid4()), str(uuid.uuid4())
    runs = [("mm", "material_master", 0), ("bp1", "business_partner", 10), ("bp2", "business_partner", 20),
            ("bp3", "business_partner", 30)]
    ids = {name: str(uuid.uuid4()) for name, _, _ in runs}
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
            for name, module, minutes in runs:
                c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata) "
                               "VALUES (:id, :t, :l, 'complete', :r, CAST(:m AS jsonb))"),
                          {"id": ids[name], "t": t, "l": name, "r": T0 + timedelta(minutes=minutes),
                           "m": json.dumps({"system_id": sid})})
                c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, issues, "
                               "sev_rank, checks) VALUES (:t, :v, :s, :m, 'K=1', 1, 4, ARRAY['X001'])"),
                          {"t": t, "v": ids[name], "s": sid, "m": module})
        with Session(engine) as s:
            pruned = prune(s, {"tid": t, "scope": sid})
            s.commit()
        with engine.connect() as c:
            left = {r[0] for r in c.execute(text("SELECT DISTINCT version_id::text FROM work_records WHERE tenant_id = :t"),
                                            {"t": t})}
        assert pruned == 1
        assert left == {ids["mm"], ids["bp2"], ids["bp3"]}
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM work_records WHERE tenant_id = :t"), {"t": t})
            c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": t})
            c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})
