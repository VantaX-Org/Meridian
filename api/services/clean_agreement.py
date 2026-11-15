"""How far a later extraction agrees with an uploaded cleaned file.

The cleaned copy (an uploaded cleaning workbook or migration template, metadata.cleaned_overlay) holds the values
the user corrected in Excel; roundtrip_edits names every cell it changed. A later real extraction of the same
lineage shows whether each correction reached the source system: the cell now matches, still differs, or its
record is gone. Values stay on the tenant's own screen; nothing here goes to a model.
"""
from __future__ import annotations

import io
from typing import Callable, Iterable, Optional

Cell = tuple[str, str, str]  # (table, record key, field)
MAX_ROWS = 500


def _column(df, table: str, field: str) -> Optional[str]:
    f = field.split(".", 1)[1] if field.startswith(f"{table}.") else field
    return next((c for c in (f"{table}.{f}", f) if c in df.columns), None)


def values_in(df, table: str, cells: Iterable[Cell], keys_of: Callable[[str], list]) -> dict[Cell, Optional[str]]:
    """The stored text of each cell of ``table`` in ``df``; None when the record or the field is absent."""
    import pandas as pd

    from api.services.sf_roundtrip import _text
    from checks.base import record_keys

    key_cols = [c for c in (_column(df, table, k) for k in keys_of(table)) if c]
    first: dict[str, int] = {}
    for i, k in enumerate(record_keys(df, key_cols)):
        first.setdefault(k, i)
    out: dict[Cell, Optional[str]] = {}
    for cell in cells:
        col, row = _column(df, table, cell[2]), first.get(cell[1])
        if col is None or row is None:
            out[cell] = None
            continue
        v = df[col].iloc[row]
        out[cell] = "" if pd.isna(v) else _text(v)
    return out


def read_cells(prefix: str, cells: set[Cell], keys_of: Callable[[str], list]) -> dict[Cell, Optional[str]]:
    """Every cell's value in a run's stored data (an extraction bundle or one flat parquet object). Blocking."""
    import pandas as pd
    from urllib.parse import unquote

    from api.config import settings
    from api.services.storage import get_minio_client, list_prefix

    bucket, client = settings.minio_bucket_uploads, get_minio_client()
    by_table: dict[str, list[Cell]] = {}
    for c in cells:
        by_table.setdefault(c[0], []).append(c)

    def read(name: str):
        resp = client.get_object(bucket, name)
        try:
            return pd.read_parquet(io.BytesIO(resp.read()))
        finally:
            resp.close()

    out: dict[Cell, Optional[str]] = {c: None for c in cells}
    if prefix.endswith(".parquet"):
        df = read(prefix)
        for table, part in by_table.items():
            out.update(values_in(df, table, part, keys_of))
        return out
    for name, _ in list_prefix(bucket, prefix):
        table = unquote(name.rsplit("/", 1)[-1][: -len(".parquet")]) if name.endswith(".parquet") else None
        if table in by_table:
            out.update(values_in(read(name), table, by_table[table], keys_of))
    return out


def agreement(cells: set[Cell], cleaned: dict[Cell, Optional[str]], later: dict[Cell, Optional[str]],
              describe: Callable[[str, str], str]) -> dict:
    """Per-cell and per-field agreement of a later run with the cleaned values.

    matched: the later run holds the cleaned value. different: the record is there with another value.
    missing: the later run has no such record (or field). The score is matched over all cells, 0 to 100."""
    rows, fields = [], {}
    for cell in sorted(cells):
        table, key, field = cell
        want, got = cleaned.get(cell), later.get(cell)
        status = "missing" if got is None else "matched" if got == (want or "") else "different"
        f = fields.setdefault((table, field), {"table": table, "field": field, "description": describe(table, field),
                                               "matched": 0, "different": 0, "missing": 0})
        f[status] += 1
        rows.append({"table": table, "key": key, "field": field, "description": f["description"], "status": status,
                     "cleaned": want, "current": got})
    total = len(rows)
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in ("matched", "different", "missing")}
    order = {"different": 0, "missing": 1, "matched": 2}
    rows.sort(key=lambda r: (order[r["status"]], r["table"], r["field"], r["key"]))
    return {"total": total, **counts, "score": round(100 * counts["matched"] / total, 1) if total else None,
            "fields": sorted(fields.values(), key=lambda f: (-(f["different"] + f["missing"]), f["table"], f["field"])),
            "rows": rows[:MAX_ROWS], "rows_total": total}
