"""
SAP Standard Baseline Configuration.
Default customising values delivered with SAP systems.
Used by SPROReader when a live connection is unavailable.
Organised by: system_type -> module -> config_table -> list of records
"""

BASELINE_CONFIG: dict[str, dict[str, dict[str, list[dict]]]] = {
    # =========================================================================
    # ECC
    # =========================================================================
    "ecc": {
        # -----------------------------------------------------------------
        # Accounts Payable
        # -----------------------------------------------------------------
        "accounts_payable": {
            "T077Y": [
                {"KTOKK": "0001", "TXT30": "Domestic vendors", "DESCRIPTION": "Standard domestic vendor accounts"},
                {"KTOKK": "0002", "TXT30": "Foreign vendors", "DESCRIPTION": "International vendor accounts"},
                {"KTOKK": "0003", "TXT30": "One-time vendors", "DESCRIPTION": "One-time vendor accounts without master data"},
                {"KTOKK": "0004", "TXT30": "Alternative payees", "DESCRIPTION": "Alternative payee vendor accounts"},
                {"KTOKK": "CPD", "TXT30": "One-time account", "DESCRIPTION": "CPD one-time vendor account"},
                {"KTOKK": "KRED", "TXT30": "Vendors (general)", "DESCRIPTION": "General vendor account group"},
            ],
            "T052": [
                {"ZTERM": "0001", "ZTAGG": 0, "ZTAG1": 14, "ZTAG2": 30, "ZTAG3": 45, "TXT30": "Within 14 days 2%, 30 days 1%, 45 net"},
                {"ZTERM": "0002", "ZTAGG": 0, "ZTAG1": 10, "ZTAG2": 20, "ZTAG3": 30, "TXT30": "Within 10 days 3%, 20 days 2%, 30 net"},
                {"ZTERM": "0003", "ZTAGG": 0, "ZTAG1": 0, "ZTAG2": 0, "ZTAG3": 30, "TXT30": "Net 30 days"},
                {"ZTERM": "0004", "ZTAGG": 0, "ZTAG1": 0, "ZTAG2": 0, "ZTAG3": 14, "TXT30": "Net 14 days"},
                {"ZTERM": "0005", "ZTAGG": 0, "ZTAG1": 0, "ZTAG2": 0, "ZTAG3": 45, "TXT30": "Net 45 days"},
                {"ZTERM": "0006", "ZTAGG": 0, "ZTAG1": 0, "ZTAG2": 0, "ZTAG3": 60, "TXT30": "Net 60 days"},
                {"ZTERM": "0007", "ZTAGG": 0, "ZTAG1": 0, "ZTAG2": 0, "ZTAG3": 90, "TXT30": "Net 90 days"},
                {"ZTERM": "0008", "ZTAGG": 0, "ZTAG1": 0, "ZTAG2": 0, "ZTAG3": 0, "TXT30": "Payable immediately"},
                {"ZTERM": "0009", "ZTAGG": 0, "ZTAG1": 10, "ZTAG2": 0, "ZTAG3": 30, "TXT30": "Within 10 days 2%, 30 net"},
                {"ZTERM": "0010", "ZTAGG": 0, "ZTAG1": 14, "ZTAG2": 0, "ZTAG3": 60, "TXT30": "Within 14 days 3%, 60 net"},
            ],
            "T042Z": [
                {"ZLSCH": "C", "TEXT1": "Check", "DESCRIPTION": "Payment by check"},
                {"ZLSCH": "T", "TEXT1": "Bank transfer", "DESCRIPTION": "Payment by bank transfer"},
                {"ZLSCH": "U", "TEXT1": "ACH/Direct debit", "DESCRIPTION": "Automated clearing house"},
                {"ZLSCH": "E", "TEXT1": "Wire transfer", "DESCRIPTION": "Electronic wire transfer"},
                {"ZLSCH": "W", "TEXT1": "Bill of exchange", "DESCRIPTION": "Payment by bill of exchange"},
                {"ZLSCH": "P", "TEXT1": "Post office", "DESCRIPTION": "Payment via post office"},
                {"ZLSCH": "S", "TEXT1": "Standing order", "DESCRIPTION": "Standing order / direct debit"},
                {"ZLSCH": "B", "TEXT1": "Bank collection", "DESCRIPTION": "Payment by bank collection"},
            ],
            "T040": [
                {"MESSION": "0001", "TEXT1": "Standard dunning", "DESCRIPTION": "4-level standard dunning procedure"},
                {"MESSION": "0002", "TEXT1": "Urgent dunning", "DESCRIPTION": "Accelerated dunning with shorter intervals"},
                {"MESSION": "0003", "TEXT1": "Gentle dunning", "DESCRIPTION": "Extended intervals for key accounts"},
            ],
        },
        # -----------------------------------------------------------------
        # Accounts Receivable
        # -----------------------------------------------------------------
        "accounts_receivable": {
            "T077D": [
                {"KTOKD": "0001", "TXT30": "Domestic customers", "DESCRIPTION": "Standard domestic customer accounts"},
                {"KTOKD": "0002", "TXT30": "Foreign customers", "DESCRIPTION": "International customer accounts"},
                {"KTOKD": "0003", "TXT30": "One-time customers", "DESCRIPTION": "One-time customer accounts without master data"},
                {"KTOKD": "0004", "TXT30": "Inter-company customers", "DESCRIPTION": "Inter-company customer accounts"},
                {"KTOKD": "0005", "TXT30": "CPD customers", "DESCRIPTION": "CPD one-time customer accounts"},
                {"KTOKD": "DEBI", "TXT30": "Customers (general)", "DESCRIPTION": "General customer account group"},
            ],
        },
        # -----------------------------------------------------------------
        # Material Master
        # -----------------------------------------------------------------
        "material_master": {
            "T134": [
                {"MTART": "FERT", "MTBEZ": "Finished product", "BKLAS_DEFAULT": "7920", "VPRSV_DEFAULT": "S", "PROCUREMENT": "E"},
                {"MTART": "HALB", "MTBEZ": "Semi-finished product", "BKLAS_DEFAULT": "7900", "VPRSV_DEFAULT": "S", "PROCUREMENT": "E"},
                {"MTART": "ROH", "MTBEZ": "Raw material", "BKLAS_DEFAULT": "3000", "VPRSV_DEFAULT": "V", "PROCUREMENT": "F"},
                {"MTART": "HIBE", "MTBEZ": "Operating supplies", "BKLAS_DEFAULT": "3010", "VPRSV_DEFAULT": "V", "PROCUREMENT": "F"},
                {"MTART": "VERP", "MTBEZ": "Packaging material", "BKLAS_DEFAULT": "3020", "VPRSV_DEFAULT": "V", "PROCUREMENT": "F"},
                {"MTART": "NLAG", "MTBEZ": "Non-stock material", "BKLAS_DEFAULT": "", "VPRSV_DEFAULT": "", "PROCUREMENT": "F"},
                {"MTART": "DIEN", "MTBEZ": "Service", "BKLAS_DEFAULT": "", "VPRSV_DEFAULT": "", "PROCUREMENT": "F"},
                {"MTART": "ERSA", "MTBEZ": "Spare part", "BKLAS_DEFAULT": "3030", "VPRSV_DEFAULT": "V", "PROCUREMENT": "X"},
                {"MTART": "HAWA", "MTBEZ": "Trading good", "BKLAS_DEFAULT": "3100", "VPRSV_DEFAULT": "V", "PROCUREMENT": "F"},
                {"MTART": "KMAT", "MTBEZ": "Configurable material", "BKLAS_DEFAULT": "7920", "VPRSV_DEFAULT": "S", "PROCUREMENT": "E"},
                {"MTART": "PIPE", "MTBEZ": "Pipeline material", "BKLAS_DEFAULT": "3000", "VPRSV_DEFAULT": "V", "PROCUREMENT": "F"},
                {"MTART": "UNBW", "MTBEZ": "Non-valuated material", "BKLAS_DEFAULT": "", "VPRSV_DEFAULT": "", "PROCUREMENT": "F"},
            ],
            "T023": [
                {"MATKL": "001", "WGBEZ": "Mechanical parts"},
                {"MATKL": "002", "WGBEZ": "Electrical components"},
                {"MATKL": "003", "WGBEZ": "Raw materials"},
                {"MATKL": "004", "WGBEZ": "Packaging materials"},
                {"MATKL": "005", "WGBEZ": "Operating supplies"},
                {"MATKL": "006", "WGBEZ": "Spare parts"},
                {"MATKL": "007", "WGBEZ": "Finished goods"},
                {"MATKL": "008", "WGBEZ": "Semi-finished goods"},
                {"MATKL": "009", "WGBEZ": "Services"},
                {"MATKL": "010", "WGBEZ": "Trading goods"},
                {"MATKL": "011", "WGBEZ": "Chemicals"},
                {"MATKL": "012", "WGBEZ": "Office supplies"},
            ],
            "T006": [
                {"MSEHI": "EA", "MSEHL": "Each", "DIMID": "AAAADL"},
                {"MSEHI": "KG", "MSEHL": "Kilogram", "DIMID": "MASS"},
                {"MSEHI": "G", "MSEHL": "Gram", "DIMID": "MASS"},
                {"MSEHI": "TO", "MSEHL": "Metric ton", "DIMID": "MASS"},
                {"MSEHI": "L", "MSEHL": "Litre", "DIMID": "VOLUME"},
                {"MSEHI": "ML", "MSEHL": "Millilitre", "DIMID": "VOLUME"},
                {"MSEHI": "M", "MSEHL": "Metre", "DIMID": "LENGTH"},
                {"MSEHI": "CM", "MSEHL": "Centimetre", "DIMID": "LENGTH"},
                {"MSEHI": "MM", "MSEHL": "Millimetre", "DIMID": "LENGTH"},
                {"MSEHI": "M2", "MSEHL": "Square metre", "DIMID": "SURFAC"},
                {"MSEHI": "M3", "MSEHL": "Cubic metre", "DIMID": "VOLUME"},
                {"MSEHI": "PC", "MSEHL": "Piece", "DIMID": "AAAADL"},
                {"MSEHI": "PAL", "MSEHL": "Pallet", "DIMID": "AAAADL"},
                {"MSEHI": "BOX", "MSEHL": "Box", "DIMID": "AAAADL"},
                {"MSEHI": "PKG", "MSEHL": "Package", "DIMID": "AAAADL"},
                {"MSEHI": "SET", "MSEHL": "Set", "DIMID": "AAAADL"},
                {"MSEHI": "ROL", "MSEHL": "Roll", "DIMID": "AAAADL"},
                {"MSEHI": "SHT", "MSEHL": "Sheet", "DIMID": "AAAADL"},
                {"MSEHI": "HR", "MSEHL": "Hour", "DIMID": "TIME"},
                {"MSEHI": "DAY", "MSEHL": "Day", "DIMID": "TIME"},
            ],
            "T025": [
                {"BKLAS": "3000", "BKBEZ": "Raw materials"},
                {"BKLAS": "3010", "BKBEZ": "Operating supplies"},
                {"BKLAS": "3020", "BKBEZ": "Packaging materials"},
                {"BKLAS": "3030", "BKBEZ": "Spare parts"},
                {"BKLAS": "3100", "BKBEZ": "Trading goods"},
                {"BKLAS": "7900", "BKBEZ": "Semi-finished products"},
                {"BKLAS": "7920", "BKBEZ": "Finished products"},
                {"BKLAS": "7960", "BKBEZ": "Services"},
                {"BKLAS": "7980", "BKBEZ": "Non-valuated materials"},
            ],
        },
        # -----------------------------------------------------------------
        # FI General Ledger
        # -----------------------------------------------------------------
        "fi_gl": {
            "T004": [
                {"KTOPL": "CAUS", "KTOPLB": "Chart of accounts - US", "DESCRIPTION": "US standard chart of accounts"},
                {"KTOPL": "CADE", "KTOPLB": "Chart of accounts - Germany", "DESCRIPTION": "German standard chart of accounts"},
                {"KTOPL": "CAFR", "KTOPLB": "Chart of accounts - France", "DESCRIPTION": "French standard chart of accounts"},
                {"KTOPL": "CAZN", "KTOPLB": "Chart of accounts - China", "DESCRIPTION": "Chinese standard chart of accounts"},
                {"KTOPL": "INT", "KTOPLB": "International CoA", "DESCRIPTION": "International group chart of accounts"},
                {"KTOPL": "YCOA", "KTOPLB": "Custom chart of accounts", "DESCRIPTION": "Customer-defined chart of accounts"},
            ],
            "T003": [
                {"BLART": "SA", "LTEXT": "GL account document", "DESCRIPTION": "General ledger account posting"},
                {"BLART": "KR", "LTEXT": "Vendor invoice", "DESCRIPTION": "Vendor invoice posting"},
                {"BLART": "KG", "LTEXT": "Vendor credit memo", "DESCRIPTION": "Vendor credit memo posting"},
                {"BLART": "KZ", "LTEXT": "Vendor payment", "DESCRIPTION": "Vendor payment posting"},
                {"BLART": "DR", "LTEXT": "Customer invoice", "DESCRIPTION": "Customer invoice posting"},
                {"BLART": "DG", "LTEXT": "Customer credit memo", "DESCRIPTION": "Customer credit memo posting"},
                {"BLART": "DZ", "LTEXT": "Customer payment", "DESCRIPTION": "Customer payment posting"},
                {"BLART": "AB", "LTEXT": "Accounting document", "DESCRIPTION": "General accounting document"},
                {"BLART": "WE", "LTEXT": "Goods receipt", "DESCRIPTION": "Goods receipt posting"},
                {"BLART": "RE", "LTEXT": "Invoice receipt", "DESCRIPTION": "Invoice verification posting"},
                {"BLART": "AA", "LTEXT": "Asset posting", "DESCRIPTION": "Asset accounting posting"},
                {"BLART": "AF", "LTEXT": "Depreciation posting", "DESCRIPTION": "Asset depreciation run posting"},
            ],
        },
        # -----------------------------------------------------------------
        # MM Purchasing
        # -----------------------------------------------------------------
        "mm_purchasing": {
            "T161": [
                {"BSART": "NB", "BSTYP": "F", "BATXT": "Standard PO", "DESCRIPTION": "Standard purchase order"},
                {"BSART": "FO", "BSTYP": "F", "BATXT": "Framework order", "DESCRIPTION": "Framework / blanket purchase order"},
                {"BSART": "UB", "BSTYP": "F", "BATXT": "Stock transport order", "DESCRIPTION": "Stock transfer between plants"},
                {"BSART": "MK", "BSTYP": "K", "BATXT": "Scheduling agreement", "DESCRIPTION": "Scheduling agreement"},
                {"BSART": "LP", "BSTYP": "L", "BATXT": "Contract", "DESCRIPTION": "Outline agreement / contract"},
                {"BSART": "EC", "BSTYP": "F", "BATXT": "External service", "DESCRIPTION": "Service purchase order"},
                {"BSART": "ZNB", "BSTYP": "F", "BATXT": "Custom PO type", "DESCRIPTION": "Customer-defined purchase order type"},
            ],
        },
        # -----------------------------------------------------------------
        # Business Partner
        # -----------------------------------------------------------------
        "business_partner": {
            "TB003": [
                {"BU_GROUP": "0001", "BU_GROUPTXT": "Organization", "DESCRIPTION": "Business partner group for organisations"},
                {"BU_GROUP": "0002", "BU_GROUPTXT": "Person", "DESCRIPTION": "Business partner group for natural persons"},
                {"BU_GROUP": "0003", "BU_GROUPTXT": "Group", "DESCRIPTION": "Business partner group for groups / associations"},
                {"BU_GROUP": "BP01", "BU_GROUPTXT": "Customer", "DESCRIPTION": "Customer-facing business partner group"},
                {"BU_GROUP": "BP02", "BU_GROUPTXT": "Vendor", "DESCRIPTION": "Vendor-facing business partner group"},
                {"BU_GROUP": "BPEM", "BU_GROUPTXT": "Employee", "DESCRIPTION": "Business partner group for employees"},
            ],
            "TBZ9": [
                {"ROLE_CATEGORY": "BUP001", "ROLE_CATTXT": "General BP role", "DESCRIPTION": "General business partner role"},
                {"ROLE_CATEGORY": "BUP002", "ROLE_CATTXT": "Contact person", "DESCRIPTION": "Contact person role"},
                {"ROLE_CATEGORY": "BUP003", "ROLE_CATTXT": "Employee", "DESCRIPTION": "Employee role"},
                {"ROLE_CATEGORY": "FLVN00", "ROLE_CATTXT": "FI Vendor", "DESCRIPTION": "Financial accounting vendor role"},
                {"ROLE_CATEGORY": "FLVN01", "ROLE_CATTXT": "FI Vendor (extended)", "DESCRIPTION": "Extended FI vendor role"},
                {"ROLE_CATEGORY": "FLCU00", "ROLE_CATTXT": "FI Customer", "DESCRIPTION": "Financial accounting customer role"},
                {"ROLE_CATEGORY": "FLCU01", "ROLE_CATTXT": "FI Customer (extended)", "DESCRIPTION": "Extended FI customer role"},
            ],
        },
        # -----------------------------------------------------------------
        # Asset Accounting
        # -----------------------------------------------------------------
        "asset_accounting": {
            "T093": [
                {"AFASL": "LINA", "AFATXT": "Straight-line from acquisition date", "DESCRIPTION": "Straight-line depreciation from acquisition date"},
                {"AFASL": "LINM", "AFATXT": "Straight-line from month of capitalisation", "DESCRIPTION": "Straight-line depreciation from month of capitalisation"},
                {"AFASL": "DEGR", "AFATXT": "Declining-balance depreciation", "DESCRIPTION": "Declining-balance depreciation method"},
                {"AFASL": "DG20", "AFATXT": "Declining-balance 20%", "DESCRIPTION": "Declining-balance depreciation at 20% rate"},
                {"AFASL": "DG30", "AFATXT": "Declining-balance 30%", "DESCRIPTION": "Declining-balance depreciation at 30% rate"},
                {"AFASL": "0000", "AFATXT": "No depreciation", "DESCRIPTION": "No automatic depreciation (e.g. land)"},
                {"AFASL": "MANL", "AFATXT": "Manual depreciation", "DESCRIPTION": "Manual depreciation entry only"},
            ],
        },
    },

    # =========================================================================
    # SuccessFactors
    # =========================================================================
    "successfactors": {
        # -----------------------------------------------------------------
        # Employee Central
        # -----------------------------------------------------------------
        "employee_central": {
            "EMPLOYMENT_STATUS": [
                {"CODE": "A", "LABEL": "Active", "DESCRIPTION": "Currently active employee"},
                {"CODE": "T", "LABEL": "Terminated", "DESCRIPTION": "Employment terminated"},
                {"CODE": "R", "LABEL": "Retired", "DESCRIPTION": "Retired employee"},
                {"CODE": "S", "LABEL": "Suspended", "DESCRIPTION": "Employment suspended"},
                {"CODE": "L", "LABEL": "Leave of absence", "DESCRIPTION": "On authorised leave of absence"},
                {"CODE": "P", "LABEL": "Pre-hire", "DESCRIPTION": "Pre-hire / onboarding pending"},
            ],
            "EMPLOYMENT_TYPE": [
                {"CODE": "FT", "LABEL": "Full-time", "DESCRIPTION": "Full-time regular employee"},
                {"CODE": "PT", "LABEL": "Part-time", "DESCRIPTION": "Part-time regular employee"},
                {"CODE": "CT", "LABEL": "Contractor", "DESCRIPTION": "External contractor"},
                {"CODE": "IN", "LABEL": "Intern", "DESCRIPTION": "Intern / trainee"},
                {"CODE": "TMP", "LABEL": "Temporary", "DESCRIPTION": "Fixed-term temporary employee"},
            ],
            "GENDER": [
                {"CODE": "M", "LABEL": "Male", "DESCRIPTION": "Male"},
                {"CODE": "F", "LABEL": "Female", "DESCRIPTION": "Female"},
                {"CODE": "N", "LABEL": "Non-binary", "DESCRIPTION": "Non-binary / non-conforming"},
                {"CODE": "U", "LABEL": "Undisclosed", "DESCRIPTION": "Prefer not to disclose"},
            ],
            "MARITAL_STATUS": [
                {"CODE": "S", "LABEL": "Single", "DESCRIPTION": "Single / never married"},
                {"CODE": "M", "LABEL": "Married", "DESCRIPTION": "Married"},
                {"CODE": "D", "LABEL": "Divorced", "DESCRIPTION": "Divorced"},
                {"CODE": "W", "LABEL": "Widowed", "DESCRIPTION": "Widowed"},
                {"CODE": "P", "LABEL": "Domestic partner", "DESCRIPTION": "Domestic partnership / civil union"},
            ],
            "FOCompany": [
                {"externalCode": "C001", "name": "Global Headquarters", "country": "US", "currency": "USD"},
                {"externalCode": "C002", "name": "European Operations", "country": "DE", "currency": "EUR"},
                {"externalCode": "C003", "name": "Asia Pacific Hub", "country": "SG", "currency": "SGD"},
                {"externalCode": "C004", "name": "UK Subsidiary", "country": "GB", "currency": "GBP"},
            ],
            "FOEventReason": [
                {"externalCode": "NEWHIRE", "name": "New hire", "event": "HIRE"},
                {"externalCode": "REHIRE", "name": "Rehire", "event": "HIRE"},
                {"externalCode": "VOLTERM", "name": "Voluntary termination", "event": "TERMINATION"},
                {"externalCode": "INVOLTERM", "name": "Involuntary termination", "event": "TERMINATION"},
                {"externalCode": "RETIRE", "name": "Retirement", "event": "TERMINATION"},
                {"externalCode": "PROMO", "name": "Promotion", "event": "JOB_CHANGE"},
                {"externalCode": "TRANSFER", "name": "Transfer", "event": "JOB_CHANGE"},
                {"externalCode": "LATERAL", "name": "Lateral move", "event": "JOB_CHANGE"},
                {"externalCode": "DEMOTION", "name": "Demotion", "event": "JOB_CHANGE"},
                {"externalCode": "REORG", "name": "Reorganisation", "event": "ORG_CHANGE"},
                {"externalCode": "PAYINC", "name": "Pay increase", "event": "COMPENSATION"},
                {"externalCode": "PAYDEC", "name": "Pay decrease", "event": "COMPENSATION"},
                {"externalCode": "LOA", "name": "Leave of absence", "event": "LEAVE"},
            ],
            "FOPayGroup": [
                {"externalCode": "PG_MONTHLY", "name": "Monthly payroll", "frequency": "MONTHLY"},
                {"externalCode": "PG_BIWEEKLY", "name": "Bi-weekly payroll", "frequency": "BIWEEKLY"},
                {"externalCode": "PG_WEEKLY", "name": "Weekly payroll", "frequency": "WEEKLY"},
            ],
            "FOPayGrade": [
                {"externalCode": "GR01", "name": "Grade 1 - Entry level", "payBand": "Band A"},
                {"externalCode": "GR02", "name": "Grade 2 - Junior", "payBand": "Band A"},
                {"externalCode": "GR03", "name": "Grade 3 - Intermediate", "payBand": "Band B"},
                {"externalCode": "GR04", "name": "Grade 4 - Senior", "payBand": "Band B"},
                {"externalCode": "GR05", "name": "Grade 5 - Lead", "payBand": "Band C"},
                {"externalCode": "GR06", "name": "Grade 6 - Manager", "payBand": "Band C"},
                {"externalCode": "GR07", "name": "Grade 7 - Senior Manager", "payBand": "Band D"},
                {"externalCode": "GR08", "name": "Grade 8 - Director", "payBand": "Band D"},
                {"externalCode": "GR09", "name": "Grade 9 - VP", "payBand": "Band E"},
                {"externalCode": "GR10", "name": "Grade 10 - Executive", "payBand": "Band E"},
            ],
            "Picklist_gender": [
                {"optionId": "M", "label": "Male", "status": "ACTIVE"},
                {"optionId": "F", "label": "Female", "status": "ACTIVE"},
                {"optionId": "N", "label": "Non-binary", "status": "ACTIVE"},
                {"optionId": "U", "label": "Undisclosed", "status": "ACTIVE"},
            ],
            "Picklist_maritalStatus": [
                {"optionId": "S", "label": "Single", "status": "ACTIVE"},
                {"optionId": "M", "label": "Married", "status": "ACTIVE"},
                {"optionId": "D", "label": "Divorced", "status": "ACTIVE"},
                {"optionId": "W", "label": "Widowed", "status": "ACTIVE"},
                {"optionId": "P", "label": "Domestic partner", "status": "ACTIVE"},
                {"optionId": "SEP", "label": "Separated", "status": "ACTIVE"},
            ],
        },
        # -----------------------------------------------------------------
        # Compensation
        # -----------------------------------------------------------------
        "compensation": {
            "PAY_FREQUENCY": [
                {"CODE": "ANNUAL", "LABEL": "Annual", "DESCRIPTION": "Annual salary"},
                {"CODE": "MONTHLY", "LABEL": "Monthly", "DESCRIPTION": "Monthly salary"},
                {"CODE": "BIWEEKLY", "LABEL": "Bi-weekly", "DESCRIPTION": "Bi-weekly pay cycle"},
                {"CODE": "WEEKLY", "LABEL": "Weekly", "DESCRIPTION": "Weekly pay cycle"},
                {"CODE": "HOURLY", "LABEL": "Hourly", "DESCRIPTION": "Hourly pay rate"},
            ],
            "PAY_TYPE": [
                {"CODE": "BASE", "LABEL": "Base salary", "DESCRIPTION": "Regular base salary"},
                {"CODE": "BONUS", "LABEL": "Bonus", "DESCRIPTION": "Variable bonus compensation"},
                {"CODE": "EQUITY", "LABEL": "Equity / stock", "DESCRIPTION": "Stock-based compensation"},
            ],
        },
        # -----------------------------------------------------------------
        # Learning Management
        # -----------------------------------------------------------------
        "learning_management": {
            "COMPLETION_STATUS": [
                {"CODE": "NOT_STARTED", "LABEL": "Not started", "DESCRIPTION": "Learning item not yet started"},
                {"CODE": "IN_PROGRESS", "LABEL": "In progress", "DESCRIPTION": "Learning item in progress"},
                {"CODE": "COMPLETED", "LABEL": "Completed", "DESCRIPTION": "Learning item successfully completed"},
                {"CODE": "FAILED", "LABEL": "Failed", "DESCRIPTION": "Learning item not passed"},
                {"CODE": "WAIVED", "LABEL": "Waived", "DESCRIPTION": "Learning requirement waived"},
                {"CODE": "EXPIRED", "LABEL": "Expired", "DESCRIPTION": "Learning completion expired"},
            ],
        },
        # -----------------------------------------------------------------
        # Time & Attendance
        # -----------------------------------------------------------------
        "time_attendance": {
            "TIME_TYPE": [
                {"CODE": "REG", "LABEL": "Regular hours", "DESCRIPTION": "Standard regular working hours"},
                {"CODE": "OT", "LABEL": "Overtime", "DESCRIPTION": "Overtime hours"},
                {"CODE": "SICK", "LABEL": "Sick leave", "DESCRIPTION": "Sick leave hours"},
                {"CODE": "VAC", "LABEL": "Vacation", "DESCRIPTION": "Annual vacation leave"},
                {"CODE": "PER", "LABEL": "Personal leave", "DESCRIPTION": "Personal leave hours"},
                {"CODE": "HOL", "LABEL": "Holiday", "DESCRIPTION": "Public holiday"},
                {"CODE": "COMP", "LABEL": "Compensatory time", "DESCRIPTION": "Compensatory time off"},
                {"CODE": "TRAIN", "LABEL": "Training", "DESCRIPTION": "Training / education time"},
                {"CODE": "UNPAID", "LABEL": "Unpaid leave", "DESCRIPTION": "Unpaid leave of absence"},
            ],
            "APPROVAL_STATUS": [
                {"CODE": "PENDING", "LABEL": "Pending approval", "DESCRIPTION": "Awaiting manager approval"},
                {"CODE": "APPROVED", "LABEL": "Approved", "DESCRIPTION": "Approved by manager"},
                {"CODE": "REJECTED", "LABEL": "Rejected", "DESCRIPTION": "Rejected by manager"},
                {"CODE": "CANCELLED", "LABEL": "Cancelled", "DESCRIPTION": "Cancelled by employee"},
            ],
            "TimeType": [
                {"externalCode": "TT_REG", "name": "Regular working time", "category": "WORKING", "unit": "HOURS"},
                {"externalCode": "TT_OT50", "name": "Overtime 50%", "category": "OVERTIME", "unit": "HOURS"},
                {"externalCode": "TT_OT100", "name": "Overtime 100%", "category": "OVERTIME", "unit": "HOURS"},
                {"externalCode": "TT_SICK", "name": "Sick leave", "category": "ABSENCE", "unit": "DAYS"},
                {"externalCode": "TT_VAC", "name": "Vacation leave", "category": "ABSENCE", "unit": "DAYS"},
                {"externalCode": "TT_PER", "name": "Personal leave", "category": "ABSENCE", "unit": "DAYS"},
                {"externalCode": "TT_MAT", "name": "Maternity leave", "category": "ABSENCE", "unit": "DAYS"},
                {"externalCode": "TT_PAT", "name": "Paternity leave", "category": "ABSENCE", "unit": "DAYS"},
                {"externalCode": "TT_BER", "name": "Bereavement leave", "category": "ABSENCE", "unit": "DAYS"},
                {"externalCode": "TT_COMP", "name": "Compensatory time off", "category": "ABSENCE", "unit": "HOURS"},
                {"externalCode": "TT_TRAIN", "name": "Training time", "category": "WORKING", "unit": "HOURS"},
            ],
            "TimeAccountType": [
                {"externalCode": "TA_VAC", "name": "Vacation entitlement", "unit": "DAYS", "accrualFrequency": "MONTHLY"},
                {"externalCode": "TA_SICK", "name": "Sick leave entitlement", "unit": "DAYS", "accrualFrequency": "ANNUAL"},
                {"externalCode": "TA_COMP", "name": "Compensatory time bank", "unit": "HOURS", "accrualFrequency": "NONE"},
            ],
            "GOAL_STATUS": [
                {"CODE": "DRAFT", "LABEL": "Draft", "DESCRIPTION": "Goal in draft state"},
                {"CODE": "ACTIVE", "LABEL": "Active", "DESCRIPTION": "Goal currently active"},
                {"CODE": "COMPLETED", "LABEL": "Completed", "DESCRIPTION": "Goal completed"},
                {"CODE": "CANCELLED", "LABEL": "Cancelled", "DESCRIPTION": "Goal cancelled"},
                {"CODE": "ON_HOLD", "LABEL": "On hold", "DESCRIPTION": "Goal temporarily on hold"},
            ],
            "RATING_SCALE": [
                {"CODE": "1", "LABEL": "Does not meet expectations", "NUMERIC_VALUE": 1.0},
                {"CODE": "2", "LABEL": "Partially meets expectations", "NUMERIC_VALUE": 2.0},
                {"CODE": "3", "LABEL": "Meets expectations", "NUMERIC_VALUE": 3.0},
                {"CODE": "4", "LABEL": "Exceeds expectations", "NUMERIC_VALUE": 4.0},
                {"CODE": "5", "LABEL": "Outstanding", "NUMERIC_VALUE": 5.0},
            ],
        },
        # -----------------------------------------------------------------
        # Performance & Goals
        # -----------------------------------------------------------------
        "performance_goals": {
            "GOAL_STATUS": [
                {"CODE": "DRAFT", "LABEL": "Draft", "DESCRIPTION": "Goal in draft state"},
                {"CODE": "ACTIVE", "LABEL": "Active", "DESCRIPTION": "Goal currently active"},
                {"CODE": "COMPLETED", "LABEL": "Completed", "DESCRIPTION": "Goal completed"},
                {"CODE": "CANCELLED", "LABEL": "Cancelled", "DESCRIPTION": "Goal cancelled"},
                {"CODE": "ON_HOLD", "LABEL": "On hold", "DESCRIPTION": "Goal temporarily on hold"},
            ],
            "RATING_SCALE": [
                {"CODE": "1", "LABEL": "Does not meet expectations", "NUMERIC_VALUE": 1.0},
                {"CODE": "2", "LABEL": "Partially meets expectations", "NUMERIC_VALUE": 2.0},
                {"CODE": "3", "LABEL": "Meets expectations", "NUMERIC_VALUE": 3.0},
                {"CODE": "4", "LABEL": "Exceeds expectations", "NUMERIC_VALUE": 4.0},
                {"CODE": "5", "LABEL": "Outstanding", "NUMERIC_VALUE": 5.0},
            ],
            "RatingScale": [
                {
                    "externalCode": "RS_PERF_5",
                    "name": "5-point performance scale",
                    "scaleType": "NUMERIC",
                    "options": [
                        {"value": 1, "label": "Does not meet expectations"},
                        {"value": 2, "label": "Partially meets expectations"},
                        {"value": 3, "label": "Meets expectations"},
                        {"value": 4, "label": "Exceeds expectations"},
                        {"value": 5, "label": "Outstanding"},
                    ],
                },
            ],
            "FormTemplate": [
                {"externalCode": "FT_ANNUAL", "name": "Annual performance review", "frequency": "ANNUAL"},
                {"externalCode": "FT_MID", "name": "Mid-year check-in", "frequency": "SEMI_ANNUAL"},
                {"externalCode": "FT_PROBATION", "name": "Probation review", "frequency": "ONE_TIME"},
                {"externalCode": "FT_360", "name": "360-degree feedback", "frequency": "ANNUAL"},
            ],
        },
        # -----------------------------------------------------------------
        # Recruiting & Onboarding
        # -----------------------------------------------------------------
        "recruiting_onboarding": {
            "APPLICATION_STATUS": [
                {"CODE": "NEW", "LABEL": "New application", "DESCRIPTION": "Newly received application"},
                {"CODE": "REVIEW", "LABEL": "Under review", "DESCRIPTION": "Application being reviewed"},
                {"CODE": "INTERVIEW", "LABEL": "Interview", "DESCRIPTION": "Candidate in interview process"},
                {"CODE": "OFFER", "LABEL": "Offer extended", "DESCRIPTION": "Job offer extended to candidate"},
                {"CODE": "ACCEPTED", "LABEL": "Offer accepted", "DESCRIPTION": "Candidate accepted the offer"},
                {"CODE": "REJECTED", "LABEL": "Rejected", "DESCRIPTION": "Application rejected"},
                {"CODE": "WITHDRAWN", "LABEL": "Withdrawn", "DESCRIPTION": "Candidate withdrew application"},
            ],
            "REQUISITION_STATUS": [
                {"CODE": "DRAFT", "LABEL": "Draft", "DESCRIPTION": "Requisition in draft state"},
                {"CODE": "OPEN", "LABEL": "Open", "DESCRIPTION": "Requisition open for applications"},
                {"CODE": "ON_HOLD", "LABEL": "On hold", "DESCRIPTION": "Requisition temporarily paused"},
                {"CODE": "FILLED", "LABEL": "Filled", "DESCRIPTION": "Position filled"},
                {"CODE": "CLOSED", "LABEL": "Closed", "DESCRIPTION": "Requisition closed without filling"},
                {"CODE": "CANCELLED", "LABEL": "Cancelled", "DESCRIPTION": "Requisition cancelled"},
            ],
        },
    },

    # =========================================================================
    # Concur
    # =========================================================================
    "concur": {
        # -----------------------------------------------------------------
        # Concur Expense
        # -----------------------------------------------------------------
        "concur_expense": {
            "EXPENSE_TYPE": [
                {"CODE": "AIRFARE", "LABEL": "Airfare", "glAccount": "6200100", "DESCRIPTION": "Airline ticket expenses"},
                {"CODE": "HOTEL", "LABEL": "Hotel / lodging", "glAccount": "6200200", "DESCRIPTION": "Hotel and accommodation"},
                {"CODE": "MEALS", "LABEL": "Meals", "glAccount": "6200300", "DESCRIPTION": "Meal and dining expenses"},
                {"CODE": "TRANSPORT", "LABEL": "Ground transport", "glAccount": "6200400", "DESCRIPTION": "Taxi, ride-share, car rental"},
                {"CODE": "MILEAGE", "LABEL": "Mileage", "glAccount": "6200410", "DESCRIPTION": "Personal vehicle mileage reimbursement"},
                {"CODE": "PARKING", "LABEL": "Parking", "glAccount": "6200420", "DESCRIPTION": "Parking fees"},
                {"CODE": "FUEL", "LABEL": "Fuel", "glAccount": "6200430", "DESCRIPTION": "Fuel for rental or company vehicle"},
                {"CODE": "PHONE", "LABEL": "Telephone / internet", "glAccount": "6200500", "DESCRIPTION": "Phone and internet charges"},
                {"CODE": "ENTERTAIN", "LABEL": "Entertainment", "glAccount": "6200600", "DESCRIPTION": "Client entertainment expenses"},
                {"CODE": "SUPPLIES", "LABEL": "Office supplies", "glAccount": "6200700", "DESCRIPTION": "Office supply purchases"},
                {"CODE": "TRAINING", "LABEL": "Training / conference", "glAccount": "6200800", "DESCRIPTION": "Training and conference fees"},
                {"CODE": "MISC", "LABEL": "Miscellaneous", "glAccount": "6200900", "DESCRIPTION": "Miscellaneous expenses"},
                {"CODE": "PER_DIEM", "LABEL": "Per diem", "glAccount": "6200310", "DESCRIPTION": "Daily allowance for travel"},
            ],
            "PAYMENT_STATUS": [
                {"CODE": "PENDING", "LABEL": "Pending payment", "DESCRIPTION": "Expense approved, awaiting payment"},
                {"CODE": "PAID", "LABEL": "Paid", "DESCRIPTION": "Expense reimbursed"},
                {"CODE": "HOLD", "LABEL": "On hold", "DESCRIPTION": "Payment on hold pending review"},
                {"CODE": "CANCELLED", "LABEL": "Cancelled", "DESCRIPTION": "Payment cancelled"},
            ],
            "PaymentType": [
                {"CODE": "CASH", "LABEL": "Cash", "DESCRIPTION": "Cash payment by employee"},
                {"CODE": "CCARD", "LABEL": "Company credit card", "DESCRIPTION": "Company-issued credit card"},
                {"CODE": "PCARD", "LABEL": "Personal credit card", "DESCRIPTION": "Personal credit card"},
                {"CODE": "PREPAID", "LABEL": "Prepaid / advance", "DESCRIPTION": "Prepaid travel advance"},
            ],
            "APPROVAL_STATUS": [
                {"CODE": "DRAFT", "LABEL": "Draft", "DESCRIPTION": "Expense report in draft"},
                {"CODE": "SUBMITTED", "LABEL": "Submitted", "DESCRIPTION": "Submitted for approval"},
                {"CODE": "APPROVED", "LABEL": "Approved", "DESCRIPTION": "Approved by manager"},
                {"CODE": "REJECTED", "LABEL": "Rejected", "DESCRIPTION": "Rejected by approver"},
                {"CODE": "SENT_BACK", "LABEL": "Sent back", "DESCRIPTION": "Returned to employee for correction"},
                {"CODE": "PROCESSING", "LABEL": "Processing", "DESCRIPTION": "In finance processing queue"},
            ],
        },
    },

    # =========================================================================
    # Ariba
    # =========================================================================
    "ariba": {
        # -----------------------------------------------------------------
        # Ariba Supplier Management
        # -----------------------------------------------------------------
        "ariba_supplier": {
            "SUPPLIER_STATUS": [
                {"CODE": "PROSPECT", "LABEL": "Prospect", "DESCRIPTION": "Potential supplier under evaluation"},
                {"CODE": "PENDING", "LABEL": "Pending approval", "DESCRIPTION": "Supplier registration pending approval"},
                {"CODE": "APPROVED", "LABEL": "Approved", "DESCRIPTION": "Approved and active supplier"},
                {"CODE": "BLOCKED", "LABEL": "Blocked", "DESCRIPTION": "Supplier blocked from transactions"},
                {"CODE": "INACTIVE", "LABEL": "Inactive", "DESCRIPTION": "Supplier no longer active"},
            ],
            "QUALIFICATION_STATUS": [
                {"CODE": "NOT_STARTED", "LABEL": "Not started", "DESCRIPTION": "Qualification process not started"},
                {"CODE": "IN_PROGRESS", "LABEL": "In progress", "DESCRIPTION": "Qualification under way"},
                {"CODE": "QUALIFIED", "LABEL": "Qualified", "DESCRIPTION": "Supplier qualified"},
                {"CODE": "DISQUALIFIED", "LABEL": "Disqualified", "DESCRIPTION": "Supplier disqualified"},
            ],
        },
        # -----------------------------------------------------------------
        # Ariba Contracts
        # -----------------------------------------------------------------
        "ariba_contracts": {
            "CONTRACT_STATUS": [
                {"CODE": "DRAFT", "LABEL": "Draft", "DESCRIPTION": "Contract in draft state"},
                {"CODE": "ACTIVE", "LABEL": "Active", "DESCRIPTION": "Active and enforceable contract"},
                {"CODE": "EXPIRED", "LABEL": "Expired", "DESCRIPTION": "Contract past its end date"},
                {"CODE": "TERMINATED", "LABEL": "Terminated", "DESCRIPTION": "Contract terminated early"},
            ],
        },
    },

    # =========================================================================
    # eWMS (Extended Warehouse Management)
    # =========================================================================
    "ewms": {
        # -----------------------------------------------------------------
        # eWMS Stock
        # -----------------------------------------------------------------
        "ewms_stock": {
            "/SCWM/T300": [
                {"LGNUM": "WH01", "LNUMT": "Main warehouse", "DESCRIPTION": "Primary distribution centre"},
                {"LGNUM": "WH02", "LNUMT": "Regional warehouse", "DESCRIPTION": "Regional distribution facility"},
                {"LGNUM": "WH03", "LNUMT": "Cold storage", "DESCRIPTION": "Temperature-controlled warehouse"},
            ],
            "/SCWM/T301": [
                {"LGNUM": "WH01", "LGTYP": "0010", "LTYPT": "Goods receipt zone", "DESCRIPTION": "Inbound receiving area"},
                {"LGNUM": "WH01", "LGTYP": "0020", "LTYPT": "Quality inspection", "DESCRIPTION": "Quality inspection area"},
                {"LGNUM": "WH01", "LGTYP": "0030", "LTYPT": "High-rack storage", "DESCRIPTION": "Automated high-rack storage"},
                {"LGNUM": "WH01", "LGTYP": "0040", "LTYPT": "Block storage", "DESCRIPTION": "Floor-level block storage"},
                {"LGNUM": "WH01", "LGTYP": "0050", "LTYPT": "Shelf storage", "DESCRIPTION": "Manual shelf storage"},
                {"LGNUM": "WH01", "LGTYP": "0060", "LTYPT": "Picking area", "DESCRIPTION": "Order picking area"},
                {"LGNUM": "WH01", "LGTYP": "0070", "LTYPT": "Packing area", "DESCRIPTION": "Packing and consolidation"},
                {"LGNUM": "WH01", "LGTYP": "0080", "LTYPT": "Goods issue zone", "DESCRIPTION": "Outbound staging area"},
                {"LGNUM": "WH01", "LGTYP": "0090", "LTYPT": "Hazardous materials", "DESCRIPTION": "Hazmat storage area"},
                {"LGNUM": "WH01", "LGTYP": "0100", "LTYPT": "Returns area", "DESCRIPTION": "Returns processing area"},
            ],
            "/SCWM/T306": [
                {"LGNUM": "WH01", "AESSION": "0001", "ATYPT": "Putaway", "DESCRIPTION": "Putaway activity area"},
                {"LGNUM": "WH01", "AESSION": "0002", "ATYPT": "Picking", "DESCRIPTION": "Picking activity area"},
                {"LGNUM": "WH01", "AESSION": "0003", "ATYPT": "Replenishment", "DESCRIPTION": "Replenishment activity area"},
                {"LGNUM": "WH01", "AESSION": "0004", "ATYPT": "Inventory count", "DESCRIPTION": "Physical inventory counting area"},
            ],
        },
    },
}
