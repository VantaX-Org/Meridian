"""ODP extraction (Operational Data Provisioning) through SAP's ODP replication RFC interface.

A supported read path for sites whose Basis team refuses the generic table readers (RFC_READ_TABLE and its
relatives). Four remote-enabled function modules of function group RODPS_REPL are used, read-only:

  RODPS_REPL_ODP_GET_DETAIL   the provider's field list (names, lengths, key flags)
  RODPS_REPL_ODP_OPEN         opens a full extraction of one provider and returns a pointer
  RODPS_REPL_ODP_FETCH        one package of rows per call, until the provider says there is no more data
  RODPS_REPL_ODP_CLOSE        releases the pointer (always called, also after a failed fetch)

Contexts: SAPI (classic extractors such as 0MATERIAL_ATTR) and ABAP_CDS (released CDS views with extraction
annotations on S/4HANA). Full extraction only: no delta subscription is opened, so nothing is left behind in the
delta queue (ODQMON) apart from the request of the full load itself.

Parameter names. The function names are fixed. Every parameter name is looked up in the function's interface on
the connected system (RFC_GET_FUNCTION_INTERFACE) before it is sent: ``_ROLES`` lists, per function, the name(s)
Meridian expects for each role. A required role whose name the system's interface does not have stops the read
with one sentence naming the function and the parameter, before anything is opened. A mandatory import parameter
of the system's interface that Meridian does not fill stops it too. Nothing is guessed at runtime.

Row format. A fetched package (the ``data`` role) is decoded as either structured rows (one key per provider field)
or character rows laid out by the field list's lengths in field order. A package that arrives as bytes (a
compressed or binary package format) is refused with a clear sentence rather than decoded by guesswork.

The result is the table reader's shape: a DataFrame of strings, stripped, one column per provider field.
sap/odp_mapping.py renames the columns to the SAP table's field names.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import pandas as pd

from .base import SAPConnectorError

logger = logging.getLogger("meridian.sap.odp")

FN_DETAIL = "RODPS_REPL_ODP_GET_DETAIL"
FN_OPEN = "RODPS_REPL_ODP_OPEN"
FN_FETCH = "RODPS_REPL_ODP_FETCH"
FN_CLOSE = "RODPS_REPL_ODP_CLOSE"
ODP_FUNCTIONS = (FN_DETAIL, FN_OPEN, FN_FETCH, FN_CLOSE)
INTERFACE_FUNCTION = "RFC_GET_FUNCTION_INTERFACE"
CONTEXTS = ("SAPI", "ABAP_CDS")
FULL = "F"  # extraction mode: full

# Per function: role -> the parameter name Meridian sends for it. Checked against the system's interface.
_ROLES: dict[str, dict[str, str]] = {
    FN_DETAIL: {"subscriber_type": "I_SUBSCRIBER_TYPE", "context": "I_CONTEXT", "odp": "I_ODPNAME",
                "fields": "ET_FIELDS"},
    FN_OPEN: {"subscriber_type": "I_SUBSCRIBER_TYPE", "subscriber": "I_SUBSCRIBER_NAME",
              "process": "I_SUBSCRIBER_PROCESS", "context": "I_CONTEXT", "odp": "I_ODPNAME",
              "mode": "I_EXTRACTION_MODE", "package_size": "I_MAXPACKAGESIZE", "pointer": "E_POINTER"},
    FN_FETCH: {"pointer": "I_POINTER", "package_size": "I_MAXPACKAGESIZE", "data": "ET_DATA",
               "no_more": "E_NO_MORE_DATA"},
    FN_CLOSE: {"pointer": "I_POINTER"},
}
# Roles Meridian can do without: sent only when the system's interface has the parameter.
_OPTIONAL_ROLES = {"subscriber_type", "subscriber", "process", "package_size"}
_ROLE_WORDS = {"context": "the ODP context", "odp": "the provider name", "fields": "the field list",
               "mode": "the extraction mode", "pointer": "the extraction pointer", "data": "the fetched rows",
               "no_more": "the end-of-data flag"}

# Column names of a field-list row (ET_FIELDS), tried in order.
_NAME_COLS = ("NAME", "FIELDNAME")
_LENGTH_COLS = ("OUTPUTLENG", "LENGTH", "LENG")
_KEY_COLS = ("KEYFLAG", "KEY")
# Column names of a character data row, tried in order.
_ROW_COLS = ("DATA", "WA", "LINE")

MAX_PACKAGES = 100_000  # a provider that never says "no more data" must not loop forever


def subscriber_type() -> str:
    """The subscriber type sent with GET_DETAIL and OPEN. Agree it with the Basis team (ODQMON shows it)."""
    return (os.environ.get("MERIDIAN_ODP_SUBSCRIBER_TYPE") or "RODPS_REPL_TEST").strip()


def package_size() -> int:
    """Bytes per package asked of OPEN/FETCH when the interface takes a package size (MERIDIAN_ODP_PACKAGE_BYTES)."""
    try:
        return max(1_000_000, int(os.environ.get("MERIDIAN_ODP_PACKAGE_BYTES") or 50_000_000))
    except ValueError:
        return 50_000_000


@dataclass
class ODPField:
    name: str
    length: int = 0
    key: bool = False


@dataclass
class Interface:
    """A function's parameters on the connected system: name -> (class I/E/C/T, optional)."""
    function: str
    params: dict[str, tuple[str, bool]] = field(default_factory=dict)


@dataclass
class ODPRead:
    """One provider read: the rows (provider field names), the packages fetched, whether a row cap cut it short."""
    frame: pd.DataFrame
    packages: int
    truncated: bool
    fields: list[ODPField]


class ODPReader:
    """Reads ODP providers over an RFC ``call(function, **params) -> dict`` (sap/rfc.py RFCConnector.call)."""

    def __init__(self, call: Callable[..., dict], subscriber: str = "MERIDIAN") -> None:
        self._call = call
        self._subscriber = subscriber
        self._interfaces: dict[str, Interface] = {}

    # ── Interfaces ──────────────────────────────────────────────────────────────

    def available(self) -> bool:
        """True when all four RODPS_REPL_ODP functions exist (RFC_FUNCTION_SEARCH). False when the search is refused."""
        for fm in ODP_FUNCTIONS:
            try:
                found = self._call("RFC_FUNCTION_SEARCH", FUNCNAME=fm).get("FUNCTIONS") or []
            except Exception as e:  # not authorised for the search, or the function is missing
                logger.info("RFC_FUNCTION_SEARCH for %s failed (%s)", fm, type(e).__name__)
                return False
            if not any(str(f.get("FUNCNAME", "")).strip() == fm for f in found):
                return False
        return True

    def interface(self, function: str) -> Interface:
        """The function's parameters on this system, read once per reader."""
        if function in self._interfaces:
            return self._interfaces[function]
        try:
            r = self._call(INTERFACE_FUNCTION, FUNCNAME=function)
        except SAPConnectorError as e:
            raise SAPConnectorError(
                f"{function} is not available on this system or cannot be inspected ({_first_line(e)}). ODP "
                f"extraction needs function group RODPS_REPL (SAP_BW component) and S_RFC for it and for "
                f"{INTERFACE_FUNCTION}; set the extraction path to the table reader until it is in place.") from e
        params = {str(p.get("PARAMETER", "")).strip(): (str(p.get("PARAMCLASS", "")).strip(),
                                                        str(p.get("OPTIONAL", "")).strip() == "X")
                  for p in (r.get("PARAMS") or []) if str(p.get("PARAMETER", "")).strip()}
        if not params:
            raise SAPConnectorError(f"{function} is not available on this system: its interface is empty.")
        self._interfaces[function] = Interface(function, params)
        return self._interfaces[function]

    def _name(self, function: str, role: str) -> Optional[str]:
        """The parameter this system's ``function`` has for ``role``; None for a missing optional role."""
        name = _ROLES[function][role]
        if name in self.interface(function).params:
            return name
        if role in _OPTIONAL_ROLES:
            return None
        raise SAPConnectorError(
            f"{function} on this system has no parameter {name} for {_ROLE_WORDS.get(role, role)}, so Meridian "
            f"cannot use ODP on this release. Confirm the interface in SE37 and set the extraction path to the "
            f"table reader or OData.")

    def _send(self, function: str, values: dict[str, Any]) -> dict:
        """Call ``function`` with ``values`` (role -> value), mapped to this system's parameter names."""
        params: dict[str, Any] = {}
        for role, value in values.items():
            name = self._name(function, role)
            if name is not None:
                params[name] = value
        iface = self.interface(function)
        unfilled = sorted(n for n, (cls, optional) in iface.params.items()
                          if cls == "I" and not optional and n not in params)
        if unfilled:
            raise SAPConnectorError(
                f"{function} on this system needs {', '.join(unfilled)}, which Meridian does not send. Confirm the "
                f"interface in SE37 and set the extraction path to the table reader or OData.")
        return self._call(function, **params)

    # ── Provider ────────────────────────────────────────────────────────────────

    def fields(self, context: str, odp: str) -> list[ODPField]:
        """The provider's field list (RODPS_REPL_ODP_GET_DETAIL)."""
        _check_context(context)
        r = self._send(FN_DETAIL, {"subscriber_type": subscriber_type(), "context": context, "odp": odp})
        rows = r.get(self._name(FN_DETAIL, "fields") or "") or []
        out = []
        for row in rows:
            name = str(_first(row, _NAME_COLS) or "").strip()
            if not name:
                continue
            out.append(ODPField(name=name, length=_int(_first(row, _LENGTH_COLS)),
                                key=str(_first(row, _KEY_COLS) or "").strip() == "X"))
        if not out:
            raise SAPConnectorError(f"ODP provider {odp} ({context}) returned no fields: it is not released for "
                                    f"extraction on this system, or the user may not read it (S_RO_OSOA / S_RS_ODP).")
        return out

    def read(self, context: str, odp: str, wanted: Optional[list[str]] = None, max_rows: int = 0,
             on_package: Optional[Callable[[int, int], None]] = None) -> ODPRead:
        """Full extraction of ``odp``: OPEN, FETCH until no more data (or ``max_rows``), CLOSE.

        ``wanted``: provider fields to keep, matched without regard to case (None = all).
        ``on_package(packages, rows)`` after every package.
        """
        provider_fields = self.fields(context, odp)
        names = [f.name for f in provider_fields]
        want = None if wanted is None else {w.upper() for w in wanted}  # CDS element names arrive upper-cased
        keep = names if want is None else [n for n in names if n.upper() in want]
        opened = self._send(FN_OPEN, {"subscriber_type": subscriber_type(), "subscriber": self._subscriber,
                                      "process": f"{self._subscriber}_{odp}"[:30], "context": context, "odp": odp,
                                      "mode": FULL, "package_size": package_size()})
        pointer = opened.get(self._name(FN_OPEN, "pointer") or "")
        if not str(pointer or "").strip():
            raise SAPConnectorError(f"{FN_OPEN} returned no extraction pointer for {odp} ({context}).")
        frames: list[pd.DataFrame] = []
        rows = packages = 0
        truncated = False
        data_param = self._name(FN_FETCH, "data") or ""
        no_more_param = self._name(FN_FETCH, "no_more") or ""
        try:
            while True:
                if packages >= MAX_PACKAGES:
                    raise SAPConnectorError(f"{odp}: more than {MAX_PACKAGES} packages without an end of data.")
                r = self._send(FN_FETCH, {"pointer": pointer, "package_size": package_size()})
                packages += 1
                part = _decode(r.get(data_param) or [], provider_fields, odp)
                if not part.empty:
                    frames.append(part[[c for c in keep if c in part.columns]])
                    rows += len(part)
                if on_package:
                    on_package(packages, rows)
                if max_rows and rows >= max_rows:
                    truncated = True
                    break
                if str(r.get(no_more_param) or "").strip() == "X":
                    break
        finally:
            try:
                self._send(FN_CLOSE, {"pointer": pointer})
            except Exception as e:  # never hide the read's own error; say the close failed
                logger.warning("%s for %s failed (%s): SAP keeps the request until it expires", FN_CLOSE, odp,
                               type(e).__name__)
        frame = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=keep)
        if max_rows and len(frame) > max_rows:
            frame = frame.iloc[:max_rows]
        logger.info("ODP %s (%s): %d rows in %d packages", odp, context, len(frame), packages)
        return ODPRead(frame=frame, packages=packages, truncated=truncated, fields=provider_fields)


# ── Helpers ─────────────────────────────────────────────────────────────────────


def _check_context(context: str) -> None:
    if context not in CONTEXTS:
        raise SAPConnectorError(f"ODP context {context!r} is not one of {', '.join(CONTEXTS)}")


def _first(row: dict, cols: tuple[str, ...]) -> Any:
    for c in cols:
        if c in row:
            return row[c]
    return None


def _int(v: Any) -> int:
    try:
        return int(str(v).strip() or 0)
    except ValueError:
        return 0


def _first_line(e: Exception) -> str:
    return str(e).splitlines()[0][:200] if str(e) else type(e).__name__


def _decode(rows: list, fields: list[ODPField], odp: str) -> pd.DataFrame:
    """One fetched package as a frame of stripped strings with provider field names as columns."""
    names = [f.name for f in fields]
    if not rows:
        return pd.DataFrame(columns=names)
    first = rows[0]
    if not isinstance(first, dict):
        raise SAPConnectorError(f"ODP {odp}: a package row is a {type(first).__name__}, not a structure.")
    if set(names) & set(first):  # structured rows: one key per provider field
        out = pd.DataFrame([{n: r.get(n, "") for n in names} for r in rows], columns=names)
        return out.astype(str).apply(lambda c: c.str.strip())
    line_col = next((c for c in _ROW_COLS if c in first), None)
    if line_col is None and len(first) == 1:
        line_col = next(iter(first))
    value = first.get(line_col) if line_col else None
    if isinstance(value, (bytes, bytearray)):
        raise SAPConnectorError(
            f"ODP {odp}: this system returns packages in a binary format, which Meridian does not decode. Use the "
            f"table reader or the OData path for this system.")
    if not isinstance(value, str):
        raise SAPConnectorError(f"ODP {odp}: package rows have neither provider fields nor a character line.")
    if not all(f.length > 0 for f in fields):
        raise SAPConnectorError(f"ODP {odp}: the field list has no lengths, so character rows cannot be split.")
    bounds, off = [], 0
    for f in fields:
        bounds.append((off, off + f.length))
        off += f.length
    data = [[str(r.get(line_col, ""))[a:b].strip() for a, b in bounds] for r in rows]
    return pd.DataFrame(data, columns=names)
