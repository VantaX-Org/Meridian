"""SAP Extraction Registry.

Maps every Meridian module to the exact tables, entity sets, or endpoints
needed for data extraction.  Organised by system type so the extraction
engine can look up targets for any (system_type, module) pair.

Usage::

    from sap.extraction_registry import (
        get_extraction_targets,
        get_available_modules,
        get_table_names,
    )

    targets = get_extraction_targets("ecc", "accounts_payable")
    modules = get_available_modules("successfactors")
    tables  = get_table_names("ecc", "material_master", config_only=True)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ExtractionTarget:
    """A single table / entity set / endpoint to extract from an SAP system."""

    source: str              # Table name (RFC), entity set (OData), or endpoint path (REST)
    fields: list[str]
    filter: Optional[str] = None
    max_rows: int = 0
    description: str = ""
    is_config: bool = False
    rename_map: dict = field(default_factory=dict)


# ============================================================================
# ECC extractions  (also used for s4hana_onprem and s4hana_cloud)
# ============================================================================

ECC_EXTRACTIONS: dict[str, list[ExtractionTarget]] = {
    # ------------------------------------------------------------------
    # Accounts Payable
    # ------------------------------------------------------------------
    "accounts_payable": [
        ExtractionTarget(
            source="LFA1",
            fields=[
                "LIFNR", "LAND1", "NAME1", "NAME2", "ORT01", "PSTLZ",
                "REGIO", "SORTL", "STRAS", "ADRNR", "MCOD1", "KTOKK",
                "LOEVM", "SPERR", "SPERM", "ERDAT", "ERNAM", "STCD1",
                "STCD2",
            ],
            description="Vendor general data",
        ),
        ExtractionTarget(
            source="LFB1",
            fields=[
                "LIFNR", "BUKRS", "AKONT", "ZTERM", "ZWELS", "ZAHLS",
                "FDGRV", "LOEVM", "SPERR", "REPRF", "TOGRU", "HBKID",
            ],
            description="Vendor company code data",
        ),
        ExtractionTarget(
            source="T077Y",
            fields=["KTOKK", "TXT30"],
            description="Vendor account groups",
            is_config=True,
        ),
        ExtractionTarget(
            source="T052",
            fields=["ZTERM", "ZTAGG", "ZTAG1", "ZTAG2", "ZTAG3", "TXT30"],
            description="Payment terms",
            is_config=True,
        ),
        ExtractionTarget(
            source="T042Z",
            fields=["ZLSCH", "TEXT1"],
            description="Payment methods",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # Accounts Receivable
    # ------------------------------------------------------------------
    "accounts_receivable": [
        ExtractionTarget(
            source="KNA1",
            fields=[
                "KUNNR", "LAND1", "NAME1", "NAME2", "ORT01", "PSTLZ",
                "REGIO", "SORTL", "STRAS", "ADRNR", "KTOKD", "LOEVM",
                "SPERR", "AUFSD", "ERDAT", "ERNAM",
            ],
            description="Customer general data",
        ),
        ExtractionTarget(
            source="KNB1",
            fields=[
                "KUNNR", "BUKRS", "AKONT", "ZTERM", "ZWELS", "FDGRV",
                "LOEVM", "SPERR",
            ],
            description="Customer company code data",
        ),
        ExtractionTarget(
            source="T077D",
            fields=["KTOKD", "TXT30"],
            description="Customer account groups",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # Material Master
    # ------------------------------------------------------------------
    "material_master": [
        ExtractionTarget(
            source="MARA",
            fields=[
                "MATNR", "MTART", "MBRSH", "MATKL", "MEINS", "BRGEW",
                "NTGEW", "GEWEI", "VOLUM", "VOLEH", "BISMT", "PRDHA",
                "LVORM", "ERNAM", "ERSDA", "LAEDA", "VPSTA",
            ],
            description="Material general data",
        ),
        ExtractionTarget(
            source="MAKT",
            fields=["MATNR", "SPRAS", "MAKTX"],
            filter="SPRAS = 'EN'",
            description="Material descriptions (English)",
        ),
        ExtractionTarget(
            source="MARC",
            fields=[
                "MATNR", "WERKS", "DISMM", "DISPO", "DISLS", "BESKZ",
                "LGPRO", "LGFSB", "PLIFZ",
            ],
            description="Material plant data",
        ),
        ExtractionTarget(
            source="MBEW",
            fields=[
                "MATNR", "BWKEY", "VPRSV", "VERPR", "STPRS", "BKLAS",
                "LAEPR",
            ],
            description="Material valuation data",
        ),
        ExtractionTarget(
            source="T134",
            fields=["MTART", "MTBEZ"],
            description="Material types",
            is_config=True,
        ),
        ExtractionTarget(
            source="T023",
            fields=["MATKL", "WGBEZ"],
            description="Material groups",
            is_config=True,
        ),
        ExtractionTarget(
            source="T006",
            fields=["MSEHI", "MSEHL"],
            description="Units of measure",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # Business Partner
    # ------------------------------------------------------------------
    "business_partner": [
        ExtractionTarget(
            source="BUT000",
            fields=[
                "PARTNER", "BU_TYPE", "BU_GROUP", "TITLE", "NAME_ORG1",
                "NAME_ORG2", "NAME_FIRST", "NAME_LAST", "PARTNER_GUID",
                "XDELE", "XBLCK", "CRDAT", "CRTIM", "CHDAT",
            ],
            description="Business partner general data",
        ),
        ExtractionTarget(
            source="BUT100",
            fields=["PARTNER", "RLTYP", "XDELE", "XBLCK"],
            description="Business partner roles",
        ),
        ExtractionTarget(
            source="ADRC",
            fields=[
                "ADDRNUMBER", "NAME1", "CITY1", "POST_CODE1", "STREET",
                "COUNTRY", "REGION",
            ],
            description="Address data",
        ),
        ExtractionTarget(
            source="ADR6",
            fields=["ADDRNUMBER", "SMTP_ADDR"],
            description="Email addresses",
        ),
        ExtractionTarget(
            source="TB003",
            fields=["BU_GROUP", "TXT30"],
            description="BP groupings",
            is_config=True,
        ),
        ExtractionTarget(
            source="TBZ9",
            fields=["RLTYP", "RLTXT"],
            description="BP role categories",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # FI General Ledger
    # ------------------------------------------------------------------
    "fi_gl": [
        ExtractionTarget(
            source="SKA1",
            fields=[
                "SAKNR", "KTOPL", "XBILK", "GVTYP", "KTOKS",
                "XLOEV", "ERDAT", "ERNAM", "MCOD1",
            ],
            description="GL account master (chart of accounts)",
        ),
        ExtractionTarget(
            source="SKAT",
            fields=["SAKNR", "KTOPL", "SPRAS", "TXT20", "TXT50"],
            filter="SPRAS = 'EN'",
            description="GL account descriptions (English)",
        ),
        ExtractionTarget(
            source="SKB1",
            fields=[
                "SAKNR", "BUKRS", "MWSKZ", "XOPVW", "MITKZ",
                "WAERS", "XKRES", "FDLEV", "XINTB", "BEGRU",
                "ZUESSION",
            ],
            description="GL account company code data",
        ),
        ExtractionTarget(
            source="T004",
            fields=["KTOPL", "KTPLB"],
            description="Chart of accounts",
            is_config=True,
        ),
        ExtractionTarget(
            source="T003",
            fields=["BLART", "LTEXT"],
            description="Document types",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # MM Purchasing
    # ------------------------------------------------------------------
    "mm_purchasing": [
        ExtractionTarget(
            source="EKKO",
            fields=[
                "EBELN", "BUKRS", "BSTYP", "BSART", "LIFNR", "EKGRP",
                "WAERS", "BEDAT", "KDATB", "KDATE", "LOEKZ", "AEDAT",
            ],
            description="Purchasing document header",
        ),
        ExtractionTarget(
            source="EKPO",
            fields=[
                "EBELN", "EBELP", "MATNR", "WERKS", "LGORT", "MATKL",
                "MENGE", "MEINS", "NETPR", "PEINH", "PSTYP", "KNTTP",
                "LOEKZ", "AEDAT",
            ],
            description="Purchasing document item",
        ),
        ExtractionTarget(
            source="T161",
            fields=["BSART", "BSTYP", "BATXT"],
            description="Purchasing document types",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # Asset Accounting
    # ------------------------------------------------------------------
    "asset_accounting": [
        ExtractionTarget(
            source="ANLA",
            fields=[
                "BUKRS", "ANLN1", "ANLN2", "ANLKL", "TXT50", "TXA50",
                "AKTIV", "DEAKT", "ORD41", "ORD42", "ORD43", "ORD44",
                "ERNAM",
            ],
            description="Asset master general data",
        ),
        ExtractionTarget(
            source="ANLB",
            fields=[
                "BUKRS", "ANLN1", "ANLN2", "AFASL", "NDJAR", "AFABG",
            ],
            description="Asset depreciation areas",
        ),
    ],

    # ------------------------------------------------------------------
    # Plant Maintenance
    # ------------------------------------------------------------------
    "plant_maintenance": [
        ExtractionTarget(
            source="EQUI",
            fields=[
                "EQUNR", "EQTYP", "EQART", "HESSION", "SWERK", "STORT",
                "BRGEW", "GEWEI", "ANSDT", "ERDAT", "ERNAM", "AEDAT",
                "INBDT", "GEWRK",
            ],
            description="Equipment master",
        ),
        ExtractionTarget(
            source="IFLOT",
            fields=[
                "TPLNR", "FLTYP", "IWERK", "STORT", "BESSION",
                "ERDAT", "ERNAM", "AEDAT",
            ],
            description="Functional location master",
        ),
    ],

    # ------------------------------------------------------------------
    # Production Planning
    # ------------------------------------------------------------------
    "production_planning": [
        ExtractionTarget(
            source="PLKOD",
            fields=["PLNNR", "PLNTY", "WERKS", "KTEXT", "STATU", "LOEKZ", "ERNAM", "ERDAT"],
            description="Routing / task list header",
        ),
        ExtractionTarget(
            source="STKO",
            fields=["STLNR", "STLTY", "STLAN", "STLAL", "BMENG", "ERNAM", "ERDAT"],
            description="BOM header",
        ),
        ExtractionTarget(
            source="STPO",
            fields=["STLNR", "STLKN", "IDNRK", "MENGE", "MEINS", "POSTP", "POSNR"],
            description="BOM items",
        ),
        ExtractionTarget(
            source="CRHD",
            fields=["OBJID", "OBJTY", "ARBPL", "WERKS", "VERWE", "ERNAM", "ERDAT"],
            description="Work center header",
        ),
    ],

    # ------------------------------------------------------------------
    # SD Customer Master
    # ------------------------------------------------------------------
    "sd_customer_master": [
        ExtractionTarget(
            source="KNA1",
            fields=[
                "KUNNR", "LAND1", "NAME1", "NAME2", "ORT01", "PSTLZ",
                "REGIO", "SORTL", "STRAS", "ADRNR", "KTOKD", "LOEVM",
                "SPERR", "AUFSD", "ERDAT", "ERNAM",
            ],
            description="Customer general data",
        ),
        ExtractionTarget(
            source="KNVV",
            fields=[
                "KUNNR", "VKORG", "VTWEG", "SPART", "KDGRP", "BZIRK",
                "WAERS", "KZAZU", "VWERK", "INCO1", "ZTERM",
            ],
            description="Customer sales area data",
        ),
    ],

    # ------------------------------------------------------------------
    # SD Sales Orders
    # ------------------------------------------------------------------
    "sd_sales_orders": [
        ExtractionTarget(
            source="VBAK",
            fields=[
                "VBELN", "AUART", "VKORG", "VTWEG", "SPART", "KUNNR",
                "BSTNK", "ERDAT", "ERNAM", "NETWR", "WAERK", "VBTYP",
            ],
            description="Sales document header",
        ),
        ExtractionTarget(
            source="VBAP",
            fields=[
                "VBELN", "POSNR", "MATNR", "WERKS", "LGORT", "KWMENG",
                "VRKME", "NETWR", "WAERK", "PSTYV", "ABGRU",
            ],
            description="Sales document item",
        ),
    ],
}


# ============================================================================
# SuccessFactors extractions
# ============================================================================

SF_EXTRACTIONS: dict[str, list[ExtractionTarget]] = {
    # ------------------------------------------------------------------
    # Employee Central
    # ------------------------------------------------------------------
    "employee_central": [
        ExtractionTarget(
            source="EmpEmployment",
            fields=[
                "personIdExternal", "userId", "startDate", "endDate",
                "employmentStatus", "hireDate", "originalStartDate",
                "seniorityDate", "jobNumber",
            ],
            description="Employment records",
            rename_map={
                "personIdExternal": "PERSON_ID",
                "userId": "USER_ID",
                "startDate": "START_DATE",
                "endDate": "END_DATE",
                "employmentStatus": "EMP_STATUS",
                "hireDate": "HIRE_DATE",
                "originalStartDate": "ORIGINAL_START_DATE",
                "seniorityDate": "SENIORITY_DATE",
                "jobNumber": "JOB_NUMBER",
            },
        ),
        ExtractionTarget(
            source="PerPersonal",
            fields=[
                "personIdExternal", "firstName", "lastName", "middleName",
                "gender", "dateOfBirth", "nationality", "maritalStatus",
            ],
            description="Personal information",
            rename_map={
                "personIdExternal": "PERSON_ID",
                "firstName": "FIRST_NAME",
                "lastName": "LAST_NAME",
                "middleName": "MIDDLE_NAME",
                "gender": "GENDER",
                "dateOfBirth": "DATE_OF_BIRTH",
                "nationality": "NATIONALITY",
                "maritalStatus": "MARITAL_STATUS",
            },
        ),
        ExtractionTarget(
            source="PerEmail",
            fields=["personIdExternal", "emailType", "emailAddress"],
            description="Email addresses",
        ),
        ExtractionTarget(
            source="PerPhone",
            fields=["personIdExternal", "phoneType", "phoneNumber", "countryCode"],
            description="Phone numbers",
        ),
        ExtractionTarget(
            source="PerNationalId",
            fields=["personIdExternal", "cardType", "nationalId", "country"],
            description="National IDs",
        ),
        ExtractionTarget(
            source="EmpCompensation",
            fields=[
                "userId", "startDate", "payGroup", "payGrade",
                "payType", "payrollId",
            ],
            description="Compensation data",
        ),
        # Config targets
        ExtractionTarget(
            source="FOCompany",
            fields=["externalCode", "name", "country", "currency", "status"],
            description="Company picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FODepartment",
            fields=["externalCode", "name", "headOfUnit", "costCenter", "status"],
            description="Department picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FOJobCode",
            fields=["externalCode", "name", "grade", "jobFunction", "status"],
            description="Job code picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FOLocation",
            fields=["externalCode", "name", "addressLine1", "city", "country", "status"],
            description="Location picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FOCostCenter",
            fields=["externalCode", "name", "costcenterManager", "status"],
            description="Cost center picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FOPayGroup",
            fields=["externalCode", "name", "status"],
            description="Pay group picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FOPayGrade",
            fields=["externalCode", "name", "status"],
            description="Pay grade picklist",
            is_config=True,
        ),
        ExtractionTarget(
            source="FOEventReason",
            fields=["externalCode", "name", "event", "status"],
            description="Event reason picklist",
            is_config=True,
        ),
    ],

    # ------------------------------------------------------------------
    # Compensation
    # ------------------------------------------------------------------
    "compensation": [
        ExtractionTarget(
            source="EmpCompensation",
            fields=[
                "userId", "startDate", "payGroup", "payGrade",
                "payType", "payrollId", "eventReason",
            ],
            description="Compensation records",
        ),
        ExtractionTarget(
            source="EmpPayCompRecurring",
            fields=[
                "userId", "startDate", "payComponent", "paycompvalue",
                "currencyCode", "frequency",
            ],
            description="Recurring pay components",
        ),
        ExtractionTarget(
            source="EmpPayCompNonRecurring",
            fields=[
                "userId", "payDate", "payComponent", "paycompvalue",
                "currencyCode",
            ],
            description="Non-recurring pay components",
        ),
    ],

    # ------------------------------------------------------------------
    # Benefits
    # ------------------------------------------------------------------
    "benefits": [
        ExtractionTarget(
            source="BenefitEnrollment",
            fields=[
                "userId", "benefitPlanId", "enrollmentDate", "coverageLevel",
                "dependentId", "status",
            ],
            description="Benefit enrollments",
        ),
    ],

    # ------------------------------------------------------------------
    # Payroll Integration
    # ------------------------------------------------------------------
    "payroll_integration": [
        ExtractionTarget(
            source="EmpPayrollRunResults",
            fields=[
                "userId", "payPeriod", "payDate", "grossPay",
                "netPay", "currency", "status",
            ],
            description="Payroll run results",
        ),
    ],

    # ------------------------------------------------------------------
    # Performance & Goals
    # ------------------------------------------------------------------
    "performance_goals": [
        ExtractionTarget(
            source="GoalPlanTemplate",
            fields=["goalPlanId", "goalPlanName", "dueDate", "category", "status"],
            description="Goal plan templates",
            is_config=True,
        ),
        ExtractionTarget(
            source="Goal_1",
            fields=[
                "userId", "goalId", "name", "metric", "start",
                "due", "status", "weight",
            ],
            description="Individual goals",
        ),
    ],

    # ------------------------------------------------------------------
    # Succession Planning
    # ------------------------------------------------------------------
    "succession_planning": [
        ExtractionTarget(
            source="SuccessionNominee",
            fields=[
                "nomineeId", "positionId", "readinessRating",
                "rankOrder", "status", "nominatorId",
            ],
            description="Succession nominees",
        ),
    ],

    # ------------------------------------------------------------------
    # Recruiting & Onboarding
    # ------------------------------------------------------------------
    "recruiting_onboarding": [
        ExtractionTarget(
            source="JobRequisition",
            fields=[
                "requisitionId", "jobCode", "department", "location",
                "hiringManager", "status", "createdDate",
            ],
            description="Job requisitions",
        ),
        ExtractionTarget(
            source="JobApplication",
            fields=[
                "applicationId", "candidateId", "requisitionId",
                "status", "source", "appliedDate", "lastModifiedDate",
            ],
            description="Job applications",
        ),
    ],

    # ------------------------------------------------------------------
    # Learning Management
    # ------------------------------------------------------------------
    "learning_management": [
        ExtractionTarget(
            source="LearningHistoryV1",
            fields=[
                "userId", "courseId", "courseName", "completionDate",
                "status", "score", "creditHours",
            ],
            description="Learning history",
        ),
    ],

    # ------------------------------------------------------------------
    # Time & Attendance
    # ------------------------------------------------------------------
    "time_attendance": [
        ExtractionTarget(
            source="EmployeeTime",
            fields=[
                "userId", "timeType", "startDate", "endDate",
                "quantityInDays", "quantityInHours", "approvalStatus",
            ],
            description="Employee time records",
        ),
        ExtractionTarget(
            source="TimeType",
            fields=["externalCode", "name", "category", "absenceClass", "status"],
            description="Time type configuration",
            is_config=True,
        ),
        ExtractionTarget(
            source="TimeAccountType",
            fields=["externalCode", "name", "timeAccountType", "unit", "status"],
            description="Time account type configuration",
            is_config=True,
        ),
    ],
}


# ============================================================================
# Concur extractions
# ============================================================================

CONCUR_EXTRACTIONS: dict[str, list[ExtractionTarget]] = {
    "concur_expense": [
        ExtractionTarget(
            source="/api/v3.0/expense/reports",
            fields=[
                "reportId", "reportName", "ownerLoginId", "ownerName",
                "submitDate", "approvalStatus", "paymentStatus", "total",
                "currencyCode", "policyId",
            ],
            description="Expense reports",
        ),
        ExtractionTarget(
            source="/api/v3.0/expense/entries",
            fields=[
                "reportId", "entryId", "expenseTypeCode", "expenseTypeName",
                "transactionDate", "transactionAmount", "transactionCurrencyCode",
                "vendorDescription", "locationName", "paymentTypeId",
            ],
            description="Expense entries",
        ),
        ExtractionTarget(
            source="/api/v3.0/expense/expensegroupconfigurations",
            fields=["id", "name", "policyId", "isDefault"],
            description="Expense group configurations",
            is_config=True,
        ),
    ],

    "concur_travel": [
        ExtractionTarget(
            source="/api/v3.0/insights/latestbookings",
            fields=[
                "recordLocator", "bookingOwner", "travelType",
                "startDate", "endDate", "vendorName", "totalCost",
                "currencyCode",
            ],
            description="Travel bookings",
        ),
    ],

    "concur_users": [
        ExtractionTarget(
            source="/api/v3.0/common/users",
            fields=[
                "loginId", "firstName", "lastName", "emailAddress",
                "active", "countryCode", "employeeId",
            ],
            description="Concur user profiles",
        ),
    ],
}


# ============================================================================
# Ariba extractions
# ============================================================================

ARIBA_EXTRACTIONS: dict[str, list[ExtractionTarget]] = {
    "ariba_supplier": [
        ExtractionTarget(
            source="/api/suppliers",
            fields=[
                "supplierId", "supplierName", "country", "region",
                "qualificationStatus", "registrationDate", "category",
                "riskScore", "preferredStatus",
            ],
            description="Ariba supplier master",
        ),
    ],

    "ariba_contracts": [
        ExtractionTarget(
            source="/api/contracts",
            fields=[
                "contractId", "title", "supplierId", "status",
                "effectiveDate", "expirationDate", "contractValue",
                "currencyCode", "owner",
            ],
            description="Ariba contracts",
        ),
    ],

    "ariba_procurement": [
        ExtractionTarget(
            source="/api/procurement/requisitions",
            fields=[
                "requisitionId", "title", "requestor", "status",
                "createdDate", "totalAmount", "currencyCode",
                "approvalStatus", "supplierId",
            ],
            description="Procurement requisitions",
        ),
    ],
}


# ============================================================================
# eWMS / extended warehouse extractions
# ============================================================================

EWMS_EXTRACTIONS: dict[str, list[ExtractionTarget]] = {
    "ewms_stock": [
        ExtractionTarget(
            source="/api/v1/stock",
            fields=[
                "materialNumber", "warehouse", "storageType", "storageBin",
                "handlingUnit", "batchNumber", "quantity", "uom",
                "stockCategory", "lastCountDate",
            ],
            description="Extended warehouse stock",
        ),
    ],

    "ewms_transfer_orders": [
        ExtractionTarget(
            source="/api/v1/transferorders",
            fields=[
                "transferOrderNumber", "warehouse", "sourceStorageType",
                "sourceBin", "destStorageType", "destBin", "materialNumber",
                "quantity", "status", "createdDate",
            ],
            description="Transfer orders",
        ),
    ],

    "batch_management": [
        ExtractionTarget(
            source="MCH1",
            fields=[
                "MATNR", "CHARG", "WERKS", "HSDAT", "VFDAT",
                "ZUESSION", "LIESSION", "ERNAM",
            ],
            description="Batch master",
        ),
    ],

    "wm_interface": [
        ExtractionTarget(
            source="LTBK",
            fields=[
                "LGNUM", "TBNUM", "TBPOS", "MATNR", "WERKS",
                "LGORT", "ANFME", "ALTME",
            ],
            description="WM transfer requirement header",
        ),
    ],

    "grc_compliance": [
        ExtractionTarget(
            source="/api/v1/grc/risks",
            fields=[
                "riskId", "riskName", "riskLevel", "controlId",
                "businessProcess", "owner", "status", "lastAssessmentDate",
            ],
            description="GRC risk items",
        ),
    ],

    "fleet_management": [
        ExtractionTarget(
            source="VLCVEHICLE",
            fields=[
                "VGUID", "LICENSENO", "VEHICLETYPE", "MAKE",
                "MODEL", "YEAR", "STATUS", "ASSIGNEDDRIVER",
            ],
            description="Fleet vehicle master",
        ),
    ],

    "transport_management": [
        ExtractionTarget(
            source="/api/v1/tm/freightorders",
            fields=[
                "freightOrderId", "carrier", "origin", "destination",
                "shipmentDate", "deliveryDate", "status", "totalWeight",
                "totalVolume",
            ],
            description="Freight orders",
        ),
    ],

    "mdg_master_data": [
        ExtractionTarget(
            source="MDGMATERIAL",
            fields=[
                "ENTITY_ID", "MATNR", "CHANGE_REQUEST", "CR_STATUS",
                "CREATED_BY", "CREATED_AT", "CHANGED_BY", "CHANGED_AT",
            ],
            description="MDG change requests for materials",
        ),
    ],
}


# ============================================================================
# Master mapping: system_type -> extraction dict
# ============================================================================

SYSTEM_EXTRACTIONS: dict[str, dict[str, list[ExtractionTarget]]] = {
    "ecc": ECC_EXTRACTIONS,
    "s4hana_onprem": ECC_EXTRACTIONS,
    "s4hana_cloud": ECC_EXTRACTIONS,
    "successfactors": SF_EXTRACTIONS,
    "concur": CONCUR_EXTRACTIONS,
    "ariba": ARIBA_EXTRACTIONS,
    "ewms": EWMS_EXTRACTIONS,
}


# ============================================================================
# Helper functions
# ============================================================================

def get_extraction_targets(
    system_type: str,
    module: str,
    include_config: bool = True,
) -> list[ExtractionTarget]:
    """Return extraction targets for a given system type and module.

    Args:
        system_type: One of ecc, s4hana_onprem, s4hana_cloud, successfactors,
                     concur, ariba, ewms.
        module:      Module identifier, e.g. ``"accounts_payable"``.
        include_config: If False, config-only targets (``is_config=True``)
                        are excluded from the result.

    Returns:
        List of :class:`ExtractionTarget` instances.  Empty list if the
        system_type or module is unknown.
    """
    extractions = SYSTEM_EXTRACTIONS.get(system_type, {})
    targets = extractions.get(module, [])
    if not include_config:
        targets = [t for t in targets if not t.is_config]
    return targets


def get_available_modules(system_type: str) -> list[str]:
    """Return sorted list of module identifiers available for a system type.

    Args:
        system_type: One of ecc, s4hana_onprem, s4hana_cloud, successfactors,
                     concur, ariba, ewms.

    Returns:
        Sorted list of module name strings.  Empty list if unknown system type.
    """
    extractions = SYSTEM_EXTRACTIONS.get(system_type, {})
    return sorted(extractions.keys())


def get_table_names(
    system_type: str,
    module: str,
    config_only: bool = False,
) -> list[str]:
    """Return table/entity/endpoint names for a system type and module.

    Args:
        system_type: One of ecc, s4hana_onprem, s4hana_cloud, successfactors,
                     concur, ariba, ewms.
        module:      Module identifier.
        config_only: If True, only return sources marked ``is_config=True``.

    Returns:
        List of source name strings (table names, entity sets, or endpoint
        paths) in definition order.
    """
    extractions = SYSTEM_EXTRACTIONS.get(system_type, {})
    targets = extractions.get(module, [])
    if config_only:
        return [t.source for t in targets if t.is_config]
    return [t.source for t in targets]
