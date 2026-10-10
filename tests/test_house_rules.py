"""Learned house rules: deterministic, chunk-invariant miners."""
from collections import Counter

import numpy as np
import pandas as pd

from checks import house_rules as hr


def test_value_set_rule_dependency_with_violators():
    # ROH: 990 F + 10 E → S={F}; FERT: 600 E + 400 X → S={E, X} covers 100%.
    counts = Counter({("ROH", "F"): 990, ("ROH", "E"): 10, ("FERT", "E"): 600, ("FERT", "X"): 400})
    p = hr.value_set_rule(counts, rows=2000, det="MARA.MTART", dep="MARC.BESKZ")
    assert p is not None and p.kind == "value_set"
    assert p.body["allowed"] == {"FERT": ["E", "X"], "ROH": ["F"]}
    assert p.violations == 10 and p.support_rows == 2000
    assert abs(p.confidence - 0.995) < 1e-9


def test_single_value_groups_are_a_dependency():
    counts = Counter({("ROH", "F"): 990, ("ROH", "E"): 10, ("FERT", "E"): 1000})
    p = hr.value_set_rule(counts, rows=2000, det="MARA.MTART", dep="MARC.BESKZ")
    assert p is not None and p.kind == "dependency" and p.body["check_class"] == "dependency_check"


def test_rejections():
    perfect = Counter({("ROH", "F"): 1000, ("FERT", "E"): 1000})
    assert hr.value_set_rule(perfect, 2000, "A.X", "A.Y") is None                      # nothing to flag
    same = Counter({("ROH", "F"): 990, ("ROH", "E"): 10, ("FERT", "F"): 995, ("FERT", "E"): 5})
    assert hr.value_set_rule(same, 2000, "A.X", "A.Y") is None                         # A adds nothing
    wide = Counter({("ROH", str(i)): 100 for i in range(10)} | {("FERT", "E"): 990, ("FERT", "Q"): 10})
    assert hr.value_set_rule(wide, 2000, "A.X", "A.Y") is None                         # |S| > 5
    small = Counter({("ROH", "F"): 150, ("ROH", "E"): 5})
    assert hr.value_set_rule(small, 155, "A.X", "A.Y") is None                         # < MIN_GROUP_ROWS


def test_pair_counts_are_chunk_invariant_and_cap_cardinality():
    i = np.arange(3000)
    df = pd.DataFrame({"T.A": np.where(i % 2 == 0, "ROH", "FERT"), "T.B": np.where(i % 3 == 0, "x", "y"),
                       "T.ID": [str(v) for v in i]})
    whole, parts = hr.PairCounts([("T.A", "T.B"), ("T.ID", "T.B")]), hr.PairCounts([("T.A", "T.B"), ("T.ID", "T.B")])
    whole.add(df)
    for s in range(0, 3000, 700):
        parts.add(df.iloc[s:s + 700])
    assert whole.counts == parts.counts and whole.rows == parts.rows == 3000
    assert ("T.ID", "T.B") not in whole.counts  # 3000 distinct determinants > CARD_MAX


def test_shape_regex_is_anchored_and_run_length_encoded():
    import re
    rx = hr.shape_regex("AA-9999")
    assert rx == r"^[^\W\d_]{2}\-\d{4}$"
    assert re.match(rx, "MG-0042") and not re.match(rx, "MG-42") and not re.match(rx, "MG-00421")


def test_format_rule_from_chunks():
    vals = pd.Series([f"MG-{i % 50:04d}" for i in range(2000)])
    vals[::50] = "misc"                                  # 2% off-format
    sc = hr.ShapeCounts(["MARA.MATKL"])
    for s in range(0, 2000, 300):
        sc.add(pd.DataFrame({"MARA.MATKL": vals.iloc[s:s + 300]}))
    p = hr.format_rule(sc.counts["MARA.MATKL"], "MARA.MATKL")
    assert p is not None and p.kind == "format" and p.violations == 40
    assert p.body == {"check_class": "regex_check", "field": "MARA.MATKL", "pattern": r"^[^\W\d_]{2}\-\d{4}$",
                      "dimension": "validity", "message": p.body["message"]}


def test_format_rule_needs_rows_and_dominance():
    assert hr.format_rule(Counter({"AA": 990, "99": 9}), "T.F") is None             # < FORMAT_MIN_ROWS
    assert hr.format_rule(Counter({"AA": 900, "99": 200}), "T.F") is None           # < 95%
    assert hr.format_rule(Counter({"A" * 20: 2000, "9": 10}), "T.F") is None        # capped shape


def _weights(n: int = 4000) -> pd.DataFrame:
    i = np.arange(n)
    mtart = np.where(i % 2 == 0, "ROH", "FERT")
    w = np.where(mtart == "ROH", 1 + (i % 10), 100 + (i % 100)).astype(float)
    w[::211] = 99999.0
    return pd.DataFrame({"MARA.MTART": mtart, "MARA.BRGEW": w.astype(str)})


def test_fit_ranges_nearest_quantiles_padded():
    r = hr.fit_ranges(_weights(), "MARA.MTART", "MARA.BRGEW")
    lo, hi = r["ROH"]
    # ROH weights cycle 1..9 (odd only, since i is even); p97.5 nearest-rank lands on 9 before
    # the 10% span pad, so lo/hi sit just outside [1, 9], nowhere near the 99999 outlier.
    assert lo < 1.0 and 9.0 < hi < 99999.0
    assert r == hr.fit_ranges(_weights(), "MARA.MTART", "MARA.BRGEW")   # deterministic


def test_range_rule_counts_violations_over_chunks():
    df = _weights()
    fitted = {("MARA.MTART", "MARA.BRGEW"): hr.fit_ranges(df, "MARA.MTART", "MARA.BRGEW")}
    rc = hr.RangeCounts(fitted)
    for s in range(0, len(df), 900):
        rc.add(df.iloc[s:s + 900])
    key = ("MARA.MTART", "MARA.BRGEW")
    assert rc.violations[key] == 19                                       # every 211th row
    p = hr.range_rule(*key, fitted[key], rc.scope[key], rc.violations[key])
    assert p is not None and p.kind == "range" and p.body["check_class"] == "group_range_check"
