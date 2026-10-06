"""Process templates for every process area beyond the shipped PTP/OTC dicts.

A small tuple DSL; ``build_templates()`` expands it into the dict form of ``sap.process_definitions._HIERARCHY``.
Field descriptions, check ids, ``mandatory`` and rule modules are resolved from the DDIC and the rule YAMLs, so a
field only appears when the ECC dictionary knows it. The template is the fallback model; config derivation
(``api.services.config_intelligence.process_flow_derivation``) reads the ``PROBES`` registry built here.

Probes read header/config tables only (customizing, never documents or master data).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional


@dataclass(frozen=True)
class Probe:
    """One config table that proves a node is set up.

    ``keys`` become the evidence key fields; ``code`` (default keys[0]) is the value: a document / order /
    movement type. ``where`` keeps rows whose field is in the listed values. ``alt`` tables are tried when
    ``table`` was not extracted. ``client_specific``: Z/Y codes become extra activities of the L4.
    """
    table: str
    keys: tuple[str, ...]
    code: Optional[str] = None
    where: tuple[tuple[str, tuple[str, ...]], ...] = ()
    alt: tuple[str, ...] = ()
    client_specific: bool = False


def P(table: str, keys: str, code: Optional[str] = None, where: Optional[dict[str, str]] = None,
      alt: str = "", cs: bool = False) -> Probe:
    return Probe(table, tuple(keys.split()), code, tuple((k, tuple(v.split())) for k, v in (where or {}).items()),
                 tuple(alt.split()), cs)


# activity: (name, tcode or None for the L4 tcode, "TABLE.FIELD ...", probe)
def A(name: str, fields: str = "", tcode: Optional[str] = None, probe: Optional[Probe] = None) -> tuple:
    return (name, tcode, fields.split(), probe)


# L4: (name, tcode, activities, probe, variant probes, config dependency)
def L(name: str, tcode: str, acts: list[tuple], probe: Optional[Probe] = None, variants: tuple[Probe, ...] = (),
      dep: Optional[str] = None) -> tuple:
    return (name, tcode, acts, probe, variants, dep)


# ---------------------------------------------------------------------------
# Areas: (L1 id, name, description, rule modules, [(L2 id, name, [L4 ...])])
# ---------------------------------------------------------------------------
_AREAS: list[tuple] = [
    ("R2R", "Record to Report", "General ledger, banking and tax, assets and cost accounting through period close.",
     ["fi_gl", "banking_tax", "asset_accounting", "controlling"], [
        ("R2R-GL", "General Ledger", [
            L("Maintain G/L Account", "FS00", [
                A("Chart of Accounts Data", "SKA1.SAKNR SKA1.KTOPL SKA1.KTOKS SKA1.XBILK SKA1.GVTYP"),
                A("Company Code Data", "SKB1.BUKRS SKB1.WAERS SKB1.XOPVW SKB1.XKRES SKB1.ZUAWA SKB1.FSTAG"),
                A("Account Description", "SKAT.TXT20 SKAT.TXT50")]),
            L("Post G/L Document", "FB50", [
                A("Document Header", "BKPF.BLART BKPF.BUDAT BKPF.BLDAT BKPF.WAERS BKPF.XBLNR", probe=P("T003", "BLART", cs=True)),
                A("Line Items", "BSEG.BSCHL BSEG.HKONT BSEG.SHKZG BSEG.WRBTR BSEG.MWSKZ", probe=P("TBSL", "BSCHL"))],
              probe=P("T003", "BLART", cs=True), variants=(P("TBSL", "BSCHL"),)),
        ]),
        ("R2R-BNK", "Banking and Tax", [
            L("Maintain House Bank", "FI12", [
                A("House Bank", "T012.BANKL T012.BANKS T012K.HBKID"),
                A("Bank Accounts", "T012K.HKONT T012K.WAERS T012K.BANKN")]),
            L("Payment Methods per Country", "FBZP", [
                A("Payment Methods", "T042Z.XBKKT T042Z.XEZER LFB1.ZWELS KNB1.ZWELS"),
                A("Paying Company Codes", "LFB1.HBKID KNB1.HBKID")],
              probe=P("T042Z", "LAND1 ZLSCH", code="ZLSCH", cs=True), variants=(P("T042", "BUKRS"),)),
            L("Maintain Tax Codes", "FTXP", [
                A("Tax Code", "T007A.ZMWSK T007A.EGRKZ"),
                A("Tax Registration", "LFA1.STCEG KNA1.STCEG")]),
        ]),
        ("R2R-AA", "Asset Accounting", [
            L("Create Asset Master", "AS01", [
                A("General Data", "ANLA.ANLN1 ANLA.ANLKL ANLA.TXT50 ANLA.AKTIV ANLA.INVNR"),
                A("Time-Dependent Data", "ANLZ.KOSTL ANLZ.STORT ANLZ.WERKS"),
                A("Depreciation Areas", "ANLB.AFASL ANLB.NDJAR ANLB.AFABE")]),
            L("Post Asset Transaction", "ABZON", [
                A("Transaction Type", "BSEG.ANBWA BSEG.ANLN1", probe=P("TABW", "BWASL", cs=True)),
                A("Acquisition Value", "ANLC.KANSW")],
              probe=P("TABW", "BWASL", cs=True)),
            L("Depreciation Run", "AFAB", [
                A("Depreciation Key", "ANLB.AFASL ANLB.AFABG"),
                A("Posting", "ANLC.XAFAR")]),
        ]),
        ("R2R-CO", "Cost Accounting", [
            L("Create Cost Center", "KS01", [
                A("Basic Data", "CSKS.KOKRS CSKS.KOSTL CSKS.DATAB CSKS.KOSAR CSKS.VERAK"),
                A("Control Data", "CSKS.BUKRS CSKS.WAERS CSKS.PRCTR CSKS.KHINR")]),
            L("Create Cost Element", "KA01", [
                A("Cost Element Data", "CSKB.KOKRS CSKB.KSTAR CSKB.DATAB CSKB.KATYP")]),
            L("Create Profit Center", "KE51", [
                A("Profit Center Data", "CEPC.PRCTR CEPC.KOKRS CEPC.DATAB CEPC.VERAK CEPC.KHINR")]),
            L("Create Internal Order", "KO01", [
                A("Order Master", "AUFK.AUART AUFK.OBJNR AUFK.KOSTL", probe=P("T003O", "AUART", where={"AUTYP": "01"}, cs=True))],
              probe=P("T003O", "AUART", where={"AUTYP": "01"}, cs=True)),
        ]),
    ]),
    ("PP", "Plan to Produce", "Bills of material, routings, work centers and production orders.",
     ["production_planning", "material_master"], [
        ("PP-BOM", "Bill of Material", [
            L("Create BOM", "CS01", [
                A("BOM Header", "STKO.STLNR STKO.STLAL STKO.STLST STKO.BMENG MAST.STLAN"),
                A("BOM Items", "STPO.IDNRK STPO.MENGE STPO.MEINS STPO.POSTP")]),
        ]),
        ("PP-RTG", "Routing and Work Center", [
            L("Create Work Center", "CR01", [
                A("Work Center Data", "CRHD.ARBPL CRHD.WERKS CRHD.VERWE CRHD.PLANV")]),
            L("Create Routing", "CA01", [
                A("Routing Header", "PLKO.PLNNR PLKO.WERKS PLKO.STATU PLKO.VERWE"),
                A("Operations", "PLPO.VORNR PLPO.STEUS PLPO.ARBID PLPO.VGW01")]),
        ]),
        ("PP-ORD", "Production Orders", [
            L("Run MRP", "MD01", [
                A("MRP Type and Controller", "MARC.DISPO MARC.MATNR")],
              probe=P("T438A", "DISMM")),
            L("Create Production Order", "CO01", [
                A("Order Type", "AUFK.AUART AUFK.AUTYP AUFK.OBJNR",
                  probe=P("T003O", "AUART", where={"AUTYP": "10"}, cs=True)),
                A("Order Dates", "AUFK.IDAT1 AUFK.STDAT AUFK.ERDAT")],
              probe=P("T003O", "AUART", where={"AUTYP": "10"}, cs=True),
              variants=(P("T399X", "WERKS AUART", code="AUART"),)),
        ]),
    ]),
    ("PM", "Plant Maintenance", "Technical objects, maintenance plans, notifications and maintenance orders.",
     ["plant_maintenance"], [
        ("PM-TO", "Technical Objects", [
            L("Create Equipment", "IE01", [
                A("General Data", "EQUI.EQUNR EQUI.EQTYP EQUI.EQART EQKT.EQKTX EQUI.HERST EQUI.SERGE"),
                A("Location Data", "ILOA.SWERK ILOA.KOSTL ILOA.BUKRS EQUZ.IWERK")]),
            L("Create Functional Location", "IL01", [
                A("Functional Location Data", "IFLOT.TPLNR IFLOT.FLTYP IFLOT.IWERK IFLOTX.PLTXT")]),
        ]),
        ("PM-PLN", "Maintenance Planning", [
            L("Create Maintenance Plan", "IP01", [
                A("Plan Header", "MPLA.WARPL MPLA.MPTYP MPLA.STADT"),
                A("Maintenance Item", "MPOS.WARPL MPOS.AUART MPOS.IWERK MPOS.PLNNR")]),
            L("Create Maintenance Notification", "IW21", [
                A("Notification Type", "QMEL.QMART QMEL.QMDAT", probe=P("TQ80", "QMART", where={"QMTYP": "01"}, cs=True)),
                A("Priority", "", probe=P("T356", "ARTPR PRIOK", code="PRIOK"))],
              probe=P("TQ80", "QMART", where={"QMTYP": "01"}, cs=True)),
            L("Create Maintenance Order", "IW31", [
                A("Order Type", "AUFK.AUART AUFK.AUTYP", probe=P("T003O", "AUART", where={"AUTYP": "30"}, cs=True)),
                A("Operations", "PLPO.VORNR PLPO.ARBID PLPO.STEUS")],
              probe=P("T003O", "AUART", where={"AUTYP": "30"}, cs=True),
              variants=(P("T356", "ARTPR PRIOK", code="PRIOK"),)),
        ]),
    ]),
    ("QM", "Quality Management", "Inspection characteristics, plans, lots and quality notifications.",
     ["quality_management"], [
        ("QM-MD", "Quality Master Data", [
            L("Create Master Inspection Characteristic", "QS21", [
                A("Characteristic", "QPMK.SOLLWERT QPMK.TOLERANZUN QPMK.MASSEINHSW QPMK.GUELTIGAB")]),
            L("Create Inspection Plan", "QP01", [
                A("Plan Header", "PLKO.PLNNR PLKO.WERKS PLKO.STATU"),
                A("Inspection Characteristics", "PLMK.VERWMERKM PLMK.TOLERANZUN PLMK.MASSEINHSW")]),
        ]),
        ("QM-IN", "Inspection and Notification", [
            L("Create Inspection Lot", "QA01", [
                A("Inspection Lot", "QALS.ART QALS.HERKUNFT QALS.MATNR", probe=P("TQ30", "ART", cs=True))],
              probe=P("TQ30", "ART", cs=True)),
            L("Create Quality Notification", "QM01", [
                A("Notification Type", "QMEL.QMART QMEL.QMDAT QMEL.MATNR", probe=P("TQ80", "QMART", where={"QMTYP": "02"}, cs=True)),
                A("Defects and Tasks", "QMFE.FECOD QMSM.MNCOD")],
              probe=P("TQ80", "QMART", where={"QMTYP": "02"}, cs=True)),
        ]),
    ]),
    ("PS", "Project System", "Project definitions, work breakdown structures and settlement.",
     ["project_system"], [
        ("PS-PRJ", "Projects", [
            L("Create Project Definition", "CJ01", [
                A("Project Definition", "PROJ.PSPID PROJ.POST1 PROJ.VBUKR PROJ.VKOKR PROJ.PRCTR")],
              probe=P("TCJ1", "PRART", cs=True)),
            L("Maintain WBS Element", "CJ02", [
                A("WBS Element", "PRPS.POSID PRPS.POST1 PRPS.PBUKR PRPS.PKOKR PRPS.PSPHI")]),
            L("Settlement Rule", "CJ02S", [
                A("Settlement Rule", "COBRB.OBJNR COBRB.PERBZ COBRB.PROZS")]),
        ]),
    ]),
    ("WH", "Warehouse Management", "Inbound, outbound and internal warehouse movements (WM and EWM).",
     ["wm_interface", "ewms_stock", "ewms_transfer_orders", "batch_management"], [
        ("WH-IN", "Inbound", [
            L("Transfer Order for Goods Receipt", "LT06", [
                A("Transfer Order Header", "LTAK.TANUM LTAK.LGNUM LTAK.BWLVS LTAK.BETYP"),
                A("Transfer Order Item", "LTAP.MATNR LTAP.VSOLM LTAP.NLTYP LTAP.NLPLA")],
              probe=P("T333", "LGNUM BWLVS", code="BWLVS", where={"TRART": "E"}, cs=True)),
            L("Maintain Inbound Delivery (EWM)", "/SCWM/PRDI", [
                A("Warehouse Stock", "/SCWM/AQUA.LGPLA /SCWM/AQUA.QUAN /SCWM/AQUA.UNIT")]),
        ]),
        ("WH-OUT", "Outbound", [
            L("Transfer Order for Delivery", "LT03", [
                A("Transfer Order Header", "LTAK.TANUM LTAK.LGNUM LTAK.BWLVS LTAK.KQUIT"),
                A("Transfer Order Item", "LTAP.MATNR LTAP.VSOLM LTAP.VLTYP LTAP.VLPLA")],
              probe=P("T333", "LGNUM BWLVS", code="BWLVS", where={"TRART": "A"}, cs=True)),
            L("Maintain Outbound Delivery Order (EWM)", "/SCWM/PRDO", [
                A("Warehouse Task", "/SCWM/ORDIM_O.VLPLA /SCWM/ORDIM_O.NLPLA /SCWM/ORDIM_O.VSOLM")]),
        ]),
        ("WH-INT", "Internal", [
            L("Transfer Order Between Bins", "LT01", [
                A("Storage Bin", "LAGP.LGNUM LAGP.LGTYP LAGP.LGPLA LAGP.LPTYP"),
                A("Quant", "LQUA.MATNR LQUA.GESME LQUA.MEINS LQUA.CHARG")],
              probe=P("T333", "LGNUM BWLVS", code="BWLVS", where={"TRART": "U"}, cs=True)),
            L("Warehouse Monitor (EWM)", "/SCWM/MON", [
                A("Stock Monitoring", "/SCWM/AQUA.QUAN /SCWM/LAGP.LGPLA /SCWM/HUHDR.GUID_HU")]),
        ]),
    ]),
    ("HTR", "Hire to Retire", "Organisation, personnel actions and master data (HCM, configuration only).",
     ["hcm", "employee_central"], [
        ("HTR-OM", "Organisation Management", [
            L("Maintain Organisational Plan", "PP01", [
                A("Object", "HRP1000.OBJID HRP1000.STEXT HRP1000.ISTAT"),
                A("Relationship", "HRP1001.SOBID HRP1001.BEGDA")]),
        ]),
        ("HTR-PA", "Personnel Administration", [
            L("Personnel Action", "PA40", [
                A("Action Type", "PA0000.MASSN PA0000.BEGDA", probe=P("T529A", "MASSN", cs=True)),
                A("Action Reason", "", probe=P("T530", "MASSN MASSG", code="MASSG")),
                A("Organisational Assignment", "PA0001.BUKRS PA0001.WERKS PA0001.PERSG PA0001.ORGEH PA0001.KOSTL")],
              probe=P("T529A", "MASSN", cs=True), variants=(P("T530", "MASSN MASSG", code="MASSG"),)),
            L("Maintain HR Master Data", "PA30", [
                A("Personal Data", "PA0002.NACHN PA0002.GBDAT PA0002.GESCH"),
                A("Payments", "PA0008.BET01 PA0009.BANKN PA0009.BANKL")]),
        ]),
    ]),
    ("MDG", "Master Data Governance", "Change request governance for central master data.",
     ["mdg_master_data"], [
        ("MDG-CR", "Change Requests", [
            L("Configure Master Data Governance", "MDGIMG", [
                A("Change Request", "USMD120C.USMD_CREQUEST USMD120C.USMD_CREQ_TYPE USMD120C.USMD_CREQ_STATUS"),
                A("Approval", "USMD120C.USMD_RELEASED_BY USMD120C.USMD_RELEASED_AT")]),
        ]),
    ]),
    ("SFX", "SuccessFactors", "Employee Central, recruiting and time (cloud; no SAP config tables).",
     ["employee_central", "recruiting_onboarding", "time_attendance"], [
        ("SFX-EC", "Employee Central", [
            L("Hire Employee", "Add New Employee", [
                A("Person", "PERINFO.FIRSTNAME PERINFO.LASTNAME PERINFO.DATE_OF_BIRTH"),
                A("Employment", "EMPEMPLOYMENT.USERID EMPEMPLOYMENT.START_DATE EMPEMPLOYMENT.COMPANY EMPEMPLOYMENT.JOB_CODE")]),
        ]),
        ("SFX-RCM", "Recruiting", [
            L("Manage Job Requisition", "Manage Job Requisitions", [
                A("Requisition", "JOBREQUISITION.TITLE JOBREQUISITION.HIRING_MANAGER JOBREQUISITION.OPEN_DATE"),
                A("Application", "JOBAPPLICATION.CANDIDATE_ID JOBAPPLICATION.JOB_REQ_ID")]),
        ]),
        ("SFX-TIM", "Time and Attendance", [
            L("Approve Timesheet", "My Timesheet", [
                A("Timesheet", "TIMESHEET.USERID TIMESHEET.DATE TIMESHEET.HOURS TIMESHEET.APPROVAL_STATUS")]),
        ]),
    ]),
    ("ARB", "Ariba", "Supplier, contract and procurement documents in Ariba.",
     ["ariba_supplier", "ariba_contracts", "ariba_procurement"], [
        ("ARB-SUP", "Supplier Management", [
            L("Register Supplier", "Supplier Management", [
                A("Supplier", "ARIBA_SUPPLIER.VENDOR_ID ARIBA_SUPPLIER.NAME ARIBA_SUPPLIER.COUNTRY")]),
        ]),
        ("ARB-CON", "Contracts", [
            L("Create Contract Workspace", "Contracts", [
                A("Contract", "ARIBA_CONTRACT.CONTRACT_ID ARIBA_CONTRACT.SUPPLIER ARIBA_CONTRACT.EXPIRATION_DATE")]),
        ]),
        ("ARB-PRC", "Procurement", [
            L("Create Purchase Order", "Procurement", [
                A("Order", "ARIBA_PO.ORDER_ID ARIBA_PO.SUPPLIER ARIBA_PO.COMPANY_CODE"),
                A("Invoice", "ARIBA_INVOICE.INVOICE_NUMBER ARIBA_INVOICE.PURCHASE_ORDER_ID")]),
        ]),
    ]),
    ("CNQ", "Concur", "Expense reports and users in Concur.",
     ["concur_expense", "concur_users"], [
        ("CNQ-EXP", "Expense Management", [
            L("Submit Expense Report", "Expense", [
                A("Report", "CONCUR_REPORT.REPORT_ID CONCUR_REPORT.OWNER_LOGIN_ID CONCUR_REPORT.TOTAL"),
                A("Entries", "CONCUR_ENTRY.ENTRY_ID CONCUR_ENTRY.EXPENSE_TYPE_CODE CONCUR_ENTRY.TRANSACTION_AMOUNT")]),
        ]),
        ("CNQ-USR", "User Administration", [
            L("Maintain Concur User", "User Administration", [
                A("User", "CONCUR_USER.LOGIN_ID CONCUR_USER.EMPLOYEE_ID CONCUR_USER.COST_CENTER")]),
        ]),
    ]),
]

# New L2s inside the shipped PTP / OTC L1s: (L1 id, L2 id, name, [L4 ...])
_EXTRA_L2: list[tuple] = [
    ("PTP", "PTP-PR", "Purchase Requisition", [
        L("Create Purchase Requisition", "ME51N", [
            A("Requisition Item", "EBAN.MENGE EBAN.MEINS EBAN.WERKS EBAN.MATKL EBAN.EKGRP")],
          probe=P("T161", "BSART", where={"BSTYP": "B"}, cs=True)),
    ]),
    ("PTP", "PTP-GR", "Goods Receipt", [
        L("Post Goods Receipt", "MIGO", [
            A("Goods Receipt Item", "EKPO.WEPOS EKPO.ELIKZ EKBE.MENGE EKBE.BUDAT")],
          probe=P("T156", "BWART", cs=True)),
    ]),
    ("PTP", "PTP-REL", "Purchase Order Release", [
        L("Release Purchase Order", "ME29N", [
            A("Release Strategy", "EKKO.FRGKE EKKO.FRGSX EKKO.FRGRL", probe=P("T16FS", "FRGGR FRGSX", code="FRGSX"))],
          probe=P("T16FS", "FRGGR FRGSX", code="FRGSX")),
    ]),
    ("OTC", "OTC-DEL", "Delivery", [
        L("Create Outbound Delivery", "VL01N", [
            A("Delivery Scheduling", "VBEP.WADAT VBEP.EDATU VBEP.LIFSP"),
            A("Delivery Block", "VBAK.LIFSK")],
          probe=P("TVLK", "LFART", cs=True)),
    ]),
]

# Probes for nodes that exist in the shipped dict model: id -> probe / variant probes.
_EXISTING_PROBES: dict[str, Probe] = {
    "OTC-SO-VA01": P("TVAK", "AUART", cs=True),
    "OTC-BIL-VF01": P("TVFK", "FKART", cs=True),
    "PTP-PO-ME21N": P("T161", "BSART", where={"BSTYP": "F"}, cs=True),
    "PTP-PAY-F110": P("T042", "BUKRS"),
    "OTC-DUN-F150": P("T047", "BUKRS"),
}
_EXISTING_VARIANTS: dict[str, tuple[Probe, ...]] = {
    "OTC-SO-VA01": (P("TVAP", "PSTYV"), P("T184", "AUART MTPOS VWPOS UEPST PSTYV", code="PSTYV"), P("TVEP", "ETTYP")),
    "PTP-PO-ME21N": (P("T163", "PSTYP", alt="T163Y"),),
    "PTP-IV-MIRO": (P("T052", "ZTERM ZTAGG", code="ZTERM"),),
}

# Reference-model nodes (L4 id -> L1 id) that BP replaces on S/4HANA.
S4_BP_L4 = {"PTP-VM-FK01": "BP", "OTC-CM-FD01": "BP"}

PROBES: dict[str, Probe] = dict(_EXISTING_PROBES)  # node id (L4 or L5) -> probe
VARIANT_PROBES: dict[str, tuple[Probe, ...]] = dict(_EXISTING_VARIANTS)  # L4 id -> variant probes


def _slug(tcode: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", tcode.upper()).strip("_")


@lru_cache(maxsize=1)
def _rule_index() -> dict[str, tuple[str, bool, tuple[str, ...]]]:
    """TABLE.FIELD -> (first rule id, any null_check rule, rule modules)."""
    from api.services.tenant_seed import raw_rules

    out: dict[str, list] = {}
    for _cat, _src, module, r in raw_rules():
        f = r.get("field")
        if not f:
            continue
        e = out.setdefault(f, [str(r["id"]), False, []])
        e[1] = e[1] or r.get("check_class") == "null_check"
        if module not in e[2]:
            e[2].append(module)
    return {k: (v[0], v[1], tuple(v[2])) for k, v in out.items()}


def rule_modules_of(fields: list[str]) -> list[str]:
    idx = _rule_index()
    return list(dict.fromkeys(m for f in fields for m in idx.get(f, ("", False, ()))[2]))


def _field(dictionary: Any, qualified: str) -> Optional[dict[str, Any]]:
    d = dictionary.resolve(qualified)
    if d is None:
        return None
    rid, mandatory, _mods = _rule_index().get(qualified, (None, False, ()))
    return {"field": qualified, "check_id": rid, "description": d.description or d.name, "mandatory": mandatory,
            "config_source": d.check_table}


def _l4(dictionary: Any, l2_id: str, order: int, spec: tuple) -> dict[str, Any]:
    name, tcode, acts, probe, variants, dep = spec
    l4_id = f"{l2_id}-{_slug(tcode)}"
    activities = []
    for i, (aname, atcode, fields, aprobe) in enumerate(acts, 1):
        fr = [f for f in (_field(dictionary, q) for q in fields) if f]
        aid = f"{l4_id}-{i:02d}"
        activities.append({"id": aid, "name": aname, "description": f"{aname} in {tcode}.", "order": i,
                           "tcode": atcode or tcode, "fields": fr})
        if aprobe:
            PROBES[aid] = aprobe
    if probe:
        PROBES[l4_id] = probe
    if variants:
        VARIANT_PROBES[l4_id] = variants
    return {"id": l4_id, "name": name, "description": f"{name} ({tcode}).", "order": order, "tcode": tcode,
            "config_dependency": dep or (probe.table if probe else None), "activities": activities}


def _l2(dictionary: Any, l2_id: str, name: str, order: int, l4s: list[tuple]) -> dict[str, Any]:
    return {"id": l2_id, "name": name, "description": name, "order": order,
            "l3": [{"id": f"{l2_id}-P1", "name": name, "description": name, "order": 1,
                    "l4": [_l4(dictionary, l2_id, i, s) for i, s in enumerate(l4s, 1)]}]}


def extend_hierarchy(hierarchy: list[dict[str, Any]]) -> None:
    """Add the template areas to the PTP/OTC hierarchy in place (ids of the shipped nodes stay)."""
    from sap.ddic import get_dictionary

    dictionary = get_dictionary("ecc6")
    for l1_id, l2_id, name, l4s in _EXTRA_L2:
        l1 = next(x for x in hierarchy if x["id"] == l1_id)
        l1["l2"].append(_l2(dictionary, l2_id, name, len(l1["l2"]) + 1, l4s))
    for order, (l1_id, name, desc, modules, l2s) in enumerate(_AREAS, len(hierarchy) + 1):
        hierarchy.append({"id": l1_id, "name": name, "description": desc, "order": order, "modules": modules,
                          "l2": [_l2(dictionary, i, n, k, l4s) for k, (i, n, l4s) in enumerate(l2s, 1)]})
