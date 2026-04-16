"""SAP Concur REST v4 connector.

Implements CloudSAPConnector for SAP Concur expense reports, travel requests,
and user profiles via the Concur REST v3/v4 APIs.

Usage:
    from sap.concur import ConcurConnector
    from sap.base import CloudConnectionParams

    params = CloudConnectionParams(
        base_url="https://us.api.concursolutions.com",
        company_id="abc-corp",
        auth_type="oauth2_client_credentials",
        client_id="...",
        client_secret="...",
        token_url="https://us.api.concursolutions.com/oauth2/v0/token",
    )
    with ConcurConnector() as conn:
        conn.connect(params)
        df = conn.read_entity_set("/api/v3.0/expense/reports", select=["ID", "Name"])
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
import pandas as pd

from .base import CloudConnectionParams, CloudSAPConnector, SAPConnectorError

logger = logging.getLogger("meridian.sap.concur")

# ---------------------------------------------------------------------------
# Module endpoint registry
# ---------------------------------------------------------------------------

CONCUR_MODULE_ENDPOINTS: dict[str, list[dict[str, Any]]] = {
    "concur_expense": [
        {
            "path": "/api/v3.0/expense/reports",
            "fields": [
                "ID", "Name", "OwnerLoginID", "OwnerName",
                "ApprovalStatusName", "Total", "CurrencyCode",
                "SubmitDate", "ApprovedDate", "PaymentStatusName",
                "OrgUnit1", "OrgUnit2", "Custom1",
            ],
        },
        {
            "path": "/api/v3.0/expense/entries",
            "fields": [
                "ReportID", "ExpenseTypeName", "TransactionAmount",
                "TransactionCurrencyCode", "TransactionDate",
                "VendorDescription", "LocationName", "IsBillable",
                "IsPersonal",
            ],
        },
    ],
    "concur_travel": [
        {
            "path": "/api/v3.0/travelrequest/requests",
            "fields": [
                "ID", "Name", "OwnerLoginID", "ApprovalStatusName",
                "StartDate", "EndDate", "TotalPostedAmount",
                "CurrencyCode", "Purpose",
            ],
        },
    ],
    "concur_users": [
        {
            "path": "/api/v3.0/common/users",
            "fields": [
                "LoginID", "FirstName", "LastName", "EmailAddress",
                "Active", "EmployeeID", "OrganizationUnit", "CostCenter",
            ],
        },
    ],
}


class ConcurConnector(CloudSAPConnector):
    """SAP Concur REST connector.

    Authenticates via OAuth 2.0 client credentials and reads expense reports,
    travel requests, and user profiles through the Concur v3 REST APIs.
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
        """Authenticate to SAP Concur using OAuth 2.0 client credentials."""
        self._params = params
        base = params.base_url.rstrip("/")

        self._client = httpx.Client(
            base_url=base,
            timeout=120.0,
            headers={"Accept": "application/json"},
        )

        try:
            self._get_token()
            logger.info(
                "Connected to SAP Concur at %s (company %s)",
                base,
                params.company_id,
            )
        except Exception as exc:
            msg = str(exc)
            if params.client_secret:
                msg = self._mask_secret(msg, params.client_secret)
            raise SAPConnectorError(f"Concur authentication failed: {msg}") from exc

    def read_entity_set(
        self,
        entity_set: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
    ) -> pd.DataFrame:
        """Read a Concur REST endpoint. Returns a DataFrame.

        Args:
            entity_set: API path, e.g. ``/api/v3.0/expense/reports``.
            select:     List of field names to keep (post-fetch filter).
            filter_expr: Query-string filter value (passed as ``filter`` param).
            top:        Maximum rows to return (0 = unlimited).
        """
        return self._read_endpoint(
            path=entity_set,
            select=select,
            filter_expr=filter_expr,
            top=top,
        )

    def read_report(self, report_id: str, params: dict | None = None) -> pd.DataFrame:
        """Read a specific expense report by ID.

        Args:
            report_id: The Concur report ID.
            params:    Optional extra query parameters.
        """
        path = f"/api/v3.0/expense/reports/{report_id}"
        self._ensure_token()
        assert self._client is not None

        try:
            resp = self._client.get(path, params=params or {})
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            raise SAPConnectorError(
                f"Concur report read failed ({exc.response.status_code}): {path}"
            ) from exc
        except Exception as exc:
            raise SAPConnectorError(f"Concur report read failed: {exc}") from exc

        if isinstance(data, dict):
            return pd.DataFrame([data])
        return pd.DataFrame(data)

    def ping(self) -> bool:
        """Test connectivity by fetching a single user record."""
        try:
            self._ensure_token()
            assert self._client is not None
            resp = self._client.get(
                "/api/v3.0/common/users",
                params={"limit": 1},
            )
            return resp.status_code == 200
        except Exception:
            logger.debug("Concur ping failed", exc_info=True)
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
        logger.debug("Concur connector closed")

    # ------------------------------------------------------------------
    # Module-level helpers
    # ------------------------------------------------------------------

    def read_module(self, module: str) -> pd.DataFrame:
        """Read all endpoints for a Concur module and concatenate results.

        Args:
            module: One of ``concur_expense``, ``concur_travel``, ``concur_users``.

        Returns:
            Combined DataFrame from all endpoints in the module.
        """
        endpoints = CONCUR_MODULE_ENDPOINTS.get(module)
        if not endpoints:
            raise SAPConnectorError(
                f"Unknown Concur module '{module}'. "
                f"Valid modules: {', '.join(CONCUR_MODULE_ENDPOINTS)}"
            )

        frames: list[pd.DataFrame] = []
        for ep in endpoints:
            logger.info("Reading Concur endpoint %s for module %s", ep["path"], module)
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

        token_url = self._params.token_url or (
            self._params.base_url.rstrip("/") + "/oauth2/v0/token"
        )

        payload = {
            "grant_type": "client_credentials",
            "client_id": self._params.client_id,
            "client_secret": self._params.client_secret,
        }
        if self._params.scope:
            payload["scope"] = self._params.scope

        # Token request goes directly (may be a different host).
        resp = httpx.post(
            token_url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30.0,
        )
        resp.raise_for_status()
        body = resp.json()

        self._access_token = body["access_token"]
        expires_in = int(body.get("expires_in", 3600))
        # Refresh 60 s before actual expiry to avoid edge-case failures.
        self._token_expiry = time.time() + expires_in - 60

        # Update client default headers.
        assert self._client is not None
        self._client.headers["Authorization"] = f"Bearer {self._access_token}"

        logger.debug("Concur OAuth token acquired (expires in %d s)", expires_in)

    def _ensure_token(self) -> None:
        """Refresh the access token if it is expired or close to expiry."""
        if time.time() >= self._token_expiry:
            logger.debug("Concur token expired or missing, refreshing")
            self._get_token()

    def _read_endpoint(
        self,
        path: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
    ) -> pd.DataFrame:
        """Paginated GET against a Concur REST endpoint.

        Concur uses ``Items`` + ``NextPage`` for pagination with a default
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
            if filter_expr:
                params["filter"] = filter_expr

            try:
                resp = self._client.get(url, params=params)
                resp.raise_for_status()
                body = resp.json()
            except httpx.HTTPStatusError as exc:
                raise SAPConnectorError(
                    f"Concur read failed ({exc.response.status_code}): {url}"
                ) from exc
            except Exception as exc:
                raise SAPConnectorError(f"Concur read failed: {exc}") from exc

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
