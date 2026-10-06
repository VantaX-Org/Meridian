"""Read-only configuration loaders behind ``load_config()`` of every connector.

  ABAP (ECC, S/4HANA on-premise, eWM): SPRO customizing tables over RFC_READ_TABLE. Everything flow derivation
      reads, plus what the registry lists as config for the system type, plus the S/4HANA-only tables.
  SuccessFactors: foundation objects, template objects, picklist values, entity names from OData $metadata.
  Concur: expense types, payment types, policies, group configuration.
  Ariba, S/4HANA Cloud, BTP: no configuration API is wired; every object is reported ``not_available``.

An object the system cannot expose is a state (``not_available``), never an error and never a guess.
Change history (DBTABLOG: dates and counts only, never user names) is ABAP only.
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any, Callable, Optional

import pandas as pd

from sap.config_snapshot import FAILED, NOT_AVAILABLE, ConfigSnapshot

logger = logging.getLogger("meridian.sap.config_loader")

ABAP_TYPES = ("ecc", "s4hana_onprem", "ewm", "ewms")
S4_ONPREM_EXTRA = ("CVI_CUST_LINK", "CVI_VEND_LINK", "FINSC_LEDGER")  # BP/CVI link config, ledger definition
MAX_ROWS = 20000
HISTORY_WINDOW_DAYS = 365
HISTORY_MAX_ROWS = 50000
_TABLE_NAME = re.compile(r"^[A-Z0-9_/]{1,30}$")

Progress = Optional[Callable[[int, int, str], None]]

# ---- ABAP -----------------------------------------------------------------------------------------


def abap_objects(system_type: str) -> dict[str, set[str]]:
    """Config table -> fields to read, for one ABAP system type."""
    from api.services.config_applicability import required_objects
    from sap.extraction_registry import SYSTEM_EXTRACTIONS, get_extraction_targets
    from sap.process_definitions import flow_config_tables

    out: dict[str, set[str]] = {}
    if system_type in ("ecc", "s4hana_onprem"):
        for t, (fields, _mods) in flow_config_tables().items():
            out.setdefault(t, set()).update(fields)
    for module in SYSTEM_EXTRACTIONS.get(system_type, {}):
        for t in get_extraction_targets(system_type, module, include_config=True):
            if t.is_config:
                out.setdefault(t.source, set()).update(t.fields or [])
    if system_type == "s4hana_onprem":
        for t in S4_ONPREM_EXTRA:
            out.setdefault(t, set())
    for t, fields in required_objects().items():
        if t in out:
            out[t].update(fields)
    return out


def _read_abap_table(conn, table: str, fields: set[str], dic, max_rows: int) -> tuple[pd.DataFrame, list[str]]:
    known = dic.table(table)
    if known is None:  # no dictionary entry: let RFC_READ_TABLE return every field (narrow tables only)
        return conn.read_table(table, [], max_rows=max_rows), []
    keys = [k for k in dic.keys(table) if k != "MANDT"]
    cols = [c for c in dict.fromkeys([*keys, *sorted(fields)]) if c != "MANDT" and dic.field(table, c) is not None]
    if not cols:
        cols = keys
    if hasattr(conn, "read_table_full"):
        return conn.read_table_full(table, cols, keys, max_rows=max_rows), keys
    return conn.read_table(table, cols, max_rows=max_rows), keys


def load_abap(conn, system_type: str, progress: Progress = None, max_rows: int = MAX_ROWS) -> ConfigSnapshot:
    from sap.ddic import dictionary_for_system

    snap = ConfigSnapshot(system_type=system_type)
    dic = dictionary_for_system(system_type)
    objects = abap_objects(system_type)
    for i, (table, fields) in enumerate(sorted(objects.items())):
        if progress:
            progress(i, len(objects), table)
        try:
            df, keys = _read_abap_table(conn, table, fields, dic, max_rows)
            snap.add_frame(table, df, keys or list(df.columns[:1]), truncated=max_rows > 0 and len(df) >= max_rows)
        except Exception as e:  # one table never costs the load
            msg = str(e)
            if "TABLE_NOT_AVAILABLE" in msg.upper():
                snap.mark(table, NOT_AVAILABLE, "table does not exist in this system")
            else:
                snap.mark(table, FAILED, msg)
    if progress:
        progress(len(objects), len(objects), "")
    return snap


def _iso(yyyymmdd: str) -> str:
    s = str(yyyymmdd).strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else ""


def read_history(conn, tables: list[str], window_days: int = HISTORY_WINDOW_DAYS, today: Optional[date] = None,
                 max_rows: int = HISTORY_MAX_ROWS) -> dict[str, Any]:
    """Customizing change history from DBTABLOG: per table the last change date and the change count in the
    window. Only populated when table logging is on (profile parameter rec/client), so an empty or unreadable
    DBTABLOG is the state ``table_logging_off``, not an error. Dates and counts only, no user names."""
    today = today or date.today()
    since = (today - timedelta(days=window_days)).strftime("%Y%m%d")
    out: dict[str, Any] = {"source": "DBTABLOG", "window_days": window_days, "since": _iso(since),
                           "table_logging_off": False, "detail": "", "tables": {}}
    try:
        probe = conn.read_table("DBTABLOG", ["TABNAME"], max_rows=1)
    except Exception as e:
        return {**out, "table_logging_off": True, "detail": f"DBTABLOG not readable: {str(e)[:120]}"}
    if probe is None or probe.empty:
        return {**out, "table_logging_off": True, "detail": "DBTABLOG is empty (table logging is off)"}
    for t in tables:
        if not _TABLE_NAME.match(t):
            continue
        try:
            df = conn.read_table("DBTABLOG", ["TABNAME", "LOGDATE"],
                                 where=f"TABNAME = '{t}' AND LOGDATE >= '{since}'", max_rows=max_rows)
        except Exception as e:
            out["tables"][t] = {"last_change": None, "changes_in_window": None, "detail": str(e)[:120]}
            continue
        dates = [d for d in df["LOGDATE"].astype(str).str.strip() if d] if "LOGDATE" in df else []
        out["tables"][t] = {"last_change": _iso(max(dates)) if dates else None, "changes_in_window": len(df),
                            "truncated": max_rows > 0 and len(df) >= max_rows}
    return out


# ---- Cloud ----------------------------------------------------------------------------------------

_CLOUD_KEYS = {"PickListValueV2": ["PickListV2_id", "externalCode"], "ODATA_ENTITY": ["name"]}
_CONCUR_OBJECTS = {  # object -> REST path (read-only GET)
    "ExpenseType": "/api/v3.0/expense/expensetypes",
    "PaymentType": "/api/v3.0/expense/paymenttypes",
    "Policy": "/api/v3.0/expense/policies",
    "ExpenseGroupConfiguration": "/api/v3.0/expense/expensegroupconfigurations",
}
_NO_CONFIG_API = {
    "ariba": "Ariba exposes no configuration API wired in Meridian",
    "s4hana_cloud": "S/4HANA Cloud has no customizing table access and no released configuration API wired in Meridian",
    "btp": "BTP exposes no configuration API wired in Meridian",
}
_SF_NOT_WIRED = ("MDF_OBJECT_DEFINITION", "BUSINESS_RULE")


def _classify(e: Exception) -> tuple[str, str]:
    msg = str(e)
    if re.search(r"\b(403|404)\b|not found|forbidden", msg, re.I):
        return NOT_AVAILABLE, f"not exposed to this API user or tenant: {msg[:120]}"
    return FAILED, msg


def load_cloud(conn, system_type: str, progress: Progress = None, max_rows: int = MAX_ROWS) -> ConfigSnapshot:
    snap = ConfigSnapshot(system_type=system_type)
    if system_type in _NO_CONFIG_API:
        snap.mark("*", NOT_AVAILABLE, _NO_CONFIG_API[system_type])
        return snap
    jobs: list[tuple[str, Callable[[], pd.DataFrame]]] = []
    if system_type == "successfactors":
        from sap.extraction_registry import SYSTEM_EXTRACTIONS, get_extraction_targets

        for module in SYSTEM_EXTRACTIONS["successfactors"]:
            for t in get_extraction_targets(system_type, module, include_config=True):
                if t.is_config:
                    jobs.append((t.source, lambda t=t: conn.read_entity_set(t.source, select=t.fields or None,
                                                                            top=max_rows)))
        jobs.append(("PickListValueV2", lambda: conn.read_entity_set(
            "PickListValueV2", select=["PickListV2_id", "externalCode", "status"], top=max_rows)))
        jobs.append(("ODATA_ENTITY", lambda: pd.DataFrame(
            {"name": sorted(set(re.findall(r'<EntityType Name="([^"]+)"', conn.metadata())))})))
        for obj in _SF_NOT_WIRED:
            snap.mark(obj, NOT_AVAILABLE, "no read API wired in Meridian for this object")
    elif system_type == "concur":
        for obj, path in _CONCUR_OBJECTS.items():
            jobs.append((obj, lambda path=path: conn._read_endpoint(path, top=max_rows)))
    else:
        snap.mark("*", NOT_AVAILABLE, f"no configuration loader for system type {system_type}")
        return snap
    for i, (obj, read) in enumerate(jobs):
        if progress:
            progress(i, len(jobs), obj)
        try:
            df = read()
            snap.add_frame(obj, df, _CLOUD_KEYS.get(obj, ["externalCode"] if system_type == "successfactors"
                                                    else list(df.columns[:1])), truncated=len(df) >= max_rows > 0)
        except Exception as e:
            state, detail = _classify(e)
            snap.mark(obj, state, detail)
    if progress:
        progress(len(jobs), len(jobs), "")
    return snap


def not_available_history(reason: str) -> dict[str, Any]:
    return {"source": None, "table_logging_off": False, "detail": reason, "tables": {}, "available": False}
