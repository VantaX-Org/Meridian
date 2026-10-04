"""Anomaly detection across extractions (checks/anomaly.py)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from checks import anomaly
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def _marc(n: int, plants=("1000", "2000"), blank_dismm: int = 0) -> pd.DataFrame:
    dismm = np.array(["PD"] * n, dtype=object)
    dismm[:blank_dismm] = ""
    return pd.DataFrame({"MARC.MANDT": ["100"] * n,
                         "MARC.MATNR": [f"{i:018d}" for i in range(n)],
                         "MARC.WERKS": [plants[i % len(plants)] for i in range(n)],
                         "MARC.DISMM": dismm})


def _profile(df, **extra):
    return {**anomaly.profile_table(df, "MARC", D), "window": None, "truncated": False, **extra}


def test_profile_counts_blanks_distinct_and_code_values():
    p = anomaly.profile_table(_marc(100, blank_dismm=10), "MARC", D)
    assert p["rows"] == 100 and "MANDT" not in p["columns"]
    assert p["columns"]["DISMM"]["blank_rate"] == 0.1
    assert p["columns"]["WERKS"]["values"] == {"1000": 50, "2000": 50}
    assert p["columns"]["MATNR"] == {"blank_rate": 0.0, "distinct": 100, "distinct_exact": True, "values": None}


def test_profile_is_chunked_and_distinct_estimate_is_close(monkeypatch):
    monkeypatch.setattr(anomaly, "CHUNK", 7_000)
    monkeypatch.setattr(anomaly, "KMV_K", 1024)
    s = pd.Series([f"M{i % 50_000}" for i in range(120_000)])
    col = anomaly.profile_column(s, codes=True)
    assert not col["distinct_exact"] and col["values"] is None  # high cardinality: no value counts
    assert abs(col["distinct"] - 50_000) / 50_000 < 0.1


def test_sensitive_fields_keep_no_values():
    df = pd.DataFrame({"LFA1.LIFNR": ["1", "2"], "LFA1.NAME1": ["A", "B"], "LFA1.LAND1": ["ZA", "ZA"]})
    cols = anomaly.profile_table(df, "LFA1", D)["columns"]
    assert cols["NAME1"]["values"] is None and cols["LAND1"]["values"] == {"ZA": 2}


def test_expected_range_mad_and_fallback():
    low, high, method = anomaly.expected_range([100, 102, 98, 101], rel=0.3, min_spread=0.02)
    assert method == "mad" and low < 98 and high > 102 and high < 120
    assert anomaly.expected_range([100], rel=0.3) == (70, 130, "relative_change")
    assert anomaly.expected_range([0.05, 0.06], abs_=0.1)[1] == pytest.approx(0.16)


def test_no_history_no_anomalies():
    assert anomaly.detect("MARC", _profile(_marc(50)), []) == []


def test_stable_history_is_quiet():
    hist = [_profile(_marc(n)) for n in (1000, 1010, 995, 1005)]
    cur = _marc(1002)
    assert anomaly.detect("MARC", _profile(cur), hist, cur, D) == []


def test_volume_drop_with_mad_baseline():
    hist = [_profile(_marc(n)) for n in (1000, 1010, 995, 1005)]
    cur = _marc(400)
    out = anomaly.detect("MARC", _profile(cur), hist, cur, D)
    vol = [a for a in out if a["metric"] == "volume"]
    assert len(vol) == 1 and vol[0]["severity"] == "high" and vol[0]["observed"] == 400
    assert vol[0]["expected"]["method"] == "mad" and vol[0]["expected"]["low"] > 400
    assert anomaly.check_id(vol[0]) == "ANOMALY.volume.MARC"


def test_volume_spike_with_relative_fallback_and_window_rules():
    hist = [_profile(_marc(100))]
    cur = _profile(_marc(200))
    assert [a["metric"] for a in anomaly.detect("MARC", cur, hist)] == ["volume"]
    assert anomaly.detect("MARC", cur, hist)[0]["expected"]["method"] == "relative_change"
    # other window or truncated read: row counts are not comparable
    assert anomaly.detect("MARC", {**cur, "window": "BUDAT >= '20260101'"}, hist) == []
    assert anomaly.detect("MARC", {**cur, "truncated": True}, hist) == []


def test_null_rate_jump_carries_masked_samples():
    hist = [_profile(_marc(200, blank_dismm=2)) for _ in range(3)]
    cur = _marc(200, blank_dismm=80)
    out = [a for a in anomaly.detect("MARC", _profile(cur), hist, cur, D) if a["metric"] == "null_rate"]
    assert len(out) == 1
    a = out[0]
    assert a["field"] == "DISMM" and a["observed"] == 0.4 and a["affected"] == 80
    assert a["expected"]["high"] < 0.4
    assert a["samples"]["bad"][0] == {"record_key": "MATNR=000000000000000000|WERKS=1000"}
    assert a["samples"]["good"][0]["value"] == "PD"  # DISMM is a non-sensitive code field
    assert len(a["samples"]["bad"]) == anomaly.SAMPLE_ROWS


def test_new_and_vanished_code_values():
    hist = [_profile(_marc(90, plants=("1000", "2000", "3000")))]
    cur = _marc(90, plants=("1000", "2000", "9999"))
    out = {a["metric"]: a for a in anomaly.detect("MARC", _profile(cur), hist, cur, D)}
    new, gone = out["new_values"], out["vanished_values"]
    assert new["field"] == "WERKS" and new["observed"] == ["9999"] and new["affected"] == 30
    assert all(r["value"] == "9999" for r in new["samples"]["bad"])
    assert all(r["value"] != "9999" for r in new["samples"]["good"]) and new["samples"]["good"]
    assert gone["observed"] == ["3000"] and gone["affected"] == 30
    assert anomaly.check_id(new) == "ANOMALY.new_values.MARC.WERKS"
