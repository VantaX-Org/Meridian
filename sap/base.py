"""Abstract SAP connector interface.

All SAP connectivity in Meridian goes through this interface.
No production code outside sap/ may import pyrfc, pyodata, or ctypes directly.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

import pandas as pd


@dataclass
class SAPConnectionParams:
    """Connection parameters — mirrors the existing pyrfc.Connection signature."""
    host: str
    client: str
    sysnr: str
    user: str
    password: str


@dataclass
class BAPICall:
    """A single BAPI call to be executed via execute_bapi()."""
    bapi_name: str
    params: dict


class SAPConnectorError(Exception):
    """Raised for all connector-level failures.

    The message must never contain the plaintext password.
    Callers should mask the password themselves before constructing this error,
    but the connector implementations must also strip it internally.
    """


class SAPConnector(ABC):
    """Abstract SAP connector.

    Implementations: RFCConnector (sap/rfc.py), CtypesConnector (sap/ctypes_rfc.py),
    ODataConnector (sap/odata.py), MockConnector (sap/mock.py).

    Usage — always use as a context manager to guarantee close() is called:

        from sap import get_connector
        from sap.base import SAPConnectionParams, SAPConnectorError

        params = SAPConnectionParams(host=..., client=..., sysnr=...,
                                     user=..., password=...)
        try:
            with get_connector() as conn:
                conn.connect(params)
                df = conn.read_table("BUT000", ["PARTNER", "BU_TYPE"])
        except SAPConnectorError as e:
            ...  # already password-safe
    """

    @abstractmethod
    def connect(self, params: SAPConnectionParams) -> None:
        """Open the connection. Raises SAPConnectorError on failure."""

    @abstractmethod
    def read_table(
        self,
        table: str,
        fields: list[str],
        where: Optional[str] = None,
        max_rows: int = 0,
    ) -> pd.DataFrame:
        """Read a SAP table. Returns a DataFrame with SAP field names as columns.

        Args:
            table:    SAP table name, e.g. "BUT000"
            fields:   List of field names to extract
            where:    Optional WHERE clause (already validated by caller)
            max_rows: 0 = no limit
        """

    @abstractmethod
    def execute_bapi(self, call: BAPICall) -> dict:
        """Execute a single BAPI/RFC function call. Returns the result dict.

        Raises SAPConnectorError on connection or execution failure.
        """

    @abstractmethod
    def ping(self) -> bool:
        """Test connectivity. Returns True if the system responds. Never raises."""

    @abstractmethod
    def close(self) -> None:
        """Close the connection. Must be safe to call multiple times."""

    # ── Context manager support ────────────────────────────────────────────────

    def __enter__(self) -> "SAPConnector":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    # ── Shared utility ─────────────────────────────────────────────────────────

    @staticmethod
    def _mask_password(message: str, password: str) -> str:
        """Remove any occurrence of the password from a string."""
        if not password:
            return message
        return re.sub(re.escape(password), "****", message)


# ── Cloud SAP connectors (SF, Concur, Ariba, S/4HC) ──────────────────────────


@dataclass
class CloudConnectionParams:
    """Connection parameters for cloud SAP systems (SF, Concur, Ariba, S/4HC)."""
    base_url: str
    company_id: str
    auth_type: str  # basic, oauth2_client_credentials, oauth2_saml
    username: str = ""
    password: str = ""
    client_id: str = ""
    client_secret: str = ""
    token_url: str = ""
    api_key: str = ""
    scope: str = ""


class CloudSAPConnector(ABC):
    """Extended connector for cloud SAP systems (OData/REST).

    Adds cloud-specific methods on top of the same context-manager pattern.
    """

    @abstractmethod
    def connect(self, params: CloudConnectionParams) -> None:
        """Authenticate and establish session."""

    @abstractmethod
    def read_entity_set(
        self,
        entity_set: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
    ) -> pd.DataFrame:
        """Read an OData entity set or REST endpoint. Returns DataFrame."""

    @abstractmethod
    def read_report(self, report_id: str, params: dict | None = None) -> pd.DataFrame:
        """Read a predefined report / API endpoint. Returns DataFrame."""

    @abstractmethod
    def ping(self) -> bool:
        """Test connectivity."""

    @abstractmethod
    def close(self) -> None:
        """Close session."""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    @staticmethod
    def _mask_secret(message: str, secret: str) -> str:
        if not secret:
            return message
        return re.sub(re.escape(secret), "****", message)
