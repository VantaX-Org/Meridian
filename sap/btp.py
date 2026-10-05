"""SAP BTP OData connector (read-only).

Reads OData services exposed through SAP BTP destinations (e.g. the Business
Partner API of SAP Master Data Governance or an S/4HANA backend), authenticated
with OAuth 2.0 client credentials against the subaccount's XSUAA token URL.

Transport, OAuth, paging (V4 nextLink, V2 __next, $skip) and retry are
inherited from S4HanaCloudConnector; only GET requests are ever issued.

Usage:
    from sap.btp import BTPConnector
    from sap.base import CloudConnectionParams

    params = CloudConnectionParams(
        base_url="https://<destination-or-approuter-host>",
        company_id="",
        auth_type="oauth2_client_credentials",
        client_id="<xsuaa-client-id>",
        client_secret="<xsuaa-client-secret>",
        token_url="https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token",
    )
    with BTPConnector() as btp:
        btp.connect(params)
        df = btp.read_entity_set("A_BusinessPartner", select=["BusinessPartner"])
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from .s4hana_cloud import S4HanaCloudConnector

BP_SERVICE = "/sap/opu/odata/sap/API_BUSINESS_PARTNER"

# Entity sets per module; the field mapping onto the ECC tables the rules read
# lives in sap/extraction_registry.py (BTP_EXTRACTIONS).
BTP_MODULE_ENTITIES: dict[str, list[dict[str, Any]]] = {
    "business_partner": [
        {"entity_set": e, "service_path": BP_SERVICE}
        for e in ("A_BusinessPartner", "A_BusinessPartnerAddress",
                  "A_BusinessPartnerTaxNumber", "A_BusinessPartnerBank", "A_AddressEmailAddress")
    ],
}


class BTPConnector(S4HanaCloudConnector):
    """OData services behind SAP BTP (XSUAA OAuth 2.0 client credentials)."""

    _LABEL = "SAP BTP"
    MODULE_ENTITIES = BTP_MODULE_ENTITIES
    _PING_PATH = f"{BP_SERVICE}/"  # service document, JSON


_V2_DATE = re.compile(r"/Date\((-?\d+)[^)]*\)/")
_ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def ecc_value(v: Any) -> Any:
    """OData value -> the shape RFC_READ_TABLE returns (flags 'X'/'', dates YYYYMMDD)."""
    if isinstance(v, bool):
        return "X" if v else ""
    if isinstance(v, str):
        if m := _V2_DATE.fullmatch(v):
            return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).strftime("%Y%m%d")
        if m := _ISO_DATE.match(v):
            return "".join(m.groups()) if len(v) == 10 or v[10] == "T" else v
    return v
