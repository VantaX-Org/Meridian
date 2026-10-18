"""Writing a table must not build a second copy of the whole frame.

The material_master baseline kept dying at the very end, after MARC's 18,333,093 rows had all been
read successfully: the worker was OOM-killed during the write. The cause was

    df.astype("string[pyarrow]").to_parquet(...)

which materialises a full copy before writing. On that table the frame is ~18 GB, so the write
needed ~36 GB on a 30 GB box and the kernel killed it.

This asserts the behaviour, not the implementation: the stored parquet must be identical to what
the whole-frame conversion produced, so the memory fix cannot quietly change the data.
"""

import io

import pandas as pd


def _old_way(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.astype("string[pyarrow]").to_parquet(buf, index=False)
    return buf.getvalue()


def _new_way(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    for col in df.columns:
        if df[col].dtype != "string[pyarrow]":
            df[col] = df[col].astype("string[pyarrow]")
    df.to_parquet(buf, index=False)
    return buf.getvalue()


def test_the_stored_table_is_byte_for_byte_the_same():
    df = pd.DataFrame({
        "MATNR": ["M1", "M2", None],
        "WERKS": ["1000", "", "2000"],
        "NUM": [1, 2, 3],
        "AMT": [1.5, None, 2.25],
    })
    assert _new_way(df.copy()) == _old_way(df.copy())


def test_the_conversion_does_not_change_dtypes_or_values():
    df = pd.DataFrame({"A": ["x", "y", None], "B": [1, 2, 3]})
    old = df.astype("string[pyarrow]")
    new = df.copy()
    for col in new.columns:
        if new[col].dtype != "string[pyarrow]":
            new[col] = new[col].astype("string[pyarrow]")
    assert list(old.dtypes) == list(new.dtypes)
    assert old.fillna("<NA>").equals(new.fillna("<NA>"))
