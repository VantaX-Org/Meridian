"""Alert threshold evaluation (workers/tasks/send_notifications.threshold_breaches)."""

from workers.tasks.send_notifications import threshold_breaches

CONFIG = {"critical_threshold": 2, "high_threshold": 5, "dqs_drop_threshold": 3,
          "module_floors": {"fi_gl": 90, "material_master": 70}}


def _dqs(**scores):
    return {m: {"composite_score": s} for m, s in scores.items()}


def test_nothing_crossed():
    assert threshold_breaches(CONFIG, _dqs(fi_gl=95, material_master=80), _dqs(fi_gl=96), {"critical": 1, "high": 4}) == []


def test_counts_at_threshold_alert():
    kinds = [b["kind"] for b in threshold_breaches(CONFIG, {}, {}, {"critical": 2, "high": 5})]
    assert kinds == ["critical", "high"]


def test_drop_compares_same_module_only():
    out = threshold_breaches(CONFIG, _dqs(fi_gl=92, material_master=80), _dqs(fi_gl=96, sd_customer_master=99), {})
    assert [(b["kind"], b["module"]) for b in out] == [("dqs_drop", "fi_gl")]


def test_drop_equal_to_limit_is_not_a_breach():
    assert threshold_breaches(CONFIG, _dqs(fi_gl=93), _dqs(fi_gl=96), {}) == []


def test_floor_and_unfloored_modules():
    out = threshold_breaches(CONFIG, _dqs(material_master=65.5, accounts_payable=10), {}, {})
    assert [(b["kind"], b["module"]) for b in out] == [("floor", "material_master")]
    assert "65.5" in out[0]["message"] and "70" in out[0]["message"]


def test_unscored_module_skipped():
    assert threshold_breaches(CONFIG, {"fi_gl": {"composite_score": None}, "x": None}, _dqs(fi_gl=99), {}) == []


def _dims(**d):
    return {"fi_gl": {"composite_score": 95, "dimension_scores": d}}


ROWS = [{"module": "*", "dimension": "validity", "target": 90, "warning": 80, "critical": 60},
        {"module": "fi_gl", "dimension": "uniqueness", "target": 99, "warning": 90, "critical": 80}]


def test_dimension_below_target_alerts_with_module_override():
    out = threshold_breaches(CONFIG, _dims(validity=85.0, uniqueness=97.0, accuracy=10.0), {}, {}, ROWS)
    assert [(b["kind"], b["dimension"]) for b in out] == [("dimension", "uniqueness"), ("dimension", "validity")]
    assert "below its target of 99" in out[0]["message"]


def test_dimension_on_target_or_unset_does_not_alert():
    assert threshold_breaches(CONFIG, _dims(validity=90.0, accuracy=1.0), {}, {}, ROWS) == []
    assert threshold_breaches(CONFIG, _dims(validity=1.0), {}, {}) == []  # no targets set: no dimension alerts
