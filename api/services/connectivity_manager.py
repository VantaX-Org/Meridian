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
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from sap.base import (
    SAPConnectionParams,
    CloudConnectionParams,
    SAPConnectorError,
)
from sap.rfc import PAYROLL_FUNCTION, PAYROLL_TABLE
from sap.extraction_registry import (
    get_extraction_targets,
    get_available_modules,
    ExtractionTarget,
)

logger = logging.getLogger("meridian.connectivity_manager")

RFC_SYSTEM_TYPES = ("ecc", "s4hana_onprem", "ewm")
CLOUD_SYSTEM_TYPES = ("successfactors", "concur", "ariba", "s4hana_cloud", "btp")


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


@dataclass(frozen=True)
class DeltaRequest:
    """Re-read only what SAP's change documents say changed since ``since`` (YYYYMMDD), over
    the baseline version's tables. ``load_baseline(table)`` returns the baseline's frame with
    plain field names, or None when it has none."""
    since: str
    load_baseline: Callable[[str], Optional[pd.DataFrame]]


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
        expected}`` snapshot per planned table (status queued · running · live ·
        failed · …) so a caller can draw one bar per table and one overall.

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
        from sap.extraction_plan import ABAP_SYSTEM_TYPES, plan_modules, read_order, via_filters

        system_row = self._load_system(system_id)
        system_type = system_row.system_type
        params = self._build_connection_params(system_row)
        max_rows = max_rows or int(os.getenv("MERIDIAN_EXTRACT_MAX_ROWS", "5000000"))
        dictionary = dictionary_for(self.session, system_id, system_type)
        frames: dict[str, pd.DataFrame] = {}
        coverage: list[dict] = []
        try:
            connector = self._get_connector(system_type, params)
        finally:
            for key in ("password", "client_secret", "api_key"):
                params.pop(key, None)
        try:
            if system_type in ABAP_SYSTEM_TYPES:
                # SAP dates/times are system-local: the freshness checks need the offset (sap/ddic_reader.py)
                from sap.ddic_reader import utc_offset_seconds
                self.sap_utc_offset_seconds = utc_offset_seconds(connector) if hasattr(connector, "call") else None
                plans = plan_modules(modules, dictionary, scope)
                # fields this system's field-status customizing controls (checks/field_status_rules.py)
                from checks.field_status_rules import extra_fields, load_config, material_fields
                from sap.field_status_config import resolve_all, resolve_material
                fs_config = load_config(self.session, system_id)
                controlled = list(extra_fields(resolve_all(fs_config)).items()) + \
                    list(material_fields(resolve_material(fs_config, dictionary)).items())
                for t, fs in controlled:
                    if t in plans:
                        plans[t].fields |= {f for f in fs if dictionary.field(t, f) is not None}
                raw: dict[str, pd.DataFrame] = {}
                # raw frames a later read filters by (via) or derives from (payroll); nothing else is kept
                needed_raw = {p.via for p in plans.values() if p.via} | {"HRPY_RGDIR"}
                # reconciliation: an unfiltered read must return exactly SAP's own row count
                counts = connector.count_rows([t for t, p in plans.items() if not p.where and not p.via]) \
                    if hasattr(connector, "count_rows") else {}
                order = list(read_order(plans))
                delta_keys, delta_map = self._delta_keys(connector, dictionary, plans, delta, coverage) \
                    if delta else ({}, {})
                # ponytail: tables without a SAP row count (filtered reads) weigh 1000 rows
                weight = {tb: counts.get(tb) or 1000 for tb in order}
                total_weight, done_weight = sum(weight.values()) or 1, 0
                table_rows = {tb: {"table": tb, "status": "queued", "rows": 0, "expected": counts.get(tb)}
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
                    try:
                        df, delta_info = self._delta_read(
                            connector, table, cols, list(t.keys), plan.where, delta, delta_keys, delta_map,
                            raw.get(plan.via) if plan.via else None, counts.get(table), max_rows,
                        ) if delta is not None and table in delta_map else (None, None)
                        if df is None and plan.via:
                            wheres = via_filters(table, plan.via, raw.get(plan.via))
                            parts = [connector.read_table_full(table, cols, list(t.keys),
                                     where=" AND ".join(x for x in (w, plan.where) if x), max_rows=max_rows,
                                     on_progress=lambda g, n, rows: report(table, g, n, rows))
                                     for w in wheres]
                            df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols)
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
                                         "seconds": round(time.monotonic() - t0, 1)})
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
                    if table in counts:
                        entry["source_rows"] = counts[table]
                    entry["complete"] = not entry["truncated"] and not dup_keys and \
                        (table not in counts or counts[table] == len(df))
                    if dup_keys:
                        entry["duplicate_keys"] = dup_keys
                    if delta_info:
                        entry["delta"] = delta_info
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
            connector.close()
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
            for f in t.fields.values():
                ent, _, prop = (f.source or "").partition(".")
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
            for ent, props in by_entity.items():
                # merge keys only when several entities feed the table (FO objects and Position carry neither)
                join = [p for p in ("userId", "personIdExternal") if p not in props] if len(by_entity) > 1 else []
                try:
                    df = connector.read_entity_set(ent, select=sorted(set(props) | set(join)), **history)
                except Exception as e:
                    coverage.append({"table": f"{table}←{ent}", "status": "failed", "detail": str(e)[:300]})
                    continue
                out = pd.DataFrame(index=df.index)
                for prop, names in props.items():
                    for n in names:
                        out[f"{table}.{n}"] = df.get(prop)
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

    def _extract_s4hc(self, connector, modules, dictionary):
        """ECC tables from S/4HANA Cloud OData entities (sap/s4hana_cloud.S4HC_TABLE_MAP), in the
        internal format RFC delivers: dates YYYYMMDD, flags 'X' / ''."""
        from checks.types.domain_value_check import _parse_dates
        from sap.s4hana_cloud import S4HC_TABLE_MAP

        frames, coverage, reads = {}, [], {}
        for table in sorted(self._rule_tables(modules)):
            if table not in S4HC_TABLE_MAP:
                coverage.append({"table": table, "status": "upload_required",
                                 "detail": "no S/4HANA Cloud OData mapping for this table"})
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
                        logger.warning(f"Failed to extract {target.source}: {e}")
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
        snapshot (role source, origin connection), read the change history (ABAP) and derive the process flows.
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
            text("UPDATE config_loads SET status = 'completed', objects = CAST(:o AS jsonb), "
                 "history = CAST(:h AS jsonb), derivation = CAST(:d AS jsonb), finished_at = now() "
                 "WHERE id = :lid AND tenant_id = :tid"),
            {"o": json.dumps(objects), "h": json.dumps(history), "d": json.dumps(derivation) if derivation else None,
             "lid": load_id, "tid": self.tenant_id})
        rows = [{"tid": self.tenant_id, "lid": load_id, "obj": i.object, "key": i.key,
                 "vals": json.dumps(i.values, default=str)} for i in snap.items]
        for n in range(0, len(rows), 2000):
            self.session.execute(
                text("INSERT INTO config_items (tenant_id, load_id, object, key, \"values\") "
                     "VALUES (:tid, :lid, :obj, :key, CAST(:vals AS jsonb))"), rows[n:n + 2000])
        self.session.commit()
        return {"load_id": load_id, "system_type": system_type, "objects": snap.summary(), "items": len(rows),
                "flows_derived": derivation is not None, "table_logging_off": bool(history.get("table_logging_off"))}

    # -- Config Sync -----------------------------------------------------------

    def sync_config(self, system_id: str, modules: list[str]) -> dict:
        """Sync SPRO/FO config for specified modules.

        Live rows always win. A failed or empty live read never overwrites a
        previous live snapshot; the SAP-standard baseline is only stored when
        no snapshot exists yet, and it is labelled ``baseline``. The system's
        ``config_sync_status`` reports what actually happened:
        ``synced`` (all live) · ``partial`` (some baseline) · ``failed``.
        """
        system_row = self._load_system(system_id)
        params = self._build_connection_params(system_row)
        system_type = params["system_type"]
        results = {}
        live = baseline = 0
        connection_failed = False

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
        return {"status": status, "modules": results}

    def _store_config_snapshots(self, system_id: str, module: str,
                                config_frames: dict[str, pd.DataFrame]):
        for table_name, df in config_frames.items():
            self._store_config_snapshot(system_id, module, table_name, df, "live")

    def _store_config_snapshot(self, system_id: str, module: str,
                               table_name: str, df: pd.DataFrame, source: str):
        data = df.to_dict(orient="records")
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
            status = ("auth_failed"
                      if "auth" in str(e).lower() or "token" in str(e).lower()
                      else "unreachable")
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

        return [
            {
                "module": m,
                "system_type": system_row.system_type,
                **status_map.get(m, {"enabled": True, "last_synced_at": None,
                                      "last_sync_status": None, "row_count": 0,
                                      "config_synced": False}),
            }
            for m in modules
        ]
