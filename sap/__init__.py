"""SAP connector package.

Usage:
    from sap import get_connector
    from sap.base import SAPConnectionParams, SAPConnectorError, BAPICall

On-premise ABAP systems (ECC, S/4HANA, EWM) are always reached through the
SAP NW RFC SDK (pyrfc). Cloud systems use their own connectors, selected by
``sap_systems.system_type`` in api/services/connectivity_manager.py.
"""

from __future__ import annotations

from .base import SAPConnector


def get_connector() -> SAPConnector:
    """RFC connector (SAP NW RFC SDK) for on-premise ABAP systems."""
    from .rfc import RFCConnector
    return RFCConnector()


__all__ = ["get_connector"]
