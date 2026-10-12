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
    assert not frames._cache and frames._grain == "MARC"  # columns kept for one grain, not a frame per rule
    assert all(g == "MARC" for g, _ in frames._cols)


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
        assert len(results) > 400 and any(not r.passed for r in results) and conformance
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


def _count_decodes(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    calls: list[list[str]] = []
    orig = pd.read_parquet

    def spy(path, *a, **kw):  # type: ignore[no-untyped-def]
        calls.append(list(kw.get("columns") or []))
        return orig(path, *a, **kw)

    monkeypatch.setattr(pd, "read_parquet", spy)
    return calls


def test_prefetched_group_frame_serves_every_rule_without_decoding(bundle: dict[str, bytes],
                                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    from checks.runner import _group_columns, run_rule
    frames = _frames(bundle, lazy=True)
    fields = ["MARC.DISPO", "MARC.EKGRP", "MARC.DISMM", "MARA.MTART", "MARA.MATKL"]
    rules = [{"id": f"N{i}", "check_class": "null_check", "field": f, "severity": "low", "dimension": "completeness",
              "message": "m", "grain": "MARC"} for i, f in enumerate(fields * 4)]
    frames.prefetch(_group_columns(rules, frames, None), "MARC")
    calls = _count_decodes(monkeypatch)
    for r in rules:
        run_rule(r, frames)
    assert calls == []  # the group's columns were decoded and joined once, up front
    frames.clear_cache()
    assert not frames._cache and not frames._cols and not frames._norm and not frames._idx  # nothing decoded outlives the group


def test_run_checks_builds_the_joined_frame_a_bounded_number_of_times(bundle: dict[str, bytes],
                                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    import checks.frames as fm
    joins: list[int] = []
    orig = fm._join

    def spy(*a, **kw):  # type: ignore[no-untyped-def]
        joins.append(1)
        return orig(*a, **kw)

    monkeypatch.setattr(fm, "_join", spy)
    frames = _frames(bundle, lazy=True)
    results = run_checks(MODULE, frames, "t1", as_of="2026-01-01")
    assert len(results) > 400
    assert len(joins) < len(results) / 4, len(joins)  # was several per rule
    assert not frames._cache and not frames._cols and not frames._norm and not frames._idx  # released after the run


def test_run_checks_releases_decoded_frames_when_a_rule_raises(bundle: dict[str, bytes],
                                                               monkeypatch: pytest.MonkeyPatch) -> None:
    import checks.runner as rn
    frames = _frames(bundle, lazy=True)
    frames.frame_for(["MARC.DISPO"])
    assert frames._cols

    def boom(*a, **kw):  # type: ignore[no-untyped-def]
        raise RuntimeError("x")

    monkeypatch.setattr(rn, "run_rule", boom)
    with pytest.raises(RuntimeError):
        run_checks(MODULE, frames, "t1")
    assert not frames._cache and not frames._cols and not frames._norm and not frames._idx


def test_rule_skipped_by_missing_applies_when_field_decodes_nothing(bundle: dict[str, bytes],
                                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    from checks.runner import run_rule
    frames = _frames(bundle, lazy=True)
    calls = _count_decodes(monkeypatch)
    rule = {"id": "S1", "check_class": "null_check", "field": "MARC.DISPO", "severity": "low",
            "dimension": "completeness", "message": "m", "applies_when": {"MARC.NOT_A_FIELD": ["X"]}}
    assert run_rule(rule, frames)[1] is None
    assert calls == []


def test_run_checks_keeps_rule_order_when_grouped_by_grain(bundle: dict[str, bytes]) -> None:
    rules = yaml.safe_load(_find_module_yaml(MODULE).read_text())["rules"]
    order = [r["id"] for r in rules]
    for lazy in (False, True):
        seen: list[str] = []
        results = run_checks(MODULE, _frames(bundle, lazy), "t1", as_of="2026-01-01",
                             on_progress=lambda d, n, rid: seen.append(rid))
        ids = [r.check_id for r in results]
        assert ids == [i for i in order if i in set(ids)]
        assert sorted(seen) == sorted(order)


def test_decoding_every_column_outside_the_rule_loop_retains_nothing(bundle: dict[str, bytes]) -> None:
    # the DDIC conformance pass reads every column of every table; nothing may accumulate
    frames = _frames(bundle, lazy=True)
    for table, src in frames.frames.items():
        for col in src.columns:
            src[col]
    assert not frames._cache and not frames._cols and not frames._norm and not frames._idx
    run_checks(MODULE, frames, "t1", as_of="2026-01-01")
    assert not frames._cache and not frames._cols and not frames._norm and not frames._idx
    assert all(not getattr(src, "_memo", None) for src in frames.frames.values())


def test_prefetch_batches_stay_within_the_byte_budget_and_results_do_not_change(
        bundle: dict[str, bytes], monkeypatch: pytest.MonkeyPatch) -> None:
    import checks.frames as fm
    seen: list[tuple[int, int]] = []  # (columns prefetched, their estimated bytes)
    orig = fm.TableFrames.prefetch

    def spy(self: TableFrames, columns: set[str], grain: str) -> None:
        seen.append((len(columns), self.estimate_bytes(set(columns), grain)))
        orig(self, columns, grain)

    monkeypatch.setattr(fm.TableFrames, "prefetch", spy)
    eager = _dump(run_checks(MODULE, _frames(bundle, False), "t1", as_of="2026-01-01"))
    big = _dump(run_checks(MODULE, _frames(bundle, True), "t1", as_of="2026-01-01", prefetch_budget=10**12))
    widest = max(b for _, b in seen)
    seen.clear()
    budget = widest // 4
    small = _dump(run_checks(MODULE, _frames(bundle, True), "t1", as_of="2026-01-01", prefetch_budget=budget))
    assert eager == big == small
    assert len(seen) > 4 and all(n == 0 or b <= budget for n, b in seen)  # batched, none over the budget
    seen.clear()
    run_checks(MODULE, _frames(bundle, True), "t1", as_of="2026-01-01", prefetch_budget=1)
    assert all(n == 0 for n, _ in seen)  # every rule alone exceeds it: per-rule frames, no prefetch


def test_a_failing_prefetch_does_not_abort_the_module(bundle: dict[str, bytes], monkeypatch: pytest.MonkeyPatch) -> None:
    import checks.frames as fm

    def boom(self: TableFrames, columns: set[str], grain: str) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(fm.TableFrames, "prefetch", boom)
    eager = _dump(run_checks(MODULE, _frames(bundle, False), "t1", as_of="2026-01-01"))
    assert _dump(run_checks(MODULE, _frames(bundle, True), "t1", as_of="2026-01-01")) == eager


def _parquet(frame: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    frame.to_parquet(buf)
    return buf.getvalue()


def test_blank_applies_when_field_that_was_not_extracted_scores_the_same_lazy_and_eager() -> None:
    from checks.runner import run_rule
    but = pd.DataFrame({"BUT000.PARTNER": ["1", "2", "3"], "BUT000.TYPE": ["1", "1", "2"],
                        "BUT000.NAME_ORG1": ["A", "", "B"]})  # BUT000.XDELE is not extracted
    rule = {"id": "S1", "check_class": "null_check", "field": "BUT000.NAME_ORG1", "severity": "low",
            "dimension": "completeness", "message": "m",
            "applies_when": {"BUT000.TYPE": ["1"], "BUT000.XDELE": {"blank": True}}}
    outcome = []
    for frames in (TableFrames({"BUT000": but}, D, module="business_partner"),
                   TableFrames({"BUT000": ParquetTable(_parquet(but))}, D, module="business_partner")):
        result = run_rule(rule, frames)[1]
        assert result is not None
        outcome.append((result.affected_count, result.total_count, result.error))
    assert outcome == [(1, 2, None)] * 2


def test_string_column_estimate_covers_values_the_dictionary_encoding_hides() -> None:
    rows = 10_000
    text = pd.DataFrame({"T.ID": [f"{i:010d}" for i in range(rows)],
                         "T.TEXT": [f"{i % 100:040d}" for i in range(rows)]})  # 100 distinct 40-char values
    src = ParquetTable(_parquet(text))
    assert src.nbytes("T.TEXT") >= 40 * rows
    assert src.nbytes("T.ID") >= 10 * rows


def test_table_never_extracted_skips_its_rules_instead_of_crashing_the_run(bundle: dict[str, bytes]) -> None:
    """A rule's grain table that extraction did not deliver (entity not in the tenant) leaves its
    rules not evaluable, lazy or eager, like a field that is not in the extract."""
    partial = {t: b for t, b in bundle.items() if t != "MARC"}
    frames = _frames(partial, True)
    assert frames.estimate_bytes({"MARC.WERKS"}, "MARC") == 0
    stats: dict[str, int] = {}
    lazy = _dump(run_checks(MODULE, frames, "t1", as_of="2026-01-01", stats=stats))
    assert lazy == _dump(run_checks(MODULE, _frames(partial, False), "t1", as_of="2026-01-01"))
    assert stats.get("not_evaluable", 0) > 0


def test_lazy_column_cache_joins_exactly_like_the_eager_merge() -> None:
    """Lazy frames join each table once per grain through a positional index and reuse the
    columns across rules; padded keys, null keys, duplicate and preferred child rows,
    multi-hop paths and a byte budget that forces eviction all give the eager frame."""
    na = None
    tables = {
        "MARA": pd.DataFrame({"MARA.MATNR": ["A", " B", "C ", na, "E", "A"],
                              "MARA.MTART": ["FERT", "ROH", na, "HALB", "", "DUP"]}),
        "MAKT": pd.DataFrame({"MAKT.MATNR": ["A", "A", "B ", na, "C"],
                              "MAKT.SPRAS": ["D", "E", "E", "E", "D"],
                              "MAKT.MAKTX": ["de", "en", "b-en", "null", "c-de"]}),
        "MARC": pd.DataFrame({"MARC.MATNR": ["A", "A", "B", "C", na, "Z", " E "],
                              "MARC.WERKS": ["1000", "2000", "1000 ", na, "1000", "1000", "1000"],
                              "MARC.DISPO": ["01", "", "02", "03", na, "04", "05"]}),
        "MARD": pd.DataFrame({"MARD.MATNR": ["A", "A", "A", "B", "C", "Q"],
                              "MARD.WERKS": ["1000", "1000", "2000", "1000", na, "1000"],
                              "MARD.LGORT": ["0001", "0002", "0001", "0001", "0001", "0001"],
                              "MARD.LABST": ["1", "2", "3", "4", "5", "6"]}),
        "MBEW": pd.DataFrame({"MBEW.MATNR": ["A", "A", "A", "B", "C", "E"],
                              "MBEW.BWKEY": ["1000", "1000", "2000", " 1000", na, "1000"],
                              "MBEW.BWTAR": ["X1", "", "", "", "", "X2"],
                              "MBEW.VPRSV": ["V", "S", "S", "V", "S", "V"]}),
    }
    blobs = {t: _parquet(df) for t, df in tables.items()}
    asks = [["MARC.DISPO"], ["MARC.DISPO", "MARA.MTART"], ["MBEW.VPRSV", "MARC.DISPO"],
            ["MAKT.MAKTX", "MARC.DISPO", "MBEW.VPRSV"], ["MARA.MTART", "MAKT.MAKTX"],
            ["MARD.LABST", "MARC.DISPO"], ["MARD.LABST", "MBEW.VPRSV", "MARA.MTART"],
            ["MARD.LABST", "MAKT.MAKTX"], ["MARC.DISPO", "MAKT.MAKTX"], ["MARA.MTART"]]
    for budget in (10**9, 1):
        eager = TableFrames({t: pd.read_parquet(io.BytesIO(b)) for t, b in blobs.items()}, D, module=MODULE)
        lazy = TableFrames({t: ParquetTable(b) for t, b in blobs.items()}, D, module=MODULE)
        lazy.set_cache_budget(budget)
        for cols in asks + asks[::-1]:
            want, got = eager.frame_for(cols), lazy.frame_for(cols)
            assert (want is None) == (got is None), cols
            if want is not None:
                assert want[1:] == got[1:], cols
                # the eager frame holds every column of its tables, the lazy one what the rule reads
                assert set(cols) <= set(got[0].columns), (cols, list(got[0].columns))
                pd.testing.assert_frame_equal(got[0], want[0][list(got[0].columns)], obj=str(cols))
