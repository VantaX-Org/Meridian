"""SuccessFactors OData V2 connector.

Implements CloudSAPConnector for SAP SuccessFactors Employee Central and
related modules. All 10 SF modules are mapped to their OData entity sets.

Usage:
    from sap.successfactors import SuccessFactorsConnector
    from sap.base import CloudConnectionParams

    params = CloudConnectionParams(
        base_url="https://api12.successfactors.eu",
        company_id="acmeCorp",
        auth_type="basic",
        username="admin",
        password="secret",
    )
    with SuccessFactorsConnector() as sf:
        sf.connect(params)
        df = sf.read_entity_set("PerPersonal", select=["personIdExternal", "firstName"])
"""

from __future__ import annotations

import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import httpx
import pandas as pd

from .base import CloudConnectionParams, CloudSAPConnector, SAPConnectorError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate-limit and pagination defaults
# ---------------------------------------------------------------------------

_RATE_LIMIT_BACKOFF_SECONDS = 2.0
_MAX_RETRIES = 3


_ODATA_DATE = re.compile(r"^/Date\((-?\d+)([+-]\d{4})?\)/$")


def odata_date(v: str) -> str:
    """``/Date(1704067200000)/`` → ``2024-01-01``; with a time of day → ISO timestamp (UTC)."""
    m = _ODATA_DATE.match(v)
    if not m:
        return v
    ts = datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
    return ts.strftime("%Y-%m-%d") if ts.hour == ts.minute == ts.second == 0 else ts.strftime("%Y-%m-%dT%H:%M:%S")


class SuccessFactorsConnector(CloudSAPConnector):
    """SAP SuccessFactors OData V2 connector.

    Supports basic auth (username@companyId) and OAuth 2.0 client credentials.
    Handles server-driven pagination (__next) and X-RateLimit-Remaining headers.
    """

    def __init__(self) -> None:
        self._client: httpx.Client | None = None
        self._params: CloudConnectionParams | None = None
        self._access_token: str | None = None

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self, params: CloudConnectionParams) -> None:
        """Authenticate and establish an HTTP session.

        Args:
            params: CloudConnectionParams with auth_type 'basic' or
                    'oauth2_client_credentials'.

        Raises:
            SAPConnectorError: on authentication failure.
        """
        self._params = params
        base_url = params.base_url.rstrip("/")

        headers: dict[str, str] = {
            "Accept": "application/json",
        }

        try:
            if params.auth_type == "basic":
                # SF basic auth uses username@companyId
                auth_user = f"{params.username}@{params.company_id}"
                self._client = httpx.Client(
                    base_url=base_url,
                    auth=(auth_user, params.password),
                    headers=headers,
                    timeout=120.0,
                )
                logger.info(
                    "SuccessFactors: connected via basic auth to %s (company %s)",
                    base_url,
                    params.company_id,
                )

            elif params.auth_type in ("oauth2_client_credentials", "oauth2_saml"):
                self._access_token = self._get_oauth_token(params)
                headers["Authorization"] = f"Bearer {self._access_token}"
                self._client = httpx.Client(
                    base_url=base_url,
                    headers=headers,
                    timeout=120.0,
                )
                logger.info(
                    "SuccessFactors: connected via OAuth to %s (company %s)",
                    base_url,
                    params.company_id,
                )

            else:
                raise SAPConnectorError(
                    f"Unsupported auth_type '{params.auth_type}'. "
                    "Use 'basic' or 'oauth2_client_credentials'."
                )

        except httpx.HTTPError as exc:
            safe_msg = self._mask(str(exc))
            raise SAPConnectorError(
                f"SuccessFactors connection failed: {safe_msg}"
            ) from exc

    def _get_oauth_token(self, params: CloudConnectionParams) -> str:
        """Exchange client credentials for a bearer token.

        Args:
            params: must include token_url, client_id, client_secret, and
                    optionally company_id / scope.

        Returns:
            The access_token string.

        Raises:
            SAPConnectorError: on token request failure.
        """
        if not params.token_url:
            raise SAPConnectorError(
                "SuccessFactors OAuth requires token_url in connection params."
            )

        payload = {
            "grant_type": "client_credentials",
            "client_id": params.client_id,
            "client_secret": params.client_secret,
            "company_id": params.company_id,
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
                    "SuccessFactors OAuth response missing 'access_token'."
                )
            logger.debug("SuccessFactors: OAuth token obtained, expires_in=%s",
                         token_data.get("expires_in"))
            return access_token

        except httpx.HTTPError as exc:
            safe_msg = self._mask(str(exc))
            raise SAPConnectorError(
                f"SuccessFactors OAuth token request failed: {safe_msg}"
            ) from exc

    # ------------------------------------------------------------------
    # Entity set reading (OData V2)
    # ------------------------------------------------------------------

    def read_entity_set(
        self,
        entity_set: str,
        select: list[str] | None = None,
        filter_expr: str | None = None,
        top: int = 0,
        from_date: str | None = None,
        expand: list[str] | None = None,
    ) -> pd.DataFrame:
        """Read an OData V2 entity set with pagination and rate-limit handling.

        Args:
            entity_set: OData entity set name (e.g. 'PerPersonal').
            select:     List of fields for $select. None = all fields.
            filter_expr: OData $filter expression string.
            top:        Maximum rows to return. 0 = no limit (all pages).
            from_date:  OData fromDate for effective-dated entities. None = as of today
                        (current record only); "1900-01-01" = full history.
            expand:     Navigation properties for $expand. Their selected properties
                        ("nav/prop" in ``select``) come back as "nav/prop" columns: from the
                        related record in the row's defaultLanguage when both that and
                        "nav/locale" are selected, else the first non-blank one.

        Returns:
            pd.DataFrame with the entity set data.

        Raises:
            SAPConnectorError: on HTTP or parsing errors.
        """
        self._ensure_connected()
        assert self._client is not None  # for type checker

        params: dict[str, str] = {"$format": "json"}
        if select:
            params["$select"] = ",".join(select)
        if expand:
            params["$expand"] = ",".join(expand)
        if filter_expr:
            params["$filter"] = filter_expr
        if from_date:
            params["fromDate"] = from_date
        if top > 0:
            params["$top"] = str(top)
        # no $top otherwise: SF reads $top as a client limit and then returns no __next,
        # so an unlimited read relies on server-driven pages (1000 rows each)

        url = f"/odata/v2/{entity_set}"
        all_records: list[dict[str, Any]] = []
        remaining = top if top > 0 else float("inf")

        while url and remaining > 0:
            resp = self._request_with_retry("GET", url, params=params)
            body = resp.json()

            # OData V2 wraps results in d.results
            d = body.get("d", body)
            results = d.get("results", [])
            if not results:
                break

            # Strip OData metadata; OData V2 dates arrive as /Date(ms)/ — make them ISO
            for rec in results:
                rec.pop("__metadata", None)
                for nav in expand or ():
                    rel = rec.pop(nav, None) or {}
                    rel = rel.get("results", [rel]) if isinstance(rel, dict) else []
                    # ponytail: a to-many navigation (one locale per language) gives one value per row: the
                    # record's defaultLanguage locale first, else the first non-blank; rows per locale if needed
                    lang = rec.get("defaultLanguage")
                    if lang:
                        rel = sorted(rel, key=lambda r: r.get("locale") != lang)
                    for s in select or ():
                        if s.startswith(f"{nav}/"):
                            k = s.split("/", 1)[1]
                            rec[s] = next((r[k] for r in rel if r.get(k) is not None and str(r[k]).strip()), None)
                for k, v in rec.items():
                    if isinstance(v, str) and v.startswith("/Date("):
                        rec[k] = odata_date(v)

            rows_to_take = len(results) if top <= 0 else min(len(results), remaining)
            all_records.extend(results[:rows_to_take])
            remaining -= rows_to_take

            # Server-driven pagination via __next
            next_url = d.get("__next")
            if next_url and remaining > 0:
                # __next is an absolute URL; make it relative
                if next_url.startswith(("http://", "https://")):
                    base = self._params.base_url.rstrip("/") if self._params else ""
                    next_url = next_url.replace(base, "", 1)
                url = next_url
                params = None  # pagination URL includes all params; {} would make httpx drop its query
            else:
                url = None  # type: ignore[assignment]

        logger.info(
            "SuccessFactors: read %d records from %s", len(all_records), entity_set,
        )
        return pd.DataFrame(all_records) if all_records else pd.DataFrame()

    # ------------------------------------------------------------------
    # Module-level reading
    # ------------------------------------------------------------------

    def metadata(self, entity: str | None = None) -> str:
        """OData $metadata document (whole service, or one entity to keep it small)."""
        self._ensure_connected()
        path = f"/odata/v2/{entity}/$metadata" if entity else "/odata/v2/$metadata"
        # the client's default Accept is JSON; $metadata is XML-only and answers 406 to it
        return self._request_with_retry("GET", path, params={}, headers={"Accept": "application/xml"}).text

    # ------------------------------------------------------------------
    # Report reading
    # ------------------------------------------------------------------

    def read_report(
        self,
        report_id: str,
        params: dict | None = None,
    ) -> pd.DataFrame:
        """Read a SuccessFactors report or generic OData endpoint.

        Args:
            report_id: OData path segment (e.g. 'PerPersonal' or a report name).
            params:    Additional OData query parameters.

        Returns:
            pd.DataFrame with the report data.
        """
        self._ensure_connected()
        assert self._client is not None

        query: dict[str, str] = {"$format": "json"}
        if params:
            query.update({k: str(v) for k, v in params.items()})

        url = f"/odata/v2/{report_id}"
        resp = self._request_with_retry("GET", url, params=query)
        body = resp.json()

        d = body.get("d", body)
        results = d.get("results", [])

        for rec in results:
            rec.pop("__metadata", None)

        return pd.DataFrame(results) if results else pd.DataFrame()

    # ------------------------------------------------------------------
    # Ping
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        """Test connectivity by fetching the OData metadata document.

        Returns:
            True if the service responds. Never raises.
        """
        if not self._client:
            return False
        try:
            resp = self._client.get(
                "/odata/v2/$metadata",
                headers={"Accept": "application/xml"},
            )
            return resp.status_code == 200
        except Exception:
            logger.debug("SuccessFactors ping failed", exc_info=True)
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
        logger.debug("SuccessFactors: connection closed")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _mask(self, text: str) -> str:
        """Mask every secret this connector holds (password, client secret, bearer token) in ``text``."""
        prm = self._params
        for secret in (prm.password if prm else "", prm.client_secret if prm else "", self._access_token or ""):
            text = self._mask_secret(self._mask_secret(text, secret), json.dumps(secret)[1:-1] if secret else "")
        return re.sub(r"(?i)(bearer\s+)[\w.~+/=-]+", r"\1****", text)

    def _ensure_connected(self) -> None:
        """Raise if connect() has not been called."""
        if not self._client:
            raise SAPConnectorError(
                "SuccessFactors: not connected. Call connect() first."
            )

    def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict[str, str]] = None,
        headers: Optional[dict[str, str]] = None,
        retries: int = _MAX_RETRIES,
    ) -> httpx.Response:
        """Execute an HTTP request with rate-limit handling and retries.

        Inspects X-RateLimit-Remaining header and backs off when near zero.

        Raises:
            SAPConnectorError: after exhausting retries.
        """
        assert self._client is not None
        last_exc: Exception | None = None

        for attempt in range(1, retries + 1):
            try:
                resp = self._client.request(method, url, params=params, headers=headers)

                # Check rate limit headers
                remaining = resp.headers.get("X-RateLimit-Remaining")
                if remaining is not None:
                    try:
                        remaining_int = int(remaining)
                        if remaining_int <= 1:
                            wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                            logger.warning(
                                "SuccessFactors: rate limit near zero (%s remaining), "
                                "backing off %.1fs",
                                remaining,
                                wait,
                            )
                            time.sleep(wait)
                    except ValueError:
                        pass

                if resp.status_code == 429:
                    wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "SuccessFactors: 429 rate limited, retry %d/%d after %.1fs",
                        attempt,
                        retries,
                        wait,
                    )
                    time.sleep(wait)
                    continue

                # Bearer token expired mid-extraction: fetch a new one once and retry.
                if (resp.status_code == 401 and attempt == 1 and self._params
                        and self._params.auth_type in ("oauth2_client_credentials", "oauth2_saml")):
                    logger.info("SuccessFactors: 401, refreshing OAuth token")
                    self._access_token = self._get_oauth_token(self._params)
                    self._client.headers["Authorization"] = f"Bearer {self._access_token}"
                    continue

                resp.raise_for_status()
                return resp

            except httpx.HTTPStatusError as exc:
                last_exc = exc
                safe_msg = self._mask(str(exc))
                if exc.response.status_code in (500, 502, 503, 504) and attempt < retries:
                    wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "SuccessFactors: server error %d on %s, retry %d/%d after %.1fs",
                        exc.response.status_code,
                        url,
                        attempt,
                        retries,
                        wait,
                    )
                    time.sleep(wait)
                    continue
                body = error_body(exc.response, self._mask)
                if body:
                    safe_msg = f"{self._mask(body)} :: {safe_msg}"
                raise SAPConnectorError(
                    f"SuccessFactors request failed: {safe_msg}"
                ) from exc

            except httpx.HTTPError as exc:
                last_exc = exc
                safe_msg = self._mask(str(exc))
                if attempt < retries:
                    wait = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "SuccessFactors: request error on %s, retry %d/%d after %.1fs",
                        url,
                        attempt,
                        retries,
                        wait,
                    )
                    time.sleep(wait)
                    continue
                raise SAPConnectorError(
                    f"SuccessFactors request failed: {safe_msg}"
                ) from exc

        raise SAPConnectorError(
            f"SuccessFactors request failed after {retries} retries"
        ) from last_exc


def error_body(resp: httpx.Response, mask: Callable[[str], str] = str, limit: int = 300) -> str:
    """The SF error message of a failed response ('[COE0003]Bad property expression: ...'), truncated.
    A body that is not SF's JSON/XML error (an HTML or proxy page) gives its content-type and a short snippet."""
    text = resp.text or ""
    try:
        err = json.loads(text).get("error", {})
        msg = err.get("message")
        msg = msg.get("value") if isinstance(msg, dict) else msg
        if isinstance(msg, str) and msg.strip():
            return mask(msg.strip())[:limit]
    except (ValueError, AttributeError):
        pass
    m = re.search(r"<message[^>]*>([^<]+)", text)
    if m:
        return mask(m.group(1).strip())[:limit]
    snippet = mask(re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", text)).strip())[:100]
    return f"[{resp.headers.get('content-type', 'unknown content-type')}] {snippet}" if snippet else ""


def entity_model(edmx: str, entity: str) -> tuple[set[str], dict[str, set[str] | None]] | None:
    """(property names, {navigation property: its target type's property names}) of ``entity``
    in an OData V2 $metadata document; a target is None when the document does not describe it.
    None if the document does not describe ``entity``."""
    def local(el: ET.Element) -> str:
        return el.tag.rsplit("}", 1)[-1]

    def name(qualified: str) -> str:
        return qualified.rsplit(".", 1)[-1]

    root = ET.fromstring(edmx)
    types = {el.get("Name", ""): el for el in root.iter() if local(el) == "EntityType"}
    ends = {el.get("Name", ""): {e.get("Role"): name(e.get("Type", "")) for e in el if local(e) == "End"}
            for el in root.iter() if local(el) == "Association"}

    def props(t: ET.Element) -> set[str]:
        return {c.get("Name", "") for c in t if local(c) == "Property"}

    t = types.get(next((name(el.get("EntityType", "")) for el in root.iter()
                        if local(el) == "EntitySet" and el.get("Name") == entity), entity))
    if t is None:
        return None
    navs: dict[str, set[str] | None] = {}
    for c in t:
        if local(c) == "NavigationProperty":
            target = types.get(ends.get(name(c.get("Relationship", "")), {}).get(c.get("ToRole"), ""))
            navs[c.get("Name", "")] = props(target) if target is not None else None
    return props(t), navs
