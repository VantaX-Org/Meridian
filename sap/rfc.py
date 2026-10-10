"""PyRFC connector implementation.

Wraps pyrfc as an optional import so the rest of the codebase never imports
pyrfc directly. If pyrfc is not installed, SAPConnectorError is raised on
connect() — not on import of this module.
"""

from __future__ import annotations

import logging
import os
import queue
import re
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Callable, Optional

import pandas as pd

from .base import BAPICall, SAPConnectionParams, SAPConnector, SAPConnectorError

logger = logging.getLogger("meridian.sap.rfc")


PAYROLL_FUNCTION = "Z_MERIDIAN_PAYROLL_TOTALS"
PAYROLL_TABLE = "ZMERIDIAN_PAYRT"
PAYROLL_FIELDS = ["PERNR", "SEQNR", "FPPER", "INPER", "PAYDT", "LGART", "BETRG", "ANZHL", "WAERS"]


class RFCConnector(SAPConnector):
    """SAP connector backed by pyrfc / SAP NW RFC SDK."""

    def __init__(self, parallel: int = 0) -> None:
        """``parallel``: RFC connections a keyed read uses at once; 0 = MERIDIAN_RFC_PARALLEL or 4."""
        self._conn = None
        self._password: str = ""   # held only during an active connection
        if not parallel:
            try:
                parallel = int(os.environ.get("MERIDIAN_RFC_PARALLEL") or 4)
            except ValueError:
                parallel = 4
        self._parallel = max(1, min(8, parallel))
        self._open_extra: Optional[Callable[[], object]] = None  # opens another connection like the primary
        self._extra: Optional[list] = None  # extra connections; None = not opened yet

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def connect(self, params: SAPConnectionParams) -> None:
        try:
            import pyrfc  # optional dependency
        except ImportError:
            raise SAPConnectorError(
                "pyrfc_not_installed: build the API image with INSTALL_PYRFC=true"
            )
        self._password = params.password
        try:
            self._conn = pyrfc.Connection(
                ashost=params.host,
                client=params.client,
                user=params.user,
                passwd=params.password,
                sysnr=params.sysnr,
            )
        except Exception as e:
            safe = self._mask_password(str(e), params.password)
            self._password = ""
            raise SAPConnectorError(safe) from e
        self._open_extra = lambda: pyrfc.Connection(ashost=params.host, client=params.client, user=params.user,
                                                    passwd=params.password, sysnr=params.sysnr)

    def close(self) -> None:
        for c in [self._conn, *(self._extra or [])]:
            if c is not None:
                try:
                    c.close()
                except Exception:
                    pass
        self._conn, self._extra, self._open_extra = None, None, None
        self._password = ""   # clear from memory

    def _pool(self) -> list:
        """The primary connection plus up to parallel-1 more, opened on first use.
        SAP may refuse extra sessions: read over the ones that opened."""
        if self._extra is None:
            self._extra = []
            while self._open_extra and len(self._extra) < self._parallel - 1:
                try:
                    self._extra.append(self._open_extra())
                except Exception as e:
                    logger.warning("extra RFC connection refused, reading over %d: %s", 1 + len(self._extra),
                                   self._mask_password(str(e), self._password))
                    break
        return [self._conn, *self._extra]

    # ── Operations ─────────────────────────────────────────────────────────────

    def read_table(
        self,
        table: str,
        fields: list[str],
        where: Optional[str] = None,
        max_rows: int = 0,
    ) -> pd.DataFrame:
        """Single RFC_READ_TABLE call (fields must fit the 512-byte work area)."""
        if self._conn is None:
            raise SAPConnectorError("read_table called before connect()")
        try:
            result = self._conn.call(
                "RFC_READ_TABLE",
                QUERY_TABLE=table,
                FIELDS=[{"FIELDNAME": f} for f in fields],
                OPTIONS=where_options(where),
                ROWCOUNT=max_rows,
            )
        except Exception as e:
            safe = self._mask_password(str(e), self._password)
            raise SAPConnectorError(safe) from e
        return _parse_rfc_result(result)

    def call(self, function: str, **params) -> dict:
        """Call a remote-enabled function module (DDIF_FIELDINFO_GET, RFC_SYSTEM_INFO…)."""
        if self._conn is None:
            raise SAPConnectorError(f"{function} called before connect()")
        try:
            return self._conn.call(function, **params)
        except Exception as e:
            raise SAPConnectorError(self._mask_password(str(e), self._password)) from e

    def read_table_full(
        self,
        table: str,
        fields: list[str],
        key_fields: list[str],
        where: Optional[str] = None,
        max_rows: int = 0,
        page_size: int = 50_000,
        on_progress: Optional[Callable[[int, int, int], None]] = None,
    ) -> pd.DataFrame:
        """Read any number of fields and rows.

        RFC_READ_TABLE returns rows in a 512-byte work area and in no defined
        order, so wide tables are read in column groups that each carry the
        key fields and are joined back on the key. Groups that still overflow
        are split in half. Keyed reads page by ranges of the leading key
        (``_read_ranges``); ROWSKIPS paging makes SAP hold every skipped row,
        which fails with TSV_TNEW_PAGE_ALLOC_FAILED deep into large tables and
        can repeat or miss rows because the reads have no sort order.
        ``on_progress(groups_done, groups, rows_read_in_group)`` is called after every page.
        """
        if self._conn is None:
            raise SAPConnectorError("read_table_full called before connect()")
        keys = [k for k in key_fields if k]
        rest = [f for f in dict.fromkeys(fields) if f not in keys]
        groups = self._groups(table, keys, rest)
        merged: Optional[pd.DataFrame] = None
        report = on_progress or (lambda done, n, rows: None)
        if keys and groups and self._parallel > 1 and len(conns := self._pool()) > 1:
            n = len(groups)
            merged, ranges = self._read_ranges_pool(table, [keys + groups[0]], keys[0], where, page_size,
                                                    lambda rows: report(0, n, rows), None, max_rows, conns)[0]
            per = max(len(merged), 1)

            def report_rest(rows: int) -> None:  # groups 2..n read at once: report in group-sized steps
                g = min(n - 1, 1 + rows // per)
                report(g, n, rows - (g - 1) * per)
            if n > 1:
                for part, _ in self._read_ranges_pool(table, [keys + g for g in groups[1:]], keys[0], where,
                                                      page_size, report_rest, ranges, 0, conns):
                    merged = merged.merge(part, on=keys, how="outer")
            return merged
        ranges = None  # found by the first group, reused by the others
        for i, group in enumerate(groups):
            on_page = lambda rows: report(i, len(groups), rows)
            if keys:
                part, ranges = self._read_ranges(table, keys + group, keys[0], where, page_size, on_page, ranges,
                                                 max_rows)
            else:
                part = self._read_paged(table, keys + group, where, max_rows, page_size, on_page)
            merged = part if merged is None else merged.merge(part, on=keys, how="outer") if keys \
                else pd.concat([merged, part], axis=1)
        if merged is None:
            merged = self._read_paged(table, keys, where, max_rows, page_size)
        return merged

    def _groups(self, table: str, keys: list[str], rest: list[str]) -> list[list[str]]:
        """Split non-key fields into groups whose RFC work area fits 512 bytes.

        Packs by the field widths the NO_DATA probe returns: some systems do not
        raise DATA_BUFFER_EXCEEDED on a NO_DATA call, only on the real read.
        Probes that do raise it are split in half.
        """
        if not rest:
            return []
        try:
            meta = self._conn.call("RFC_READ_TABLE", QUERY_TABLE=table, NO_DATA="X",
                                   FIELDS=[{"FIELDNAME": f} for f in keys + rest]).get("FIELDS") or []
        except Exception as e:
            if "DATA_BUFFER_EXCEEDED" not in str(e) or len(rest) == 1:
                if len(rest) == 1:
                    raise SAPConnectorError(
                        self._mask_password(f"{table}: cannot read field {rest[0]}: {e}", self._password)
                    ) from e
                raise SAPConnectorError(self._mask_password(str(e), self._password)) from e
            mid = len(rest) // 2
            return self._groups(table, keys, rest[:mid]) + self._groups(table, keys, rest[mid:])
        width = {str(m.get("FIELDNAME", "")).strip(): int(m.get("LENGTH") or 0) for m in meta}
        if not all(f in width for f in rest):
            return [rest]  # no widths to pack by: the probe accepted the fields together
        free = _WORK_AREA - sum(width.get(k, 0) for k in keys)
        groups: list[list[str]] = [[]]
        for f in rest:
            if groups[-1] and sum(width[g] for g in groups[-1]) + width[f] > free:
                groups.append([])
            groups[-1].append(f)
        return groups

    def _read_ranges(self, table: str, fields: list[str], key: str, where: Optional[str], page_size: int,
                     on_page: Callable[[int], None], ranges: Optional[list] = None,
                     max_rows: int = 0) -> tuple[pd.DataFrame, list]:
        """Read in ranges of ``key`` that each fit one call of ``page_size`` rows.

        A range that comes back full is split at the quartiles of the rows it
        returned and read again; a single key value that fills a page on its
        own is paged with ROWSKIPS. Ranges are read in key order and reading
        stops once ``max_rows`` (0 = no limit) is reached, so a capped read is
        the lowest keys. Returns the rows and the ranges used.
        Ranges are (op, lo, hi): ``key op lo AND key < hi``, None = open.
        """
        # ponytail: an overflowing range costs one discarded page; seed ranges from SAP
        # row counts if that ever dominates
        todo, done, pages, rows = list(ranges or [(">=", None, None)]), [], [], 0
        while todo and not (max_rows and rows >= max_rows):
            op, lo, hi = todo.pop(0)
            try:
                page = self._read_paged(table, fields, _range_where(where, key, (op, lo, hi)),
                                        0 if op == "=" else page_size, page_size)
            except SAPConnectorError as e:
                # SAP's memory quota per call can hold fewer rows than page_size
                if "TSV_TNEW_PAGE_ALLOC_FAILED" not in str(e) or page_size <= 1000:
                    raise
                page_size //= 2
                logger.warning("%s: SAP out of memory, page size now %d", table, page_size)
                todo.insert(0, (op, lo, hi))
                continue
            if op != "=" and len(page) >= page_size:
                todo[:0] = _split(page, key, (op, lo, hi))
                continue
            pages.append(page)
            done.append((op, lo, hi))
            rows += len(page)
            on_page(rows)
        return pd.concat(pages, ignore_index=True), done

    def _read_ranges_pool(self, table: str, groups: list[list[str]], key: str, where: Optional[str],
                          page_size: int, on_rows: Callable[[int], None], ranges: Optional[list], max_rows: int,
                          conns: list) -> list[tuple[pd.DataFrame, list]]:
        """``_read_ranges`` for each field list in ``groups``, over several connections at once.

        Every (group, range) is a separate read; a full page is split and its
        parts queued, like the serial read. Each connection serves one read at
        a time. Pages are joined in key order, not completion order. A capped
        read stops once the ranges below every pending one hold ``max_rows``,
        so it returns the same lowest keys as the serial read. ``on_rows`` is
        called on the caller's thread only. Returns (rows, ranges) per group.
        """
        todo = [(g, r) for g in range(len(groups)) for r in (ranges or [(">=", None, None)])]
        pages: list[dict] = [{} for _ in groups]
        free: queue.Queue = queue.Queue()
        for c in conns:
            free.put(c)

        def read(g: int, r: tuple, size: int) -> pd.DataFrame:
            conn = free.get()
            try:
                return self._read_paged(table, groups[g], _range_where(where, key, r),
                                        0 if r[0] == "=" else size, size, conn=conn)
            finally:
                free.put(conn)

        rows = 0
        running: dict[Future, tuple[int, tuple, int]] = {}
        with ThreadPoolExecutor(max_workers=len(conns)) as pool:
            try:
                while todo or running:
                    while todo and len(running) < len(conns):
                        g, r = todo.pop(0)
                        running[pool.submit(read, g, r, page_size)] = (g, r, page_size)
                    finished, _ = wait(running, return_when=FIRST_COMPLETED)
                    for f in finished:
                        g, r, size = running.pop(f)
                        try:
                            page = f.result()
                        except SAPConnectorError as e:
                            # SAP's memory quota per call can hold fewer rows than page_size
                            if "TSV_TNEW_PAGE_ALLOC_FAILED" not in str(e) or (size == page_size and page_size <= 1000):
                                raise
                            if size == page_size:  # not already halved by another read
                                page_size //= 2
                                logger.warning("%s: SAP out of memory, page size now %d", table, page_size)
                            todo.insert(0, (g, r))
                            continue
                        if r[0] != "=" and len(page) >= size:
                            todo[:0] = [(g, s) for s in _split(page, key, r)]
                            continue
                        pages[g][r] = page
                        rows += len(page)
                        on_rows(rows)
                    todo.sort(key=lambda t: (_range_order(t[1]), t[0]))  # lowest keys first, like the serial read
                    pending = [r for _, r, _ in running.values()] + [r for _, r in todo[:1]]
                    if max_rows and _capped(pages[0], pending, max_rows):
                        break
            finally:
                for f in running:
                    f.cancel()
        out = []
        for p in pages:
            done = sorted(p, key=_range_order)
            if max_rows:  # serial semantics: ranges in key order until the cap is reached
                total, keep = 0, []
                for r in done:
                    if total >= max_rows:
                        break
                    keep.append(r)
                    total += len(p[r])
                done = keep
            out.append((pd.concat([p[r] for r in done], ignore_index=True), done))
        return out

    def _read_paged(self, table: str, fields: list[str], where: Optional[str],
                    max_rows: int, page_size: int, on_page: Callable[[int], None] = lambda rows: None,
                    conn: Optional[object] = None) -> pd.DataFrame:
        conn = conn or self._conn
        pages, skip = [], 0
        while True:
            want = page_size if not max_rows else min(page_size, max_rows - skip)
            if want <= 0:
                break
            try:
                result = conn.call(
                    "RFC_READ_TABLE", QUERY_TABLE=table, FIELDS=[{"FIELDNAME": f} for f in fields],
                    OPTIONS=where_options(where), ROWSKIPS=skip, ROWCOUNT=want,
                )
            except Exception as e:
                raise SAPConnectorError(self._mask_password(str(e), self._password)) from e
            page = _parse_rfc_result(result)
            if page.empty and not pages:
                page = pd.DataFrame(columns=[f["FIELDNAME"].strip() for f in result.get("FIELDS", [])] or fields)
            pages.append(page)
            skip += len(page)
            on_page(skip)
            if len(page) < want:
                break
        return pd.concat(pages, ignore_index=True) if pages else pd.DataFrame(columns=fields)

    def count_rows(self, tables: list[str]) -> dict[str, int]:
        """SAP's own row count per table (EM_GET_NUMBER_OF_ENTRIES, client-specific
        COUNT(*)) — the reference an unfiltered extraction must match. {} when the
        function is not available to this user."""
        if self._conn is None or not tables:
            return {}
        try:
            r = self._conn.call("EM_GET_NUMBER_OF_ENTRIES", IT_TABLES=[{"TABNAME": t} for t in tables])
            return {str(x.get("TABNAME", "")).strip(): int(x.get("TABROWS") or 0) for x in r.get("IT_TABLES", [])}
        except Exception:
            if len(tables) == 1:
                return {}
        out: dict[str, int] = {}  # one unreadable table: count the others one by one
        for t in tables:
            out.update(self.count_rows([t]))
        return out

    def payroll_totals(self, keys: list[tuple[str, str]], chunk: int = 2000) -> tuple[pd.DataFrame, int]:
        """Wage-type totals per payroll result (PERNR, SEQNR) from the customer-installed,
        read-only Z_MERIDIAN_PAYROLL_TOTALS (sap/abap/, docs/payroll-rfc.md). Returns
        (ZMERIDIAN_PAYRT rows, results the caller was not authorised to read)."""
        rows: list[dict] = []
        skipped = 0
        for i in range(0, len(keys), chunk):
            r = self.call(PAYROLL_FUNCTION, IT_RESULTS=[{"PERNR": p, "SEQNR": q} for p, q in keys[i:i + chunk]])
            rows += r.get("ET_TOTALS") or []
            skipped += int(r.get("EV_SKIPPED") or 0)
        df = pd.DataFrame(rows, columns=PAYROLL_FIELDS) if rows else pd.DataFrame(columns=PAYROLL_FIELDS)
        return df[PAYROLL_FIELDS].astype(str).apply(lambda c: c.str.strip()), skipped

    def execute_bapi(self, call: BAPICall) -> dict:
        if self._conn is None:
            raise SAPConnectorError("execute_bapi called before connect()")
        try:
            return self._conn.call(call.bapi_name, **call.params)
        except Exception as e:
            safe = self._mask_password(str(e), self._password)
            raise SAPConnectorError(safe) from e

    def ping(self) -> bool:
        if self._conn is None:
            return False
        try:
            self._conn.call("RFC_PING")
            return True
        except Exception:
            return False


# ── RFC_READ_TABLE helpers ─────────────────────────────────────────────────────


def _literal(value) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _range_where(where: Optional[str], key: str, r: tuple) -> str:
    """WHERE for the key range (op, lo, hi): ``key op lo AND key < hi``, None = open."""
    op, lo, hi = r
    return " AND ".join(c for c in (
        where, lo is not None and f"{key} {op} {_literal(lo)}",
        hi is not None and f"{key} < {_literal(hi)}") if c)


def _split(page: pd.DataFrame, key: str, r: tuple) -> list[tuple]:
    """Split a range that filled a page at the quartiles of the keys it returned."""
    op, lo, hi = r
    values = sorted(set(page[key]))
    cuts = sorted({values[len(values) * j // 4] for j in (1, 2, 3)} | {values[-1]})
    cuts = [c for c in cuts if lo is None or c > lo]
    if not cuts:  # every row returned has key == lo
        return [("=", lo, None), (">", lo, hi)]
    edges = [lo, *cuts, hi]
    return [(op if a == lo else ">=", a, b) for a, b in zip(edges, edges[1:])]


def _range_order(r: tuple) -> tuple:
    """Sort key putting ranges in key order: open start first, ``= lo`` before ``> lo``."""
    op, lo, _ = r
    return (lo is not None, "" if lo is None else str(lo), op != "=")


def _capped(pages: dict, pending: list[tuple], max_rows: int) -> bool:
    """True once the finished ranges below every pending range hold ``max_rows`` rows."""
    frontier = min(map(_range_order, pending), default=None)
    total = sum(len(p) for r, p in pages.items() if frontier is None or _range_order(r) < frontier)
    return total >= max_rows


def where_options(where: Optional[str]) -> list[dict]:
    """Split a WHERE clause into RFC_READ_TABLE OPTIONS lines (≤72 chars each).

    Breaks only between tokens and never inside a quoted literal. Parentheses
    and commas become separate tokens — ABAP dynamic WHERE needs blanks around
    parentheses anyway ("IN ( 'A' , 'B' )").
    """
    if not where:
        return []
    tokens = re.findall(r"'[^']*'|[(),]|[^\s(),']+", where)
    lines, cur = [], ""
    for tok in tokens:
        if len(tok) > 72:
            raise SAPConnectorError(f"WHERE token longer than 72 characters: {tok[:20]}…")
        cand = f"{cur} {tok}" if cur else tok
        if len(cand) > 72:
            lines.append(cur)
            cur = tok
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return [{"TEXT": line} for line in lines]


# ── RFC_READ_TABLE parser ──────────────────────────────────────────────────────
# Single canonical implementation — replaces the duplicates in connect.py
# and run_sync.py.

_WORK_AREA = 512  # bytes in RFC_READ_TABLE's DATA-WA


def _parse_rfc_result(result: dict) -> pd.DataFrame:
    """Parse RFC_READ_TABLE result into a pandas DataFrame.

    RFC_READ_TABLE returns:
      FIELDS: list of {FIELDNAME, OFFSET, LENGTH, TYPE, FIELDTEXT}
      DATA:   list of {WA: "value1value2..."} — fixed-width positional strings
    """
    fields_meta = result.get("FIELDS", [])
    data_rows = result.get("DATA", [])

    if not fields_meta:
        return pd.DataFrame()

    field_names = [f["FIELDNAME"].strip() for f in fields_meta]
    field_offsets = [
        (int(f.get("OFFSET", 0)), int(f.get("OFFSET", 0)) + int(f.get("LENGTH", 0)))
        for f in fields_meta
    ]

    rows = [
        [row.get("WA", "")[start:end].strip(" ") for start, end in field_offsets]
        for row in data_rows
    ]

    return pd.DataFrame(rows, columns=field_names)
