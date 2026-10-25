"""The DQS forecast carries a prediction interval from its fit and never projects past what its history supports."""

from datetime import datetime, timedelta, timezone

import numpy as np
from scipy.stats import t as student_t

from api.services.analytics_engine import PredictiveAnalytics

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _hist(values: list[float], step_days: float) -> list[dict]:
    return [{"module_id": "ap", "dqs_score": v, "recorded_at": T0 + timedelta(days=step_days * i)}
            for i, v in enumerate(values)]


def test_forecast_carries_a_prediction_interval_from_the_fit_residuals() -> None:
    noisy = [70, 73, 71, 74, 72, 75, 73, 76, 74, 77, 75]  # about +0.15/day with a wobble, over 40 days
    [f] = PredictiveAnalytics().forecast_dqs(_hist(noisy, 4))
    for h in (7, 30, 90):
        lo, mid, hi = f[f"forecast_{h}d_low"], f[f"forecast_{h}d"], f[f"forecast_{h}d_high"]
        assert 0 <= lo < mid < hi <= 100
    # the interval widens with the horizon, and the confidence follows the 7-day width
    assert (f["forecast_7d_high"] - f["forecast_7d_low"]) < (f["forecast_30d_high"] - f["forecast_30d_low"])
    assert f["confidence"] == round(100 - (f["forecast_7d_high"] - f["forecast_7d_low"]))
    # one bound against the textbook formula
    x = np.array([4.0 * i for i in range(len(noisy))])
    y = np.array(noisy, dtype=float)
    b, a = np.polyfit(x, y, 1)
    s = np.sqrt(np.sum((y - (a + b * x)) ** 2) / (len(x) - 2))
    x0 = x[-1] + 30
    half = student_t.ppf(0.975, len(x) - 2) * s * np.sqrt(1 + 1 / len(x) + (x0 - x.mean()) ** 2 / np.sum((x - x.mean()) ** 2))
    assert abs(f["forecast_30d_high"] - min(100, a + b * x0 + half)) < 0.06
    assert abs(f["forecast_30d_low"] - max(0, a + b * x0 - half)) < 0.06
    # the history comes back on a days axis that ends at 0 (now)
    assert f["history"][-1] == {"day": 0.0, "score": 75.0} and f["history"][0]["day"] == -40.0
    assert len(f["history"]) == f["points"]


def test_forecast_suppresses_horizons_beyond_the_observed_span() -> None:
    wobble = [70, 71, 70, 71]
    [short] = PredictiveAnalytics().forecast_dqs(_hist(wobble, 1))  # spans 3 days
    assert short["forecast_7d"] is not None
    assert short["forecast_30d"] is None and short["forecast_30d_low"] is None and short["forecast_30d_high"] is None
    assert short["forecast_90d"] is None and short["forecast_90d_low"] is None
    [mid] = PredictiveAnalytics().forecast_dqs(_hist(wobble, 4))  # spans 12 days
    assert mid["forecast_30d"] is not None and mid["forecast_90d"] is None
    [long] = PredictiveAnalytics().forecast_dqs(_hist(wobble, 10))  # spans 30 days
    assert long["forecast_90d"] is not None
    # early warnings read a missing 30-day point as no signal from it, never a crash
    [w] = PredictiveAnalytics().generate_early_warnings([short], {"ap": 60})
    assert w["signal"] == "green"


def test_forecast_confidence_is_full_when_the_scores_sit_on_the_line() -> None:
    [f] = PredictiveAnalytics().forecast_dqs(_hist([80, 80, 80, 80, 80], 1))
    assert f["forecast_7d_low"] == f["forecast_7d"] == f["forecast_7d_high"] == 80.0
    assert f["confidence"] == 100


def test_forecast_confidence_drops_with_a_wide_interval() -> None:
    [f] = PredictiveAnalytics().forecast_dqs(_hist([40, 90, 50], 1))  # three scattered points: t(1) is 12.7
    assert f["confidence"] == 0
    assert f["forecast_7d_low"] == 0.0 or f["forecast_7d_high"] == 100.0
