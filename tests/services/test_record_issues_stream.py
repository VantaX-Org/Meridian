"""present_keys streams and _copy flushes in chunks, with the same tmp_present content as the old one-set path."""

from __future__ import annotations

import csv
import io
from types import SimpleNamespace

import pandas as pd

from api.services import record_issues as ri
from checks.base import record_keys


def _old_present(results, frames) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    seen = set()
    for r in results:
        keys = tuple((r.details or {}).get("record_key_fields") or ())
        layout = (r.grain or "", keys)
        if not keys or layout in seen:
            continue
        seen.add(layout)
        df = frames.frames.get(r.grain) if r.grain else frames.flat
        if df is None or any(k not in df.columns for k in keys):
            continue
        out.update((layout[0], k) for k in record_keys(df, list(keys)).dropna().unique())
    return out


def _fixture():
    frames = SimpleNamespace(
        frames={"MARA": pd.DataFrame({"MARA.MATNR": ["A", "B", "A", None]}),
                "MARC": pd.DataFrame({"MARC.MATNR": ["A", "B"], "MARC.WERKS": ["1", "2"]})},
        flat=pd.DataFrame({"X.K": ["1", "1", "2"]}))

    def res(grain, keys):
        return SimpleNamespace(grain=grain, details={"record_key_fields": keys})
    results = [res("MARA", ["MARA.MATNR"]), res("MARA", ["MARA.MATNR"]),  # same layout twice
               res("MARC", ["MARC.MATNR", "MARC.WERKS"]), res("MARC", ["MARC.MATNR"]),  # two layouts, one grain
               res("", ["X.K"]), res("MARD", ["MARD.K"]), res("MARA", [])]  # no frame / no keys
    return results, frames


def test_streamed_present_keys_equal_the_old_set():
    results, frames = _fixture()
    got = list(ri.present_keys(results, frames))
    assert set(got) == _old_present(results, frames)
    assert ("MARC", "MATNR=A") in got and ("MARC", "MATNR=A|WERKS=1") in got  # both layouts of one grain
    assert len(got) == len(set(got))  # a repeated layout is read once


class _Cursor:
    def __init__(self, sink): self.sink = sink
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def copy_expert(self, sql, buf): self.sink.append(buf.read())


def _session(sink):
    raw = SimpleNamespace(cursor=lambda: _Cursor(sink))
    return SimpleNamespace(connection=lambda: SimpleNamespace(connection=raw))


def test_chunked_copy_crosses_the_flush_boundary_with_identical_rows():
    rows = [("g", f"K={i}") for i in range(10)] + [("g", None)]
    whole, chunked = [], []
    assert ri._copy(_session(whole), "t", ("grain", "record_key"), iter(rows), chunk=1000) == 11
    assert ri._copy(_session(chunked), "t", ("grain", "record_key"), iter(rows), chunk=4) == 11
    assert len(whole) == 1 and len(chunked) == 3  # 4 + 4 + 3
    parse = lambda payloads: [r for p in payloads for r in csv.reader(io.StringIO(p))]
    assert parse(chunked) == parse(whole) and len(parse(whole)) == 11
    assert ri._copy(_session([]), "t", ("a",), iter([]), chunk=4) == 0


def test_present_keys_projects_only_the_key_columns():
    """The lifecycle must not decode a whole table to build its key strings.

    Reaching into ``frames.frames`` loaded MARC (18.3M rows x 98 columns) into memory purely to
    produce a two-column key. That is what pushed the worker to 14.7 GB and got it OOM-killed
    during the issue lifecycle, after a complete analysis had already been computed.
    """
    import inspect
    from api.services import record_issues

    src = inspect.getsource(record_issues.present_keys)
    assert "frame_for" in src, "present_keys must project the key columns"
    assert "frames.frames.get" in src, "and still fall back for callers without a projection"


def test_tmp_present_is_bounded_by_open_issues():
    """tmp_present must not be the whole dataset.

    It is only probed to decide whether an existing issue can be resolved, so a key with no issue
    is dead weight. Streaming every evaluated key means 57 tables / ~100M rows: a real
    material_master run had not finished the copy after 42 minutes and had spent 13 GB of disk.
    """
    import inspect
    from api.services import record_issues

    src = inspect.getsource(record_issues.track)
    assert "FROM record_issues" in src, "open issues must be read"
    assert 'if (g or "", k) in tracked' in src, "present keys must be filtered by them"


def test_lifecycle_reconciles_in_batches():
    """The reconciliation must not be one statement over the whole version.

    On the real baseline that is 810 checks and 5.26M failing records: the upsert and the resolve
    sweep each ran over everything, and the sweep did not finish in seven hours. Batching bounds
    each statement to one set of checks and commits per batch, so progress is durable.
    """
    import inspect
    from api.services import record_issues

    src = inspect.getsource(record_issues.track)
    assert "MERIDIAN_LIFECYCLE_RECORDS" in src, "the record budget must be configurable"
    assert "for batch in batches" in src, "must iterate in batches"
    # batches are balanced by record volume: key lists are capped at 100k each and 50 of 810 checks
    # held 99.5% of the records, so a fixed check count produced one 2.5M-row batch
    assert "running + n > budget" in src, "and be balanced by volume, not by check count"
    assert "fr.check_id = ANY(:batch)" in src, "each statement must be scoped to the batch"
    assert "session.commit()" in src, "each batch must commit"


def test_tmp_present_survives_batch_commits():
    """The temp table must outlive a batch commit.

    Batching commits per batch, and tmp_present was created ON COMMIT DROP, so the second batch
    failed with 'relation "tmp_present" does not exist'. It is now ON COMMIT DELETE ROWS with the
    index created once outside the loop.
    """
    import inspect
    from api.services import record_issues

    src = inspect.getsource(record_issues.track)
    # Session.commit() returns the connection to the pool, so a temp table created once is invisible
    # to the next batch. It must be created inside each batch, ON COMMIT DROP.
    loop = src[src.index("for batch in batches"):]
    assert "CREATE TEMP TABLE IF NOT EXISTS tmp_present" in loop, "create it inside the batch loop"
    assert "ON COMMIT DROP" in loop, "and let the batch commit drop it"
    assert "CREATE INDEX ON tmp_present" in loop, "the index is rebuilt per batch"
    # SET app.tenant_id is session-scoped and the connection returns to the pool on commit, so it
    # must be re-applied for every batch or RLS fails on batch 2
    assert "SET app.tenant_id" in loop, "the tenant setting must be re-applied per batch"
