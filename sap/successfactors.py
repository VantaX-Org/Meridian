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
        df = sf.read_module("employee_central")
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
# Module -> OData entity sets + default fields
# ---------------------------------------------------------------------------

SF_MODULE_ENTITIES: dict[str, list[dict[str, Any]]] = {
    "employee_central": [
        {
            "entity_set": "PerPersonal",
            "fields": [
                "personIdExternal", "firstName", "lastName", "middleName",
                "gender", "dateOfBirth", "nationality", "startDate", "endDate",
            ],
        },
        {
            "entity_set": "PerEmail",
            "fields": [
                "personIdExternal", "emailType", "emailAddress", "isPrimary",
            ],
        },
        {
            "entity_set": "PerPhone",
            "fields": [
                "personIdExternal", "phoneType", "phoneNumber", "isPrimary",
                "countryCode",
            ],
        },
        {
            "entity_set": "EmpJob",
            "fields": [
                "userId", "jobCode", "position", "department", "division",
                "company", "location", "startDate", "endDate", "eventReason",
                "managerId", "employeeClass", "payGrade",
            ],
        },
        {
            "entity_set": "EmpEmployment",
            "fields": [
                "personIdExternal", "userId", "startDate", "endDate",
                "seniorityDate", "originalStartDate",
            ],
        },
    ],
    "compensation": [
        {
            "entity_set": "EmpCompensation",
            "fields": [
                "userId", "startDate", "payType", "payGroup", "salary",
                "currencyCode", "frequency", "endDate",
            ],
        },
        {
            "entity_set": "EmpPayCompRecurring",
            "fields": [
                "userId", "payComponent", "paycompvalue", "currencyCode",
                "frequency", "startDate", "endDate",
            ],
        },
    ],
    "benefits": [
        {
            "entity_set": "BenefitEnrollment",
            "fields": [
                "benefitPlanId", "userId", "enrollmentDate", "coverageLevel",
                "dependentId", "deductionAmount", "employerContribution",
            ],
        },
    ],
    "payroll_integration": [
        {
            "entity_set": "EmpPayCompNonRecurring",
            "fields": [
                "userId", "payComponent", "paycompvalue", "currencyCode",
                "payDate", "notes",
            ],
        },
        {
            "entity_set": "PayrollConfigurationCategory",
            "fields": [
                "externalCode", "externalName", "payrollSystemClientId",
            ],
        },
    ],
    "performance_goals": [
        {
            "entity_set": "Goal_1",
            "fields": [
                "id", "userId", "name", "metric", "start", "due", "state",
                "weight", "rating",
            ],
        },
        {
            "entity_set": "FormHeader",
            "fields": [
                "formDataId", "formTemplateId", "formTitle",
                "currentStep", "ratingMode",
            ],
        },
    ],
    "succession_planning": [
        {
            "entity_set": "Position",
            "fields": [
                "code", "externalName_defaultValue", "department",
                "jobCode", "incumbent", "targetFTE",
            ],
        },
        {
            "entity_set": "Successor",
            "fields": [
                "id", "nomineeUserId", "positionCode", "readiness",
                "ranking", "notes",
            ],
        },
    ],
    "recruiting_onboarding": [
        {
            "entity_set": "JobRequisition",
            "fields": [
                "jobReqId", "jobTitle", "department", "location", "status",
                "openDate", "closedDate", "numberOpenings", "recruiter",
            ],
        },
        {
            "entity_set": "JobApplication",
            "fields": [
                "applicationId", "candidateId", "jobReqId", "status",
                "appliedDate", "source", "rating",
            ],
        },
    ],
    "learning_management": [
        {
            "entity_set": "LearningHistoryV1",
            "fields": [
                "userID", "courseID", "courseTitle", "completionDate",
                "status", "score", "creditHours",
            ],
        },
    ],
    "time_attendance": [
        {
            "entity_set": "EmployeeTime",
            "fields": [
                "externalCode", "userId", "timeType", "startDate",
                "endDate", "approvalStatus", "quantityInDays",
                "quantityInHours",
            ],
        },
        {
            "entity_set": "EmployeeTimeSheet",
            "fields": [
                "externalCode", "userId", "workingTimeType",
                "startDate", "endDate", "approvalStatus",
                "plannedHoursAndMinutes",
            ],
        },
    ],
}

# ---------------------------------------------------------------------------
# Field rename maps: OData camelCase -> Meridian TABLE.FIELD format
# ---------------------------------------------------------------------------

SF_FIELD_MAP: dict[str, dict[str, str]] = {
    "employee_central": {
        # PerPersonal
        "personIdExternal": "PERPERSONAL.PERSON_ID_EXTERNAL",
        "firstName": "PERPERSONAL.FIRST_NAME",
        "lastName": "PERPERSONAL.LAST_NAME",
        "middleName": "PERPERSONAL.MIDDLE_NAME",
        "gender": "PERPERSONAL.GENDER",
        "dateOfBirth": "PERPERSONAL.DATE_OF_BIRTH",
        "nationality": "PERPERSONAL.NATIONALITY",
        "startDate": "PERPERSONAL.START_DATE",
        "endDate": "PERPERSONAL.END_DATE",
        # PerEmail
        "emailType": "PEREMAIL.EMAIL_TYPE",
        "emailAddress": "PEREMAIL.EMAIL_ADDRESS",
        "isPrimary": "PEREMAIL.IS_PRIMARY",
        # PerPhone
        "phoneType": "PERPHONE.PHONE_TYPE",
        "phoneNumber": "PERPHONE.PHONE_NUMBER",
        "countryCode": "PERPHONE.COUNTRY_CODE",
        # EmpJob
        "userId": "EMPJOB.USER_ID",
        "jobCode": "EMPJOB.JOB_CODE",
        "position": "EMPJOB.POSITION",
        "department": "EMPJOB.DEPARTMENT",
        "division": "EMPJOB.DIVISION",
        "company": "EMPJOB.COMPANY",
        "location": "EMPJOB.LOCATION",
        "eventReason": "EMPJOB.EVENT_REASON",
        "managerId": "EMPJOB.MANAGER_ID",
        "employeeClass": "EMPJOB.EMPLOYEE_CLASS",
        "payGrade": "EMPJOB.PAY_GRADE",
        # EmpEmployment
        "seniorityDate": "EMPEMPLOYMENT.SENIORITY_DATE",
        "originalStartDate": "EMPEMPLOYMENT.ORIGINAL_START_DATE",
    },
    "compensation": {
        "userId": "EMPCOMPENSATION.USER_ID",
        "payType": "EMPCOMPENSATION.PAY_TYPE",
        "payGroup": "EMPCOMPENSATION.PAY_GROUP",
        "salary": "EMPCOMPENSATION.SALARY",
        "currencyCode": "EMPCOMPENSATION.CURRENCY_CODE",
        "frequency": "EMPCOMPENSATION.FREQUENCY",
        "payComponent": "EMPPAYCOMPRECURRING.PAY_COMPONENT",
        "paycompvalue": "EMPPAYCOMPRECURRING.PAY_COMP_VALUE",
        "startDate": "EMPCOMPENSATION.START_DATE",
        "endDate": "EMPCOMPENSATION.END_DATE",
    },
    "benefits": {
        "benefitPlanId": "BENEFITENROLLMENT.BENEFIT_PLAN_ID",
        "userId": "BENEFITENROLLMENT.USER_ID",
        "enrollmentDate": "BENEFITENROLLMENT.ENROLLMENT_DATE",
        "coverageLevel": "BENEFITENROLLMENT.COVERAGE_LEVEL",
        "dependentId": "BENEFITENROLLMENT.DEPENDENT_ID",
        "deductionAmount": "BENEFITENROLLMENT.DEDUCTION_AMOUNT",
        "employerContribution": "BENEFITENROLLMENT.EMPLOYER_CONTRIBUTION",
    },
    "time_attendance": {
        "externalCode": "EMPLOYEETIME.EXTERNAL_CODE",
        "userId": "EMPLOYEETIME.USER_ID",
        "timeType": "EMPLOYEETIME.TIME_TYPE",
        "startDate": "EMPLOYEETIME.START_DATE",
        "endDate": "EMPLOYEETIME.END_DATE",
        "approvalStatus": "EMPLOYEETIME.APPROVAL_STATUS",
        "quantityInDays": "EMPLOYEETIME.QUANTITY_IN_DAYS",
        "quantityInHours": "EMPLOYEETIME.QUANTITY_IN_HOURS",
    },
}

# ---------------------------------------------------------------------------
# Rate-limit and pagination defaults
# ---------------------------------------------------------------------------

_DEFAULT_PAGE_SIZE = 1000
_RATE_LIMIT_BACKOFF_SECONDS = 2.0
_MAX_RETRIES = 3


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
            safe_msg = self._mask_secret(str(exc), params.password)
            safe_msg = self._mask_secret(safe_msg, params.client_secret)
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
            safe_msg = self._mask_secret(str(exc), params.client_secret)
            safe_msg = self._mask_secret(safe_msg, params.password)
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
    ) -> pd.DataFrame:
        """Read an OData V2 entity set with pagination and rate-limit handling.

        Args:
            entity_set: OData entity set name (e.g. 'PerPersonal').
            select:     List of fields for $select. None = all fields.
            filter_expr: OData $filter expression string.
            top:        Maximum rows to return. 0 = no limit (all pages).

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
        if filter_expr:
            params["$filter"] = filter_expr
        if top > 0:
            params["$top"] = str(top)
        else:
            # Use page size for server-driven pagination
            params["$top"] = str(_DEFAULT_PAGE_SIZE)

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

            # Strip OData metadata from each record
            for rec in results:
                rec.pop("__metadata", None)

            rows_to_take = min(len(results), int(remaining))
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
                params = {}  # pagination URL includes all params
            else:
                url = None  # type: ignore[assignment]

        logger.info(
            "SuccessFactors: read %d records from %s", len(all_records), entity_set,
        )
        return pd.DataFrame(all_records) if all_records else pd.DataFrame()

    # ------------------------------------------------------------------
    # Module-level reading
    # ------------------------------------------------------------------

    def read_module(self, module: str) -> pd.DataFrame:
        """Read all entity sets for a module and merge into one DataFrame.

        Applies SF_FIELD_MAP renaming for the module when available.

        Args:
            module: One of the keys in SF_MODULE_ENTITIES.

        Returns:
            Merged DataFrame with renamed columns.

        Raises:
            SAPConnectorError: if module is unknown.
        """
        entities = SF_MODULE_ENTITIES.get(module)
        if not entities:
            raise SAPConnectorError(
                f"Unknown SuccessFactors module '{module}'. "
                f"Valid: {', '.join(SF_MODULE_ENTITIES.keys())}"
            )

        frames: list[pd.DataFrame] = []
        for entity_spec in entities:
            entity_set = entity_spec["entity_set"]
            fields = entity_spec.get("fields")
            try:
                df = self.read_entity_set(entity_set, select=fields)
                if not df.empty:
                    # Prefix columns with entity set name to avoid collisions
                    df.columns = [f"{entity_set}.{c}" for c in df.columns]
                    frames.append(df)
            except SAPConnectorError:
                logger.warning(
                    "SuccessFactors: failed to read entity set %s for module %s, skipping",
                    entity_set,
                    module,
                    exc_info=True,
                )

        if not frames:
            return pd.DataFrame()

        # Concatenate along columns (each entity set adds its own columns)
        result = pd.concat(frames, axis=1)

        # Apply field rename map if available
        field_map = SF_FIELD_MAP.get(module)
        if field_map:
            # Build qualified rename map (EntitySet.odataField -> MERIDIAN_FORMAT)
            qualified_map: dict[str, str] = {}
            for odata_field, meridian_field in field_map.items():
                for col in result.columns:
                    if col.endswith(f".{odata_field}"):
                        qualified_map[col] = meridian_field
            if qualified_map:
                result = result.rename(columns=qualified_map)

        return result

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
                resp = self._client.request(method, url, params=params)

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

                resp.raise_for_status()
                return resp

            except httpx.HTTPStatusError as exc:
                last_exc = exc
                safe_msg = self._mask_secret(str(exc), self._params.password if self._params else "")
                safe_msg = self._mask_secret(safe_msg, self._params.client_secret if self._params else "")
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
                raise SAPConnectorError(
                    f"SuccessFactors request failed: {safe_msg}"
                ) from exc

            except httpx.HTTPError as exc:
                last_exc = exc
                safe_msg = self._mask_secret(str(exc), self._params.password if self._params else "")
                safe_msg = self._mask_secret(safe_msg, self._params.client_secret if self._params else "")
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
