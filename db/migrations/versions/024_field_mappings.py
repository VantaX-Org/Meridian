"""Add field_mappings table for SAP field mapping system.

Supports two modes controlled by the licence manifest feature flag
'field_mapping_self_service':
  - false (default): Meridian HQ manages mappings, pushed via licence manifest
  - true: Customer admins can view AND edit mappings locally

Standard field seeds are derived from SAP ECC, SuccessFactors, and Warehouse
module field names referenced in the check engine YAML rules.

Revision ID: 024
Revises: 023
Create Date: 2026-03-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "field_mappings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        # SAP module identifier matching the YAML rule module names
        sa.Column("module", sa.VARCHAR(100), nullable=False),
        # Meridian standard field name (e.g. LIFNR, KUNNR, MATNR)
        sa.Column("standard_field", sa.VARCHAR(255), nullable=False),
        # Human-readable label for the standard field
        sa.Column("standard_label", sa.VARCHAR(255), nullable=True),
        # Customer's actual SAP field name (defaults to standard_field)
        sa.Column("customer_field", sa.VARCHAR(255), nullable=True),
        # Customer's label for the field
        sa.Column("customer_label", sa.VARCHAR(255), nullable=True),
        # string | number | date | boolean
        sa.Column("data_type", sa.VARCHAR(50), nullable=True, server_default="string"),
        # True once the customer has confirmed/customised the mapping
        sa.Column("is_mapped", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "tenant_id", "module", "standard_field", name="uq_field_mappings"
        ),
    )

    op.create_index("idx_field_mappings_tenant", "field_mappings", ["tenant_id"])
    op.create_index("idx_field_mappings_module", "field_mappings", ["module"])

    # Row Level Security
    op.execute("ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON field_mappings "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )

    # Seed standard SAP field definitions for the dev tenant
    _seed_standard_fields(op)


# ── Standard field catalogue ──────────────────────────────────────────────────
# Derived from check engine YAML rules — every field referenced in a rule
# condition has a mapping row seeded here.

_STANDARD_FIELDS: list[tuple[str, str, str, str]] = [
    # (module, standard_field, standard_label, data_type)
    # ECC — Business Partner
    ("business_partner", "BUT000.PARTNER", "Business Partner Number", "string"),
    ("business_partner", "BUT000.BU_TYPE", "BP Category", "string"),
    ("business_partner", "BUT000.NAME_ORG1", "Organisation Name", "string"),
    ("business_partner", "BUT000.NAME_LAST", "Last Name", "string"),
    ("business_partner", "BUT000.NAME_FIRST", "First Name", "string"),
    ("business_partner", "BUT100.ROLE", "BP Role", "string"),
    ("business_partner", "BUT021_FS.ADDRNUMBER", "Address Number", "string"),
    ("business_partner", "ADR6.SMTP_ADDR", "Email Address", "string"),
    ("business_partner", "ADR2.TELNR_LONG", "Phone Number", "string"),
    ("business_partner", "DFKKBPTAXNUM.TAXTYPE", "Tax Number Type", "string"),
    ("business_partner", "DFKKBPTAXNUM.TAXNUM", "Tax Number", "string"),
    # ECC — Material Master
    ("material_master", "MARA.MATNR", "Material Number", "string"),
    ("material_master", "MARA.MTART", "Material Type", "string"),
    ("material_master", "MARA.MATKL", "Material Group", "string"),
    ("material_master", "MARA.MEINS", "Base Unit of Measure", "string"),
    ("material_master", "MARA.GEWEI", "Weight Unit", "string"),
    ("material_master", "MARA.NTGEW", "Net Weight", "number"),
    ("material_master", "MARA.BRGEW", "Gross Weight", "number"),
    ("material_master", "MARA.VOLUM", "Volume", "number"),
    ("material_master", "MARA.VOLEH", "Volume Unit", "string"),
    ("material_master", "MARA.EAN11", "EAN/UPC Code", "string"),
    ("material_master", "MARA.EXTWG", "External Material Group", "string"),
    ("material_master", "MARA.BISMT", "Old Material Number", "string"),
    ("material_master", "MARA.MSTAE", "Cross-Plant Material Status", "string"),
    ("material_master", "MARA.LAEDA", "Date of Last Change", "date"),
    ("material_master", "MAKT.MAKTX", "Material Description", "string"),
    ("material_master", "MAKT.SPRAS", "Language", "string"),
    ("material_master", "MARC.WERKS", "Plant", "string"),
    ("material_master", "MARC.PRCTR", "Profit Centre", "string"),
    ("material_master", "MARC.LGPRO", "Storage Location", "string"),
    # ECC — FI GL
    ("fi_gl", "SKA1.SAKNR", "GL Account Number", "string"),
    ("fi_gl", "SKA1.KTOKS", "Account Group", "string"),
    ("fi_gl", "SKA1.BILKT", "Group Account Number", "string"),
    ("fi_gl", "SKA1.XBILK", "Balance Sheet Account", "boolean"),
    ("fi_gl", "SKB1.BUKRS", "Company Code", "string"),
    ("fi_gl", "SKB1.XSPEB", "Blocked for Posting", "boolean"),
    ("fi_gl", "SKB1.WAERS", "Account Currency", "string"),
    ("fi_gl", "SKAT.TXT50", "Long Text", "string"),
    # ECC — Accounts Payable (Vendor)
    ("accounts_payable", "LFA1.LIFNR", "Vendor Number", "string"),
    ("accounts_payable", "LFA1.KTOKK", "Account Group", "string"),
    ("accounts_payable", "LFA1.LAND1", "Country", "string"),
    ("accounts_payable", "LFA1.NAME1", "Vendor Name", "string"),
    ("accounts_payable", "LFA1.STCD1", "Tax Number 1", "string"),
    ("accounts_payable", "LFA1.STCD2", "Tax Number 2", "string"),
    ("accounts_payable", "LFA1.BANKS", "Bank Country", "string"),
    ("accounts_payable", "LFA1.BANKL", "Bank Key", "string"),
    ("accounts_payable", "LFA1.BANKN", "Bank Account Number", "string"),
    ("accounts_payable", "LFA1.SMTP_ADDR", "Email Address", "string"),
    ("accounts_payable", "LFB1.BUKRS", "Company Code", "string"),
    ("accounts_payable", "LFB1.ZTERM", "Payment Terms", "string"),
    ("accounts_payable", "LFB1.AKONT", "Reconciliation Account", "string"),
    # ECC — Accounts Receivable (Customer)
    ("accounts_receivable", "KNA1.KUNNR", "Customer Number", "string"),
    ("accounts_receivable", "KNA1.KTOKD", "Account Group", "string"),
    ("accounts_receivable", "KNA1.LAND1", "Country", "string"),
    ("accounts_receivable", "KNA1.NAME1", "Customer Name", "string"),
    ("accounts_receivable", "KNA1.STCD1", "Tax Number 1", "string"),
    ("accounts_receivable", "KNA1.SMTP_ADDR", "Email Address", "string"),
    ("accounts_receivable", "KNB1.BUKRS", "Company Code", "string"),
    ("accounts_receivable", "KNB1.ZTERM", "Payment Terms", "string"),
    ("accounts_receivable", "KNB1.AKONT", "Reconciliation Account", "string"),
    ("accounts_receivable", "KNB1.FDGRV", "Planning Group", "string"),
    # ECC — Asset Accounting
    ("asset_accounting", "ANLA.BUKRS", "Company Code", "string"),
    ("asset_accounting", "ANLA.ANLN1", "Asset Number", "string"),
    ("asset_accounting", "ANLA.ANLN2", "Asset Sub-Number", "string"),
    ("asset_accounting", "ANLA.AKTIV", "Asset Capitalisation Date", "date"),
    ("asset_accounting", "ANLA.DEAKT", "Asset Deactivation Date", "date"),
    ("asset_accounting", "ANLA.KTANSW", "Asset Class", "string"),
    ("asset_accounting", "ANLZ.KOSTL", "Cost Centre", "string"),
    ("asset_accounting", "ANLZ.GSBER", "Business Area", "string"),
    ("asset_accounting", "ANLZ.PRCTR", "Profit Centre", "string"),
    # ECC — MM Purchasing
    ("mm_purchasing", "EKKO.EBELN", "Purchase Order Number", "string"),
    ("mm_purchasing", "EKKO.BSART", "Document Type", "string"),
    ("mm_purchasing", "EKKO.LIFNR", "Vendor Number", "string"),
    ("mm_purchasing", "EKKO.EKGRP", "Purchasing Group", "string"),
    ("mm_purchasing", "EKKO.WAERS", "Currency", "string"),
    ("mm_purchasing", "EKKO.BEDAT", "Purchase Order Date", "date"),
    ("mm_purchasing", "EKPO.MATNR", "Material Number", "string"),
    ("mm_purchasing", "EKPO.WERKS", "Plant", "string"),
    ("mm_purchasing", "EKPO.MENGE", "Order Quantity", "number"),
    ("mm_purchasing", "EKPO.MEINS", "Order Unit", "string"),
    ("mm_purchasing", "EKPO.NETPR", "Net Price", "number"),
    # ECC — Plant Maintenance
    ("plant_maintenance", "EQUI.EQUNR", "Equipment Number", "string"),
    ("plant_maintenance", "EQUI.EQUKZ", "Equipment Category", "string"),
    ("plant_maintenance", "EQUI.TPLNR", "Functional Location", "string"),
    ("plant_maintenance", "EQUI.WERKS", "Plant", "string"),
    ("plant_maintenance", "EQUI.BAUJJ", "Year of Construction", "number"),
    ("plant_maintenance", "EQUI.INBDT", "Start-Up Date", "date"),
    # ECC — Production Planning
    ("production_planning", "AFKO.AUFNR", "Production Order Number", "string"),
    ("production_planning", "AFKO.AUART", "Order Type", "string"),
    ("production_planning", "AFKO.MATNR", "Material Number", "string"),
    ("production_planning", "AFKO.WERKS", "Plant", "string"),
    ("production_planning", "AFKO.GAMNG", "Total Order Quantity", "number"),
    ("production_planning", "AFKO.GSTRI", "Scheduled Start Date", "date"),
    ("production_planning", "AFKO.GETRI", "Scheduled Finish Date", "date"),
    # ECC — SD Customer Master
    ("sd_customer_master", "KNA1.KUNNR", "Customer Number", "string"),
    ("sd_customer_master", "KNA1.NAME1", "Customer Name", "string"),
    ("sd_customer_master", "KNA1.LAND1", "Country", "string"),
    ("sd_customer_master", "KNA1.REGIO", "Region", "string"),
    ("sd_customer_master", "KNA1.ORT01", "City", "string"),
    ("sd_customer_master", "KNA1.PSTLZ", "Postal Code", "string"),
    ("sd_customer_master", "KNVV.VKORG", "Sales Organisation", "string"),
    ("sd_customer_master", "KNVV.VTWEG", "Distribution Channel", "string"),
    ("sd_customer_master", "KNVV.SPART", "Division", "string"),
    ("sd_customer_master", "KNVV.ZTERM", "Payment Terms", "string"),
    ("sd_customer_master", "KNVV.INCO1", "Incoterms 1", "string"),
    # ECC — SD Sales Orders
    ("sd_sales_orders", "VBAK.VBELN", "Sales Order Number", "string"),
    ("sd_sales_orders", "VBAK.AUART", "Order Type", "string"),
    ("sd_sales_orders", "VBAK.KUNNR", "Customer Number", "string"),
    ("sd_sales_orders", "VBAK.VKORG", "Sales Organisation", "string"),
    ("sd_sales_orders", "VBAK.WAERK", "Currency", "string"),
    ("sd_sales_orders", "VBAK.AUDAT", "Order Date", "date"),
    ("sd_sales_orders", "VBAP.POSNR", "Item Number", "string"),
    ("sd_sales_orders", "VBAP.MATNR", "Material Number", "string"),
    ("sd_sales_orders", "VBAP.KWMENG", "Confirmed Quantity", "number"),
    ("sd_sales_orders", "VBAP.NETWR", "Net Value", "number"),
    # SuccessFactors — Employee Central
    ("employee_central", "PerPerson.personIdExternal", "Person External ID", "string"),
    ("employee_central", "PerPerson.countryOfBirth", "Country of Birth", "string"),
    ("employee_central", "PerPersonal.firstName", "First Name", "string"),
    ("employee_central", "PerPersonal.lastName", "Last Name", "string"),
    ("employee_central", "PerPersonal.gender", "Gender", "string"),
    ("employee_central", "PerPersonal.dateOfBirth", "Date of Birth", "date"),
    ("employee_central", "PerPersonal.nationality", "Nationality", "string"),
    ("employee_central", "PerEmail.emailAddress", "Email Address", "string"),
    ("employee_central", "PerPhone.phoneNumber", "Phone Number", "string"),
    ("employee_central", "EmpEmployment.userId", "User ID", "string"),
    ("employee_central", "EmpEmployment.startDate", "Employment Start Date", "date"),
    ("employee_central", "EmpEmployment.endDate", "Employment End Date", "date"),
    ("employee_central", "EmpJob.company", "Company", "string"),
    ("employee_central", "EmpJob.department", "Department", "string"),
    ("employee_central", "EmpJob.jobCode", "Job Code", "string"),
    ("employee_central", "EmpJob.position", "Position", "string"),
    ("employee_central", "EmpJob.managerId", "Manager ID", "string"),
    # SuccessFactors — Compensation
    ("compensation", "EmpCompensation.userId", "User ID", "string"),
    ("compensation", "EmpCompensation.payGroup", "Pay Group", "string"),
    ("compensation", "EmpCompensation.payGrade", "Pay Grade", "string"),
    ("compensation", "EmpCompensation.currency", "Currency", "string"),
    ("compensation", "EmpCompensation.payFrequency", "Pay Frequency", "string"),
    # SuccessFactors — Benefits
    ("benefits", "BenefitEnrollment.userId", "User ID", "string"),
    ("benefits", "BenefitEnrollment.benefitPlan", "Benefit Plan", "string"),
    ("benefits", "BenefitEnrollment.enrollmentStatus", "Enrollment Status", "string"),
    # SuccessFactors — Payroll Integration
    ("payroll_integration", "EmpPayroll.userId", "User ID", "string"),
    ("payroll_integration", "EmpPayroll.payrollSystem", "Payroll System", "string"),
    ("payroll_integration", "EmpPayroll.costCenter", "Cost Center", "string"),
    # SuccessFactors — Performance & Goals
    ("performance_goals", "Goal.userId", "User ID", "string"),
    ("performance_goals", "Goal.name", "Goal Name", "string"),
    ("performance_goals", "Goal.dueDate", "Due Date", "date"),
    ("performance_goals", "Goal.status", "Status", "string"),
    # SuccessFactors — Succession Planning
    ("succession_planning", "SuccessionPlan.userId", "User ID", "string"),
    ("succession_planning", "SuccessionPlan.nomineeId", "Nominee ID", "string"),
    ("succession_planning", "SuccessionPlan.readinessLevel", "Readiness Level", "string"),
    # SuccessFactors — Recruiting & Onboarding
    ("recruiting_onboarding", "JobApplication.candidateId", "Candidate ID", "string"),
    ("recruiting_onboarding", "JobApplication.jobReqId", "Job Requisition ID", "string"),
    ("recruiting_onboarding", "JobApplication.status", "Application Status", "string"),
    # SuccessFactors — Learning Management
    ("learning_management", "LearningAssignment.userId", "User ID", "string"),
    ("learning_management", "LearningAssignment.itemId", "Learning Item ID", "string"),
    ("learning_management", "LearningAssignment.dueDate", "Due Date", "date"),
    ("learning_management", "LearningAssignment.completionDate", "Completion Date", "date"),
    # SuccessFactors — Time & Attendance
    ("time_attendance", "TimeSheet.userId", "User ID", "string"),
    ("time_attendance", "TimeSheet.timeSheetDate", "Time Sheet Date", "date"),
    ("time_attendance", "TimeSheet.regularHours", "Regular Hours", "number"),
    ("time_attendance", "TimeSheet.overtimeHours", "Overtime Hours", "number"),
    # Warehouse — EWM Stock
    ("ewms_stock", "LGPLA.LGNUM", "Warehouse Number", "string"),
    ("ewms_stock", "LGPLA.LGPLA", "Storage Bin", "string"),
    ("ewms_stock", "LGPLA.LGTYP", "Storage Type", "string"),
    ("ewms_stock", "LQUA.MATNR", "Material Number", "string"),
    ("ewms_stock", "LQUA.WERKS", "Plant", "string"),
    ("ewms_stock", "LQUA.LGORT", "Storage Location", "string"),
    ("ewms_stock", "LQUA.CHARG", "Batch Number", "string"),
    ("ewms_stock", "LQUA.EINME", "Stock Quantity", "number"),
    # Warehouse — EWM Transfer Orders
    ("ewms_transfer_orders", "LTAP.TANUM", "Transfer Order Number", "string"),
    ("ewms_transfer_orders", "LTAP.LGNUM", "Warehouse Number", "string"),
    ("ewms_transfer_orders", "LTAP.MATNR", "Material Number", "string"),
    ("ewms_transfer_orders", "LTAP.ANFME", "Requested Quantity", "number"),
    ("ewms_transfer_orders", "LTAP.MENGE", "Transferred Quantity", "number"),
    # Warehouse — Batch Management
    ("batch_management", "MCH1.MATNR", "Material Number", "string"),
    ("batch_management", "MCH1.CHARG", "Batch Number", "string"),
    ("batch_management", "MCH1.WERKS", "Plant", "string"),
    ("batch_management", "MCH1.HSDAT", "Manufacture Date", "date"),
    ("batch_management", "MCH1.VFDAT", "Expiry Date", "date"),
    # Warehouse — MDG Master Data
    ("mdg_master_data", "MDG_CHANGE_DOC.OBJID", "Object ID", "string"),
    ("mdg_master_data", "MDG_CHANGE_DOC.CHNGID", "Change Request ID", "string"),
    ("mdg_master_data", "MDG_CHANGE_DOC.CHNG_STATUS", "Change Status", "string"),
    # Warehouse — Fleet Management
    ("fleet_management", "AVIK.EQUNR", "Equipment Number", "string"),
    ("fleet_management", "AVIK.AUART", "Maintenance Order Type", "string"),
    ("fleet_management", "AVIK.INBDT", "Start-Up Date", "date"),
    ("fleet_management", "FLEET.MILEAGE", "Mileage", "number"),
    ("fleet_management", "FLEET.FUEL_TYPE", "Fuel Type", "string"),
    # Warehouse — Transport Management
    ("transport_management", "VTTK.TKNUM", "Shipment Number", "string"),
    ("transport_management", "VTTK.VSART", "Shipment Type", "string"),
    ("transport_management", "VTTK.VSBED", "Shipping Conditions", "string"),
    ("transport_management", "VTTK.TDLNR", "Forwarding Agent", "string"),
]


def _seed_standard_fields(op) -> None:
    """Insert standard SAP field definitions for the dev tenant."""
    dev_tenant = "00000000-0000-0000-0000-000000000001"
    conn = op.get_bind()

    # Skip seeding if dev tenant doesn't exist (CI, fresh installs, etc.)
    result = conn.execute(
        sa.text("SELECT 1 FROM tenants WHERE id = :tid"), {"tid": dev_tenant}
    )
    if not result.fetchone():
        print("[migration 024] Dev tenant not found — skipping field mapping seed")
        return

    for module, standard_field, standard_label, data_type in _STANDARD_FIELDS:
        conn.execute(
            sa.text("""
                INSERT INTO field_mappings
                    (tenant_id, module, standard_field, standard_label,
                     customer_field, customer_label, data_type, is_mapped)
                VALUES
                    (:tid, :module, :sf, :sl, :sf, :sl, :dt, false)
                ON CONFLICT (tenant_id, module, standard_field) DO NOTHING
            """),
            {
                "tid": dev_tenant,
                "module": module,
                "sf": standard_field,
                "sl": standard_label,
                "dt": data_type,
            },
        )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON field_mappings")
    op.execute("ALTER TABLE field_mappings DISABLE ROW LEVEL SECURITY")
    op.drop_table("field_mappings")
