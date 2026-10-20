"""PyRFC connector implementation.

Wraps pyrfc as an optional import so the rest of the codebase never imports
pyrfc directly. If pyrfc is not installed, SAPConnectorError is raised on
connect() — not on import of this module.
"""

from __future__ import annotations

import heapq
import logging
import os
import queue
import re
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from itertools import count
from typing import Callable, Optional, Protocol

import pandas as pd

from .base import BAPICall, SAPConnectionParams, SAPConnector, SAPConnectorError

logger = logging.getLogger("meridian.sap.rfc")


class _Conn(Protocol):
    """What RFCConnector needs from a pyrfc Connection (or the test fake)."""

    def call(self, function: str, **params) -> dict: ...
    def close(self) -> None: ...


PAYROLL_FUNCTION = "Z_MERIDIAN_PAYROLL_TOTALS"
PAYROLL_TABLE = "ZMERIDIAN_PAYRT"
PAYROLL_FIELDS = ["PERNR", "SEQNR", "FPPER", "INPER", "PAYDT", "LGART", "BETRG", "ANZHL", "WAERS"]


# SAP's reply to a locked or expired user. Nothing here should retry on these: every further
# attempt extends SAP's lock, and the operator has to act (SU01) rather than wait.
_LOGON_LOCKED = ("too many failed attempts", "password logon no longer possible",
                 "user is locked", "logon currently not possible")


# Per-system cooldown after a lock/expiry reply. Meridian must not be able to contribute to a
# lock: once SAP says the user is locked or expired, every further attempt is another failed
# attempt, and repeated attempts are what turn a locked user into a stubbornly locked one.
_LOGON_BLOCKED: dict[str, float] = {}
_LOGON_COOLDOWN_S = 15 * 60


def _logon_key(params) -> str:
    return f"{params.host}/{params.sysnr}/{params.client}/{params.user}"


def logon_blocked_for(params) -> float:
    """Seconds still to wait before this system may be connected to again (0 = allowed)."""
    import time
    until = _LOGON_BLOCKED.get(_logon_key(params), 0.0)
    return max(0.0, until - time.time())


def _note_logon_failure(params, message: str) -> None:
    import time
    if any(k in message.lower() for k in _LOGON_LOCKED):
        _LOGON_BLOCKED[_logon_key(params)] = time.time() + _LOGON_COOLDOWN_S


def clear_logon_block(params) -> None:
    """Called by an operator action (a connection test) so a fixed password takes effect at once."""
    _LOGON_BLOCKED.pop(_logon_key(params), None)


class ExtractionMemoryError(RuntimeError):
    """Raised instead of letting the process be OOM-killed.

    An OOM kill is SIGKILL: no `finally`, no `close()`. The RFC sessions are left dangling, and
    SAP counts an uncleaned session against the user exactly as it counts a failed logon - which
    is how the sandbox user was locked twice. Failing cleanly keeps the sessions closable, so the
    account cannot be locked by running out of memory.
    """


def available_memory_bytes() -> int | None:
    """MemAvailable from /proc/meminfo, or None where it cannot be read."""
    try:
        with open("/proc/meminfo", encoding="ascii") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def require_memory(needed: int, what: str, fraction: float | None = None) -> None:
    """Refuse an allocation that would risk an OOM kill, before making it.

    The default allows 80% of MemAvailable. It was 55% while `astype` copied the whole frame at
    write time and the group join allocated a second one - both copies are gone (the write converts
    columns in place, the join builds from views), so the real requirement is now about 1.1x the
    frame rather than 2x.

    The old value stopped the material_master baseline by 2%: "storing MARC needs about 17.1 GB and
    only 16.7 GB is available (limit 55%)". The guard did its job - no OOM, sessions closed, the SAP
    account stayed unlocked, which is exactly why it exists - but it was refusing a run that fits.

    ``MERIDIAN_EXTRACT_MEMORY_FRACTION`` overrides it per deployment.
    """
    if fraction is None:
        try:
            fraction = float(os.environ.get("MERIDIAN_EXTRACT_MEMORY_FRACTION") or 0.80)
        except ValueError:
            fraction = 0.80
    avail = available_memory_bytes()
    if avail is None or needed <= avail * fraction:
        return
    raise ExtractionMemoryError(
        f"{what} needs about {needed / 1e9:.1f} GB and only {avail / 1e9:.1f} GB is available "
        f"(limit {int(fraction * 100)}%). Stopping before the allocation: an OOM kill cannot be "
        f"caught, so it would leave the SAP sessions open and lock the user. Raise the worker's "
        f"memory, or narrow the object's rules, and run again.")


def _join_group(merged, part, keys: list[str]):
    """Add ``part``'s columns to ``merged`` without allocating a second whole frame.

    ``merged.merge(part, on=keys, how="outer")`` builds a new frame while both inputs are still
    alive, so a wide table's peak is twice its size. Wide tables are exactly the ones this split
    exists for: MARC is 18.3M rows and its fields do not fit one RFC work area, so it is read in
    groups and merged - at ~18 GB a frame that is ~36 GB peak, which is an OOM kill on a 30 GB
    box even when the read itself succeeded.

    Every group is read over the same key ranges in the same order, so when the keys line up
    row-for-row the columns can simply be attached. The key comparison is the guard: if the rows
    do not correspond exactly, fall back to the merge, which is correct for any order.
    """
    if keys and len(part) == len(merged):
        try:
            same = (part[keys].to_numpy() == merged[keys].to_numpy()).all()
        except Exception:
            same = False
        if same:
            # Build the combined frame in ONE allocation from the underlying arrays, which are
            # views - no copy of the data. Assigning the columns one at a time
            # (`merged[col] = part[col].to_numpy()`) instead makes pandas consolidate blocks on
            # every assignment, copying the whole frame repeatedly: on MARC (18.3M rows, 98
            # fields in groups) that is what pushed an 18 GB frame past 30 GB and got the worker
            # OOM-killed, with the store() guard never reached because the crash came first.
            data = {c: merged[c].to_numpy() for c in merged.columns}
            for col in part.columns:
                if col not in data:
                    data[col] = part[col].to_numpy()
            return pd.DataFrame(data, copy=False)
    # The fallback allocates a second whole frame. Check before doing it rather than being killed
    # mid-allocation, which would leave the SAP sessions dangling.
    require_memory(int(merged.memory_usage(deep=True).sum()) + int(part.memory_usage(deep=True).sum()),
                   "joining RFC field groups for a wide table")
    if keys:
        return merged.merge(part, on=keys, how="outer")
    return pd.concat([merged, part], axis=1)


def _logon_advice(message: str) -> str:
    """Append what the operator must do, so a locked user is not mistaken for a wrong password."""
    if any(k in message.lower() for k in _LOGON_LOCKED):
        return (message + " - the SAP user is locked or its password has expired. An SAP basis "
                          "administrator must unlock it (transaction SU01) or reset the password. "
                          "Meridian does not retry, because each failed attempt extends the lock.")
    return message


class RFCConnector(SAPConnector):
    """SAP connector backed by pyrfc / SAP NW RFC SDK."""

    def __init__(self, parallel: int = 0) -> None:
        """``parallel``: RFC connections a keyed read uses at once; 0 = MERIDIAN_RFC_PARALLEL or 2."""
        self._conn: Optional[_Conn] = None
        self._password: str = ""   # held only during an active connection
        if not parallel:
            try:
                # Two, not four. Every extra session is another logon for the same SAP user and a
                # surplus one is refused - a refusal is how a lock accumulates. With worker
                # concurrency 4 that is 8 sessions at worst instead of 16, against a typical SAP
                # limit of 6.
                parallel = int(os.environ.get("MERIDIAN_RFC_PARALLEL") or 2)
            except ValueError:
                parallel = 2
        self._parallel = max(1, min(8, parallel))
        self._open_extra: Optional[Callable[[], _Conn]] = None  # opens another connection like the primary
        self._extra: Optional[list[_Conn]] = None  # extra connections; None = not opened yet

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def connect(self, params: SAPConnectionParams) -> None:
        # Checked before anything else, including loading the driver: while SAP reports the user
        # locked, no attempt of any kind may be made, because each one extends the lock.
        wait = logon_blocked_for(params)
        if wait > 0:
            raise SAPConnectorError(
                f"not attempting logon to {_logon_key(params)}: a previous attempt reported the "
                f"user locked or the password expired, and retrying extends the lock. Waiting "
                f"{int(wait)}s. An SAP basis administrator must unlock the user (SU01) or reset "
                f"the password; a successful connection test clears this wait.")
        if self._conn is not None or self._extra is not None:
            self.close()  # a stale pool from a previous connect() would keep old params and sessions open
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
            _note_logon_failure(params, safe)
            raise SAPConnectorError(_logon_advice(safe)) from e
        # A successful logon proves the account works again (unlocked, password reset), so the
        # cooldown must lift at once - otherwise the operator unlocks the user and Meridian still
        # refuses for the remainder of the window it set itself.
        clear_logon_block(params)
        logger.info("RFC logon ok: %s (client %s, user %s)", params.host, params.client, params.user)
        self._open_extra = lambda: pyrfc.Connection(ashost=params.host, client=params.client, user=params.user,
                                                    passwd=params.password, sysnr=params.sysnr)

    def close(self) -> None:
        """Close every session, and say so. A close that fails silently leaves the session open on
        SAP's side, and SAP counts an uncleaned session against the user exactly like a failed
        logon - a lock path with no OOM and no retry behind it. Swallowing the exception meant
        nobody could see it happen, so each attempt looked clean while the account drifted towards
        a lock. It is still not fatal (the process is going away either way), but it is now loud.
        """
        sessions = [c for c in [self._conn, *(self._extra or [])] if c is not None]
        closed = failed = 0
        for c in sessions:
            try:
                c.close()
                closed += 1
            except Exception as e:
                failed += 1
                logger.warning("RFC session close FAILED (%s); SAP may keep the session open and "
                               "count it against the user: %s", type(e).__name__,
                               self._mask_password(str(e), self._password or "")[:200])
        if sessions:
            logger.info("RFC sessions closed: %d ok, %d failed (of %d)", closed, failed, len(sessions))
        self._conn, self._extra, self._open_extra = None, None, None
        self._password = ""   # clear from memory

    def _pool(self) -> list[_Conn]:
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
        # Extra SAP sessions cost a logon each and are worth it only once a read
        # is big enough to split: probe group 1's open range on the primary
        # first, and open the pool only if that came back full.
        probe, full = None, False
        if keys and groups and self._parallel > 1:
            try:
                probe = self._read_paged(table, keys + groups[0], where, page_size, page_size)
                full = len(probe) >= page_size
            except SAPConnectorError as e:
                if "TSV_TNEW_PAGE_ALLOC_FAILED" not in str(e) or page_size <= 1000:
                    raise
                probe, full = None, True  # SAP is already short on memory for one page: worth parallelising
        if full and len(conns := self._pool()) > 1:
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
            if keys and i == 0 and probe is not None and not full:
                part, ranges = probe, [(">=", None, None)]  # the whole table: already read by the probe above
                on_page(len(part))
            elif keys:
                part, ranges = self._read_ranges(table, keys + group, keys[0], where, page_size, on_page, ranges,
                                                 max_rows)
            else:
                part = self._read_paged(table, keys + group, where, max_rows, page_size, on_page)
            merged = part if merged is None else _join_group(merged, part, keys)
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
                          conns: list[_Conn]) -> list[tuple[pd.DataFrame, list]]:
        """``_read_ranges`` for each field list in ``groups``, over several connections at once.

        Every (group, range) is a separate read; a full page is split and its
        parts queued, like the serial read. Each connection serves one read at
        a time. Pages are joined in key order, not completion order. A capped
        read stops once the ranges below every pending one hold ``max_rows``,
        so it returns the same lowest keys as the serial read. ``on_rows`` is
        called on the caller's thread only. Returns (rows, ranges) per group.
        """
        # A heap keyed on key order: pushing a range's split/retry is O(log n),
        # against resorting the whole list (and recomputing _range_order for
        # every entry) after every completed read.
        seq = count()  # tiebreak so entries with an equal key never compare r itself
        def entry(g: int, r: tuple) -> tuple:
            return (_range_order(r), g, next(seq), r)
        todo = [entry(g, r) for g in range(len(groups)) for r in (ranges or [(">=", None, None)])]
        heapq.heapify(todo)
        pages: list[dict] = [{} for _ in groups]
        free: queue.Queue[_Conn] = queue.Queue()
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
                        _, g, _, r = heapq.heappop(todo)
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
                            heapq.heappush(todo, entry(g, r))
                            continue
                        if r[0] != "=" and len(page) >= size:
                            for s in _split(page, key, r):
                                heapq.heappush(todo, entry(g, s))
                            continue
                        pages[g][r] = page
                        rows += len(page)
                        on_rows(rows)
                    pending = [r for _, r, _ in running.values()] + ([todo[0][3]] if todo else [])
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
                    conn: Optional[_Conn] = None) -> pd.DataFrame:
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
    # ponytail: O(ranges) per call, so O(ranges^2) over a capped read. Fine at a
    # 5M-row cap (tens of pages); keep a running prefix total if caps grow much past that.
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
