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
    assert all(f"'{m}'" in lm.EVENTS_SQL for m in lm.FLOOR)


# -- value patterns and ranges ------------------------------------------------------------------------------------------

D = 739000.0  # a date as days (proleptic ordinal), around 2024


def test_pattern_shift_fires_only_upward_and_over_ten_points():
    b = _base([2, 3, 2.5, 3, 2, 2.5], "pattern_pct")
    j = lm.judge("pattern_pct", "MARA.MTART", 20, b)
    assert j["kind"] == "pattern_shift" and j["metric"] == "pattern_pct" and j["severity"] == "medium"
    assert lm.judge("pattern_pct", "MARA.MTART", 80, b)["severity"] == "critical"
    assert lm.judge("pattern_pct", "MARA.MTART", 8, b) is None      # under the 10 point floor
    assert lm.judge("pattern_pct", "MARA.MTART", 0, b) is None      # fewer odd shapes is not a break
    assert lm.judge("pattern_pct", "MARA.MTART", 2.7, _base([2, 3, 2.5, 3, 2, 2.5], "pattern_pct")) is None  # stable


def test_format_break_fires_only_upward_and_over_five_points():
    b = _base([0, 0.1, 0, 0.2, 0, 0.1], "unparse_pct")
    j = lm.judge("unparse_pct", "MARA.NTGEW", 12, b)
    assert j["kind"] == "format_break" and j["metric"] == "unparse_pct"
    assert lm.judge("unparse_pct", "MARA.NTGEW", 4, b) is None
    assert lm.judge("unparse_pct", "MARA.NTGEW", 0, b) is None


def test_numeric_range_moves_both_ways_for_the_mean_and_one_way_for_max_and_min():
    mean = _base([100, 101, 99, 100, 100.5, 99.5], "num_mean")
    assert lm.judge("num_mean", "MARA.BRGEW", 400, mean)["kind"] == "range_shift"
    assert lm.judge("num_mean", "MARA.BRGEW", 20, mean)["kind"] == "range_shift"
    assert lm.judge("num_mean", "MARA.BRGEW", 120, mean) is None      # 20 percent: under the 50 percent floor
    mx = _base([1000, 1010, 990, 1000, 1005, 995], "num_max")
    assert lm.judge("num_max", "MARA.BRGEW", 5000, mx)["kind"] == "range_shift"
    assert lm.judge("num_max", "MARA.BRGEW", 10, mx) is None          # a lower largest value is not a break
    mn = _base([10, 10.1, 9.9, 10, 10, 10.05], "num_min")
    assert lm.judge("num_min", "MARA.BRGEW", -500, mn)["kind"] == "range_shift"
    assert lm.judge("num_min", "MARA.BRGEW", 500, mn) is None
    assert lm.effect_of("num_mean", 150, 100) == 50 == lm.effect_of("num_mean", 50, 100)
    assert lm.effect_of("num_mean", 5, 0) == 0.0                      # a zero median has no relative size


def test_a_date_moving_forward_is_silent_but_falling_back_a_year_fires():
    mx = _base([D, D + 30, D + 60, D + 90, D + 120, D + 150], "date_max")
    assert lm.judge("date_max", "MARA.LAEDA", D + 150 + 30, mx) is None      # the latest date grew with new records
    assert lm.judge("date_max", "MARA.LAEDA", D + 150 + 4000, mx) is None    # forward is never a break
    assert lm.judge("date_max", "MARA.LAEDA", D - 800, mx)["kind"] == "range_shift"
    assert lm.judge("date_max", "MARA.LAEDA", D - 200, mx) is None           # under 365 days
    mn = _base([D, D, D, D + 1, D, D], "date_min")
    assert lm.judge("date_min", "MARA.ERSDA", D - 5000, mn)["kind"] == "range_shift"
    assert lm.judge("date_min", "MARA.ERSDA", D + 5000, mn) is None                 # an earliest date that rises is not a break
    assert lm.effect_of("date_max", D - 800, D + 75) == 875


def test_a_stable_field_is_silent_on_every_new_metric():
    for m, vals, obs in (("pattern_pct", [2, 3, 2.5, 3, 2, 2.5], 2.6), ("unparse_pct", [0, 0.1, 0, 0.2, 0, 0.1], 0.1),
                         ("num_mean", [100, 101, 99, 100, 100.5, 99.5], 100.2), ("num_max", [1000, 1010, 990, 1000, 1005, 995], 1002),
                         ("num_min", [10, 10.1, 9.9, 10, 10, 10.05], 10.02), ("date_max", [D, D + 1, D, D + 2, D, D + 1], D + 1),
                         ("date_min", [D, D, D, D + 1, D, D], D)):
        assert lm.judge(m, "MARA.X", obs, _base(vals, m)) is None, m


def test_range_severity_follows_the_size_of_the_move():
    mean = _base([100, 101, 99, 100, 100.5, 99.5], "num_mean")
    assert lm.judge("num_mean", "T.F", 160, mean)["severity"] == "medium"
    assert lm.judge("num_mean", "T.F", 250, mean)["severity"] == "high"
    assert lm.judge("num_mean", "T.F", 400, mean)["severity"] == "critical"
    mx = _base([D, D, D + 1, D, D, D], "date_max")
    assert lm.judge("date_max", "T.F", D - 400, mx)["severity"] == "medium"
    assert lm.judge("date_max", "T.F", D - 4000, mx)["severity"] == "critical"


def test_below_minimum_and_learning_work_for_the_new_metrics():
    b = _base([100, 101, 99, 100, 100.5, 99.5], "num_mean")
    assert lm.judge("num_mean", "T.F", 160, b, 80.0) is None                      # 60 percent under a raised 80
    k = lm.judge("num_mean", "T.F", 160, b, 80.0, keep_suppressed=True)
    assert k["below_minimum"] is True and k["kind"] == "range_shift"
    assert lm.learn("num_mean", [ev("expected", 80.0, 1)])["min_effect"] == 80.0 * lm.LEARN_MARGIN
    assert lm.learn("date_max", [ev("confirmed", 100.0, 1)])["min_effect"] == lm.RANGE_MIN_DAYS    # never below the floor
    assert lm.learn("pattern_pct", [ev("expected", 20.0, 1)])["min_effect"] == 20.0 * lm.LEARN_MARGIN
    assert lm.learn("unparse_pct", [])["min_effect"] == lm.UNPARSE_MIN_RISE
    # a raised pattern minimum silences a break a lower one would raise
    p = _base([2, 3, 2.5, 3, 2, 2.5], "pattern_pct")
    assert lm.judge("pattern_pct", "T.F", 20, p, 25.0) is None
    assert lm.judge("pattern_pct", "T.F", 20, p, 25.0, keep_suppressed=True)["below_minimum"] is True


def test_usual_shapes_are_those_in_half_the_earlier_runs_and_a_new_shape_shows_up_as_outside():
    stable = {f"r{i}": {"AAAA": 0.7, "AAAA9": 0.28} for i in range(6)}
    stable["now"] = {"AAAA": 0.7, "AAAA9": 0.28}
    s = lm._pattern_series(stable, "now")
    assert round(s["now"], 6) == 2.0 and len(s) == 7
    shifted = {**stable, "now": {"9999": 0.6, "AAAA": 0.3, "AAAA9": 0.08}}
    assert round(lm._pattern_series(shifted, "now")["now"], 6) == 62.0
    assert lm._pattern_series({k: v for k, v in list(stable.items())[:4] + [("now", stable["now"])]}, "now") == {}   # <5 earlier runs
    free = {f"r{i}": {"A9": 0.04, "B9": 0.03} for i in range(6)}
    free["now"] = {"A9": 0.04}
    assert lm._pattern_series(free, "now") == {}                     # no usual shape: free text, a key


def test_the_shape_series_of_a_run_is_in_percent_of_the_filled_rows():
    by = {f"r{i}": {"X": 0.9, "Y": 0.06} for i in range(5)}
    by["now"] = {"X": 0.9, "Y": 0.06}
    assert round(lm._pattern_series(by, "now")["r0"], 6) == 4.0


def _rb(kind, metric, subject, observed, median, runs=6):
    return {"kind": kind, "metric": metric, "subject_code": subject, "expected_low": median * 0.9, "expected_high": median * 1.1,
            "median": median, "observed": observed, "baseline_runs": runs, "method": "mad"}


def test_range_facts_carry_the_effect_size_and_never_a_figure_of_the_field():
    for metric, obs, med, unit in (("num_mean", 3175.0, 1234.5, "%"), ("num_max", 98765.4, 4321.0, "%"),
                                   ("date_max", 738900.0, 739890.0, " days")):
        f = lm.facts(_rb("range_shift", metric, "MARA.BRGEW", obs, med), "Gross weight")
        assert f["observed"] is None and f["median"] is None and f["expected_low"] is None and f["expected_high"] is None
        assert f["effect"] == lm.effect_of(metric, obs, med)
        text_ = " ".join(lm.template_explanation(f))
        assert f"{f['effect']:.1f}{unit}" in text_
        for fig in (obs, med, int(obs), int(med), f"{obs:.1f}", f"{med:.1f}", "738900", "739890"):
            assert str(fig) not in text_ and str(fig) not in str(f)
        assert lm.verify(lm.template_explanation(f), f)[1] == 0
        # a sentence quoting the field's own figure is dropped
        kept, dropped = lm.verify([f"The largest value is {int(obs)}.", f"It moved {f['effect']:.1f}{unit}."], f)
        assert dropped == 1 and len(kept) == 1


def test_pattern_and_format_facts_hold_shares_only():
    f = lm.facts(_rb("pattern_shift", "pattern_pct", "MARA.MTART", 30.0, 3.0), "Material type")
    assert set(f) == {"kind", "metric", "subject", "description", "observed", "expected_low", "expected_high", "median",
                      "baseline_runs", "method"}
    s = lm.template_explanation(f)
    assert "30.0%" in s[0] and lm.verify(s, f)[1] == 0
    g = lm.facts(_rb("format_break", "unparse_pct", "MARA.NTGEW", 12.0, 0.1), None)
    assert "12.0%" in lm.template_explanation(g)[0]


def test_the_model_prompt_for_a_range_break_holds_the_effect_not_a_value(monkeypatch):
    import llm.provider as prov
    seen = {}
    monkeypatch.setattr(prov, "llm_is_noop", lambda: False)
    monkeypatch.setattr(prov, "get_llm", lambda: object())
    monkeypatch.setattr(prov, "safe_invoke", lambda llm, prompt, **k: seen.setdefault("p", prompt) and "It moved a lot.")
    f = lm.facts(_rb("range_shift", "num_mean", "MARA.BRGEW", 3175.0, 1234.5), "Gross weight")
    assert lm.ai_sentences(f, "material master MARA.BRGEW") == ["It moved a lot."]
    assert "157" in seen["p"] and "3175" not in seen["p"] and "1234" not in seen["p"]


def test_a_range_break_from_a_zero_median_says_so_instead_of_a_zero_size():
    b = {"kind": "range_shift", "metric": "num_max", "subject_code": "BRGEW", "observed": 500.0, "expected_low": 0.0,
         "expected_high": 0.0, "median": 0.0, "baseline_runs": 6, "method": "mad"}
    f = lm.facts(b, "Gross weight")
    assert f["effect"] is None
    text = " ".join(lm.template_explanation(f))
    assert "usual level of zero" in text and "0.0%" not in text and "500" not in text
