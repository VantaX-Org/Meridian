"""Process variant discovery: which document / order types a system really uses.

Pure and deterministic. Reads the staged frames (never the sampled record list) and returns one
``ProcessVariant`` per (table, field, value) plus a ``'*'`` aggregate per signal. Output holds counts
and dates and the config key itself (a document or order type code), never record values.

Only tables and fields that sap/extraction_registry.py extracts and sap/dictionaries/ecc6 knows are
used. ``standard`` sets are taken literally from ``ProcessDetector`` predicates and are not extended.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Mapping, Optional, Union

import pandas as pd

from api.models.process_model import ProcessVariant

RECENT_DAYS = 365


@dataclass(frozen=True)
class Signal:
    table: Optional[str]  # document table; None = config-only signal
    field: str
    date_field: Optional[str]
    config_table: Optional[str]
    process_id: str
    l4_id: Optional[str] = None
    standard: Optional[frozenset[str]] = None  # None: the detector has no literal set; only Z/Y marks custom
    config_field: Optional[str] = None  # defaults to ``field``
    process_by_value: Mapping[str, str] = field(default_factory=dict)
    l4_by_value: Mapping[str, str] = field(default_factory=dict)

    @property
    def sap_table(self) -> str:
        return self.table or self.config_table or ""


_PTP_PO = {"NB": "PTP", "ZNB": "PTP", "FO": "PTP", "AN": "STC", "MK": "STC", "WK": "STC", "LP": "STC"}

SIGNALS: tuple[Signal, ...] = (
    Signal("VBAK", "AUART", "ERDAT", "TVAK", "OTC", "OTC-SO-VA01", frozenset({"OR", "SO", "ZOR", "TA"})),
    Signal("VBRK", "FKART", "FKDAT", "TVFK", "OTC", "OTC-BIL-VF01", frozenset({"F2", "F8", "G2"})),
    Signal("LIKP", "LFART", "ERDAT", "TVLK", "OTC"),
    Signal("EKKO", "BSART", "BEDAT", "T161", "PTP", "PTP-PO-ME21N", frozenset(_PTP_PO),
           process_by_value=_PTP_PO, l4_by_value={v: "" for v, p in _PTP_PO.items() if p == "STC"}),
    Signal("RBKP", "BLART", "BUDAT", None, "PTP", "PTP-IV-MIRO", frozenset({"RE"})),
    Signal("EBAN", "BSART", "BADAT", None, "PTP"),
    Signal("MKPF", "BLART", "BUDAT", None, "PTP"),
    Signal("MKPF", "VGART", "BUDAT", None, "PTP"),
    Signal(None, "BWART", None, "T156", "PTP", standard=frozenset({"101"})),
    Signal("AUFK", "AUTYP", "ERDAT", "T003O", "MTO", standard=frozenset({"10", "30"}),
           process_by_value={"10": "PTP_MFG", "30": "MTO"}),
    Signal("AUFK", "AUART", "ERDAT", "T003O", "MTO"),  # process follows the order category, see _process_of
    Signal("QMEL", "QMART", "QMDAT", None, "MTO", standard=frozenset({"M1", "M2", "M3"})),
    Signal(None, "BLART", None, "T003", "RTR", standard=frozenset({"SA", "AB", "SB", "RE", "RV"}),
           l4_by_value={"RE": "PTP-IV-MIRO", "ZP": "PTP-PAY-F110", "KZ": "PTP-PAY-F110"}),
)

# L4 ids that have at least one signal: the designer overlay marks the others "not extracted"
SIGNAL_L4_IDS = frozenset(s.l4_id for s in SIGNALS if s.l4_id) | {
    l4 for s in SIGNALS for l4 in s.l4_by_value.values() if l4}

_ORDER_CATEGORY_PROCESS = {"10": "PTP_MFG", "30": "MTO"}


def _as_date(as_of: Union[date, datetime, str, None]) -> date:
    if as_of is None:
        return datetime.now(timezone.utc).date()
    if isinstance(as_of, datetime):
        return as_of.date()
    if isinstance(as_of, date):
        return as_of
    return pd.Timestamp(as_of).date()


def _dates(series: pd.Series) -> pd.Series:
    """SAP dates arrive as 'YYYYMMDD' text or real dates; '00000000' and junk become NaT."""
    text = series.astype(str).str.strip()
    parsed = pd.to_datetime(text, format="%Y%m%d", errors="coerce")
    rest = parsed.isna() & ~text.isin(["", "None", "nan", "NaT", "00000000", "0000-00-00"])
    if rest.any():
        parsed[rest] = pd.to_datetime(text[rest], errors="coerce")
    return parsed


def _clean(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().where(series.notna(), "")


def _classify(value: str, doc_count: int, last_seen: Optional[date], standard: Optional[frozenset[str]],
              as_of: date) -> str:
    if value[:1].upper() in ("Z", "Y") or (standard is not None and value not in standard):
        return "customer_specific"
    if doc_count == 0:
        return "configured_not_used"
    # a date we cannot read is no proof of dormancy
    if last_seen is not None and last_seen < as_of - timedelta(days=RECENT_DAYS):
        return "dormant"
    return "implemented"


def _col(df: pd.DataFrame, table: str, name: str) -> Optional[pd.Series]:
    for c in (f"{table}.{name}", name):
        if c in df.columns:
            return df[c]
    return None


def _config_values(frames: Mapping[str, pd.DataFrame], sig: Signal) -> Optional[set[str]]:
    df = frames.get(sig.config_table) if sig.config_table else None
    if df is None:
        return None
    col = _col(df, sig.config_table, sig.config_field or sig.field)
    if col is None:
        return None
    return {v for v in _clean(col) if v}


def _process_of(sig: Signal, value: str, order_category: Mapping[str, str]) -> str:
    if value in sig.process_by_value:
        return sig.process_by_value[value]
    if sig.table == "AUFK" and sig.field == "AUART":
        return _ORDER_CATEGORY_PROCESS.get(order_category.get(value, ""), sig.process_id)
    return sig.process_id


def discover_variants(frames: Mapping[str, pd.DataFrame], as_of: Union[date, datetime, str, None]) -> list[ProcessVariant]:
    """One row per (table, field, value) seen in the documents or the config table, plus ``'*'`` per signal.

    A signal whose document table or field was not extracted yields no rows (the overlay reports its L4
    as not extracted). ``customer_specific`` wins over the other three classes.
    """
    ref = _as_date(as_of)
    out: list[ProcessVariant] = []
    for sig in SIGNALS:
        config = _config_values(frames, sig)
        counts: dict[str, int] = {}
        first: dict[str, Optional[date]] = {}
        last: dict[str, Optional[date]] = {}
        order_category: dict[str, str] = {}
        if sig.table:
            df = frames.get(sig.table)
            vals = _col(df, sig.table, sig.field) if df is not None else None
            if vals is None:
                continue
            frame = pd.DataFrame({"v": _clean(vals)})
            dcol = _col(df, sig.table, sig.date_field) if sig.date_field else None
            frame["d"] = _dates(dcol) if dcol is not None else pd.NaT
            frame = frame[frame["v"] != ""]
            for v, g in frame.groupby("v"):
                counts[v] = len(g)
                lo, hi = g["d"].min(), g["d"].max()
                first[v] = None if pd.isna(lo) else lo.date()
                last[v] = None if pd.isna(hi) else hi.date()
            if sig.table == "AUFK" and sig.field == "AUART":
                cat = _col(df, "AUFK", "AUTYP")
                if cat is not None:
                    pair = pd.DataFrame({"v": _clean(vals), "c": _clean(cat)})
                    order_category = {v: g["c"].mode().iat[0] for v, g in pair[pair["c"] != ""].groupby("v")}
        elif config is None:
            continue

        values = set(counts)
        if config is not None:
            # document-less signals only list the values the detector or the L4 map knows, plus Z/Y
            values |= config if sig.table else {
                v for v in config if v[:1].upper() in ("Z", "Y") or v in (sig.standard or ()) or v in sig.l4_by_value}
        if not values:
            continue

        rows: list[ProcessVariant] = []
        for v in sorted(values):
            n = counts.get(v, 0)
            rows.append(ProcessVariant(
                process_id=_process_of(sig, v, order_category), sap_table=sig.sap_table, sap_field=sig.field,
                l4_id=sig.l4_by_value.get(v, sig.l4_id) or None, value=v, doc_count=n,
                first_seen=first.get(v).isoformat() if first.get(v) else None,
                last_seen=last.get(v).isoformat() if last.get(v) else None,
                classification=_classify(v, n, last.get(v), sig.standard, ref),
                config_table=sig.config_table if config is not None and v in config else None,
                evidence="extracted"))
        firsts = [d for d in first.values() if d]
        lasts = [d for d in last.values() if d]
        total = sum(counts.values())
        agg_last = max(lasts) if lasts else None
        agg_class = _classify("*", total, agg_last, None, ref)
        out.extend(rows)
        out.append(ProcessVariant(
            process_id=sig.process_id, sap_table=sig.sap_table, sap_field=sig.field, l4_id=sig.l4_id, value="*",
            doc_count=total, first_seen=min(firsts).isoformat() if firsts else None,
            last_seen=agg_last.isoformat() if agg_last else None, classification=agg_class,
            config_table=sig.config_table if config is not None else None, evidence="extracted"))
    return out
