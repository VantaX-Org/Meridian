"""The rule-time speedups change no result.

Each speedup is checked against the code it replaced, copied here verbatim (``_old_*``):
the faster date parse, the per-grain typed-column cache of cross_field_check, the
per-grain exclusion mask, the column-wise similarity blocking and the auto_fix reuse
of the evaluation ``run`` already did. The last test runs the whole material_master
pack both ways on an extraction with mixed European and ISO dates, initial and blank
dates, trailing-minus numbers and several grains, lazily and eagerly, and compares
every finding."""

from __future__ import annotations

import io
import itertools
import json
from dataclasses import asdict

import numpy as np
import pandas as pd
import pytest

from checks import auto_fix, population, runner
from checks.base import CheckResult, failing_values, is_blank, record_keys, sap_number
from checks.fix_generator import FixGenerator
from checks.frames import ParquetTable, TableFrames, _ByteLRU, tables_of
from checks.population import _lookup, _status_values, _stripped
from checks.profiling import is_sensitive
from checks.runner import get_required_columns, run_checks
from checks.types import cross_field_check, domain_value_check, freshness_check, similarity_check
from checks.types import value_placement_check
from checks.types.cross_field_check import CrossFieldCheck, typed
from checks.types.domain_value_check import _parse_dates
from checks.types.similarity_check import blocks
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
MODULE = "material_master"


# ── the replaced code, verbatim ─────────────────────────────────────────────

def _old_parse_dates(s: pd.Series) -> pd.Series:
    txt = s.astype("string").str.strip()
    stamp = txt.str.fullmatch(r"\d{14}(?:[.,]\d+)?", na=False)
    ts = pd.to_datetime(txt.where(stamp).str[:14], format="%Y%m%d%H%M%S", errors="coerce")
    dats = pd.to_datetime(txt.where(txt.str.fullmatch(r"\d{8}", na=False)), format="%Y%m%d", errors="coerce")
    other = pd.to_datetime(txt.where(~txt.str.fullmatch(r"\d{8}", na=False) & ~stamp), errors="coerce", utc=True,
                           format="mixed")
    return ts.fillna(dats).fillna(other.dt.tz_localize(None) if hasattr(other, "dt") else other)


def _old_typed(df: pd.DataFrame, cols: list[str], cache: dict[str, pd.Series] | None = None) -> pd.DataFrame:
    from checks.types.cross_field_check import _DATES, _NUMERIC
    d = get_dictionary("s4hana")
    out = {}
    for c in cols:
        s = df[c]
        f = d.resolve(c)
        kind = (f.type or "").upper() if f else ""
        blank = is_blank(s)
        if kind in _NUMERIC:
            v = sap_number(s)
        elif kind in _DATES:
            v = _old_parse_dates(s)
        elif f is None and pd.api.types.is_numeric_dtype(s):
            v = s
        elif f is None:
            txt = s.astype("string[python]").str.strip()
            num = pd.to_numeric(txt, errors="coerce")
            v = num if num[~blank].notna().all() and (~blank).any() else txt
        else:
            v = s.astype("string[python]").str.strip()
        out[c] = v.mask(blank)
    return pd.DataFrame(out, index=df.index)


def _old_exclude(frame: pd.DataFrame, rules: list[dict], frames: TableFrames | None = None,
                 norm: dict[str, pd.Series] | None = None) -> tuple[pd.DataFrame, dict[str, int]]:
    if not rules:
        return frame, {}
    out = pd.Series(False, index=frame.index)
    counts: dict[str, int] = {}
    for x in rules:
        cols = x.get("fields") or [x["field"]]
        if any(c not in frame.columns for c in cols):
            continue
        parts = [_stripped(frame, c, norm) for c in cols]
        v = parts[0]
        for p in parts[1:]:
            v = v + "|" + p
        if x.get("in_table"):
            spec = x["in_table"]
            t = _lookup(spec["table"], frames)
            if t is None or any(f"{spec['table']}.{f}" not in t.columns for f in [spec["column"], *spec.get("where", {})]):
                counts[f"unverified_{x['id']}"] = int((~out).sum())
                continue
            hit = v.isin(_status_values(x, frames))
        else:
            hit = v.isin([str(a) for a in x["values"]]) if x.get("values") else v.ne("") & v.ne("00000000")
        hit &= ~out
        if hit.any():
            counts[x["id"]] = counts.get(x["id"], 0) + int(hit.sum())
            out |= hit
    return frame[~out], counts


def _old_blocks(df: pd.DataFrame, field: str, block_by: list[str],
                max_block: int) -> tuple[list[pd.Index], list[pd.Index]]:
    from checks.value_placement import name_key
    populated = ~is_blank(df[field])
    for c in block_by:
        populated &= ~is_blank(df[c])
    scope = populated & (name_key(df[field]).fillna("").str.len() >= 5)
    group = (df[block_by].astype("string").fillna("").apply(lambda s: s.str.strip().str.upper()).agg("|".join, axis=1)
             if block_by else pd.Series("", index=df.index))
    kept: list[pd.Index] = []
    oversized: list[pd.Index] = []
    for _, idx in group[scope].groupby(group[scope]).groups.items():
        (oversized if len(idx) > max_block else kept).append(idx)
    return kept, oversized


def _old_auto_fixes(rule: dict, check: runner.BaseCheck, scoped: pd.DataFrame, result: CheckResult,
                    frames: TableFrames) -> list[dict] | None:
    field = rule.get("field", "")
    table, _, name = field.rpartition(".")
    if field not in scoped.columns or is_sensitive(table, name):
        return None
    ev = check.evaluate(scoped)
    if ev is None:
        return None
    hits = auto_fix.proposals(rule, scoped, ev.failing, frames.frames, check.evaluate)
    if not hits:
        return None
    keys = result.details.get("record_key_fields") or []
    rows = scoped.iloc[sorted(hits)]
    shown = [c for c in dict.fromkeys(keys + check.columns()) if c in rows.columns]
    recs = failing_values(rows, shown)
    rk = record_keys(rows, keys).tolist()
    for rec, k in zip(recs, rk):
        rec["record_key"] = str(k)
    props = {str(k): hits[p] for k, p in zip(rk, sorted(hits))}
    fixes = FixGenerator().build_record_fixes(
        recs, result.details.get("id_field_used") or "record_key", field, rule.get("fix_map") or {},
        rule.get("record_fix_template"), table or None, props)
    return [asdict(f) for f in fixes]


# ── fixture values ───────────────────────────────────────────────────────────

DATES = ["", "  ", None, "00000000", "000000", "20240131", "2024-01-31", "31.01.2024", "01/02/2024",
         "20240131101500", "20240131101500.123", "junk", "99991231", "2024-01-31T10:00:00"]
EU_NUMBERS = ["", "1.234,50", "1.234,50-", "12,5", "12,5-", "1.234.567", "3", "7-", "0,00"]
EN_NUMBERS = ["", "1,234.50", "1,234.50-", "1,234,567", "12.50", "12.50-", "3", "7-", "0.000"]


def _same(a: pd.DataFrame | pd.Series, b: pd.DataFrame | pd.Series) -> None:
    if isinstance(a, pd.DataFrame):
        pd.testing.assert_frame_equal(a, b, check_exact=True)
    else:
        pd.testing.assert_series_equal(a, b, check_exact=True)


def _outcome(fn, *args):  # result, or the exception type it raised
    try:
        return fn(*args), None
    except Exception as e:  # noqa: BLE001 - the error itself is part of the result
        return None, type(e)


# ── speedup 2: blank dates skip the mixed-format parser ──────────────────────

def test_parse_dates_matches_the_old_parser_on_every_short_combination() -> None:
    for k in (1, 2, 3):
        for combo in itertools.product(DATES, repeat=k):
            for dtype in ("object", "string"):
                s = pd.Series(list(combo), dtype=dtype)
                (new, new_err), (old, old_err) = _outcome(_parse_dates, s), _outcome(_old_parse_dates, s)
                assert new_err == old_err, combo
                if new_err is None:
                    _same(new, old)


def test_parse_dates_matches_the_old_parser_on_a_large_mixed_column() -> None:
    rng = np.random.RandomState(3)
    values = [d for d in DATES if d != "99991231"]  # with nanosecond strings 9999 overflows either way
    s = pd.Series([values[i] for i in rng.randint(0, len(values), 5000)], index=rng.permutation(5000) * 7)
    _same(_parse_dates(s), _old_parse_dates(s))
    _same(_parse_dates(s.iloc[::3]), _old_parse_dates(s.iloc[::3]))


# ── speedup 1: typed columns cached per grain ────────────────────────────────

def _typed_frame(rows: int = 600, seed: int = 1) -> pd.DataFrame:
    rng = np.random.RandomState(seed)
    pick = lambda menu: [menu[i] for i in rng.randint(0, len(menu), rows)]  # noqa: E731
    eu = pick(EU_NUMBERS)
    eu[5] = "1,234.50"  # one English-proof value: European only for subsets without row 5
    return pd.DataFrame({"MBEW.ZPLP1": eu, "MBEW.ZPLP2": pick(EN_NUMBERS),
                         "MBEW.ZPLD1": pick(DATES), "MBEW.ZPLD2": pick(DATES[:12]),
                         "MARC.WERKS": pick(["1000", " 2000", "", None]),
                         "ZZ.UNKNOWN": pick(["1", "2.5", "", "x"])},
                        index=pd.RangeIndex(rows) * 3)


def _subsets(df: pd.DataFrame) -> list[pd.Index]:
    full = df.index
    no5 = full.drop(full[5])
    return [full, full, no5, no5, full[:200], full[1::2], full, full[[5, 6, 7]], full[[6, 7]], full[[6, 7]], no5]


def test_typed_with_the_cache_matches_typed_without_it_on_every_subset() -> None:
    df = _typed_frame()
    cols = list(df.columns)
    cache = _ByteLRU(10**9)
    for idx in _subsets(df):
        sub = df.loc[idx]
        expected = _old_typed(sub, cols)
        _same(typed(sub, cols), expected)
        _same(typed(sub, cols, cache), expected)
        _same(typed(sub, cols[2:] + cols[:2], cache), expected[cols[2:] + cols[:2]])


def test_typed_cache_serves_the_same_rows_without_parsing_again(monkeypatch: pytest.MonkeyPatch) -> None:
    df = _typed_frame()
    cache = _ByteLRU(10**9)
    typed(df, ["MBEW.ZPLP1"], cache)
    calls: list[int] = []
    real = cross_field_check.sap_number
    monkeypatch.setattr(cross_field_check, "sap_number", lambda s: calls.append(len(s)) or real(s))
    typed(df.loc[df.index], ["MBEW.ZPLP1"], cache)
    assert calls == []
    typed(df.iloc[1:], ["MBEW.ZPLP1"], cache)  # other rows: parsed for them, never sliced
    assert calls == [len(df) - 1]


def test_cross_field_check_gives_the_same_result_cached_and_uncached() -> None:
    df = _typed_frame()
    rules = [
        {"id": "T1", "check_class": "cross_field_check", "field": "MBEW.ZPLP1",
         "fail_when": "((`MBEW.ZPLP1` > 0) & `MBEW.ZPLD1`.isna()) | ((`MBEW.ZPLP2` > 0) & `MBEW.ZPLD2`.isna())"},
        {"id": "T2", "check_class": "cross_field_check", "field": "MBEW.ZPLD1", "_as_of": "2026-01-01",
         "fail_when": "`MBEW.ZPLD1`.notna() & (`MBEW.ZPLD1` < @today) & (`MBEW.ZPLP1` < 0)",
         "require_populated": True},
        {"id": "T3", "check_class": "cross_field_check", "field": "MBEW.ZPLP2",
         "condition": "`MBEW.ZPLP2` >= `MBEW.ZPLP1`"},
    ]
    cache = _ByteLRU(10**9)
    for idx in _subsets(df):
        sub = df.loc[idx]
        for rule in rules:
            plain = CrossFieldCheck(rule).run(sub, key_cols=["MARC.WERKS"], grain="MBEW")
            cached = CrossFieldCheck(rule)
            cached.typed_cache = cache
            got = cached.run(sub, key_cols=["MARC.WERKS"], grain="MBEW")
            assert got.model_dump() == plain.model_dump()


# ── speedup 4: exclusion mask cached per grain ───────────────────────────────

def test_exclude_with_the_cache_matches_the_old_exclude() -> None:
    rng = np.random.RandomState(2)
    n = 500
    frame = pd.DataFrame({"MARA.LVORM": [["", "X", " ", None][i] for i in rng.randint(0, 4, n)],
                          "MARC.LVORM": [["", "X"][i] for i in rng.randint(0, 2, n)],
                          "MARA.MTART": [["FERT", "ROH", ""][i] for i in rng.randint(0, 3, n)],
                          "MARA.MBRSH": [["M", "C"][i] for i in rng.randint(0, 2, n)]})
    sets = [
        [{"id": "a", "field": "MARA.LVORM"}, {"id": "b", "field": "MARC.LVORM"}],
        [{"id": "a", "field": "MARA.LVORM"}, {"id": "b", "field": "MARC.LVORM"}],
        [{"id": "b", "field": "MARC.LVORM"}, {"id": "a", "field": "MARA.LVORM"}],
        [{"id": "c", "fields": ["MARA.MTART", "MARA.MBRSH"], "values": ["FERT|M", "ROH|C"]},
         {"id": "d", "field": "MARA.NOPE"}],
        [{"id": "a", "field": "MARA.LVORM"}],
        [{"id": "s", "field": "MARA.MTART", "in_table": {"table": "JEST", "column": "OBJNR"}}],
    ]
    norm = _ByteLRU(10**9)
    for rules in sets + sets:
        got_frame, got = population.exclude(frame, rules, None, norm=norm)
        want_frame, want = _old_exclude(frame, rules, None, norm=_ByteLRU(10**9))
        _same(got_frame, want_frame)
        assert list(got.items()) == list(want.items())
    sub = frame.iloc[::2]  # other rows: never served the cached mask
    _same(population.exclude(sub, sets[0], None, norm=_ByteLRU(10**9))[0],
          _old_exclude(sub, sets[0], None, norm=_ByteLRU(10**9))[0])


# ── speedup 5: column-wise similarity blocking ───────────────────────────────

def test_blocks_match_the_old_row_wise_join() -> None:
    rng = np.random.RandomState(4)
    n = 400
    df = pd.DataFrame({"MARA.MFRPN": [["ACME BOLT M10", "ACME BOLT M1O", "", None, "WIDGET ASSEMBLY"][i]
                                      for i in rng.randint(0, 5, n)],
                       "MARA.MFRNR": [["v1", " V1 ", "v2", "", None, "x|y"][i] for i in rng.randint(0, 6, n)],
                       "MARA.MATKL": [["001", "002", " 001"][i] for i in rng.randint(0, 3, n)],
                       "MARA.NUM": rng.randint(0, 3, n)},
                      index=rng.permutation(n) + 100)
    for block_by in ([], ["MARA.MFRNR"], ["MARA.MFRNR", "MARA.MATKL"], ["MARA.MATKL", "MARA.NUM", "MARA.MFRNR"]):
        for max_block in (300, 20):
            new, old = blocks(df, "MARA.MFRPN", block_by, max_block), _old_blocks(df, "MARA.MFRPN", block_by, max_block)
            assert [list(g) for g in new[0]] == [list(g) for g in old[0]]
            assert [list(g) for g in new[1]] == [list(g) for g in old[1]]


# ── all five together: the material_master pack, old path and new path ─────

def _bundle(rows: int = 120, seed: int = 7) -> dict[str, bytes]:
    """Every DDIC field of every table the pack reads (several grains: MARA, MARC, MBEW,
    MARD, ...), keys from small shared pools so joins hit. Dates mix SAP, ISO and European
    forms with initial and blank values; numbers carry trailing minus signs, and each
    numeric column is written either the European or the English way (some European
    columns hold one English value, so the format decision differs between rule subsets)."""
    rng = np.random.RandomState(seed)
    pools: dict[str, list[str]] = {}
    out: dict[str, bytes] = {}
    for table in sorted(tables_of(get_required_columns(MODULE))):
        t = D.table(table)
        if t is None:
            continue
        cols: dict[str, list[str | None]] = {}
        for name, f in t.fields.items():
            if name in ("MANDT", "CLIENT"):
                continue
            if f.key:
                pool = pools.setdefault(name, [f"{i:0{max(min(f.length, 18), 1)}d}"[-max(min(f.length, 18), 1):]
                                               for i in range(1, 7)])
                cols[f"{table}.{name}"] = [pool[i] for i in rng.randint(0, len(pool), rows)]
                continue
            kind = (f.type or "").upper()
            if kind in cross_field_check._DATES:
                menu: list[str | None] = DATES
            elif kind in cross_field_check._NUMERIC:
                menu = EU_NUMBERS if rng.randint(0, 2) else EN_NUMBERS
            else:
                menu = ["", "", "X", "0001", "abc", "20240131", "12.50", "-3", "7-", "ZZZZ"]
                menu += [v.low for v in f.fixed_values][:4]
            values = [menu[i] for i in rng.randint(0, len(menu), rows)]
            if menu is EU_NUMBERS and rng.randint(0, 2):
                values[rng.randint(0, rows)] = "1,234.50"
            cols[f"{table}.{name}"] = values
        buf = io.BytesIO()
        pd.DataFrame(cols).to_parquet(buf)
        out[table] = buf.getvalue()
    return out


def _old_path(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in (domain_value_check, freshness_check, value_placement_check):
        monkeypatch.setattr(module, "_parse_dates", _old_parse_dates)
    monkeypatch.setattr(cross_field_check, "typed", _old_typed)
    monkeypatch.setattr(runner, "exclude", _old_exclude)
    monkeypatch.setattr(similarity_check, "blocks", _old_blocks)
    monkeypatch.setattr(runner, "_auto_fixes", _old_auto_fixes)


def _dump(results: list[CheckResult]) -> str:
    return json.dumps([r.model_dump() for r in results], sort_keys=True, default=str)


def test_material_master_pack_gives_the_same_findings_on_the_old_and_new_path(
        monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = _bundle()
    refs = {f.check_ref: {"0001", "X"} for t in bundle for f in D.table(t).fields.values() if f.check_ref}

    def run(lazy: bool) -> str:
        tables = {t: ParquetTable(b) if lazy else pd.read_parquet(io.BytesIO(b)) for t, b in bundle.items()}
        results = run_checks(MODULE, TableFrames(tables, D, module=MODULE), "t1", reference_values=refs,
                             as_of="2026-01-01")
        assert len(results) > 400 and not any(r.error for r in results)
        assert sum(1 for r in results if "expression" in r.details and r.affected_count) > 50  # cross_field
        assert sum(1 for r in results if r.record_fixes) > 50  # auto_fix proposals
        assert sum(1 for r in results if "population_excluded" in r.details) > 50
        return _dump(results)

    new = {lazy: run(lazy) for lazy in (True, False)}
    with monkeypatch.context() as m:
        _old_path(m)
        old = {lazy: run(lazy) for lazy in (True, False)}
    assert new[True] == old[True]
    assert new[False] == old[False]
    assert new[True] == new[False]
