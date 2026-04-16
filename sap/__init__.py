"""SAP connector package.

Usage:
    from sap import get_connector
    from sap.base import SAPConnectionParams, SAPConnectorError, BAPICall
"""

from __future__ import annotations

import os

from .base import SAPConnector


def get_connector() -> SAPConnector:
    """Return the configured SAP connector implementation.

    Controlled by the SAP_CONNECTOR environment variable:
      rfc     — PyRFC / SAP NW RFC SDK (default, current behaviour)
      ctypes  — Direct ctypes bindings to nwrfcsdk (future)
      odata   — OData V2/V4 via pyodata (future)
      mock    — In-memory mock for testing without a real SAP system

    Adding a new backend requires only: create sap/<backend>.py implementing
    SAPConnector, then add an elif branch here. No other file changes.
    """
    backend = os.getenv("SAP_CONNECTOR", "rfc").lower()

    if backend == "rfc":
        from .rfc import RFCConnector
        return RFCConnector()

    if backend == "ctypes":
        from .ctypes_rfc import CtypesRFCConnector  # type: ignore[import]
        return CtypesRFCConnector()

    if backend == "odata":
        from .odata import ODataConnector  # type: ignore[import]
        return ODataConnector()

    if backend == "mock":
        from .mock import MockConnector  # type: ignore[import]
        return MockConnector()

    if backend == "successfactors":
        from .successfactors import SuccessFactorsConnector  # type: ignore[import]
        return SuccessFactorsConnector()

    if backend == "concur":
        from .concur import ConcurConnector  # type: ignore[import]
        return ConcurConnector()

    if backend == "ariba":
        from .ariba import AribaConnector  # type: ignore[import]
        return AribaConnector()

    if backend == "s4hana_cloud":
        from .s4hana_cloud import S4HanaCloudConnector  # type: ignore[import]
        return S4HanaCloudConnector()

    raise ValueError(
        f"Unknown SAP_CONNECTOR value '{backend}'. "
        "Valid options: rfc, ctypes, odata, mock, successfactors, concur, ariba, s4hana_cloud"
    )


__all__ = ["get_connector"]
