"""Learned monitors: baseline math, break detection per metric, steward decisions on the baseline, explanation."""

from datetime import datetime, timedelta, timezone

from api.services import learned_monitors as lm

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def pts(vals, start=T0):
    return [(f"r{i}", start + timedelta(days=i), v) for i, v in enumerate(vals)]


def test_too_few_runs_refuses_a_baseline():
    assert lm.baseline(pts([100] * (lm.MIN_RUNS - 1)), T0 + timedelta(days=30), rel=0.3) is None


def test_baseline_reports_runs_median_and_band():
    b = lm.baseline(pts([100, 102, 98, 101, 99, 100]), T0 + timedelta(days=9), rel=0.3, min_spread=0.02)
    assert b["runs"] == 6 and len(b["run_ids"]) == 6 and b["median"] == 100 and b["low"] < 98 and b["high"] > 102


def test_baseline_uses_only_the_last_history_runs():
    b = lm.baseline(pts(list(range(50))), T0 + timedelta(days=60), rel=0.3)
    assert b["runs"] <= lm.HISTORY and set(b["run_ids"]) <= {f"r{i}" for i in range(20, 50)}


def test_weekday_seasonality_needs_enough_runs():
    few = lm.baseline(pts([1] * 10), T0 + timedelta(days=14), rel=0.3)
    assert few["method"] != "mad_weekday"
    many = lm.baseline(pts([1] * 35), T0 + timedelta(days=40), rel=0.3)
    assert many["method"] == "mad_weekday" and many["runs"] < 35


def _base(vals, metric):
    return lm.baseline(pts(vals), T0 + timedelta(days=30), **lm.SETTINGS[metric])


def test_volume_drop_and_spike():
    b = _base([1000, 1010, 990, 1005, 995, 1000], "records")
    d = lm.judge("records", "", 400, b)
    assert d["kind"] == "volume_drop" and d["severity"] in ("high", "critical") and d["baseline_runs"] == 6
    assert lm.judge("records", "", 2000, b)["kind"] == "volume_spike"
    assert lm.judge("records", "", 1003, b) is None


def test_score_drop_needs_a_real_drop():
    b = _base([90, 90.1, 89.9, 90, 90.05, 90], "score")
    assert lm.judge("score", "", 80, b)["kind"] == "score_drop"
    assert lm.judge("score", "", 89.5, b) is None
    assert lm.judge("score", "", 95, b) is None  # an improvement is not a break


def test_fail_rate_jump_only_upward():
    b = _base([5, 5.2, 4.9, 5.1, 5, 5.05], "fail_rate")
    assert lm.judge("fail_rate", "R1", 30, b)["kind"] == "fail_rate_jump"
    assert lm.judge("fail_rate", "R1", 1, b) is None


def test_field_emptied():
    b = _base([2, 3, 2, 4, 3, 2], "blank_pct")
    j = lm.judge("blank_pct", "MARA.MATKL", 100, b)
    assert j["kind"] == "field_emptied" and j["severity"] == "critical"
    assert lm.judge("blank_pct", "MARA.MATKL", 40, b) is None
    already = _base([97, 98, 96, 99, 97, 98], "blank_pct")
    assert lm.judge("blank_pct", "MARA.MATKL", 100, already) is None  # was never populated


def test_decisions_exclude_and_accept():
    p = pts([10, 11, 12, 13, 14, 100])
    when = {x[0]: x[1] for x in p}
    assert [x[0] for x in lm.apply_decisions(p, [("r5", "exclude")], when)] == ["r0", "r1", "r2", "r3", "r4"]
    assert [x[0] for x in lm.apply_decisions(p, [("r3", "accept")], when)] == ["r3", "r4", "r5"]


def test_explanation_template_is_grounded_and_model_is_checked():
    b = {"kind": "fail_rate_jump", "metric": "fail_rate", "subject_code": "R1", "expected_low": 3.0,
         "expected_high": 7.0, "median": 5.0, "observed": 30.0, "baseline_runs": 6, "method": "mad"}
    f = lm.facts(b, "Plant is blank")
    e = lm.explanation(f, None)
    assert e["source"] == "template" and e["sentences"] and "R1" in e["sentences"][0]
    assert all(set(lm._NUM.findall(s)) <= set(lm._NUM.findall(" ".join(lm.template_explanation(f)))) for s in e["sentences"])
    kept = lm.explanation(f, ["The fail rate rose to 30.0%.", "It was 99 yesterday."])
    assert kept["source"] == "ai" and kept["sentences"] == ["The fail rate rose to 30.0%."] and kept["dropped"] == 1
    assert lm.explanation(f, ["It was 99 yesterday."])["source"] == "template"
    assert "value" not in f and "records" not in str(sorted(f)).replace("records", "")
