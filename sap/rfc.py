"""PyRFC connector implementation.

Wraps pyrfc as an optional import so the rest of the codebase never imports
pyrfc directly. If pyrfc is not installed, SAPConnectorError is raised on
connect() — not on import of this module.
"""

from __future__ import annotations

import logging
from typing import Optional

import pandas as pd

from .base import BAPICall, SAPConnectionParams, SAPConnector, SAPConnectorError

logger = logging.getLogger("meridian.sap.rfc")


class RFCConnector(SAPConnector):
    """SAP connector backed by pyrfc / SAP NW RFC SDK."""

    def __init__(self) -> None:
        self._conn = None
        self._password: str = ""   # held only during an active connection

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

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None
        self._password = ""   # clear from memory

    # ── Operations ─────────────────────────────────────────────────────────────

    def read_table(
        self,
        table: str,
        fields: list[str],
        where: Optional[str] = None,
        max_rows: int = 0,
    ) -> pd.DataFrame:
        if self._conn is None:
            raise SAPConnectorError("read_table called before connect()")
        options = [{"TEXT": where}] if where else []
        try:
            result = self._conn.call(
                "RFC_READ_TABLE",
                QUERY_TABLE=table,
                FIELDS=[{"FIELDNAME": f} for f in fields],
                OPTIONS=options,
                ROWCOUNT=max_rows,
            )
        except Exception as e:
            safe = self._mask_password(str(e), self._password)
            raise SAPConnectorError(safe) from e
        return _parse_rfc_result(result)

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


# ── RFC_READ_TABLE parser ──────────────────────────────────────────────────────
# Single canonical implementation — replaces the duplicates in connect.py
# and run_sync.py.

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
        [row.get("WA", "")[start:end].strip() for start, end in field_offsets]
        for row in data_rows
    ]

    return pd.DataFrame(rows, columns=field_names)
