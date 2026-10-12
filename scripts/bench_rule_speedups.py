"""Micro-benchmark of the rule-time speedups on a synthetic 1M-row frame.

Times the replaced code (kept verbatim in tests/checks/test_rule_speedups_equivalence.py)
against the current code. Prints seconds only; it asserts nothing about time.

    python3 scripts/bench_rule_speedups.py [rows]
"""

from __future__ import annotations

import sys
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT), str(ROOT / "tests" / "checks")]

from checks.frames import _ByteLRU  # noqa: E402
from checks.population import exclude  # noqa: E402
from checks.types.cross_field_check import typed  # noqa: E402
from checks.types.domain_value_check import _parse_dates  # noqa: E402
from checks.types.similarity_check import blocks  # noqa: E402
from test_rule_speedups_equivalence import (_old_blocks, _old_exclude, _old_parse_dates,  # noqa: E402
                                            _old_typed)


def _clock(fn: Callable[[], object]) -> float:
    t = time.perf_counter()
    fn()
    return time.perf_counter() - t


def main(rows: int) -> None:
    rng = np.random.RandomState(0)

    def pick(menu: list[str]) -> list[str]:
        return [menu[i] for i in rng.randint(0, len(menu), rows)]

    dates = pick(["", "", "", "00000000", "20240131", "20231215", "2024-01-31"])  # mostly blank, like MBEW
    df = pd.DataFrame({
        "MBEW.ZPLD1": dates,
        "MBEW.ZPLP1": pick(["", "1.234,50", "12,5-", "3", "0,00"]),
        "MBEW.LVORM": pick(["", "", "X"]),
        "MARA.MFRPN": pick(["ACME BOLT M10", "WIDGET ASSEMBLY", "", "GEAR HOUSING 4"]),
        "MARA.MATKL": [f"{i % 2000:04d}" for i in range(rows)],
        "MARA.MTART": pick(["FERT", "ROH", "HALB"]),
    })
    cols = ["MBEW.ZPLD1", "MBEW.ZPLP1"]
    excl = [{"id": "deleted", "field": "MBEW.LVORM"}]
    rules = 12  # the slow cross_field rules that read the same MBEW columns at one grain

    print(f"rows: {rows}")
    old = _clock(lambda: _old_parse_dates(df["MBEW.ZPLD1"]))
    new = _clock(lambda: _parse_dates(df["MBEW.ZPLD1"]))
    print(f"_parse_dates, one column:           before {old:7.2f}s  after {new:7.2f}s")
    sparse = pd.Series([""] * (rows - rows // 20) + ["31.01.2024"] * (rows // 20))  # 95% blank, odd format
    old = _clock(lambda: _old_parse_dates(sparse))
    new = _clock(lambda: _parse_dates(sparse))
    print(f"_parse_dates, 95% blank column:     before {old:7.2f}s  after {new:7.2f}s")

    old = _clock(lambda: [_old_typed(df, cols) for _ in range(rules)])
    cache = _ByteLRU(2 * 1024**3)
    new = _clock(lambda: [typed(df, cols, cache) for _ in range(rules)])
    print(f"typed, {rules} rules on one grain:      before {old:7.2f}s  after {new:7.2f}s")

    shared = _ByteLRU(2 * 1024**3)  # the stripped columns were already shared before
    old = _clock(lambda: [_old_exclude(df, excl, None, shared) for _ in range(rules)])
    norm = _ByteLRU(2 * 1024**3)
    new = _clock(lambda: [exclude(df, excl, None, norm) for _ in range(rules)])
    print(f"exclude, {rules} rules on one grain:    before {old:7.2f}s  after {new:7.2f}s")

    old = _clock(lambda: _old_blocks(df, "MARA.MFRPN", ["MARA.MATKL", "MARA.MTART"], 300))
    new = _clock(lambda: blocks(df, "MARA.MFRPN", ["MARA.MATKL", "MARA.MTART"], 300))
    print(f"similarity blocks, two block fields: before {old:7.2f}s  after {new:7.2f}s")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000)
