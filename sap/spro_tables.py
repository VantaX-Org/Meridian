"""Registry of SAP customising (SPRO) tables per module.

Each entry defines:
  - table:           SAP table name or OData entity / REST endpoint
  - fields:          list of key fields to extract
  - description:     human-readable purpose
  - config_context:  how this config governs transactional behaviour
  - governs_fields:  master-data fields controlled by this config table
  - impacts_features: downstream features affected by misconfiguration
  - connector:       (optional) system connector type
  - read_method:     (optional) how to read the config (rfc_read_table | odata_entity | rest_get)
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Type alias
# ---------------------------------------------------------------------------
SPROEntry = dict[str, Any]

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

SPRO_REGISTRY: dict[str, list[SPROEntry]] = {
    # =====================================================================
    # ECC MODULES
    # =====================================================================

    # -----------------------------------------------------------------
    # Accounts Payable
    # -----------------------------------------------------------------
    "accounts_payable": [
        {
            "table": "T077Y",
            "fields": ["KTOKK", "TXT30"],
            "description": "Vendor account groups",
            "config_context": (
                "Defines valid vendor account groups that control number range assignment, "
                "partner determination, and field status for vendor master records. Each vendor "
                "must be assigned to exactly one account group at creation time."
            ),
            "governs_fields": ["LFA1.KTOKK"],
            "impacts_features": [
                "vendor master creation",
                "number range assignment",
                "field status control",
                "partner determination",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T001",
            "fields": ["BUKRS", "BUTXT", "WAERS", "LAND1", "KTOPL"],
            "description": "Company codes",
            "config_context": (
                "Defines the organisational units for which independent financial statements "
                "are created. Company code determines currency, chart of accounts, fiscal year "
                "variant, and country-specific settings for all accounting documents."
            ),
            "governs_fields": ["LFB1.BUKRS"],
            "impacts_features": [
                "vendor company code data",
                "payment processing",
                "withholding tax",
                "dunning",
                "correspondence",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T042Z",
            "fields": ["ZLSCH", "TEXT1"],
            "description": "Payment methods per country",
            "config_context": (
                "Defines available payment methods (check, bank transfer, ACH, etc.) per "
                "country and company code. Determines how the payment program settles open "
                "vendor invoices and which bank details are required."
            ),
            "governs_fields": ["LFB1.ZWELS"],
            "impacts_features": [
                "automatic payment program",
                "payment medium creation",
                "bank determination",
                "payment advice notes",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T052",
            "fields": ["ZTERM", "ZTAGG", "ZTAG1", "ZTAG2", "ZTAG3", "TXT30"],
            "description": "Payment terms",
            "config_context": (
                "Defines baseline dates, discount percentages, and net payment periods. "
                "Payment terms drive cash-discount calculation, due date determination, "
                "and the payment program's selection of open items."
            ),
            "governs_fields": ["LFB1.ZTERM"],
            "impacts_features": [
                "cash discount calculation",
                "due date determination",
                "payment program selection",
                "aging analysis",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "TNRO",
            "fields": ["OBJECT", "DOMLEN", "PERCENTAGE"],
            "description": "Number range objects",
            "config_context": (
                "Defines number range intervals for vendor master records. Controls whether "
                "vendor numbers are assigned internally (system-generated) or externally "
                "(user-specified), and tracks capacity utilisation."
            ),
            "governs_fields": ["LFA1.LIFNR"],
            "impacts_features": [
                "vendor number assignment",
                "number range buffering",
                "capacity monitoring",
                "duplicate prevention",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # Accounts Receivable
    # -----------------------------------------------------------------
    "accounts_receivable": [
        {
            "table": "T077D",
            "fields": ["KTOKD", "TXT30"],
            "description": "Customer account groups",
            "config_context": (
                "Defines valid customer account groups controlling number range assignment, "
                "partner determination, and field status for customer master records. "
                "Determines which fields are required, optional, or suppressed during creation."
            ),
            "governs_fields": ["KNA1.KTOKD"],
            "impacts_features": [
                "customer master creation",
                "number range assignment",
                "field status control",
                "partner determination",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T052",
            "fields": ["ZTERM", "ZTAGG", "ZTAG1", "ZTAG2", "ZTAG3", "TXT30"],
            "description": "Payment terms (shared with AP)",
            "config_context": (
                "Defines baseline dates, discount percentages, and net payment periods for "
                "customer invoices. Shared configuration with Accounts Payable. Drives due "
                "date calculation and dunning schedule determination."
            ),
            "governs_fields": ["KNB1.ZTERM"],
            "impacts_features": [
                "invoice due date calculation",
                "cash discount management",
                "dunning schedule",
                "credit management",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T040",
            "fields": ["MAHNS", "MAHTX"],
            "description": "Dunning procedures",
            "config_context": (
                "Defines dunning levels, intervals, minimum amounts, and dunning texts. "
                "Controls the escalation path for overdue customer receivables from "
                "reminder through to legal collection."
            ),
            "governs_fields": ["KNB1.MAHNS"],
            "impacts_features": [
                "dunning run execution",
                "dunning level escalation",
                "dunning notice generation",
                "interest calculation",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # Material Master
    # -----------------------------------------------------------------
    "material_master": [
        {
            "table": "T134",
            "fields": ["MTART", "MTBEZ"],
            "description": "Material types",
            "config_context": (
                "Defines material types that control procurement type (internal/external), "
                "valuation category, account category reference, and which organisational "
                "levels are relevant. Fundamental to material master data structure."
            ),
            "governs_fields": ["MARA.MTART"],
            "impacts_features": [
                "material master creation",
                "procurement type determination",
                "inventory valuation",
                "account assignment",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T023",
            "fields": ["MATKL", "WGBEZ"],
            "description": "Material groups",
            "config_context": (
                "Defines material groups for classifying materials by commodity or product "
                "category. Used in purchasing for source determination, reporting, and "
                "account assignment in materials management."
            ),
            "governs_fields": ["MARA.MATKL"],
            "impacts_features": [
                "material classification",
                "source determination",
                "purchasing reporting",
                "account assignment",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T006",
            "fields": ["MSEHI", "MSEHL"],
            "description": "Units of measure",
            "config_context": (
                "Defines base and alternative units of measure with conversion factors. "
                "Controls how quantities are stored, displayed, and converted across "
                "purchasing, inventory, and sales processes."
            ),
            "governs_fields": ["MARA.MEINS"],
            "impacts_features": [
                "quantity conversion",
                "purchasing unit handling",
                "inventory management",
                "sales unit determination",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T001W",
            "fields": ["WERKS", "NAME1", "BUKRS", "LAND1"],
            "description": "Plants",
            "config_context": (
                "Defines manufacturing plants and distribution centres within the "
                "organisational structure. Plants are the central organisational unit for "
                "materials management, production planning, and inventory valuation."
            ),
            "governs_fields": ["MARC.WERKS"],
            "impacts_features": [
                "plant-level material data",
                "MRP configuration",
                "inventory valuation",
                "production planning",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # Business Partner
    # -----------------------------------------------------------------
    "business_partner": [
        {
            "table": "TB003",
            "fields": ["BU_GROUP", "TXT30"],
            "description": "BP grouping",
            "config_context": (
                "Defines business partner groupings that control number range assignment, "
                "field status, and allowed partner roles. Groupings determine the "
                "classification of business partners (person, organisation, group)."
            ),
            "governs_fields": ["BUT000.BU_GROUP"],
            "impacts_features": [
                "BP master creation",
                "number range assignment",
                "role assignment",
                "field status control",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "TBZ9",
            "fields": ["RLTYP", "RLTXT"],
            "description": "BP role categories",
            "config_context": (
                "Defines the categories of roles that can be assigned to business partners "
                "(e.g. customer, vendor, contact person, employee). Role categories "
                "determine which views and relationship types are available."
            ),
            "governs_fields": ["BUT100.RLTYP"],
            "impacts_features": [
                "BP role assignment",
                "relationship management",
                "view selection",
                "integration with FI-AR/FI-AP",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # FI General Ledger
    # -----------------------------------------------------------------
    "fi_gl": [
        {
            "table": "T004",
            "fields": ["KTOPL", "KTPLT"],
            "description": "Charts of accounts",
            "config_context": (
                "Defines charts of accounts that provide the framework for G/L account "
                "master data. Each company code is assigned to exactly one chart of accounts "
                "which determines the available G/L account numbers and descriptions."
            ),
            "governs_fields": ["SKA1.KTOPL"],
            "impacts_features": [
                "G/L account master creation",
                "account number structure",
                "financial reporting",
                "intercompany accounting",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T003",
            "fields": ["BLART", "LTEXT"],
            "description": "Document types",
            "config_context": (
                "Defines FI document types controlling number range assignment, account "
                "types allowed (customer, vendor, G/L, assets), and posting keys. "
                "Document types classify accounting documents and determine posting behaviour."
            ),
            "governs_fields": ["BKPF.BLART"],
            "impacts_features": [
                "document posting",
                "number range assignment",
                "account type control",
                "reversal handling",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # MM Purchasing
    # -----------------------------------------------------------------
    "mm_purchasing": [
        {
            "table": "T161",
            "fields": ["BSART", "BSTYP", "BATXT"],
            "description": "Purchasing document types",
            "config_context": (
                "Defines purchasing document types (standard PO, framework order, scheduling "
                "agreement, contract, etc.) controlling number ranges, field selection, "
                "item categories, and follow-on document determination."
            ),
            "governs_fields": ["EKKO.BSART"],
            "impacts_features": [
                "purchase order creation",
                "document type determination",
                "item category assignment",
                "release strategy",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T024",
            "fields": ["EKGRP", "EKNAM"],
            "description": "Purchasing groups",
            "config_context": (
                "Defines purchasing groups responsible for procurement activities. "
                "Purchasing groups are assigned to purchase orders and control buyer "
                "assignment, reporting, and release strategy determination."
            ),
            "governs_fields": ["EKKO.EKGRP"],
            "impacts_features": [
                "buyer assignment",
                "purchase order responsibility",
                "purchasing reporting",
                "release strategy determination",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # =====================================================================
    # SUCCESSFACTORS MODULES
    # =====================================================================

    # -----------------------------------------------------------------
    # Employee Central
    # -----------------------------------------------------------------
    "employee_central": [
        {
            "table": "FOCompany",
            "fields": ["externalCode", "name", "country", "currency", "status"],
            "description": "Foundation object: company",
            "config_context": (
                "Defines legal entities within SuccessFactors. Company is the top-level "
                "organisational unit that drives payroll, benefits eligibility, and "
                "country-specific compliance rules."
            ),
            "governs_fields": ["EmpJob.company"],
            "impacts_features": [
                "employee assignment",
                "payroll processing",
                "benefits eligibility",
                "compliance rules",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FODepartment",
            "fields": ["externalCode", "name", "parent", "headOfDepartment", "status"],
            "description": "Foundation object: department",
            "config_context": (
                "Defines departmental hierarchy for organisational reporting, approval "
                "workflows, and cost centre assignment. Departments cascade permissions "
                "and determine manager relationships."
            ),
            "governs_fields": ["EmpJob.department"],
            "impacts_features": [
                "organisational hierarchy",
                "approval workflows",
                "cost centre assignment",
                "manager determination",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FODivision",
            "fields": ["externalCode", "name", "status"],
            "description": "Foundation object: division",
            "config_context": (
                "Defines business divisions for segmenting the workforce by business line. "
                "Divisions drive reporting structures, compensation planning groups, "
                "and talent pool segmentation."
            ),
            "governs_fields": ["EmpJob.division"],
            "impacts_features": [
                "business line segmentation",
                "compensation planning",
                "talent pool assignment",
                "workforce analytics",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FOJobCode",
            "fields": ["externalCode", "name", "grade", "jobFunction", "jobFamily", "status"],
            "description": "Foundation object: job code/classification",
            "config_context": (
                "Defines job codes that classify positions for compensation benchmarking, "
                "succession planning, and regulatory reporting. Job codes link to pay "
                "grades and drive eligibility rules."
            ),
            "governs_fields": ["EmpJob.jobCode"],
            "impacts_features": [
                "position classification",
                "compensation benchmarking",
                "succession planning",
                "regulatory reporting",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FOLocation",
            "fields": ["externalCode", "name", "addressLine1", "city", "country", "status"],
            "description": "Foundation object: location",
            "config_context": (
                "Defines physical work locations for time zone assignment, tax jurisdiction "
                "determination, and health & safety compliance. Locations drive locale-specific "
                "rules and benefit plan eligibility."
            ),
            "governs_fields": ["EmpJob.location"],
            "impacts_features": [
                "time zone assignment",
                "tax jurisdiction",
                "health and safety compliance",
                "benefit plan eligibility",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FOCostCenter",
            "fields": ["externalCode", "name", "costcenterManager", "status"],
            "description": "Foundation object: cost centre",
            "config_context": (
                "Defines cost centres for financial allocation of employee costs. "
                "Cost centres link SF organisational assignments to ERP controlling "
                "and drive budget allocation and approval hierarchies."
            ),
            "governs_fields": ["EmpJob.costCenter"],
            "impacts_features": [
                "financial allocation",
                "budget management",
                "approval hierarchies",
                "ERP integration",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FOPayGrade",
            "fields": ["externalCode", "name", "payGradeLevel", "status"],
            "description": "Foundation object: pay grade",
            "config_context": (
                "Defines pay grades that establish salary ranges and compensation bands. "
                "Pay grades drive compa-ratio calculation, promotion eligibility, and "
                "compensation review guidelines."
            ),
            "governs_fields": ["EmpJob.payGrade"],
            "impacts_features": [
                "salary range determination",
                "compa-ratio calculation",
                "promotion eligibility",
                "compensation guidelines",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FOPayGroup",
            "fields": ["externalCode", "name", "payFrequency", "status"],
            "description": "Foundation object: pay group",
            "config_context": (
                "Defines pay groups that determine payroll processing frequency and rules. "
                "Pay groups control which payroll run an employee is included in and "
                "drive off-cycle payment eligibility."
            ),
            "governs_fields": ["EmpJob.payGroup"],
            "impacts_features": [
                "payroll frequency",
                "payroll run assignment",
                "off-cycle payments",
                "pay date calculation",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "FOEventReason",
            "fields": ["externalCode", "name", "event", "impliesTermination", "status"],
            "description": "Foundation object: event reason",
            "config_context": (
                "Defines reasons for employment events (hire, termination, transfer, "
                "promotion, etc.). Event reasons drive workflow routing, compliance "
                "reporting, and benefit/compensation eligibility changes."
            ),
            "governs_fields": ["EmpJob.eventReason"],
            "impacts_features": [
                "employment event classification",
                "workflow routing",
                "compliance reporting",
                "eligibility rule evaluation",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "Picklist",
            "fields": ["picklistId", "picklistName", "status"],
            "description": "Picklist definitions",
            "config_context": (
                "Defines picklists (dropdown value sets) used across all Employee Central "
                "fields. Picklists enforce data consistency by restricting field values to "
                "predefined options. Changes propagate to all referencing fields."
            ),
            "governs_fields": ["EmpJob.*_picklist", "EmpPersonal.*_picklist"],
            "impacts_features": [
                "field value validation",
                "data consistency enforcement",
                "reporting standardisation",
                "integration mapping",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "PicklistLabel",
            "fields": ["picklistId", "optionId", "label", "locale", "status"],
            "description": "Picklist option labels (locale-specific)",
            "config_context": (
                "Defines localised labels for picklist options across supported languages. "
                "Ensures consistent display of field values in multi-language deployments "
                "and drives locale-specific reporting."
            ),
            "governs_fields": ["Picklist.options"],
            "impacts_features": [
                "multi-language display",
                "locale-specific reporting",
                "user interface localisation",
                "data export labelling",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "WorkflowConfig",
            "fields": ["ruleId", "ruleName", "ruleType", "baseObject", "status"],
            "description": "Business rules / workflow configuration (RuleHeader entity)",
            "config_context": (
                "Defines business rules that drive workflow routing, field validation, "
                "and auto-population logic. Rules are the backbone of Employee Central "
                "process automation and determine approval chains."
            ),
            "governs_fields": ["EmpJob.workflow", "EmpPersonal.workflow"],
            "impacts_features": [
                "approval chain routing",
                "field validation rules",
                "auto-population logic",
                "process automation",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "DataModelConfig",
            "fields": ["objectDefinitionId", "objectName", "objectType", "status"],
            "description": "MDF object definitions (MDFObjectDefinition entity)",
            "config_context": (
                "Defines the metadata framework (MDF) object model — custom objects, "
                "fields, associations, and business rules. The data model configuration "
                "determines which entities exist and how they relate."
            ),
            "governs_fields": ["MDFObject.*"],
            "impacts_features": [
                "custom object structure",
                "field definitions",
                "association mapping",
                "extension framework",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "PermissionGroup",
            "fields": ["groupId", "groupName", "groupType", "status"],
            "description": "Role-based permission groups (RBPPermission entity)",
            "config_context": (
                "Defines permission groups for role-based access control. Permission "
                "groups determine which users can view, edit, or approve data across "
                "all Employee Central modules and drive data isolation."
            ),
            "governs_fields": ["RBPRule.permissionGroup"],
            "impacts_features": [
                "data access control",
                "field-level permissions",
                "approval authority",
                "data isolation",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
    ],

    # -----------------------------------------------------------------
    # Compensation
    # -----------------------------------------------------------------
    "compensation": [
        {
            "table": "FOPayComponentGroup",
            "fields": ["externalCode", "name", "currency", "frequency", "status"],
            "description": "Pay component groups",
            "config_context": (
                "Defines pay component groups that bundle salary elements (base pay, "
                "bonus, allowances) for compensation planning. Groups drive eligibility "
                "rules, budget allocation, and compensation statement layout."
            ),
            "governs_fields": ["EmpCompensation.payComponentGroup"],
            "impacts_features": [
                "compensation planning",
                "pay component eligibility",
                "budget allocation",
                "compensation statements",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
    ],

    # -----------------------------------------------------------------
    # Learning Management
    # -----------------------------------------------------------------
    "learning_management": [
        {
            "table": "LMSCatalogConfig",
            "fields": ["catalogId", "catalogName", "catalogType", "status"],
            "description": "Learning catalog configuration (LearningCatalogs entity)",
            "config_context": (
                "Defines learning catalogs that organise training content into browsable "
                "categories. Catalogs control content visibility, assignment rules, and "
                "drive compliance training tracking."
            ),
            "governs_fields": ["LearningItem.catalog"],
            "impacts_features": [
                "training content organisation",
                "catalog-based assignment rules",
                "compliance training tracking",
                "learning path structure",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
    ],

    # -----------------------------------------------------------------
    # Time & Attendance
    # -----------------------------------------------------------------
    "time_attendance": [
        {
            "table": "TimeTypeConfig",
            "fields": ["externalCode", "externalName", "absenceClass", "accrualRecalculation", "status"],
            "description": "Time type configuration (TimeType entity)",
            "config_context": (
                "Defines absence and attendance time types (vacation, sick leave, overtime, "
                "etc.) with accrual rules, deduction settings, and workflow requirements. "
                "Time types control how employees record and request time off."
            ),
            "governs_fields": ["EmployeeTime.timeType"],
            "impacts_features": [
                "absence recording",
                "accrual calculation",
                "time-off workflow",
                "payroll integration",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "TimeAccountTypeConfig",
            "fields": ["externalCode", "externalName", "accountType", "accrualFrequency", "status"],
            "description": "Time account type configuration (TimeAccountType entity)",
            "config_context": (
                "Defines time account types that track balances for different leave "
                "categories. Controls accrual frequency, carryover rules, maximum "
                "balances, and payout-on-termination settings."
            ),
            "governs_fields": ["TimeAccount.timeAccountType"],
            "impacts_features": [
                "leave balance tracking",
                "accrual frequency",
                "carryover rules",
                "termination payout",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "HolidayCalendar",
            "fields": ["externalCode", "name", "country", "status"],
            "description": "Holiday calendar configuration",
            "config_context": (
                "Defines public holiday calendars by country/region. Holiday calendars "
                "determine non-working days for work schedule generation, absence "
                "entitlement calculation, and time evaluation."
            ),
            "governs_fields": ["WorkSchedule.holidayCalendar"],
            "impacts_features": [
                "work schedule generation",
                "absence entitlement calculation",
                "time evaluation",
                "payroll calendar",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
    ],

    # -----------------------------------------------------------------
    # Recruiting & Onboarding
    # -----------------------------------------------------------------
    "recruiting_onboarding": [
        {
            "table": "RecruitingTemplate",
            "fields": ["templateId", "templateName", "templateType", "status"],
            "description": "Job requisition templates (JobRequisitionTemplate entity)",
            "config_context": (
                "Defines job requisition templates that standardise the hiring process. "
                "Templates control which fields are required, approval workflows, "
                "and posting channel configurations."
            ),
            "governs_fields": ["JobRequisition.template"],
            "impacts_features": [
                "requisition creation",
                "hiring workflow",
                "posting channel selection",
                "approval routing",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
        {
            "table": "OnboardingProcessConfig",
            "fields": ["processId", "processName", "processType", "status"],
            "description": "Onboarding process configuration (ONB2Process entity)",
            "config_context": (
                "Defines onboarding process templates that orchestrate new hire activities. "
                "Controls task sequences, responsible parties, deadlines, and integration "
                "points with Employee Central and external systems."
            ),
            "governs_fields": ["ONB2Process.processConfig"],
            "impacts_features": [
                "onboarding task orchestration",
                "new hire activity sequencing",
                "compliance document collection",
                "system provisioning triggers",
            ],
            "connector": "successfactors",
            "read_method": "odata_entity",
        },
    ],

    # =====================================================================
    # CONCUR MODULES
    # =====================================================================

    # -----------------------------------------------------------------
    # Concur Expense
    # -----------------------------------------------------------------
    "concur_expense": [
        {
            "table": "ExpenseType",
            "fields": ["expenseTypeId", "name", "code", "isActive"],
            "description": "Expense type definitions",
            "config_context": (
                "Defines expense types (airfare, meals, lodging, mileage, etc.) that "
                "categorise spend for policy enforcement and G/L account mapping. Expense "
                "types drive receipt requirements and approval thresholds."
            ),
            "governs_fields": ["ExpenseEntry.expenseType"],
            "impacts_features": [
                "expense categorisation",
                "receipt requirements",
                "policy rule application",
                "G/L account mapping",
            ],
            "connector": "concur",
            "read_method": "rest_get",
        },
        {
            "table": "ExpensePolicy",
            "fields": ["policyId", "policyName", "isActive", "currencyCode"],
            "description": "Expense policies",
            "config_context": (
                "Defines expense policies that group rules for spending limits, receipt "
                "thresholds, per-diem rates, and allowed expense types. Policies are "
                "assigned to employee groups and drive compliance enforcement."
            ),
            "governs_fields": ["ExpenseReport.policy"],
            "impacts_features": [
                "spending limit enforcement",
                "receipt threshold rules",
                "per-diem rate application",
                "compliance auditing",
            ],
            "connector": "concur",
            "read_method": "rest_get",
        },
        {
            "table": "ApprovalWorkflow",
            "fields": ["workflowId", "workflowName", "stepCount", "isActive"],
            "description": "Expense approval workflows",
            "config_context": (
                "Defines multi-step approval workflows for expense reports. Controls "
                "approval routing based on amount thresholds, cost centres, and "
                "expense types. Determines escalation paths and auto-approval rules."
            ),
            "governs_fields": ["ExpenseReport.approvalWorkflow"],
            "impacts_features": [
                "approval routing",
                "amount threshold escalation",
                "auto-approval rules",
                "delegation handling",
            ],
            "connector": "concur",
            "read_method": "rest_get",
        },
        {
            "table": "AuditRule",
            "fields": ["ruleId", "ruleName", "ruleType", "severity", "isActive"],
            "description": "Expense audit rules",
            "config_context": (
                "Defines automated audit rules that flag expense entries for review. "
                "Rules detect policy violations, duplicate submissions, split receipts, "
                "and unusual spending patterns before payment processing."
            ),
            "governs_fields": ["ExpenseEntry.auditFlags"],
            "impacts_features": [
                "fraud detection",
                "duplicate submission checks",
                "split receipt detection",
                "policy violation flagging",
            ],
            "connector": "concur",
            "read_method": "rest_get",
        },
        {
            "table": "GLAccountMapping",
            "fields": ["mappingId", "expenseTypeCode", "glAccountCode", "costObjectType"],
            "description": "G/L account mappings for expense posting",
            "config_context": (
                "Maps expense types to general ledger accounts for financial posting. "
                "Controls how expense reimbursements are reflected in the ERP general "
                "ledger and determines cost object assignment."
            ),
            "governs_fields": ["ExpenseEntry.glAccount"],
            "impacts_features": [
                "financial posting",
                "cost object assignment",
                "ERP integration",
                "financial reconciliation",
            ],
            "connector": "concur",
            "read_method": "rest_get",
        },
        {
            "table": "PaymentType",
            "fields": ["paymentTypeId", "paymentTypeName", "isPersonalCard", "isActive"],
            "description": "Payment type definitions",
            "config_context": (
                "Defines payment types (corporate card, personal card, cash, etc.) "
                "that determine reimbursement handling and card programme integration. "
                "Payment types drive reconciliation rules and liability assignment."
            ),
            "governs_fields": ["ExpenseEntry.paymentType"],
            "impacts_features": [
                "reimbursement handling",
                "card programme integration",
                "liability assignment",
                "reconciliation rules",
            ],
            "connector": "concur",
            "read_method": "rest_get",
        },
    ],

    # =====================================================================
    # ARIBA MODULES
    # =====================================================================

    # -----------------------------------------------------------------
    # Ariba Supplier Management
    # -----------------------------------------------------------------
    "ariba_supplier": [
        {
            "table": "CommodityCode",
            "fields": ["commodityId", "commodityName", "domain", "isActive"],
            "description": "Commodity code definitions",
            "config_context": (
                "Defines commodity codes (UNSPSC or custom) used to classify procurement "
                "categories. Commodity codes drive sourcing strategies, preferred supplier "
                "lists, and spend analytics categorisation."
            ),
            "governs_fields": ["Supplier.commodityCode"],
            "impacts_features": [
                "procurement categorisation",
                "sourcing strategy assignment",
                "preferred supplier matching",
                "spend analytics",
            ],
            "connector": "ariba",
            "read_method": "rest_get",
        },
        {
            "table": "SupplierQualification",
            "fields": ["qualificationId", "qualificationName", "qualificationType", "isActive"],
            "description": "Supplier qualification criteria",
            "config_context": (
                "Defines qualification questionnaires and criteria for supplier onboarding "
                "and periodic re-qualification. Controls which certifications, financial "
                "checks, and compliance documents are required."
            ),
            "governs_fields": ["Supplier.qualificationStatus"],
            "impacts_features": [
                "supplier onboarding",
                "re-qualification scheduling",
                "compliance document collection",
                "risk assessment",
            ],
            "connector": "ariba",
            "read_method": "rest_get",
        },
        {
            "table": "ApprovalFlow",
            "fields": ["flowId", "flowName", "flowType", "isActive"],
            "description": "Supplier approval workflows",
            "config_context": (
                "Defines approval workflows for supplier registration, qualification, "
                "and lifecycle events. Controls routing rules, escalation paths, and "
                "auto-approval thresholds for supplier management."
            ),
            "governs_fields": ["Supplier.approvalStatus"],
            "impacts_features": [
                "supplier registration approval",
                "qualification review routing",
                "lifecycle event handling",
                "auto-approval thresholds",
            ],
            "connector": "ariba",
            "read_method": "rest_get",
        },
    ],

    # -----------------------------------------------------------------
    # Ariba Contracts
    # -----------------------------------------------------------------
    "ariba_contracts": [
        {
            "table": "ContractWorkspaceTemplate",
            "fields": ["templateId", "templateName", "contractType", "isActive"],
            "description": "Contract workspace templates",
            "config_context": (
                "Defines contract workspace templates that standardise contract creation "
                "with predefined clauses, approval workflows, and compliance checkpoints. "
                "Templates control the contract lifecycle from authoring to expiry."
            ),
            "governs_fields": ["ContractWorkspace.template"],
            "impacts_features": [
                "contract creation standardisation",
                "clause library application",
                "compliance checkpoint enforcement",
                "renewal notification rules",
            ],
            "connector": "ariba",
            "read_method": "rest_get",
        },
    ],

    # =====================================================================
    # eWMS MODULES
    # =====================================================================

    # -----------------------------------------------------------------
    # eWMS Stock Management
    # -----------------------------------------------------------------
    "ewms_stock": [
        {
            "table": "/SCWM/T300",
            "fields": ["LGNUM", "LNUMT"],
            "description": "Warehouse number definitions",
            "config_context": (
                "Defines warehouse numbers as the top-level organisational unit in EWM. "
                "Warehouse numbers control stock management, physical inventory procedures, "
                "and all warehouse-specific master data and configuration."
            ),
            "governs_fields": ["/SCWM/ORDIM_C.LGNUM"],
            "impacts_features": [
                "warehouse structure",
                "stock management scope",
                "physical inventory procedures",
                "warehouse-level reporting",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "/SCWM/T301",
            "fields": ["LGNUM", "LGTYP", "LTYPT"],
            "description": "Storage type definitions",
            "config_context": (
                "Defines storage types within a warehouse (e.g. high rack, block storage, "
                "goods receipt area, shipping zone). Storage types control putaway and "
                "picking strategies and capacity management."
            ),
            "governs_fields": ["/SCWM/ORDIM_C.LGTYP"],
            "impacts_features": [
                "putaway strategy",
                "picking strategy",
                "capacity management",
                "storage utilisation reporting",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "/SCWM/T302",
            "fields": ["LGNUM", "LGTYP", "LGPLA"],
            "description": "Storage bin definitions",
            "config_context": (
                "Defines storage bins (individual locations) within storage types. "
                "Storage bins control the physical location assignment for warehouse "
                "tasks and drive bin-level capacity and weight checks."
            ),
            "governs_fields": ["/SCWM/ORDIM_C.LGPLA"],
            "impacts_features": [
                "bin assignment",
                "capacity checks",
                "weight and volume management",
                "bin status tracking",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "/SCWM/T306",
            "fields": ["LGNUM", "DOCCAT", "PROCTY"],
            "description": "Warehouse process type definitions",
            "config_context": (
                "Defines warehouse process types that control how goods movements are "
                "executed (e.g. putaway, picking, replenishment, physical inventory). "
                "Process types determine task creation rules and resource requirements."
            ),
            "governs_fields": ["/SCWM/ORDIM_C.PROCTY"],
            "impacts_features": [
                "warehouse task creation",
                "process type determination",
                "resource planning",
                "activity monitoring",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "/SCWM/TPROCESS",
            "fields": ["LGNUM", "PROCESS", "PROCTEXT"],
            "description": "Warehouse process definitions",
            "config_context": (
                "Defines warehouse processes that orchestrate sequences of warehouse "
                "tasks. Processes group related activities (e.g. inbound processing "
                "from goods receipt to putaway) and control execution order."
            ),
            "governs_fields": ["/SCWM/ORDIM_C.PROCESS"],
            "impacts_features": [
                "process orchestration",
                "task sequencing",
                "inbound/outbound flow control",
                "wave management",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # eWMS Transfer Orders
    # -----------------------------------------------------------------
    "ewms_transfer_orders": [
        {
            "table": "/SCWM/TRSRC_TYP",
            "fields": ["LGNUM", "RSRC_TYPE", "RSRC_TYP_DESC"],
            "description": "Resource type definitions for warehouse tasks",
            "config_context": (
                "Defines resource types (forklift, picker, automated guided vehicle, etc.) "
                "available for executing warehouse tasks. Resource types control task "
                "assignment, queue management, and labour capacity planning."
            ),
            "governs_fields": ["/SCWM/RSRC.RSRC_TYPE"],
            "impacts_features": [
                "resource assignment",
                "task queue management",
                "labour capacity planning",
                "resource utilisation reporting",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # Batch Management
    # -----------------------------------------------------------------
    "batch_management": [
        {
            "table": "MCH1_CONFIG",
            "fields": ["MATNR", "CHARG", "LVORM"],
            "description": "Batch master configuration",
            "config_context": (
                "Defines batch management configuration controlling batch number assignment, "
                "batch determination strategies, and shelf-life management. Configuration "
                "determines whether batch management is plant-level or cross-plant."
            ),
            "governs_fields": ["MCH1.CHARG"],
            "impacts_features": [
                "batch number assignment",
                "batch determination",
                "shelf-life management",
                "batch where-used tracking",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],

    # -----------------------------------------------------------------
    # WM Interface
    # -----------------------------------------------------------------
    "wm_interface": [
        {
            "table": "T300",
            "fields": ["LGNUM", "LNUMT"],
            "description": "Warehouse number definitions (classic WM)",
            "config_context": (
                "Defines warehouse numbers for the classic Warehouse Management (WM) "
                "system. Controls the link between IM storage locations and WM warehouse "
                "structures for decentralised warehouse operations."
            ),
            "governs_fields": ["LQUA.LGNUM"],
            "impacts_features": [
                "WM/IM interface",
                "storage location mapping",
                "transfer order processing",
                "inventory reconciliation",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
        {
            "table": "T301",
            "fields": ["LGNUM", "LGTYP", "LTYPT"],
            "description": "Storage type definitions (classic WM)",
            "config_context": (
                "Defines storage types for classic WM controlling putaway and picking "
                "strategies. Storage types segment the warehouse into logical areas "
                "with distinct movement rules and capacity settings."
            ),
            "governs_fields": ["LQUA.LGTYP"],
            "impacts_features": [
                "putaway strategy (classic WM)",
                "picking strategy (classic WM)",
                "storage type capacity",
                "movement type control",
            ],
            "connector": "ecc",
            "read_method": "rfc_read_table",
        },
    ],
}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def get_modules() -> list[str]:
    """Return all module names in the registry."""
    return list(SPRO_REGISTRY.keys())


def get_tables_for_module(module: str) -> list[SPROEntry]:
    """Return all SPRO table entries for a given module."""
    return SPRO_REGISTRY.get(module, [])


def get_all_governed_fields(module: str) -> list[str]:
    """Return all fields governed by SPRO config for a module."""
    fields: list[str] = []
    for entry in SPRO_REGISTRY.get(module, []):
        fields.extend(entry.get("governs_fields", []))
    return fields
