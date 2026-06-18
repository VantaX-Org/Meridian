"""SAP L1-L5 Business Process Hierarchy.

Provides a structured, deterministic mapping of end-to-end SAP processes
down to individual field-level data quality check points.

Hierarchy
---------
L1  End-to-end process (e.g. Procure to Pay)
L2  Sub-process area   (e.g. Vendor Management)
L3  Transaction         (e.g. Create Vendor Master — FK01)
L4  Transaction step    (e.g. Enter Company Code Data)
L5  Field               (e.g. LFA1.KTOKK — Account Group)

Each L5 field carries:
  field          — SAP table.field notation
  check_id       — Meridian check_id that validates this field
  description    — human-readable field label
  mandatory      — whether the field is required for the transaction
  config_source  — SPRO config table / customising path that governs the field
"""

from typing import Any

# Type aliases for readability
L5Field = dict[str, Any]
L4Step = dict[str, Any]
L3Transaction = dict[str, Any]
L2SubProcess = dict[str, Any]
L1Process = dict[str, Any]


PROCESS_DEFINITIONS: list[L1Process] = [
    # =========================================================================
    # L1: Procure to Pay (PTP)
    # =========================================================================
    {
        "id": "PTP",
        "name": "Procure to Pay",
        "description": "End-to-end procurement cycle from vendor onboarding through invoice payment.",
        "modules": ["accounts_payable", "mm_purchasing", "material_master", "fi_gl"],
        "l2_processes": [
            # -----------------------------------------------------------------
            # L2: Vendor Management
            # -----------------------------------------------------------------
            {
                "id": "PTP-VM",
                "name": "Vendor Management",
                "description": "Vendor master data creation, maintenance, and governance.",
                "l3_transactions": [
                    {
                        "id": "PTP-VM-FK01",
                        "name": "Create Vendor Master",
                        "tcode": "FK01",
                        "description": "Create a new vendor master record with all required views.",
                        "l4_steps": [
                            {
                                "id": "PTP-VM-FK01-01",
                                "name": "Enter Account Group",
                                "description": "Select the vendor account group that controls field status and number range.",
                                "l5_fields": [
                                    {
                                        "field": "LFA1.KTOKK",
                                        "check_id": "AP010",
                                        "description": "Account Group",
                                        "mandatory": True,
                                        "config_source": "T077Y",
                                    },
                                ],
                            },
                            {
                                "id": "PTP-VM-FK01-02",
                                "name": "Enter General Data",
                                "description": "Populate name, address, and communication data on the general data screen.",
                                "l5_fields": [
                                    {
                                        "field": "LFA1.NAME1",
                                        "check_id": "AP001",
                                        "description": "Vendor Name",
                                        "mandatory": True,
                                        "config_source": "T077Y (field status)",
                                    },
                                    {
                                        "field": "LFA1.LAND1",
                                        "check_id": "AP003",
                                        "description": "Country Key",
                                        "mandatory": True,
                                        "config_source": "T005",
                                    },
                                    {
                                        "field": "LFA1.STRAS",
                                        "check_id": "AP005",
                                        "description": "Street Address",
                                        "mandatory": True,
                                        "config_source": "T077Y (field status)",
                                    },
                                    {
                                        "field": "LFA1.ORT01",
                                        "check_id": "AP007",
                                        "description": "City",
                                        "mandatory": True,
                                        "config_source": "T077Y (field status)",
                                    },
                                    {
                                        "field": "LFA1.PSTLZ",
                                        "check_id": "AP009",
                                        "description": "Postal Code",
                                        "mandatory": False,
                                        "config_source": "T005 (country-dependent)",
                                    },
                                ],
                            },
                            {
                                "id": "PTP-VM-FK01-03",
                                "name": "Enter Company Code Data",
                                "description": "Set reconciliation account, payment terms, and payment methods at company code level.",
                                "l5_fields": [
                                    {
                                        "field": "LFB1.AKONT",
                                        "check_id": "AP014",
                                        "description": "Reconciliation Account",
                                        "mandatory": True,
                                        "config_source": "T077Y (field status) / SKB1",
                                    },
                                    {
                                        "field": "LFB1.ZTERM",
                                        "check_id": "AP016",
                                        "description": "Payment Terms",
                                        "mandatory": True,
                                        "config_source": "T052",
                                    },
                                    {
                                        "field": "LFB1.ZWELS",
                                        "check_id": "AP017",
                                        "description": "Payment Methods",
                                        "mandatory": True,
                                        "config_source": "T042Z",
                                    },
                                ],
                            },
                            {
                                "id": "PTP-VM-FK01-04",
                                "name": "Enter Bank Details",
                                "description": "Maintain vendor bank account details for automatic payment.",
                                "l5_fields": [
                                    {
                                        "field": "LFBK.BANKS",
                                        "check_id": "AP018",
                                        "description": "Bank Country Key",
                                        "mandatory": True,
                                        "config_source": "T012",
                                    },
                                    {
                                        "field": "LFBK.BANKL",
                                        "check_id": "AP019",
                                        "description": "Bank Key",
                                        "mandatory": True,
                                        "config_source": "BNKA",
                                    },
                                    {
                                        "field": "LFBK.BANKN",
                                        "check_id": "AP020",
                                        "description": "Bank Account Number",
                                        "mandatory": True,
                                        "config_source": "BNKA",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            # -----------------------------------------------------------------
            # L2: Purchase Order Processing
            # -----------------------------------------------------------------
            {
                "id": "PTP-PO",
                "name": "Purchase Order Processing",
                "description": "Create, approve, and manage purchase orders.",
                "l3_transactions": [
                    {
                        "id": "PTP-PO-ME21N",
                        "name": "Create Standard PO",
                        "tcode": "ME21N",
                        "description": "Create a standard purchase order referencing vendor, material, and pricing.",
                        "l4_steps": [
                            {
                                "id": "PTP-PO-ME21N-01",
                                "name": "PO Header",
                                "description": "Set vendor, purchasing org, company code, and order type.",
                                "l5_fields": [
                                    {
                                        "field": "EKKO.LIFNR",
                                        "check_id": "AP001",
                                        "description": "Vendor Number",
                                        "mandatory": True,
                                        "config_source": "LFA1 (vendor master)",
                                    },
                                    {
                                        "field": "EKKO.EKORG",
                                        "check_id": "PUR003",
                                        "description": "Purchasing Organisation",
                                        "mandatory": True,
                                        "config_source": "T024E",
                                    },
                                    {
                                        "field": "EKKO.BSART",
                                        "check_id": "PUR004",
                                        "description": "PO Document Type",
                                        "mandatory": True,
                                        "config_source": "T161",
                                    },
                                ],
                            },
                            {
                                "id": "PTP-PO-ME21N-02",
                                "name": "PO Line Items",
                                "description": "Add materials, quantities, prices, and delivery dates.",
                                "l5_fields": [
                                    {
                                        "field": "EKPO.MATNR",
                                        "check_id": "MM001",
                                        "description": "Material Number",
                                        "mandatory": True,
                                        "config_source": "MARA (material master)",
                                    },
                                    {
                                        "field": "EKPO.WERKS",
                                        "check_id": "MM005",
                                        "description": "Plant",
                                        "mandatory": True,
                                        "config_source": "T001W",
                                    },
                                    {
                                        "field": "EKPO.MENGE",
                                        "check_id": "PUR003",
                                        "description": "Order Quantity",
                                        "mandatory": True,
                                        "config_source": "N/A (transactional)",
                                    },
                                    {
                                        "field": "EKPO.NETPR",
                                        "check_id": "PUR003",
                                        "description": "Net Price",
                                        "mandatory": True,
                                        "config_source": "A017 / KONP (pricing)",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            # -----------------------------------------------------------------
            # L2: Invoice Verification
            # -----------------------------------------------------------------
            {
                "id": "PTP-IV",
                "name": "Invoice Verification",
                "description": "Three-way match and invoice posting.",
                "l3_transactions": [
                    {
                        "id": "PTP-IV-MIRO",
                        "name": "Enter Incoming Invoice",
                        "tcode": "MIRO",
                        "description": "Post vendor invoice with reference to PO and goods receipt.",
                        "l4_steps": [
                            {
                                "id": "PTP-IV-MIRO-01",
                                "name": "Invoice Header",
                                "description": "Enter invoice date, amount, and reference PO.",
                                "l5_fields": [
                                    {
                                        "field": "RBKP.LIFNR",
                                        "check_id": "AP001",
                                        "description": "Vendor",
                                        "mandatory": True,
                                        "config_source": "LFA1",
                                    },
                                    {
                                        "field": "RBKP.ZTERM",
                                        "check_id": "AP016",
                                        "description": "Payment Terms",
                                        "mandatory": True,
                                        "config_source": "T052",
                                    },
                                    {
                                        "field": "RBKP.ZLSCH",
                                        "check_id": "AP017",
                                        "description": "Payment Method",
                                        "mandatory": False,
                                        "config_source": "T042Z",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            # -----------------------------------------------------------------
            # L2: Payment Processing
            # -----------------------------------------------------------------
            {
                "id": "PTP-PAY",
                "name": "Payment Processing",
                "description": "Automatic and manual vendor payment execution.",
                "l3_transactions": [
                    {
                        "id": "PTP-PAY-F110",
                        "name": "Automatic Payment Run",
                        "tcode": "F110",
                        "description": "Execute the automatic payment program to pay open vendor invoices.",
                        "l4_steps": [
                            {
                                "id": "PTP-PAY-F110-01",
                                "name": "Payment Parameters",
                                "description": "Define run date, vendors, company codes, and payment methods.",
                                "l5_fields": [
                                    {
                                        "field": "LFB1.ZWELS",
                                        "check_id": "AP017",
                                        "description": "Payment Methods (vendor master)",
                                        "mandatory": True,
                                        "config_source": "T042Z",
                                    },
                                    {
                                        "field": "LFBK.BANKS",
                                        "check_id": "AP018",
                                        "description": "Bank Country Key (vendor master)",
                                        "mandatory": True,
                                        "config_source": "T012",
                                    },
                                    {
                                        "field": "LFB1.ZTERM",
                                        "check_id": "AP016",
                                        "description": "Payment Terms (due date calc)",
                                        "mandatory": True,
                                        "config_source": "T052",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    # =========================================================================
    # L1: Order to Cash (OTC)
    # =========================================================================
    {
        "id": "OTC",
        "name": "Order to Cash",
        "description": "End-to-end revenue cycle from customer onboarding through cash collection.",
        "modules": ["accounts_receivable", "sd_customer_master", "sd_sales_orders", "fi_gl"],
        "l2_processes": [
            # -----------------------------------------------------------------
            # L2: Customer Management
            # -----------------------------------------------------------------
            {
                "id": "OTC-CM",
                "name": "Customer Management",
                "description": "Customer master data creation, maintenance, and credit management.",
                "l3_transactions": [
                    {
                        "id": "OTC-CM-FD01",
                        "name": "Create Customer Master",
                        "tcode": "FD01",
                        "description": "Create a new customer master record with accounting and sales views.",
                        "l4_steps": [
                            {
                                "id": "OTC-CM-FD01-01",
                                "name": "Enter Account Group",
                                "description": "Select the customer account group controlling field status and number range.",
                                "l5_fields": [
                                    {
                                        "field": "KNA1.KTOKD",
                                        "check_id": "AR001",
                                        "description": "Account Group",
                                        "mandatory": True,
                                        "config_source": "T077D",
                                    },
                                ],
                            },
                            {
                                "id": "OTC-CM-FD01-02",
                                "name": "Enter General Data",
                                "description": "Populate name, address, and communication data.",
                                "l5_fields": [
                                    {
                                        "field": "KNA1.NAME1",
                                        "check_id": "AR001",
                                        "description": "Customer Name",
                                        "mandatory": True,
                                        "config_source": "T077D (field status)",
                                    },
                                    {
                                        "field": "KNA1.LAND1",
                                        "check_id": "AR001",
                                        "description": "Country Key",
                                        "mandatory": True,
                                        "config_source": "T005",
                                    },
                                    {
                                        "field": "KNA1.SORTL",
                                        "check_id": "AR001",
                                        "description": "Search Term",
                                        "mandatory": False,
                                        "config_source": "T077D (field status)",
                                    },
                                ],
                            },
                            {
                                "id": "OTC-CM-FD01-03",
                                "name": "Enter Company Code Data",
                                "description": "Set reconciliation account, payment terms, and dunning data.",
                                "l5_fields": [
                                    {
                                        "field": "KNB1.AKONT",
                                        "check_id": "AR001",
                                        "description": "Reconciliation Account",
                                        "mandatory": True,
                                        "config_source": "T077D (field status) / SKB1",
                                    },
                                    {
                                        "field": "KNB1.ZTERM",
                                        "check_id": "AR005",
                                        "description": "Payment Terms",
                                        "mandatory": True,
                                        "config_source": "T052",
                                    },
                                    {
                                        "field": "KNB1.MAHNA",
                                        "check_id": "AR010",
                                        "description": "Dunning Procedure",
                                        "mandatory": False,
                                        "config_source": "T040",
                                    },
                                ],
                            },
                            {
                                "id": "OTC-CM-FD01-04",
                                "name": "Enter Credit Management Data",
                                "description": "Set credit limit, credit control area, and risk category.",
                                "l5_fields": [
                                    {
                                        "field": "KNKK.KLIMK",
                                        "check_id": "AR005",
                                        "description": "Credit Limit",
                                        "mandatory": False,
                                        "config_source": "T014 (credit control area)",
                                    },
                                    {
                                        "field": "KNKK.CTLPC",
                                        "check_id": "AR005",
                                        "description": "Risk Category",
                                        "mandatory": False,
                                        "config_source": "T014 / OVA8",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            # -----------------------------------------------------------------
            # L2: Sales Order Processing
            # -----------------------------------------------------------------
            {
                "id": "OTC-SO",
                "name": "Sales Order Processing",
                "description": "Create and manage sales orders, pricing, and availability check.",
                "l3_transactions": [
                    {
                        "id": "OTC-SO-VA01",
                        "name": "Create Sales Order",
                        "tcode": "VA01",
                        "description": "Create a standard sales order with customer, material, and pricing.",
                        "l4_steps": [
                            {
                                "id": "OTC-SO-VA01-01",
                                "name": "Order Header",
                                "description": "Enter sold-to party, sales org, distribution channel, and division.",
                                "l5_fields": [
                                    {
                                        "field": "VBAK.KUNNR",
                                        "check_id": "AR001",
                                        "description": "Sold-to Party",
                                        "mandatory": True,
                                        "config_source": "KNA1 (customer master)",
                                    },
                                    {
                                        "field": "VBAK.VKORG",
                                        "check_id": "SO001",
                                        "description": "Sales Organisation",
                                        "mandatory": True,
                                        "config_source": "TVKO",
                                    },
                                    {
                                        "field": "VBAK.VTWEG",
                                        "check_id": "SO001",
                                        "description": "Distribution Channel",
                                        "mandatory": True,
                                        "config_source": "TVTW",
                                    },
                                    {
                                        "field": "VBAK.SPART",
                                        "check_id": "SO001",
                                        "description": "Division",
                                        "mandatory": True,
                                        "config_source": "TSPA",
                                    },
                                    {
                                        "field": "VBAK.AUART",
                                        "check_id": "SO001",
                                        "description": "Sales Order Type",
                                        "mandatory": True,
                                        "config_source": "TVAK",
                                    },
                                ],
                            },
                            {
                                "id": "OTC-SO-VA01-02",
                                "name": "Order Line Items",
                                "description": "Add materials, quantities, and delivery dates.",
                                "l5_fields": [
                                    {
                                        "field": "VBAP.MATNR",
                                        "check_id": "MM001",
                                        "description": "Material Number",
                                        "mandatory": True,
                                        "config_source": "MARA (material master)",
                                    },
                                    {
                                        "field": "VBAP.KWMENG",
                                        "check_id": "SO001",
                                        "description": "Order Quantity",
                                        "mandatory": True,
                                        "config_source": "N/A (transactional)",
                                    },
                                    {
                                        "field": "VBAP.WERKS",
                                        "check_id": "MM005",
                                        "description": "Delivering Plant",
                                        "mandatory": True,
                                        "config_source": "T001W",
                                    },
                                ],
                            },
                            {
                                "id": "OTC-SO-VA01-03",
                                "name": "Pricing",
                                "description": "Determine pricing via pricing procedure and condition records.",
                                "l5_fields": [
                                    {
                                        "field": "KONV.KSCHL",
                                        "check_id": "SD005",
                                        "description": "Condition Type",
                                        "mandatory": True,
                                        "config_source": "T685 / V/06",
                                    },
                                    {
                                        "field": "KONV.KBETR",
                                        "check_id": "SD005",
                                        "description": "Condition Rate",
                                        "mandatory": True,
                                        "config_source": "KONP (condition records)",
                                    },
                                ],
                            },
                            {
                                "id": "OTC-SO-VA01-04",
                                "name": "Shipping Data",
                                "description": "Determine shipping point, route, and delivery priority.",
                                "l5_fields": [
                                    {
                                        "field": "VBAP.VSTEL",
                                        "check_id": "SO005",
                                        "description": "Shipping Point",
                                        "mandatory": True,
                                        "config_source": "TVST / 0VS1",
                                    },
                                    {
                                        "field": "VBAP.ROUTE",
                                        "check_id": "SO005",
                                        "description": "Route",
                                        "mandatory": False,
                                        "config_source": "TVRO",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            # -----------------------------------------------------------------
            # L2: Billing
            # -----------------------------------------------------------------
            {
                "id": "OTC-BIL",
                "name": "Billing",
                "description": "Invoice creation and revenue recognition.",
                "l3_transactions": [
                    {
                        "id": "OTC-BIL-VF01",
                        "name": "Create Billing Document",
                        "tcode": "VF01",
                        "description": "Create invoice from delivery or sales order.",
                        "l4_steps": [
                            {
                                "id": "OTC-BIL-VF01-01",
                                "name": "Billing Header",
                                "description": "Determine billing type, payer, and accounting data.",
                                "l5_fields": [
                                    {
                                        "field": "VBRK.KUNAG",
                                        "check_id": "AR001",
                                        "description": "Payer",
                                        "mandatory": True,
                                        "config_source": "KNA1 (customer master)",
                                    },
                                    {
                                        "field": "VBRK.FKART",
                                        "check_id": "SO001",
                                        "description": "Billing Type",
                                        "mandatory": True,
                                        "config_source": "TVFK",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            # -----------------------------------------------------------------
            # L2: Collections & Dunning
            # -----------------------------------------------------------------
            {
                "id": "OTC-DUN",
                "name": "Collections & Dunning",
                "description": "Customer payment follow-up and dunning execution.",
                "l3_transactions": [
                    {
                        "id": "OTC-DUN-F150",
                        "name": "Dunning Run",
                        "tcode": "F150",
                        "description": "Execute the automatic dunning program for overdue receivables.",
                        "l4_steps": [
                            {
                                "id": "OTC-DUN-F150-01",
                                "name": "Dunning Parameters",
                                "description": "Define dunning date, company codes, and customer selection.",
                                "l5_fields": [
                                    {
                                        "field": "KNB1.MAHNA",
                                        "check_id": "AR010",
                                        "description": "Dunning Procedure",
                                        "mandatory": True,
                                        "config_source": "T040",
                                    },
                                    {
                                        "field": "KNB1.BUSAB",
                                        "check_id": "AR010",
                                        "description": "Dunning Clerk",
                                        "mandatory": False,
                                        "config_source": "N/A (master data)",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
]


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def get_process_by_id(process_id: str) -> L1Process | None:
    """Return the L1 process definition matching the given ID, or None."""
    for proc in PROCESS_DEFINITIONS:
        if proc["id"] == process_id:
            return proc
    return None


def get_all_l5_fields(process_id: str) -> list[L5Field]:
    """Flatten all L5 fields from a given L1 process into a single list."""
    proc = get_process_by_id(process_id)
    if proc is None:
        return []
    fields: list[L5Field] = []
    for l2 in proc.get("l2_processes", []):
        for l3 in l2.get("l3_transactions", []):
            for l4 in l3.get("l4_steps", []):
                fields.extend(l4.get("l5_fields", []))
    return fields


def get_check_ids_for_process(process_id: str) -> set[str]:
    """Return the set of all check_ids referenced by a given L1 process."""
    return {f["check_id"] for f in get_all_l5_fields(process_id) if f.get("check_id")}


def get_l3_transactions(process_id: str) -> list[L3Transaction]:
    """Return a flat list of all L3 transactions in a given L1 process."""
    proc = get_process_by_id(process_id)
    if proc is None:
        return []
    txns: list[L3Transaction] = []
    for l2 in proc.get("l2_processes", []):
        txns.extend(l2.get("l3_transactions", []))
    return txns


def get_all_tcodes() -> set[str]:
    """Every standard SAP transaction code modelled by the process definitions.

    This is the "known" set to compare observed transactions against (see
    :func:`sap.custom_namespace.partition_transactions`): an observed t-code not
    in here and in the customer namespace (``Z``/``Y``) is a custom process
    Meridian didn't ship a signature for, and is surfaced rather than dropped.
    """
    tcodes: set[str] = set()
    for proc in PROCESS_DEFINITIONS:
        for l2 in proc.get("l2_processes", []):
            for l3 in l2.get("l3_transactions", []):
                tcode = l3.get("tcode")
                if tcode:
                    tcodes.add(str(tcode).strip().upper())
    return tcodes
