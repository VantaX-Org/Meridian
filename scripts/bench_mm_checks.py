"""Benchmark: the slowest material_master rule types on a synthetic, lazily held
MARA / MARC / MARD / MBEW / MLGN bundle shaped like sap/dictionaries/joins.yaml.

    python scripts/bench_mm_checks.py [--materials 200000] [--plants 5] [--profile]

Prints seconds per rule and in total. Every value is a string, as the extraction
writes it; numbers use RFC's trailing minus, dates are YYYYMMDD or 00000000.
"""

from __future__ import annotations

import argparse
import io
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import checks.runner as runner  # noqa: E402
from checks.frames import ParquetTable, TableFrames  # noqa: E402
from sap.ddic import get_dictionary  # noqa: E402

# the slowest rules of a production material_master run (60-270 s each)
SLOW = ("MM514 MM308 MM511 MM423 MM156 MM231 MM746 MM229 MM437 MM818 MM154 MM153 MM230 MM839 "
        "MM397 MM808 MM745 MM441 MM428 MM219 MM036 MM043 MM224 MM391").split()
TABLES = ("MARA", "MARC", "MARD", "MBEW", "MLGN")
_NUMERIC = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP"}


def _values(col: str, n: int, rng: np.random.Generator) -> np.ndarray:
    f = get_dictionary("s4hana").resolve(col)
    kind = (f.type or "").upper() if f else ""
    if kind in _NUMERIC:
        return rng.choice(np.array(["0", "", "1.000", "12.50", "4.000-", "250.00", "1,234.50"], dtype=object), n)
    if kind in ("DATS", "DATE"):
        return rng.choice(np.array(["", "00000000", "20190301", "20240115", "20260901"], dtype=object), n)
    return rng.choice(np.array(["", "", "X", "1", "F", "S", "V", "E", "01"], dtype=object), n)


def bundle(materials: int, plants: int, seed: int = 7) -> dict[str, pd.DataFrame]:
    """Per-table frames: MARA x plants = MARC = MBEW, MARC x 2 storage locations = MARD."""
    rng = np.random.default_rng(seed)
    with open(runner._find_module_yaml("material_master")) as fh:
        rules = [r for r in yaml.safe_load(fh)["rules"] if r["id"] in SLOW]
    cols = {c for r in rules for c in runner.rule_columns(r)}
    matnr = np.array([f"{i:018d}" for i in range(materials)], dtype=object)
    werks = np.array([f"{1000 + p}" for p in range(plants)], dtype=object)
    n = materials * plants
    keys = {
        "MARA": {"MARA.MATNR": matnr},
        "MARC": {"MARC.MATNR": np.repeat(matnr, plants), "MARC.WERKS": np.tile(werks, materials)},
        "MBEW": {"MBEW.MATNR": np.repeat(matnr, plants), "MBEW.BWKEY": np.tile(werks, materials),
                 "MBEW.BWTAR": np.array([""] * n, dtype=object)},
        "MARD": {"MARD.MATNR": np.repeat(matnr, plants * 2), "MARD.WERKS": np.tile(np.repeat(werks, 2), materials),
                 "MARD.LGORT": np.tile(np.array(["0001", "0002"], dtype=object), n)},
        "MLGN": {"MLGN.MATNR": matnr, "MLGN.LGNUM": np.array(["100"] * materials, dtype=object)},
    }
    out = {}
    for t in TABLES:
        data = dict(keys[t])
        rows = len(next(iter(data.values())))
        for c in sorted(c for c in cols if c.startswith(t + ".") and c not in data):
            data[c] = _values(c, rows, rng)
        for flag in ("LVORM",):
            data.setdefault(f"{t}.{flag}", rng.choice(np.array(["", "", "", "X"], dtype=object), rows))
        out[t] = pd.DataFrame(data)
    return out


def frames_of(tables: dict[str, pd.DataFrame], lazy: bool = True) -> TableFrames:
    held: dict[str, pd.DataFrame | ParquetTable] = {}
    for t, df in tables.items():
        buf = io.BytesIO()
        df.astype("string[pyarrow]").to_parquet(buf, index=False)
        held[t] = ParquetTable(buf.getvalue()) if lazy else pd.read_parquet(io.BytesIO(buf.getvalue()))
    return TableFrames(held, module="material_master")


def run(tables: dict[str, pd.DataFrame], rule_ids: list[str] | None = None,
        budget: int = 3_000_000_000) -> tuple[list, dict[str, float], float]:
    """(results, seconds per rule, total seconds) for the given rules over ``tables``."""
    with open(runner._find_module_yaml("material_master")) as fh:
        config = yaml.safe_load(fh)
    wanted = set(rule_ids or SLOW)
    config["rules"] = [r for r in config["rules"] if r["id"] in wanted]
    timing: dict[str, float] = {}
    last: list = [time.perf_counter(), None]

    def progress(done: int, total: int, rule_id: str | None) -> None:
        now = time.perf_counter()
        if last[1] is not None:
            timing[last[1]] = now - last[0]
        last[0], last[1] = now, rule_id

    orig = runner._find_module_yaml
    tmp = Path(__file__).resolve().parent / ".bench_mm_rules.yaml"
    tmp.write_text(yaml.safe_dump(config))
    runner._find_module_yaml = lambda module: tmp  # type: ignore[assignment]
    try:
        frames = frames_of(tables)
        t0 = time.perf_counter()
        results = runner.run_checks("material_master", frames, "bench", as_of="2026-01-01",
                                    prefetch_budget=budget, on_progress=progress)
        progress(0, 0, None)
        return results, timing, time.perf_counter() - t0
    finally:
        runner._find_module_yaml = orig  # type: ignore[assignment]
        tmp.unlink(missing_ok=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--materials", type=int, default=200_000)
    p.add_argument("--plants", type=int, default=5)
    p.add_argument("--budget", type=int, default=3_000_000_000, help="prefetch budget in bytes")
    p.add_argument("--profile", action="store_true")
    a = p.parse_args()
    tables = bundle(a.materials, a.plants)
    print("rows: " + ", ".join(f"{t} {len(df):,}" for t, df in tables.items()))
    if a.profile:
        import cProfile
        import pstats
        prof = cProfile.Profile()
        prof.enable()
    results, timing, total = run(tables, budget=a.budget)
    if a.profile:
        prof.disable()
        pstats.Stats(prof).sort_stats("cumulative").print_stats("checks/", 45)
    for rid, s in sorted(timing.items(), key=lambda kv: -kv[1]):
        print(f"{rid:8s} {s:6.2f}s")
    print(f"total {total:.1f}s over {len(timing)} rules; errors: {[r.check_id for r in results if r.error]}")


if __name__ == "__main__":
    main()
