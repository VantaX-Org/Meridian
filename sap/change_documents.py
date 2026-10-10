"""SAP change documents (CDHDR/CDPOS): delta extraction and root cause.

A master record's change document carries an object class and an object id. A
material is MATNR under MATERIAL, a customer is KUNNR under DEBI, and a vendor
is LIFNR under KRED. Creations carry CHANGE_IND 'I' and deletions 'D'. Only
these classes are mapped. A table outside them is always read in full.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Optional

import pandas as pd

from sap.ddic import Dictionary

# object class -> (OBJECTID key field, tables whose changes the class logs).
# MBEW/MARD are left out: goods movements change stock and price without a change document.
# ponytail: three classes; add BUPA_BUP / EQUI once verified on a live system
CLASS_TABLES: dict[str, tuple[str, frozenset[str]]] = {
    "MATERIAL": ("MATNR", frozenset({"MARA", "MAKT", "MARC", "MARM", "MVKE", "MLAN"})),
    "DEBI": ("KUNNR", frozenset({"KNA1", "KNB1", "KNVV", "KNVP", "KNBK", "KNVI"})),
    "KRED": ("LIFNR", frozenset({"LFA1", "LFB1", "LFM1", "LFBK", "LFBW"})),
}
CDHDR_FIELDS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "TCODE", "CHANGE_IND"]
CDPOS_FIELDS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND"]


def class_of(table: str) -> Optional[tuple[str, str]]:
    """(object class, OBJECTID key field) whose change documents log ``table``, else None."""
    for cls, (key, tables) in CLASS_TABLES.items():
        if table in tables:
            return cls, key
    return None


def cdhdr_where(objclass: str, since: str) -> str:
    """CDHDR rows of one class since YYYYMMDD. The class is the primary-key prefix, so the read is indexed."""
    return f"OBJECTCLAS = '{objclass}' AND UDATE >= '{since}'"


def since_date(started_at: str, margin_days: int = 1) -> str:
    """YYYYMMDD a delta reads change documents from: the baseline's start, minus a margin
    (SAP dates are system-local, the baseline start is UTC)."""
    return (date.fromisoformat(started_at[:10]) - timedelta(days=margin_days)).strftime("%Y%m%d")


def changed_keys(cdhdr: pd.DataFrame) -> dict[str, set[str]]:
    """Object ids with any change document (insert, update, delete), per mapped class."""
    out: dict[str, set[str]] = {cls: set() for cls in CLASS_TABLES}
    for cls, oid in zip(cdhdr["OBJECTCLAS"].astype(str).str.strip(), cdhdr["OBJECTID"].astype(str).str.strip()):
        if cls in out and oid:
            out[cls].add(oid)
    return out


def delta_tables(tables: Iterable[str], dictionary: Dictionary) -> dict[str, tuple[str, str]]:
    """Tables a delta can re-read by key: table -> (object class, key field). The key field
    must be one of the table's DDIC keys."""
    out: dict[str, tuple[str, str]] = {}
    for table in tables:
        c = class_of(table)
        t = dictionary.table(table)
        if c is not None and t is not None and c[1] in t.keys:
            out[table] = c
    return out


def merge_delta(baseline: pd.DataFrame, fresh: pd.DataFrame, key: str, changed: set[str]) -> pd.DataFrame:
    """The baseline rows of unchanged keys plus the re-read rows of changed keys. A changed
    key the re-read no longer returns (deleted, archived) drops out."""
    keep = baseline[~baseline[key].astype(str).str.strip().isin(changed)]
    return pd.concat([keep, fresh], ignore_index=True)
