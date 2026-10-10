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
from checks import cost, population, value_placement
from checks.ddic_conformance import run_conformance
from checks.frames import ParquetTable, TableFrames, _graph, tables_of
from checks.outliers import find as find_outliers
from checks.profiling import profile_module
from checks.runner import CATEGORIES, RULES_DIR, _find_module_yaml, get_required_columns, run_checks
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


PACKS = sorted(p.stem for c in CATEGORIES for p in (RULES_DIR / c).glob("*.yaml") if p.stem != "column_map")


def _pack_bundle(module: str, rows: int = 30) -> dict[str, bytes]:
    """Deterministic synthetic extraction for any rule pack: every column the dictionary,
    the rules (with generated value-placement rules), the join graph, the population
    policy and the cost model know for each table the pack reads. Every key and join
    column draws from one shared pool, so joins hit."""
    static = yaml.safe_load(_find_module_yaml(module).read_text()).get("rules", [])
    cols = set(get_required_columns(module))
    cols |= {c for r in value_placement.generate(module, static, D) for f in ("field", "fields", "block_fields")
             for c in ([r[f]] if isinstance(r.get(f), str) else r.get(f) or [])}
    tables = set(tables_of(cols)) | population.lookup_tables()
    for xs in population.policy().values():
        for x in xs:
            cols |= set(x.get("fields") or [x["field"]])
            if x.get("in_table"):
                spec = x["in_table"]
                cols |= {f"{spec['table']}.{f}" for f in [spec["column"], *spec.get("where", {})]}
    cols |= {s["field"] for s in cost.effective(None)["modules"].values() if s.get("field")}
    keys: set[str] = set()
    for e in _graph()[0]:
        keys |= {f"{e.child}.{c}" for c, _ in e.on} | {f"{e.parent}.{p}" for _, p in e.on}
        cols |= {f"{e.child}.{f}" for f, _ in e.filter + e.prefer}
    rng = np.random.RandomState(1)
    pool = ["000001", "000002", "000003"]
    menu = ["", "", "", "X", "0", "0001", "abc", "20240131", "99991231", "12.50", "-3", "DE123456789", "1234",
            "OBSOLETE - do not use", "ZZZZZZZZZZZZ"]
    out: dict[str, bytes] = {}
    for table in sorted(tables):
        t = D.table(table)
        names = {f"{table}.{n}" for n in (t.fields if t else {}) if n not in ("MANDT", "CLIENT")}
        names |= {c for c in cols | keys if c.split(".", 1)[0] == table}
        keyed = keys | {f"{table}.{k}" for k in D.keys(table)}
        data = {c: [(pool if c in keyed else menu)[i] for i in rng.randint(0, len(pool if c in keyed else menu), rows)]
                for c in sorted(names)}
        if data:
            buf = io.BytesIO()
            pd.DataFrame(data).to_parquet(buf)
            out[table] = buf.getvalue()
    return out


@pytest.mark.parametrize("module", PACKS)
def test_every_rule_pack_scores_the_same_lazy_and_eager(module: str) -> None:
    """Guards every check type: a column a check reads but does not declare is absent
    from a lazily decoded rule frame, and the rule's numbers change."""
    bundle = _pack_bundle(module)
    static = yaml.safe_load(_find_module_yaml(module).read_text()).get("rules", [])
    extra = value_placement.generate(module, static, D)
    out = {}
    for lazy in (False, True):
        frames = TableFrames({t: ParquetTable(b) if lazy else pd.read_parquet(io.BytesIO(b)) for t, b in bundle.items()},
                             D, module=module)
        out[lazy] = {(r.check_id, r.field): {k: v for k, v in r.model_dump().items() if k not in ("created_at",)}
                     for r in run_checks(module, frames, "t1", extra_rules=extra, as_of="2026-01-01")}
    diff = {k: (out[False].get(k), out[True].get(k)) for k in out[False].keys() | out[True].keys()
            if out[False].get(k) != out[True].get(k)}
    assert not diff, diff


def test_moved_field_joins_only_the_join_columns_and_keeps_the_table_compressed() -> None:
    """ECC VBUK.GBSTK is exposed as VBAK.GBSTK; a lazily held VBAK gains that one column."""
    ecc = get_dictionary("ecc6")
    vbak = pd.DataFrame({"VBAK.VBELN": ["1", "2", "3"], "VBAK.AUART": ["OR", "RE", "OR"]})
    vbuk = pd.DataFrame({"VBUK.VBELN": ["2", "1"], "VBUK.GBSTK": ["C", "A"], "VBUK.LFSTK": ["B", "B"]})
    raw = {t: (buf := io.BytesIO(), f.to_parquet(buf), buf.getvalue())[2] for t, f in (("VBAK", vbak), ("VBUK", vbuk))}
    eager = TableFrames({"VBAK": vbak, "VBUK": vbuk}, ecc, module="sd_sales_orders")
    lazy = TableFrames({t: ParquetTable(b) for t, b in raw.items()}, ecc, module="sd_sales_orders")
    assert isinstance(lazy.frames["VBAK"], ParquetTable)
    full = eager.frames["VBAK"]
    assert list(lazy.frames["VBAK"].columns) == list(full.columns)
    pd.testing.assert_frame_equal(lazy.frames["VBAK"][list(full.columns)], full)
    pd.testing.assert_frame_equal(lazy.frames["VBAK"].head(2), full.head(2))
    pd.testing.assert_series_equal(lazy.frames["VBAK"]["VBAK.GBSTK"], full["VBAK.GBSTK"])
    for cols in (["VBAK.GBSTK"], ["VBAK.AUART", "VBAK.LFSTK"]):
        frame = lazy.frame_for(cols)[0]
        pd.testing.assert_frame_equal(frame, eager.frame_for(cols)[0][list(frame.columns)])
