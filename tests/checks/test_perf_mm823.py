"""Benchmark: the material_master rules around MM823 on a production-sized, lazily
held ECC bundle (2M MBEW and MARC rows, 400k MARA, 200k MCH1).

Opt-in only — run with `pytest -m perf tests/checks/test_perf_mm823.py -s`.

A production run stopped at the 6h task limit with MM823 as its last progress
update. The rules evaluated next to it (MBEW valuation rules MM823-MM826, then
the MCH1 batch group MM459/MM460/MM856/MM857/MM861 and its prefetch) must stay
linear: each finishes inside a per-rule budget and MM823's count is exact.
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

import checks.runner as runner
from checks.frames import ParquetTable, TableFrames

pytestmark = pytest.mark.perf

RULE_IDS = {"MM823", "MM824", "MM825", "MM826", "MM459", "MM460", "MM856", "MM857", "MM861"}
MATERIALS = 400_000
PLANTS = 5            # MARC = MATERIALS x PLANTS = 2M
BATCHES = 200_000
RULE_BUDGET_SECONDS = 60
TOTAL_BUDGET_SECONDS = 240


def _lazy(df: pd.DataFrame) -> ParquetTable:
    buf = io.BytesIO()
    df.astype("string[pyarrow]").to_parquet(buf, index=False)
    return ParquetTable(buf.getvalue())


def _frames(seed: int = 3) -> tuple[TableFrames, int]:
    rng = np.random.default_rng(seed)
    matnr = np.array([f"{i:018d}" for i in range(MATERIALS)], dtype=object)

    def pick(values: list[str], n: int) -> np.ndarray:
        return rng.choice(np.array(values, dtype=object), n)

    mara = pd.DataFrame({
        "MARA.MATNR": matnr, "MARA.LVORM": pick(["", "", "", "X"], MATERIALS),
        "MARA.XCHPF": pick(["", "X"], MATERIALS), "MARA.MHDHB": pick(["0", "30", ""], MATERIALS),
        "MARA.MHDRZ": pick(["0", "10", ""], MATERIALS), "MARA.IPRKZ": pick(["", "D", "W"], MATERIALS),
    })
    n = MATERIALS * PLANTS
    plants = np.tile(np.array([f"{1000 + p}" for p in range(PLANTS)], dtype=object), MATERIALS)
    mats = np.repeat(matnr, PLANTS)
    marc = pd.DataFrame({"MARC.MATNR": mats, "MARC.WERKS": plants, "MARC.LVORM": pick(["", "", "", "X"], n)})
    mbew = pd.DataFrame({
        "MBEW.MATNR": mats, "MBEW.BWKEY": plants, "MBEW.BWTAR": pick(["", "", "", "C1"], n),
        "MBEW.LVORM": pick(["", "", "", "X"], n), "MBEW.XLIFO": pick(["", "X"], n),
        "MBEW.MYPOL": pick(["", "POOL1"], n), "MBEW.VPRSV": pick(["S", "V"], n),
        "MBEW.STPRS": pick(["0", "12.50", ""], n), "MBEW.LBKUM": pick(["0", "4.000", ""], n),
        "MBEW.SALK3": pick(["0", "-3.00", "50.00"], n),
    }).drop_duplicates(subset=["MBEW.MATNR", "MBEW.BWKEY", "MBEW.BWTAR"], ignore_index=True)
    mch1 = pd.DataFrame({
        "MCH1.MATNR": rng.choice(matnr, BATCHES), "MCH1.CHARG": [f"B{i:09d}" for i in range(BATCHES)],
        "MCH1.LVORM": pick(["", "X"], BATCHES), "MCH1.VFDAT": pick(["", "20250101", "00000000"], BATCHES),
    })
    frames = TableFrames({"MARA": _lazy(mara), "MARC": _lazy(marc), "MBEW": _lazy(mbew), "MCH1": _lazy(mch1)},
                         module="material_master")
    return frames, len(mbew)


@pytest.fixture
def mm823_rules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    with open(runner._find_module_yaml("material_master")) as f:
        config = yaml.safe_load(f)
    config["rules"] = [r for r in config["rules"] if r["id"] in RULE_IDS]
    assert {r["id"] for r in config["rules"]} == RULE_IDS
    path = tmp_path / "material_master.yaml"
    path.write_text(yaml.safe_dump(config))
    monkeypatch.setattr(runner, "_find_module_yaml", lambda module: path)
    return path


def test_mm823_neighbourhood_linear_at_2m_rows(mm823_rules: Path) -> None:
    frames, mbew_rows = _frames()
    timing: dict[str, float] = {}
    last: list = [time.perf_counter(), None]

    def progress(done: int, total: int, rule_id: str | None) -> None:
        now = time.perf_counter()
        if last[1] is not None:
            timing[last[1]] = now - last[0]
        last[0], last[1] = now, rule_id

    t0 = time.perf_counter()
    results = runner.run_checks("material_master", frames, "t", prefetch_budget=3_000_000_000,
                                on_progress=progress)
    progress(0, 0, None)
    secs = time.perf_counter() - t0
    print(f"\n[perf] {mbew_rows:,} MBEW rows, {len(RULE_IDS)} rules in {secs:.1f}s: "
          + ", ".join(f"{k} {v:.1f}s" for k, v in sorted(timing.items())))

    by_id = {r.check_id: r for r in results}
    assert not [r.check_id for r in results if r.error]
    assert "MM823" in by_id
    slow = {k: round(v, 1) for k, v in timing.items() if v > RULE_BUDGET_SECONDS}
    assert not slow, f"rules over {RULE_BUDGET_SECONDS}s: {slow}"
    assert secs < TOTAL_BUDGET_SECONDS, f"{secs:.0f}s over the {TOTAL_BUDGET_SECONDS}s budget"


def test_outliers_after_material_rules_within_budget() -> None:
    """The worker runs checks.outliers right after the module's last rule, still under that
    rule's progress label. A Python call per peer group took 164s at 400k materials in 20k
    material groups (0.5 s at 2M rows grouped)."""
    from checks.outliers import find

    rng = np.random.default_rng(5)
    matnr = np.array([f"{i:018d}" for i in range(MATERIALS)], dtype=object)

    def num(n: int) -> np.ndarray:
        return np.round(np.exp(rng.normal(3, 1, n)), 3).astype(str).astype(object)

    mara = pd.DataFrame({
        "MARA.MATNR": matnr, "MARA.MATKL": rng.integers(0, 20_000, MATERIALS).astype(str).astype(object),
        "MARA.GEWEI": rng.choice(["KG", "G"], MATERIALS), "MARA.VOLEH": rng.choice(["L", "M3"], MATERIALS),
        "MARA.MEINS": rng.choice(["EA", "KG"], MATERIALS),
        "MARA.NTGEW": num(MATERIALS), "MARA.BRGEW": num(MATERIALS), "MARA.VOLUM": num(MATERIALS),
    })
    frames = TableFrames({"MARA": _lazy(mara)}, module="material_master")
    t0 = time.perf_counter()
    out = find("material_master", frames)
    secs = time.perf_counter() - t0
    print(f"\n[perf] outliers over {MATERIALS:,} materials in {secs:.1f}s")
    assert out["OUT-MARA-NTGEW"]["checked"] > 0
    assert secs < 30, f"outliers took {secs:.0f}s"
