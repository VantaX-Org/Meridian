"""Derive what to extract from an ABAP system from the rules themselves.

The plan for a set of modules is exactly the tables/fields their rules read,
plus each table's DDIC key, the join fields and filters from
sap/dictionaries/joins.yaml (so the engine can evaluate every rule at its
grain), and the configuration (check) tables whose live values replace the
rules' SAP-standard value lists. The plan therefore can never drift from the
rules — the hand-kept registry did (it had no LFBK, ADR6, ANLZ, EQUZ, ILOA …).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

import yaml

from checks.frames import _MOVED, Edge, TableFrames, _graph, tables_of
from sap.ddic import Dictionary

_WINDOWS = Path(__file__).resolve().parent / "dictionaries" / "extraction_windows.yaml"
_PE_WINDOWS = Path(__file__).resolve().parent / "dictionaries" / "process_event_windows.yaml"
_PE_JOINS = Path(__file__).resolve().parent / "dictionaries" / "process_event_joins.yaml"

_ECC = ["business_partner", "material_master", "fi_gl", "accounts_payable", "accounts_receivable",
        "asset_accounting", "hcm", "mm_purchasing", "plant_maintenance", "production_planning", "project_system",
        "quality_management", "sd_customer_master", "sd_sales_orders", "controlling",
        # migration objects a typical ECC -> S/4HANA programme carries that had no module:
        # deliveries/billing documents and CO internal orders (see docs/migration-object-coverage.md)
        "deliveries_billing", "internal_orders",
        # target-state master data for a move to S/4HANA Cloud: selectable on an ECC source system
        # too, because that is where the migration is analysed from (9 tables, all present in ECC).
        "s4hc_master_data"]
_LOGISTICS = ["batch_management", "ewms_stock", "ewms_transfer_orders", "wm_interface",
              "fleet_management", "transport_management", "mdg_master_data", "grc_compliance",
              "interface_health"]
_SF = ["employee_central", "compensation", "benefits", "payroll_integration", "performance_goals",
       "succession_planning", "recruiting_onboarding", "learning_management", "time_attendance"]

# Modules whose rules can be evaluated on data from each system type.
MODULES_BY_SYSTEM: dict[str, list[str]] = {
    "ecc": _ECC + _LOGISTICS + ["s4_readiness", "banking_tax"],  # S/4HANA conversion readiness of ECC data
    "s4hana_onprem": _ECC + _LOGISTICS + ["s4hc_master_data"],
    "ewm": ["batch_management", "ewms_stock", "ewms_transfer_orders", "wm_interface", "interface_health"],
    "s4hana_cloud": _ECC + ["s4hc_master_data"],
    "successfactors": _SF,
    "concur": ["concur_expense", "concur_travel", "concur_users"],
    "ariba": ["ariba_supplier", "ariba_contracts", "ariba_procurement", "ariba_spend"],
}
ABAP_SYSTEM_TYPES = ("ecc", "s4hana_onprem", "ewm")
_CONFIG_DELIVERY_CLASSES = {"C", "G", "E", "S"}
CONFIG_MAX_ROWS = 50_000


# Process-discovery reads (api/services/config_intelligence/variant_discovery.py):
# document type + date columns of the transactional headers and the config tables
# that list which types are configured. Keys come from the DDIC; windows from
# extraction_windows.yaml. Added for any plan that already reads sales/purchasing/FI.
DISCOVERY_MODULE = "process_discovery"
DISCOVERY_DATA = {"VBAK": {"AUART", "ERDAT"}, "VBRK": {"FKART", "FKDAT"}, "LIKP": {"LFART", "ERDAT"},
                  "MKPF": {"BLART", "VGART", "BUDAT"}, "RBKP": {"BLART", "BUDAT"},
                  "EKKO": {"BSART", "BEDAT"}, "EBAN": {"BSART", "BADAT"}}
DISCOVERY_CONFIG = {"TVAK": {"AUART"}, "T156": {"BWART"}, "TVLK": {"LFART"}, "TVFK": {"FKART"}}
_DISCOVERY_TRIGGER = {"sd_sales_orders", "mm_purchasing", "accounts_payable", "accounts_receivable", "fi_gl"}

# S/4 load dry-run analysis (extraction_registry.py: s4_load_sim module):
# Key transactional and config tables needed for transaction cost analysis
S4_LOAD_MODULE = "s4_load_sim"
S4_LOAD_DATA: dict[str, set[str]] = {
    "KNVK": {"PARNR", "KUNNR", "LIFNR", "NAME1"},
    "KNKK": {"KUNNR", "KKBER", "KLIMK", "CTLPC"},
    "MARD": {"MATNR", "WERKS", "LGORT", "DISKZ"},
    "KONV": {"KNUMV", "KPOSN", "STUNR", "ZAEHK", "KSCHL", "KWERT"},
    "NAST": {"KAPPL", "OBJKY", "KSCHL", "PARNR", "PARVW", "VSTAT"},
}
S4_LOAD_CONFIG: dict[str, set[str]] = {"T001L": {"WERKS", "LGORT", "DISKZ"}}
_S4_LOAD_TRIGGER = {"business_partner", "accounts_payable", "accounts_receivable",
                    "sd_customer_master", "material_master", "sd_sales_orders"}

# Transaction-proven cost (extraction_registry.py: proven_cost module): the
# transactional tables later tasks read to prove cost from live transactions,
# plus the fields those tasks add beyond what the rule-derived plan already reads.
PROVEN_COST_MODULE = "proven_cost"
PROVEN_COST_DATA: dict[str, set[str]] = {
    "EKKO": {"EBELN", "LIFNR", "BUKRS", "BEDAT", "WAERS"},
    "EKPO": {"EBELN", "EBELP", "MATNR", "WERKS", "MENGE", "MEINS", "BPRME",
             "NETPR", "PEINH", "NETWR", "INFNR"},
    "EKET": {"EBELN", "EBELP", "ETENR", "EINDT", "MENGE", "WEMNG"},
    "EKBE": {"BUDAT", "DMBTR", "MENGE", "BPMNG", "LFBNR"},
    "EINA": {"INFNR", "MATNR", "LIFNR", "MEINS"},
    "EINE": {"INFNR", "EKORG", "WERKS", "APLFZ", "NETPR", "PEINH"},
    "MARC": {"MATNR", "WERKS", "PLIFZ"},
    "MARM": {"MATNR", "MEINH", "UMREZ", "UMREN"},
    "RSEG": {"BELNR", "GJAHR", "BUZEI", "EBELN", "EBELP", "MENGE", "BSTME", "WRBTR"},
    "VBAK": {"NETWR", "WAERK", "LIFSK", "FAKSK", "KUNNR", "VKORG", "VTWEG", "SPART", "ERDAT"},
    "VBUK": {"VBELN", "CMGST", "LFSTK", "GBSTK"},
    "KNVV": {"KUNNR", "VKORG", "VTWEG", "SPART", "AUFSD", "LIFSD"},
    "BSAK": {"BUKRS", "LIFNR", "GJAHR", "BELNR", "BUZEI", "XBLNR", "WRBTR",
              "WAERS", "BLDAT", "AUGDT", "SHKZG", "BLART"},
}
_PROVEN_COST_TRIGGER = {"mm_purchasing", "material_master", "sd_sales_orders",
                        "sd_customer_master", "accounts_payable"}

# Process discovery (spec docs/superpowers/specs/2026-10-11-process-discovery-design.md §1.2):
# the event tables per L1. Planned only when the module itself is requested; windows and read edges
# come from process_event_windows.yaml / process_event_joins.yaml, never from the DQ files.
PROCESS_EVENT_MODULES: tuple[str, ...] = (
    "process_events_ptp", "process_events_otc", "process_events_r2r", "process_events_pp",
    "process_events_pm", "process_events_qm", "process_events_ps", "process_events_wh",
    "process_events_htr", "process_events_mdg",
)
PROCESS_EVENT_CLOUD_MODULES: tuple[str, ...] = ("process_events_sfx", "process_events_arb", "process_events_cnq")
PROCESS_EVENT_MODULES_BY_SYSTEM: dict[str, tuple[str, ...]] = {
    "ecc": PROCESS_EVENT_MODULES,
    "s4hana_onprem": PROCESS_EVENT_MODULES,
    "ewm": ("process_events_wh",),
    "successfactors": ("process_events_sfx",),
    "ariba": ("process_events_arb",),
    "concur": ("process_events_cnq",),
}
_USR02 = {"BNAME", "USTYP", "CLASS"}
_CDHDR = {"OBJECTCLAS", "OBJECTID", "CHANGENR", "USERNAME", "UDATE", "UTIME", "TCODE", "CHANGE_IND"}
_CDPOS = {"OBJECTCLAS", "OBJECTID", "CHANGENR", "TABNAME", "TABKEY", "FNAME", "CHNGIND", "VALUE_NEW"}
_AUFK = {"AUFNR", "AUTYP", "AUART", "WERKS", "ERDAT", "ERFZEIT", "ERNAM", "OBJNR"}
_JCDS = {"OBJNR", "STAT", "CHGNR", "UDATE", "UTIME", "USNAM", "INACT"}
_MKPF = {"MBLNR", "MJAHR", "CPUDT", "CPUTM", "USNAM", "BLART"}
_MSEG = {"MBLNR", "MJAHR", "ZEILE", "BWART", "AUFNR", "WERKS"}
_MATDOC = {"MBLNR", "MJAHR", "ZEILE", "BWART", "MATNR", "WERKS", "LGORT", "BUDAT", "CPUDT", "CPUTM", "USNAM",
           "EBELN", "EBELP", "AUFNR", "KDAUF", "KDPOS", "VBELN_IM", "VBELP_IM", "RECORD_TYPE"}
_QMEL = {"QMNUM", "QMART", "QMDAT", "MZEIT", "ERNAM", "ERDAT", "QMDAB", "QMZAB", "PRIOK", "AUFNR", "PRUEFLOS",
         "IWERK"}  # IWERK is not in the ECC 6.0 DDIC file: dropped by the DDIC check, QMEL marked partial
_TQ80 = {"QMART", "QMTYP"}
_HR_KEYS = {"PERNR", "BEGDA", "SEQNR", "AEDTM", "UNAME"}
PROCESS_EVENTS_DATA: dict[str, dict[str, set[str]]] = {
    "process_events_ptp": {
        "EKKO": {"EBELN", "AEDAT", "ERNAM", "BSART", "BUKRS", "EKORG", "EKGRP", "LIFNR"},
        "EKPO": {"EBELN", "EBELP", "BANFN", "BNFPO", "WERKS", "MATKL", "LOEKZ", "AEDAT"},
        "EBAN": {"BANFN", "BNFPO", "ERDAT", "ERNAM", "BADAT", "FRGDT", "FRGZU", "BSART", "EKORG", "WERKS"},
        "EKBE": {"EBELN", "EBELP", "VGABE", "GJAHR", "BELNR", "BUZEI", "BEWTP", "BWART", "SHKZG", "BUDAT",
                 "CPUDT", "CPUTM", "ERNAM"},
        "RBKP": {"BELNR", "GJAHR", "CPUDT", "CPUTM", "USNAM", "BLART", "BUKRS", "ZLSPR", "RBSTAT"},
        "BKPF": {"BUKRS", "BELNR", "GJAHR", "AWTYP", "AWKEY", "CPUDT", "CPUTM", "USNAM", "BLART", "TCODE"},
        "BSAK": {"BUKRS", "BELNR", "GJAHR", "BUZEI", "AUGDT", "AUGBL", "LIFNR"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_otc": {
        "VBAK": {"VBELN", "ERDAT", "ERZET", "ERNAM", "AUART", "VKORG", "VTWEG", "SPART", "LIFSK", "FAKSK", "KUNNR"},
        "VBAP": {"VBELN", "POSNR", "ERDAT", "ERZET", "ERNAM", "PSTYV", "WERKS", "ABGRU"},
        "LIKP": {"VBELN", "ERDAT", "ERZET", "ERNAM", "LFART", "VSTEL", "WADAT_IST"},
        "LIPS": {"VBELN", "POSNR", "VGBEL", "VGPOS"},
        "VBRK": {"VBELN", "ERDAT", "ERZET", "ERNAM", "FKART", "BUKRS", "BELNR", "GJAHR", "FKSTO", "SFAKN"},
        "VBRP": {"VBELN", "POSNR", "AUBEL", "AUPOS", "VGBEL", "VGPOS"},
        "BSAD": {"BUKRS", "BELNR", "GJAHR", "BUZEI", "AUGDT", "AUGBL", "KUNNR"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_r2r": {
        "BKPF": {"BUKRS", "BELNR", "GJAHR", "BLART", "BSTAT", "CPUDT", "CPUTM", "USNAM", "TCODE", "STBLG",
                 "STJAH", "AWTYP"},
        "BSAS": {"BUKRS", "BELNR", "GJAHR", "BUZEI", "AUGDT", "AUGBL", "HKONT"},
        "AUFK": {"AUFNR", "AUTYP", "AUART", "ERDAT", "ERFZEIT", "ERNAM", "BUKRS", "OBJNR"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_pp": {
        "AUFK": _AUFK, "AFKO": {"AUFNR", "GSTRP", "GLTRP", "GSTRI", "GLTRI", "PLNBEZ"}, "JCDS": _JCDS,
        "MKPF": _MKPF, "MSEG": _MSEG, "MATDOC": _MATDOC, "T001W": {"WERKS"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_pm": {
        "QMEL": _QMEL, "TQ80": _TQ80, "AUFK": _AUFK, "AFIH": {"AUFNR", "WARPL", "EQUNR", "IWERK"},
        "JCDS": _JCDS, "MKPF": _MKPF, "MSEG": _MSEG, "MATDOC": _MATDOC, "T001W": {"WERKS"},
        "CDHDR": _CDHDR, "CDPOS": _CDPOS, "USR02": _USR02,
    },
    "process_events_qm": {
        "QALS": {"PRUEFLOS", "ENSTEHDAT", "ENTSTEZEIT", "ERSTELLER", "ART", "HERKUNFT", "WERK", "MATNR", "EBELN",
                 "AUFNR", "OBJNR"},
        "QAVE": {"PRUEFLOS", "VDATUM", "VNAME", "VCODE", "VAEDATUM"},
        "QMEL": _QMEL, "QMFE": {"QMNUM", "FENUM", "ERDAT", "ERZEIT", "ERNAM", "FECOD"},
        "QMSM": {"QMNUM", "MANUM", "ERDAT", "ERZEIT", "ERNAM", "PETER", "ERLDAT", "ERLZEIT", "ERLNAM"},
        "TQ80": _TQ80, "USR02": _USR02,
    },
    "process_events_ps": {
        "PROJ": {"PSPNR", "PSPID", "ERDAT", "ERNAM", "VBUKR", "OBJNR"},
        "PRPS": {"PSPNR", "POSID", "PSPHI", "ERDAT", "ERNAM", "PBUKR", "OBJNR"},
        "JCDS": _JCDS, "USR02": _USR02,
    },
    "process_events_wh": {
        "LTAK": {"LGNUM", "TANUM", "BWLVS", "BDATU", "BZEIT", "BNAME", "BETYP", "BENUM", "KQUIT", "VBELN"},
        "LTAP": {"LGNUM", "TANUM", "TAPOS", "QDATU", "QZEIT", "QNAME", "VLTYP", "NLTYP", "PQUIT"},
        "/SCWM/ORDIM_C": {"LGNUM", "TANUM", "TAPOS", "TOSTAT", "TRART", "PROCTY", "CREATED_AT", "CREATED_BY",
                          "CONFIRMED_AT", "CONFIRMED_BY", "VLPLA", "NLPLA"},
        "USR02": _USR02,
    },
    "process_events_htr": {
        "PA0000": {"PERNR", "BEGDA", "ENDDA", "SEQNR", "MASSN", "MASSG", "STAT2", "AEDTM", "UNAME"},
        "PA0001": _HR_KEYS | {"BUKRS", "WERKS", "PERSG", "ORGEH"},
        "PA0002": set(_HR_KEYS), "PA0008": set(_HR_KEYS),  # keys, dates and user only: no names, no pay
        "HRP1000": {"PLVAR", "OTYPE", "OBJID", "BEGDA", "AEDTM", "UNAME"},
        "HRP1001": {"PLVAR", "OTYPE", "OBJID", "RSIGN", "RELAT", "SCLAS", "BEGDA", "AEDTM", "UNAME"},
        "USR02": _USR02,
    },
    "process_events_mdg": {
        "USMD120C": {"USMD_CREQUEST", "USMD_CREQ_TYPE", "USMD_CREQ_STATUS", "USMD_CREATED_AT", "USMD_CREATED_BY",
                     "USMD_RELEASED_AT", "USMD_RELEASED_BY", "USMD_CHANGED_AT", "USMD_CHANGED_BY",
                     "USMD_DATA_CHN_AT", "USMD_PRIORITY"},
        "USR02": _USR02,
    },
}
_PE_CONFIG = {"USR02", "TQ80", "T001W"}           # whole reads, CONFIG_MAX_ROWS
_PE_SYSTEMS: dict[str, tuple[str, ...]] = {        # tables read on some system types only (spec §1.2)
    "MKPF": ("ecc",), "MSEG": ("ecc",),
    "MATDOC": ("s4hana_onprem",), "T001W": ("s4hana_onprem",),
    "LTAK": ("ecc", "s4hana_onprem"), "LTAP": ("ecc", "s4hana_onprem"),
    "/SCWM/ORDIM_C": ("ewm",),
}
_PE_NO_KEYS = {"MATDOC"}                           # technical KEY1..KEY6: read the listed fields only


@dataclass
class TablePlan:
    table: str
    fields: set[str] = field(default_factory=set)
    keys: list[str] = field(default_factory=list)
    where: Optional[str] = None
    wide_where: Optional[str] = None   # retry when the default window is empty (stale/sandbox systems)
    via: Optional[str] = None          # read by parent keys (see extraction_windows.yaml)
    purpose: str = "data"              # data | config
    modules: set[str] = field(default_factory=set)
    partial: bool = False              # windowed / parent-keyed / scoped: not every record of the table
    slices: list[str] = field(default_factory=list)   # one full WHERE per month slice (process events)
    also_via: list[str] = field(default_factory=list)  # further via parents, IN-lists concatenated
    in_field: Optional[str] = None     # via: child field of the IN-list (default: most selective join field)
    group_field: Optional[str] = None  # via: child key-prefix field set per IN-list group
    max_slice_rows: int = 0            # >0: a full slice is re-read per split_by value, then per day
    split_by: dict[str, str] = field(default_factory=dict)  # field -> config table listing its values

    def columns(self) -> list[str]:
        return list(dict.fromkeys(self.keys + sorted(self.fields - set(self.keys))))


@lru_cache(maxsize=1)
def _windows() -> dict:
    return yaml.safe_load(_WINDOWS.read_text()) or {}


def _months_ago(n: int, today: date) -> str:
    y, m = today.year, today.month - n
    while m <= 0:
        m += 12
        y -= 1
    return f"{y:04d}{m:02d}{min(today.day, 28):02d}"


def render_where(template: str, today: Optional[date] = None) -> str:
    today = today or date.today()
    out = re.sub(r"\{months_ago:(\d+)\}", lambda m: _months_ago(int(m.group(1)), today), template)
    out = re.sub(r"\{days_ago:(\d+)\}", lambda m: (today - timedelta(days=int(m.group(1)))).strftime("%Y%m%d"), out)
    return re.sub(r"\{years_ago:(\d+)\}", lambda m: str(today.year - int(m.group(1))), out)


# Scope filters a download can carry → the SAP field they restrict. Applied to
# every planned table that has the field; tables without it are read in full.
SCOPE_FIELDS = {"company_codes": "BUKRS", "plants": "WERKS", "sales_orgs": "VKORG", "purchasing_orgs": "EKORG"}
_SCOPE_VALUE = re.compile(r"^[A-Z0-9_]{1,10}$")
_SCOPE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalise_scope(scope: Optional[dict]) -> dict:
    """Validated scope ({} = everything). Values go into RFC WHERE clauses, so
    only organisational-unit codes and ISO dates are accepted."""
    out: dict = {}
    for key in SCOPE_FIELDS:
        vals = sorted({str(v).strip().upper() for v in (scope or {}).get(key) or [] if str(v).strip()})
        bad = [v for v in vals if not _SCOPE_VALUE.match(v)]
        if bad:
            raise ValueError(f"Invalid {key}: {', '.join(bad)}")
        if vals:
            out[key] = vals
    for key in ("date_from", "date_to"):
        v = (scope or {}).get(key)
        if v:
            if not _SCOPE_DATE.match(str(v)):
                raise ValueError(f"{key} must be YYYY-MM-DD")
            out[key] = str(v)
    if out.get("date_from") and out.get("date_to") and out["date_from"] > out["date_to"]:
        raise ValueError("date_from is after date_to")
    if (scope or {}).get("exclude_deleted"):
        out["exclude_deleted"] = True
    return out


def _scope_filters(table: str, dictionary: Dictionary, scope: dict) -> list[str]:
    out = []
    for key, field in SCOPE_FIELDS.items():
        if scope.get(key) and dictionary.field(table, field) is not None:
            out.append(f"{field} IN (" + ", ".join(f"'{v}'" for v in scope[key]) + ")")
    return out


# Deletion-flag fields: material child tables use LVORM, customer/vendor
# company- and sales-area children use LOEVM. A module's root/header table
# (MARA, KNA1, LFA1, BUT000, ...) is keyed on the master object alone
# (one DDIC key field); every plant/org/storage-level child adds a
# segmenting key field (WERKS, BUKRS, VKORG, LGNUM, ...). Header tables are
# excluded from this filter and always read in full — inactive header data
# is itself a DQ finding, only the bulky per-segment child tables get filtered.
_DELETION_FLAGS = ("LVORM", "LOEVM")


def _deletion_filters(table: str, dictionary: Dictionary, scope: dict, keys: list[str]) -> list[str]:
    if not scope.get("exclude_deleted") or len(keys) <= 1:
        return []  # single-key table: the module's root/header, stays complete
    for flag in _DELETION_FLAGS:
        if dictionary.field(table, flag) is not None:
            return [f"{flag} = ''"]
    return []


def widen(template: str, factor: int = 4, cap: int = 24) -> Optional[str]:
    """The window with every ``{months_ago:N}`` (N > 0) stretched to N*factor, capped.

    A copy or sandbox client often has no postings in the last quarter: the
    default window then reads nothing. None when there is nothing to stretch."""
    out = re.sub(r"\{months_ago:(\d+)\}",
                 lambda m: f"{{months_ago:{min(int(m.group(1)) * factor, cap)}}}" if int(m.group(1)) else m.group(0),
                 template)
    return out if out != template else None


def _window(template: str, scope: dict) -> str:
    """The table's default window, or the download's date range on the same field."""
    if not (scope.get("date_from") or scope.get("date_to")):
        return render_where(template)
    field = template.split()[0]
    parts = []
    if scope.get("date_from"):
        parts.append(f"{field} >= '{scope['date_from'].replace('-', '')}'")
    if scope.get("date_to"):
        parts.append(f"{field} <= '{scope['date_to'].replace('-', '')}'")
    return " AND ".join(parts)


@lru_cache(maxsize=1)
def _pe_windows() -> dict:
    return yaml.safe_load(_PE_WINDOWS.read_text()) or {}


@lru_cache(maxsize=1)
def pe_edges() -> tuple[Edge, ...]:
    """Process-discovery read edges (process_event_joins.yaml), searched after joins.yaml."""
    doc = yaml.safe_load(_PE_JOINS.read_text())
    return tuple(Edge(parent=e["parent"], child=e["child"], on=tuple((k, v) for k, v in e["join"].items()),
                      cardinality=e["cardinality"]) for e in doc["edges"])


def _ymd(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def month_slices(field: str, start: date, today: date, end: Optional[date] = None, suffix: str = "",
                 step: int = 1) -> list[str]:
    """``FIELD >= lo AND FIELD < hi`` per ``step`` calendar months from ``start``. With ``end`` the last
    slice stops after ``end`` (inclusive); without, the slice holding ``today`` is open-ended."""
    stop = end + timedelta(days=1) if end else None
    out, lo = [], start
    while True:
        k = lo.month - 1 + step
        hi = date(lo.year + k // 12, k % 12 + 1, 1)
        if stop is not None and hi >= stop:
            out.append(f"{field} >= '{lo:%Y%m%d}{suffix}' AND {field} < '{stop:%Y%m%d}{suffix}'")
            return out
        if stop is None and hi > today:
            out.append(f"{field} >= '{lo:%Y%m%d}{suffix}'")
            return out
        out.append(f"{field} >= '{lo:%Y%m%d}{suffix}' AND {field} < '{hi:%Y%m%d}{suffix}'")
        lo = hi


_RANGE = re.compile(r"^(\w+) >= '(\d{8})(\d*)'(?: AND \1 < '(\d{8})\d*')?")


def day_slices(slice_where: str, today: Optional[date] = None) -> list[str]:
    """The slice's leading date range as one range per calendar day; the rest of the WHERE is kept."""
    m = _RANGE.match(slice_where)
    if not m:
        return [slice_where]
    f, lo, suffix, hi = m.groups()
    rest = slice_where[m.end():]
    d = _ymd(lo)
    stop = _ymd(hi) if hi else (today or date.today()) + timedelta(days=1)
    out = []
    while d < stop:
        n = d + timedelta(days=1)
        out.append(f"{f} >= '{d:%Y%m%d}{suffix}' AND {f} < '{n:%Y%m%d}{suffix}'{rest}")
        d = n
    return out


def _or(clauses: Iterable[Optional[str]]) -> Optional[str]:
    """OR of per-module filters; one module without a filter means every row is needed."""
    cs = set(clauses)
    if not cs or None in cs:
        return None
    cs = sorted(cs)  # deterministic regardless of module order
    return cs[0] if len(cs) == 1 else "(" + " OR ".join(f"({c})" for c in cs) + ")"


def _pe_tables(modules: Iterable[str], system_type: str) -> dict[str, tuple[set[str], set[str]]]:
    """table -> (fields wanted, modules) for the process-event modules on this system type."""
    out: dict[str, tuple[set[str], set[str]]] = {}
    for m in modules:
        for t, cols in PROCESS_EVENTS_DATA.get(m, {}).items():
            if system_type in _PE_SYSTEMS.get(t, ABAP_SYSTEM_TYPES):
                fs, ms = out.setdefault(t, (set(), set()))
                fs |= cols
                ms.add(m)
    return out


def process_event_gaps(modules: Iterable[str], dictionary: Dictionary, system_type: str) -> dict[str, list[str]]:
    """Fields (or ``["*"]`` for a whole table) the dictionary lacks: the coverage reason of §10."""
    out: dict[str, list[str]] = {}
    for t, (cols, _) in sorted(_pe_tables(modules, system_type).items()):
        if dictionary.table(t) is None or dictionary.table(t).category == "VIEW":
            out[t] = ["*"]
        elif missing := sorted(f for f in cols if dictionary.field(t, f) is None):
            out[t] = missing
    return out


def _plan_process_events(modules: list[str], dictionary: Dictionary, system_type: str, scope: dict,
                         today: date) -> dict[str, TablePlan]:
    windows = _pe_windows()
    plans: dict[str, TablePlan] = {}
    for t, (cols, mods) in _pe_tables(modules, system_type).items():
        tt = dictionary.table(t)
        if tt is None or tt.category == "VIEW":
            continue
        keep = {f for f in cols if dictionary.field(t, f) is not None}
        plans[t] = TablePlan(table=t, fields=keep, modules=set(mods), partial=keep != cols,
                             keys=[] if t in _PE_NO_KEYS else list(dictionary.keys(t)),
                             purpose="config" if t in _PE_CONFIG else "data")
    for t, p in plans.items():
        if p.purpose == "config":
            continue
        w = windows.get(t) or {}
        per = {m: {**w, **((w.get("modules") or {}).get(m) or {})} for m in sorted(p.modules)}
        scoped = _scope_filters(t, dictionary, scope)
        p.partial = True
        if w.get("via"):
            parents = [x for x in [w["via"], *(w.get("also_via") or [])] if x in plans]
            p.via, p.also_via = (parents[0] if parents else None), parents[1:]
            p.in_field, p.group_field = w.get("in_field"), w.get("group_field")
            p.where = " AND ".join(x for x in (_or(c.get("where") for c in per.values()), *scoped) if x) or None
            continue
        suffix = str(w.get("suffix") or "")
        starts = {m: date.fromisoformat(scope["date_from"]) if scope.get("date_from")
                  else _ymd(_months_ago(int(c["months"]), today)) for m, c in per.items()}
        start = min(starts.values())
        end = date.fromisoformat(scope["date_to"]) if scope.get("date_to") else None
        for r in month_slices(w["field"], start, today, end, suffix, int(w.get("slice_months") or 1)):
            hi = _RANGE.match(r).group(4)
            covering = [c.get("where") for m, c in per.items() if hi is None or starts[m] < _ymd(hi)]
            p.slices.append(" AND ".join(x for x in (r, _or(covering), *scoped) if x))
        whole = [f"{w['field']} >= '{start:%Y%m%d}{suffix}'"]
        if end:
            whole.append(f"{w['field']} < '{end + timedelta(days=1):%Y%m%d}{suffix}'")
        p.where = " AND ".join(x for x in (*whole, _or(c.get("where") for c in per.values()), *scoped) if x)
        p.max_slice_rows = int(w.get("max_slice_rows") or 0)
        p.split_by = {f: src for f, src in (w.get("split_by") or {}).items() if src in plans}
    return plans


def plan_modules(modules: list[str], dictionary: Dictionary, scope: Optional[dict] = None, *,
                 include_disabled: bool = False,
                 system_type: str = "ecc", today: Optional[date] = None) -> dict[str, TablePlan]:
    """Tables/fields to extract so every rule of ``modules`` can be evaluated.

    Process-event modules (PROCESS_EVENT_MODULES) are planned by ``_plan_process_events`` and merged
    last: a table a DQ module also reads keeps its DQ window and gains the process-event fields."""
    process = [m for m in modules if m in PROCESS_EVENT_MODULES]
    modules = [m for m in modules if m not in PROCESS_EVENT_MODULES]
    from checks.population import fields_for
    from checks.config_rules import fields_for as config_fields
    from checks.country_rules import fields_for as country_fields
    from checks.value_placement import fields_for as placement_fields
    from checks.runner import module_rules, rule_columns, target_columns

    edges, _ = _graph()
    joinable = {t for e in edges for t in (e.parent, e.child)}
    plans: dict[str, TablePlan] = {}

    def add(table: str, cols: set[str], module: str, purpose: str = "data") -> None:
        if dictionary.table(table) is None or dictionary.table(table).category == "VIEW":
            return  # canonical views are not ABAP tables
        p = plans.setdefault(table, TablePlan(table=table, purpose=purpose))
        p.fields |= cols
        p.modules.add(module)
        if purpose == "data":
            p.purpose = "data"

    for module in modules:
        try:
            rules = module_rules(module)
        except FileNotFoundError:
            continue
        # A disabled rule never evaluates (checks/overrides.apply drops it), so reading its
        # fields costs SAP time and extractor memory for no possible finding. The DDIC-derived
        # rules ship disabled and they are the bulk of the library: on material_master this is
        # 42 of MARC's 140 columns and most of MARA's 124, on tables of millions of rows.
        #
        # A tenant can re-enable a disabled rule from the UI (the rules table overrides the YAML
        # default). plan_modules has no session, so it cannot see that override - the re-enabled
        # rule would find its fields missing and report not_evaluable. `include_disabled`
        # covers that: the extraction passes True when the tenant has re-enabled anything.
        if not include_disabled:
            rules = [r for r in rules if r.get("enabled", True)]
        for rule in rules:
            cols = rule_columns(rule)
            # S/4 field layout on an ECC source (VBAK.GBSTK lives in VBUK on ECC)
            for c in list(cols):
                if dictionary.resolve(c) is None and c in _MOVED:
                    cols.append(_MOVED[c])
            # tables on the join path the engine will use for this rule
            skeleton = {t: [] for t in set(tables_of(cols)) | joinable}
            tf = TableFrames({t: _empty(dictionary, t) for t in skeleton}, dictionary, module=module)
            path_tables = tf.path_tables(cols, grain=rule.get("grain")) or set(tables_of(cols))
            for t in path_tables:
                add(t, {c.split(".", 1)[1] for c in cols if c.startswith(t + ".")}, module)
            # the master table a reference must exist in (read in full)
            for c in target_columns(rule):
                add(c.split(".", 1)[0], {c.split(".", 1)[1]}, module)
            # configuration tables holding the allowed values
            if rule.get("check_class") in ("domain_value_check", "referential_check") and rule.get("field"):
                f = dictionary.resolve(rule["field"])
                ref = (f"{rule['reference_table']}.{rule['reference_field']}"
                       if rule.get("reference_table") and rule.get("reference_field") else (f.check_ref if f else None))
                if ref and _is_config_table(dictionary, ref.split(".")[0]):
                    add(ref.split(".")[0], {ref.split(".")[1]}, module, purpose="config")

    # S/4 tables judged only when the live dictionary has their fields (checks/config_rules.py)
    from checks.config_rules import live_tables
    for module in modules:
        for t, fields in live_tables(module, dictionary).items():
            add(t, set(fields), module)

    if _DISCOVERY_TRIGGER & set(modules):
        for t, cols in DISCOVERY_DATA.items():
            add(t, set(cols), DISCOVERY_MODULE)
        for t, cols in DISCOVERY_CONFIG.items():
            add(t, set(cols), DISCOVERY_MODULE, purpose="config")

    if _S4_LOAD_TRIGGER & set(modules):
        for t, cols in S4_LOAD_DATA.items():
            add(t, set(cols), S4_LOAD_MODULE)
        for t, cols in S4_LOAD_CONFIG.items():
            add(t, set(cols), S4_LOAD_MODULE, purpose="config")

    if _PROVEN_COST_TRIGGER & set(modules):
        for t, cols in PROVEN_COST_DATA.items():
            add(t, set(cols), PROVEN_COST_MODULE)

    # config tables behind the derived process flows (full-table reads), per area module
    from sap.process_definitions import flow_config_tables
    for t, (cols, mods) in flow_config_tables().items():
        if mods & set(modules):
            add(t, cols, DISCOVERY_MODULE, purpose="config")

    # the tables population exclusions look values up in (JEST status, T370T category)
    from checks.population import policy
    for t, p in list(plans.items()):
        for x in policy().get(t, []) if p.purpose == "data" else []:
            if spec := x.get("in_table"):
                for m in p.modules:
                    add(spec["table"], {spec["column"], *spec.get("where", {})}, m,
                        purpose="config" if _is_config_table(dictionary, spec["table"]) else "data")

    # keys, join fields, filters
    for t, p in plans.items():
        p.keys = list(dictionary.keys(t))
        for e in edges:
            if e.child == t:
                p.fields |= {c for c, _ in e.on} | {f for f, _ in e.filter + e.prefer}
            if e.parent == t:
                p.fields |= {pf for _, pf in e.on}
        p.fields |= fields_for(t)  # active-population flags (checks/population.py)
        if p.purpose == "data":
            p.fields |= placement_fields(t, dictionary) | country_fields(t, dictionary) | config_fields(t, dictionary)
        p.fields = {f for f in p.fields if dictionary.field(t, f) is not None}
        w = _windows().get(t) or {}
        filters = [f"{f} = '{v or ' '}'" for e in edges if e.child == t for f, v in e.filter]
        wide = None
        if w.get("where"):
            if not (scope or {}).get("date_from") and not (scope or {}).get("date_to") and widen(w["where"]):
                wide = filters + [render_where(widen(w["where"]))]
            filters.append(_window(w["where"], scope or {}))
        scoped = _scope_filters(t, dictionary, scope or {}) if p.purpose == "data" else []
        deleted = _deletion_filters(t, dictionary, scope or {}, p.keys) if p.purpose == "data" else []
        filters += scoped + deleted
        p.partial = bool(w.get("where") or w.get("via") or scoped or deleted)
        p.where = " AND ".join(filters) or None
        p.wide_where = " AND ".join(wide + scoped + deleted) if wide else None
        p.via = w.get("via") if w.get("via") in plans else None

    # the check table of every field read: the DDIC conformance check value-checks each one
    # against the live configuration, which exists only once some extraction has read it
    for t, p in list(plans.items()):
        if p.purpose != "data":
            continue
        for f in sorted(p.fields):
            ref = getattr(dictionary.field(t, f), "check_ref", None) or ""
            rt, _, rf = ref.partition(".")
            if rt and rt not in plans and dictionary.field(rt, rf) is not None and _is_config_table(dictionary, rt) \
                    and dictionary.table(rt).category != "VIEW":
                plans[rt] = TablePlan(table=rt, fields={rf}, keys=list(dictionary.keys(rt)), purpose="config",
                                      modules=set(p.modules))
    if process:
        for t, p in _plan_process_events(process, dictionary, system_type, scope or {},
                                         today or date.today()).items():
            if t in plans:
                plans[t].fields |= p.fields
                plans[t].modules |= p.modules
            else:
                plans[t] = p
    return plans


def read_order(plans: dict[str, TablePlan]) -> list[str]:
    """Tables ordered so every ``via`` / ``also_via`` parent and ``split_by`` source is read first."""
    done: list[str] = []

    def visit(t: str, seen: set[str]) -> None:
        if t in done or t in seen:
            return
        seen.add(t)
        p = plans[t]
        for parent in [p.via, *p.also_via, *p.split_by.values()]:
            if parent and parent in plans:
                visit(parent, seen)
        done.append(t)

    for t in sorted(plans):
        visit(t, set())
    return done


def in_lists(field: str, values: Iterable[str], chunk: int = 60) -> list[str]:
    """``FIELD IN ('a','b',…)`` clauses of at most ``chunk`` values each. The values are stripped,
    de-duplicated, sorted and quote-escaped. ``where_options`` then splits each clause into
    OPTIONS lines of 72 characters or fewer."""
    from sap.rfc import _literal

    vals = sorted({str(v).strip() for v in values if str(v).strip()})
    return [f"{field} IN (" + ",".join(_literal(v) for v in vals[i:i + chunk]) + ")"
            for i in range(0, len(vals), chunk)]


def via_filters(child: str, parent: str, parent_rows, chunk: int = 60, *, extra_edges: Iterable[Edge] = (),
                in_field: Optional[str] = None, group_field: Optional[str] = None) -> list[str]:
    """WHERE clauses selecting child rows of already-read parent rows (key IN-lists).

    ``extra_edges`` (process_event_joins.yaml) are searched after joins.yaml. ``in_field`` names the
    child field of the IN-list; ``group_field`` prefixes each IN-list with ``FIELD = '<value>' AND`` per
    distinct parent value, so the read hits a key prefix (CDPOS: OBJECTCLAS, OBJECTID)."""
    from sap.rfc import _literal

    edges, _ = _graph()
    edge = next((e for e in (*edges, *extra_edges) if e.parent == parent and e.child == child), None)
    if edge is None or parent_rows is None or len(parent_rows) == 0:
        return []
    on = dict(edge.on)
    if in_field:
        child_f, parent_f = in_field, on[in_field]
    else:  # the most selective single join field (document number)
        child_f, parent_f = max(edge.on, key=lambda cp: cp[1] not in ("BUKRS", "GJAHR", "LGNUM", "MANDT"))
    if not group_field:
        return in_lists(child_f, parent_rows[parent_f].tolist(), chunk)
    groups = parent_rows.assign(_g=parent_rows[on[group_field]].astype(str).str.strip())
    return [f"{group_field} = {_literal(g)} AND {c}"
            for g, rows in sorted(groups.groupby("_g"), key=lambda x: x[0])
            for c in in_lists(child_f, rows[parent_f].tolist(), chunk)]


def _is_config_table(dictionary: Dictionary, table: str) -> bool:
    t = dictionary.table(table)
    if t is None:
        return bool(re.match(r"^T[0-9A-Z]", table))  # unknown customizing table (T134, TVAK …)
    return getattr(t, "delivery_class", None) in _CONFIG_DELIVERY_CLASSES or bool(re.match(r"^T[0-9A-Z]", table))


def _empty(dictionary: Dictionary, table: str):
    import pandas as pd
    return pd.DataFrame(columns=[f"{table}.{k}" for k in dictionary.keys(table)])
