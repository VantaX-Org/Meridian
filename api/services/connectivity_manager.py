"""Connectivity Manager -- orchestrates connections, extraction, and config sync.

Coordinates:
1. System registration with type-aware credential storage
2. Connection testing for all system types
3. Module-aware data extraction
4. Config (SPRO/FO) extraction and caching
5. Connection health monitoring
"""

import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Optional

import httpx
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.middleware.cache import invalidate_tenant_cache

from sap.base import (
    SAPConnectionParams,
    CloudConnectionParams,
    SAPConnectorError,
)
from sap.rfc import PAYROLL_FUNCTION, PAYROLL_TABLE
from sap.extraction_registry import (
    get_extraction_targets,
    get_available_modules,
    preview_sources,
    ExtractionTarget,
)

if TYPE_CHECKING:
    from sap.extraction_plan import TablePlan
    from sap.rfc import RFCConnector

logger = logging.getLogger("meridian.connectivity_manager")

RFC_SYSTEM_TYPES = ("ecc", "s4hana_onprem", "ewm")
CLOUD_SYSTEM_TYPES = ("successfactors", "concur", "ariba", "s4hana_cloud", "btp")


def _not_found(e: Exception) -> bool:
    """An OData 404: the entity is not enabled in this tenant. The HTTP status decides when the
    error carries one; the message (which includes the URL) is only a fallback."""
    if isinstance(e.__cause__, httpx.HTTPStatusError):
        return e.__cause__.response.status_code == 404
    return e.__cause__ is None and bool(re.search(r"\b404\b|is not found", str(e)))


def _bad_property(e: Exception, entity: str) -> str | None:
    """The property an SF 400 ('[COE0003]Bad property expression: Ent/prop', '[COE0021]Invalid property
    names: Ent/prop') rejects, as it appears in $select."""
    if not (isinstance(e.__cause__, httpx.HTTPStatusError) and e.__cause__.response.status_code == 400):
        return None
    m = re.search(rf"(?:Bad property expression|Invalid property names?):\s*{re.escape(entity)}/([\w/]+)", str(e))
    return m.group(1) if m else None


def baseline_key(system_type: str) -> str:
    """Map a sap_systems.system_type to its BASELINE_CONFIG / registry key."""
    return {"s4hana_onprem": "ecc", "ewm": "ewms"}.get(system_type, system_type)


def connect_sap_system(system_type: str, params: dict):
    """Build and connect the correct SAP connector for a system_type.

    `params` must carry the fields for that system_type, as built by
    `ConnectivityManager._build_connection_params()`. Shared by the
    connectivity manager (extraction/config-sync) and the systems API
    (test-connection) so there is exactly one dispatch table for
    system_type -> connector. Caller owns the returned connector's
    lifecycle and must call close().
    """
    if system_type in RFC_SYSTEM_TYPES:
        from sap import get_connector
        connector = get_connector()
        connector.connect(SAPConnectionParams(
            host=params["host"],
            client=params["client"],
            sysnr=params["sysnr"],
            user=params["user"],
            password=params["password"],
            read_function=params.get("read_function") or "",
            extraction_path=params.get("extraction_path") or "",
        ))
        return connector

    elif system_type == "successfactors":
        from sap.successfactors import SuccessFactorsConnector
        connector = SuccessFactorsConnector()
        connector.connect(CloudConnectionParams(
            base_url=params["base_url"],
            company_id=params.get("company_id", ""),
            auth_type=params.get("auth_type") or "basic",
            username=params.get("username", ""),
            password=params.get("password", ""),
            client_id=params.get("client_id", ""),
            client_secret=params.get("client_secret", ""),
            token_url=params.get("token_url", ""),
        ))
        return connector

    elif system_type == "concur":
        from sap.concur import ConcurConnector
        connector = ConcurConnector()
        connector.connect(CloudConnectionParams(
            base_url=params["base_url"],
            company_id=params.get("company_id", ""),
            auth_type="oauth2_client_credentials",
            client_id=params.get("client_id", ""),
            client_secret=params.get("client_secret", ""),
            token_url=params.get("token_url", ""),
        ))
        return connector

    elif system_type == "ariba":
        from sap.ariba import AribaConnector
        connector = AribaConnector()
        connector.connect(CloudConnectionParams(
            base_url=params["base_url"],
            company_id=params.get("company_id", ""),
            auth_type="oauth2_client_credentials",
            client_id=params.get("client_id", ""),
            client_secret=params.get("client_secret", ""),
            token_url=params.get("token_url", ""),
            api_key=params.get("api_key", ""),
        ))
        return connector

    elif system_type in ("s4hana_cloud", "btp"):  # BTP: XSUAA token URL, same OAuth flow
        from sap.btp import BTPConnector
        from sap.s4hana_cloud import S4HanaCloudConnector
        connector = BTPConnector() if system_type == "btp" else S4HanaCloudConnector()
        connector.connect(CloudConnectionParams(
            base_url=params["base_url"],
            company_id=params.get("company_id", ""),
            auth_type=params.get("auth_type") or "oauth2_client_credentials",
            client_id=params.get("client_id", ""),
            client_secret=params.get("client_secret", ""),
            token_url=params.get("token_url", ""),
        ))
        return connector

    raise SAPConnectorError(f"No connector for system_type: {system_type}")


def connect_onprem_odata(params: dict):
    """The SAP Gateway OData V2 connector of an on-premise S/4HANA system (extraction_path "odata",
    sap/s4hana_onprem.py): the system's base URL, its SAP client as sap-client, and basic sign-in with the
    system's user and password unless OAuth client credentials are stored. Caller closes it."""
    from sap.s4hana_onprem import S4OnPremODataConnector

    if not params.get("base_url"):
        raise SAPConnectorError("The OData extraction path needs the Gateway's base URL on the system's connection "
                                "settings, for example https://s4host:44300.")
    auth = params.get("odata_auth") or "basic"
    connector = S4OnPremODataConnector(sap_client=params.get("client") or "")
    connector.connect(CloudConnectionParams(
        base_url=params["base_url"], company_id="", auth_type=auth,
        username=params.get("user", ""), password=params.get("password", ""),
        client_id=params.get("client_id", ""), client_secret=params.get("client_secret", ""),
        token_url=params.get("token_url", ""),
    ))
    return connector


@dataclass(frozen=True)
class DeltaRequest:
    """Re-read only what SAP's change documents say changed since ``since`` (YYYYMMDD), over
    the baseline version's tables. ``load_baseline(table)`` returns the baseline's frame with
    plain field names, or None when it has none."""
    since: str
    load_baseline: Callable[[str], Optional[pd.DataFrame]]
    # the previous extraction left row hashes: tables with a date-of-last-change field are read by that date
    # (api/services/delta_extraction.py)
    by_change_date: bool = False


_SIGNALS = ("SIGTERM", "SIGINT", "SIGHUP")


def _install_close_on_signal(connector) -> dict:
    """Make SIGTERM/SIGINT close the SAP sessions before the process dies.

    ``connector.close()`` lives in a ``finally`` block, which a non-catchable SIGKILL never
    reaches and a default SIGTERM does not either (Python's default handler exits without
    unwinding). Dangling RFC sessions are counted by SAP against the user, so a stopped
    extraction could lock an otherwise healthy account.
    """
    import signal

    previous: dict = {}

    def _handler(signum, frame):
        try:
            connector.close()
        finally:
            signal.signal(signum, previous.get(signum, signal.SIG_DFL))
            previous.get("__raise__", lambda: None)()
            raise SystemExit(128 + signum)

    for name in _SIGNALS:
        sig = getattr(signal, name, None)
        if sig is None:
            continue
        try:
            previous[sig] = signal.getsignal(sig)
            signal.signal(sig, _handler)
        except (ValueError, OSError):
            pass  # not in the main thread: leave the default alone
    return previous


def _restore_signal_handlers(previous: dict) -> None:
    import signal
    for sig, prior in (previous or {}).items():
        if isinstance(sig, int) and prior is not None:
            try:
                signal.signal(sig, prior)
            except (ValueError, OSError):
                pass


class ConnectivityManager:
    """Manages all SAP system connections for a tenant."""

    def __init__(self, session: Session, tenant_id: str):
        self.session = session
        self.tenant_id = tenant_id
        self.session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

    # -- Connection Building ---------------------------------------------------

    def _build_connection_params(self, system_row) -> dict:
        """Build connection params dict from a sap_systems DB row."""
        from api.services.credential_store import decrypt_password
        import os

        system_type = system_row.system_type
        params = {"system_type": system_type}

        if system_type in ("ecc", "s4hana_onprem", "ewm"):
            encrypted = self._get_encrypted_password(str(system_row.id))
            params.update({
                "host": system_row.host,
                "client": system_row.client,
                "sysnr": system_row.sysnr,
                "user": system_row.username or os.getenv("SAP_RFC_USER", "RFC_USER"),
                "password": decrypt_password(self.tenant_id, encrypted) if encrypted else "",
            })
            params["extraction_path"] = getattr(system_row, "extraction_path", None) or ""
            params["read_function"] = getattr(system_row, "read_function", None) or ""
            if system_type == "s4hana_onprem":  # the Gateway, for the OData extraction path
                auth = getattr(system_row, "auth_type", None)
                params.update({"base_url": getattr(system_row, "base_url", None) or "",
                               "token_url": getattr(system_row, "token_url", None) or "",
                               "odata_auth": auth if auth in ("basic", "oauth2_client_credentials") else "basic"})
                if getattr(system_row, "client_id_encrypted", None):
                    params["client_id"] = decrypt_password(self.tenant_id, system_row.client_id_encrypted)
                if getattr(system_row, "client_secret_encrypted", None):
                    params["client_secret"] = decrypt_password(self.tenant_id, system_row.client_secret_encrypted)

        elif system_type in CLOUD_SYSTEM_TYPES:
            params.update({
                "base_url": system_row.base_url or "",
                "company_id": system_row.company_id or "",
                "auth_type": system_row.auth_type or "basic",
                "token_url": system_row.token_url or "",
            })
            if system_row.client_id_encrypted:
                params["client_id"] = decrypt_password(self.tenant_id, system_row.client_id_encrypted)
            if system_row.client_secret_encrypted:
                params["client_secret"] = decrypt_password(self.tenant_id, system_row.client_secret_encrypted)
            if system_row.api_key_encrypted:
                params["api_key"] = decrypt_password(self.tenant_id, system_row.api_key_encrypted)

            encrypted = self._get_encrypted_password(str(system_row.id))
            if encrypted:
                params["password"] = decrypt_password(self.tenant_id, encrypted)
                params["username"] = system_row.username or ""

        return params

    def _get_encrypted_password(self, system_id: str) -> Optional[str]:
        result = self.session.execute(
            text("SELECT encrypted_password FROM system_credentials WHERE system_id = :sid"),
            {"sid": system_id},
        )
        row = result.fetchone()
        return row[0] if row else None

    # -- Connector Dispatch ----------------------------------------------------

    def _get_connector(self, system_type: str, params: dict):
        """Return the correct connector instance for a system type."""
        return connect_sap_system(system_type, params)

    def _get_onprem_odata_connector(self, params: dict):
        """The Gateway OData connector of an on-premise S/4HANA system (extraction_path "odata")."""
        return connect_onprem_odata(params)

    # -- Extraction (rules-driven, per-table) -----------------------------------

    def extract(self, system_id: str, modules: list[str], max_rows: int = 0,
                scope: Optional[dict] = None,
                progress: Optional[Callable[[dict], None]] = None,
                sink: Optional[Callable[[str, pd.DataFrame, dict], None]] = None,
                delta: Optional[DeltaRequest] = None) -> tuple[dict[str, pd.DataFrame], list[dict]]:
        """Extract everything the rules of ``modules`` need from one system.

        Returns ``({TABLE: frame with TABLE.FIELD columns}, coverage)``. The
        coverage list says, per table, whether it was read live, how many rows,
        whether the transactional window truncated it, or why it failed —
        nothing is silently skipped. ``progress`` receives, after every page of
        every table, ``{table, tables_done, tables_total, rows_read, table_rows,
        percent, tables}`` — ``tables`` being one ``{table, status, rows,
        expected}`` snapshot per planned table (status queued, running, live,
        failed, …) so a caller can draw one bar per table and one overall.

        ``sink(table, frame, coverage_entry)`` receives every live ABAP data table
        as soon as it is read, and that table is then dropped instead of being
        returned in ``frames``: the caller stores one table at a time and the
        process never holds the whole system (18M-row MARC and MBEW together
        killed a 30 GiB worker). Configuration tables are always returned.

        ``delta`` reads CDHDR for the mapped change-document classes and re-reads only the
        changed keys of the tables those classes log, merged over the baseline. Every other
        table, and every table whose baseline is unusable or whose merged row count disagrees
        with SAP's, is read in full. An unreadable CDHDR reads everything in full.
        """
        import os

        from api.services.source_design import dictionary_for
        from sap.extraction_plan import (ABAP_SYSTEM_TYPES, PROCESS_EVENT_CLOUD_MODULES, choose_read_paths, pe_edges,
                                         plan_modules, read_order, resolve_extraction_path, via_filters)

        system_row = self._load_system(system_id)
        system_type = system_row.system_type
        params = self._build_connection_params(system_row)
        try:
            path_setting = resolve_extraction_path(params.get("extraction_path"))
        except ValueError as e:
            logger.warning(f"extract {system_id}: {e}; reading with the table reader")
            path_setting = "table_reader"
        max_rows = max_rows or int(os.getenv("MERIDIAN_EXTRACT_MAX_ROWS", "5000000"))
        dictionary = dictionary_for(self.session, system_id, system_type)
        frames: dict[str, pd.DataFrame] = {}
        coverage: list[dict] = []
        # S/4HANA on premise through its Gateway's released OData APIs instead of RFC (sap/s4hana_onprem.py)
        odata = path_setting == "odata" and system_type == "s4hana_onprem"
        try:
            connector = self._get_onprem_odata_connector(params) if odata else self._get_connector(system_type, params)
        finally:
            for key in ("password", "client_secret", "api_key"):
                params.pop(key, None)
        try:
            if odata:
                frames, coverage = self._extract_s4hc(connector, modules, dictionary,
                                                      label="S/4HANA on premise OData")
                for c in coverage:
                    c["path"] = "odata"
                if progress:  # one line per table for the job, with the path it was read through
                    rows = [{"table": c["table"], "status": c["status"], "rows": c.get("rows", 0), "expected": None,
                             "path": "odata"} for c in coverage]
                    progress({"table": None, "tables_done": len(rows), "tables_total": len(rows), "rows_read": 0,
                              "table_rows": None, "percent": 99, "tables": rows})
            elif system_type in ABAP_SYSTEM_TYPES:
                # SAP dates/times are system-local: the freshness checks need the offset (sap/ddic_reader.py)
                from sap.ddic_reader import utc_offset_seconds
                self.sap_utc_offset_seconds = utc_offset_seconds(connector) if hasattr(connector, "call") else None
                # Read the fields of a rule the tenant re-enabled from the UI even though its
                # YAML ships enabled: false - otherwise it would evaluate with its columns
                # unread and report not_evaluable.
                from checks.overrides import load_overrides
                # self.session is None when the manager runs without a database (tests, and the
                # plan-only paths), in which case there are no tenant overrides to honour.
                _ov = (load_overrides(self.session) or {}) if self.session is not None else {}
                _reenabled = any((o or {}).get("enabled") for o in _ov.values())
                # Close the SAP sessions if this process is asked to stop. A killed extraction used
                # to leave its RFC sessions dangling, and SAP counts an uncleaned session against
                # the user - a hard kill of a running extraction is what locked the sandbox user
                # the second time. SIGKILL cannot be caught; SIGTERM/INT can, and this makes them
                # clean.
                _prev_handlers = _install_close_on_signal(connector)
                plans = plan_modules(modules, dictionary, scope, system_type=system_type,
                                     include_disabled=_reenabled)
                # fields this system's field-status customizing controls (checks/field_status_rules.py)
                from checks.field_status_rules import extra_fields, load_config, material_fields
                from sap.field_status_config import resolve_all, resolve_material
                fs_config = load_config(self.session, system_id)
                controlled = list(extra_fields(resolve_all(fs_config)).items()) + \
                    list(material_fields(resolve_material(fs_config, dictionary)).items())
                for t, fs in controlled:
                    if t in plans:
                        plans[t].fields |= {f for f in fs if dictionary.field(t, f) is not None}
                # ODP or the table reader, per table (sap/extraction_plan.py choose_read_paths)
                odp_ok = path_setting == "auto" and hasattr(connector, "odp_reader") and \
                    connector.odp_reader().available()
                paths = choose_read_paths(plans, path_setting, system_type, odp_ok)
                reader = getattr(connector, "read_function", None)
                raw: dict[str, pd.DataFrame] = {}
                # raw frames a later read filters by (via) or derives from (payroll); nothing else is kept
                needed_raw = {x for p in plans.values() for x in (p.via, *p.also_via, *p.split_by.values()) if x} \
                    | {"HRPY_RGDIR"}
                # reconciliation: an unfiltered read must return exactly SAP's own row count
                counts = connector.count_rows([t for t, p in plans.items() if not p.where and not p.via]) \
                    if hasattr(connector, "count_rows") else {}
                order = list(read_order(plans))
                delta_keys, delta_map = self._delta_keys(connector, dictionary, plans, delta, coverage) \
                    if delta else ({}, {})
                # ponytail: tables without a SAP row count (filtered reads) weigh 1000 rows
                weight = {tb: counts.get(tb) or 1000 for tb in order}
                total_weight, done_weight = sum(weight.values()) or 1, 0
                table_rows = {tb: {"table": tb, "status": "queued", "rows": 0, "expected": counts.get(tb),
                                   "path": paths[tb].path, **({"provider": paths[tb].odp} if paths[tb].odp else {})}
                              for tb in order}

                def report(table: Optional[str] = None, groups_done: int = 0, groups: int = 1, rows: int = 0) -> None:
                    if not progress:
                        return
                    for c in coverage:  # tables already read carry their final status and row count
                        if c["table"] in table_rows:
                            table_rows[c["table"]].update(status=c["status"], rows=c.get("rows", 0))
                    if table is not None and table_rows[table]["status"] == "queued":
                        table_rows[table].update(status="running", rows=rows)
                    elif table is not None and table_rows[table]["status"] == "running":
                        table_rows[table]["rows"] = rows
                    w = weight[table] if table else 0
                    within = (groups_done + min(1.0, rows / w)) / max(groups, 1) if table else 0
                    progress({"table": table, "tables_done": i, "tables_total": len(order),
                              "rows_read": rows, "table_rows": counts.get(table) if table else None,
                              "percent": min(99, int(100 * (done_weight + w * within) / total_weight)),
                              "tables": [dict(r) for r in table_rows.values()]})  # snapshots, not the live dicts

                i = 0
                report()  # the plan, before the first read
                for i, table in enumerate(order):
                    done_weight = sum(weight[x] for x in order[:i])
                    report(table)
                    plan = plans[table]
                    t = dictionary.table(table)
                    cols = [c for c in plan.columns() if t is not None and c in t.fields]
                    if t is None or not cols:
                        coverage.append({"table": table, "status": "not_in_system", "purpose": plan.purpose})
                        continue
                    if table == PAYROLL_TABLE:  # payroll cluster: only through the customer's read-only function
                        df, entry = self._payroll_totals(connector, raw.get("HRPY_RGDIR"))
                        coverage.append(entry)
                        if df is not None:
                            raw[table] = df
                            frames[table] = df.rename(columns={c: f"{table}.{c}" for c in df.columns})
                        continue
                    logger.info(f"extract {system_id}: reading {table} ({len(cols)} fields)")
                    t0 = time.monotonic()
                    where = plan.where
                    delta_info: Optional[dict] = None
                    sliced: list[dict] = []
                    rp = paths[table]
                    path_info = self._path_info(rp, reader)
                    try:
                        if rp.path == "odp":
                            df, odp_info = self._odp_read(connector, rp, cols, max_rows,
                                                          lambda rows: report(table, 0, 1, rows))
                            path_info.update(odp_info)
                        else:
                            df = None
                        df, delta_info = self._delta_read(
                            connector, table, cols, list(t.keys), plan.where, delta, delta_keys, delta_map,
                            raw.get(plan.via) if plan.via else None, counts.get(table), max_rows,
                        ) if df is None and delta is not None and table in delta_map else (df, None)
                        if df is None and delta is not None and delta.by_change_date and not plan.via \
                                and not plan.slices:
                            df, delta_info = self._date_delta_read(connector, table, cols, list(t.keys), plan.where,
                                                                   delta, counts.get(table), max_rows)
                        if df is None and plan.via:
                            wheres = [w for parent in (plan.via, *plan.also_via)
                                      for w in via_filters(table, parent, raw.get(parent), extra_edges=pe_edges(),
                                                           in_field=plan.in_field, group_field=plan.group_field)]
                            parts = [connector.read_table_full(table, cols, list(t.keys) if plan.keys else [],
                                     where=" AND ".join(x for x in (w, plan.where) if x), max_rows=max_rows,
                                     on_progress=lambda g, n, rows: report(table, g, n, rows))
                                     for w in wheres]
                            df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
                        elif df is None and plan.slices:
                            plants = raw.get(next(iter(plan.split_by.values()), ""))
                            df, sliced = self._read_slices(connector, table, cols, list(t.keys) if plan.keys else [],
                                                           plan, plants, max_rows,
                                                           lambda g, n, rows: report(table, g, n, rows))
                        elif df is None:
                            df = connector.read_table_full(table, cols, list(t.keys), where=where,
                                                           max_rows=max_rows,
                                                           on_progress=lambda g, n, rows: report(table, g, n, rows))
                            if df.empty and plan.wide_where:
                                logger.info(f"extract {system_id}: {table} empty in default window, widening")
                                where = plan.wide_where
                                df = connector.read_table_full(table, cols, list(t.keys), where=where,
                                                               max_rows=max_rows,
                                                               on_progress=lambda g, n, rows: report(table, g, n, rows))
                    except SAPConnectorError as e:
                        coverage.append({"table": table, "status": "failed", "detail": str(e)[:300],
                                         "seconds": round(time.monotonic() - t0, 1), **path_info})
                        logger.warning(f"extract {system_id}: {table} failed: {str(e)[:300]}")
                        continue
                    # RFC_READ_TABLE pages without a sort order: pages can overlap. Repeated
                    # rows are dropped; a key that still repeats means the read is inconsistent.
                    df = df.drop_duplicates()
                    keys = [k for k in t.keys if k in df.columns]
                    dup_keys = int(df.duplicated(subset=keys).sum()) if keys else 0
                    if table in needed_raw or sink is None:
                        raw[table] = df
                    entry = {"table": table, "status": "live", "rows": len(df), "purpose": plan.purpose,
                             "partial": plan.partial, "modules": sorted(plan.modules),
                             "window": where if where and not where.startswith(tuple(
                                 f"{f} = " for f in ("DATBI", "BDATU", "INACT"))) else None,
                             "truncated": len(df) >= max_rows, "seconds": round(time.monotonic() - t0, 1)}
                    entry.update(path_info)
                    if table in counts:
                        entry["source_rows"] = counts[table]
                    entry["complete"] = self._is_complete(entry["truncated"], dup_keys, counts.get(table), len(df))
                    if dup_keys:
                        entry["duplicate_keys"] = dup_keys
                    if delta_info:
                        entry["delta"] = delta_info
                    if plan.slices:
                        entry["slices"] = len(plan.slices)
                        entry["window"] = plan.where
                        entry["truncated"] = bool(sliced)  # per-slice reads: the total is not capped by max_rows
                        entry["complete"] = self._is_complete(entry["truncated"], dup_keys, counts.get(table), len(df))
                    if sliced:
                        entry["truncated_slices"] = sliced
                        entry["complete"] = False
                    coverage.append(entry)
                    logger.info(f"extract {system_id}: {table} {len(df)} rows, complete={entry['complete']}")
                    framed = df.rename(columns={c: f"{table}.{c}" for c in df.columns})
                    del df
                    if sink is not None and plan.purpose == "data":
                        sink(table, framed, entry)
                    else:
                        frames[table] = framed
                i = len(order)
                report()  # final state of every table
            elif set(modules) & set(PROCESS_EVENT_CLOUD_MODULES):
                frames, coverage = self._extract_process_cloud(connector, modules, system_type, scope)
            elif system_type == "successfactors":
                frames, coverage = self._extract_successfactors(connector, modules, dictionary, system_id)
            elif system_type == "s4hana_cloud":
                frames, coverage = self._extract_s4hc(connector, modules, dictionary)
            elif system_type in ("concur", "ariba"):
                frames, coverage = self._extract_rest(connector, modules, dictionary, system_type)
            elif system_type == "btp":
                frames, coverage = self._extract_mapped(connector, system_type, modules)
            else:
                coverage.append({"table": "*", "status": "no_rule_mapping",
                                 "detail": f"{system_type} data has no rule pack mapped yet; use upload or "
                                           f"the cross-system integration module"})
        finally:
            try:
                _restore_signal_handlers(_prev_handlers)
            except Exception:
                pass
            connector.close()
        coverage.extend(self._preview_coverage(system_type, modules))
        return frames, coverage

    @staticmethod
    def _path_info(rp, reader: Optional[str]) -> dict:
        """The coverage fields that say how a table was read: path, the reader or ODP provider, and what ODP lacked."""
        info: dict = {"path": rp.path}
        if rp.path == "odp":
            info.update(odp_provider=rp.odp, odp_context=rp.context)
        elif isinstance(reader, str) and reader:
            info["reader"] = reader
        if rp.unavailable:
            info["odp_unavailable_fields"] = list(rp.unavailable)
        if rp.reason:
            info["odp_fallback"] = rp.reason
        return info

    @staticmethod
    def _odp_read(connector, rp, cols: list[str], max_rows: int,
                  on_rows: Callable[[int], None]) -> tuple[pd.DataFrame, dict]:
        """One table through its ODP provider (sap/odp.py), as the table reader's frame. Fields the provider does not
        deliver on this system are left out and listed in ``odp_unavailable_fields``."""
        from sap.odp_mapping import mapping, to_table_frame

        m = mapping(rp.odp, rp.context)
        wanted = [m.fields[c] for c in cols if c in m.fields]
        r = connector.odp_reader().read(m.context, m.odp, wanted=wanted, max_rows=max_rows,
                                        on_package=lambda packages, rows: on_rows(rows))
        df, missing = to_table_frame(r.frame, m, cols)
        info: dict = {"odp_packages": r.packages}
        if missing:
            info["odp_unavailable_fields"] = missing
        if m.confirm:
            info["odp_confirm"] = True
        return df, info

    @staticmethod
    def _preview_coverage(system_type: str, modules: list[str]) -> list[dict]:
        """One ``preview`` entry in the extraction log per unverified registry source of ``modules``.

        Such a source (sap/extraction_registry.py, ``status="preview"``) is never counted as a
        verified read: the log names it with its reason so a gap in the module is visible, and a
        warning is written for whoever reads the worker log."""
        entries = []
        for p in (p for m in dict.fromkeys(modules) for p in preview_sources(system_type, m)):
            logger.warning("Preview source %s of %s on %s: source name not yet verified against SAP; "
                           "extraction may fail. %s", p["source"], p["module"], system_type, p["reason"])
            entries.append({"table": p["source"], "status": "preview", "entity": p["source"],
                            "module": p["module"],
                            "detail": f"Source name not yet verified against SAP; extraction may fail. {p['reason']}"})
        return entries

    @staticmethod
    def _is_complete(truncated: bool, dup_keys: object, source_rows: Optional[int], n: int) -> bool:
        return not truncated and not dup_keys and (source_rows is None or source_rows == n)

    @staticmethod
    def _read_slices(connector: "RFCConnector", table: str, cols: list[str], keys: list[str], plan: "TablePlan", plants: Optional[pd.DataFrame],
                     max_rows: int, on_progress: Callable[[int, int, int], None]) -> tuple[pd.DataFrame, list[dict]]:
        """Read ``plan.slices`` one at a time (spec §1.1).

        With ``plan.max_slice_rows`` (MATDOC) no read returns more than max_slice_rows + 1 rows. A full slice is
        re-read once per ``split_by`` value (plant), a full plant-month once per day, and a full plant-day
        keeps its first max_slice_rows rows and is reported in the returned truncation list."""
        from sap.extraction_plan import day_slices
        from sap.rfc import _literal

        parts: list[pd.DataFrame] = []
        truncated: list[dict] = []
        limit = plan.max_slice_rows

        def read(where: str, cap: int) -> pd.DataFrame:
            return connector.read_table_full(table, cols, keys, where=where, max_rows=cap, on_progress=on_progress)

        for s in plan.slices:
            if not limit:
                df = read(s, max_rows)
                if len(df) >= max_rows:
                    truncated.append({"slice": s, "plant": None, "day": None})
                parts.append(df)
                continue
            df = read(s, limit + 1)
            if len(df) <= limit:
                parts.append(df)
                continue
            # ponytail: one split field (WERKS); a second split_by entry is ignored until a table needs it
            split = next(iter(plan.split_by), None)
            values = sorted({str(v).strip() for v in plants[split]} - {""}) \
                if split and plants is not None and split in plants.columns else []
            if not values:
                parts.append(df.head(limit))
                truncated.append({"slice": s, "plant": None, "day": None})
                continue
            for v in values:
                ws = f"{s} AND {split} = {_literal(v)}"
                dv = read(ws, limit + 1)
                if len(dv) <= limit:
                    parts.append(dv)
                    continue
                for d in day_slices(ws):
                    dd = read(d, limit + 1)
                    if len(dd) > limit:
                        dd = dd.head(limit)
                        truncated.append({"slice": s, "plant": v, "day": d.split("'")[1][:8]})
                    parts.append(dd)
        return (pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)), truncated

    @staticmethod
    def _extract_process_cloud(connector, modules: list[str], system_type: str,
                               scope: Optional[dict]) -> tuple[dict[str, pd.DataFrame], list[dict]]:
        """Process-event entity sets of SuccessFactors / Ariba / Concur (sap/extraction_registry.py).
        Frames are keyed by entity name with ``NAME.field`` columns."""
        from sap.extraction_registry import process_event_targets

        frames: dict[str, pd.DataFrame] = {}
        coverage: list[dict] = []
        for m in modules:
            for name, target in process_event_targets(system_type, m, (scope or {}).get("date_from")):
                kwargs = {"from_date": target.from_date} if target.from_date else {}
                try:
                    df = connector.read_entity_set(target.source, select=target.fields, filter_expr=target.filter,
                                                   **kwargs)
                except Exception as e:  # one failed entity set is reported, the others still read
                    coverage.append({"table": name, "status": "failed", "detail": str(e)[:300], "modules": [m]})
                    continue
                frames[name] = df.rename(columns={c: f"{name}.{c}" for c in df.columns})
                coverage.append({"table": name, "status": "live", "rows": len(df), "modules": [m],
                                 "purpose": "data", "window": target.filter or target.from_date})
        return frames, coverage

    @staticmethod
    def _delta_keys(connector, dictionary, plans: dict, delta: DeltaRequest,
                    coverage: list[dict]) -> tuple[dict[str, set[str]], dict[str, tuple[str, str]]]:
        """Changed object ids per class since ``delta.since`` (from CDHDR), and the planned tables
        those classes cover. If CDHDR is missing or cannot be read (for example, not authorised),
        returns nothing, so every table is read in full."""
        from sap.change_documents import cdhdr_where, changed_keys, delta_tables

        covered = delta_tables(plans, dictionary)
        t = dictionary.table("CDHDR")
        if not covered or t is None:
            coverage.append({"table": "CDHDR:delta", "purpose": "delta", "status": "delta_fallback",
                             "detail": "CDHDR not in this system" if t is None else "no planned table has change documents"})
            return {}, {}
        classes = sorted({c for c, _ in covered.values()})
        try:
            read = [connector.read_table_full("CDHDR", ["OBJECTCLAS", "OBJECTID", "CHANGENR"], list(t.keys),
                                              where=cdhdr_where(c, delta.since)) for c in classes]
        except SAPConnectorError as e:
            coverage.append({"table": "CDHDR:delta", "purpose": "delta", "status": "delta_fallback",
                             "detail": str(e)[:300]})
            return {}, {}
        changed = changed_keys(pd.concat(read, ignore_index=True))
        coverage.append({"table": "CDHDR:delta", "purpose": "delta", "status": "delta", "since": delta.since,
                         "changed": {c: len(changed[c]) for c in classes}})
        return changed, covered

    @staticmethod
    def _delta_read(connector, table: str, cols: list[str], keys: list[str], where: Optional[str],
                    delta: DeltaRequest, changed: dict[str, set[str]], covered: dict[str, tuple[str, str]],
                    parent: Optional[pd.DataFrame], expected: Optional[int],
                    max_rows: int) -> tuple[Optional[pd.DataFrame], Optional[dict]]:
        """``table`` as the baseline plus its re-read changed keys, or (None, None) when it must be
        read in full: there is no usable baseline (missing, other columns), or the merged rows
        disagree with SAP's row count (records archived or deleted without a change document)."""
        from sap.change_documents import merge_delta
        from sap.extraction_plan import in_lists

        cls, key = covered[table]
        baseline = delta.load_baseline(table)
        if baseline is None or not set(cols) <= set(baseline.columns):
            return None, None
        ids = changed.get(cls, set())
        if parent is not None and key in parent.columns:  # a child read via its parent: only parents still read
            ids = ids & set(parent[key].astype(str).str.strip())
        parts = [connector.read_table_full(table, cols, keys, where=" AND ".join(x for x in (w, where) if x),
                                           max_rows=max_rows) for w in in_lists(key, ids)]
        fresh = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
        df = merge_delta(baseline[cols], fresh[cols], key, changed.get(cls, set()))
        if parent is not None and key in parent.columns:  # children of parents that are gone
            df = df[df[key].astype(str).str.strip().isin(set(parent[key].astype(str).str.strip()))]
        if expected is not None and expected != len(df):
            return None, None
        return df, {"since": delta.since, "key": key, "changed": len(ids), "reread": len(fresh)}

    @staticmethod
    def _date_delta_read(connector, table: str, cols: list[str], keys: list[str], where: Optional[str],
                         delta: DeltaRequest, expected: Optional[int],
                         max_rows: int) -> tuple[Optional[pd.DataFrame], Optional[dict]]:
        """``table`` as the baseline merged with the rows changed since ``delta.since`` by the table's
        date-of-last-change field, or (None, None) to read it in full: no such field among the read columns, no
        usable baseline, or a merged count that disagrees with SAP's (records deleted leave no change date)."""
        from api.services.delta_extraction import change_date_where, merge_by_key
        from sap.data_dictionary import get_change_date_field

        field = get_change_date_field(table)
        if not field or field not in cols:
            return None, None
        baseline = delta.load_baseline(table)
        if baseline is None or not set(cols) <= set(baseline.columns):
            return None, None
        fresh = connector.read_table_full(table, cols, keys, where=" AND ".join(
            x for x in (change_date_where(field, delta.since), where) if x), max_rows=max_rows)
        df = merge_by_key(baseline[cols], fresh[cols] if len(fresh) else pd.DataFrame(columns=cols),
                          [k for k in keys if k in cols])
        if expected is not None and expected != len(df):
            return None, None
        return df, {"since": delta.since, "field": field, "mode": "change_date", "reread": len(fresh)}

    def read_rows(self, system_id: str, table: str, fields: list[str], wheres: list[str]) -> pd.DataFrame:
        """Rows of one ABAP table, one read-only RFC read per WHERE clause (for example, key IN-lists
        from ``in_lists``). No clause means no read. Raises SAPConnectorError if the system or
        table cannot be read."""
        from api.services.source_design import dictionary_for
        from sap.extraction_plan import ABAP_SYSTEM_TYPES

        if not wheres:
            return pd.DataFrame(columns=fields)
        row = self._load_system(system_id)
        if row.system_type not in ABAP_SYSTEM_TYPES:
            raise SAPConnectorError(f"{row.system_type} systems have no change documents over RFC")
        t = dictionary_for(self.session, system_id, row.system_type).table(table)
        if t is None:
            raise SAPConnectorError(f"{table} is not in this system")
        params = self._build_connection_params(row)
        try:
            connector = self._get_connector(row.system_type, params)
        finally:
            for key in ("password", "client_secret", "api_key"):
                params.pop(key, None)
        try:
            parts = [connector.read_table_full(table, fields, list(t.keys), where=w) for w in wheres]
        finally:
            connector.close()
        return pd.concat(parts, ignore_index=True)[fields]

    @staticmethod
    def _payroll_totals(connector, rgdir: Optional[pd.DataFrame]) -> tuple[Optional[pd.DataFrame], dict]:
        """ZMERIDIAN_PAYRT for the extracted payroll results, or why it is not available."""
        entry = {"table": PAYROLL_TABLE, "purpose": "data"}
        if not hasattr(connector, "payroll_totals"):
            return None, {**entry, "status": "not_in_system"}
        if rgdir is None or not len(rgdir):
            return None, {**entry, "status": "live", "rows": 0, "complete": True}
        keys = sorted({(str(p).strip(), str(q).strip()) for p, q in zip(rgdir["PERNR"], rgdir["SEQNR"])})
        try:
            df, skipped = connector.payroll_totals(keys)
        except SAPConnectorError as e:
            if "FU_NOT_FOUND" in str(e) or PAYROLL_FUNCTION in str(e):
                return None, {**entry, "status": "not_installed",
                              "detail": f"{PAYROLL_FUNCTION} is not installed: payroll amounts are not checked "
                                        "(see docs/payroll-rfc.md)"}
            return None, {**entry, "status": "failed", "detail": str(e)[:300]}
        # a result the RFC user may not read is a gap in the data, not a clean result
        return df, {**entry, "status": "live", "rows": len(df), "results": len(keys), "unauthorised": skipped,
                    "complete": skipped == 0}

    @staticmethod
    def _extract_mapped(connector, system_type: str, modules: list[str]) -> tuple[dict[str, pd.DataFrame], list[dict]]:
        """Read the registry's entity sets and land them as the ECC tables the rules read.

        Each target's rename_map is ``{OData property: "TABLE.FIELD"}``; values are
        normalised to RFC shape (flags 'X'/'', dates YYYYMMDD). A property the
        service did not return is listed in ``unavailable_fields``, never filled in.
        """
        from sap.btp import ecc_value

        frames: dict[str, pd.DataFrame] = {}
        coverage: list[dict] = []
        for module in modules:
            for target in get_extraction_targets(system_type, module, include_config=False):
                table = next(iter(target.rename_map.values())).split(".", 1)[0]
                try:
                    df = connector.read_entity_set(target.source, select=target.fields or None)
                except SAPConnectorError as e:
                    coverage.append({"table": table, "status": "failed", "entity": target.source,
                                     "detail": str(e)[:300]})
                    continue
                # an empty entity set has no columns: that is zero rows, not missing fields
                got = [p for p in target.rename_map if p in df.columns] if len(df) else list(target.rename_map)
                if not got:
                    coverage.append({"table": table, "status": "not_in_system", "entity": target.source})
                    continue
                df = df.reindex(columns=got).rename(columns=target.rename_map).map(ecc_value).drop_duplicates()
                frames[table] = df.reset_index(drop=True)
                coverage.append({"table": table, "status": "live", "rows": len(df), "purpose": "data",
                                 "entity": target.source, "complete": True,
                                 "unavailable_fields": sorted(set(target.rename_map) - set(got))})
        if not coverage:
            coverage.append({"table": "*", "status": "no_rule_mapping",
                             "detail": f"no {system_type} entity mapping for {', '.join(modules)}"})
        return frames, coverage

    def _extract_successfactors(self, connector, modules, dictionary, system_id):
        """Assemble SF canonical tables from their source entities (see canonical/successfactors.yaml)."""
        from checks.frames import tables_of
        from checks.runner import _find_module_yaml, rule_columns, target_columns
        from api.services.source_design import latest_snapshot_id, load_overlay
        import yaml as _yaml

        wanted: set[str] = set()
        for m in modules:
            try:
                for r in _yaml.safe_load(_find_module_yaml(m).read_text()).get("rules", []):
                    wanted |= set(tables_of(rule_columns(r) + target_columns(r)))
            except FileNotFoundError:
                continue
        snap = latest_snapshot_id(self.session, system_id)
        live = load_overlay(self.session, snap)[0] if snap else {}
        frames, coverage = {}, []
        models: dict[str, tuple[set[str], dict[str, set[str] | None]] | str | None] = {}  # per entity, this extraction
        options: dict[str, dict[str, str]] = {}
        if self.session is not None and system_id:
            from sqlalchemy import text as _text
            row = self.session.execute(_text("SELECT config_data FROM config_snapshots WHERE system_id = :s "
                                             "AND config_table = 'PICKLIST_OPTION'"), {"s": str(system_id)}).first()
            for o in (row[0] if row else None) or []:
                options.setdefault(o["picklist"], {})[str(o["optionId"])] = o["externalCode"]
        for table in sorted(wanted):
            t = dictionary.table(table)
            if t is None or not t.provenance.startswith("canonical:successfactors"):
                continue
            unavailable = {f["name"] for f in (live.get(table) or {}).get("fields", []) if f.get("available") is False}
            by_entity: dict[str, dict[str, list[str]]] = {}
            from api.services.source_overrides import resolve_source
            for f in t.fields.values():
                # A tenant's API surface differs from the canonical map: entity sets can be
                # suffixed per tenant and spellings vary. The override for this system wins,
                # so a correction belongs to the customer it was found on instead of to the
                # shared dictionary. Without this the rule reading the field is silently not
                # evaluated.
                src = resolve_source("successfactors", system_id, table, f.name, f.source)
                ent, _, prop = (src or "").partition(".")
                prop = prop.split(" ")[0]
                if not ent[:1].isupper() or not prop or "<" in ent or f.name in unavailable:
                    continue
                by_entity.setdefault(ent, {}).setdefault(prop, []).append(f.name)
            if not by_entity:
                coverage.append({"table": table, "status": "upload_required",
                                 "detail": "source is not an SF OData entity (e.g. payroll export)"})
                continue
            # effective-dated entities return only today's record unless fromDate is given
            history = {"from_date": "1900-01-01"} if "all records" in (t.note or "") else {}
            merged = None
            absent: list[str] = []
            failed = False
            for ent, props in by_entity.items():
                if ent not in models:
                    models[ent] = self._sf_entity_model(connector, ent)
                model = models[ent]
                if isinstance(model, str):  # the tenant does not have this entity
                    unavailable |= {n for names in props.values() for n in names}
                    absent.append(model)
                    coverage.append({"table": f"{table}←{ent}", "status": "not_in_system", "entity": ent,
                                     "detail": model})
                    continue
                # $select only what the tenant's entity has; "nav.prop" is "nav/prop" + $expand=nav
                sel: dict[str, str] = {}
                for prop, names in props.items():
                    nav, _, sub = prop.partition(".")
                    # ponytail: a nav whose target type is not in the entity's $metadata goes unchecked
                    target = model[1].get(nav) if model is not None and sub else None
                    if model is None or (prop in model[0] if not sub else
                                         nav in model[1] and (target is None or sub in target)):
                        sel[prop] = f"{nav}/{sub}" if sub else prop
                    else:
                        unavailable |= set(names)
                if not sel:
                    continue
                # merge keys only when several entities feed the table (FO objects and Position carry neither)
                join = [p for p in ("userId", "personIdExternal") if p not in props
                        and (model is None or p in model[0])] if len(by_entity) > 1 else []
                try:
                    # a property in $metadata can still be "not viewable" to the API user: SF names the
                    # first such property in its 400, so drop it (unavailable) and read again
                    while True:
                        expand = sorted({p.split("/")[0] for p in sel.values() if "/" in p})
                        # a to-many locale navigation is read in the record's own default language
                        lang = {s for nav in expand if model is not None and "defaultLanguage" in model[0]
                                and "locale" in (model[1].get(nav) or ()) for s in (f"{nav}/locale", "defaultLanguage")}
                        try:
                            df = connector.read_entity_set(
                                ent, select=sorted(set(sel.values()) | set(join) | lang), **history,
                                **({"expand": expand} if expand else {}))
                            break
                        except Exception as e:
                            bad = _bad_property(e, ent)
                            if bad in join:
                                # a merge key the API user cannot view (e.g. PerPerson/userId) — merge on
                                # the remaining key instead of failing the whole entity
                                join.remove(bad)
                                continue
                            drop = [p for p, path in sel.items() if path == bad]
                            if not drop or len(sel) == len(drop):
                                raise
                            for p in drop:
                                unavailable |= set(props[p])
                                del sel[p]
                except Exception as e:
                    if _not_found(e):
                        unavailable |= {n for names in props.values() for n in names}
                        absent.append(str(e)[:300])
                        coverage.append({"table": f"{table}←{ent}", "status": "not_in_system", "entity": ent,
                                         "detail": str(e)[:300]})
                    else:
                        failed = True
                        coverage.append({"table": f"{table}←{ent}", "status": "failed", "detail": str(e)[:300]})
                    continue
                out = pd.DataFrame(index=df.index)
                for prop, names in props.items():
                    if prop in sel:
                        for n in names:
                            out[f"{table}.{n}"] = df.get(sel[prop])
                for j in ("userId", "personIdExternal"):
                    if j in df.columns:
                        out[f"__{j}"] = df[j]
                if merged is None:
                    merged = out
                else:
                    on = [c for c in ("__userId", "__personIdExternal") if c in merged.columns and c in out.columns]
                    merged = merged.merge(out.drop_duplicates(subset=on) if on else out,
                                          how="left", on=on) if on else merged
            if merged is None:
                if not failed:  # every entity absent, or none has a property the dictionary maps
                    coverage.append({"table": table, "status": "not_in_system", "entities": sorted(by_entity),
                                     "unavailable_fields": sorted(unavailable),
                                     "detail": ("; ".join(absent) if len(absent) == len(by_entity)
                                                else "no dictionary property in tenant $metadata")[:300]})
                continue
            merged = merged.drop(columns=[c for c in merged.columns if c.startswith("__")])
            # BOOLEAN fields arrive as Python bool from OData V2 JSON; astype("string") would give
            # "True"/"False", but rules match the lowercase 'true'/'false' form (same normalisation
            # as _extract_rest below, so a rule's target_when/applies_when 'true' match works for
            # every connector, not just REST ones).
            for f in t.fields.values():
                col = f"{table}.{f.name}"
                if (f.type or "").upper() == "BOOLEAN" and col in merged.columns:
                    merged[col] = merged[col].map(lambda v: str(v).lower() if v is not None and v == v else v)
            # legacy-picklist fields return the option id; rules and picklists speak external codes
            for f in t.fields.values():
                col, opts = f"{table}.{f.name}", options.get(f.picklist or "")
                if opts and col in merged.columns:
                    merged[col] = merged[col].map(lambda v: opts.get(str(v).strip(), v) if v is not None else v)
            frames[table] = merged
            coverage.append({"table": table, "status": "live", "rows": len(merged),
                             "entities": sorted(by_entity), "unavailable_fields": sorted(unavailable)})
        return frames, coverage

    @staticmethod
    def _sf_entity_model(connector, entity: str) -> tuple[set[str], dict[str, set[str] | None]] | str | None:
        """(properties, {navigation: target properties}) of ``entity`` from the tenant's $metadata; a str
        (why) if the tenant does not have the entity; None if its metadata cannot be read."""
        from sap.successfactors import entity_model

        if not hasattr(connector, "metadata"):
            return None
        try:
            return entity_model(connector.metadata(entity), entity)
        except Exception as e:
            if _not_found(e):
                return str(e)[:300]
            logger.warning(f"SuccessFactors $metadata for {entity} unreadable, selecting unchecked: {e}")
            return None

    @staticmethod
    def _rule_tables(modules) -> set[str]:
        """Tables the rules of ``modules`` read, exists-check targets included."""
        from checks.frames import tables_of
        from checks.runner import _find_module_yaml, rule_columns, target_columns
        import yaml as _yaml

        wanted: set[str] = set()
        for m in modules:
            try:
                for r in _yaml.safe_load(_find_module_yaml(m).read_text()).get("rules", []):
                    wanted |= set(tables_of(rule_columns(r) + target_columns(r)))
            except FileNotFoundError:
                continue
        return wanted

    def _extract_s4hc(self, connector, modules, dictionary, label: str = "S/4HANA Cloud"):
        """ECC tables from S/4HANA Cloud OData entities (sap/s4hana_cloud.S4HC_TABLE_MAP), in the
        internal format RFC delivers: dates YYYYMMDD, flags 'X' / ''. Also the on-premise Gateway's V2 APIs
        (extraction_path "odata"), whose dates arrive as /Date(ms)/."""
        from checks.types.domain_value_check import _parse_dates
        from sap.btp import ecc_value
        from sap.s4hana_cloud import S4HC_TABLE_MAP

        frames, coverage, reads = {}, [], {}
        for table in sorted(self._rule_tables(modules)):
            if table not in S4HC_TABLE_MAP:
                coverage.append({"table": table, "status": "upload_required",
                                 "detail": f"no {label} mapping for this table"})
                continue
            entity, fields, required = S4HC_TABLE_MAP[table]
            if entity not in reads:
                props = sorted({p for e, f, _ in S4HC_TABLE_MAP.values() if e == entity for p in f.values()})
                try:
                    reads[entity] = connector.read_entity_set(entity, select=props)
                except Exception:
                    # a property the tenant's API version lacks fails $select: read all, keep what exists
                    try:
                        reads[entity] = connector.read_entity_set(entity)
                    except Exception as e:
                        reads[entity] = e
            df = reads[entity]
            if isinstance(df, Exception):
                coverage.append({"table": table, "status": "failed", "entity": entity, "detail": str(df)[:300]})
                continue
            out = pd.DataFrame(index=df.index)
            for name, prop in fields.items():
                if prop not in df.columns:
                    continue
                s = df[prop].map(lambda v: ("X" if v else "") if isinstance(v, bool) else v)
                f = dictionary.field(table, name)
                if f is not None and (f.type or "").upper() == "DATS":
                    s = s.map(ecc_value)  # OData V2 /Date(ms)/ -> YYYYMMDD; V4 ISO dates as they were
                    s = _parse_dates(s).dt.strftime("%Y%m%d").where(s.notna() & s.astype("string").ne(""), "")
                out[f"{table}.{name}"] = s
            if required and f"{table}.{required}" in out.columns:
                out = out[out[f"{table}.{required}"].astype("string").str.strip().fillna("").ne("")]
            out = out.drop_duplicates()
            frames[table] = out
            coverage.append({"table": table, "status": "live", "rows": len(out), "entity": entity,
                             "unavailable_fields": sorted(n for n, p in fields.items() if p not in df.columns)})
        return frames, coverage

    def _extract_rest(self, connector, modules, dictionary, system_type):
        """Concur / Ariba canonical tables (sap/dictionaries/canonical/<system>.yaml): one REST path per
        table, JSON properties renamed to TABLE.FIELD, booleans as 'true' / 'false'."""
        frames, coverage = {}, []
        for table in sorted(self._rule_tables(modules)):
            t = dictionary.table(table)
            if t is None or t.provenance != f"canonical:{system_type}":
                continue
            props = {f.name: f.source for f in t.fields.values() if f.source}
            try:
                df = connector.read_entity_set(t.note, select=sorted(set(props.values())))
            except Exception as e:
                coverage.append({"table": table, "status": "failed", "detail": str(e)[:300]})
                continue
            out = pd.DataFrame(index=df.index)
            for name, prop in props.items():
                if prop in df.columns:
                    s = df[prop]
                    if (t.fields[name].type or "").upper() == "BOOLEAN":
                        s = s.map(lambda v: str(v).lower() if v is not None and v == v else v)
                    out[f"{table}.{name}"] = s
            frames[table] = out
            entry = {"table": table, "status": "live", "rows": len(out),
                     "unavailable_fields": sorted(n for n, p in props.items() if p not in df.columns)}
            if t.note in getattr(connector, "own_reports_only", ()):
                entry.update(partial=True, complete=False,
                             detail="Concur refused user=ALL; only the API user's own reports were read. "
                                    "Grant the connection company-wide expense access.")
            coverage.append(entry)
        return frames, coverage

    # -- Extraction ------------------------------------------------------------

    def extract_module(
        self,
        system_id: str,
        module: str,
        include_config: bool = True,
        max_rows: int = 0,
    ) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
        """Extract data + config for one module from one system.

        Returns (data_df, config_dict).
        """
        system_row = self._load_system(system_id)
        params = self._build_connection_params(system_row)
        system_type = params["system_type"]
        targets = get_extraction_targets(system_type, module, include_config)

        if not targets:
            raise SAPConnectorError(f"No extraction mapping for ({system_type}, {module})")

        data_frames: list[pd.DataFrame] = []
        config_frames: dict[str, pd.DataFrame] = {}

        try:
            connector = self._get_connector(system_type, params)
            try:
                for target in targets:
                    if not target.verified:
                        # Attempted, but never as if verified: say so before the read and on failure.
                        logger.warning("Extracting preview source %s (%s, %s): source name not yet verified "
                                       "against SAP; extraction may fail. %s", target.source, system_type,
                                       module, target.status_reason)
                    try:
                        df = self._extract_target(connector, system_type, target, max_rows)
                        if df.empty:
                            continue

                        if target.rename_map:
                            rename = {k: v for k, v in target.rename_map.items() if k in df.columns}
                            if rename:
                                df = df.rename(columns=rename)

                        if target.is_config:
                            config_frames[target.source] = df
                        else:
                            data_frames.append(df)

                        logger.info(f"Extracted {len(df)} rows from {target.source}")
                    except Exception as e:
                        preview = "" if target.verified else " (preview source, name not verified against SAP)"
                        logger.warning(f"Failed to extract {target.source}{preview}: {e}")
                        continue
            finally:
                connector.close()
        finally:
            for key in ("password", "client_secret", "api_key"):
                if key in params:
                    params[key] = ""

        # Merge data frames
        data_df = self._merge_frames(data_frames)

        if config_frames:
            self._store_config_snapshots(system_id, module, config_frames)

        return data_df, config_frames

    def _merge_frames(self, frames: list[pd.DataFrame]) -> pd.DataFrame:
        if not frames:
            return pd.DataFrame()
        merged = frames[0]
        key_fragments = ["USERID", "LIFNR", "KUNNR", "MATNR", "PARTNER",
                         "EQUNR", "ANLN1", "EBELN", "VBELN", "SAKNR"]
        for df in frames[1:]:
            common = set(merged.columns) & set(df.columns)
            key_candidates = [c for c in common
                              if any(k in c.upper() for k in key_fragments)]
            if key_candidates:
                merged = merged.merge(df, on=key_candidates[0], how="outer",
                                      suffixes=("", "_dup"))
                dup_cols = [c for c in merged.columns if c.endswith("_dup")]
                merged = merged.drop(columns=dup_cols)
            else:
                merged = pd.concat([merged, df], ignore_index=True)
        return merged

    def _extract_target(self, connector, system_type: str,
                        target: ExtractionTarget, max_rows: int) -> pd.DataFrame:
        effective_max = max_rows if max_rows > 0 else target.max_rows

        if system_type in ("ecc", "s4hana_onprem", "ewm"):
            from sap.extraction_plan import render_where
            return connector.read_table(
                target.source,
                target.fields if target.fields else [],
                where=render_where(target.filter) if target.filter else None,
                max_rows=effective_max,
            )
        elif system_type == "successfactors":
            return connector.read_entity_set(
                target.source,
                select=target.fields if target.fields else None,
                filter_expr=target.filter,
                top=effective_max,
                from_date=target.from_date,
            )
        elif system_type in ("s4hana_cloud", "btp"):
            # OData V4 (S/4HANA Cloud, BTP) has no fromDate param; from_date is SF-only.
            return connector.read_entity_set(
                target.source,
                select=target.fields if target.fields else None,
                filter_expr=target.filter,
                top=effective_max,
            )
        elif system_type in ("concur", "ariba"):
            return connector._read_endpoint(target.source, {})

        return pd.DataFrame()

    # -- Config Load (read-only snapshot + flow derivation) ---------------------

    def load_config(self, system_id: str, load_id: str,
                    progress: Optional[Callable[[int, int, str], None]] = None) -> dict:
        """Read the system's configuration through ``connector.load_config()``, store it as a ``config_loads``
        snapshot (role from the system; origin connection, or best_practice for a type with no config API),
        read the change history (ABAP) and derive the process flows.
        Read only; never writes to SAP. Returns the stored summary."""
        from sap.config_loader import ABAP_TYPES, not_available_history, read_history

        system_row = self._load_system(system_id)
        params = self._build_connection_params(system_row)
        system_type = params["system_type"]
        connector = self._get_connector(system_type, params)
        try:
            snap = connector.load_config(system_type, progress)
            snap.system_id = system_id
            history = None
            if system_type in ABAP_TYPES:
                loaded = sorted(o for o, st in snap.objects.items() if st.state == "loaded")
                history = read_history(connector, loaded)
            else:
                history = not_available_history("change history is read from DBTABLOG, which only ABAP systems have")
        finally:
            connector.close()

        from api.services.config_pairing import with_baseline, write_drift

        snap, origin = with_baseline(snap, system_type)  # no config API: store the SAP standard baseline

        derivation = None
        if system_type in ("ecc", "s4hana_onprem") and snap.items:
            try:
                from api.services.config_intelligence.process_flow_derivation import derive_model
                doc = derive_model(snap.frames(), system_type)
                if doc.source == "config":
                    derivation = doc.model_dump(mode="json")
            except Exception as e:  # derivation never costs the load
                logger.warning(f"Flow derivation after config load failed: {e}")

        objects = [o.as_dict() for o in snap.objects.values()]
        self.session.execute(
            text("UPDATE config_loads SET status = 'completed', origin = :origin, objects = CAST(:o AS jsonb), "
                 "history = CAST(:h AS jsonb), derivation = CAST(:d AS jsonb), finished_at = now() "
                 "WHERE id = :lid AND tenant_id = :tid"),
            {"origin": origin, "o": json.dumps(objects), "h": json.dumps(history),
             "d": json.dumps(derivation) if derivation else None, "lid": load_id, "tid": self.tenant_id})
        # a retried task reruns this load: replace its items instead of doubling them
        self.session.execute(text("DELETE FROM config_items WHERE load_id = :lid AND tenant_id = :tid"),
                             {"lid": load_id, "tid": self.tenant_id})
        rows = [{"tid": self.tenant_id, "lid": load_id, "obj": i.object, "key": i.key,
                 "vals": json.dumps(i.values, default=str)} for i in snap.items]
        for n in range(0, len(rows), 2000):
            self.session.execute(
                text("INSERT INTO config_items (tenant_id, load_id, object, key, \"values\") "
                     "VALUES (:tid, :lid, :obj, :key, CAST(:vals AS jsonb))"), rows[n:n + 2000])
        # The value-list rules read their live reference values from config_snapshots
        # (source='live'), not from config_items. Write the loaded frames there too, so a
        # config load feeds the referential/exists checks (T141 material types, T005
        # countries, T024D MRP controllers …) instead of those rules skipping as
        # not_evaluable and silently inflating the DQS.
        for table_name, frame in snap.frames().items():
            data = frame.to_dict(orient="records")
            self.session.execute(
                text("""
                    INSERT INTO config_snapshots
                        (id, tenant_id, system_id, module, config_table,
                         config_data, record_count, source, synced_at)
                    VALUES
                        (gen_random_uuid(), :tid, :sid, :mod, :tbl,
                         CAST(:data AS jsonb), :cnt, 'live', now())
                    ON CONFLICT (tenant_id, system_id, module, config_table)
                    DO UPDATE SET config_data = CAST(:data AS jsonb),
                                  record_count = :cnt, source = 'live', synced_at = now()
                """),
                {"tid": self.tenant_id, "sid": system_id, "mod": "*", "tbl": table_name,
                 "data": json.dumps(data, default=str), "cnt": len(data)},
            )
        # Commit the load, its items and the reference snapshots before computing drift:
        # the drift diff full-outer-joins two loads' config_items on (object, key), which is
        # quadratic in the item count once a load covers the full ~394-table reference set
        # (~714k items) — it must never delay or roll back the load itself.
        self.session.commit()
        try:
            write_drift(self.session, str(self.tenant_id), system_id, load_id)
            self.session.commit()
        except Exception as e:  # drift is a report; it never costs the load
            logger.warning(f"config drift for load {load_id} failed: {e}")
            self.session.rollback()
        else:  # owners of the objects whose rules depend on what changed are told; those objects are re-scored
            from api.services.drift_alerts import process_safe
            process_safe(self.session, str(self.tenant_id), system_id, str(load_id), "config_load")
        return {"load_id": load_id, "system_type": system_type, "objects": snap.summary(), "items": len(rows),
                "origin": origin, "flows_derived": derivation is not None,
                "table_logging_off": bool(history.get("table_logging_off"))}

    # -- Config Sync -----------------------------------------------------------

    def sync_config(self, system_id: str, modules: list[str]) -> dict:
        """Sync SPRO/FO config for specified modules.

        Live rows always win. A failed or empty live read never overwrites a
        previous live snapshot; the SAP-standard baseline is only stored when
        no snapshot exists yet, and it is labelled ``baseline``. The system's
        ``config_sync_status`` reports what actually happened:
        ``synced`` (all live), ``partial`` (some baseline), ``failed``.
        """
        system_row = self._load_system(system_id)
        params = self._build_connection_params(system_row)
        system_type = params["system_type"]
        results = {}
        live = baseline = 0
        connection_failed = False
        # live snapshots replaced in this sync are diffed into config_drift_log under this id (drift alerts)
        self._drift_run, self._drift_rows = str(uuid.uuid4()), 0

        for module in modules:
            targets = get_extraction_targets(system_type, module, include_config=True)
            config_targets = [t for t in targets if t.is_config]
            module_result = {"tables_synced": 0, "tables_baseline": 0, "errors": []}

            try:
                connector = self._get_connector(system_type, params)
                try:
                    for target in config_targets:
                        try:
                            df = self._extract_target(connector, system_type, target, max_rows=10000)
                            if not df.empty:
                                self._store_config_snapshot(system_id, module, target.source, df, "live")
                                module_result["tables_synced"] += 1
                                continue
                            module_result["errors"].append(f"{target.source}: live read returned no rows")
                        except Exception as e:
                            logger.warning(f"Config read failed for {target.source}: {e}")
                            module_result["errors"].append(f"{target.source}: {str(e)[:100]}")
                        if self._store_baseline_snapshot(system_id, module, target.source, system_type):
                            module_result["tables_baseline"] += 1
                finally:
                    connector.close()
            except Exception as e:
                logger.error(f"Config sync connection failed: {e}")
                connection_failed = True
                module_result["errors"].append(f"connection: {str(e)[:200]}")
                for target in config_targets:
                    if self._store_baseline_snapshot(system_id, module, target.source, system_type):
                        module_result["tables_baseline"] += 1

            live += module_result["tables_synced"]
            baseline += len(config_targets) - module_result["tables_synced"]
            results[module] = module_result

        if connection_failed and live == 0:
            status = "failed"
        elif baseline or connection_failed:
            status = "partial"
        else:
            status = "synced"
        self.session.execute(
            text("UPDATE sap_systems SET config_last_synced_at = now(), "
                 "config_sync_status = :st WHERE id = :sid"),
            {"sid": system_id, "st": status},
        )
        self.session.commit()
        if self._drift_rows:
            from api.services.drift_alerts import process_safe
            process_safe(self.session, str(self.tenant_id), system_id, self._drift_run, "config_sync")
        self._drift_run = None
        return {"status": status, "modules": results}

    def _store_config_snapshots(self, system_id: str, module: str,
                                config_frames: dict[str, pd.DataFrame]):
        for table_name, df in config_frames.items():
            self._store_config_snapshot(system_id, module, table_name, df, "live")

    def _store_config_snapshot(self, system_id: str, module: str,
                               table_name: str, df: pd.DataFrame, source: str):
        data = df.to_dict(orient="records")
        if source == "live" and getattr(self, "_drift_run", None):
            prev = self.session.execute(text(
                "SELECT config_data, source FROM config_snapshots WHERE tenant_id = :tid AND system_id = :sid "
                "AND module = :mod AND config_table = :tbl"),
                {"tid": self.tenant_id, "sid": system_id, "mod": module, "tbl": table_name}).fetchone()
            if prev is not None and prev[1] == "live":  # a first live read after the baseline is not drift
                from api.services.drift_alerts import log_snapshot_drift
                self._drift_rows += log_snapshot_drift(
                    self.session, str(self.tenant_id), self._drift_run, module, table_name,
                    list(prev[0] or []), json.loads(json.dumps(data, default=str)))
        self.session.execute(
            text("""
                INSERT INTO config_snapshots
                    (id, tenant_id, system_id, module, config_table,
                     config_data, record_count, source, synced_at)
                VALUES
                    (gen_random_uuid(), :tid, :sid, :mod, :tbl,
                     CAST(:data AS jsonb), :cnt, :src, now())
                ON CONFLICT (tenant_id, system_id, module, config_table)
                DO UPDATE SET config_data = CAST(:data AS jsonb),
                              record_count = :cnt, source = :src, synced_at = now()
            """),
            {"tid": self.tenant_id, "sid": system_id, "mod": module,
             "tbl": table_name, "data": json.dumps(data), "cnt": len(data),
             "src": source},
        )
        self.session.commit()

    def _store_baseline_snapshot(self, system_id: str, module: str, table_name: str,
                                 system_type: str) -> bool:
        """Store the SAP-standard baseline for this system type if no snapshot exists.

        Returns True when a baseline row is (or already was) the stored value.
        """
        from sap.baseline_config import BASELINE_CONFIG
        data = BASELINE_CONFIG.get(baseline_key(system_type), {}).get(module, {}).get(table_name)
        if data is None:
            return False
        self.session.execute(
            text("""
                INSERT INTO config_snapshots
                    (id, tenant_id, system_id, module, config_table,
                     config_data, record_count, source, synced_at)
                VALUES
                    (gen_random_uuid(), :tid, :sid, :mod, :tbl,
                     CAST(:data AS jsonb), :cnt, 'baseline', now())
                ON CONFLICT (tenant_id, system_id, module, config_table) DO NOTHING
            """),
            {"tid": self.tenant_id, "sid": system_id, "mod": module,
             "tbl": table_name, "data": json.dumps(data), "cnt": len(data)},
        )
        self.session.commit()
        return True

    # -- Health Check ----------------------------------------------------------

    def health_check(self, system_id: str) -> dict:
        """Test connection and update health status."""
        system_row = self._load_system(system_id)
        params = self._build_connection_params(system_row)
        system_type = params["system_type"]

        try:
            connector = self._get_connector(system_type, params)
            try:
                healthy = connector.ping()
            finally:
                connector.close()

            status = "healthy" if healthy else "degraded"
            message = "Connection successful" if healthy else "Ping failed"
            self._update_health(system_id, status, message, reset_failures=True)
            return {"connected": healthy, "status": status, "message": message}

        except SAPConnectorError as e:
            from api.services.sign_in import failure_status
            status = failure_status(str(e))  # refused credentials (401, logon, token) or unreachable
            self._update_health(system_id, status, str(e)[:200], reset_failures=False)
            return {"connected": False, "status": status, "message": str(e)[:200]}
        finally:
            for key in ("password", "client_secret", "api_key"):
                if key in params:
                    params[key] = ""

    def _update_health(self, system_id: str, status: str, message: str,
                       reset_failures: bool):
        if reset_failures:
            self.session.execute(
                text("UPDATE sap_systems SET health_status = :s, "
                     "health_message = :m, last_health_check = now(), "
                     "consecutive_failures = 0 WHERE id = :sid"),
                {"s": status, "m": message, "sid": system_id},
            )
        else:
            self.session.execute(
                text("UPDATE sap_systems SET health_status = :s, "
                     "health_message = :m, last_health_check = now(), "
                     "consecutive_failures = consecutive_failures + 1 "
                     "WHERE id = :sid"),
                {"s": status, "m": message, "sid": system_id},
            )
        self.session.commit()
        invalidate_tenant_cache(str(self.tenant_id), "attention")  # a connection signal changed

    # -- Helpers ---------------------------------------------------------------

    def _load_system(self, system_id: str):
        result = self.session.execute(
            text("SELECT * FROM sap_systems WHERE id = :sid AND tenant_id = :tid"),
            {"sid": system_id, "tid": self.tenant_id},
        )
        row = result.fetchone()
        if not row:
            raise SAPConnectorError(f"System {system_id} not found")
        return row

    def get_available_modules_for_system(self, system_id: str) -> list[dict]:
        """Return modules available for a system based on its type."""
        system_row = self._load_system(system_id)
        modules = get_available_modules(system_row.system_type)

        result = self.session.execute(
            text("SELECT module, enabled, last_synced_at, last_sync_status, "
                 "row_count, config_synced FROM system_module_map "
                 "WHERE tenant_id = :tid AND system_id = :sid"),
            {"tid": self.tenant_id, "sid": system_id},
        )
        status_map = {
            r[0]: {"enabled": r[1], "last_synced_at": str(r[2]) if r[2] else None,
                    "last_sync_status": r[3], "row_count": r[4],
                    "config_synced": r[5]}
            for r in result.fetchall()
        }

        preview: dict[str, list[dict]] = {}
        for p in preview_sources(system_row.system_type):
            preview.setdefault(p["module"], []).append({"source": p["source"], "reason": p["reason"]})

        return [
            {
                "module": m,
                "system_type": system_row.system_type,
                **status_map.get(m, {"enabled": True, "last_synced_at": None,
                                      "last_sync_status": None, "row_count": 0,
                                      "config_synced": False}),
                "preview_sources": preview.get(m, []),
            }
            for m in modules
        ]
