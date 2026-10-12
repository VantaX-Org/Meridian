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
