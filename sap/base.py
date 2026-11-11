"""Abstract SAP connector interface.

All SAP connectivity in Meridian goes through this interface.
No production code outside sap/ may import pyrfc, pyodata, or ctypes directly.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

import pandas as pd


@dataclass
class SAPConnectionParams:
    """Connection parameters — mirrors the existing pyrfc.Connection signature.

    ``read_function``: the table reader sap/rfc.py uses: "RFC_READ_TABLE", "/BODS/RFC_READ_TABLE2",
    "BBP_RFC_READ_TABLE", or "auto" (probe RFC_FUNCTION_SEARCH for the first available of those, in that order
    after /BODS). Empty: MERIDIAN_RFC_READ_FUNCTION, else RFC_READ_TABLE. See docs/sap/authorisation-role-template.md.
    """
    host: str
    client: str
    sysnr: str
    user: str
    password: str
    read_function: str = ""
    extraction_path: str = ""   # table_reader | odp | odata | auto (sap/extraction_plan.py); empty: table_reader
    # SAProuter string (/H/host/S/3299/H/...) and Secure Network Communication; none of these are secrets.
    saprouter: str = ""
    snc_mode: bool = False
    snc_partnername: str = ""   # the application server's SNC name, e.g. p:CN=P01, O=Example, C=ZA
    snc_qop: str = ""           # 1 authentication, 2 integrity, 3 privacy, 8 the server default, 9 maximum
    snc_myname: str = ""        # empty: the SNC library's default own name




def rfc_route_params(row: Any) -> dict:
    """The router string and SNC settings of a sap_systems row, dict or object with those attributes (missing: off)."""
    get = row.get if isinstance(row, dict) else (lambda k: getattr(row, k, None))
    return {"saprouter": get("saprouter") or "", "snc_mode": bool(get("snc_mode")),
            "snc_partnername": get("snc_partnername") or "", "snc_qop": get("snc_qop") or "",
            "snc_myname": get("snc_myname") or ""}


def rfc_user(row: Any) -> str:
    """The RFC user of a sap_systems row: the system's own stored username; SAP_RFC_USER (then RFC_USER) only when
    the system has none stored."""
    import os

    get = row.get if isinstance(row, dict) else (lambda k: getattr(row, k, None))
    return (get("username") or "").strip() or os.getenv("SAP_RFC_USER", "RFC_USER")


def rfc_logon_kwargs(params: "SAPConnectionParams") -> dict:
    """The pyrfc.Connection keyword arguments for ``params``: only the router and SNC values that are set.

    The SNC library path is the deployment's SNC_LIB; pyrfc otherwise reads it from the environment itself."""
    import os

    kw = {"ashost": params.host, "client": params.client, "user": params.user, "passwd": params.password,
          "sysnr": params.sysnr}
    if (getattr(params, "saprouter", "") or "").strip():
        kw["saprouter"] = params.saprouter.strip()
    if getattr(params, "snc_mode", False):
        kw["snc_mode"] = "1"
        for key in ("snc_partnername", "snc_qop", "snc_myname"):
            if (getattr(params, key, "") or "").strip():
                kw[key] = getattr(params, key).strip()
        if os.getenv("SNC_LIB"):
            kw["snc_lib"] = os.environ["SNC_LIB"]
    return kw


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

    def load_config(self, system_type: str, progress=None):
        """Read-only configuration snapshot (SPRO customizing tables). Returns sap.config_snapshot.ConfigSnapshot."""
        from sap.config_loader import load_abap

        return load_abap(self, system_type, progress)

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

    def load_config(self, system_type: str, progress=None):
        """Read-only configuration snapshot. Objects the system cannot expose are reported not_available."""
        from sap.config_loader import load_cloud

        return load_cloud(self, system_type, progress)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    @staticmethod
    def _mask_secret(message: str, secret: str) -> str:
        if not secret:
            return message
        return re.sub(re.escape(secret), "****", message)
