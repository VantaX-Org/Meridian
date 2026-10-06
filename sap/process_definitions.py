"""SAP L1-L5 process model (reference document).

Hierarchy
---------
L1  End-to-end process   (e.g. Procure to Pay)
L2  Process area         (e.g. Vendor Management)
L3  Process              (e.g. Vendor onboarding)
L4  Sub-process          (one BPMN diagram, usually one t-code, e.g. FK01)
L5  Activity             (one task in the diagram, e.g. Enter Account Group)

An activity carries ``fields``: the SAP ``TABLE.FIELD`` data-quality check points
it touches. Each field has a ``check_id`` (the Meridian check that validates it),
``mandatory`` and ``config_source`` (SPRO table governing the field).

Ids keep the earlier dash scheme: the old L2/L3-transaction/L4-step ids are now
the L2/L4/L5 ids, and each L2 has one L3 ``<L2>-P1``.

``PROCESS_DEFINITIONS`` is the plain-dict form of the reference model (the shape
``api.models.process_model.ProcessModelDocument`` validates); ``reference_document()``
returns the typed form.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from api.models.process_model import FieldRef, L4, L5, ProcessModelDocument
from sap.process_templates import extend_hierarchy, rule_modules_of

L1Process = dict[str, Any]

_HIERARCHY: list[L1Process] = [{'id': 'PTP',
  'name': 'Procure to Pay',
  'description': 'End-to-end procurement cycle from vendor onboarding through invoice payment.',
  'order': 1,
  'modules': ['accounts_payable', 'mm_purchasing', 'material_master', 'fi_gl'],
  'l2': [{'id': 'PTP-VM',
          'name': 'Vendor Management',
          'description': 'Vendor master data creation, maintenance, and governance.',
          'order': 1,
          'l3': [{'id': 'PTP-VM-P1',
                  'name': 'Vendor onboarding',
                  'description': 'Vendor master data creation, maintenance, and governance.',
                  'order': 1,
                  'l4': [{'id': 'PTP-VM-FK01',
                          'name': 'Create Vendor Master',
                          'description': 'Create a new vendor master record with all required views.',
                          'order': 1,
                          'tcode': 'FK01',
                          'config_dependency': None,
                          'activities': [{'id': 'PTP-VM-FK01-01',
                                          'name': 'Enter Account Group',
                                          'description': 'Select the vendor account group that controls '
                                                         'field status and number range.',
                                          'order': 1,
                                          'tcode': 'FK01',
                                          'fields': [{'field': 'LFA1.KTOKK',
                                                      'check_id': 'AP010',
                                                      'description': 'Account Group',
                                                      'mandatory': True,
                                                      'config_source': 'T077Y'}]},
                                         {'id': 'PTP-VM-FK01-02',
                                          'name': 'Enter General Data',
                                          'description': 'Populate name, address, and communication data on '
                                                         'the general data screen.',
                                          'order': 2,
                                          'tcode': 'FK01',
                                          'fields': [{'field': 'LFA1.NAME1',
                                                      'check_id': 'AP001',
                                                      'description': 'Vendor Name',
                                                      'mandatory': True,
                                                      'config_source': 'T077Y (field status)'},
                                                     {'field': 'LFA1.LAND1',
                                                      'check_id': 'AP003',
                                                      'description': 'Country Key',
                                                      'mandatory': True,
                                                      'config_source': 'T005'},
                                                     {'field': 'LFA1.STRAS',
                                                      'check_id': 'AP005',
                                                      'description': 'Street Address',
                                                      'mandatory': True,
                                                      'config_source': 'T077Y (field status)'},
                                                     {'field': 'LFA1.ORT01',
                                                      'check_id': 'AP007',
                                                      'description': 'City',
                                                      'mandatory': True,
                                                      'config_source': 'T077Y (field status)'},
                                                     {'field': 'LFA1.PSTLZ',
                                                      'check_id': 'AP009',
                                                      'description': 'Postal Code',
                                                      'mandatory': False,
                                                      'config_source': 'T005 (country-dependent)'}]},
                                         {'id': 'PTP-VM-FK01-03',
                                          'name': 'Enter Company Code Data',
                                          'description': 'Set reconciliation account, payment terms, and '
                                                         'payment methods at company code level.',
                                          'order': 3,
                                          'tcode': 'FK01',
                                          'fields': [{'field': 'LFB1.AKONT',
                                                      'check_id': 'AP014',
                                                      'description': 'Reconciliation Account',
                                                      'mandatory': True,
                                                      'config_source': 'T077Y (field status) / SKB1'},
                                                     {'field': 'LFB1.ZTERM',
                                                      'check_id': 'AP016',
                                                      'description': 'Payment Terms',
                                                      'mandatory': True,
                                                      'config_source': 'T052'},
                                                     {'field': 'LFB1.ZWELS',
                                                      'check_id': 'AP017',
                                                      'description': 'Payment Methods',
                                                      'mandatory': True,
                                                      'config_source': 'T042Z'}]},
                                         {'id': 'PTP-VM-FK01-04',
                                          'name': 'Enter Bank Details',
                                          'description': 'Maintain vendor bank account details for automatic '
                                                         'payment.',
                                          'order': 4,
                                          'tcode': 'FK01',
                                          'fields': [{'field': 'LFBK.BANKS',
                                                      'check_id': 'AP018',
                                                      'description': 'Bank Country Key',
                                                      'mandatory': True,
                                                      'config_source': 'T012'},
                                                     {'field': 'LFBK.BANKL',
                                                      'check_id': 'AP019',
                                                      'description': 'Bank Key',
                                                      'mandatory': True,
                                                      'config_source': 'BNKA'},
                                                     {'field': 'LFBK.BANKN',
                                                      'check_id': 'AP020',
                                                      'description': 'Bank Account Number',
                                                      'mandatory': True,
                                                      'config_source': 'BNKA'}]}]}]}]},
         {'id': 'PTP-PO',
          'name': 'Purchase Order Processing',
          'description': 'Create, approve, and manage purchase orders.',
          'order': 2,
          'l3': [{'id': 'PTP-PO-P1',
                  'name': 'Purchase order processing',
                  'description': 'Create, approve, and manage purchase orders.',
                  'order': 1,
                  'l4': [{'id': 'PTP-PO-ME21N',
                          'name': 'Create Standard PO',
                          'description': 'Create a standard purchase order referencing vendor, material, and '
                                         'pricing.',
                          'order': 1,
                          'tcode': 'ME21N',
                          'config_dependency': None,
                          'activities': [{'id': 'PTP-PO-ME21N-01',
                                          'name': 'PO Header',
                                          'description': 'Set vendor, purchasing org, company code, and '
                                                         'order type.',
                                          'order': 1,
                                          'tcode': 'ME21N',
                                          'fields': [{'field': 'EKKO.LIFNR',
                                                      'check_id': 'AP001',
                                                      'description': 'Vendor Number',
                                                      'mandatory': True,
                                                      'config_source': 'LFA1 (vendor master)'},
                                                     {'field': 'EKKO.EKORG',
                                                      'check_id': 'PUR003',
                                                      'description': 'Purchasing Organisation',
                                                      'mandatory': True,
                                                      'config_source': 'T024E'},
                                                     {'field': 'EKKO.BSART',
                                                      'check_id': 'PUR004',
                                                      'description': 'PO Document Type',
                                                      'mandatory': True,
                                                      'config_source': 'T161'}]},
                                         {'id': 'PTP-PO-ME21N-02',
                                          'name': 'PO Line Items',
                                          'description': 'Add materials, quantities, prices, and delivery '
                                                         'dates.',
                                          'order': 2,
                                          'tcode': 'ME21N',
                                          'fields': [{'field': 'EKPO.MATNR',
                                                      'check_id': 'MM001',
                                                      'description': 'Material Number',
                                                      'mandatory': True,
                                                      'config_source': 'MARA (material master)'},
                                                     {'field': 'EKPO.WERKS',
                                                      'check_id': 'MM005',
                                                      'description': 'Plant',
                                                      'mandatory': True,
                                                      'config_source': 'T001W'},
                                                     {'field': 'EKPO.MENGE',
                                                      'check_id': 'PUR003',
                                                      'description': 'Order Quantity',
                                                      'mandatory': True,
                                                      'config_source': 'N/A (transactional)'},
                                                     {'field': 'EKPO.NETPR',
                                                      'check_id': 'PUR003',
                                                      'description': 'Net Price',
                                                      'mandatory': True,
                                                      'config_source': 'A017 / KONP (pricing)'}]}]}]}]},
         {'id': 'PTP-IV',
          'name': 'Invoice Verification',
          'description': 'Three-way match and invoice posting.',
          'order': 3,
          'l3': [{'id': 'PTP-IV-P1',
                  'name': 'Invoice verification',
                  'description': 'Three-way match and invoice posting.',
                  'order': 1,
                  'l4': [{'id': 'PTP-IV-MIRO',
                          'name': 'Enter Incoming Invoice',
                          'description': 'Post vendor invoice with reference to PO and goods receipt.',
                          'order': 1,
                          'tcode': 'MIRO',
                          'config_dependency': None,
                          'activities': [{'id': 'PTP-IV-MIRO-01',
                                          'name': 'Invoice Header',
                                          'description': 'Enter invoice date, amount, and reference PO.',
                                          'order': 1,
                                          'tcode': 'MIRO',
                                          'fields': [{'field': 'RBKP.LIFNR',
                                                      'check_id': 'AP001',
                                                      'description': 'Vendor',
                                                      'mandatory': True,
                                                      'config_source': 'LFA1'},
                                                     {'field': 'RBKP.ZTERM',
                                                      'check_id': 'AP016',
                                                      'description': 'Payment Terms',
                                                      'mandatory': True,
                                                      'config_source': 'T052'},
                                                     {'field': 'RBKP.ZLSCH',
                                                      'check_id': 'AP017',
                                                      'description': 'Payment Method',
                                                      'mandatory': False,
                                                      'config_source': 'T042Z'}]}]}]}]},
         {'id': 'PTP-PAY',
          'name': 'Payment Processing',
          'description': 'Automatic and manual vendor payment execution.',
          'order': 4,
          'l3': [{'id': 'PTP-PAY-P1',
                  'name': 'Payment run',
                  'description': 'Automatic and manual vendor payment execution.',
                  'order': 1,
                  'l4': [{'id': 'PTP-PAY-F110',
                          'name': 'Automatic Payment Run',
                          'description': 'Execute the automatic payment program to pay open vendor invoices.',
                          'order': 1,
                          'tcode': 'F110',
                          'config_dependency': None,
                          'activities': [{'id': 'PTP-PAY-F110-01',
                                          'name': 'Payment Parameters',
                                          'description': 'Define run date, vendors, company codes, and '
                                                         'payment methods.',
                                          'order': 1,
                                          'tcode': 'F110',
                                          'fields': [{'field': 'LFB1.ZWELS',
                                                      'check_id': 'AP017',
                                                      'description': 'Payment Methods (vendor master)',
                                                      'mandatory': True,
                                                      'config_source': 'T042Z'},
                                                     {'field': 'LFBK.BANKS',
                                                      'check_id': 'AP018',
                                                      'description': 'Bank Country Key (vendor master)',
                                                      'mandatory': True,
                                                      'config_source': 'T012'},
                                                     {'field': 'LFB1.ZTERM',
                                                      'check_id': 'AP016',
                                                      'description': 'Payment Terms (due date calc)',
                                                      'mandatory': True,
                                                      'config_source': 'T052'}]}]}]}]}]},
 {'id': 'OTC',
  'name': 'Order to Cash',
  'description': 'End-to-end revenue cycle from customer onboarding through cash collection.',
  'order': 2,
  'modules': ['accounts_receivable', 'sd_customer_master', 'sd_sales_orders', 'fi_gl'],
  'l2': [{'id': 'OTC-CM',
          'name': 'Customer Management',
          'description': 'Customer master data creation, maintenance, and credit management.',
          'order': 1,
          'l3': [{'id': 'OTC-CM-P1',
                  'name': 'Customer onboarding',
                  'description': 'Customer master data creation, maintenance, and credit management.',
                  'order': 1,
                  'l4': [{'id': 'OTC-CM-FD01',
                          'name': 'Create Customer Master',
                          'description': 'Create a new customer master record with accounting and sales '
                                         'views.',
                          'order': 1,
                          'tcode': 'FD01',
                          'config_dependency': None,
                          'activities': [{'id': 'OTC-CM-FD01-01',
                                          'name': 'Enter Account Group',
                                          'description': 'Select the customer account group controlling '
                                                         'field status and number range.',
                                          'order': 1,
                                          'tcode': 'FD01',
                                          'fields': [{'field': 'KNA1.KTOKD',
                                                      'check_id': 'AR001',
                                                      'description': 'Account Group',
                                                      'mandatory': True,
                                                      'config_source': 'T077D'}]},
                                         {'id': 'OTC-CM-FD01-02',
                                          'name': 'Enter General Data',
                                          'description': 'Populate name, address, and communication data.',
                                          'order': 2,
                                          'tcode': 'FD01',
                                          'fields': [{'field': 'KNA1.NAME1',
                                                      'check_id': 'AR001',
                                                      'description': 'Customer Name',
                                                      'mandatory': True,
                                                      'config_source': 'T077D (field status)'},
                                                     {'field': 'KNA1.LAND1',
                                                      'check_id': 'AR001',
                                                      'description': 'Country Key',
                                                      'mandatory': True,
                                                      'config_source': 'T005'},
                                                     {'field': 'KNA1.SORTL',
                                                      'check_id': 'AR001',
                                                      'description': 'Search Term',
                                                      'mandatory': False,
                                                      'config_source': 'T077D (field status)'}]},
                                         {'id': 'OTC-CM-FD01-03',
                                          'name': 'Enter Company Code Data',
                                          'description': 'Set reconciliation account, payment terms, and '
                                                         'dunning data.',
                                          'order': 3,
                                          'tcode': 'FD01',
                                          'fields': [{'field': 'KNB1.AKONT',
                                                      'check_id': 'AR001',
                                                      'description': 'Reconciliation Account',
                                                      'mandatory': True,
                                                      'config_source': 'T077D (field status) / SKB1'},
                                                     {'field': 'KNB1.ZTERM',
                                                      'check_id': 'AR005',
                                                      'description': 'Payment Terms',
                                                      'mandatory': True,
                                                      'config_source': 'T052'}]},
                                         {'id': 'OTC-CM-FD01-04',
                                          'name': 'Enter Credit Management Data',
                                          'description': 'Set credit limit, credit control area, and risk '
                                                         'category.',
                                          'order': 4,
                                          'tcode': 'FD01',
                                          'fields': [{'field': 'KNKK.KLIMK',
                                                      'check_id': 'AR005',
                                                      'description': 'Credit Limit',
                                                      'mandatory': False,
                                                      'config_source': 'T014 (credit control area)'},
                                                     {'field': 'KNKK.CTLPC',
                                                      'check_id': 'AR005',
                                                      'description': 'Risk Category',
                                                      'mandatory': False,
                                                      'config_source': 'T014 / OVA8'}]}]}]}]},
         {'id': 'OTC-SO',
          'name': 'Sales Order Processing',
          'description': 'Create and manage sales orders, pricing, and availability check.',
          'order': 2,
          'l3': [{'id': 'OTC-SO-P1',
                  'name': 'Sales order processing',
                  'description': 'Create and manage sales orders, pricing, and availability check.',
                  'order': 1,
                  'l4': [{'id': 'OTC-SO-VA01',
                          'name': 'Create Sales Order',
                          'description': 'Create a standard sales order with customer, material, and '
                                         'pricing.',
                          'order': 1,
                          'tcode': 'VA01',
                          'config_dependency': None,
                          'activities': [{'id': 'OTC-SO-VA01-01',
                                          'name': 'Order Header',
                                          'description': 'Enter sold-to party, sales org, distribution '
                                                         'channel, and division.',
                                          'order': 1,
                                          'tcode': 'VA01',
                                          'fields': [{'field': 'VBAK.KUNNR',
                                                      'check_id': 'AR001',
                                                      'description': 'Sold-to Party',
                                                      'mandatory': True,
                                                      'config_source': 'KNA1 (customer master)'},
                                                     {'field': 'VBAK.VKORG',
                                                      'check_id': 'SO001',
                                                      'description': 'Sales Organisation',
                                                      'mandatory': True,
                                                      'config_source': 'TVKO'},
                                                     {'field': 'VBAK.VTWEG',
                                                      'check_id': 'SO001',
                                                      'description': 'Distribution Channel',
                                                      'mandatory': True,
                                                      'config_source': 'TVTW'},
                                                     {'field': 'VBAK.SPART',
                                                      'check_id': 'SO001',
                                                      'description': 'Division',
                                                      'mandatory': True,
                                                      'config_source': 'TSPA'},
                                                     {'field': 'VBAK.AUART',
                                                      'check_id': 'SO001',
                                                      'description': 'Sales Order Type',
                                                      'mandatory': True,
                                                      'config_source': 'TVAK'}]},
                                         {'id': 'OTC-SO-VA01-02',
                                          'name': 'Order Line Items',
                                          'description': 'Add materials, quantities, and delivery dates.',
                                          'order': 2,
                                          'tcode': 'VA01',
                                          'fields': [{'field': 'VBAP.MATNR',
                                                      'check_id': 'MM001',
                                                      'description': 'Material Number',
                                                      'mandatory': True,
                                                      'config_source': 'MARA (material master)'},
                                                     {'field': 'VBAP.KWMENG',
                                                      'check_id': 'SO001',
                                                      'description': 'Order Quantity',
                                                      'mandatory': True,
                                                      'config_source': 'N/A (transactional)'},
                                                     {'field': 'VBAP.WERKS',
                                                      'check_id': 'MM005',
                                                      'description': 'Delivering Plant',
                                                      'mandatory': True,
                                                      'config_source': 'T001W'}]},
                                         {'id': 'OTC-SO-VA01-03',
                                          'name': 'Pricing',
                                          'description': 'Determine pricing via pricing procedure and '
                                                         'condition records.',
                                          'order': 3,
                                          'tcode': 'VA01',
                                          'fields': [{'field': 'KONV.KSCHL',
                                                      'check_id': 'SD005',
                                                      'description': 'Condition Type',
                                                      'mandatory': True,
                                                      'config_source': 'T685 / V/06'},
                                                     {'field': 'KONV.KBETR',
                                                      'check_id': 'SD005',
                                                      'description': 'Condition Rate',
                                                      'mandatory': True,
                                                      'config_source': 'KONP (condition records)'}]},
                                         {'id': 'OTC-SO-VA01-04',
                                          'name': 'Shipping Data',
                                          'description': 'Determine shipping point, route, and delivery '
                                                         'priority.',
                                          'order': 4,
                                          'tcode': 'VA01',
                                          'fields': [{'field': 'VBAP.VSTEL',
                                                      'check_id': 'SO005',
                                                      'description': 'Shipping Point',
                                                      'mandatory': True,
                                                      'config_source': 'TVST / 0VS1'},
                                                     {'field': 'VBAP.ROUTE',
                                                      'check_id': 'SO005',
                                                      'description': 'Route',
                                                      'mandatory': False,
                                                      'config_source': 'TVRO'}]}]}]}]},
         {'id': 'OTC-BIL',
          'name': 'Billing',
          'description': 'Invoice creation and revenue recognition.',
          'order': 3,
          'l3': [{'id': 'OTC-BIL-P1',
                  'name': 'Billing',
                  'description': 'Invoice creation and revenue recognition.',
                  'order': 1,
                  'l4': [{'id': 'OTC-BIL-VF01',
                          'name': 'Create Billing Document',
                          'description': 'Create invoice from delivery or sales order.',
                          'order': 1,
                          'tcode': 'VF01',
                          'config_dependency': None,
                          'activities': [{'id': 'OTC-BIL-VF01-01',
                                          'name': 'Billing Header',
                                          'description': 'Determine billing type, payer, and accounting '
                                                         'data.',
                                          'order': 1,
                                          'tcode': 'VF01',
                                          'fields': [{'field': 'VBRK.KUNAG',
                                                      'check_id': 'AR001',
                                                      'description': 'Payer',
                                                      'mandatory': True,
                                                      'config_source': 'KNA1 (customer master)'},
                                                     {'field': 'VBRK.FKART',
                                                      'check_id': 'SO001',
                                                      'description': 'Billing Type',
                                                      'mandatory': True,
                                                      'config_source': 'TVFK'}]}]}]}]},
         {'id': 'OTC-DUN',
          'name': 'Collections & Dunning',
          'description': 'Customer payment follow-up and dunning execution.',
          'order': 4,
          'l3': [{'id': 'OTC-DUN-P1',
                  'name': 'Dunning',
                  'description': 'Customer payment follow-up and dunning execution.',
                  'order': 1,
                  'l4': [{'id': 'OTC-DUN-F150',
                          'name': 'Dunning Run',
                          'description': 'Execute the automatic dunning program for overdue receivables.',
                          'order': 1,
                          'tcode': 'F150',
                          'config_dependency': None,
                          'activities': [{'id': 'OTC-DUN-F150-01',
                                          'name': 'Dunning Parameters',
                                          'description': 'Define dunning date, company codes, and customer '
                                                         'selection.',
                                          'order': 1,
                                          'tcode': 'F150',
                                          'fields': [
                                                     {'field': 'KNB1.BUSAB',
                                                      'check_id': 'AR010',
                                                      'description': 'Dunning Clerk',
                                                      'mandatory': False,
                                                      'config_source': 'N/A (master data)'}]}]}]}]}]}]


# Shipped gateways: L4 id -> (activity the gateway follows, question, label of the "no" flow, "no" ends in its own end event)
_GATEWAYS: dict[str, tuple[str, str, str, bool]] = {
    "OTC-SO-VA01": ("OTC-SO-VA01-03", "Credit check passed?", "Blocked", False),
    "PTP-IV-MIRO": ("PTP-IV-MIRO-01", "Within tolerance?", "Parked", True),
}


def _diagram(l4: dict[str, Any]) -> dict[str, Any]:
    """start -> tasks in order -> end; positions left to auto-layout."""
    base = l4["id"]
    nodes: list[dict[str, Any]] = [{"id": f"{base}-S", "type": "startEvent", "label": "Start"}]
    flows: list[dict[str, Any]] = []
    gw = _GATEWAYS.get(base)
    prev = f"{base}-S"
    pending_label: str | None = None
    gateway_id = ""

    def link(src: str, dst: str, label: str | None = None) -> None:
        flows.append({"id": f"{base}-F{len(flows) + 1}", "source": src, "target": dst, "label": label})

    for a in sorted(l4["activities"], key=lambda x: x["order"]):
        nid = f"{a['id']}-T"
        nodes.append({"id": nid, "type": "task", "activity_id": a["id"]})
        link(prev, nid, pending_label)
        pending_label = None
        prev = nid
        if gw and gw[0] == a["id"]:
            gid = f"{base}-G1"
            nodes.append({"id": gid, "type": "exclusiveGateway", "label": gw[1]})
            link(prev, gid)
            prev, pending_label = gid, "Yes"
            gateway_id = gid
    end = f"{base}-E"
    nodes.append({"id": end, "type": "endEvent", "label": "End"})
    link(prev, end, pending_label)
    if gw:
        target = end
        if gw[3]:
            target = f"{base}-E2"
            nodes.append({"id": target, "type": "endEvent", "label": gw[2]})
        link(gateway_id, target, gw[2])
        flows[-1]["condition"] = "no"
    return {"nodes": nodes, "flows": flows}


def _build() -> list[L1Process]:
    out = deepcopy(_HIERARCHY)
    extend_hierarchy(out)
    for l1 in out:
        for l2 in l1["l2"]:
            for l3 in l2["l3"]:
                for l4 in l3["l4"]:
                    l4["diagram"] = _diagram(l4)
                    for act in l4["activities"]:
                        derived = L5.model_validate(act).with_derived()
                        act["check_ids"], act["sap_tables"] = derived.check_ids, derived.sap_tables
                        act["rule_modules"] = rule_modules_of([f["field"] for f in act["fields"]])
    return out


PROCESS_DEFINITIONS: list[L1Process] = _build()


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def reference_document() -> ProcessModelDocument:
    """The shipped model as a validated document (a fresh copy on every call)."""
    return ProcessModelDocument.model_validate({"schema_version": 1, "l1": deepcopy(PROCESS_DEFINITIONS)})


def get_process_by_id(process_id: str) -> L1Process | None:
    """Return the L1 process definition matching the given ID, or None."""
    for proc in PROCESS_DEFINITIONS:
        if proc["id"] == process_id:
            return proc
    return None


def get_l4_subprocesses(process_id: str) -> list[dict[str, Any]]:
    """Flat list of all L4 sub-processes in a given L1 process."""
    proc = get_process_by_id(process_id)
    if proc is None:
        return []
    return [l4 for l2 in proc["l2"] for l3 in l2["l3"] for l4 in l3["l4"]]


def get_all_fields(process_id: str) -> list[FieldRef]:
    """Every FieldRef of every activity of a given L1 process."""
    return [FieldRef.model_validate(f) for l4 in get_l4_subprocesses(process_id)
            for act in l4["activities"] for f in act["fields"]]


def get_check_ids_for_process(process_id: str) -> set[str]:
    """Return the set of all check_ids referenced by a given L1 process."""
    return {f.check_id for f in get_all_fields(process_id) if f.check_id}


def get_all_tcodes() -> set[str]:
    """All standard SAP t-codes modelled across every shipped process (L4 and L5).

    Used as the "known" baseline for custom-namespace partitioning: any
    transaction not in this set (e.g. a Z-prefixed variant) is customer-defined.
    """
    codes: set[str] = set()
    for proc in PROCESS_DEFINITIONS:
        for l4 in get_l4_subprocesses(proc["id"]):
            codes.add(l4.get("tcode") or "")
            codes.update(a.get("tcode") or "" for a in l4["activities"])
    codes.discard("")
    return codes


def flow_config_tables() -> dict[str, tuple[set[str], set[str]]]:
    """Config tables the flow derivation reads: table -> (fields, modules whose extraction needs it)."""
    from sap.process_templates import DOC_FLOW_TABLES, PROBES, VARIANT_PROBES

    out: dict[str, tuple[set[str], set[str]]] = {}
    otc = next(x for x in PROCESS_DEFINITIONS if x["id"] == "OTC")
    for t, cols in DOC_FLOW_TABLES.items():
        f, m = out.setdefault(t, (set(), set()))
        f |= set(cols)
        m |= set(otc["modules"])
    for l1 in PROCESS_DEFINITIONS:
        for l4 in get_l4_subprocesses(l1["id"]):
            probes = [PROBES.get(l4["id"]), *VARIANT_PROBES.get(l4["id"], ()),
                      *(PROBES.get(a["id"]) for a in l4["activities"])]
            for p in filter(None, probes):
                fields = {*p.keys, *(k for k, _ in p.where)}
                for t in (p.table, *p.alt):
                    f, m = out.setdefault(t, (set(), set()))
                    f |= fields
                    m |= set(l1["modules"])
    return out
