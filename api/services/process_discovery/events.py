"""Event-log primitives shared by every L1 builder (spec §2.1-§2.3).

A builder reads extracted tables through ``Frames`` and yields ``EventRow``s. Rows carry no tenant,
system, L1 or run id; the worker (Task 27) adds those when it writes ``process_events``.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timezone
from typing import Callable, Iterable, Iterator, Mapping, Optional, Protocol, Sequence
from zoneinfo import ZoneInfo

import pandas as pd

DEFAULT_TZ = "Africa/Johannesburg"  # workers/celery_app.py:22
KEEP_VALUE_NEW = frozenset({"FRGZU", "FRGKE", "LIFSK", "FAKSK", "PRIOK"})  # spec §2.1 personal-data rule
_AUTOMATED_USTYP = frozenset({"B", "S"})
_HUMAN_USTYP = frozenset({"A", "C", "L"})
_KEY_RE = re.compile(r"[^A-Z0-9_]")
_OData_RE = re.compile(r"/Date\((-?\d+)")

Stamp = tuple[datetime, str]  # (ts, ts_precision) with ts_precision in {"second", "day"}
Pairs = tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class ActivityMap:
    """One row of a spec §2.3 mapping table."""
    key: str
    label: str
    l5_id: str
    case_type: str
    source: str
    condition: str
    ts: str
    order: int
    expected: bool


@dataclass(frozen=True)
class EventRow:
    """One ``process_events`` row without tenant/system/l1/run. Hashable, so identical rows collapse."""
    case_type: str
    case_id: str
    activity: str
    ts: datetime
    ts_precision: str
    source_table: str
    l5_id: Optional[str] = None
    seq: int = 0
    resource: Optional[str] = None
    automated: Optional[bool] = None
    doc_type: Optional[str] = None
    org: Pairs = ()
    object_refs: Pairs = ()
    attributes: Pairs = ()

    def as_row(self) -> dict[str, object]:
        return {
            "case_type": self.case_type, "case_id": self.case_id, "activity": self.activity,
            "l5_id": self.l5_id, "ts": self.ts, "ts_precision": self.ts_precision, "seq": self.seq,
            "resource": self.resource, "automated": self.automated, "doc_type": self.doc_type,
            "org": dict(self.org), "object_refs": [{"type": t, "id": i} for t, i in self.object_refs],
            "attributes": dict(self.attributes), "source_table": self.source_table,
        }


@dataclass(frozen=True)
class BuildContext:
    """Per-run inputs every builder needs. ``users`` is USR02 BNAME -> USTYP, None when USR02 was not read."""
    tenant_id: str
    system_type: str
    run_date: date
    tz: ZoneInfo = field(default_factory=lambda: ZoneInfo(DEFAULT_TZ))
    users: Optional[Mapping[str, str]] = None
    window_from: Optional[date] = None

    def automated(self, user: str) -> Optional[bool]:
        if self.users is None or not user:
            return None
        ustyp = self.users.get(user)
        return True if ustyp in _AUTOMATED_USTYP else False if ustyp in _HUMAN_USTYP else None

    def hash(self, value: str) -> str:
        """sha256(tenant id text || value), 32 hex chars (spec §2.1). Raw PERNR/userId never stored."""
        return hashlib.sha256((self.tenant_id + value).encode()).hexdigest()[:32]


# --- frame access -------------------------------------------------------------------------------------


class Frames(Protocol):
    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame: ...
    def has(self, table: str) -> bool: ...


def _project(df: pd.DataFrame, table: str, cols: Sequence[str]) -> pd.DataFrame:
    """Bare column names, exactly ``cols``, str values, stripped, '' for missing/NaN."""
    prefix = table + "."
    df = df.rename(columns=lambda c: c[len(prefix):] if str(c).startswith(prefix) else c)
    out = df.reindex(columns=list(cols)).astype(object).where(lambda x: x.notna(), "")
    for c in out.columns:
        out[c] = out[c].astype(str).str.strip()
    return out.reset_index(drop=True)


class MemoryFrames:
    """Frames over in-memory DataFrames (tests, and cloud frames already in memory)."""

    def __init__(self, tables: Mapping[str, pd.DataFrame]) -> None:
        self._tables = dict(tables)

    def has(self, table: str) -> bool:
        return table in self._tables

    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame:
        return _project(self._tables.get(table, pd.DataFrame()), table, cols)


class BundleFrames:
    """Frames over an extraction bundle prefix (``staging/<tenant>/<version>/``) in MinIO.

    ponytail: each get() decodes the whole projected table into pandas; switch to per-case-batch
    reads off ``iter_parquet_chunks`` if one L1's event tables outgrow worker RAM."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._cache: dict[tuple[str, tuple[str, ...]], pd.DataFrame] = {}

    def has(self, table: str) -> bool:
        from workers.dataset import _client, bundle_object

        try:
            _client().stat_object(os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads"),
                                  bundle_object(self.path, table))
            return True
        except Exception:  # noqa: BLE001 - any MinIO error means "not in the bundle"
            return False

    def get(self, table: str, cols: Sequence[str]) -> pd.DataFrame:
        key = (table, tuple(cols))
        if key not in self._cache:
            from workers.dataset import bundle_object, iter_parquet_chunks

            want = {f"{table}.{c}" for c in cols} | set(cols)
            try:
                parts = list(iter_parquet_chunks(bundle_object(self.path, table), keep=lambda c: c in want))
            except Exception:  # noqa: BLE001 - table absent from this bundle: no events from it
                parts = []
            raw = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
            self._cache[key] = _project(raw, table, cols)
        return self._cache[key]


def make_context(frames: Frames, tenant_id: str, system_type: str, run_date: date,
                 tz_name: Optional[str] = None, window_from: Optional[date] = None) -> BuildContext:
    users = None
    if frames.has("USR02"):
        u = frames.get("USR02", ["BNAME", "USTYP"])
        users = dict(zip(u["BNAME"], u["USTYP"]))
    return BuildContext(tenant_id=tenant_id, system_type=system_type, run_date=run_date,
                        tz=ZoneInfo(tz_name or DEFAULT_TZ), users=users, window_from=window_from)


# --- values and timestamps ----------------------------------------------------------------------------


def sap_date(v: str) -> Optional[date]:
    v = v.strip().replace("-", "")
    if len(v) != 8 or not v.isdigit() or v == "00000000":
        return None
    try:
        return date(int(v[:4]), int(v[4:6]), int(v[6:]))
    except ValueError:
        return None


def sap_ts(ctx: BuildContext, d: str, t: str = "") -> Optional[Stamp]:
    """SAP DATS (+TIMS) in the system timezone. No time, or 000000, is day precision (spec §2.1 rule 4)."""
    day = sap_date(d)
    if day is None:
        return None
    t = t.strip().replace(":", "")
    if len(t) == 6 and t.isdigit() and t != "000000":
        try:
            return datetime.combine(day, time(int(t[:2]), int(t[2:4]), int(t[4:])), ctx.tz), "second"
        except ValueError:
            pass
    return datetime.combine(day, time(0), ctx.tz), "day"


def sap_day(ctx: BuildContext, d: str) -> Optional[Stamp]:
    return sap_ts(ctx, d, "")


def first(*stamps: Optional[Stamp]) -> Optional[Stamp]:
    """Timestamp precedence (spec §2.1): the first source that has a value wins."""
    return next((s for s in stamps if s is not None), None)


def dec15_ts(v: str) -> Optional[Stamp]:
    """SAP DEC15 UTC timestamp YYYYMMDDhhmmss (USMD*, /SCWM/ORDIM_C)."""
    digits = v.strip().split(".")[0].split(",")[0]
    if len(digits) != 14 or not digits.isdigit() or set(digits) == {"0"}:
        return None
    try:
        return datetime.strptime(digits, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc), "second"
    except ValueError:
        return None


def iso_ts(ctx: BuildContext, v: str, day: bool = False) -> Optional[Stamp]:
    """Cloud dates: OData ``/Date(ms)/``, ISO date or ISO datetime (naive = UTC). ``day`` forces day precision."""
    v = v.strip()
    if not v:
        return None
    m = _OData_RE.match(v)
    try:
        if m:
            dt = datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
        elif len(v) == 10:
            return datetime.combine(date.fromisoformat(v), time(0), ctx.tz), "day"
        else:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    if day:
        return datetime.combine(dt.astimezone(timezone.utc).date(), time(0), ctx.tz), "day"
    return dt, "second"


def norm_key(v: str, n: int = 24) -> str:
    """Upper-case, non [A-Z0-9_] to '_', truncated (spec §2.3 <STATUS>; keeps ProcessModel ID_PATTERN valid)."""
    return _KEY_RE.sub("_", v.strip().upper())[:n]


def dyn(m: ActivityMap, key: str, label: str, l5_id: str) -> ActivityMap:
    """Runtime mapping row for a templated activity (POST_<TCODE>, STATUS_<STAT>, APPLICATION_<STATUS>)."""
    return replace(m, key=key, label=label, l5_id=l5_id)


def _pairs(d: Optional[Mapping[str, str]]) -> Pairs:
    return tuple(sorted((k, v) for k, v in (d or {}).items() if v))


def event(ctx: BuildContext, m: ActivityMap, case_id: str, when: Optional[Stamp], table: str, *,
          user: str = "", hashed: bool = False, doc_type: str = "", org: Optional[Mapping[str, str]] = None,
          refs: Iterable[tuple[str, str]] = (), attrs: Optional[Mapping[str, str]] = None) -> Optional[EventRow]:
    """Build one event, or None when the source has no usable timestamp.

    ``seq`` is the mapping's Order for every event: day-precision events sort in template order inside a
    day (spec §2.1), and same-second events get the same deterministic tiebreak. ``automated`` is
    computed from the raw user before ``hashed`` replaces it (HTR, SFX)."""
    if when is None or not case_id:
        return None
    resource = (ctx.hash(user) if hashed else user[:64]) if user else None
    return EventRow(
        case_type=m.case_type, case_id=case_id[:160], activity=m.key[:64], l5_id=m.l5_id[:120],
        ts=when[0], ts_precision=when[1], seq=m.order, resource=resource,
        automated=None if hashed and ctx.system_type in _CLOUD else ctx.automated(user),
        doc_type=doc_type[:16] or None, org=_pairs(org),
        object_refs=tuple(dict.fromkeys((t, i) for t, i in refs if i.strip("/"))), attributes=_pairs(attrs),
        source_table=table[:40],
    )


_CLOUD = frozenset({"successfactors", "ariba", "concur"})


def collect(build: Callable[[Frames, BuildContext], Iterable[Optional[EventRow]]], frames: Frames,
            ctx: BuildContext) -> list[EventRow]:
    """Distinct events in a total order: (case_type, case_id, ts, seq, activity, ...). Same input, same list."""
    rows = {e for e in build(frames, ctx) if e is not None}
    return sorted(rows, key=lambda e: (e.case_type, e.case_id, e.ts, e.seq, e.activity, e.source_table,
                                       e.l5_id or "", e.ts_precision, e.resource or "", str(e.automated),
                                       e.doc_type or "", e.org, e.object_refs, e.attributes))


# --- change documents -----------------------------------------------------------------------------------

CDHDR_COLS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "UTIME", "TCODE", "CHANGE_IND"]
CDPOS_COLS = ["OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND", "VALUE_NEW"]


def cd_headers(frames: Frames, classes: Iterable[str]) -> pd.DataFrame:
    h = frames.get("CDHDR", CDHDR_COLS)
    return h[h["OBJECTCLAS"].isin(set(classes))]


def cd_changes(frames: Frames, classes: Iterable[str], *, updates_only: bool = True) -> pd.DataFrame:
    """CDPOS joined to its CDHDR on (OBJECTCLAS, OBJECTID, CHANGENR).

    The inner join keeps only CDPOS rows whose change number is in the CDHDR window (CDPOS is read by
    OBJECTID IN-list, Task 19). ``updates_only`` drops the create change document (CHANGE_IND 'I'):
    its KEY/field rows are the create activity, not field changes."""
    h = cd_headers(frames, classes)
    if updates_only:
        h = h[h["CHANGE_IND"] != "I"]
    p = frames.get("CDPOS", CDPOS_COLS)
    return h.merge(p, on=["OBJECTCLAS", "OBJECTID", "CHANGENR"], how="inner")


def cd_stamp(ctx: BuildContext, r: Mapping[str, str]) -> Optional[Stamp]:
    return sap_ts(ctx, r["UDATE"], r["UTIME"])


def value_attr(r: Mapping[str, str]) -> dict[str, str]:
    """CDPOS VALUE_NEW only for the whitelisted fields (spec §2.1)."""
    return {r["FNAME"]: r["VALUE_NEW"]} if r["FNAME"] in KEEP_VALUE_NEW else {}


def rows(df: pd.DataFrame) -> Iterator[dict[str, str]]:
    return iter(df.to_dict("records"))  # type: ignore[arg-type]


def master_data_events(frames: Frames, ctx: BuildContext, cls: str, create: ActivityMap,
                       changes: Sequence[tuple[ActivityMap, str, str]]) -> Iterator[Optional[EventRow]]:
    """Master-data stream keyed by CDHDR OBJECTID (KRED, DEBI, SACH, ANLA, KOSTL, KSTAR, STUE, EQUI).

    ``changes`` rows are (mapping, TABNAME or '' for any, CHNGIND or '' for any)."""
    for r in rows(cd_headers(frames, [cls])):
        if r["CHANGE_IND"] == "I":
            yield event(ctx, create, r["OBJECTID"], cd_stamp(ctx, r), "CDHDR", user=r["USERNAME"])
    if not changes:
        return
    for r in rows(cd_changes(frames, [cls])):
        for m, tab, ind in changes:
            if (not tab or r["TABNAME"] == tab) and (not ind or r["CHNGIND"] == ind):
                yield event(ctx, m, r["OBJECTID"], cd_stamp(ctx, r), "CDPOS", user=r["USERNAME"])
