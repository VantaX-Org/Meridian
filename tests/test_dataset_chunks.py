"""iter_parquet_chunks: file-order row batches, projected, never a whole-table load."""
import io

import pandas as pd

from workers import dataset


def _bytes(df: pd.DataFrame, row_group_size: int) -> bytes:
    buf = io.BytesIO()
    df.to_parquet(buf, row_group_size=row_group_size)
    return buf.getvalue()


def test_chunks_cover_every_row_in_order_and_project(monkeypatch):
    df = pd.DataFrame({"MARA.MATNR": [f"{i:04d}" for i in range(10)], "MARA.MTART": ["ROH"] * 10,
                       "MARC.WERKS": ["1000"] * 10})
    data = _bytes(df, 4)
    monkeypatch.setattr(dataset, "_client", lambda: None)
    monkeypatch.setattr(dataset, "_read", lambda client, bucket, name: data)
    chunks = list(dataset.iter_parquet_chunks("u/flat.parquet", keep=lambda c: c.startswith("MARA."), chunk_rows=3))
    assert all(len(c) <= 3 for c in chunks)
    out = pd.concat(chunks, ignore_index=True)
    assert list(out.columns) == ["MARA.MATNR", "MARA.MTART"]
    assert out["MARA.MATNR"].tolist() == df["MARA.MATNR"].tolist()


def test_bundle_object_name():
    assert dataset.bundle_object("t/v/", "/SCWM/AQUA") == "t/v/%2FSCWM%2FAQUA.parquet"
