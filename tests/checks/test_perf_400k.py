"""Benchmark + exactness: a 400k-row vendor extract through the check engine.

Opt-in only — run with `pytest -m perf tests/checks/test_perf_400k.py -s`.

What this proves:
1. The engine evaluates a realistic rule mix on 400k rows inside the budget.
2. Counts are exact (every injected defect found, none invented) — pass rates
   are derived from counts, so a single failure is never rounded to 100 %.
3. Vendor-level rules are evaluated once per vendor even though the extract is
   at vendor × company-code grain (grain resolution, no fan-out double counting).
"""

from __future__ import annotations

import time

import numpy as np
import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.domain_value_check import DomainValueCheck
from checks.types.null_check import NullCheck
from checks.types.regex_check import RegexCheck

pytestmark = pytest.mark.perf

VENDORS = 200_000
CC_PER_VENDOR = 2           # → 400k LFB1 rows
BUDGET_SECONDS = 60


def _frames(seed: int = 7) -> tuple[TableFrames, dict]:
    rng = np.random.default_rng(seed)
    lifnr = np.array([f"{i:010d}" for i in range(VENDORS)])
    ktokk = rng.choice(["KRED", "0001", "0002", "XXXX"], size=VENDORS, p=[0.5, 0.3, 0.19, 0.01])
    name1 = np.where(rng.random(VENDORS) < 0.02, "", "ACME")
    stcd1 = np.where(rng.random(VENDORS) < 0.05, "BAD-1", "1234567890")
    lfa1 = pd.DataFrame({"LFA1.LIFNR": lifnr, "LFA1.KTOKK": ktokk, "LFA1.NAME1": name1, "LFA1.STCD1": stcd1})

    lfb1 = pd.DataFrame({
        "LFB1.LIFNR": np.repeat(lifnr, CC_PER_VENDOR),
        "LFB1.BUKRS": np.tile(["1000", "2000"], VENDORS),
    })
    lfb1["LFB1.AKONT"] = np.where(rng.random(len(lfb1)) < 0.03, "", "160000")
    expected = {
        "name_blank": int((name1 == "").sum()),
        "bad_group": int((ktokk == "XXXX").sum()),
        "bad_tax": int((stcd1 == "BAD-1").sum()),
        "akont_blank": int((lfb1["LFB1.AKONT"] == "").sum()),
    }
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1}, module="accounts_payable"), expected


RULES = [
    (NullCheck, {"id": "N1", "field": "LFA1.NAME1"}, "name_blank"),
    (DomainValueCheck, {"id": "D1", "field": "LFA1.KTOKK", "allowed_values": ["KRED", "0001", "0002"]}, "bad_group"),
    (RegexCheck, {"id": "R1", "field": "LFA1.STCD1", "pattern": r"^\d{10}$"}, "bad_tax"),
    (NullCheck, {"id": "N2", "field": "LFB1.AKONT"}, "akont_blank"),
    (CrossFieldCheck, {"id": "U1", "field": "LFA1.LIFNR", "condition": "~`LFA1.LIFNR`.duplicated(keep=False)"}, None),
]


def test_400k_exact_counts_within_budget():
    frames, expected = _frames()
    t0 = time.perf_counter()
    results = {}
    for cls, rule, _ in RULES:
        frame, grain, keys = frames.frame_for(cls(rule).columns())
        results[rule["id"]] = (cls(rule).run(frame, key_cols=keys, grain=grain), grain)
    secs = time.perf_counter() - t0
    print(f"\n[perf] {VENDORS * CC_PER_VENDOR:,} LFB1 rows / {VENDORS:,} vendors in {secs:.2f}s")

    for cls, rule, exp_key in RULES:
        res, grain = results[rule["id"]]
        if exp_key:
            assert res.affected_count == expected[exp_key], rule["id"]
            assert len(res.failing_record_keys) == expected[exp_key]
        if res.affected_count:
            assert res.pass_rate < 100.0 and not res.passed
    # vendor-level rules run once per vendor, company-code rules once per LFB1 row
    assert results["N1"][0].total_count == VENDORS and results["N1"][1] == "LFA1"
    assert results["N2"][0].total_count == VENDORS * CC_PER_VENDOR and results["N2"][1] == "LFB1"
    # uniqueness at vendor grain: no false duplicates from the company-code fan-out
    assert results["U1"][0].affected_count == 0
    assert secs < BUDGET_SECONDS
