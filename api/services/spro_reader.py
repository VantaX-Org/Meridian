"""SPRO configuration reader service.

Reads SAP customising (SPRO) tables for a given module, dispatching to the
correct connector based on the registry's ``read_method`` field.

Falls back to baseline configuration when a live connection is unavailable.

Usage:
    from api.services.spro_reader import SPROReader

    reader = SPROReader(system_type="ecc", connection_params={...})
    config = reader.read_config("accounts_payable")
    # config == {"T077Y": pd.DataFrame, "T052": pd.DataFrame, ...}

    valid = reader.get_valid_values("accounts_payable", "LFA1.KTOKK")
    # valid == ["0001", "0002", "0003", "0004", "CPD", "KRED"]
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from sap.base import CloudConnectionParams, SAPConnectionParams, SAPConnectorError
from sap.spro_tables import SPRO_REGISTRY, SPROEntry

logger = logging.getLogger("meridian.services.spro_reader")


class SPROReader:
    """Read SPRO configuration tables from SAP systems or baseline fallback."""

    def __init__(
        self,
        system_type: str,
        connection_params: dict[str, Any] | None = None,
    ) -> None:
        """Initialise the SPRO reader.

        Args:
            system_type: System type identifier (e.g. ``"ecc"``, ``"successfactors"``,
                         ``"concur"``, ``"ariba"``). Used for baseline config lookup.
            connection_params: Optional connection parameters dict. Keys depend on
                               the connector type. If ``None``, only baseline config
                               is available.
        """
        self.system_type = system_type
        self.connection_params = connection_params

        # Cache of already-read configuration — keyed by module name
        self._cache: dict[str, dict[str, pd.DataFrame]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read_config(self, module: str) -> dict[str, pd.DataFrame]:
        """Read all SPRO tables for *module* and return as DataFrames.

        Attempts a live SAP read first.  If the connection fails (missing
        params, network error, auth error) the method falls back to the
        baseline configuration shipped with the platform.

        Returns:
            Mapping of ``table_name -> pd.DataFrame`` for every SPRO entry
            defined for the module in the registry.

        Raises:
            ValueError: If *module* is not present in ``SPRO_REGISTRY``.
        """
        if module in self._cache:
            return self._cache[module]

        tables = SPRO_REGISTRY.get(module)
        if tables is None:
            raise ValueError(
                f"Module '{module}' is not in the SPRO registry. "
                f"Available modules: {', '.join(SPRO_REGISTRY.keys())}"
            )

        if self.connection_params:
            try:
                result = self._read_from_sap(module, tables)
                self._cache[module] = result
                return result
            except Exception as exc:
                logger.warning(
                    "Live SAP read failed for module '%s', falling back to baseline: %s",
                    module,
                    exc,
                )

        result = self._read_from_baseline(module, tables)
        self._cache[module] = result
        return result

    def get_valid_values(self, module: str, field: str) -> list[str]:
        """Return the list of valid values for *field* from cached config.

        Looks up which SPRO table governs the given field, reads config if
        not already cached, and extracts unique values from the first column
        of the governing table.

        Args:
            module: Module name (e.g. ``"accounts_payable"``).
            field:  Governed field in ``TABLE.FIELD`` notation (e.g.
                    ``"LFA1.KTOKK"``).

        Returns:
            Sorted list of distinct string values. Empty list if the field
            is not found or has no data.
        """
        tables = SPRO_REGISTRY.get(module, [])
        governing_entry: SPROEntry | None = None

        for entry in tables:
            if field in entry.get("governs_fields", []):
                governing_entry = entry
                break

        if governing_entry is None:
            logger.debug(
                "Field '%s' is not governed by any SPRO table in module '%s'.",
                field,
                module,
            )
            return []

        config = self.read_config(module)
        table_name = governing_entry["table"]
        df = config.get(table_name)

        if df is None or df.empty:
            return []

        # The first field in the entry is assumed to be the key field
        key_field = governing_entry["fields"][0]
        if key_field not in df.columns:
            # Try the field portion after the dot (e.g. KTOKK from LFA1.KTOKK)
            short_field = field.split(".")[-1] if "." in field else field
            if short_field in df.columns:
                key_field = short_field
            else:
                return []

        return sorted(df[key_field].dropna().astype(str).unique().tolist())

    def get_field_purpose(self, module: str, field: str) -> dict[str, Any]:
        """Return configuration context for a governed field.

        Args:
            module: Module name.
            field:  Governed field in ``TABLE.FIELD`` notation.

        Returns:
            Dict with keys ``table``, ``description``, ``config_context``,
            ``governs_fields``, and ``impacts_features``. Empty dict if the
            field is not found.
        """
        tables = SPRO_REGISTRY.get(module, [])

        for entry in tables:
            if field in entry.get("governs_fields", []):
                return {
                    "table": entry["table"],
                    "description": entry["description"],
                    "config_context": entry["config_context"],
                    "governs_fields": entry["governs_fields"],
                    "impacts_features": entry["impacts_features"],
                }

        return {}

    # ------------------------------------------------------------------
    # Private — live SAP read
    # ------------------------------------------------------------------

    def _read_from_sap(
        self,
        module: str,
        tables: list[SPROEntry],
    ) -> dict[str, pd.DataFrame]:
        """Read SPRO tables from a live SAP system.

        Dispatches to the correct connector based on the ``read_method``
        and ``connector`` fields in each registry entry.
        """
        results: dict[str, pd.DataFrame] = {}

        for entry in tables:
            table_name = entry["table"]
            fields = entry["fields"]
            read_method = entry.get("read_method", "rfc_read_table")
            connector_type = entry.get("connector", "ecc")

            try:
                if read_method == "rfc_read_table":
                    df = self._read_rfc(table_name, fields)
                elif read_method == "odata_entity" and connector_type == "successfactors":
                    df = self._read_successfactors(table_name, fields)
                elif read_method == "rest_get" and connector_type == "concur":
                    df = self._read_concur(table_name, fields)
                elif read_method == "rest_get" and connector_type == "ariba":
                    df = self._read_ariba(table_name, fields)
                else:
                    logger.warning(
                        "Unknown read_method '%s' / connector '%s' for table '%s'. Skipping.",
                        read_method,
                        connector_type,
                        table_name,
                    )
                    df = pd.DataFrame(columns=fields)

                results[table_name] = df
                logger.info(
                    "Read %d rows from %s (module=%s, method=%s)",
                    len(df),
                    table_name,
                    module,
                    read_method,
                )

            except SAPConnectorError as exc:
                logger.warning(
                    "Failed to read table '%s' for module '%s': %s",
                    table_name,
                    module,
                    exc,
                )
                results[table_name] = pd.DataFrame(columns=fields)

        return results

    def _read_rfc(self, table: str, fields: list[str]) -> pd.DataFrame:
        """Read a table via RFC_READ_TABLE using the pluggable SAP connector."""
        from sap import get_connector

        params = SAPConnectionParams(**self.connection_params)  # type: ignore[arg-type]
        with get_connector() as conn:
            conn.connect(params)
            return conn.read_table(table, fields)

    def _read_successfactors(self, entity: str, fields: list[str]) -> pd.DataFrame:
        """Read an OData entity from SuccessFactors."""
        from sap.successfactors import SuccessFactorsConnector

        params = CloudConnectionParams(**self.connection_params)  # type: ignore[arg-type]
        with SuccessFactorsConnector() as sf:
            sf.connect(params)
            return sf.read_entity_set(entity, select=fields)

    def _read_concur(self, endpoint: str, fields: list[str]) -> pd.DataFrame:
        """Read a REST endpoint from Concur."""
        from sap.concur import ConcurConnector

        params = CloudConnectionParams(**self.connection_params)  # type: ignore[arg-type]
        with ConcurConnector() as concur:
            concur.connect(params)
            return concur.read_entity_set(endpoint, select=fields)

    def _read_ariba(self, endpoint: str, fields: list[str]) -> pd.DataFrame:
        """Read a REST endpoint from Ariba.

        Note: AribaConnector may not yet be implemented. Falls back to an
        empty DataFrame if the import fails.
        """
        try:
            from sap.ariba import AribaConnector  # type: ignore[import-untyped]
        except ImportError:
            logger.warning(
                "AribaConnector not available. Returning empty DataFrame for '%s'.",
                endpoint,
            )
            return pd.DataFrame(columns=fields)

        params = CloudConnectionParams(**self.connection_params)  # type: ignore[arg-type]
        with AribaConnector() as ariba:
            ariba.connect(params)
            return ariba.read_entity_set(endpoint, select=fields)

    # ------------------------------------------------------------------
    # Private — baseline fallback
    # ------------------------------------------------------------------

    def _read_from_baseline(
        self,
        module: str,
        tables: list[SPROEntry],
    ) -> dict[str, pd.DataFrame]:
        """Load SPRO configuration from the shipped baseline config.

        Baseline data lives in ``sap.baseline_config.BASELINE_CONFIG`` keyed
        by ``system_type -> module -> table_name -> list[dict]``.
        """
        from sap.baseline_config import BASELINE_CONFIG

        results: dict[str, pd.DataFrame] = {}
        module_baseline = BASELINE_CONFIG.get(self.system_type, {}).get(module, {})

        for entry in tables:
            table_name = entry["table"]
            fields = entry["fields"]
            rows = module_baseline.get(table_name, [])

            if rows:
                df = pd.DataFrame(rows)
                # Keep only fields that exist in the baseline data
                available_cols = [f for f in fields if f in df.columns]
                if available_cols:
                    df = df[available_cols]
                results[table_name] = df
                logger.debug(
                    "Loaded %d baseline rows for %s.%s.%s",
                    len(df),
                    self.system_type,
                    module,
                    table_name,
                )
            else:
                results[table_name] = pd.DataFrame(columns=fields)
                logger.debug(
                    "No baseline data for %s.%s.%s — returning empty DataFrame.",
                    self.system_type,
                    module,
                    table_name,
                )

        return results
