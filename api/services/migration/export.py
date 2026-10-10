"""Build target load files from transfer-ready source records.

One sheet / CSV per target table, columns named exactly as the target fields,
values after steward value mapping, plus SOURCE_RECORD (the source key) for
traceability. Only records with no blocking (critical/high) gap are included.
"""

from __future__ import annotations

import io
import re
import zipfile

import pandas as pd

from checks.base import record_keys
from checks.frames import TableFrames

from .engine import Mapping


def build_load_tables(frames: TableFrames, module_tables: dict[str, list[str]], mappings: dict[str, list[Mapping]],
                      value_maps: dict[str, dict[str, dict[str, str]]], blocked: dict[str, set[str]]
                      ) -> dict[str, pd.DataFrame]:
    """{target table: frame} for every module's ready records."""
    out: dict[str, list[pd.DataFrame]] = {}
    for module, tables in module_tables.items():
        maps = [m for m in mappings.get(module, []) if m.target]
        vms = value_maps.get(module, {})
        for table in tables:
            df = frames.frames.get(table)
            if df is None or df.empty:
                continue
            keys = [f"{table}.{k}" for k in frames.dictionary.keys(table) if f"{table}.{k}" in df.columns]
            rk = record_keys(df, keys)
            ready = ~rk.isin(blocked.get(module, set()))
            by_target: dict[str, pd.DataFrame] = {}
            for m in maps:
                if m.source not in df.columns:
                    continue
                t_table, t_field = m.target.split(".", 1)
                frame = by_target.setdefault(t_table, pd.DataFrame({"SOURCE_RECORD": rk[ready]}))
                vals = df.loc[ready, m.source].astype("string").str.strip()
                if m.value_map:
                    vm = vms.get(m.target, {})
                    vals = vals.map(lambda v, vm=vm: vm.get(v) if isinstance(v, str) else v)
                frame[t_field] = vals.values
            for t_table, frame in by_target.items():
                out.setdefault(t_table, []).append(frame)
    return {t: pd.concat(parts, ignore_index=True) for t, parts in out.items() if parts}


# Leading whitespace before a formula char still executes in Excel/Sheets (they strip it),
# so match optional whitespace (\t \r \n space) first — same rule as upload.py's uploaded-file
# sanitiser, but applied per-cell here rather than per-column, since these sheets have no
# SAP-mapped-column exemption to honour (see to_xlsx's sanitize_formulas docstring).
_FORMULA_PREFIX = re.compile(r"^\s*[=+@\t\r]")
_DASH_PREFIX = re.compile(r"^\s*-")


def _is_numeric(v: str) -> bool:
    try:
        float(v)
        return True
    except ValueError:
        return False


def _sanitize_cell(v: object) -> object:
    if not isinstance(v, str):
        return v
    if _FORMULA_PREFIX.match(v) or (_DASH_PREFIX.match(v) and not _is_numeric(v)):
        return "'" + v
    return v


def to_xlsx(tables: dict[str, pd.DataFrame], *, sanitize_formulas: bool = False) -> bytes:
    """xlsx of one sheet per table.

    ``sanitize_formulas`` prefixes string cells that would execute as a formula in Excel/Sheets
    (``=``, ``+``, ``@``, tab, CR, or a non-numeric leading ``-``) with a single quote. Off by
    default: the ``/export`` SAP load file route feeds this real target-field values — negative
    balances, ``+``-prefixed phone numbers, ``@``-containing emails — that must reach SAP
    byte-for-byte unescaped. Callers presenting findings/report data for human consumption (e.g.
    the s4_dry_run report) should pass ``sanitize_formulas=True``.
    """
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for name, df in sorted(tables.items()):
            if sanitize_formulas:
                df = df.map(_sanitize_cell)
            df.to_excel(xw, sheet_name=name[:31].replace("/", "_"), index=False)
    return buf.getvalue()


def to_csv_zip(tables: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, df in sorted(tables.items()):
            z.writestr(f"{name.replace('/', '_')}.csv", df.to_csv(index=False))
    return buf.getvalue()
