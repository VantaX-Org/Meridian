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
import uuid
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from sap.base import (
    SAPConnectionParams,
    CloudConnectionParams,
    SAPConnectorError,
)
from sap.extraction_registry import (
    get_extraction_targets,
    get_available_modules,
    ExtractionTarget,
)

logger = logging.getLogger("meridian.connectivity_manager")

RFC_SYSTEM_TYPES = ("ecc", "s4hana_onprem", "ewm")
CLOUD_SYSTEM_TYPES = ("successfactors", "concur", "ariba", "s4hana_cloud")


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

    elif system_type == "s4hana_cloud":
        from sap.s4hana_cloud import S4HanaCloudConnector
        connector = S4HanaCloudConnector()
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
                "user": os.getenv("SAP_RFC_USER", "RFC_USER"),
                "password": decrypt_password(self.tenant_id, encrypted) if encrypted else "",
            })

        elif system_type in ("successfactors", "s4hana_cloud", "concur", "ariba"):
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
                params["username"] = os.getenv("SAP_RFC_USER", "")

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
            return connector.read_table(
                target.source,
                target.fields if target.fields else [],
                where=target.filter,
                max_rows=effective_max,
            )
        elif system_type in ("successfactors", "s4hana_cloud"):
            return connector.read_entity_set(
                target.source,
                select=target.fields if target.fields else None,
                filter_expr=target.filter,
                top=effective_max,
            )
        elif system_type in ("concur", "ariba"):
            return connector._read_endpoint(target.source, {})

        return pd.DataFrame()

    # -- Config Sync -----------------------------------------------------------

    def sync_config(self, system_id: str, modules: list[str]) -> dict:
        """Sync SPRO/FO config for specified modules."""
        system_row = self._load_system(system_id)
        params = self._build_connection_params(system_row)
        system_type = params["system_type"]
        results = {}

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
                            else:
                                self._store_baseline_snapshot(system_id, module, target.source)
                                module_result["tables_baseline"] += 1
                        except Exception as e:
                            logger.warning(f"Config read failed for {target.source}: {e}")
                            self._store_baseline_snapshot(system_id, module, target.source)
                            module_result["tables_baseline"] += 1
                            module_result["errors"].append(f"{target.source}: {str(e)[:100]}")
                finally:
                    connector.close()
            except Exception as e:
                logger.error(f"Config sync connection failed: {e}")
                for target in config_targets:
                    self._store_baseline_snapshot(system_id, module, target.source)
                    module_result["tables_baseline"] += 1
            finally:
                for key in ("password", "client_secret", "api_key"):
                    if key in params:
                        params[key] = ""

            results[module] = module_result

        self.session.execute(
            text("UPDATE sap_systems SET config_last_synced_at = now(), "
                 "config_sync_status = 'synced' WHERE id = :sid"),
            {"sid": system_id},
        )
        self.session.commit()
        return results

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

    def _store_baseline_snapshot(self, system_id: str, module: str, table_name: str):
        from sap.baseline_config import BASELINE_CONFIG
        for modules_map in BASELINE_CONFIG.values():
            module_config = modules_map.get(module, {})
            if table_name in module_config:
                data = module_config[table_name]
                self.session.execute(
                    text("""
                        INSERT INTO config_snapshots
                            (id, tenant_id, system_id, module, config_table,
                             config_data, record_count, source, synced_at)
                        VALUES
                            (gen_random_uuid(), :tid, :sid, :mod, :tbl,
                             CAST(:data AS jsonb), :cnt, 'baseline', now())
                        ON CONFLICT (tenant_id, system_id, module, config_table)
                        DO UPDATE SET config_data = CAST(:data AS jsonb),
                                      record_count = :cnt, source = 'baseline',
                                      synced_at = now()
                    """),
                    {"tid": self.tenant_id, "sid": system_id, "mod": module,
                     "tbl": table_name, "data": json.dumps(data),
                     "cnt": len(data)},
                )
                self.session.commit()
                return

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
