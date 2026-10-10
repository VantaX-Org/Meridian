"""Lazily held extraction tables (checks/frames.py ParquetTable): each rule decodes only
the columns it reads, and every finding, conformance result, profile and score is the
same as with the tables decoded in full."""

from __future__ import annotations

import io
import json

import numpy as np
import pandas as pd
import pytest
import yaml

from api.services.record_issues import present_keys
from api.services.scoring import score_all_modules
from checks import value_placement
from checks.ddic_conformance import run_conformance
from checks.frames import ParquetTable, TableFrames, tables_of
from checks.outliers import find as find_outliers
from checks.profiling import profile_module
from checks.runner import _find_module_yaml, get_required_columns, run_checks
from sap.ddic import get_dictionary

MODULE = "material_master"
D = get_dictionary("s4hana")


def _bundle(rows: int = 40, seed: int = 0) -> dict[str, bytes]:
    """Deterministic synthetic extraction: every DDIC field of every table the module reads,
    keys drawn from small shared pools (so joins hit), values a mix of blanks, valid,
    invalid, over-long and fixed values."""
    rng = np.random.RandomState(seed)
    pools: dict[str, list[str]] = {}
    out: dict[str, bytes] = {}
    for table in sorted(tables_of(get_required_columns(MODULE))):
        t = D.table(table)
        if t is None:
            continue
        cols: dict[str, list[str]] = {}
        for name, f in t.fields.items():
            if name in ("MANDT", "CLIENT"):
                continue
            if f.key:
                pool = pools.setdefault(name, [f"{i:0{max(min(f.length, 18), 1)}d}"[-max(min(f.length, 18), 1):]
                                               for i in range(1, 7)])
                cols[f"{table}.{name}"] = [pool[i] for i in rng.randint(0, len(pool), rows)]
                continue
            menu = ["", "", "X", "0001", "abc", "20240131", "99991231", "12.50", "-3", "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"]
            menu += [v.low for v in f.fixed_values][:4]
            cols[f"{table}.{name}"] = [menu[i] for i in rng.randint(0, len(menu), rows)]
        buf = io.BytesIO()
        pd.DataFrame(cols).to_parquet(buf)
        out[table] = buf.getvalue()
    return out


@pytest.fixture(scope="module")
def bundle() -> dict[str, bytes]:
    return _bundle()


def _frames(bundle: dict[str, bytes], lazy: bool) -> TableFrames:
    tables = {t: ParquetTable(b) if lazy else pd.read_parquet(io.BytesIO(b)) for t, b in bundle.items()}
    return TableFrames(tables, D, module=MODULE)


def _dump(results: list) -> str:
    return json.dumps([r.model_dump() for r in results], sort_keys=True, default=str)


def test_parquet_table_reads_match_the_full_frame(bundle: dict[str, bytes]) -> None:
    full = pd.read_parquet(io.BytesIO(bundle["MARC"]))
    lazy = ParquetTable(bundle["MARC"])
    cols = [full.columns[3], full.columns[0]]
    assert list(lazy.columns) == list(full.columns) and len(lazy) == len(full) and not lazy.empty
    pd.testing.assert_frame_equal(lazy[cols], full[cols])
    pd.testing.assert_series_equal(lazy[cols[0]], full[cols[0]])
    pd.testing.assert_frame_equal(lazy.head(7), full.head(7))
    pd.testing.assert_frame_equal(lazy.head(10_000), full)
    assert lazy[[]].index.equals(full.index) and list(lazy[[]].columns) == []
    with pytest.raises(KeyError):
        lazy[["MARC.NOT_A_FIELD"]]


def test_rule_frame_decodes_only_the_columns_it_needs(bundle: dict[str, bytes],
                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    frames = _frames(bundle, lazy=True)
    read: list[str] = []
    orig = ParquetTable.__getitem__

    def spy(self: ParquetTable, cols: str | list[str]) -> pd.Series | pd.DataFrame:
        read.extend([cols] if isinstance(cols, str) else cols)
        return orig(self, cols)

    monkeypatch.setattr(ParquetTable, "__getitem__", spy)
    frame, grain, keys = frames.frame_for(["MARD.LABST", "MARA.MTART"])
    assert grain == "MARD" and keys == [f"MARD.{k}" for k in D.keys("MARD")]
    assert {"MARD.LABST", "MARA.MTART"} <= set(frame.columns)
    # the rule's fields, the grain's key and the join keys: never the other ~200 columns
    assert len(set(read)) < 15 and len(frame.columns) < 15
    eager = _frames(bundle, lazy=False).frame_for(["MARD.LABST", "MARA.MTART"])[0]
    pd.testing.assert_frame_equal(frame, eager[list(frame.columns)])
    frames.frame_for(["MARC.DISPO"])
    assert len(frames._cache) == 1  # a lazy run keeps one joined frame, not one per rule


def test_lazy_run_is_identical_to_eager_run(bundle: dict[str, bytes]) -> None:
    static = yaml.safe_load(_find_module_yaml(MODULE).read_text()).get("rules", [])
    extra = value_placement.generate(MODULE, static, D)
    # live check-table values for every field that has one, so value-list rules run too
    refs = {f.check_ref: {"0001", "X"} for t in bundle for f in D.table(t).fields.values() if f.check_ref}
    out: dict[bool, list[str]] = {}
    for lazy in (False, True):
        frames = _frames(bundle, lazy)
        results = run_checks(MODULE, frames, "t1", reference_values=refs, extra_rules=extra, as_of="2026-01-01")
        conformance = [r for t, tdf in dict(frames.frames).items()
                       for r in run_conformance(t, tdf, D, MODULE, [f"{t}.{k}" for k in D.keys(t)],
                                                refs, set(), {f"{t}.MTART": {"MATNR=000001"} for t in frames.frames})]
        profiles = profile_module(frames, D, sorted(frames.frames), max_rows=25)
        scores = score_all_modules(results + conformance)
        out[lazy] = [_dump(results), _dump(conformance), json.dumps(profiles, sort_keys=True, default=str),
                     json.dumps(find_outliers(MODULE, frames), sort_keys=True, default=str),
                     json.dumps(sorted(present_keys(results, frames))),
                     json.dumps({m: s.model_dump() for m, s in scores.items()}, sort_keys=True, default=str)]
        assert len(results) > 500 and any(not r.passed for r in results) and conformance
    for name, eager, lazy in zip(["findings", "conformance", "profiles", "outliers", "present", "dqs"],
                                 out[False], out[True]):
        assert eager == lazy, name
