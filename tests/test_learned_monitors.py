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
    return lm.baseline(pts(vals), T0 + timedelta(days=30), **lm.settings(metric))


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


# -- learned minimum effect ---------------------------------------------------------------------------------------------

def ev(decision, effect, i=0):
    return {"id": f"b{i}", "run_number": i, "decision": decision, "effect": effect, "decided_by": "s", "decided_at": T0}


def test_no_decisions_means_the_fixed_floor():
    L = lm.learn("fail_rate", [])
    assert L["min_effect"] == lm.RATE_MIN_RISE == L["floor"] and L["ceiling"] == lm.RATE_MIN_RISE * lm.CEILING_MULT


def test_expected_break_raises_the_minimum_just_above_the_largest_expected_effect():
    L = lm.learn("fail_rate", [ev("expected", 3.0, 1), ev("expected", 4.0, 2), ev("expected", 3.5, 3)])
    assert L["min_effect"] == 4.0 * lm.LEARN_MARGIN and [m["result"] for m in L["moves"]] == ["raised", "raised", "kept"]


def test_ceiling_stops_a_monitor_being_silenced():
    L = lm.learn("score", [ev("expected", 50.0)])
    assert L["min_effect"] == lm.SCORE_MIN_DROP * lm.CEILING_MULT
    b = _base([90, 90.1, 89.9, 90, 90.05, 90], "score")
    assert lm.judge("score", "", 80, b, L["min_effect"])["kind"] == "score_drop"  # a 10 point drop still fires


def test_confirmed_real_break_at_a_smaller_effect_lowers_it_but_never_below_the_floor():
    up = [ev("expected", 5.0, 1)]
    assert lm.learn("fail_rate", up + [ev("confirmed", 3.0, 2)])["min_effect"] == 3.0
    L = lm.learn("fail_rate", up + [ev("confirmed", 0.5, 2)])
    assert L["min_effect"] == lm.RATE_MIN_RISE and L["moves"][-1]["result"] == "lowered"
    assert lm.learn("fail_rate", up + [ev("confirmed", 9.0, 2)])["min_effect"] == 5.0 * lm.LEARN_MARGIN  # larger: no change


def test_raised_minimum_suppresses_small_breaks_and_scales_severity():
    b = _base([1.0, 1.1, 0.9, 1.0, 1.05, 1.0], "fail_rate")
    assert lm.judge("fail_rate", "R1", 6.0, b)["kind"] == "fail_rate_jump"
    assert lm.judge("fail_rate", "R1", 6.0, b, 5.25) is None
    assert lm.judge("fail_rate", "R1", 12.0, b)["severity"] == "high"       # effect 11 >= 10
    assert lm.judge("fail_rate", "R1", 12.0, b, 5.25)["severity"] == "medium"  # cuts scaled by 5.25 / 2


def test_a_raised_minimum_never_stops_a_total_loss_being_critical():
    b = _base([1000, 1010, 990, 1000, 1005, 1000], "records")
    assert lm.judge("records", "", 0.0, b, 0.9)["severity"] == "critical"   # effect 1.0, minimum at the ceiling
    assert lm.judge("records", "", 0.0, b, 0.9)["kind"] == "volume_drop"


def test_effect_is_in_each_metrics_own_unit():
    assert lm.effect_of("records", 700, 1000) == 0.3 and lm.effect_of("score", 85, 90) == 5 and lm.effect_of("fail_rate", 7, 2) == 5


def test_events_are_per_monitor_and_map_status_to_decision():
    rows = [("a", 3, "mm", "fail_rate", "R1", "expected", 9.0, 2.0, "s", T0),
            ("b", 4, "mm", "fail_rate", "R2", "acknowledged", 6.0, 2.0, "s", T0)]
    out = lm.monitor_events(rows)
    assert out[("mm", "fail_rate", "R1")][0]["decision"] == "expected" and out[("mm", "fail_rate", "R1")][0]["effect"] == 7.0
    assert out[("mm", "fail_rate", "R2")][0]["decision"] == "confirmed"


def test_events_query_filters_tenant_and_window():
    assert "b.tenant_id = :tid" in lm.EVENTS_SQL and "v.tenant_id = b.tenant_id" in lm.EVENTS_SQL and "decided_at >= :since" in lm.EVENTS_SQL


# -- below-minimum storage, empty share and distinct share learn too -----------------------------------------------------

def test_a_break_under_a_raised_minimum_is_kept_only_on_request_and_marked():
    b = _base([1.0, 1.1, 0.9, 1.0, 1.05, 1.0], "fail_rate")
    assert lm.judge("fail_rate", "R1", 6.0, b, 5.25) is None
    j = lm.judge("fail_rate", "R1", 6.0, b, 5.25, keep_suppressed=True)
    assert j["below_minimum"] is True and j["kind"] == "fail_rate_jump"
    assert lm.judge("fail_rate", "R1", 12.0, b, 5.25, keep_suppressed=True)["below_minimum"] is False
    assert lm.judge("fail_rate", "R1", 1.0, b, 5.25, keep_suppressed=True) is None  # inside the band: nothing to keep


def test_empty_share_has_an_effect_and_fires_exactly_as_before_at_the_floor():
    assert lm.FLOOR["blank_pct"] == lm.EMPTY_AT - lm.POPULATED_BELOW
    assert lm.effect_of("blank_pct", 100, 4) == 96
    b = _base([49, 48, 49.5, 49, 48.5, 49], "blank_pct")          # just under POPULATED_BELOW, the narrowest case
    j = lm.judge("blank_pct", "MARA.MATKL", 95, b)
    assert j["kind"] == "field_emptied" and not j["below_minimum"]
    assert lm.judge("blank_pct", "MARA.MATKL", 94.9, b) is None
    assert lm.judge("blank_pct", "MARA.MATKL", 100, _base([2, 3, 2, 4, 3, 2], "blank_pct"))["severity"] == "critical"


def test_empty_share_learns_from_decisions_within_its_own_ceiling():
    L = lm.learn("blank_pct", [ev("expected", 70.0, 1)])
    assert L["min_effect"] == 70.0 * lm.LEARN_MARGIN and L["ceiling"] == 90.0
    assert lm.learn("blank_pct", [ev("expected", 99.0, 1)])["min_effect"] == 90.0
    assert lm.learn("blank_pct", [ev("expected", 80.0, 1), ev("confirmed", 60.0, 2)])["min_effect"] == 60.0
    b = _base([2, 3, 2, 4, 3, 2], "blank_pct")
    assert lm.judge("blank_pct", "T.F", 70, b, 84.0) is None      # under the raised minimum (and under EMPTY_AT)
    assert lm.judge("blank_pct", "T.F", 100, b, 84.0)["severity"] == "critical"


def test_distinct_share_shift_fires_either_way_and_only_from_aggregates():
    b = _base([80, 81, 79, 80.5, 79.5, 80], "distinct_pct")
    drop = lm.judge("distinct_pct", "MARA.MATKL", 5, b)
    assert drop["kind"] == "cardinality_shift" and drop["metric"] == "distinct_pct" and drop["severity"] == "critical"
    assert lm.judge("distinct_pct", "MARA.MATKL", 40, b)["severity"] == "high"       # 40 points
    assert lm.judge("distinct_pct", "MARA.MATKL", 55, b)["severity"] == "medium"     # 25 points
    assert lm.judge("distinct_pct", "MARA.MATKL", 99, b) is None                 # 19 points: under the floor
    up = lm.judge("distinct_pct", "MARA.MATKL", 100, _base([30, 31, 29, 30, 30.5, 29.5], "distinct_pct"))
    assert up["kind"] == "cardinality_shift"
    assert lm.effect_of("distinct_pct", 5, 80) == 75 == lm.effect_of("distinct_pct", 155, 80)
    assert lm.learn("distinct_pct", [])["min_effect"] == lm.DISTINCT_MIN_SHIFT


def test_distinct_share_explanation_is_grounded():
    b = {"kind": "cardinality_shift", "metric": "distinct_pct", "subject_code": "MARA.MATKL", "expected_low": 77.0,
         "expected_high": 83.0, "median": 80.0, "observed": 5.0, "baseline_runs": 6, "method": "mad"}
    f = lm.facts(b, "Material group")
    e = lm.explanation(f, None)
    assert e["source"] == "template" and "MARA.MATKL" in e["sentences"][0] and "5.0" in e["sentences"][0]
    assert lm.explanation(f, ["The distinct share fell to 5.0%.", "It was 99 yesterday."])["dropped"] == 1


def test_events_cover_every_learned_metric():
    assert all(f"'{m}'" in lm.EVENTS_SQL for m in lm.LEARNED)
