"""S/4HANA on premise over SAP Gateway OData V2: released CDS-based APIs instead of RFC table reads.

Where the customer exposes SAP's released APIs on its own Gateway (API_BUSINESS_PARTNER, API_PRODUCT_SRV,
API_GLACCOUNTINCHARTOFACCOUNTS_SRV, activated in /IWFND/MAINT_SERVICE), an on-premise S/4HANA system can be read
through them (sap_systems.extraction_path = "odata"). Transport, paging (V2 __next and $skip), retry and the
mapping onto the ECC tables the rules read (sap/s4hana_cloud.py S4HC_TABLE_MAP) are the S/4HANA Cloud connector's;
this class changes only the service paths (V2, /sap/opu/odata/sap/<SERVICE>), the sign-in (basic with the system's
user and password, or OAuth 2.0 client credentials) and the SAP client (``sap-client`` on every request).

Usage:
    from sap.s4hana_onprem import S4OnPremODataConnector
    from sap.base import CloudConnectionParams

    conn = S4OnPremODataConnector(sap_client="100")
    conn.connect(CloudConnectionParams(base_url="https://s4gw.example.internal:44300", company_id="",
                                       auth_type="basic", username="MERIDIAN_RO", password="..."))
    df = conn.read_entity_set("A_Product", select=["Product", "ProductType"])

Read-only: extraction issues GET requests only.
"""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import quote

import httpx

from .base import CloudConnectionParams, SAPConnectorError
from .s4hana_cloud import S4HC_MODULE_ENTITIES, S4HanaCloudConnector

logger = logging.getLogger(__name__)

BP_SERVICE = "/sap/opu/odata/sap/API_BUSINESS_PARTNER"
PRODUCT_SERVICE = "/sap/opu/odata/sap/API_PRODUCT_SRV"
GL_SERVICE = "/sap/opu/odata/sap/API_GLACCOUNTINCHARTOFACCOUNTS_SRV"

# The V2 service of each entity set the S/4HANA table map reads (sap/s4hana_cloud.py S4HC_TABLE_MAP).
ENTITY_SERVICES: dict[str, str] = {
    **{e: BP_SERVICE for e in ("A_BusinessPartner", "A_BusinessPartnerAddress", "A_BusinessPartnerRole",
                               "A_Supplier", "A_SupplierCompany", "A_Customer", "A_CustomerCompany")},
    **{e: PRODUCT_SERVICE for e in ("A_Product", "A_ProductPlant", "A_ProductValuation")},
    "A_GLAccountInChartOfAccounts": GL_SERVICE,
}

ONPREM_MODULE_ENTITIES: dict[str, list[dict[str, Any]]] = {
    module: [{**spec, "service_path": ENTITY_SERVICES[spec["entity_set"]]} for spec in specs
             if spec["entity_set"] in ENTITY_SERVICES]
    for module, specs in S4HC_MODULE_ENTITIES.items()
}

AUTH_TYPES = ("basic", "oauth2_client_credentials")


class S4OnPremODataConnector(S4HanaCloudConnector):
    """SAP Gateway OData V2 on an on-premise S/4HANA system (basic auth or OAuth 2.0 client credentials)."""

    _LABEL = "S/4HANA on premise OData"
    MODULE_ENTITIES = ONPREM_MODULE_ENTITIES
    _PING_PATH = f"{BP_SERVICE}/"

    def __init__(self, sap_client: str = "", transport: Optional[httpx.BaseTransport] = None) -> None:
        """``sap_client``: the SAP client sent as ``sap-client`` (empty: the Gateway's default client).
        ``transport``: an httpx transport (tests use httpx.MockTransport)."""
        super().__init__()
        self._sap_client = (sap_client or "").strip()
        self._transport = transport

    def connect(self, params: CloudConnectionParams) -> None:
        if params.auth_type not in AUTH_TYPES:
            raise SAPConnectorError(f"{self._LABEL} signs in with {' or '.join(AUTH_TYPES)}, not {params.auth_type!r}.")
        if not params.base_url:
            raise SAPConnectorError(f"{self._LABEL} needs the Gateway's base URL, for example https://host:44300.")
        self._params = params
        headers = {"Accept": "application/json"}
        auth: Optional[tuple[str, str]] = None
        try:
            if params.auth_type == "basic":
                if not (params.username and params.password):
                    raise SAPConnectorError(f"{self._LABEL} basic sign-in needs the user and password.")
                auth = (params.username, params.password)
            else:
                self._access_token = self._get_oauth_token(params)
                headers["Authorization"] = f"Bearer {self._access_token}"
            kwargs: dict[str, Any] = {"base_url": params.base_url.rstrip("/"), "headers": headers, "timeout": 120.0,
                                      "auth": auth}
            if self._transport is not None:
                kwargs["transport"] = self._transport
            self._client = httpx.Client(**kwargs)
            logger.info("%s: client for %s (sap-client %s, %s)", self._LABEL, params.base_url,
                        self._sap_client or "default", params.auth_type)
        except httpx.HTTPError as exc:
            msg = self._mask_secret(self._mask_secret(str(exc), params.client_secret), params.password)
            raise SAPConnectorError(f"{self._LABEL} connection failed: {msg}") from exc

    def _request_with_retry(self, method: str, url: str, *, params: Optional[dict[str, str]] = None,
                            **kwargs: Any) -> httpx.Response:
        """Every request carries ``sap-client``. Added per request, not as client-level params: httpx would then
        replace the query of a ``__next`` link with them, and paging would ask for the first page forever."""
        if self._sap_client:
            if params:
                params = {**params, "sap-client": self._sap_client}
            elif "sap-client=" not in url:
                url = f"{url}{'&' if '?' in url else '?'}sap-client={quote(self._sap_client)}"
        return super()._request_with_retry(method, url, params=params, **kwargs)

    def _resolve_service_path(self, entity_set: str) -> str:
        return ENTITY_SERVICES.get(entity_set) or super()._resolve_service_path(entity_set)
