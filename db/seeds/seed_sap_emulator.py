"""
Meridian SAP Data Quality & MDM Platform — SAP System Emulator Seed Script
=========================================================================
Entity Oz (Pty) Ltd | March 2026

Emulates connections to SAP ECC, SuccessFactors, and Warehouse systems
across 12 SAP modules. Seeds realistic data for every platform feature:

  • Data Quality Engine (254+ checks across 6 check types)
  • Golden Records & Survivorship
  • Match & Merge Engine
  • Business Glossary
  • Stewardship Workbench
  • Data Contracts
  • Analytics Engine (predictive, prescriptive, impact, operational)
  • NLP Query Interface
  • Cleaning Pipeline
  • Exception Management
  • Sync Engine
  • Notifications & Audit

Usage:
    python seed_sap_emulator.py [--tenant-id TENANT_UUID] [--db-url postgresql://...]
    python seed_sap_emulator.py --dry-run   # Print SQL without executing

Requires: psycopg2-binary, faker
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

# ---------------------------------------------------------------------------
# Optional imports — script works in dry-run mode without them
# ---------------------------------------------------------------------------
try:
    import psycopg2
    import psycopg2.extras

    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

try:
    from faker import Faker

    fake = Faker()
except ImportError:
    fake = None  # Fallback to hand-rolled generators

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("meridian_seed")

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — CONSTANTS & CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

NOW = datetime.now(timezone.utc)
TENANT_ID = None  # Set via CLI or default
DRY_RUN = False
DB_URL = os.getenv("DATABASE_URL", "postgresql://meridian:meridian@localhost:5432/meridian")

# DAMA DMBOK dimension weights (configurable per tenant in prod)
DAMA_WEIGHTS = {
    "completeness": 0.25,
    "accuracy": 0.25,
    "consistency": 0.20,
    "timeliness": 0.10,
    "uniqueness": 0.10,
    "validity": 0.10,
}

# RBAC roles
ROLES = ["admin", "steward", "analyst", "viewer"]

# Notification channels
NOTIFICATION_CHANNELS = ["email", "teams", "in_app"]

# Severity levels
SEVERITIES = ["critical", "high", "medium", "low"]


class CheckType(str, Enum):
    NULL_CHECK = "null_check"
    DOMAIN_VALUE_CHECK = "domain_value_check"
    REGEX_CHECK = "regex_check"
    CROSS_FIELD_CHECK = "cross_field_check"
    REFERENTIAL_CHECK = "referential_check"
    FRESHNESS_CHECK = "freshness_check"


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — SAP MODULE DEFINITIONS (12 modules across 3 categories)
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class SAPModule:
    """Represents a single SAP module with its tables, fields, and check rules."""

    code: str
    name: str
    category: str  # ECC | SuccessFactors | Warehouse
    primary_table: str
    key_field: str
    fields: list[dict[str, str]]
    checks: list[dict[str, Any]]
    record_count: int = 500


# fmt: off
SAP_MODULES: list[SAPModule] = [
    # ── ECC MODULES ────────────────────────────────────────────────────────
    SAPModule(
        code="BP",
        name="Business Partner",
        category="ECC",
        primary_table="BUT000",
        key_field="PARTNER",
        fields=[
            {"name": "PARTNER",   "type": "CHAR(10)", "sap_desc": "Business Partner Number"},
            {"name": "BU_GROUP",  "type": "CHAR(4)",  "sap_desc": "BP Grouping"},
            {"name": "TITLE",     "type": "CHAR(4)",  "sap_desc": "Form of Address Key"},
            {"name": "NAME_ORG1", "type": "CHAR(40)", "sap_desc": "Name 1 of Organisation"},
            {"name": "NAME_ORG2", "type": "CHAR(40)", "sap_desc": "Name 2 of Organisation"},
            {"name": "STREET",    "type": "CHAR(60)", "sap_desc": "Street"},
            {"name": "CITY1",     "type": "CHAR(40)", "sap_desc": "City"},
            {"name": "COUNTRY",   "type": "CHAR(3)",  "sap_desc": "Country Key"},
            {"name": "REGION",    "type": "CHAR(3)",  "sap_desc": "Region"},
            {"name": "POST_CODE1","type": "CHAR(10)", "sap_desc": "Postal Code"},
            {"name": "BU_SORT1",  "type": "CHAR(20)", "sap_desc": "Search Term 1"},
            {"name": "BPEXT",     "type": "CHAR(20)", "sap_desc": "External BP Number"},
            {"name": "CRDAT",     "type": "DATS",     "sap_desc": "Created On"},
            {"name": "CHDAT",     "type": "DATS",     "sap_desc": "Changed On"},
        ],
        checks=[
            {"id": "BP-001", "type": CheckType.NULL_CHECK,         "field": "PARTNER",   "severity": "critical", "desc": "BP number must not be null"},
            {"id": "BP-002", "type": CheckType.REGEX_CHECK,        "field": "PARTNER",   "severity": "critical", "desc": "BP number must be 10-digit numeric", "pattern": r"^\d{10}$"},
            {"id": "BP-003", "type": CheckType.NULL_CHECK,         "field": "BU_GROUP",  "severity": "high",     "desc": "BP grouping must not be null for S/4HANA"},
            {"id": "BP-004", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "COUNTRY",   "severity": "high",     "desc": "Country must be valid ISO-3166", "domain": ["ZA", "US", "GB", "DE", "AU", "IN", "NG", "KE", "FR", "JP"]},
            {"id": "BP-005", "type": CheckType.CROSS_FIELD_CHECK,  "field": "REGION",    "severity": "medium",   "desc": "Region must be set if country is ZA", "depends_on": "COUNTRY"},
            {"id": "BP-006", "type": CheckType.NULL_CHECK,         "field": "NAME_ORG1", "severity": "critical", "desc": "Organisation name 1 must not be null"},
            {"id": "BP-007", "type": CheckType.FRESHNESS_CHECK,    "field": "CHDAT",     "severity": "low",      "desc": "Record updated within 365 days", "max_age_days": 365},
            {"id": "BP-008", "type": CheckType.REFERENTIAL_CHECK,  "field": "BU_GROUP",  "severity": "high",     "desc": "BP group must exist in T077D", "ref_table": "T077D"},
        ],
        record_count=800,
    ),
    SAPModule(
        code="MM",
        name="Material Master",
        category="ECC",
        primary_table="MARA",
        key_field="MATNR",
        fields=[
            {"name": "MATNR",   "type": "CHAR(18)", "sap_desc": "Material Number"},
            {"name": "MTART",   "type": "CHAR(4)",  "sap_desc": "Material Type"},
            {"name": "MBRSH",   "type": "CHAR(1)",  "sap_desc": "Industry Sector"},
            {"name": "MATKL",   "type": "CHAR(9)",  "sap_desc": "Material Group"},
            {"name": "MEINS",   "type": "CHAR(3)",  "sap_desc": "Base Unit of Measure"},
            {"name": "BRGEW",   "type": "DEC(13,3)","sap_desc": "Gross Weight"},
            {"name": "NTGEW",   "type": "DEC(13,3)","sap_desc": "Net Weight"},
            {"name": "GEWEI",   "type": "CHAR(3)",  "sap_desc": "Weight Unit"},
            {"name": "ERSDA",   "type": "DATS",     "sap_desc": "Created On"},
            {"name": "LAEDA",   "type": "DATS",     "sap_desc": "Last Changed"},
        ],
        checks=[
            {"id": "MM-001", "type": CheckType.NULL_CHECK,         "field": "MATNR",   "severity": "critical", "desc": "Material number must not be null"},
            {"id": "MM-002", "type": CheckType.NULL_CHECK,         "field": "MTART",   "severity": "critical", "desc": "Material type is mandatory"},
            {"id": "MM-003", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "MTART",   "severity": "high",     "desc": "Material type must be valid", "domain": ["ROH", "HALB", "FERT", "HIBE", "DIEN", "NLAG"]},
            {"id": "MM-004", "type": CheckType.NULL_CHECK,         "field": "MEINS",   "severity": "high",     "desc": "Base UoM is mandatory"},
            {"id": "MM-005", "type": CheckType.CROSS_FIELD_CHECK,  "field": "GEWEI",   "severity": "medium",   "desc": "Weight unit required if gross weight set", "depends_on": "BRGEW"},
            {"id": "MM-006", "type": CheckType.REGEX_CHECK,        "field": "MATNR",   "severity": "high",     "desc": "Material number must be 18-char padded", "pattern": r"^\d{18}$"},
            {"id": "MM-007", "type": CheckType.FRESHNESS_CHECK,    "field": "LAEDA",   "severity": "low",      "desc": "Material updated within 730 days", "max_age_days": 730},
        ],
        record_count=1200,
    ),
    SAPModule(
        code="GL",
        name="GL Accounts",
        category="ECC",
        primary_table="SKA1",
        key_field="SAKNR",
        fields=[
            {"name": "SAKNR",   "type": "CHAR(10)", "sap_desc": "GL Account Number"},
            {"name": "KTOPL",   "type": "CHAR(4)",  "sap_desc": "Chart of Accounts"},
            {"name": "XBILK",   "type": "CHAR(1)",  "sap_desc": "Balance Sheet Account"},
            {"name": "GVTYP",   "type": "CHAR(1)",  "sap_desc": "P&L Statement Account Type"},
            {"name": "KTOKS",   "type": "CHAR(4)",  "sap_desc": "GL Account Group"},
            {"name": "TXT20",   "type": "CHAR(20)", "sap_desc": "Short Text"},
            {"name": "TXT50",   "type": "CHAR(50)", "sap_desc": "Long Text"},
            {"name": "WAERS",   "type": "CHAR(5)",  "sap_desc": "Currency"},
            {"name": "ERDAT",   "type": "DATS",     "sap_desc": "Created On"},
        ],
        checks=[
            {"id": "GL-001", "type": CheckType.NULL_CHECK,         "field": "SAKNR",  "severity": "critical", "desc": "GL account number must not be null"},
            {"id": "GL-002", "type": CheckType.NULL_CHECK,         "field": "KTOPL",  "severity": "critical", "desc": "Chart of accounts must not be null"},
            {"id": "GL-003", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "WAERS",  "severity": "high",     "desc": "Currency must be valid ISO-4217", "domain": ["ZAR", "USD", "EUR", "GBP", "AUD", "JPY"]},
            {"id": "GL-004", "type": CheckType.NULL_CHECK,         "field": "TXT20",  "severity": "medium",   "desc": "Short text should be populated"},
            {"id": "GL-005", "type": CheckType.CROSS_FIELD_CHECK,  "field": "GVTYP",  "severity": "high",     "desc": "P&L type required if not balance sheet", "depends_on": "XBILK"},
        ],
        record_count=350,
    ),
    SAPModule(
        code="SD",
        name="SD Customer",
        category="ECC",
        primary_table="KNA1",
        key_field="KUNNR",
        fields=[
            {"name": "KUNNR",   "type": "CHAR(10)", "sap_desc": "Customer Number"},
            {"name": "BUKRS",   "type": "CHAR(4)",  "sap_desc": "Company Code"},
            {"name": "NAME1",   "type": "CHAR(35)", "sap_desc": "Name 1"},
            {"name": "LAND1",   "type": "CHAR(3)",  "sap_desc": "Country Key"},
            {"name": "ORT01",   "type": "CHAR(35)", "sap_desc": "City"},
            {"name": "PSTLZ",   "type": "CHAR(10)", "sap_desc": "Postal Code"},
            {"name": "REGIO",   "type": "CHAR(3)",  "sap_desc": "Region"},
            {"name": "TELF1",   "type": "CHAR(16)", "sap_desc": "Telephone 1"},
            {"name": "STCD1",   "type": "CHAR(16)", "sap_desc": "Tax Number 1"},
            {"name": "ERDAT",   "type": "DATS",     "sap_desc": "Created On"},
        ],
        checks=[
            {"id": "SD-001", "type": CheckType.NULL_CHECK,         "field": "KUNNR",  "severity": "critical", "desc": "Customer number must not be null"},
            {"id": "SD-002", "type": CheckType.NULL_CHECK,         "field": "NAME1",  "severity": "critical", "desc": "Customer name must not be null"},
            {"id": "SD-003", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "LAND1",  "severity": "high",     "desc": "Country must be valid ISO-3166", "domain": ["ZA", "US", "GB", "DE", "AU", "IN", "NG", "KE", "FR", "JP"]},
            {"id": "SD-004", "type": CheckType.REGEX_CHECK,        "field": "KUNNR",  "severity": "high",     "desc": "Customer number must be 10-digit numeric", "pattern": r"^\d{10}$"},
            {"id": "SD-005", "type": CheckType.CROSS_FIELD_CHECK,  "field": "REGIO",  "severity": "medium",   "desc": "Region required when country is ZA", "depends_on": "LAND1"},
            {"id": "SD-006", "type": CheckType.NULL_CHECK,         "field": "BUKRS",  "severity": "high",     "desc": "Company code must not be null"},
        ],
        record_count=600,
    ),

    # ── SUCCESSFACTORS MODULES ─────────────────────────────────────────────
    SAPModule(
        code="EC",
        name="Employee Central",
        category="SuccessFactors",
        primary_table="PER_PERSONAL_INFO",
        key_field="PERSON_ID_EXTERNAL",
        fields=[
            {"name": "PERSON_ID_EXTERNAL", "type": "CHAR(32)",  "sap_desc": "Person ID"},
            {"name": "FIRST_NAME",         "type": "CHAR(128)", "sap_desc": "First Name"},
            {"name": "LAST_NAME",          "type": "CHAR(128)", "sap_desc": "Last Name"},
            {"name": "EMAIL",              "type": "CHAR(100)", "sap_desc": "Email Address"},
            {"name": "DATE_OF_BIRTH",      "type": "DATS",      "sap_desc": "Date of Birth"},
            {"name": "GENDER",             "type": "CHAR(1)",   "sap_desc": "Gender"},
            {"name": "HIRE_DATE",          "type": "DATS",      "sap_desc": "Hire Date"},
            {"name": "DEPARTMENT",         "type": "CHAR(50)",  "sap_desc": "Department"},
            {"name": "LOCATION",           "type": "CHAR(50)",  "sap_desc": "Location"},
            {"name": "JOB_CODE",           "type": "CHAR(20)",  "sap_desc": "Job Code"},
            {"name": "MANAGER_ID",         "type": "CHAR(32)",  "sap_desc": "Manager Person ID"},
            {"name": "STATUS",             "type": "CHAR(1)",   "sap_desc": "Employment Status"},
        ],
        checks=[
            {"id": "EC-001", "type": CheckType.NULL_CHECK,         "field": "PERSON_ID_EXTERNAL", "severity": "critical", "desc": "Person ID must not be null"},
            {"id": "EC-002", "type": CheckType.NULL_CHECK,         "field": "LAST_NAME",          "severity": "critical", "desc": "Last name must not be null"},
            {"id": "EC-003", "type": CheckType.REGEX_CHECK,        "field": "EMAIL",              "severity": "high",     "desc": "Email must be valid format", "pattern": r"^[^@]+@[^@]+\.[^@]+$"},
            {"id": "EC-004", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "GENDER",             "severity": "medium",   "desc": "Gender must be M, F, or X", "domain": ["M", "F", "X"]},
            {"id": "EC-005", "type": CheckType.REFERENTIAL_CHECK,  "field": "MANAGER_ID",         "severity": "high",     "desc": "Manager must exist as valid person", "ref_table": "PER_PERSONAL_INFO"},
            {"id": "EC-006", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "STATUS",             "severity": "critical", "desc": "Status must be A(ctive) or T(erminated)", "domain": ["A", "T"]},
            {"id": "EC-007", "type": CheckType.CROSS_FIELD_CHECK,  "field": "HIRE_DATE",          "severity": "high",     "desc": "Hire date must be after date of birth", "depends_on": "DATE_OF_BIRTH"},
        ],
        record_count=450,
    ),
    SAPModule(
        code="COMP",
        name="Compensation",
        category="SuccessFactors",
        primary_table="COMP_INFO",
        key_field="COMP_INFO_ID",
        fields=[
            {"name": "COMP_INFO_ID",       "type": "CHAR(32)", "sap_desc": "Compensation Record ID"},
            {"name": "PERSON_ID_EXTERNAL",  "type": "CHAR(32)", "sap_desc": "Person ID"},
            {"name": "PAY_GRADE",           "type": "CHAR(10)", "sap_desc": "Pay Grade"},
            {"name": "SALARY",              "type": "DEC(15,2)","sap_desc": "Annual Salary"},
            {"name": "CURRENCY",            "type": "CHAR(3)",  "sap_desc": "Currency Code"},
            {"name": "EFFECTIVE_DATE",      "type": "DATS",     "sap_desc": "Effective Date"},
            {"name": "REASON",              "type": "CHAR(20)", "sap_desc": "Change Reason"},
            {"name": "BONUS_PCT",           "type": "DEC(5,2)", "sap_desc": "Bonus Target %"},
        ],
        checks=[
            {"id": "COMP-001", "type": CheckType.NULL_CHECK,          "field": "SALARY",             "severity": "critical", "desc": "Salary must not be null"},
            {"id": "COMP-002", "type": CheckType.DOMAIN_VALUE_CHECK,  "field": "CURRENCY",           "severity": "high",     "desc": "Currency must be valid", "domain": ["ZAR", "USD", "EUR", "GBP"]},
            {"id": "COMP-003", "type": CheckType.REFERENTIAL_CHECK,   "field": "PERSON_ID_EXTERNAL", "severity": "critical", "desc": "Person must exist in EC", "ref_table": "PER_PERSONAL_INFO"},
            {"id": "COMP-004", "type": CheckType.NULL_CHECK,          "field": "EFFECTIVE_DATE",     "severity": "high",     "desc": "Effective date is mandatory"},
            {"id": "COMP-005", "type": CheckType.CROSS_FIELD_CHECK,   "field": "BONUS_PCT",          "severity": "medium",   "desc": "Bonus target requires pay grade", "depends_on": "PAY_GRADE"},
        ],
        record_count=450,
    ),
    SAPModule(
        code="PAY",
        name="Payroll",
        category="SuccessFactors",
        primary_table="PAY_RESULTS",
        key_field="PAYROLL_ID",
        fields=[
            {"name": "PAYROLL_ID",          "type": "CHAR(32)", "sap_desc": "Payroll Run ID"},
            {"name": "PERSON_ID_EXTERNAL",  "type": "CHAR(32)", "sap_desc": "Person ID"},
            {"name": "PAY_PERIOD",          "type": "CHAR(7)",  "sap_desc": "Pay Period (YYYY-MM)"},
            {"name": "GROSS_PAY",           "type": "DEC(15,2)","sap_desc": "Gross Pay"},
            {"name": "NET_PAY",             "type": "DEC(15,2)","sap_desc": "Net Pay"},
            {"name": "TAX_AMOUNT",          "type": "DEC(15,2)","sap_desc": "Tax Deducted"},
            {"name": "CURRENCY",            "type": "CHAR(3)",  "sap_desc": "Currency"},
            {"name": "STATUS",              "type": "CHAR(10)", "sap_desc": "Payroll Status"},
        ],
        checks=[
            {"id": "PAY-001", "type": CheckType.NULL_CHECK,         "field": "GROSS_PAY", "severity": "critical", "desc": "Gross pay must not be null"},
            {"id": "PAY-002", "type": CheckType.CROSS_FIELD_CHECK,  "field": "NET_PAY",   "severity": "critical", "desc": "Net pay must be <= gross pay", "depends_on": "GROSS_PAY"},
            {"id": "PAY-003", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "STATUS",    "severity": "high",     "desc": "Payroll status must be valid", "domain": ["DRAFT", "APPROVED", "POSTED", "REVERSED"]},
            {"id": "PAY-004", "type": CheckType.REGEX_CHECK,        "field": "PAY_PERIOD","severity": "high",     "desc": "Pay period must be YYYY-MM", "pattern": r"^\d{4}-\d{2}$"},
        ],
        record_count=2400,
    ),
    SAPModule(
        code="TNA",
        name="Time & Attendance",
        category="SuccessFactors",
        primary_table="TIME_ACCOUNT",
        key_field="TIME_ACCOUNT_ID",
        fields=[
            {"name": "TIME_ACCOUNT_ID",     "type": "CHAR(32)", "sap_desc": "Time Account ID"},
            {"name": "PERSON_ID_EXTERNAL",  "type": "CHAR(32)", "sap_desc": "Person ID"},
            {"name": "ACCOUNT_TYPE",        "type": "CHAR(20)", "sap_desc": "Leave Type"},
            {"name": "BALANCE",             "type": "DEC(5,2)", "sap_desc": "Leave Balance (days)"},
            {"name": "BOOKED",              "type": "DEC(5,2)", "sap_desc": "Days Booked"},
            {"name": "REMAINING",           "type": "DEC(5,2)", "sap_desc": "Days Remaining"},
            {"name": "PERIOD_START",        "type": "DATS",     "sap_desc": "Accrual Period Start"},
            {"name": "PERIOD_END",          "type": "DATS",     "sap_desc": "Accrual Period End"},
        ],
        checks=[
            {"id": "TNA-001", "type": CheckType.NULL_CHECK,          "field": "PERSON_ID_EXTERNAL", "severity": "critical", "desc": "Person ID must not be null"},
            {"id": "TNA-002", "type": CheckType.DOMAIN_VALUE_CHECK,  "field": "ACCOUNT_TYPE",       "severity": "high",     "desc": "Leave type must be valid", "domain": ["ANNUAL", "SICK", "FAMILY", "STUDY", "UNPAID"]},
            {"id": "TNA-003", "type": CheckType.CROSS_FIELD_CHECK,   "field": "REMAINING",          "severity": "medium",   "desc": "Remaining must equal balance minus booked", "depends_on": "BALANCE"},
            {"id": "TNA-004", "type": CheckType.FRESHNESS_CHECK,     "field": "PERIOD_END",         "severity": "low",      "desc": "Accrual period should be current", "max_age_days": 90},
        ],
        record_count=450,
    ),

    # ── WAREHOUSE MODULES ──────────────────────────────────────────────────
    SAPModule(
        code="WM",
        name="eWMS Stock",
        category="Warehouse",
        primary_table="LAGP",
        key_field="LGPLA",
        fields=[
            {"name": "LGPLA",  "type": "CHAR(10)", "sap_desc": "Storage Bin"},
            {"name": "LGNUM",  "type": "CHAR(4)",  "sap_desc": "Warehouse Number"},
            {"name": "LGTYP",  "type": "CHAR(3)",  "sap_desc": "Storage Type"},
            {"name": "MATNR",  "type": "CHAR(18)", "sap_desc": "Material Number"},
            {"name": "GESME",  "type": "DEC(13,3)","sap_desc": "Available Stock"},
            {"name": "MEINS",  "type": "CHAR(3)",  "sap_desc": "Base UoM"},
            {"name": "CHARG",  "type": "CHAR(10)", "sap_desc": "Batch Number"},
            {"name": "VFDAT",  "type": "DATS",     "sap_desc": "Shelf Life Expiry"},
        ],
        checks=[
            {"id": "WM-001", "type": CheckType.NULL_CHECK,         "field": "LGPLA",  "severity": "critical", "desc": "Storage bin must not be null"},
            {"id": "WM-002", "type": CheckType.NULL_CHECK,         "field": "MATNR",  "severity": "critical", "desc": "Material must not be null"},
            {"id": "WM-003", "type": CheckType.REFERENTIAL_CHECK,  "field": "MATNR",  "severity": "high",     "desc": "Material must exist in MARA", "ref_table": "MARA"},
            {"id": "WM-004", "type": CheckType.FRESHNESS_CHECK,    "field": "VFDAT",  "severity": "high",     "desc": "Stock must not be expired", "max_age_days": 0},
            {"id": "WM-005", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "LGTYP",  "severity": "medium",   "desc": "Storage type must be valid", "domain": ["001", "002", "003", "010", "020", "100"]},
        ],
        record_count=2000,
    ),
    SAPModule(
        code="BATCH",
        name="Batch Management",
        category="Warehouse",
        primary_table="MCH1",
        key_field="CHARG",
        fields=[
            {"name": "CHARG",   "type": "CHAR(10)", "sap_desc": "Batch Number"},
            {"name": "MATNR",   "type": "CHAR(18)", "sap_desc": "Material Number"},
            {"name": "WERKS",   "type": "CHAR(4)",  "sap_desc": "Plant"},
            {"name": "HSDAT",   "type": "DATS",     "sap_desc": "Date of Manufacture"},
            {"name": "VFDAT",   "type": "DATS",     "sap_desc": "Shelf Life Expiry"},
            {"name": "ZUESSION","type": "CHAR(18)", "sap_desc": "Vendor Batch"},
            {"name": "LIESSION","type": "CHAR(10)", "sap_desc": "Supplier"},
            {"name": "STATUS",  "type": "CHAR(1)",  "sap_desc": "Batch Status"},
        ],
        checks=[
            {"id": "BATCH-001", "type": CheckType.NULL_CHECK,         "field": "CHARG",  "severity": "critical", "desc": "Batch number must not be null"},
            {"id": "BATCH-002", "type": CheckType.REFERENTIAL_CHECK,  "field": "MATNR",  "severity": "high",     "desc": "Material must exist in MARA", "ref_table": "MARA"},
            {"id": "BATCH-003", "type": CheckType.CROSS_FIELD_CHECK,  "field": "VFDAT",  "severity": "high",     "desc": "Expiry must be after manufacture date", "depends_on": "HSDAT"},
            {"id": "BATCH-004", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "STATUS",  "severity": "high",    "desc": "Batch status must be valid", "domain": ["A", "R", "B"]},
        ],
        record_count=3000,
    ),
    SAPModule(
        code="PM",
        name="Plant Maintenance",
        category="ECC",
        primary_table="EQUI",
        key_field="EQUNR",
        fields=[
            {"name": "EQUNR",    "type": "CHAR(18)", "sap_desc": "Equipment Number"},
            {"name": "EQKTX",    "type": "CHAR(40)", "sap_desc": "Description"},
            {"name": "EQART",    "type": "CHAR(10)", "sap_desc": "Equipment Type"},
            {"name": "WERKS",    "type": "CHAR(4)",  "sap_desc": "Plant"},
            {"name": "KOSTL",    "type": "CHAR(10)", "sap_desc": "Cost Centre"},
            {"name": "INBDT",    "type": "DATS",     "sap_desc": "Start-Up Date"},
            {"name": "HERST",    "type": "CHAR(25)", "sap_desc": "Manufacturer"},
            {"name": "SERGE",    "type": "CHAR(18)", "sap_desc": "Serial Number"},
            {"name": "GEWRK",    "type": "CHAR(8)",  "sap_desc": "Work Centre"},
            {"name": "STATTEXT", "type": "CHAR(40)", "sap_desc": "System Status"},
        ],
        checks=[
            {"id": "PM-001", "type": CheckType.NULL_CHECK,         "field": "EQUNR",  "severity": "critical", "desc": "Equipment number must not be null"},
            {"id": "PM-002", "type": CheckType.NULL_CHECK,         "field": "EQKTX",  "severity": "high",     "desc": "Description must not be null"},
            {"id": "PM-003", "type": CheckType.REFERENTIAL_CHECK,  "field": "KOSTL",  "severity": "high",     "desc": "Cost centre must exist in master", "ref_table": "CSKS"},
            {"id": "PM-004", "type": CheckType.FRESHNESS_CHECK,    "field": "INBDT",  "severity": "low",      "desc": "Start-up date should be within 20 years", "max_age_days": 7300},
            {"id": "PM-005", "type": CheckType.NULL_CHECK,         "field": "WERKS",  "severity": "high",     "desc": "Plant assignment is mandatory"},
        ],
        record_count=500,
    ),
    SAPModule(
        code="PP",
        name="Production Planning",
        category="ECC",
        primary_table="PLKO",
        key_field="PLNNR",
        fields=[
            {"name": "PLNNR",   "type": "CHAR(8)",  "sap_desc": "Routing Number"},
            {"name": "PLNAL",   "type": "CHAR(2)",  "sap_desc": "Group Counter"},
            {"name": "WERKS",   "type": "CHAR(4)",  "sap_desc": "Plant"},
            {"name": "MATNR",   "type": "CHAR(18)", "sap_desc": "Material Number"},
            {"name": "STATU",   "type": "CHAR(1)",  "sap_desc": "Status"},
            {"name": "LOSVN",   "type": "DEC(13,3)","sap_desc": "Lot Size From"},
            {"name": "LOSBS",   "type": "DEC(13,3)","sap_desc": "Lot Size To"},
            {"name": "VERWE",   "type": "CHAR(3)",  "sap_desc": "Usage"},
            {"name": "DATEFROM","type": "DATS",     "sap_desc": "Valid From"},
        ],
        checks=[
            {"id": "PP-001", "type": CheckType.NULL_CHECK,         "field": "PLNNR",  "severity": "critical", "desc": "Routing number must not be null"},
            {"id": "PP-002", "type": CheckType.REFERENTIAL_CHECK,  "field": "MATNR",  "severity": "high",     "desc": "Material must exist in MARA", "ref_table": "MARA"},
            {"id": "PP-003", "type": CheckType.DOMAIN_VALUE_CHECK, "field": "STATU",  "severity": "high",     "desc": "Status must be valid", "domain": ["1", "2", "3", "4"]},
            {"id": "PP-004", "type": CheckType.CROSS_FIELD_CHECK,  "field": "LOSBS",  "severity": "medium",   "desc": "Lot size to must be >= lot size from", "depends_on": "LOSVN"},
        ],
        record_count=300,
    ),
]
# fmt: on


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — EMULATED SAP RFC CONNECTION
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class SAPConnectionConfig:
    """Emulated SAP RFC connection parameters (mirrors sap.base.SAPConnectionParams)."""

    ashost: str = "10.0.1.50"
    sysnr: str = "00"
    client: str = "100"
    user: str = "VANTAX_SVC"
    passwd: str = "***ENCRYPTED***"
    lang: str = "EN"
    saprouter: str = ""
    group: str = ""
    mshost: str = ""
    sysid: str = "ERP"

    def fingerprint(self) -> str:
        """Generate a machine fingerprint for licence validation."""
        raw = f"{self.ashost}:{self.sysnr}:{self.client}:{self.sysid}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


class EmulatedSAPConnection:
    """
    Emulates the SAP connector for seeding purposes.

    In production, Meridian uses:
        from sap import get_connector
        with get_connector() as conn:
            conn.connect(params)
            df = conn.read_table('BUT000', ['PARTNER', 'BU_TYPE'])

    This emulator generates realistic SAP-shaped data for each module
    without requiring an actual SAP system.
    """

    def __init__(self, config: SAPConnectionConfig):
        self.config = config
        self._connected = False
        self.call_log: list[dict] = []
        log.info(
            f"[SAP] Initialising emulated RFC connection to {config.ashost} "
            f"SID={config.sysid} client={config.client}"
        )

    def open(self) -> None:
        self._connected = True
        log.info(f"[SAP] Connection established — {self.config.sysid}/{self.config.client}")

    def close(self) -> None:
        self._connected = False
        log.info("[SAP] Connection closed")

    def ping(self) -> dict:
        return {"status": "ok", "sysid": self.config.sysid, "timestamp": NOW.isoformat()}

    def call(
        self,
        function_module: str,
        QUERY_TABLE: str = "",
        DELIMITER: str = "|",
        FIELDS: list[dict] | None = None,
        OPTIONS: list[dict] | None = None,
        ROWCOUNT: int = 0,
    ) -> dict:
        """Emulate RFC_READ_TABLE response with realistic data."""
        self.call_log.append(
            {
                "fm": function_module,
                "table": QUERY_TABLE,
                "fields": FIELDS,
                "rowcount": ROWCOUNT,
                "timestamp": NOW.isoformat(),
            }
        )
        log.info(f"[SAP] RFC call: {function_module}(QUERY_TABLE={QUERY_TABLE}, ROWCOUNT={ROWCOUNT})")

        # Find the module definition for this table
        module = next((m for m in SAP_MODULES if m.primary_table == QUERY_TABLE), None)
        if not module:
            return {"DATA": [], "FIELDS": []}

        count = ROWCOUNT if ROWCOUNT > 0 else module.record_count
        rows = [_generate_sap_row(module, i) for i in range(count)]

        return {
            "DATA": [{"WA": DELIMITER.join(str(r.get(f["name"], "")) for f in module.fields)} for r in rows],
            "FIELDS": [{"FIELDNAME": f["name"], "TYPE": f["type"], "FIELDTEXT": f["sap_desc"]} for f in module.fields],
        }


def _generate_sap_row(module: SAPModule, index: int) -> dict[str, Any]:
    """Generate a single realistic SAP row with intentional data quality issues."""
    row: dict[str, Any] = {}
    inject_error = random.random() < 0.15  # 15% of rows have issues

    for fld in module.fields:
        name = fld["name"]
        ftype = fld["type"]

        # Key fields — always populated
        if name == module.key_field:
            if "CHAR(10)" in ftype:
                row[name] = str(index + 1).zfill(10)
            elif "CHAR(18)" in ftype:
                row[name] = str(index + 1).zfill(18)
            elif "CHAR(8)" in ftype:
                row[name] = str(index + 1).zfill(8)
            else:
                row[name] = str(uuid.uuid4().hex[:12])
            continue

        # Intentionally inject nulls on ~5% of non-key fields
        if inject_error and random.random() < 0.3:
            row[name] = None
            continue

        # Generate field-appropriate values
        row[name] = _generate_field_value(name, ftype, module.code, index)

    return row


def _generate_field_value(name: str, ftype: str, module_code: str, index: int) -> Any:
    """Generate a realistic value for a given SAP field."""
    # Company/org names
    if name in ("NAME_ORG1", "NAME1", "EQKTX"):
        names = [
            "Sasol Limited", "Shoprite Holdings", "MTN Group", "Naspers Ltd",
            "Woolworths SA", "Discovery Ltd", "Standard Bank", "Anglo American",
            "Nedbank Group", "Capitec Bank", "Bidvest Group", "Clicks Group",
            "Tiger Brands", "Vodacom Group", "Sanlam Limited", "Absa Group",
            "FirstRand Ltd", "Pick n Pay", "Sibanye Stillwater", "Gold Fields",
        ]
        return random.choice(names) if random.random() < 0.8 else f"Company_{index}"

    if name in ("NAME_ORG2",):
        return random.choice(["", "(Pty) Ltd", "Holdings", "South Africa"]) if random.random() < 0.4 else ""

    # Personal names
    if name == "FIRST_NAME":
        return random.choice(["Sipho", "Thandi", "Johan", "Fatima", "Pieter", "Naledi", "Ahmed", "Lerato", "Willem", "Nomusa"])
    if name == "LAST_NAME":
        return random.choice(["Nkosi", "Van der Merwe", "Dlamini", "Botha", "Molefe", "Kruger", "Zulu", "Patel", "Le Roux", "Ndlovu"])

    # Country fields
    if name in ("COUNTRY", "LAND1"):
        countries = ["ZA", "ZA", "ZA", "ZA", "US", "GB", "DE", "AU", "NG", "KE"]
        if random.random() < 0.02:
            return random.choice(["XX", "ZZ", ""])  # Bad data
        return random.choice(countries)

    # Region
    if name in ("REGION", "REGIO"):
        return random.choice(["GP", "WC", "KZN", "EC", "FS", "LP", "MP", "NW", "NC", ""])

    # City
    if name in ("CITY1", "ORT01"):
        return random.choice(["Johannesburg", "Cape Town", "Durban", "Pretoria", "Port Elizabeth", "Bloemfontein", "Sandton", "Midrand"])

    # Street / Address
    if name == "STREET":
        return f"{random.randint(1, 200)} {random.choice(['Main', 'Church', 'Voortrekker', 'Jan Smuts', 'Rivonia', 'Oxford'])} {random.choice(['Road', 'Street', 'Avenue', 'Drive'])}"

    # Postal code
    if name in ("POST_CODE1", "PSTLZ"):
        return str(random.randint(1000, 9999))

    # Email
    if name == "EMAIL":
        first = random.choice(["sipho", "thandi", "johan", "fatima", "pieter"])
        last = random.choice(["nkosi", "vdm", "dlamini", "botha", "molefe"])
        domain = random.choice(["company.co.za", "corp.com", "enterprise.co.za"])
        if random.random() < 0.03:
            return "invalid-email"  # Bad data
        return f"{first}.{last}@{domain}"

    # Date fields
    if "DATS" in ftype or "DATE" in name.upper():
        base = NOW - timedelta(days=random.randint(1, 1800))
        return base.strftime("%Y%m%d")

    # Currency
    if name in ("WAERS", "CURRENCY"):
        return random.choice(["ZAR", "ZAR", "ZAR", "USD", "EUR", "GBP"])

    # Decimal amounts
    if "DEC" in ftype:
        if "SALARY" in name or "PAY" in name:
            return round(random.uniform(180000, 2500000), 2)
        if "BALANCE" in name:
            return round(random.uniform(0, 30), 2)
        if "PCT" in name:
            return round(random.uniform(0, 25), 2)
        return round(random.uniform(0.1, 99999.99), 3)

    # Status fields
    if name == "STATUS":
        return random.choice(["A", "T", "A", "A"])

    # Generic CHAR fields
    if "CHAR" in ftype:
        # Look for domain values in checks
        return f"{module_code}_{name}_{index}"

    return ""


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — DATA QUALITY CHECK ENGINE (EMULATED)
# ═══════════════════════════════════════════════════════════════════════════

import re


def run_check(check: dict, row: dict) -> dict | None:
    """
    Run a single deterministic check against one row.
    Returns a finding dict if the check fails, None if it passes.
    """
    field = check["field"]
    value = row.get(field)
    ctype = check["type"]

    if ctype == CheckType.NULL_CHECK:
        if value is None or str(value).strip() == "":
            return _make_finding(check, row, f"Field '{field}' is null or empty")

    elif ctype == CheckType.DOMAIN_VALUE_CHECK:
        domain = check.get("domain", [])
        if value is not None and str(value) not in domain:
            return _make_finding(check, row, f"Value '{value}' not in allowed domain {domain}")

    elif ctype == CheckType.REGEX_CHECK:
        pattern = check.get("pattern", "")
        if value is not None and not re.match(pattern, str(value)):
            return _make_finding(check, row, f"Value '{value}' does not match pattern {pattern}")

    elif ctype == CheckType.CROSS_FIELD_CHECK:
        depends = check.get("depends_on")
        dep_val = row.get(depends)
        # Simplified cross-field: if dependency is set but target is empty
        if dep_val and (value is None or str(value).strip() == ""):
            return _make_finding(check, row, f"Field '{field}' empty but '{depends}' is set")

    elif ctype == CheckType.REFERENTIAL_CHECK:
        # In emulation, simulate ~5% referential failures
        if random.random() < 0.05:
            return _make_finding(check, row, f"Referential integrity violation: '{field}' not found in {check.get('ref_table')}")

    elif ctype == CheckType.FRESHNESS_CHECK:
        max_age = check.get("max_age_days", 365)
        if value:
            try:
                dt = datetime.strptime(str(value)[:8], "%Y%m%d")
                age = (NOW.replace(tzinfo=None) - dt).days
                if age > max_age:
                    return _make_finding(check, row, f"Field '{field}' is {age} days old (max {max_age})")
            except (ValueError, TypeError):
                pass

    return None


def _make_finding(check: dict, row: dict, message: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "check_id": check["id"],
        "check_type": check["type"].value if isinstance(check["type"], Enum) else check["type"],
        "field": check["field"],
        "severity": check["severity"],
        "description": check["desc"],
        "message": message,
        "row_key": str(row.get(next((f["name"] for m in SAP_MODULES for f in m.fields if f["name"] == m.key_field and m.checks and check in m.checks), "id"), "")),
        "created_at": NOW.isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — DAMA DMBOK SCORING
# ═══════════════════════════════════════════════════════════════════════════


def calculate_dqs(findings: list[dict], total_records: int, module_code: str) -> dict:
    """
    Calculate composite Data Quality Score using DAMA DMBOK methodology.
    Maps check types to dimensions, applies severity caps.
    """
    dimension_map = {
        CheckType.NULL_CHECK.value: "completeness",
        CheckType.DOMAIN_VALUE_CHECK.value: "validity",
        CheckType.REGEX_CHECK.value: "accuracy",
        CheckType.CROSS_FIELD_CHECK.value: "consistency",
        CheckType.REFERENTIAL_CHECK.value: "consistency",
        CheckType.FRESHNESS_CHECK.value: "timeliness",
    }

    dim_totals = {d: 0 for d in DAMA_WEIGHTS}
    dim_fails = {d: 0 for d in DAMA_WEIGHTS}

    for f in findings:
        dim = dimension_map.get(f["check_type"], "validity")
        dim_fails[dim] = dim_fails.get(dim, 0) + 1

    # Calculate per-dimension scores
    dim_scores = {}
    for dim in DAMA_WEIGHTS:
        if total_records > 0:
            fail_rate = dim_fails.get(dim, 0) / total_records
            dim_scores[dim] = max(0, round((1 - fail_rate) * 100, 1))
        else:
            dim_scores[dim] = 100.0

    # Weighted composite
    raw_dqs = sum(dim_scores[d] * DAMA_WEIGHTS[d] for d in DAMA_WEIGHTS)

    # Severity caps
    critical_count = sum(1 for f in findings if f["severity"] == "critical")
    if critical_count >= 2:
        raw_dqs = min(raw_dqs, 70.0)
    elif critical_count == 1:
        raw_dqs = min(raw_dqs, 85.0)

    return {
        "module": module_code,
        "composite_dqs": round(raw_dqs, 1),
        "dimension_scores": dim_scores,
        "total_records": total_records,
        "total_findings": len(findings),
        "critical_findings": critical_count,
        "high_findings": sum(1 for f in findings if f["severity"] == "high"),
        "medium_findings": sum(1 for f in findings if f["severity"] == "medium"),
        "low_findings": sum(1 for f in findings if f["severity"] == "low"),
        "scored_at": NOW.isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — GOLDEN RECORDS & MATCH/MERGE
# ═══════════════════════════════════════════════════════════════════════════


def generate_golden_records(module: SAPModule, rows: list[dict]) -> list[dict]:
    """
    Create golden records with survivorship rules applied.
    Simulates deterministic-first resolution with AI fallback flagging.
    """
    golden_records = []
    # Group potential duplicates (simulate blocking by first 3 chars of key)
    blocks: dict[str, list[dict]] = {}
    for row in rows[:200]:  # Cap for seed
        key = str(row.get(module.key_field, ""))[:3]
        blocks.setdefault(key, []).append(row)

    gr_index = 0
    for block_key, block_rows in blocks.items():
        if len(block_rows) < 1:
            continue
        # Pick the "best" record as golden (most recent / most complete)
        survivor = max(block_rows, key=lambda r: sum(1 for v in r.values() if v is not None))

        golden_records.append({
            "id": str(uuid.uuid4()),
            "module_code": module.code,
            "entity_type": module.name,
            "source_key": str(survivor.get(module.key_field, "")),
            "source_count": len(block_rows),
            "survivorship_method": random.choice(["most_recent", "trusted_source", "majority_vote"]),
            "ai_involved": random.random() < 0.1,  # 10% needed AI fallback
            "confidence_score": round(random.uniform(0.75, 1.0), 3),
            "fields": {f["name"]: survivor.get(f["name"]) for f in module.fields},
            "created_at": NOW.isoformat(),
            "updated_at": NOW.isoformat(),
        })
        gr_index += 1

    return golden_records


def generate_match_candidates(module: SAPModule, rows: list[dict]) -> list[dict]:
    """Generate dedup match candidates with weighted scoring."""
    candidates = []
    sample = rows[:100]

    for i in range(0, len(sample) - 1, 2):
        row_a, row_b = sample[i], sample[i + 1]
        score = round(random.uniform(0.55, 0.99), 3)
        threshold_action = "auto_merge" if score > 0.90 else ("manual_review" if score > 0.70 else "reject")

        candidates.append({
            "id": str(uuid.uuid4()),
            "module_code": module.code,
            "record_a_key": str(row_a.get(module.key_field, "")),
            "record_b_key": str(row_b.get(module.key_field, "")),
            "match_score": score,
            "action": threshold_action,
            "field_scores": {
                f["name"]: round(random.uniform(0.3, 1.0), 2)
                for f in module.fields[:5]
            },
            "blocking_key": str(row_a.get(module.key_field, ""))[:3],
            "ai_semantic_score": round(random.uniform(0.5, 1.0), 3) if score > 0.70 else None,
            "created_at": NOW.isoformat(),
        })

    return candidates


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — BUSINESS GLOSSARY
# ═══════════════════════════════════════════════════════════════════════════


def generate_glossary_terms(module: SAPModule) -> list[dict]:
    """Generate business glossary terms for every field in a module."""
    terms = []
    for fld in module.fields:
        terms.append({
            "id": str(uuid.uuid4()),
            "module_code": module.code,
            "sap_table": module.primary_table,
            "sap_field": fld["name"],
            "business_name": fld["sap_desc"],
            "definition": f"The {fld['sap_desc'].lower()} field in the {module.name} module. "
                          f"Stored in SAP table {module.primary_table} as {fld['type']}.",
            "why_it_matters": f"Critical for {module.name} data integrity and downstream reporting.",
            "sap_impact": f"Used in {module.category} transactions and referenced by dependent modules.",
            "s4hana_migration_flag": random.choice([True, False, False]),
            "approved_values": None,
            "data_steward": random.choice(["sipho.nkosi", "thandi.dlamini", "johan.botha", "fatima.patel"]),
            "status": random.choice(["approved", "approved", "draft", "review"]),
            "ai_drafted": random.random() < 0.3,
            "created_at": NOW.isoformat(),
        })
    return terms


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 — STEWARDSHIP WORKBENCH
# ═══════════════════════════════════════════════════════════════════════════


def generate_stewardship_tasks(findings: list[dict], module: SAPModule) -> list[dict]:
    """Generate stewardship queue items from findings with AI triage."""
    tasks = []
    for f in findings[:50]:  # Cap per module
        sla_tier = {"critical": 1, "high": 2, "medium": 3, "low": 4}.get(f["severity"], 3)
        sla_hours = {1: 4, 2: 24, 3: 72, 4: 168}[sla_tier]

        tasks.append({
            "id": str(uuid.uuid4()),
            "finding_id": f["id"],
            "module_code": module.code,
            "status": random.choice(["open", "open", "open", "in_progress", "resolved", "escalated"]),
            "priority": f["severity"],
            "assigned_to": random.choice(["sipho.nkosi", "thandi.dlamini", "johan.botha", "fatima.patel"]),
            "sla_tier": sla_tier,
            "sla_deadline": (NOW + timedelta(hours=sla_hours)).isoformat(),
            "ai_triage_action": random.choice([
                "auto_fix_suggested", "manual_review_required",
                "escalate_to_sap_admin", "defer_to_next_cycle",
            ]),
            "ai_triage_confidence": round(random.uniform(0.6, 0.95), 2),
            "resolution_notes": None,
            "created_at": NOW.isoformat(),
        })
    return tasks


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 9 — DATA CONTRACTS
# ═══════════════════════════════════════════════════════════════════════════


def generate_data_contracts(module: SAPModule) -> list[dict]:
    """Generate data contracts for schema, quality, freshness, and volume."""
    contracts = []
    contract_types = [
        ("schema", f"{module.primary_table} must contain all {len(module.fields)} mandatory fields"),
        ("quality", f"DQS must remain above 80% for {module.name}"),
        ("freshness", f"{module.primary_table} data must be refreshed within 24 hours"),
        ("volume", f"{module.primary_table} record count must be between {module.record_count // 2} and {module.record_count * 2}"),
    ]

    for ctype, description in contract_types:
        compliant = random.random() < 0.85
        contracts.append({
            "id": str(uuid.uuid4()),
            "module_code": module.code,
            "contract_type": ctype,
            "description": description,
            "is_compliant": compliant,
            "last_evaluated": NOW.isoformat(),
            "violation_count": 0 if compliant else random.randint(1, 5),
            "severity": "high" if ctype in ("schema", "quality") else "medium",
            "owner": random.choice(["data_governance_team", "sap_basis_team", "mdm_operations"]),
            "created_at": (NOW - timedelta(days=random.randint(30, 180))).isoformat(),
        })

    return contracts


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 10 — ANALYTICS ENGINE
# ═══════════════════════════════════════════════════════════════════════════


def generate_dqs_history(module_code: str, current_dqs: float) -> list[dict]:
    """Generate 90 days of DQS history for trend analysis and forecasting."""
    history = []
    score = max(40.0, current_dqs - random.uniform(5, 20))  # Start lower

    for day_offset in range(90, 0, -1):
        # Gradual improvement with noise
        score = min(100.0, score + random.uniform(-1.5, 2.5))
        history.append({
            "id": str(uuid.uuid4()),
            "module_code": module_code,
            "dqs_score": round(score, 1),
            "recorded_at": (NOW - timedelta(days=day_offset)).isoformat(),
        })

    return history


def generate_impact_records(findings: list[dict], module: SAPModule) -> list[dict]:
    """Generate cost impact analysis records in ZAR."""
    impacts = []
    cost_per_severity = {"critical": 15000, "high": 5000, "medium": 1500, "low": 500}

    for f in findings[:30]:
        base_cost = cost_per_severity.get(f["severity"], 1000)
        estimated_cost = round(base_cost * random.uniform(0.5, 3.0), 2)

        impacts.append({
            "id": str(uuid.uuid4()),
            "finding_id": f["id"],
            "module_code": module.code,
            "estimated_cost_zar": estimated_cost,
            "impact_category": random.choice(["operational_delay", "compliance_risk", "revenue_leakage", "audit_finding", "migration_blocker"]),
            "affected_processes": random.sample(
                ["procurement", "billing", "payroll", "reporting", "compliance", "logistics", "hr_admin"],
                k=random.randint(1, 3),
            ),
            "created_at": NOW.isoformat(),
        })

    return impacts


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 11 — CLEANING PIPELINE
# ═══════════════════════════════════════════════════════════════════════════


def generate_cleaning_rules(module: SAPModule) -> list[dict]:
    """Generate cleaning rules and queue items for the module."""
    rules = []
    rule_templates = [
        ("trim_whitespace", "Remove leading/trailing whitespace from {field}"),
        ("uppercase_country", "Normalise country codes to uppercase in {field}"),
        ("standardise_phone", "Standardise phone numbers to E.164 format in {field}"),
        ("fill_default", "Fill null {field} with configured default value"),
        ("deduplicate", "Remove exact-match duplicate records by {field}"),
    ]

    for template_id, template_desc in rule_templates[:3]:
        target_field = random.choice(module.fields)["name"]
        rules.append({
            "id": str(uuid.uuid4()),
            "module_code": module.code,
            "rule_type": template_id,
            "description": template_desc.format(field=target_field),
            "target_field": target_field,
            "is_active": True,
            "auto_apply": random.choice([True, False]),
            "records_affected": random.randint(10, 200),
            "created_at": NOW.isoformat(),
        })

    return rules


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 12 — EXCEPTION MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════


def generate_exceptions(findings: list[dict], module: SAPModule) -> list[dict]:
    """Generate exception items for the Kanban board."""
    exceptions = []
    critical_findings = [f for f in findings if f["severity"] in ("critical", "high")]

    for f in critical_findings[:20]:
        exceptions.append({
            "id": str(uuid.uuid4()),
            "finding_id": f["id"],
            "module_code": module.code,
            "title": f"[{f['check_id']}] {f['description'][:60]}",
            "status": random.choice(["new", "new", "investigating", "pending_fix", "resolved", "accepted_risk"]),
            "priority": f["severity"],
            "assigned_to": random.choice(["sipho.nkosi", "thandi.dlamini", "johan.botha", None]),
            "sla_tier": 1 if f["severity"] == "critical" else 2,
            "days_open": random.randint(0, 30),
            "resolution_type": None,
            "created_at": (NOW - timedelta(days=random.randint(0, 30))).isoformat(),
        })

    return exceptions


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 13 — SYNC ENGINE & SAP SYSTEM CONFIG
# ═══════════════════════════════════════════════════════════════════════════


def generate_sap_systems() -> list[dict]:
    """Generate emulated SAP system connection configurations."""
    return [
        {
            "id": str(uuid.uuid4()),
            "name": "SAP ECC Production",
            "system_type": "ECC",
            "connection_type": "rfc",
            "host": "10.0.1.50",
            "system_number": "00",
            "client": "100",
            "sap_user": "VANTAX_SVC",
            "sysid": "ERP",
            "status": "connected",
            "last_ping": NOW.isoformat(),
            "modules_enabled": ["BP", "MM", "GL", "SD", "PM", "PP"],
        },
        {
            "id": str(uuid.uuid4()),
            "name": "SAP SuccessFactors",
            "system_type": "SuccessFactors",
            "connection_type": "odata",
            "host": "api.successfactors.com",
            "system_number": "N/A",
            "client": "sfTenant001",
            "sap_user": "VANTAX_API",
            "sysid": "SFP",
            "status": "connected",
            "last_ping": NOW.isoformat(),
            "modules_enabled": ["EC", "COMP", "PAY", "TNA"],
        },
        {
            "id": str(uuid.uuid4()),
            "name": "SAP EWM Production",
            "system_type": "Warehouse",
            "connection_type": "rfc",
            "host": "10.0.1.55",
            "system_number": "01",
            "client": "200",
            "sap_user": "VANTAX_WM",
            "sysid": "EWM",
            "status": "connected",
            "last_ping": NOW.isoformat(),
            "modules_enabled": ["WM", "BATCH"],
        },
    ]


def generate_sync_profiles(modules: list[SAPModule]) -> list[dict]:
    """Generate sync profiles for scheduled SAP extraction."""
    profiles = []
    for mod in modules:
        profiles.append({
            "id": str(uuid.uuid4()),
            "module_code": mod.code,
            "table_name": mod.primary_table,
            "schedule_cron": random.choice(["0 2 * * *", "0 6 * * *", "0 */4 * * *", "0 0 * * 1"]),
            "last_run": (NOW - timedelta(hours=random.randint(1, 48))).isoformat(),
            "last_run_status": random.choice(["success", "success", "success", "partial", "failed"]),
            "records_synced": random.randint(100, mod.record_count),
            "ai_anomaly_detected": random.random() < 0.1,
            "ai_quality_score": round(random.uniform(0.7, 1.0), 3),
            "created_at": (NOW - timedelta(days=random.randint(30, 90))).isoformat(),
        })
    return profiles


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 14 — NOTIFICATIONS & AUDIT
# ═══════════════════════════════════════════════════════════════════════════


def generate_notifications(modules: list[SAPModule]) -> list[dict]:
    """Generate notification records across all channels."""
    notifications = []
    templates = [
        ("daily_digest", "Daily DQS digest for {module} — score: {score}%"),
        ("exception_alert", "New critical exception in {module}: {desc}"),
        ("sync_complete", "Sync completed for {module} — {count} records processed"),
        ("contract_violation", "Data contract violation in {module}: {desc}"),
        ("steward_assignment", "New stewardship task assigned in {module}"),
    ]

    for mod in modules:
        for _ in range(random.randint(2, 5)):
            tmpl = random.choice(templates)
            notifications.append({
                "id": str(uuid.uuid4()),
                "channel": random.choice(NOTIFICATION_CHANNELS),
                "trigger": tmpl[0],
                "module_code": mod.code,
                "message": tmpl[1].format(
                    module=mod.name,
                    score=round(random.uniform(65, 98), 1),
                    desc=f"{mod.code} data quality check failed",
                    count=random.randint(100, 2000),
                ),
                "is_read": random.choice([True, False]),
                "created_at": (NOW - timedelta(hours=random.randint(1, 168))).isoformat(),
            })

    return notifications


def generate_llm_audit_log(module_count: int) -> list[dict]:
    """Generate LLM audit log entries for AI-assisted features."""
    entries = []
    ai_features = [
        "ai_survivorship", "ai_semantic_matcher", "ai_impact_scorer",
        "ai_glossary_enricher", "ai_triage", "ai_health_narrative",
        "ai_sync_quality", "rule_proposal_task",
    ]

    for _ in range(module_count * 3):
        feature = random.choice(ai_features)
        prompt_text = f"Analyse {feature} for module data quality findings"
        entries.append({
            "id": str(uuid.uuid4()),
            "feature": feature,
            "provider": random.choice(["ollama", "ollama", "ollama", "anthropic"]),
            "model": random.choice(["llama3.1:70b", "llama3.1:70b", "claude-sonnet-4-20250514"]),
            "prompt_hash": hashlib.sha256(prompt_text.encode()).hexdigest()[:16],
            "token_count_input": random.randint(200, 2000),
            "token_count_output": random.randint(100, 1500),
            "latency_ms": random.randint(500, 8000),
            "status": random.choice(["success", "success", "success", "error"]),
            "created_at": (NOW - timedelta(hours=random.randint(0, 72))).isoformat(),
        })

    return entries


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 15 — USERS & RBAC
# ═══════════════════════════════════════════════════════════════════════════


def generate_users() -> list[dict]:
    """Generate users across all RBAC roles."""
    users = [
        {"username": "sipho.nkosi",     "email": "sipho.nkosi@company.co.za",     "role": "admin",    "full_name": "Sipho Nkosi"},
        {"username": "thandi.dlamini",  "email": "thandi.dlamini@company.co.za",  "role": "steward",  "full_name": "Thandi Dlamini"},
        {"username": "johan.botha",     "email": "johan.botha@company.co.za",     "role": "steward",  "full_name": "Johan Botha"},
        {"username": "fatima.patel",    "email": "fatima.patel@company.co.za",    "role": "analyst",  "full_name": "Fatima Patel"},
        {"username": "pieter.kruger",   "email": "pieter.kruger@company.co.za",   "role": "analyst",  "full_name": "Pieter Kruger"},
        {"username": "naledi.molefe",   "email": "naledi.molefe@company.co.za",   "role": "viewer",   "full_name": "Naledi Molefe"},
        {"username": "ahmed.jacobs",    "email": "ahmed.jacobs@company.co.za",    "role": "viewer",   "full_name": "Ahmed Jacobs"},
    ]
    for u in users:
        u["id"] = str(uuid.uuid4())
        u["is_active"] = True
        u["created_at"] = (NOW - timedelta(days=random.randint(30, 180))).isoformat()
    return users


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 16 — NLP QUERY EXAMPLES
# ═══════════════════════════════════════════════════════════════════════════


def generate_nlp_examples() -> list[dict]:
    """Pre-seed NLP query examples for the 'Ask Meridian' interface."""
    return [
        {"query": "What is the current DQS for Business Partner?", "intent": "dqs_lookup", "module_filter": "BP"},
        {"query": "Show me all critical findings in Material Master", "intent": "finding_search", "module_filter": "MM"},
        {"query": "How many duplicate customers exist?", "intent": "dedup_count", "module_filter": "SD"},
        {"query": "What is the average payroll accuracy score?", "intent": "dqs_dimension", "module_filter": "PAY"},
        {"query": "List all golden records with AI survivorship", "intent": "golden_record_search", "module_filter": None},
        {"query": "Which modules have data contract violations?", "intent": "contract_compliance", "module_filter": None},
        {"query": "Show cost impact for GL Account issues", "intent": "impact_analysis", "module_filter": "GL"},
        {"query": "What exceptions are overdue in Employee Central?", "intent": "exception_search", "module_filter": "EC"},
        {"query": "Trending DQS for Warehouse modules this quarter", "intent": "trend_analysis", "module_filter": None},
        {"query": "Who is the steward responsible for Batch Management?", "intent": "steward_lookup", "module_filter": "BATCH"},
    ]


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 17 — COLUMN MAPPING (column_map.yaml emulation)
# ═══════════════════════════════════════════════════════════════════════════


def generate_column_maps(modules: list[SAPModule]) -> dict[str, dict]:
    """Generate column mapping configs for each module (mirrors column_map.yaml)."""
    maps = {}
    for mod in modules:
        maps[mod.code] = {
            "module": mod.code,
            "sap_table": mod.primary_table,
            "mappings": {
                f["name"]: {
                    "display_name": f["sap_desc"],
                    "type": f["type"],
                    "aliases": [f["name"].lower(), f["sap_desc"].lower().replace(" ", "_")],
                    "is_key": f["name"] == mod.key_field,
                    "nullable": f["name"] != mod.key_field,
                }
                for f in mod.fields
            },
        }
    return maps


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 18 — RECORD RELATIONSHIPS (cross-domain)
# ═══════════════════════════════════════════════════════════════════════════


def generate_relationships() -> list[dict]:
    """Generate cross-domain SAP record relationships."""
    rels = [
        {"source_module": "BP", "target_module": "SD", "relationship": "customer_is_bp", "field_link": "PARTNER→KUNNR", "cardinality": "1:N"},
        {"source_module": "MM", "target_module": "WM", "relationship": "material_in_warehouse", "field_link": "MATNR→MATNR", "cardinality": "1:N"},
        {"source_module": "MM", "target_module": "BATCH", "relationship": "material_has_batches", "field_link": "MATNR→MATNR", "cardinality": "1:N"},
        {"source_module": "MM", "target_module": "PP", "relationship": "material_in_routing", "field_link": "MATNR→MATNR", "cardinality": "1:N"},
        {"source_module": "EC", "target_module": "COMP", "relationship": "employee_compensation", "field_link": "PERSON_ID_EXTERNAL→PERSON_ID_EXTERNAL", "cardinality": "1:N"},
        {"source_module": "EC", "target_module": "PAY", "relationship": "employee_payroll", "field_link": "PERSON_ID_EXTERNAL→PERSON_ID_EXTERNAL", "cardinality": "1:N"},
        {"source_module": "EC", "target_module": "TNA", "relationship": "employee_time", "field_link": "PERSON_ID_EXTERNAL→PERSON_ID_EXTERNAL", "cardinality": "1:N"},
        {"source_module": "GL", "target_module": "PM", "relationship": "cost_centre_equipment", "field_link": "SAKNR→KOSTL", "cardinality": "M:N"},
        {"source_module": "PM", "target_module": "PP", "relationship": "equipment_routing", "field_link": "EQUNR→PLNNR", "cardinality": "1:N"},
        {"source_module": "BP", "target_module": "GL", "relationship": "bp_account_assignment", "field_link": "PARTNER→SAKNR", "cardinality": "M:N"},
    ]
    for r in rels:
        r["id"] = str(uuid.uuid4())
        r["record_count"] = random.randint(50, 500)
        r["created_at"] = NOW.isoformat()
    return rels


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 19 — MAIN ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════════════


def run_seed(tenant_id: str, db_url: str, dry_run: bool = False) -> dict:
    """
    Main seed orchestrator. Emulates full SAP connectivity and populates
    every Meridian feature with realistic data.

    Returns a summary dict with counts for all seeded entities.
    """
    log.info("=" * 72)
    log.info("VANTAX SAP EMULATOR SEED — Starting")
    log.info(f"Tenant: {tenant_id}")
    log.info(f"Modules: {len(SAP_MODULES)}")
    log.info(f"Dry run: {dry_run}")
    log.info("=" * 72)

    summary: dict[str, Any] = {
        "tenant_id": tenant_id,
        "modules_seeded": 0,
        "total_records_generated": 0,
        "total_findings": 0,
        "total_golden_records": 0,
        "total_match_candidates": 0,
        "total_glossary_terms": 0,
        "total_stewardship_tasks": 0,
        "total_data_contracts": 0,
        "total_dqs_history_points": 0,
        "total_impact_records": 0,
        "total_cleaning_rules": 0,
        "total_exceptions": 0,
        "total_sync_profiles": 0,
        "total_notifications": 0,
        "total_llm_audit_entries": 0,
        "total_users": 0,
        "total_nlp_examples": 0,
        "total_relationships": 0,
        "module_scores": {},
    }

    # ── Step 1: Establish emulated SAP connections ─────────────────────────
    sap_connections = {
        "ECC": EmulatedSAPConnection(SAPConnectionConfig(ashost="10.0.1.50", sysid="ERP", client="100")),
        "SuccessFactors": EmulatedSAPConnection(SAPConnectionConfig(ashost="api.successfactors.com", sysid="SFP", client="sfTenant001")),
        "Warehouse": EmulatedSAPConnection(SAPConnectionConfig(ashost="10.0.1.55", sysid="EWM", client="200")),
    }
    for name, conn in sap_connections.items():
        conn.open()
        ping = conn.ping()
        log.info(f"[SAP] {name} ping: {ping['status']}")

    # ── Step 2: Generate SAP system configs ────────────────────────────────
    sap_systems = generate_sap_systems()
    log.info(f"[Systems] Generated {len(sap_systems)} SAP system configs")

    # ── Step 3: Seed users ─────────────────────────────────────────────────
    users = generate_users()
    summary["total_users"] = len(users)
    log.info(f"[Users] Generated {len(users)} users across {len(set(u['role'] for u in users))} roles")

    # ── Step 4: Process each SAP module ────────────────────────────────────
    all_findings: list[dict] = []
    all_golden_records: list[dict] = []
    all_match_candidates: list[dict] = []
    all_glossary_terms: list[dict] = []
    all_stewardship_tasks: list[dict] = []
    all_data_contracts: list[dict] = []
    all_dqs_history: list[dict] = []
    all_impact_records: list[dict] = []
    all_cleaning_rules: list[dict] = []
    all_exceptions: list[dict] = []

    for module in SAP_MODULES:
        log.info(f"\n{'─' * 60}")
        log.info(f"[Module] Processing {module.code} — {module.name} ({module.category})")
        log.info(f"{'─' * 60}")

        # 4a: Extract data via emulated RFC
        conn = sap_connections[module.category]
        result = conn.call(
            "RFC_READ_TABLE",
            QUERY_TABLE=module.primary_table,
            ROWCOUNT=min(module.record_count, 200),  # Cap for seed performance
        )
        rows = [_generate_sap_row(module, i) for i in range(min(module.record_count, 200))]
        summary["total_records_generated"] += len(rows)
        log.info(f"  Records extracted: {len(rows)}")

        # 4b: Run deterministic checks
        module_findings = []
        for row in rows:
            for check in module.checks:
                finding = run_check(check, row)
                if finding:
                    finding["module_code"] = module.code
                    finding["tenant_id"] = tenant_id
                    module_findings.append(finding)

        all_findings.extend(module_findings)
        summary["total_findings"] += len(module_findings)
        log.info(f"  Findings generated: {len(module_findings)}")

        # 4c: Calculate DQS
        dqs = calculate_dqs(module_findings, len(rows), module.code)
        summary["module_scores"][module.code] = dqs
        log.info(f"  DQS Score: {dqs['composite_dqs']}% "
                 f"(C:{dqs['critical_findings']} H:{dqs['high_findings']} "
                 f"M:{dqs['medium_findings']} L:{dqs['low_findings']})")

        # 4d: Golden records & match/merge
        golden_records = generate_golden_records(module, rows)
        all_golden_records.extend(golden_records)
        summary["total_golden_records"] += len(golden_records)

        match_candidates = generate_match_candidates(module, rows)
        all_match_candidates.extend(match_candidates)
        summary["total_match_candidates"] += len(match_candidates)
        log.info(f"  Golden records: {len(golden_records)}, Match candidates: {len(match_candidates)}")

        # 4e: Business glossary
        glossary = generate_glossary_terms(module)
        all_glossary_terms.extend(glossary)
        summary["total_glossary_terms"] += len(glossary)

        # 4f: Stewardship tasks
        tasks = generate_stewardship_tasks(module_findings, module)
        all_stewardship_tasks.extend(tasks)
        summary["total_stewardship_tasks"] += len(tasks)

        # 4g: Data contracts
        contracts = generate_data_contracts(module)
        all_data_contracts.extend(contracts)
        summary["total_data_contracts"] += len(contracts)

        # 4h: DQS history (90 days)
        history = generate_dqs_history(module.code, dqs["composite_dqs"])
        all_dqs_history.extend(history)
        summary["total_dqs_history_points"] += len(history)

        # 4i: Impact records
        impacts = generate_impact_records(module_findings, module)
        all_impact_records.extend(impacts)
        summary["total_impact_records"] += len(impacts)

        # 4j: Cleaning rules
        rules = generate_cleaning_rules(module)
        all_cleaning_rules.extend(rules)
        summary["total_cleaning_rules"] += len(rules)

        # 4k: Exceptions
        exceptions = generate_exceptions(module_findings, module)
        all_exceptions.extend(exceptions)
        summary["total_exceptions"] += len(exceptions)

        summary["modules_seeded"] += 1

    # ── Step 5: Sync profiles ──────────────────────────────────────────────
    sync_profiles = generate_sync_profiles(SAP_MODULES)
    summary["total_sync_profiles"] = len(sync_profiles)

    # ── Step 6: Notifications ──────────────────────────────────────────────
    notifications = generate_notifications(SAP_MODULES)
    summary["total_notifications"] = len(notifications)

    # ── Step 7: LLM audit log ──────────────────────────────────────────────
    audit_log = generate_llm_audit_log(len(SAP_MODULES))
    summary["total_llm_audit_entries"] = len(audit_log)

    # ── Step 8: NLP examples ───────────────────────────────────────────────
    nlp_examples = generate_nlp_examples()
    summary["total_nlp_examples"] = len(nlp_examples)

    # ── Step 9: Column maps ────────────────────────────────────────────────
    column_maps = generate_column_maps(SAP_MODULES)

    # ── Step 10: Cross-domain relationships ────────────────────────────────
    relationships = generate_relationships()
    summary["total_relationships"] = len(relationships)

    # ── Step 11: Close SAP connections ─────────────────────────────────────
    for conn in sap_connections.values():
        conn.close()

    # ── Step 12: Persist to database (or dump as JSON in dry-run) ──────────
    seed_payload = {
        "tenant_id": tenant_id,
        "sap_systems": sap_systems,
        "users": users,
        "findings": all_findings,
        "golden_records": all_golden_records,
        "match_candidates": all_match_candidates,
        "glossary_terms": all_glossary_terms,
        "stewardship_tasks": all_stewardship_tasks,
        "data_contracts": all_data_contracts,
        "dqs_history": all_dqs_history,
        "impact_records": all_impact_records,
        "cleaning_rules": all_cleaning_rules,
        "exceptions": all_exceptions,
        "sync_profiles": sync_profiles,
        "notifications": notifications,
        "llm_audit_log": audit_log,
        "nlp_examples": nlp_examples,
        "column_maps": column_maps,
        "relationships": relationships,
        "module_scores": summary["module_scores"],
    }

    if dry_run:
        output_path = "seed_output.json"
        with open(output_path, "w") as f:
            json.dump(seed_payload, f, indent=2, default=str)
        log.info(f"\n[DRY RUN] Seed payload written to {output_path}")
    elif HAS_PSYCOPG2:
        _persist_to_database(db_url, tenant_id, seed_payload)
    else:
        log.warning("psycopg2 not installed — falling back to JSON output")
        with open("seed_output.json", "w") as f:
            json.dump(seed_payload, f, indent=2, default=str)

    # ── Print summary ──────────────────────────────────────────────────────
    log.info("\n" + "=" * 72)
    log.info("VANTAX SAP EMULATOR SEED — Complete")
    log.info("=" * 72)

    for key, value in summary.items():
        if key == "module_scores":
            continue
        log.info(f"  {key}: {value}")

    log.info("\n  Module DQS Scores:")
    for code, score_data in summary["module_scores"].items():
        mod_name = next((m.name for m in SAP_MODULES if m.code == code), code)
        log.info(f"    {code:6s} {mod_name:25s} DQS: {score_data['composite_dqs']:5.1f}%  "
                 f"Findings: {score_data['total_findings']:4d}")

    return summary


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 20 — DATABASE PERSISTENCE
# ═══════════════════════════════════════════════════════════════════════════


def _persist_to_database(db_url: str, tenant_id: str, payload: dict) -> None:
    """
    Insert seed data into the Meridian PostgreSQL database.
    Matches actual schema from Alembic migrations.
    Uses ON CONFLICT guards for idempotent re-runs (Celery-style).
    Sets app.tenant_id for RLS compliance.
    """
    log.info(f"[DB] Connecting to {db_url.split('@')[-1] if '@' in db_url else db_url}")

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # Set tenant context for RLS
        cur.execute("SET app.tenant_id = %s", (tenant_id,))

        # ── Tenants (skip if exists — "Dev Tenant" already there) ──────────
        cur.execute("""
            INSERT INTO tenants (id, name) VALUES (%s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (tenant_id, "Seed Tenant — Entity Oz Demo"))

        # ── Users ──────────────────────────────────────────────────────────
        # Schema: id, tenant_id, clerk_user_id, email, name, role, permissions, is_active, last_login, created_at
        user_ids = {}
        for u in payload["users"]:
            cur.execute("""
                INSERT INTO users (id, tenant_id, email, name, role, is_active, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (u["id"], tenant_id, u["email"], u["full_name"], u["role"], u["is_active"], u["created_at"]))
            user_ids[u["email"]] = u["id"]
        log.info(f"[DB] Inserted {len(payload['users'])} users")

        # ── SAP Systems ────────────────────────────────────────────────────
        # Schema: id, tenant_id, name, host, client, sysnr, description, environment, is_active, created_at, updated_at
        sap_system_ids = {}
        for s in payload["sap_systems"]:
            cur.execute("""
                INSERT INTO sap_systems (id, tenant_id, name, host, client, sysnr, description, environment, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (
                s["id"], tenant_id, s["name"], s["host"], s["client"],
                s.get("system_number", "00"), f"{s['system_type']} — {s['sysid']}",
                "DEV", True, NOW, NOW,
            ))
            sap_system_ids[s["system_type"]] = s["id"]
        log.info(f"[DB] Inserted {len(payload['sap_systems'])} SAP systems")

        # ── Analysis Versions (findings FK dependency) ─────────────────────
        # Schema: id, tenant_id, run_at, label, dqs_summary, metadata, status, ai_quality_score, anomaly_flags
        version_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO analysis_versions (id, tenant_id, run_at, label, dqs_summary, status)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (
            version_id, tenant_id, NOW, "SAP Emulator Seed Run",
            json.dumps(payload["module_scores"], default=str), "completed",
        ))
        log.info(f"[DB] Inserted analysis version {version_id[:8]}...")

        # ── Findings ───────────────────────────────────────────────────────
        # Schema: id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, total_count, pass_rate, details, remediation_text, created_at
        dimension_map = {
            "null_check": "completeness",
            "domain_value_check": "validity",
            "regex_check": "accuracy",
            "cross_field_check": "consistency",
            "referential_check": "consistency",
            "freshness_check": "timeliness",
        }
        if payload["findings"]:
            finding_rows = []
            seen_checks = set()
            for f in payload["findings"]:
                # Unique constraint: (version_id, check_id, tenant_id) — deduplicate
                dedup_key = (version_id, f["check_id"], tenant_id)
                if dedup_key in seen_checks:
                    continue
                seen_checks.add(dedup_key)

                dimension = dimension_map.get(f["check_type"], "validity")
                # Count how many findings share this check_id for affected_count
                affected = sum(1 for ff in payload["findings"] if ff["check_id"] == f["check_id"] and ff["module_code"] == f["module_code"])
                module_total = next((m.record_count for m in SAP_MODULES if m.code == f["module_code"]), 200)
                pass_rate = round(max(0, (1 - affected / min(module_total, 200)) * 100), 2)

                finding_rows.append((
                    f["id"], version_id, tenant_id, f["module_code"], f["check_id"],
                    f["severity"], dimension, affected, min(module_total, 200), pass_rate,
                    json.dumps({"message": f["message"], "field": f["field"], "check_type": f["check_type"]}),
                    f"Review {f['field']} in {f['module_code']} module", f["created_at"],
                ))

            psycopg2.extras.execute_values(cur, """
                INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension, affected_count, total_count, pass_rate, details, remediation_text, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, finding_rows)
            log.info(f"[DB] Inserted {len(finding_rows)} findings (deduplicated from {len(payload['findings'])})")

        # ── Golden Records (master_records) ────────────────────────────────
        # Schema: id, tenant_id, domain, sap_object_key, golden_fields, source_contributions, overall_confidence, status, promoted_at, promoted_by, created_at, updated_at
        if payload["golden_records"]:
            gr_rows = []
            seen_keys = set()
            for g in payload["golden_records"]:
                dedup_key = (tenant_id, g["module_code"], g["source_key"])
                if dedup_key in seen_keys:
                    continue
                seen_keys.add(dedup_key)

                status = "promoted" if g["confidence_score"] > 0.9 else "candidate"
                gr_rows.append((
                    g["id"], tenant_id, g["module_code"], g["source_key"],
                    json.dumps(g["fields"], default=str),
                    json.dumps({"source_count": g["source_count"], "method": g["survivorship_method"], "ai_involved": g["ai_involved"]}),
                    g["confidence_score"], status,
                    NOW if status == "promoted" else None,
                    None,  # promoted_by
                    g["created_at"], g["updated_at"],
                ))

            psycopg2.extras.execute_values(cur, """
                INSERT INTO master_records (id, tenant_id, domain, sap_object_key, golden_fields, source_contributions, overall_confidence, status, promoted_at, promoted_by, created_at, updated_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, gr_rows)
            log.info(f"[DB] Inserted {len(gr_rows)} golden records")

        # ── Match Scores ───────────────────────────────────────────────────
        # Schema: id, tenant_id, candidate_a_key, candidate_b_key, domain, total_score, field_scores, ai_semantic_score, auto_action, reviewed_by, reviewed_at, created_at
        if payload["match_candidates"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO match_scores (id, tenant_id, candidate_a_key, candidate_b_key, domain, total_score, field_scores, ai_semantic_score, auto_action, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    m["id"], tenant_id, m["record_a_key"], m["record_b_key"],
                    m["module_code"], m["match_score"],
                    json.dumps(m["field_scores"]), m.get("ai_semantic_score"),
                    m["action"], m["created_at"],
                )
                for m in payload["match_candidates"]
            ])
            log.info(f"[DB] Inserted {len(payload['match_candidates'])} match scores")

        # ── Dedup Candidates ───────────────────────────────────────────────
        # Schema: id, tenant_id, object_type, record_key_a, record_key_b, match_score, match_method, match_fields, status, survivor_key, merged_at, merged_by, created_at
        if payload["match_candidates"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO dedup_candidates (id, tenant_id, object_type, record_key_a, record_key_b, match_score, match_method, match_fields, status, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    str(uuid.uuid4()), tenant_id, m["module_code"],
                    m["record_a_key"], m["record_b_key"], m["match_score"],
                    "weighted_field" if not m.get("ai_semantic_score") else "ai_semantic",
                    json.dumps(m["field_scores"]),
                    "auto_merged" if m["action"] == "auto_merge" else "pending",
                    m["created_at"],
                )
                for m in payload["match_candidates"]
            ])
            log.info(f"[DB] Inserted {len(payload['match_candidates'])} dedup candidates")

        # ── Glossary Terms ─────────────────────────────────────────────────
        # Schema: id, tenant_id, domain, sap_table, sap_field, technical_name, business_name, business_definition, why_it_matters, sap_impact, approved_values, mandatory_for_s4hana, rule_authority, data_steward_id, review_cycle_days, last_reviewed_at, status, ai_drafted, created_at, updated_at
        if payload["glossary_terms"]:
            # Map steward names to user IDs
            steward_email_map = {
                "sipho.nkosi": "sipho.nkosi@company.co.za",
                "thandi.dlamini": "thandi.dlamini@company.co.za",
                "johan.botha": "johan.botha@company.co.za",
                "fatima.patel": "fatima.patel@company.co.za",
            }

            psycopg2.extras.execute_values(cur, """
                INSERT INTO glossary_terms (id, tenant_id, domain, sap_table, sap_field, technical_name, business_name, business_definition, why_it_matters, sap_impact, mandatory_for_s4hana, data_steward_id, status, ai_drafted, created_at, updated_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    g["id"], tenant_id, g["module_code"], g["sap_table"], g["sap_field"],
                    g["sap_field"],  # technical_name
                    g["business_name"], g["definition"], g["why_it_matters"], g["sap_impact"],
                    g.get("s4hana_migration_flag", False),
                    user_ids.get(steward_email_map.get(g.get("data_steward", ""), ""), None),
                    g["status"], g.get("ai_drafted", False), g["created_at"], NOW,
                )
                for g in payload["glossary_terms"]
            ])
            log.info(f"[DB] Inserted {len(payload['glossary_terms'])} glossary terms")

        # ── Stewardship Queue ──────────────────────────────────────────────
        # Schema: id, tenant_id, item_type, source_id, domain, priority(int), due_at, assigned_to(uuid), status, sla_hours, created_at, updated_at, ai_recommendation, ai_confidence
        if payload["stewardship_tasks"]:
            priority_map = {"critical": 1, "high": 2, "medium": 3, "low": 4}
            steward_ids = [uid for uid in user_ids.values()]

            psycopg2.extras.execute_values(cur, """
                INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, due_at, assigned_to, status, sla_hours, created_at, updated_at, ai_recommendation, ai_confidence)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    t["id"], tenant_id, "finding", t["finding_id"], t["module_code"],
                    priority_map.get(t["priority"], 3),
                    t["sla_deadline"],
                    random.choice(steward_ids) if steward_ids else None,
                    t["status"],
                    {1: 4, 2: 24, 3: 72, 4: 168}.get(t["sla_tier"], 72),
                    t["created_at"], NOW,
                    t["ai_triage_action"], t["ai_triage_confidence"],
                )
                for t in payload["stewardship_tasks"]
            ])
            log.info(f"[DB] Inserted {len(payload['stewardship_tasks'])} stewardship tasks")

        # ── Data Contracts ─────────────────────────────────────────────────
        # Schema: id, tenant_id, name, description, producer, consumer, schema_contract, quality_contract, freshness_contract, volume_contract, status, created_by, approved_by, created_at, activated_at, expires_at
        if payload["data_contracts"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO contracts (id, tenant_id, name, description, producer, consumer, schema_contract, quality_contract, freshness_contract, volume_contract, status, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    c["id"], tenant_id,
                    f"{c['module_code']} {c['contract_type'].title()} Contract",
                    c["description"],
                    f"SAP {c['module_code']}", "Meridian",
                    json.dumps({"enforced": True}) if c["contract_type"] == "schema" else None,
                    json.dumps({"min_dqs": 80}) if c["contract_type"] == "quality" else None,
                    json.dumps({"max_age_hours": 24}) if c["contract_type"] == "freshness" else None,
                    json.dumps({"min_records": 100, "max_records": 10000}) if c["contract_type"] == "volume" else None,
                    "active" if c["is_compliant"] else "violated",
                    c["created_at"],
                )
                for c in payload["data_contracts"]
            ])
            log.info(f"[DB] Inserted {len(payload['data_contracts'])} data contracts")

        # ── DQS History ────────────────────────────────────────────────────
        # Schema: id, tenant_id, module_id, dqs_score, completeness, accuracy, consistency, timeliness, uniqueness, validity, finding_count, recorded_at
        if payload["dqs_history"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO dqs_history (id, tenant_id, module_id, dqs_score, completeness, accuracy, consistency, timeliness, uniqueness, validity, finding_count, recorded_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    h["id"], tenant_id, h["module_code"], h["dqs_score"],
                    round(random.uniform(70, 100), 1),  # completeness
                    round(random.uniform(70, 100), 1),  # accuracy
                    round(random.uniform(65, 100), 1),  # consistency
                    round(random.uniform(75, 100), 1),  # timeliness
                    round(random.uniform(80, 100), 1),  # uniqueness
                    round(random.uniform(75, 100), 1),  # validity
                    random.randint(5, 100),  # finding_count
                    h["recorded_at"],
                )
                for h in payload["dqs_history"]
            ])
            log.info(f"[DB] Inserted {len(payload['dqs_history'])} DQS history points")

        # ── Impact Records ─────────────────────────────────────────────────
        # Schema: id, tenant_id, version_id, category, description, annual_risk_zar, mitigated_zar, finding_count, calculation_method, recorded_at
        if payload["impact_records"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO impact_records (id, tenant_id, version_id, category, description, annual_risk_zar, mitigated_zar, finding_count, calculation_method, recorded_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    i["id"], tenant_id, version_id,
                    i["impact_category"],
                    f"{i['module_code']}: {i['impact_category'].replace('_', ' ').title()}",
                    i["estimated_cost_zar"],
                    round(i["estimated_cost_zar"] * random.uniform(0.1, 0.5), 2),
                    random.randint(1, 20),
                    "severity_weighted",
                    NOW,
                )
                for i in payload["impact_records"]
            ])
            log.info(f"[DB] Inserted {len(payload['impact_records'])} impact records")

        # ── Cleaning Rules ─────────────────────────────────────────────────
        # Schema: id, object_type, category, name, description, detection_logic, correction_logic, risk_level, automation_level, approval_required, is_active, tenant_id, created_at
        if payload["cleaning_rules"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO cleaning_rules (id, tenant_id, object_type, category, name, description, detection_logic, correction_logic, risk_level, automation_level, is_active, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    r["id"], tenant_id, r["module_code"],
                    r["rule_type"],
                    f"{r['module_code']}_{r['rule_type']}",
                    r["description"],
                    f"SELECT * FROM staging WHERE {r['target_field']} IS NULL OR {r['target_field']} = ''",
                    f"UPDATE staging SET {r['target_field']} = TRIM({r['target_field']})",
                    random.choice(["low", "medium", "high"]),
                    "auto" if r.get("auto_apply") else "single_approval",
                    True, r["created_at"],
                )
                for r in payload["cleaning_rules"]
            ])
            log.info(f"[DB] Inserted {len(payload['cleaning_rules'])} cleaning rules")

        # ── Exceptions ─────────────────────────────────────────────────────
        # Schema: id, tenant_id, type, category, severity, status, title, description, source_system, source_reference, affected_records, estimated_impact_zar, assigned_to, escalation_tier, sla_deadline, root_cause_category, resolution_type, resolution_notes, linked_finding_id, created_at
        if payload["exceptions"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO exceptions (id, tenant_id, type, category, severity, status, title, description, source_system, estimated_impact_zar, assigned_to, escalation_tier, sla_deadline, linked_finding_id, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    e["id"], tenant_id,
                    "data_quality",
                    e["module_code"],
                    e["priority"],
                    e["status"],
                    e["title"],
                    f"Data quality exception in {e['module_code']}: {e['title']}",
                    f"SAP {e['module_code']}",
                    round(random.uniform(1000, 50000), 2),
                    random.choice(list(user_ids.values())) if user_ids and e.get("assigned_to") else None,
                    e.get("sla_tier", 1),
                    (NOW + timedelta(hours={1: 4, 2: 24}.get(e.get("sla_tier", 1), 72))).isoformat(),
                    # linked_finding_id — link to first finding with matching check
                    None,  # Can't reliably FK without knowing which deduplicated finding survived
                    e["created_at"],
                )
                for e in payload["exceptions"]
            ])
            log.info(f"[DB] Inserted {len(payload['exceptions'])} exceptions")

        # ── Sync Profiles ──────────────────────────────────────────────────
        # Schema: id, tenant_id, system_id, domain, tables(text[]), schedule_cron, active, last_run_at, next_run_at, ai_anomaly_baseline
        if payload["sync_profiles"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO sync_profiles (id, tenant_id, system_id, domain, tables, schedule_cron, active, last_run_at, next_run_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    sp["id"], tenant_id,
                    sap_system_ids.get(
                        next((m.category for m in SAP_MODULES if m.code == sp["module_code"]), "ECC"),
                        list(sap_system_ids.values())[0],
                    ),
                    sp["module_code"],
                    [sp["table_name"]],  # text[] array
                    sp["schedule_cron"],
                    True,
                    sp["last_run"],
                    (NOW + timedelta(hours=random.randint(1, 24))).isoformat(),
                )
                for sp in payload["sync_profiles"]
            ])
            log.info(f"[DB] Inserted {len(payload['sync_profiles'])} sync profiles")

        # ── Notifications ──────────────────────────────────────────────────
        # Schema: id, tenant_id, user_id, type, title, body, link, is_read, created_at
        if payload["notifications"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO notifications (id, tenant_id, user_id, type, title, body, is_read, created_at)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    n["id"], tenant_id,
                    random.choice(list(user_ids.values())) if user_ids else None,
                    n["trigger"],
                    f"{n['trigger'].replace('_', ' ').title()} — {n['module_code']}",
                    n["message"],
                    n["is_read"],
                    n["created_at"],
                )
                for n in payload["notifications"]
            ])
            log.info(f"[DB] Inserted {len(payload['notifications'])} notifications")

        # ── LLM Audit Log ──────────────────────────────────────────────────
        # Schema: id, tenant_id, service_name, called_at, model_version, prompt_hash, token_count, latency_ms, success
        if payload["llm_audit_log"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO llm_audit_log (id, tenant_id, service_name, called_at, model_version, prompt_hash, token_count, latency_ms, success)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    a["id"], tenant_id,
                    a["feature"],
                    a["created_at"],
                    a["model"],
                    a["prompt_hash"],
                    a["token_count_input"] + a["token_count_output"],
                    a["latency_ms"],
                    a["status"] == "success",
                )
                for a in payload["llm_audit_log"]
            ])
            log.info(f"[DB] Inserted {len(payload['llm_audit_log'])} LLM audit entries")

        # ── Record Relationships ───────────────────────────────────────────
        # Schema: id, tenant_id, from_domain, from_key, to_domain, to_key, relationship_type, sap_link_table, discovered_at, active, ai_inferred, ai_confidence, impact_score
        if payload["relationships"]:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO record_relationships (id, tenant_id, from_domain, from_key, to_domain, to_key, relationship_type, sap_link_table, discovered_at, active, ai_inferred, ai_confidence, impact_score)
                VALUES %s
                ON CONFLICT (id) DO NOTHING
            """, [
                (
                    r["id"], tenant_id,
                    r["source_module"], f"{r['source_module']}_KEY_001",
                    r["target_module"], f"{r['target_module']}_KEY_001",
                    r["relationship"],
                    r["field_link"].split("→")[0] if "→" in r["field_link"] else None,
                    NOW, True,
                    random.random() < 0.2,  # 20% AI inferred
                    round(random.uniform(0.7, 1.0), 3) if random.random() < 0.2 else None,
                    round(random.uniform(0.3, 1.0), 2),
                )
                for r in payload["relationships"]
            ])
            log.info(f"[DB] Inserted {len(payload['relationships'])} record relationships")

        conn.commit()
        log.info("[DB] All seed data committed successfully")

    except Exception as e:
        conn.rollback()
        log.error(f"[DB] Seed failed, rolled back: {e}")
        raise
    finally:
        cur.close()
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 21 — CLI ENTRYPOINT
# ═══════════════════════════════════════════════════════════════════════════


def main():
    parser = argparse.ArgumentParser(
        description="Meridian SAP Emulator Seed Script — generates realistic SAP data across 12 modules",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python seed_sap_emulator.py --dry-run
  python seed_sap_emulator.py --tenant-id abc123 --db-url postgresql://meridian:pw@localhost/meridian
  DATABASE_URL=postgresql://... python seed_sap_emulator.py
        """,
    )
    parser.add_argument("--tenant-id", default=str(uuid.uuid4()), help="Tenant UUID (auto-generated if omitted)")
    parser.add_argument("--db-url", default=DB_URL, help="PostgreSQL connection string")
    parser.add_argument("--dry-run", action="store_true", help="Output JSON file instead of writing to DB")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")

    args = parser.parse_args()
    random.seed(args.seed)

    summary = run_seed(
        tenant_id=args.tenant_id,
        db_url=args.db_url,
        dry_run=args.dry_run,
    )

    return summary


if __name__ == "__main__":
    main()
