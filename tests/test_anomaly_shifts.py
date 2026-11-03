"""Null spikes and unexpected codes from run statistics: detection is pure; storage is per tenant and run.

The storage test needs MERIDIAN_TEST_DB_URL (a database migrated to head) and is skipped otherwise.
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api.services import anomaly_shifts as sh


def stats(blank=0, rows=1000, codes=None, masked=False):
    tv = [{"value": c, "count": n} for c, n in (codes or {}).items()]
    return {"rows": rows, "blank": blank, "blank_pct": round(blank / rows * 100, 2), "distinct": len(tv),
            "masked": masked, "top_values": None if masked else tv}


def kinds(cur, *prior):
    return {s["kind"]: s for s in sh.detect(cur, list(prior))}


def test_null_spike_needs_a_rise_of_ten_points():
    assert kinds(stats(blank=50), stats(blank=45)) == {}
    s = kinds(stats(blank=300), stats(blank=20))["null_spike"]
    assert s["severity"] == "high"  # 28 points
    assert kinds(stats(blank=600), stats(blank=20))["null_spike"]["severity"] == "critical"
    assert kinds(stats(blank=0), stats(blank=500)) == {}  # a fall is not a spike


def test_small_runs_are_not_compared():
    assert sh.detect(stats(blank=40, rows=50), [stats(rows=50)]) == []
    assert sh.detect(stats(blank=900), []) == []  # no earlier run


def test_unexpected_code_is_one_no_earlier_run_listed():
    prior = [stats(codes={"A": 600, "B": 400}), stats(codes={"A": 500, "B": 400, "C": 100})]
    assert kinds(stats(codes={"A": 600, "C": 380, "D": 20}), *prior) == {  # C was seen two runs ago, D never
        "unexpected_code": {"kind": "unexpected_code", "severity": "medium",
                            "codes": [{"value": "D", "count": 20}]}}
    s = kinds(stats(codes={"A": 600, "B": 300, "D": 100}), *prior)["unexpected_code"]
    assert s["severity"] == "high" and s["codes"] == [{"value": "D", "count": 100}]


def test_codes_are_not_judged_when_the_earlier_list_was_cut_or_masked():
    cut = stats(codes={"A": 600, "B": 400})
    cut["distinct"] = 40  # the profile listed only the top values: the rest are unknown
    assert kinds(stats(codes={"A": 1, "Z": 999}), cut) == {}
    assert kinds(stats(codes={"A": 1, "Z": 999}), stats(masked=True)) == {}
    assert kinds(stats(masked=True), stats(codes={"A": 1})) == {}


def _fill(c, t, v, run_at, blank, codes):
    c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata, dqs_summary) VALUES "
                   "(:v, :t, 'complete', :at, CAST(:m AS jsonb), '{}'::jsonb)"),
              {"v": v, "t": t, "at": run_at, "m": json.dumps({"system_id": "S1"})})
    for field, s in (("LAND1", stats(blank=blank, codes=codes)),):
        c.execute(text("INSERT INTO field_profiles (tenant_id, version_id, module, table_name, field, stats) "
                       "VALUES (:t, :v, 'business_partner', 'LFA1', :f, CAST(:s AS jsonb))"),
                  {"t": t, "v": v, "f": field, "s": json.dumps(s)})


@pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
def test_shifts_are_stored_per_tenant_and_run():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    va1, va2, vb1, vb2 = (str(uuid.uuid4()) for _ in range(4))
    try:
        with engine.begin() as c:
            for t in (a, b):
                c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": t})
            _fill(c, a, va1, "2026-01-01", 10, {"DE": 600, "ZA": 390})
            _fill(c, a, va2, "2026-02-01", 400, {"DE": 300, "ZA": 290, "XX": 10})
            _fill(c, b, vb1, "2026-01-01", 10, {"DE": 600, "ZA": 390})
            _fill(c, b, vb2, "2026-02-01", 10, {"DE": 600, "ZA": 390})
        with Session(engine) as s:
            s.execute(text("SET app.tenant_id = :t"), {"t": a})
            assert sh.detect_and_store(s, a, va2, "business_partner") == 2
            assert sh.detect_and_store(s, a, va2, "business_partner") == 2  # idempotent
            s.execute(text("SET app.tenant_id = :t"), {"t": b})
            assert sh.detect_and_store(s, b, vb2, "business_partner") == 0
            s.commit()
        with engine.begin() as c:
            rows = c.execute(text("SELECT tenant_id::text, version_id::text, prev_version_id::text, kind, previous "
                                  "FROM field_shift_anomalies WHERE tenant_id IN (:a, :b)"), {"a": a, "b": b}).fetchall()
            forced = c.execute(text("SELECT relforcerowsecurity FROM pg_class WHERE relname = 'field_shift_anomalies'")
                               ).scalar()
        assert {r[3] for r in rows} == {"null_spike", "unexpected_code"}
        assert all(r[0] == a and r[1] == va2 and r[2] == va1 for r in rows)
        assert rows[0][4]["rows"] == 1000 and forced is True
    finally:
        with engine.begin() as c:
            for t in (a, b):
                c.execute(text("DELETE FROM field_shift_anomalies WHERE tenant_id = :t"), {"t": t})
                c.execute(text("DELETE FROM field_profiles WHERE tenant_id = :t"), {"t": t})
                c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": t})
                c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": t})
