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
