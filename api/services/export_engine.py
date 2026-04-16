"""SAP-compatible export engine — CSV, LSMW, BAPI, IDoc, SF CSV, Excel formats."""

import csv
import io
import json
from typing import Any


# ── SAP field mappings per object type ────────────────────────────────────────

SAP_EXPORT_FIELDS: dict[str, dict[str, str]] = {
    # ── ECC object types ───────────────────────────────────────────────────────
    "customer": {
        "customer_id": "KUNNR", "name": "NAME1", "country": "LAND1",
        "payment_terms": "ZTERM", "currency": "WAERS", "tax_number": "STCEG",
        "phone": "TELF1", "email": "SMTP_ADDR",
    },
    "vendor": {
        "vendor_id": "LIFNR", "name": "NAME1", "country": "LAND1",
        "payment_terms": "ZTERM", "currency": "WAERS", "tax_number": "STCEG",
        "bank_account": "BANKN", "iban": "IBAN",
    },
    "material": {
        "material_id": "MATNR", "description": "MAKTX", "material_type": "MTART",
        "base_unit": "MEINS", "material_group": "MATKL", "weight_gross": "BRGEW",
        "weight_unit": "GEWEI", "status": "MMSTA",
    },
    "equipment": {
        "equipment_id": "EQUNR", "description": "EQKTX", "plant": "WERKS",
        "location": "STORT", "cost_center": "KOSTL", "acquisition_date": "ANSDT",
    },
    "employee": {
        "employee_id": "PERNR", "first_name": "VORNA", "last_name": "NACHN",
        "hire_date": "BEGDA", "job_code": "PLANS", "cost_center": "KOSTL",
        "payroll_area": "ABKRS",
    },
    "financial": {
        "account_number": "SAKNR", "description": "TXT50", "account_group": "KTOKS",
        "company_code": "BUKRS", "currency": "WAERS", "balance_sheet_flag": "BILKT",
    },
    # ── ECC module-specific types ──────────────────────────────────────────────
    "business_partner": {
        "partner": "PARTNER", "bu_type": "BU_TYPE", "name_org1": "NAME_ORG1",
        "title": "TITLE", "country": "LAND1", "city": "CITY1",
        "postal_code": "POST_CODE1", "email": "SMTP_ADDR",
    },
    "accounts_payable": {
        "vendor_id": "LIFNR", "name": "NAME1", "country": "LAND1",
        "recon_account": "AKONT", "payment_terms": "ZTERM", "tax_number": "STCD1",
    },
    "accounts_receivable": {
        "customer_id": "KUNNR", "name": "NAME1", "country": "LAND1",
        "recon_account": "AKONT", "payment_terms": "ZTERM", "credit_limit": "KLIMK",
    },
    "asset_accounting": {
        "asset_number": "ANLN1", "asset_class": "ANLKL", "company_code": "BUKRS",
        "description": "TXA50",
    },
    "mm_purchasing": {
        "po_number": "EBELN", "item": "EBELP", "vendor": "LIFNR",
        "material": "MATNR", "plant": "WERKS",
    },
    "plant_maintenance": {
        "equipment_id": "EQUNR", "description": "EQKTX", "category": "EQTYP",
        "plant": "SWERK",
    },
    "production_planning": {
        "mrp_type": "DISMM", "work_center": "ARBPL", "plant": "WERKS",
        "component": "IDNRK", "quantity": "MENGE",
    },
    "sd_customer_master": {
        "customer_id": "KUNNR", "sales_org": "VKORG", "dist_channel": "VTWEG",
        "division": "SPART", "customer_group": "KDGRP", "payment_terms": "ZTERM",
    },
    "sd_sales_orders": {
        "order_number": "VBELN", "customer": "KUNNR", "material": "MATNR",
        "quantity": "KWMENG", "item": "POSNR",
    },
    # ── SuccessFactors modules ─────────────────────────────────────────────────
    "employee_central": {
        "user_id": "USERID", "first_name": "FIRSTNAME", "last_name": "LASTNAME",
        "start_date": "START_DATE", "department": "DEPARTMENT", "job_code": "JOB_CODE",
        "manager_id": "MANAGER_ID", "location": "LOCATION",
    },
    "compensation": {
        "user_id": "USERID", "pay_grade": "PAY_GRADE", "currency": "CURRENCY",
        "salary": "SALARY", "effective_date": "EFFECTIVE_DATE",
    },
    "benefits": {
        "user_id": "USERID", "plan_id": "PLAN_ID", "enrol_date": "ENROL_DATE",
        "coverage_type": "COVERAGE_TYPE",
    },
    "payroll_integration": {
        "user_id": "USERID", "net_pay": "NET_PAY", "pay_date": "PAY_DATE",
        "currency": "CURRENCY", "cost_centre": "COST_CENTRE",
    },
    "performance_goals": {
        "user_id": "USERID", "goal_id": "GOAL_ID", "description": "GOAL_DESCRIPTION",
        "weight": "WEIGHT", "target_date": "TARGET_DATE",
    },
    "succession_planning": {
        "user_id": "USERID", "successor_id": "SUCCESSOR_ID", "role_id": "ROLE_ID",
        "readiness": "READINESS_PERCENTAGE",
    },
    "recruiting_onboarding": {
        "candidate_id": "CANDIDATE_ID", "first_name": "FIRST_NAME",
        "last_name": "LAST_NAME", "email": "EMAIL", "phone": "PHONE",
        "start_date": "START_DATE",
    },
    "learning_management": {
        "user_id": "USERID", "course_id": "COURSE_ID", "completion_date": "COMPLETION_DATE",
        "score": "SCORE", "status": "COMPLETION_STATUS",
    },
    "time_attendance": {
        "user_id": "USERID", "date": "DATE", "hours": "HOURS",
        "absence_type": "ABSENCE_TYPE", "approval_status": "APPROVAL_STATUS",
    },
    # ── Warehouse modules ──────────────────────────────────────────────────────
    "ewms_stock": {
        "warehouse": "LGNUM", "storage_type": "LGTYP", "storage_bin": "LGPLA",
        "material": "MATNR", "plant": "WERKS", "batch": "CHARG",
    },
    "ewms_transfer_orders": {
        "to_number": "TANUM", "item": "TAPOS", "material": "MATNR",
        "source_bin": "VLPLA", "dest_bin": "NLPLA", "quantity": "MENGE",
    },
    "batch_management": {
        "material": "MATNR", "batch": "CHARG", "plant": "WERKS",
        "best_before": "VFDAT", "shelf_life_exp": "HSDAT",
    },
    "mdg_master_data": {
        "object_key": "OBJECT_KEY", "object_type": "OBJECT_TYPE",
        "valid_from": "VALID_FROM", "valid_to": "VALID_TO", "status": "STATUS",
    },
    "grc_compliance": {
        "user_id": "USER_ID", "transaction": "TRANSACTION_CODE",
        "risk_level": "RISK_LEVEL", "violation_type": "VIOLATION_TYPE",
    },
    "fleet_management": {
        "equipment_id": "EQUNR", "registration": "REG_NUMBER", "vin": "VIN",
        "fuel_type": "FUEL_TYPE", "odometer": "ODOMETER",
    },
    "transport_management": {
        "shipment_id": "TKNUM", "shipment_type": "VSART", "carrier": "LIFNR",
        "ship_date": "VSDAT",
    },
    "wm_interface": {
        "warehouse_id": "LGNUM", "material": "MATNR", "stock_qty": "MENGE",
        "last_count": "ZAEDT",
    },
    "cross_system_integration": {
        "source_system": "LOGSYS", "material": "MATNR", "plant": "WERKS",
        "batch": "CHARG", "uom": "MEINS",
    },
}

TRANSACTION_CODES: dict[str, str] = {
    "customer": "XD02", "vendor": "XK02", "material": "MM02",
    "equipment": "IE02", "employee": "PA30", "financial": "FS00",
    "business_partner": "BP02", "accounts_payable": "FK02",
    "accounts_receivable": "FD02", "asset_accounting": "AS02",
    "mm_purchasing": "ME22N", "plant_maintenance": "IE02",
    "production_planning": "MD02", "sd_customer_master": "VD02",
    "sd_sales_orders": "VA02",
}

BAPI_NAMES: dict[str, str] = {
    "customer": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "vendor": "BAPI_VENDOR_CHANGEFROMDATA",
    "material": "BAPI_MATERIAL_SAVEDATA",
    "equipment": "BAPI_EQUI_CHANGE",
    "business_partner": "BAPI_BUPA_CENTRAL_DATA_SET",
    "accounts_payable": "BAPI_VENDOR_CHANGEFROMDATA",
    "accounts_receivable": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "asset_accounting": "BAPI_FIXEDASSET_CHANGE",
    "mm_purchasing": "BAPI_PO_CHANGE",
    "plant_maintenance": "BAPI_EQUI_CHANGE",
    "production_planning": "BAPI_PRODORD_CHANGE",
    "sd_customer_master": "BAPI_CUSTOMER_CHANGEFROMDATA1",
    "sd_sales_orders": "BAPI_SALESORDER_CHANGE",
}

IDOC_TYPES: dict[str, str] = {
    "customer": "DEBMAS07", "vendor": "CREMAS05",
    "material": "MATMAS05", "employee": "HRMD_A",
    "business_partner": "BPMAS01", "accounts_payable": "CREMAS05",
    "accounts_receivable": "DEBMAS07", "asset_accounting": "ANLAS01",
    "sd_sales_orders": "ORDERS05",
}

SF_FIELD_NAMES: dict[str, str] = {
    "employee_id": "userId",
    "first_name": "firstName",
    "last_name": "lastName",
    "hire_date": "hireDate",
    "job_code": "jobCode",
    "cost_center": "costCenter",
    "payroll_area": "payrollArea",
}


class ExportEngine:
    """Generates SAP-compatible export files in multiple formats."""

    def _map_record(self, record: dict[str, Any], object_type: str) -> dict[str, str]:
        """Map source field names to SAP field names for a single record."""
        field_map = SAP_EXPORT_FIELDS.get(object_type, {})
        mapped: dict[str, str] = {}
        for source_field, sap_field in field_map.items():
            value = record.get(source_field, "")
            mapped[sap_field] = str(value) if value is not None else ""
        return mapped

    def export_csv(self, records: list[dict], object_type: str) -> str:
        """Generate CSV with SAP field headers."""
        field_map = SAP_EXPORT_FIELDS.get(object_type, {})
        sap_headers = list(field_map.values())

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(sap_headers)

        for record in records:
            mapped = self._map_record(record, object_type)
            writer.writerow([mapped.get(h, "") for h in sap_headers])

        return output.getvalue()

    def export_lsmw(self, records: list[dict], object_type: str) -> str:
        """Generate LSMW tab-delimited recording format."""
        tcode = TRANSACTION_CODES.get(object_type, "")
        lines: list[str] = []

        for i, record in enumerate(records):
            if i > 0:
                lines.append("")
            mapped = self._map_record(record, object_type)
            lines.append(f"TRANSACTION\t{tcode}")
            lines.append("BEGIN_SESSION")
            for sap_field, value in mapped.items():
                lines.append(f"SET {sap_field}={value}")
            lines.append("EXECUTE")
            lines.append("END_SESSION")

        return "\n".join(lines)

    def export_bapi(self, records: list[dict], object_type: str) -> str:
        """Generate JSON BAPI call structure."""
        bapi_name = BAPI_NAMES.get(object_type, f"BAPI_{object_type.upper()}_CHANGE")
        calls: list[dict[str, Any]] = []

        for i, record in enumerate(records, start=1):
            mapped = self._map_record(record, object_type)
            calls.append({
                "call_id": str(i),
                "bapi": bapi_name,
                "import_params": mapped,
            })

        return json.dumps({"bapi_calls": calls}, indent=2)

    def export_idoc(self, records: list[dict], object_type: str) -> str:
        """Generate JSON IDoc structure."""
        idoc_type = IDOC_TYPES.get(object_type, f"{object_type.upper()}01")
        idocs: list[dict[str, Any]] = []

        for record in records:
            mapped = self._map_record(record, object_type)
            idocs.append({
                "EDI_DC40": {
                    "IDOCTYP": idoc_type,
                    "MESTYP": "CHANGE",
                    "SNDPOR": "VANTAX",
                    "SNDPRT": "LS",
                    "RCVPOR": "SAP",
                    "RCVPRT": "LS",
                },
                "E1segment": mapped,
            })

        return json.dumps({"idocs": idocs}, indent=2)

    def export_sf_csv(self, records: list[dict], object_type: str) -> str:
        """Generate SuccessFactors-compatible CSV with OData field names."""
        if object_type == "employee":
            source_fields = list(SAP_EXPORT_FIELDS["employee"].keys())
            sf_headers = [SF_FIELD_NAMES.get(f, f) for f in source_fields]
        else:
            field_map = SAP_EXPORT_FIELDS.get(object_type, {})
            source_fields = list(field_map.keys())
            sf_headers = source_fields

        output = io.StringIO()
        writer = csv.writer(output, quoting=csv.QUOTE_ALL)
        writer.writerow(sf_headers)

        for record in records:
            row = [str(record.get(f, "")) if record.get(f) is not None else "" for f in source_fields]
            writer.writerow(row)

        return output.getvalue()

    def _write_sheet(self, ws, records: list[dict], object_type: str) -> None:
        """Write a single worksheet using the SAP field map for ``object_type``.

        If the object type isn't registered in ``SAP_EXPORT_FIELDS`` the raw
        record keys are used as headers so the export still carries data
        rather than dropping it silently.
        """
        field_map = SAP_EXPORT_FIELDS.get(object_type, {})
        if field_map:
            sap_headers = list(field_map.values())
        elif records:
            sap_headers = list(records[0].keys())
        else:
            sap_headers = []

        ws.append(sap_headers)

        for record in records:
            if field_map:
                mapped = self._map_record(record, object_type)
                row = [mapped.get(h, "") for h in sap_headers]
            else:
                row = [
                    str(record.get(h, "")) if record.get(h) is not None else ""
                    for h in sap_headers
                ]
            ws.append(row)

        # Auto-size columns
        for col_cells in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col_cells)
            ws.column_dimensions[col_cells[0].column_letter].width = min(max_len + 2, 50)

    def export_xlsx(self, records: list[dict], object_type: str) -> bytes:
        """Generate Excel (.xlsx) with SAP field headers using openpyxl."""
        import openpyxl

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"{object_type}_cleaned"[:31]  # Excel sheet name limit
        self._write_sheet(ws, records, object_type)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    def export_xlsx_multi(self, records_by_type: dict[str, list[dict]]) -> bytes:
        """Generate an Excel workbook with one sheet per object type.

        Used when a single cleaning export spans multiple object types —
        each sheet uses the SAP field mapping for its own type instead of
        falling back to a single hardcoded type for the whole workbook.
        """
        import openpyxl

        wb = openpyxl.Workbook()
        # Remove the default sheet created by Workbook(); we'll add named ones.
        default = wb.active
        wb.remove(default)

        for object_type, records in records_by_type.items():
            ws = wb.create_sheet(title=f"{object_type}_cleaned"[:31])
            self._write_sheet(ws, records, object_type)

        if not wb.sheetnames:
            # openpyxl requires at least one sheet; create an empty one.
            wb.create_sheet(title="empty")

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()
