"""``write_back`` against Postgres (spec §4.2). Skipped without MERIDIAN_TEST_DB_URL."""

from __future__ import annotations

import os
import subprocess
import uuid
from datetime import datetime, timezone

import pytest

pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pg
def test_write_back_points_events_at_generated_l5s() -> None:
    from sqlalchemy import create_engine, text

    from api.services.process_discovery.generate import write_back
    from api.services.process_discovery.mining import Scope
    from workers.db import tenant_session

    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"PDG-{tid[:8]}"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name) VALUES (:s, :t, 'S')"), {"s": sid, "t": tid})
    s = tenant_session(eng, tid)
    ts = datetime(2025, 1, 10, tzinfo=timezone.utc)
    rid = s.execute(text("INSERT INTO process_discovery_runs (tenant_id, system_id, l1, mode, status) "
                         "VALUES (:t, :s, 'PTP', 'full', 'mining') RETURNING id"), {"t": tid, "s": sid}).scalar()
    s.execute(text(
        "INSERT INTO process_events (tenant_id, system_id, l1, case_type, case_id, activity, l5_id, ts, ts_precision,"
        " seq, source_table, run_id) VALUES (:t, :s, 'PTP', 'po_item', :c, :a, :l5, :ts, 'second', 0, 'EKPO', :r)"),
        [{"t": tid, "s": sid, "r": rid, "c": c, "a": a, "l5": l5, "ts": ts} for c, a, l5 in (
            ("1", "ZZ_NEW", None), ("2", "ZZ_NEW", None), ("1", "GOODS_RECEIPT", "PTP-GR-MIGO-01"))])
    l5_of = {("po_item", "ZZ_NEW"): "PTP-DSC-ZZ_NEW-01", ("po_item", "GOODS_RECEIPT"): "PTP-GR-MIGO-01"}
    assert write_back(s, Scope(tid, sid, "PTP"), l5_of) == 2  # the unchanged row is not rewritten
    s.commit()
    rows = s.execute(text("SELECT activity, l5_id FROM process_events WHERE system_id = :s ORDER BY activity, case_id"),
                     {"s": sid}).all()
    assert [tuple(x) for x in rows] == [("GOODS_RECEIPT", "PTP-GR-MIGO-01"), ("ZZ_NEW", "PTP-DSC-ZZ_NEW-01"),
                                        ("ZZ_NEW", "PTP-DSC-ZZ_NEW-01")]
    assert write_back(s, Scope(tid, sid, "PTP"), {}) == 0
    s.close()
    eng.dispose()
