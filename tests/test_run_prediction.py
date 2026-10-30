"""The run prediction maths (api/services/run_prediction.py): median records, median seconds per record, the band from
the spread of the tenant's own runs, the confidence, the cost and the queue positions."""
from __future__ import annotations

import pytest

from api.services import run_prediction as rp


def test_percentile_interpolates():
    assert rp.percentile([4, 1, 3, 2], 0.25) == pytest.approx(1.75)
    assert rp.percentile([4, 1, 3, 2], 0.75) == pytest.approx(3.25)
    assert rp.percentile([5], 0.5) == 5


def test_eight_runs_median_and_interquartile_band():
    secs = [100, 110, 90, 120, 100, 95, 105, 130]
    hist = [{"records": 1000, "run_records": 1000, "seconds": s} for s in secs]
    hist += [{"records": 1, "run_records": 1, "seconds": 9999}]  # a ninth, older run is not read
    p = rp.predict_object(hist)
    assert p["runs"] == 8 and p["records"] == 1000 and p["confidence"] == "high"
    assert p["seconds"] == pytest.approx(102.5)
    assert p["seconds_low"] == pytest.approx(98.8, abs=0.06) and p["seconds_high"] == pytest.approx(112.5)


def test_linear_in_records_shared_by_the_run():
    # a run of 2000 records over two objects took 400 s: 0.2 s per record; this object checks 500 of them
    p = rp.predict_object([{"records": 500, "run_records": 2000, "seconds": 400}])
    assert p == {"runs": 1, "records": 500, "seconds": 100.0, "seconds_low": 100.0, "seconds_high": 100.0,
                 "seconds_per_record": 0.2, "confidence": "low"}


def test_few_runs_band_is_min_and_max():
    p = rp.predict_object([{"records": 200, "run_records": 200, "seconds": s} for s in (100, 120, 80)])
    assert (p["seconds"], p["seconds_low"], p["seconds_high"], p["confidence"]) == (100.0, 80.0, 120.0, "medium")


def test_no_history_predicts_nothing():
    assert rp.predict_object([])["confidence"] == "none"
    assert rp.predict_object([{"records": None, "run_records": 10, "seconds": 5}])["seconds"] is None


def test_cost_in_the_tenant_model():
    assert rp.cost_of({"per_hour": 36}, 3600, 10) == 36.0
    assert rp.cost_of({"per_hour": 36, "per_million_records": 10}, 1800, 2_000_000) == 38.0
    assert rp.cost_of(None, 100, 10) is None and rp.cost_of({}, 100, 10) is None


def test_queue_positions_in_registration_order():
    jobs = [{"id": "b", "status": "queued", "started_at": 2}, {"id": "r", "status": "running", "started_at": 0},
            {"id": "a", "status": "queued", "started_at": 1}]
    out = {j["id"]: j.get("queue_position") for j in rp.with_queue_positions(jobs)}
    assert out == {"a": 1, "b": 2, "r": None}
