"""Config Discovery Engine (Layer 1).

Extracts distinct values from uploaded SAP transactional data to build a
configuration inventory.  Ported from the Nexus TypeScript ConfigDiscovery
class.  Covers 10 SAP modules: FI, MM, SD, PM, PP, INT, HR, SF, Concur, eWMS.
"""

from __future__ import annotations

from api.models.config_intelligence import ConfigElement, ConfigStatus, SAPVersion


class ConfigDiscovery:
    """Extract configuration elements from SAP transactional records."""

    # ------------------------------------------------------------------
    # Shared helper
    # ------------------------------------------------------------------

    def _extract_distinct(
        self,
        records: list[dict],
        field: str,
        element_type: str,
        module: str,
        sap_reference_table: str,
    ) -> list[ConfigElement]:
        """Extract distinct values for a field and return ConfigElement list."""
        values: dict[str, int] = {}
        for r in records:
            val = r.get(field) or r.get(field.lower())
            if val is not None and val != "":
                key = str(val)
                values[key] = values.get(key, 0) + 1
        return [
            ConfigElement(
                module=module,
                element_type=element_type,
                element_value=val,
                transaction_count=count,
                status=ConfigStatus.ACTIVE if count > 0 else ConfigStatus.DORMANT,
                sap_reference_table=sap_reference_table,
            )
            for val, count in values.items()
        ]

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def discover_config(self, records: list[dict]) -> list[ConfigElement]:
        """Auto-detect modules from field presence and run discovery."""
        if not records:
            return []

        fields = {k.upper() for k in records[0].keys()}
        elements: list[ConfigElement] = []

        # FI
        if fields & {"BUKRS", "BLART", "BSCHL", "HKONT"}:
            elements.extend(self._discover_fi(records))

        # MM
        if fields & {"BSART", "MTART", "BWART", "DISMM"}:
            elements.extend(self._discover_mm(records))

        # SD — AUART alone is ambiguous (PM also uses it), require SD companion
        if fields & {"VKORG"}:
            elements.extend(self._discover_sd(records))
        elif "AUART" in fields and fields & {"PSTYV", "FKART"}:
            elements.extend(self._discover_sd(records))
        elif fields & {"PSTYV", "FKART"}:
            elements.extend(self._discover_sd(records))

        # PM
        if fields & {"SWERK", "EQTYP", "QMART", "INGRP"}:
            elements.extend(self._discover_pm(records))

        # PP
        if fields & {"PLNTY", "STLAN"} or ("AUART" in fields and "GAMNG" in fields):
            elements.extend(self._discover_pp(records))

        # Integration
        if fields & {"IDOCTP", "MESTYP", "SNDPRN"}:
            elements.extend(self._discover_int(records))

        # HR
        if fields & {"PERNR", "PERSG", "PERSK", "ABKRS"}:
            elements.extend(self._discover_hr(records))

        # SuccessFactors
        sf_fields = {
            "PERSON_ID", "USER_ID", "USERID", "EMP_STATUS", "HIRE_DATE",
            "JOB_CODE", "COMP_PLAN", "GOAL_PLAN", "REVIEW_CYCLE", "COURSE_ID",
        }
        if fields & sf_fields:
            elements.extend(self._discover_sf(records))

        # Concur
        concur_fields = {
            "REPORT_ID", "EXPENSE_TYPE", "REPORT_STATUS", "TRIP_ID",
            "VENDOR_NAME", "PAYMENT_TYPE", "APPROVAL_STATUS", "POLICY_NAME",
        }
        if fields & concur_fields:
            elements.extend(self._discover_concur(records))

        # eWMS
        ewms_fields = {
            "LGPLA", "HUIDENT", "LGTYP", "LGNUM", "WAVE_STATUS",
            "TANUM", "NLTYP",
        }
        if fields & ewms_fields:
            elements.extend(self._discover_ewms(records))

        # Z-Object Integration: detect Z config values and append to inventory
        elements = self._append_z_objects_to_inventory(records, elements)

        return elements

    # ------------------------------------------------------------------
    # SAP version detection
    # ------------------------------------------------------------------

    def detect_sap_version(self, records: list[dict]) -> SAPVersion:
        """Detect S/4HANA vs ECC based on field presence."""
        if not records:
            return SAPVersion.UNKNOWN
        fields = {k.upper() for k in records[0].keys()}
        # S/4HANA indicators (ACDOCA, Business Partner)
        if fields & {"RLDNR", "RCLNT", "RBUKRS"}:
            return SAPVersion.S4HANA
        if fields & {"PARTNER", "BPARTNER", "BUT000"}:
            return SAPVersion.S4HANA
        # ECC indicators (separate index tables)
        if fields & {"BSID", "BSIK", "BSAD", "BSAK"}:
            return SAPVersion.ECC
        if "KUNNR" in fields and "PARTNER" not in fields:
            return SAPVersion.ECC
        return SAPVersion.UNKNOWN

    # ------------------------------------------------------------------
    # FI — Finance
    # ------------------------------------------------------------------

    def _discover_fi(self, records: list[dict]) -> list[ConfigElement]:
        m = "FI"
        mappings = [
            ("BUKRS",  "company_code",     "T001"),
            ("BLART",  "document_type",    "T003"),
            ("BSCHL",  "posting_key",      "TBSL"),
            ("HKONT",  "gl_account",       "SKA1"),
            ("KOSTL",  "cost_centre",      "CSKS"),
            ("PRCTR",  "profit_centre",    "CEPC"),
            ("MWSKZ",  "tax_code",         "T007A"),
            ("ZLSCH",  "payment_method",   "T042Z"),
            ("WAERS",  "currency",         "TCURC"),
            ("VBUND",  "trading_partner",  "T880"),
            ("AUFNR",  "internal_order",   "AUFK"),
            ("HBKID",  "house_bank",       "T012"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))

        # Number range analysis
        elements.extend(self._detect_number_ranges(records))

        # Fiscal year period detection
        elements.extend(self._detect_fiscal_periods(records))

        return elements

    # ------------------------------------------------------------------
    # MM — Materials Management
    # ------------------------------------------------------------------

    def _discover_mm(self, records: list[dict]) -> list[ConfigElement]:
        m = "MM"
        mappings = [
            ("WERKS",  "plant",                "T001W"),
            ("LGORT",  "storage_location",     "T001L"),
            ("EKORG",  "purchasing_org",       "T024E"),
            ("BSART",  "po_document_type",     "T161"),
            ("MTART",  "material_type",        "T134"),
            ("DISMM",  "mrp_type",             "T399D"),
            ("DISLS",  "lot_size_procedure",   "T440"),
            ("BESCHP", "procurement_type",     ""),
            ("BKLAS",  "valuation_class",      "T025"),
            ("BWART",  "movement_type",        "T156"),
            ("EKGRP",  "purchasing_group",     "T024"),
            ("VPRSV",  "price_control",        ""),
            ("FRGKE",  "release_indicator",    "T16FK"),
            ("MEINS",  "base_uom",             "T006"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))
        return elements

    # ------------------------------------------------------------------
    # SD — Sales & Distribution
    # ------------------------------------------------------------------

    def _discover_sd(self, records: list[dict]) -> list[ConfigElement]:
        m = "SD"
        mappings = [
            ("VKORG", "sales_org",              "TVKO"),
            ("VTWEG", "distribution_channel",   "TVTW"),
            ("SPART", "division",               "TSPA"),
            ("AUART", "sales_order_type",       "TVAK"),
            ("PSTYV", "item_category",          "TVCPA"),
            ("KSCHL", "condition_type",         "T685"),
            ("VSTEL", "shipping_point",         "TVST"),
            ("LFART", "delivery_type",          "TVLK"),
            ("FKART", "billing_type",           "TVFK"),
            ("ROUTE", "route",                  "TVRO"),
            ("INCO1", "incoterms",              "TINCT"),
            ("KTOKD", "customer_account_group", "T077D"),
            ("PARVW", "partner_function",       "TPAR"),
            ("KKBER", "credit_control_area",    "T014"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))
        return elements

    # ------------------------------------------------------------------
    # PM — Plant Maintenance
    # ------------------------------------------------------------------

    def _discover_pm(self, records: list[dict]) -> list[ConfigElement]:
        m = "PM"
        mappings = [
            ("SWERK", "maintenance_plant",        "T001W"),
            ("EQTYP", "equipment_category",       "T370T"),
            ("INGRP", "planner_group",            "T024I"),
            ("QMART", "notification_type",        "TQ80"),
            ("PRIOK", "priority",                 "T356"),
            ("FLTYP", "func_location_category",   "T370F"),
            ("AUART", "pm_order_type",            "T003O"),
            ("STRAT", "maintenance_strategy",     "TCVS"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))
        return elements

    # ------------------------------------------------------------------
    # PP — Production Planning
    # ------------------------------------------------------------------

    def _discover_pp(self, records: list[dict]) -> list[ConfigElement]:
        m = "PP"
        mappings = [
            ("PLNTY", "task_list_type",       "PLKO"),
            ("STLAN", "bom_usage",            "STKO"),
            ("VERWE", "work_centre_category", "CRHD"),
            ("DISPO", "mrp_controller",       "T399D"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))
        return elements

    # ------------------------------------------------------------------
    # INT — Integration (IDoc)
    # ------------------------------------------------------------------

    def _discover_int(self, records: list[dict]) -> list[ConfigElement]:
        m = "INT"
        mappings = [
            ("IDOCTP", "idoc_type",         "EDIDC"),
            ("MESTYP", "message_type",      "EDIMSG"),
            ("SNDPRN", "sender_partner",    "EDPP1"),
            ("RCVPRN", "receiver_partner",  "EDPP1"),
            ("DIRECT", "direction",         "EDIDC"),
            ("STATUS", "idoc_status",       "EDIDC"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))
        return elements

    # ------------------------------------------------------------------
    # HR — Human Resources
    # ------------------------------------------------------------------

    def _discover_hr(self, records: list[dict]) -> list[ConfigElement]:
        m = "HR"
        mappings = [
            ("PERSG", "employee_group",    "T501"),
            ("PERSK", "employee_subgroup", "T503"),
            ("ABKRS", "payroll_area",      "T549A"),
            ("ORGEH", "org_unit",          "T527X"),
            ("PLANS", "position",          "T528T"),
            ("WERKS", "personnel_area",    "T001P"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))
        return elements

    # ------------------------------------------------------------------
    # SF — SuccessFactors
    # ------------------------------------------------------------------

    def _discover_sf(self, records: list[dict]) -> list[ConfigElement]:
        m = "SF"
        mappings = [
            ("LEGAL_ENTITY",   "legal_entity",      "FOCompany"),
            ("COMPANY",        "company",            "FOCompany"),
            ("BUSINESS_UNIT",  "business_unit",      "FOBusinessUnit"),
            ("DIVISION",       "sf_division",        "FODivision"),
            ("DEPARTMENT",     "department",         "FODepartment"),
            ("LOCATION",       "location",           "FOLocation"),
            ("COST_CENTER",    "sf_cost_centre",     "FOCostCenter"),
            ("JOB_CODE",       "job_classification", "FOJobCode"),
            ("JOB_LEVEL",      "job_level",          "FOJobLevel"),
            ("PAY_GROUP",      "pay_group",          "FOPayGroup"),
            ("PAY_GRADE",      "pay_grade",          "FOPayGrade"),
            ("EMPLOYEE_CLASS", "employee_class",     "FOEmployeeClass"),
            ("EVENT_REASON",   "event_reason",       "FOEventReason"),
            ("EMP_STATUS",     "employment_status",  "EmpEmployment"),
            ("HIRE_DATE",      "hire_activity",      "EmpEmployment"),
            ("COUNTRY",        "sf_country",         "FOLocation"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))

        # Additional SF fields
        elements.extend(self._extract_distinct(records, "WORKFLOW_STATUS", "workflow_config", m, ""))
        elements.extend(self._extract_distinct(records, "APPROVAL_CHAIN", "approval_workflow", m, ""))
        elements.extend(self._extract_distinct(records, "CUSTOM_OBJECT", "mdf_custom_object", m, ""))

        # Module detection
        fields = {k.upper() for k in records[0].keys()}
        module_checks: list[tuple[set[str], str]] = [
            ({"REQ_ID", "CANDIDATE_ID", "APPLICATION_ID"}, "Recruiting"),
            ({"GOAL_PLAN", "REVIEW_CYCLE", "RATING", "FORM_TEMPLATE_ID"}, "Performance & Goals"),
            ({"COMP_PLAN", "BONUS_TARGET", "SALARY", "PAY_COMPONENT"}, "Compensation"),
            ({"COURSE_ID", "CERT_EXPIRY", "COMPLETION_STATUS", "LEARNING_ASSIGNMENT"}, "Learning (LMS)"),
            ({"TIME_TYPE", "WORK_SCHEDULE", "ABSENCE_TYPE", "TIMESHEET_STATUS"}, "Time Management"),
            ({"TALENT_POOL", "READINESS", "SUCCESSOR_ID", "NOMINATION_STATUS"}, "Succession Planning"),
            ({"PAYROLL_AREA", "ECP_STATUS", "REPLICATION_STATUS"}, "EC Payroll Integration"),
        ]
        for check_fields, module_name in module_checks:
            if fields & check_fields:
                elements.append(ConfigElement(
                    module=m,
                    element_type="sf_module_active",
                    element_value=module_name,
                    transaction_count=len(records),
                    status=ConfigStatus.ACTIVE,
                    sap_reference_table="",
                ))

        # Onboarding (special: compound check)
        if fields & {"ONBOARDING_STATUS", "TASK_STATUS"} or ({"START_DATE", "DOCUMENT_STATUS"} <= fields):
            elements.append(ConfigElement(
                module=m,
                element_type="sf_module_active",
                element_value="Onboarding",
                transaction_count=len(records),
                status=ConfigStatus.ACTIVE,
                sap_reference_table="",
            ))

        # Integration detection
        if fields & {"PAYROLL_AREA", "ECP_STATUS", "REPLICATION_STATUS"}:
            elements.append(ConfigElement(
                module=m,
                element_type="sf_integration",
                element_value="EC Payroll Integration",
                transaction_count=len(records),
                status=ConfigStatus.ACTIVE,
                sap_reference_table="",
            ))

        # Position Management feature
        if {"POSITION_ID", "POSITION_STATUS"} <= fields:
            elements.append(ConfigElement(
                module=m,
                element_type="sf_feature_active",
                element_value="Position Management",
                transaction_count=len(records),
                status=ConfigStatus.ACTIVE,
                sap_reference_table="",
            ))

        return elements

    # ------------------------------------------------------------------
    # CONCUR
    # ------------------------------------------------------------------

    def _discover_concur(self, records: list[dict]) -> list[ConfigElement]:
        m = "CONCUR"
        mappings = [
            ("EXPENSE_TYPE",    "expense_type",             "ExpenseType"),
            ("EXPENSE_CATEGORY", "expense_category",        "ExpenseCategory"),
            ("PAYMENT_TYPE",    "payment_type",             "PaymentType"),
            ("POLICY_NAME",     "expense_policy",           "Policy"),
            ("REPORT_STATUS",   "report_workflow_status",   "ReportStatus"),
            ("APPROVAL_STATUS", "approval_config",          "ApprovalStatus"),
            ("CURRENCY_CODE",   "concur_currency",          "Currency"),
            ("COUNTRY_CODE",    "concur_country",           "Country"),
            ("COST_CENTER",     "concur_cost_centre",       "Allocation"),
            ("DEPARTMENT",      "concur_department",        "Allocation"),
            ("ACCOUNT_CODE",    "gl_account_mapping",       "AccountCode"),
            ("PROJECT_CODE",    "project_allocation",       "Project"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))

        # Additional fields
        elements.extend(self._extract_distinct(records, "CARD_TYPE", "card_program", m, ""))
        elements.extend(self._extract_distinct(records, "CARD_TRANSACTION_TYPE", "card_transaction_type", m, ""))
        elements.extend(self._extract_distinct(records, "EXCEPTION_TYPE", "audit_rule", m, ""))
        elements.extend(self._extract_distinct(records, "VIOLATION_TYPE", "policy_violation", m, ""))

        # Module detection
        fields = {k.upper() for k in records[0].keys()}
        module_checks: list[tuple[set[str], str]] = [
            ({"REPORT_ID", "EXPENSE_TYPE"}, "Concur Expense"),
            ({"TRIP_ID", "BOOKING_TYPE", "ITINERARY_ID"}, "Concur Travel"),
            ({"INVOICE_ID", "VENDOR_CODE", "PO_NUMBER"}, "Concur Invoice"),
            ({"REQUEST_ID", "REQUEST_STATUS"}, "Concur Request"),
        ]
        for check_fields, module_name in module_checks:
            if fields & check_fields:
                elements.append(ConfigElement(
                    module=m,
                    element_type="concur_module_active",
                    element_value=module_name,
                    transaction_count=len(records),
                    status=ConfigStatus.ACTIVE,
                    sap_reference_table="",
                ))

        # Feature detection
        if fields & {"SAP_DOC_NUMBER", "FI_DOC", "POSTING_STATUS"}:
            elements.append(ConfigElement(
                module=m, element_type="concur_feature_active",
                element_value="SAP FI Integration",
                transaction_count=len(records),
                status=ConfigStatus.ACTIVE, sap_reference_table="",
            ))
        if fields & {"DELEGATE_ID", "PROXY_USER"}:
            elements.append(ConfigElement(
                module=m, element_type="concur_feature_active",
                element_value="Delegation",
                transaction_count=len(records),
                status=ConfigStatus.ACTIVE, sap_reference_table="",
            ))
        if "CASH_ADVANCE_ID" in fields:
            elements.append(ConfigElement(
                module=m, element_type="concur_feature_active",
                element_value="Cash Advance",
                transaction_count=len(records),
                status=ConfigStatus.ACTIVE, sap_reference_table="",
            ))

        return elements

    # ------------------------------------------------------------------
    # eWMS — Extended Warehouse Management
    # ------------------------------------------------------------------

    def _discover_ewms(self, records: list[dict]) -> list[ConfigElement]:
        m = "EWMS"
        mappings = [
            ("LGNUM",           "warehouse_number",       "/SCWM/T300"),
            ("LGTYP",           "storage_type",           "/SCWM/T301"),
            ("LGBER",           "storage_section",        "/SCWM/T302"),
            ("LGPLA",           "storage_bin",            "/SCWM/LAGP"),
            ("NLTYP",           "dest_storage_type",      "/SCWM/T301"),
            ("NLPLA",           "dest_storage_bin",       "/SCWM/LAGP"),
            ("PRESSION_TYPE",   "warehouse_process_type", "/SCWM/TPROCESS"),
            ("WAVE_TYPE",       "wave_type",              "/SCWM/TWAVE"),
            ("WAVE_STATUS",     "wave_status",            "/SCWM/WAVE"),
            ("TANUM",           "warehouse_task",         "/SCWM/ORDIM_C"),
            ("PROCTY",          "process_type",           "/SCWM/T346"),
            ("WHO_TYPE",        "warehouse_order_type",   "/SCWM/WHO"),
            ("CAT",             "stock_category",         "/SCWM/QUAN"),
            ("STOCK_TYPE",      "stock_type",             "/SCWM/QUAN"),
            ("ENTITLED",        "stock_owner",            "/SCWM/QUAN"),
            ("RSRC",            "resource_id",            "/SCWM/RSRC"),
            ("RSRC_TYPE",       "resource_type",          "/SCWM/TRSRC_TYP"),
            ("QUEUE",           "resource_queue",         "/SCWM/RSRC_QUE"),
            ("AESSION_AREA",    "activity_area",          "/SCWM/T306"),
            ("CHARG",           "batch_number",           "/SCWM/QUAN"),
        ]
        elements: list[ConfigElement] = []
        for field, etype, ref in mappings:
            elements.extend(self._extract_distinct(records, field, etype, m, ref))

        # HU detection
        elements.extend(self._extract_distinct(records, "HUIDENT", "handling_unit", m, ""))
        elements.extend(self._extract_distinct(records, "HU_TYPE", "hu_type", m, ""))

        # Feature detection
        fields = {k.upper() for k in records[0].keys()}
        feature_checks: list[tuple[set[str], str]] = [
            ({"DG_INDICATOR", "UN_NUMBER"}, "Dangerous Goods"),
            ({"QA_STATUS", "INSPECTION_LOT"}, "Quality Inspection"),
            ({"VAS_ORDER", "KIT_ID"}, "VAS/Kitting"),
            ({"XDOCK_TYPE", "XDOCK_REF"}, "Cross-Docking"),
            ({"YARD_ZONE", "YARD_SLOT"}, "Yard Management"),
            ({"LM_TASK", "WORKER_ID"}, "Labour Management"),
            ({"VBELN_DLV", "DELIVERY_ITEM"}, "ECC Delivery Integration"),
            ({"RF_DEVICE", "RF_TRANSACTION"}, "RF/Mobile Devices"),
        ]
        for check_fields, feature_name in feature_checks:
            if fields & check_fields:
                elements.append(ConfigElement(
                    module=m,
                    element_type="ewms_feature_active",
                    element_value=feature_name,
                    transaction_count=len(records),
                    status=ConfigStatus.ACTIVE,
                    sap_reference_table="",
                ))

        return elements

    # ------------------------------------------------------------------
    # Z-Object Integration
    # ------------------------------------------------------------------

    def _append_z_objects_to_inventory(
        self, records: list[dict], elements: list[ConfigElement]
    ) -> list[ConfigElement]:
        """Detect Z objects and append them to the config inventory."""
        from api.services.z_object_intelligence.detector import ZDetector

        detector = ZDetector()
        result = detector.detect(records)
        for z_obj in result.z_config_values:
            elements.append(ConfigElement(
                module=z_obj.module,
                element_type=f"z_{z_obj.source_field.lower()}",
                element_value=z_obj.object_name,
                transaction_count=z_obj.transaction_count,
                status=ConfigStatus.ACTIVE if z_obj.transaction_count > 0 else ConfigStatus.DORMANT,
                sap_reference_table=f"Z-CUSTOM ({z_obj.source_field})",
            ))
        return elements

    # ------------------------------------------------------------------
    # FI helpers
    # ------------------------------------------------------------------

    def _detect_number_ranges(self, records: list[dict]) -> list[ConfigElement]:
        """Analyse BELNR patterns to detect FI document number ranges."""
        doc_numbers: list[str] = []
        for r in records:
            belnr = r.get("BELNR") or r.get("belnr")
            if belnr is not None and belnr != "":
                doc_numbers.append(str(belnr))

        if not doc_numbers:
            return []

        doc_numbers.sort()

        # Group by first 2 characters (number range prefix)
        groups: dict[str, list[str]] = {}
        for num in doc_numbers:
            prefix = num[:2] if len(num) >= 2 else num
            groups.setdefault(prefix, []).append(num)

        elements: list[ConfigElement] = []
        for prefix, nums in groups.items():
            min_num = nums[0]
            max_num = nums[-1]
            count = len(nums)

            # Estimate utilisation: count / (10^digit_length / 100), capped at 100%
            digit_len = len(nums[0])
            capacity = 10 ** digit_len / 100
            utilisation = min(count / capacity * 100, 100.0) if capacity > 0 else 0.0

            elements.append(ConfigElement(
                module="FI",
                element_type="number_range",
                element_value=f"{prefix}: {min_num}-{max_num} ({count} docs, {utilisation:.1f}% util)",
                transaction_count=count,
                status=ConfigStatus.ACTIVE,
                sap_reference_table="NRIV",
            ))

        return elements

    def _detect_fiscal_periods(self, records: list[dict]) -> list[ConfigElement]:
        """Detect fiscal year periods from MONAT + GJAHR fields."""
        periods: dict[str, int] = {}
        for r in records:
            monat = r.get("MONAT") or r.get("monat")
            gjahr = r.get("GJAHR") or r.get("gjahr")
            if monat is not None and gjahr is not None:
                key = f"{gjahr}/{str(monat).zfill(2)}"
                periods[key] = periods.get(key, 0) + 1

        return [
            ConfigElement(
                module="FI",
                element_type="fiscal_period",
                element_value=period,
                transaction_count=count,
                status=ConfigStatus.ACTIVE,
                sap_reference_table="T009B",
            )
            for period, count in periods.items()
        ]
