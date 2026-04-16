"""S/4HANA Cloud OData V4 connector.

Implements CloudSAPConnector for SAP S/4HANA Cloud public edition via
OData V4 APIs, authenticated through SAP BTP OAuth 2.0 client credentials.

Usage:
    from sap.s4hana_cloud import S4HanaCloudConnector
    from sap.base import CloudConnectionParams

    params = CloudConnectionParams(
        base_url="https://my000000.s4hana.cloud.sap",
        company_id="",
        auth_type="oauth2_client_credentials",
        client_id="<btp-client-id>",
        client_secret="<btp-client-secret>",
        token_url="https://<subdomain>.authentication.eu10.hana.ondemand.com/oauth/token",
        scope="API_BUSINESS_PARTNER_0001",
    )
    with S4HanaCloudConnector() as s4:
        s4.connect(params)
        df = s4.read_entity_set("A_BusinessPartner", select=["BusinessPartner", "BusinessPartnerName"])
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx
import pandas as pd

from .base import CloudConnectionParams, CloudSAPConnector, SAPConnectorError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module -> OData V4 entity sets + default fields
# ---------------------------------------------------------------------------

S4HC_MODULE_ENTITIES: dict[str, list[dict[str, Any]]] = {
    "business_partner": [
        {
            "entity_set": "A_BusinessPartner",
            "service_path": "/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001",
            "fields": [
                "BusinessPartner", "BusinessPartnerName", "BusinessPartnerCategory",
                "BusinessPartnerGrouping", "FirstName", "LastName",
                "SearchTerm1", "CreationDate", "LastChangeDate",
                "IsNaturalPerson", "Language",
            ],
        },
        {
            "entity_set": "A_BusinessPartnerAddress",
            "service_path": "/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001",
            "fields": [
                "BusinessPartner", "AddressID", "Country", "Region",
                "CityName", "PostalCode", "StreetName", "HouseNumber",
            ],
        },
    ],
    "material_master": [
        {
            "entity_set": "A_Product",
            "service_path": "/sap/opu/odata4/sap/api_product/srvd_a2x/sap/a_product/0001",
            "fields": [
                "Product", "ProductType", "ProductGroup",
                "BaseUnit", "GrossWeight", "WeightUnit",
                "CreationDate", "LastChangeDate", "IsMarkedForDeletion",
            ],
        },
        {
            "entity_set": "A_ProductPlant",
            "service_path": "/sap/opu/odata4/sap/api_product/srvd_a2x/sap/a_product/0001",
            "fields": [
                "Product", "Plant", "PurchasingGroup",
                "MRPType", "MRPController", "LotSizeKey",
                "ABCIndicator", "AvailabilityCheckType",
            ],
        },
        {
            "entity_set": "A_ProductValuation",
            "service_path": "/sap/opu/odata4/sap/api_product/srvd_a2x/sap/a_product/0001",
            "fields": [
                "Product", "ValuationArea", "ValuationClass",
                "PriceControl", "StandardPrice", "MovingAveragePrice",
            ],
        },
    ],
    "accounts_payable": [
        {
            "entity_set": "A_Supplier",
            "service_path": "/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001",
            "fields": [
                "Supplier", "SupplierName", "Country", "PostalCode",
                "CityName", "TaxNumber1", "TaxNumber2",
                "CreationDate", "IsBlocked",
            ],
        },
        {
            "entity_set": "A_SupplierCompany",
            "service_path": "/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001",
            "fields": [
                "Supplier", "CompanyCode", "ReconciliationAccount",
                "PaymentTerms", "PaymentMethodsList",
                "APARToleranceGroup",
            ],
        },
    ],
    "fi_gl": [
        {
            "entity_set": "A_GLAccountInChartOfAccounts",
            "service_path": "/sap/opu/odata4/sap/api_glaccountinchartofaccounts/srvd_a2x/sap/a_glaccountinchartofaccounts/0001",
            "fields": [
                "ChartOfAccounts", "GLAccount", "GLAccountType",
                "GLAccountGroup", "GLAccountName",
                "IsBalanceSheetAccount", "IsProfitLossAccount",
                "CreationDate", "IsMarkedForDeletion",
            ],
        },
    ],
}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_PAGE_SIZE = 5000
_RATE_LIMIT_BACKOFF_SECONDS = 2.0
_MAX_RETRIES = 3


class S4HanaCloudConnector(CloudSAPConnector):
    """SAP S/4HANA Cloud OData V4 connector.

    Authenticates via SAP BTP OAuth 2.0 client credentials flow.
    Handles OData V4 server-driven pagination (@odata.nextLink).
    """

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._params: CloudConnectionParams | None = None
        self._access_token: str | None = None

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self, params: CloudConnectionParams) -> None:
        """Authenticate via SAP BTP OAuth 2.0 and establish HTTP session.

        Args:
            params: CloudConnectionParams with auth_type 'oauth2_client_credentials'.
                    Requires token_url, client_id, and client_secret.

        Raises:
            SAPConnectorError: on authentication failure.
        """
        self._params = params
        base_url = params.base_url.rstrip("/")

        if params.auth_type != "oauth2_client_credentials":
            raise SAPConnectorError(
                f"S/4HANA Cloud requires auth_type 'oauth2_client_credentials', "
                f"got '{params.auth_type}'."
            )

        try:
            self._access_token = self._get_oauth_token(params)
            headers: dict[str, str] = {
                "Accept": "application/json",
                "Authorization": f"Bearer {self._access_token}",
            }
            self._client = httpx.Client(
                base_url=base_url,
                headers=headers,
                timeout=120.0,
            )
            logger.info("S/4HANA Cloud: connected via OAuth to %s", base_url)

        except httpx.HTTPError as exc:
            safe_msg = self._mask_secret(str(exc), params.client_secret)
            safe_msg = self._mask_secret(safe_msg, params.password)
            raise SAPConnectorError(
                f"S/4HANA Cloud connection failed: {safe_msg}"
            ) from exc

    def _get_oauth_token(self, params: CloudConnectionParams) -> str:
        """Exchange SAP BTP client credentials for a bearer token.

        Args:
            params: must include token_url, client_id, client_secret.

        Returns:
            The access_token string.

        Raises:
            SAPConnectorError: on token request failure.
        """
        if not params.token_url:
            raise SAPConnectorError(
                "S/4HANA Cloud OAuth requires token_url in connection params."
            )

        payload: dict[str, str] = {
            "grant_type": "client_credentials",
            "client_id": params.client_id,
            "client_secret": params.client_secret,
        }
        if params.scope:
            payload["scope"] = params.scope

        try:
            resp = httpx.post(
                params.token_url,
                data=payload,
                timeout=30.0,
            )
            resp.raise_for_status()
            token_data = resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                raise SAPConnectorError(
                    "S/4HANA Cloud OAuth response missing 'access_token'."
                )
            logger.debug(
                "S/4HANA Cloud: OAuth token obtained, expires_in=%s",
                token_data.get("expires_in"),
            )
            return access_token

        except httpx.HTTPError as exc:
            safe_msg = self._mask_secret(str(exc), params.client_secret)
            safe_msg = self._mask_secret(safe_msg, params.password)
            raise SAPConnectorError(
                f"S/4HANA Cloud OAuth token request failed: {safe_msg}"
            ) from exc

    # ------------------------------------------------------------------
    # Entity set reading (OData V4)
    # ------------------------------------------------------------------

    def read_entity_set(
        self,
        entity_set: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
    ) -> pd.DataFrame:
        """Read an OData V4 entity set with pagination.

        Args:
            entity_set: OData entity set name (e.g. 'A_BusinessPartner').
            select:     List of fields for $select. None = all fields.
            filter_expr: OData $filter expression string.
            top:        Maximum rows to return. 0 = no limit (all pages).

        Returns:
            pd.DataFrame with the entity set data.

        Raises:
            SAPConnectorError: on HTTP or parsing errors.
        """
        self._ensure_connected()
        assert self._client is not None

        # Resolve service path from module entities if available
        service_path = self._resolve_service_path(entity_set)

        params: dict[str, str] = {}
        if select:
            params["$select"] = ",".join(select)
        if filter_expr:
            params["$filter"] = filter_expr
        if top > 0:
            params["$top"] = str(top)
        else:
            params["$top"] = str(_DEFAULT_PAGE_SIZE)

        url = f"{service_path}/{entity_set}"
        all_records: list[dict[str, Any]] = []
        remaining = top if top > 0 else float("inf")

        while url and remaining > 0:
            resp = self._request_with_retry("GET", url, params=params)
            body = resp.json()

            # OData V4 returns results in "value" array
            results = body.get("value", [])
            if not results:
                break

            rows_to_take = min(len(results), int(remaining))
            all_records.extend(results[:rows_to_take])
            remaining -= rows_to_take

            # Server-driven pagination via @odata.nextLink
            next_link = body.get("@odata.nextLink")
            if next_link and remaining > 0:
                # nextLink may be absolute or relative
                if next_link.startswith(("http://", "https://")):
                    base = self._params.base_url.rstrip("/") if self._params else ""
                    next_link = next_link.replace(base, "", 1)
                url = next_link
                params = {}  # pagination URL includes all params
            else:
                url = None  # type: ignore[assignment]

        logger.info(
            "S/4HANA Cloud: read %d records from %s",
            len(all_records),
            entity_set,
        )
        return pd.DataFrame(all_records) if all_records else pd.DataFrame()

    # ------------------------------------------------------------------
    # Module-level reading
    # ------------------------------------------------------------------

    def read_module(self, module: str) -> pd.DataFrame:
        """Read all entity sets for a module and merge into one DataFrame.

        Args:
            module: One of the keys in S4HC_MODULE_ENTITIES.

        Returns:
            Merged DataFrame with entity set prefix on columns.

        Raises:
            SAPConnectorError: if module is unknown.
        """
        entities = S4HC_MODULE_ENTITIES.get(module)
        if not entities:
            raise SAPConnectorError(
                f"Unknown S/4HANA Cloud module '{module}'. "
                f"Valid: {', '.join(S4HC_MODULE_ENTITIES.keys())}"
            )

        frames: list[pd.DataFrame] = []
        for entity_spec in entities:
            entity_set = entity_spec["entity_set"]
            fields = entity_spec.get("fields")
            try:
                df = self.read_entity_set(entity_set, select=fields)
                if not df.empty:
                    df.columns = [f"{entity_set}.{c}" for c in df.columns]
                    frames.append(df)
            except SAPConnectorError:
                logger.warning(
                    "S/4HANA Cloud: failed to read entity set %s for module %s, skipping",
                    entity_set,
                    module,
                    exc_info=True,
                )

        if not frames:
            return pd.DataFrame()

        return pd.concat(frames, axis=1)

    # ------------------------------------------------------------------
    # Report reading
    # ------------------------------------------------------------------

    def read_report(
        self,
        report_id: str,
        params: dict | None = None,
    ) -> pd.DataFrame:
        """Read a generic S/4HANA Cloud OData V4 endpoint.

        Args:
            report_id: OData path segment or custom CDS view name.
            params:    Additional OData query parameters.

        Returns:
            pd.DataFrame with the response data.
        """
        self._ensure_connected()
        assert self._client is not None

        query: dict[str, str] = {}
        if params:
            query.update({k: str(v) for k, v in params.items()})

        url = f"/sap/opu/odata4/sap/{report_id}"
        resp = self._request_with_retry("GET", url, params=query)
        body = resp.json()

        results = body.get("value", [])
        return pd.DataFrame(results) if results else pd.DataFrame()

    # ------------------------------------------------------------------
    # Ping
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        """Test connectivity by fetching the OData V4 service metadata.

        Returns:
            True if the service responds. Never raises.
        """
        if not self._client:
            return False
        try:
            resp = self._client.get(
                "/sap/opu/odata4/sap/",
                headers={"Accept": "application/json"},
            )
            return resp.status_code == 200
        except Exception:
            logger.debug("S/4HANA Cloud ping failed", exc_info=True)
            return False

    # ------------------------------------------------------------------
    # Close
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the HTTP client and clear secrets. Safe to call multiple times."""
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None
        self._access_token = None
        self._params = None
        logger.debug("S/4HANA Cloud: connection closed")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_connected(self) -> None:
        """Raise if connect() has not been called."""
        if not self._client:
            raise SAPConnectorError(
                "S/4HANA Cloud: not connected. Call connect() first."
            )

    def _resolve_service_path(self, entity_set: str) -> str:
        """Look up the service path for a given entity set from the module map.

        Falls back to a generic path if the entity set is not in the map.
        """
        for module_entities in S4HC_MODULE_ENTITIES.values():
            for spec in module_entities:
                if spec["entity_set"] == entity_set:
                    return spec.get("service_path", "/sap/opu/odata4/sap")
        return "/sap/opu/odata4/sap"

    def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict[str, str]] = None,
        retries: int = _MAX_RETRIES,
    ) -> httpx.Response:
        """Execute an HTTP request with retries on transient errors.

        Raises:
            SAPConnectorError: after exhausting retries.
        """
        assert self._client is not None
        last_exc: Exception | None = None

        for attempt in range(1, retries + 1):
            try:
                resp = self._client.request(method, url, params=params)

                if resp.status_code == 429:
                    wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "S/4HANA Cloud: 429 rate limited, retry %d/%d after %.1fs",
                        attempt,
                        retries,
                        wait,
                    )
                    time.sleep(wait)
                    continue

                resp.raise_for_status()
                return resp

            except httpx.HTTPStatusError as exc:
                last_exc = exc
                safe_msg = self._mask_secret(
                    str(exc), self._params.client_secret if self._params else ""
                )
                safe_msg = self._mask_secret(
                    safe_msg, self._params.password if self._params else ""
                )
                if exc.response.status_code in (500, 502, 503, 504) and attempt < retries:
                    wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "S/4HANA Cloud: server error %d on %s, retry %d/%d after %.1fs",
                        exc.response.status_code,
                        url,
                        attempt,
                        retries,
                        wait,
                    )
                    time.sleep(wait)
                    continue
                raise SAPConnectorError(
                    f"S/4HANA Cloud request failed: {safe_msg}"
                ) from exc

            except httpx.HTTPError as exc:
                last_exc = exc
                safe_msg = self._mask_secret(
                    str(exc), self._params.client_secret if self._params else ""
                )
                safe_msg = self._mask_secret(
                    safe_msg, self._params.password if self._params else ""
                )
                if attempt < retries:
                    wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "S/4HANA Cloud: request error on %s, retry %d/%d after %.1fs",
                        url,
                        attempt,
                        retries,
                        wait,
                    )
                    time.sleep(wait)
                    continue
                raise SAPConnectorError(
                    f"S/4HANA Cloud request failed: {safe_msg}"
                ) from exc

        raise SAPConnectorError(
            f"S/4HANA Cloud request failed after {retries} retries"
        ) from last_exc
