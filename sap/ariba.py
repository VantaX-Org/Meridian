"""SAP Ariba REST connector.

Implements CloudSAPConnector for SAP Ariba suppliers, contracts, procurement,
and spend analysis via the Ariba REST APIs.

Usage:
    from sap.ariba import AribaConnector
    from sap.base import CloudConnectionParams

    params = CloudConnectionParams(
        base_url="https://openapi.ariba.com",
        company_id="realm-id",
        auth_type="oauth2_client_credentials",
        client_id="...",
        client_secret="...",
        token_url="https://api.ariba.com/v2/oauth/token",
        api_key="my-ariba-api-key",
    )
    with AribaConnector() as conn:
        conn.connect(params)
        df = conn.read_entity_set("/api/sourcing-approval/v1/prod/vendors")
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
import pandas as pd

from .base import CloudConnectionParams, CloudSAPConnector, SAPConnectorError

logger = logging.getLogger("meridian.sap.ariba")

# ---------------------------------------------------------------------------
# Module endpoint registry
# ---------------------------------------------------------------------------

ARIBA_MODULE_ENDPOINTS: dict[str, list[dict[str, Any]]] = {
    "ariba_supplier": [
        {
            "path": "/api/sourcing-approval/v1/prod/vendors",
            "fields": [
                "VendorId", "Name", "Country", "Region", "City",
                "Status", "QualificationStatus", "Category",
                "RegistrationDate", "LastUpdated",
            ],
        },
    ],
    "ariba_contracts": [
        {
            "path": "/api/contract-compliance/v1/prod/contracts",
            "fields": [
                "ContractId", "Title", "Status", "EffectiveDate",
                "ExpirationDate", "Owner", "Supplier", "ContractAmount",
                "CurrencyCode", "ComplianceStatus",
            ],
        },
    ],
    "ariba_procurement": [
        {
            "path": "/api/procurement/v2/prod/purchaseOrders",
            "fields": [
                "OrderId", "Title", "Status", "OrderDate", "Supplier",
                "TotalAmount", "CurrencyCode", "CompanyCode", "Plant",
                "CreatedBy",
            ],
        },
        {
            "path": "/api/procurement/v2/prod/invoices",
            "fields": [
                "InvoiceId", "InvoiceNumber", "Status", "InvoiceDate",
                "Supplier", "TotalAmount", "CurrencyCode", "PaymentTerms",
                "PurchaseOrderId",
            ],
        },
    ],
    "ariba_spend": [
        {
            "path": "/api/spend-analysis/v1/prod/spendData",
            "fields": [
                "SpendId", "Supplier", "Category", "Amount",
                "CurrencyCode", "Period", "CompanyCode", "CostCenter",
                "Region",
            ],
        },
    ],
}


class AribaConnector(CloudSAPConnector):
    """SAP Ariba REST connector.

    Authenticates via OAuth 2.0 client credentials with an additional
    ``apikey`` header required by the Ariba API gateway. Reads suppliers,
    contracts, purchase orders, invoices, and spend analysis data.
    """

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._params: CloudConnectionParams | None = None
        self._access_token: str = ""
        self._token_expiry: float = 0.0

    # ------------------------------------------------------------------
    # CloudSAPConnector interface
    # ------------------------------------------------------------------

    def connect(self, params: CloudConnectionParams) -> None:
        """Authenticate to SAP Ariba using OAuth 2.0 + API key."""
        self._params = params
        base = params.base_url.rstrip("/")

        headers: dict[str, str] = {"Accept": "application/json"}
        if params.api_key:
            headers["apikey"] = params.api_key

        self._client = httpx.Client(
            base_url=base,
            timeout=120.0,
            headers=headers,
        )

        try:
            self._get_token()
            logger.info(
                "Connected to SAP Ariba at %s (realm %s)",
                base,
                params.company_id,
            )
        except Exception as exc:
            msg = str(exc)
            if params.client_secret:
                msg = self._mask_secret(msg, params.client_secret)
            if params.api_key:
                msg = self._mask_secret(msg, params.api_key)
            raise SAPConnectorError(f"Ariba authentication failed: {msg}") from exc

    def read_entity_set(
        self,
        entity_set: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
    ) -> pd.DataFrame:
        """Read an Ariba REST endpoint. Returns a DataFrame.

        Args:
            entity_set: API path, e.g. ``/api/sourcing-approval/v1/prod/vendors``.
            select:     List of field names to keep (post-fetch filter).
            filter_expr: Query-string filter value (passed as ``$filter`` param).
            top:        Maximum rows to return (0 = unlimited).
        """
        return self._read_endpoint(
            path=entity_set,
            select=select,
            filter_expr=filter_expr,
            top=top,
        )

    def read_report(self, report_id: str, params: dict | None = None) -> pd.DataFrame:
        """Read an arbitrary Ariba endpoint by path.

        Args:
            report_id: The API path to read (used as a generic endpoint reader).
            params:    Optional extra query parameters.
        """
        self._ensure_token()
        assert self._client is not None

        query: dict[str, Any] = {}
        if self._params and self._params.company_id:
            query["realm"] = self._params.company_id
        if params:
            query.update(params)

        try:
            resp = self._client.get(report_id, params=query)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            raise SAPConnectorError(
                f"Ariba report read failed ({exc.response.status_code}): {report_id}"
            ) from exc
        except Exception as exc:
            raise SAPConnectorError(f"Ariba report read failed: {exc}") from exc

        items = data.get("Items", data if isinstance(data, list) else [data])
        return pd.DataFrame(items)

    def ping(self) -> bool:
        """Test connectivity by fetching a single vendor record."""
        try:
            self._ensure_token()
            assert self._client is not None

            query: dict[str, Any] = {"limit": 1}
            if self._params and self._params.company_id:
                query["realm"] = self._params.company_id

            resp = self._client.get(
                "/api/sourcing-approval/v1/prod/vendors",
                params=query,
            )
            return resp.status_code == 200
        except Exception:
            logger.debug("Ariba ping failed", exc_info=True)
            return False

    def close(self) -> None:
        """Close the HTTP client and clear sensitive state."""
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None

        self._access_token = ""
        self._token_expiry = 0.0
        self._params = None
        logger.debug("Ariba connector closed")

    # ------------------------------------------------------------------
    # Module-level helpers
    # ------------------------------------------------------------------

    def read_module(self, module: str) -> pd.DataFrame:
        """Read all endpoints for an Ariba module and concatenate results.

        Args:
            module: One of ``ariba_supplier``, ``ariba_contracts``,
                    ``ariba_procurement``, ``ariba_spend``.

        Returns:
            Combined DataFrame from all endpoints in the module.
        """
        endpoints = ARIBA_MODULE_ENDPOINTS.get(module)
        if not endpoints:
            raise SAPConnectorError(
                f"Unknown Ariba module '{module}'. "
                f"Valid modules: {', '.join(ARIBA_MODULE_ENDPOINTS)}"
            )

        frames: list[pd.DataFrame] = []
        for ep in endpoints:
            logger.info("Reading Ariba endpoint %s for module %s", ep["path"], module)
            df = self._read_endpoint(path=ep["path"], select=ep["fields"])
            if not df.empty:
                frames.append(df)

        if not frames:
            return pd.DataFrame()

        return pd.concat(frames, ignore_index=True)

    # ------------------------------------------------------------------
    # Internal methods
    # ------------------------------------------------------------------

    def _get_token(self) -> None:
        """Obtain an OAuth 2.0 access token via client credentials grant."""
        assert self._params is not None

        token_url = self._params.token_url
        if not token_url:
            raise SAPConnectorError(
                "Ariba OAuth token_url is required but not configured"
            )

        payload = {
            "grant_type": "client_credentials",
            "client_id": self._params.client_id,
            "client_secret": self._params.client_secret,
        }
        if self._params.scope:
            payload["scope"] = self._params.scope

        headers: dict[str, str] = {
            "Content-Type": "application/x-www-form-urlencoded",
        }
        if self._params.api_key:
            headers["apikey"] = self._params.api_key

        resp = httpx.post(
            token_url,
            data=payload,
            headers=headers,
            timeout=30.0,
        )
        resp.raise_for_status()
        body = resp.json()

        self._access_token = body["access_token"]
        expires_in = int(body.get("expires_in", 1800))
        # Refresh 60 s before actual expiry.
        self._token_expiry = time.time() + expires_in - 60

        # Update client default headers.
        assert self._client is not None
        self._client.headers["Authorization"] = f"Bearer {self._access_token}"

        logger.debug("Ariba OAuth token acquired (expires in %d s)", expires_in)

    def _ensure_token(self) -> None:
        """Refresh the access token if it is expired or close to expiry."""
        if time.time() >= self._token_expiry:
            logger.debug("Ariba token expired or missing, refreshing")
            self._get_token()

    def _read_endpoint(
        self,
        path: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
    ) -> pd.DataFrame:
        """Paginated GET against an Ariba REST endpoint.

        Ariba uses ``Items`` + ``NextPage`` for pagination with a default
        page size controlled by the ``limit`` query parameter.
        """
        self._ensure_token()
        assert self._client is not None

        all_items: list[dict[str, Any]] = []
        page_size = 100
        collected = 0
        url: str | None = path

        while url is not None:
            params: dict[str, Any] = {"limit": page_size}
            if self._params and self._params.company_id:
                params["realm"] = self._params.company_id
            if filter_expr:
                params["$filter"] = filter_expr

            try:
                resp = self._client.get(url, params=params)
                resp.raise_for_status()
                body = resp.json()
            except httpx.HTTPStatusError as exc:
                raise SAPConnectorError(
                    f"Ariba read failed ({exc.response.status_code}): {url}"
                ) from exc
            except Exception as exc:
                raise SAPConnectorError(f"Ariba read failed: {exc}") from exc

            items = body.get("Items", [])
            if not items:
                break

            all_items.extend(items)
            collected += len(items)

            if 0 < top <= collected:
                all_items = all_items[:top]
                break

            url = body.get("NextPage")
            # NextPage is a full URL; clear params so we don't double-apply.
            filter_expr = None

        if not all_items:
            return pd.DataFrame()

        df = pd.DataFrame(all_items)

        # Post-filter to requested columns (only keep those that exist).
        if select:
            available = [c for c in select if c in df.columns]
            if available:
                df = df[available]

        logger.info("Read %d rows from %s", len(df), path)
        return df
