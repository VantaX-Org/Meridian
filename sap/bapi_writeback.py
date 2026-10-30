"""Field-level SAP write-back through standard BAPIs (ABAP systems: ECC, S/4HANA on-premise, EWM).

One record at a time, through the connector's ``execute_bapi`` (sap/rfc.py), never pyrfc directly:

  1. plan       which of the record's fields a BAPI can carry (``plan_field``); every other field is reported
                per field with the reason, and is delivered by the export (LSMW / BAPI file) instead.
  2. verify     the BAPI's interface on the connected system (RFC_GET_FUNCTION_INTERFACE, then
                DDIF_FIELDINFO_GET for each structure): every parameter and field the call would send must
                exist on this release, else nothing is sent for that field and the reason says so.
  3. simulate   TESTRUN = 'X' where the BAPI has a TESTRUN parameter on this release; otherwise the call without
                a commit, followed by BAPI_TRANSACTION_ROLLBACK. An object whose BAPI may commit by itself
                (customer, BAPI_CUSTOMER_CHANGEFROMDATA1) is simulated by step 2 only, never called.
  4. apply      the real call, then BAPI_TRANSACTION_COMMIT (WAIT = 'X') only when RETURN holds no E or A
                message; otherwise BAPI_TRANSACTION_ROLLBACK.

Every RETURN message (type, id, number, text) is kept per record. Logs carry the BAPI, the record key, the field
names and message types, never a field value.

Objects and BAPIs:
  material_master     BAPI_MATERIAL_SAVEDATA: HEADDATA, CLIENTDATA/X (MARA), PLANTDATA/X (MARC),
                      VALUATIONDATA/X (MBEW), SALESDATA/X (MVKE), MATERIALDESCRIPTION (MAKT), UNITSOFMEASURE/X (MARM)
  business_partner    BAPI_BUPA_CENTRAL_CHANGE for BUT000 (CENTRALDATA, ...PERSON, ...ORGANIZATION, ...GROUP and their
                      _X structures), BAPI_BUPA_ADDRESS_CHANGE for ADRC (ADDRESSDATA/_X)
  sd_customer_master  BAPI_CUSTOMER_CHANGEFROMDATA1: PI_COMPANYDATA/X (KNA1 general data) and
  accounts_receivable PI_OPT_COMPANYDATA/X (KNVV sales-area data, with PI_SALESORG, PI_DISTR_CHAN, PI_DIVISION)
  accounts_payable    none. The classic vendor master (LFA1, LFB1, LFM1) is maintained by class VMD_EI_API, which is
                      not remote-enabled and differs by release, so it cannot be called over RFC. Vendor fixes go out
                      as an export (LSMW / XK02 file), or through BUT000 where the vendor is a business partner.

The structure and field names below follow SAP's interface documentation for these BAPIs. They are not taken on
trust: step 2 checks each one against the connected system before anything is sent.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from .base import BAPICall, SAPConnectorError

logger = logging.getLogger("meridian.sap.writeback")

COMMIT = "BAPI_TRANSACTION_COMMIT"
ROLLBACK = "BAPI_TRANSACTION_ROLLBACK"
FAILING_TYPES = ("E", "A")

VENDOR_REASON = ("The classic vendor master (LFA1, LFB1, LFM1) is maintained by class VMD_EI_API, which is not "
                 "remote-enabled and differs by release; load this fix with the export (LSMW / XK02 file), or fix "
                 "the business partner (BUT000) where the vendor is one")


@dataclass(frozen=True)
class Target:
    """Where one SAP field goes in one BAPI call."""
    bapi: str
    param: str                     # importing structure, or TABLES parameter when ``table``
    field: str                     # field of that structure
    xparam: Optional[str] = None   # the matching X (change flag) structure or table; None when the BAPI has none
    keys: tuple[tuple[str, str], ...] = ()  # (record-key field, structure field) set in the row / structure
    table: bool = False
    view: Optional[str] = None     # BAPI_MATERIAL_SAVEDATA HEADDATA view flag the structure needs
    date: bool = False             # value sent as YYYYMMDD
    needs: tuple[str, ...] = ()    # further record-key fields the call needs (sales area, address number)


@dataclass(frozen=True)
class ObjectSpec:
    module: str
    bapi_key: dict[str, tuple[str, str]]   # bapi -> (record-key field, importing parameter or "STRUCT.FIELD")
    fields: dict[str, Target]
    simulate: str                          # "testrun_or_rollback" | "interface_only"
    # record-key field -> importing parameter, sent when the record key has it (sales area, address number)
    context: dict[str, str] = field(default_factory=dict)


def _t(bapi: str, param: str, fld: str, xparam: Optional[str] = None, **kw: Any) -> Target:
    return Target(bapi, param, fld, xparam, **kw)


_MAT = "BAPI_MATERIAL_SAVEDATA"
_PLANT = (("WERKS", "PLANT"),)
_VAL = (("BWKEY", "VAL_AREA"), ("BWTAR", "VAL_TYPE"))
_SALES = (("VKORG", "SALES_ORG"), ("VTWEG", "DISTR_CHAN"))
_UOM = (("MEINH", "ALT_UNIT"),)


def _mara(f: str) -> Target:
    return _t(_MAT, "CLIENTDATA", f, "CLIENTDATAX", view="BASIC_VIEW")


def _marc(f: str) -> Target:
    return _t(_MAT, "PLANTDATA", f, "PLANTDATAX", keys=_PLANT, view="MRP_VIEW")


def _mbew(f: str) -> Target:
    return _t(_MAT, "VALUATIONDATA", f, "VALUATIONDATAX", keys=_VAL, view="ACCOUNT_VIEW")


def _mvke(f: str) -> Target:
    return _t(_MAT, "SALESDATA", f, "SALESDATAX", keys=_SALES, view="SALES_VIEW")


def _marm(f: str) -> Target:
    return _t(_MAT, "UNITSOFMEASURE", f, "UNITSOFMEASUREX", keys=_UOM, table=True, view="BASIC_VIEW")


MATERIAL = ObjectSpec(
    module="material_master",
    bapi_key={_MAT: ("MATNR", "HEADDATA.MATERIAL")},
    simulate="testrun_or_rollback",
    fields={
        # MARA: client data
        "MARA.MATKL": _mara("MATL_GROUP"), "MARA.MEINS": _mara("BASE_UOM"), "MARA.BISMT": _mara("OLD_MAT_NO"),
        "MARA.SPART": _mara("DIVISION"), "MARA.BRGEW": _mara("GROSS_WT"), "MARA.NTGEW": _mara("NET_WEIGHT"),
        "MARA.GEWEI": _mara("UNIT_OF_WT"), "MARA.VOLUM": _mara("VOLUME"), "MARA.VOLEH": _mara("VOLUMEUNIT"),
        "MARA.TRAGR": _mara("TRANS_GRP"), "MARA.XCHPF": _mara("BATCH_MGMT"), "MARA.MSTAE": _mara("PUR_STATUS"),
        "MARA.MSTAV": _mara("SAL_STATUS"), "MARA.EAN11": _mara("EAN_UPC"), "MARA.NUMTP": _mara("EAN_CAT"),
        "MARA.KZKFG": _mara("CONFIGURED"), "MARA.LVORM": _mara("DEL_FLAG"), "MARA.QMPUR": _mara("QM_PROCMNT"),
        "MARA.EXTWG": _mara("EXTMATLGRP"), "MARA.MFRPN": _mara("MANU_MAT"),
        # MARC: plant data
        "MARC.XCHPF": _marc("BATCH_MGMT"), "MARC.EKGRP": _marc("PUR_GROUP"), "MARC.DISMM": _marc("MRP_TYPE"),
        "MARC.DISPO": _marc("MRP_CTRLER"), "MARC.PLIFZ": _marc("PLND_DELRY"), "MARC.MINBE": _marc("REORDER_PT"),
        "MARC.BESKZ": _marc("PROC_TYPE"), "MARC.LGPRO": _marc("ISS_ST_LOC"), "MARC.LGFSB": _marc("SLOC_EXPRC"),
        "MARC.MABST": _marc("MAX_STOCK"), "MARC.HERKL": _marc("COUNTRYORI"), "MARC.BSTMI": _marc("MINLOTSIZE"),
        "MARC.BSTFE": _marc("FIXED_LOT"), "MARC.SAUFT": _marc("REP_MANUF"), "MARC.KORDB": _marc("SOURCELIST"),
        # MBEW: valuation data
        "MBEW.VPRSV": _mbew("PRICE_CTRL"), "MBEW.PEINH": _mbew("PRICE_UNIT"), "MBEW.STPRS": _mbew("STD_PRICE"),
        "MBEW.VERPR": _mbew("MOVING_PR"), "MBEW.BKLAS": _mbew("VAL_CLASS"),
        # MVKE: sales data
        "MVKE.MTPOS": _mvke("ITEM_CAT"), "MVKE.PRODH": _mvke("PROD_HIER"), "MVKE.VMSTA": _mvke("SAL_STATUS"),
        "MVKE.DWERK": _mvke("DELYG_PLNT"),
        # MAKT: descriptions (a table without X flags; the language comes from the record key)
        "MAKT.MAKTX": _t(_MAT, "MATERIALDESCRIPTION", "MATL_DESC", None, keys=(("SPRAS", "LANGU"),), table=True,
                         view="BASIC_VIEW"),
        # MARM: units of measure
        "MARM.EAN11": _marm("EAN_UPC"), "MARM.NUMTP": _marm("EAN_CAT"), "MARM.GEWEI": _marm("UNIT_OF_WT"),
        "MARM.BRGEW": _marm("GROSS_WT"), "MARM.VOLUM": _marm("VOLUME"), "MARM.VOLEH": _marm("VOLUMEUNIT"),
        "MARM.MEABM": _marm("UNIT_DIM"),
    },
)

_BPC = "BAPI_BUPA_CENTRAL_CHANGE"
_BPA = "BAPI_BUPA_ADDRESS_CHANGE"


def _bp(param: str, f: str, **kw: Any) -> Target:
    return _t(_BPC, param, f, param + "_X", **kw)


def _adrc(f: str) -> Target:
    # an address change names the address it changes (never the standard address by default)
    return _t(_BPA, "ADDRESSDATA", f, "ADDRESSDATA_X", needs=("ADDRNUMBER",))


BUSINESS_PARTNER = ObjectSpec(
    module="business_partner",
    bapi_key={_BPC: ("PARTNER", "BUSINESSPARTNER"), _BPA: ("PARTNER", "BUSINESSPARTNER")},
    simulate="testrun_or_rollback",
    context={"ADDRNUMBER": "ADDRNUMBER"},
    fields={
        "BUT000.BU_SORT1": _bp("CENTRALDATA", "SEARCHTERM1"), "BUT000.BU_SORT2": _bp("CENTRALDATA", "SEARCHTERM2"),
        "BUT000.TITLE": _bp("CENTRALDATA", "TITLE_KEY"), "BUT000.XDELE": _bp("CENTRALDATA", "CENTRALARCHIVINGFLAG"),
        "BUT000.XBLCK": _bp("CENTRALDATA", "CENTRALBLOCK"),
        "BUT000.NAME_FIRST": _bp("CENTRALDATAPERSON", "FIRSTNAME"),
        "BUT000.NAME_LAST": _bp("CENTRALDATAPERSON", "LASTNAME"),
        "BUT000.BIRTHDT": _bp("CENTRALDATAPERSON", "BIRTHDATE", date=True),
        "BUT000.NATIO": _bp("CENTRALDATAPERSON", "NATIONALITY"),
        "BUT000.LANGU_CORR": _bp("CENTRALDATAPERSON", "CORRESPONDLANGUAGE"),
        "BUT000.NAME_ORG1": _bp("CENTRALDATAORGANIZATION", "NAME1"),
        "BUT000.NAME_ORG2": _bp("CENTRALDATAORGANIZATION", "NAME2"),
        "BUT000.FOUND_DAT": _bp("CENTRALDATAORGANIZATION", "FOUNDATIONDATE", date=True),
        "BUT000.NAME_GRP1": _bp("CENTRALDATAGROUP", "NAMEGROUP1"),
        "ADRC.COUNTRY": _adrc("COUNTRY"), "ADRC.REGION": _adrc("REGION"), "ADRC.LANGU": _adrc("LANGU"),
        "ADRC.CITY1": _adrc("CITY"), "ADRC.POST_CODE1": _adrc("POSTL_COD1"), "ADRC.STREET": _adrc("STREET"),
        "ADRC.HOUSE_NUM1": _adrc("HOUSE_NO"),
    },
)

_CUS = "BAPI_CUSTOMER_CHANGEFROMDATA1"


def _kna1(f: str) -> Target:
    return _t(_CUS, "PI_COMPANYDATA", f, "PI_COMPANYDATAX")


def _knvv(f: str) -> Target:
    return _t(_CUS, "PI_OPT_COMPANYDATA", f, "PI_OPT_COMPANYDATAX", needs=("VKORG", "VTWEG", "SPART"))


CUSTOMER_FIELDS = {
    "KNA1.NAME1": _kna1("NAME"), "KNA1.LAND1": _kna1("COUNTRY"), "KNA1.SPRAS": _kna1("LANGU"),
    "KNA1.REGIO": _kna1("REGION"), "KNA1.ORT01": _kna1("CITY"), "KNA1.PSTLZ": _kna1("POSTL_COD1"),
    "KNA1.STRAS": _kna1("STREET"),
    "KNVV.VSBED": _knvv("SHIP_COND"), "KNVV.VWERK": _knvv("DELYG_PLNT"), "KNVV.KZTLF": _knvv("PART_DLV"),
    "KNVV.KKBER": _knvv("C_CTR_AREA"),
}


def _customer(module: str) -> ObjectSpec:
    # BAPI_CUSTOMER_CHANGEFROMDATA1 has no TESTRUN and old releases commit inside it, so it is never called to
    # simulate: the simulation is the interface check and the current-value diff.
    return ObjectSpec(module=module, bapi_key={_CUS: ("KUNNR", "CUSTOMERNO")}, simulate="interface_only",
                      context={"VKORG": "PI_SALESORG", "VTWEG": "PI_DISTR_CHAN", "SPART": "PI_DIVISION"},
                      fields=CUSTOMER_FIELDS)


OBJECTS: dict[str, ObjectSpec] = {
    "material_master": MATERIAL,
    "business_partner": BUSINESS_PARTNER,
    "sd_customer_master": _customer("sd_customer_master"),
    "accounts_receivable": _customer("accounts_receivable"),
}

# The main BAPI per module, for display ("which BAPI writes this object")
BAPI_OF_MODULE: dict[str, str] = {
    "material_master": _MAT, "business_partner": _BPC,
    "sd_customer_master": _CUS, "accounts_receivable": _CUS,
}


# ── Planning ──────────────────────────────────────────────────────────────────


def parse_key(record_key: str) -> dict[str, str]:
    """``MATNR=1|WERKS=1000`` -> {"MATNR": "1", "WERKS": "1000"} (field names upper case)."""
    out: dict[str, str] = {}
    for part in str(record_key or "").split("|"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().upper().split(".")[-1]] = v
    return out


def _full(fld: str, table_hint: Optional[str] = None) -> str:
    f = str(fld).strip().upper()
    if "." not in f and table_hint:
        f = f"{table_hint}.{f}"
    return f


@dataclass
class FieldPlan:
    field: str
    supported: bool
    bapi: Optional[str] = None
    reason: Optional[str] = None


def plan_field(module: str, fld: str, record_key: str = "") -> FieldPlan:
    """Whether a BAPI can carry this field of this record, and which; the reason when not. Never contacts SAP."""
    full = _full(fld)
    if module == "accounts_payable" or full.split(".")[0] in ("LFA1", "LFB1", "LFM1"):
        return FieldPlan(full, False, None, VENDOR_REASON)
    spec = OBJECTS.get(module)
    if spec is None:
        return FieldPlan(full, False, None, f"No write-back BAPI for {module}; load this fix with the export")
    tgt = spec.fields.get(full)
    if tgt is None:
        return FieldPlan(full, False, None, f"No BAPI mapping for {full} yet; load this fix with the export")
    keys = parse_key(record_key)
    need = [spec.bapi_key[tgt.bapi][0], *[k for k, _ in tgt.keys], *tgt.needs]
    missing = [k for k in need if k not in keys]
    if record_key and missing:
        return FieldPlan(full, False, tgt.bapi,
                         f"The record key has no {', '.join(missing)}, which {tgt.bapi} needs for {full}")
    return FieldPlan(full, True, tgt.bapi, None)


# ── Building the call ─────────────────────────────────────────────────────────


def _value(tgt: Target, value: Any) -> Any:
    if value is None:
        return ""
    s = str(value)
    if tgt.date:
        s = s.replace("-", "")[:8]
    return s


def build_calls(module: str, record_key: str, changes: dict[str, Any]) -> dict[str, dict]:
    """{bapi: params} for the record's supported changes ({"MARA.MATKL": "001", ...}). Raises KeyError for an
    unsupported field (callers plan first)."""
    spec = OBJECTS[module]
    keys = parse_key(record_key)
    calls: dict[str, dict] = {}
    for full, value in changes.items():
        tgt = spec.fields[_full(full)]
        key_field, key_param = spec.bapi_key[tgt.bapi]
        p = calls.setdefault(tgt.bapi, {})
        if "." in key_param:
            s, f = key_param.split(".", 1)
            p.setdefault(s, {})[f] = keys[key_field]
        else:
            p[key_param] = keys[key_field]
        missing = [k for k in tgt.needs if k not in keys]
        if missing:
            raise KeyError(", ".join(missing))
        for k, param in spec.context.items():
            if k in keys:
                p[param] = keys[k]
        if tgt.view:
            p.setdefault("HEADDATA", {})[tgt.view] = "X"
        row_keys = {sf: keys[rk] for rk, sf in tgt.keys}
        if tgt.table:
            rows = p.setdefault(tgt.param, [])
            row = next((r for r in rows if all(r.get(k) == v for k, v in row_keys.items())), None)
            if row is None:
                row = dict(row_keys)
                rows.append(row)
            row[tgt.field] = _value(tgt, value)
            if tgt.xparam:
                xrows = p.setdefault(tgt.xparam, [])
                xrow = next((r for r in xrows if all(r.get(k) == v for k, v in row_keys.items())), None)
                if xrow is None:
                    xrow = dict(row_keys)
                    xrows.append(xrow)
                xrow[tgt.field] = "X"
        else:
            p.setdefault(tgt.param, {}).update({**row_keys, tgt.field: _value(tgt, value)})
            if tgt.xparam:
                p.setdefault(tgt.xparam, {}).update({**row_keys, tgt.field: "X"})
    return calls


# ── Interface verification ────────────────────────────────────────────────────


@dataclass
class Interface:
    params: dict[str, dict]                       # PARAMETER -> {"class", "tabname", "optional"}
    fields: dict[str, set[str]] = field(default_factory=dict)  # structure type -> field names


def read_interface(conn: Any, bapi: str, cache: dict[str, Interface]) -> Interface:
    """The BAPI's parameters on the connected system (RFC_GET_FUNCTION_INTERFACE). Cached per run."""
    if bapi in cache:
        return cache[bapi]
    r = conn.execute_bapi(BAPICall("RFC_GET_FUNCTION_INTERFACE", {"FUNCNAME": bapi}))
    params = {}
    for p in r.get("PARAMS") or []:
        name = str(p.get("PARAMETER", "")).strip()
        if name:
            params[name] = {"class": str(p.get("PARAMCLASS", "")).strip(),
                            "tabname": str(p.get("TABNAME", "")).strip(),
                            "optional": str(p.get("OPTIONAL", "")).strip() == "X"}
    cache[bapi] = Interface(params)
    return cache[bapi]


def _structure_fields(conn: Any, iface: Interface, tabname: str) -> set[str]:
    if tabname not in iface.fields:
        r = conn.execute_bapi(BAPICall("DDIF_FIELDINFO_GET", {"TABNAME": tabname}))
        iface.fields[tabname] = {str(d.get("FIELDNAME", "")).strip() for d in (r.get("DFIES_TAB") or [])}
    return iface.fields[tabname]


def verify_params(conn: Any, bapi: str, params: dict, cache: dict[str, Interface]) -> list[str]:
    """What the call would send that this system's BAPI does not have ([] = all present)."""
    iface = read_interface(conn, bapi, cache)
    if not iface.params:
        return [f"{bapi} does not exist on this system"]
    problems: list[str] = [f"{bapi} needs {n}, which this record does not provide"
                           for n, m in iface.params.items()
                           if m["class"] == "I" and not m["optional"] and n not in params]
    for name, value in params.items():
        meta = iface.params.get(name)
        if meta is None:
            problems.append(f"{bapi} has no parameter {name} on this release")
            continue
        rows = value if isinstance(value, list) else [value] if isinstance(value, dict) else []
        if rows and meta["tabname"]:
            have = _structure_fields(conn, iface, meta["tabname"])
            for f in sorted({k for r in rows for k in r} - have):
                problems.append(f"{bapi} {name} has no field {f} on this release")
    return problems


# ── RETURN handling ───────────────────────────────────────────────────────────


def return_messages(result: Any) -> list[dict]:
    """RETURN (a structure or a table) and RETURNMESSAGES as [{type, id, number, message}], empty rows dropped."""
    out: list[dict] = []
    if not isinstance(result, dict):
        return out
    for key in ("RETURN", "RETURNMESSAGES"):
        val = result.get(key)
        rows = val if isinstance(val, list) else [val] if isinstance(val, dict) else []
        for r in rows:
            t = str(r.get("TYPE", "")).strip()
            msg = str(r.get("MESSAGE", "")).strip()
            if not t and not msg:
                continue
            out.append({"type": t, "id": str(r.get("ID", "")).strip(), "number": str(r.get("NUMBER", "")).strip(),
                        "message": msg})
    return out


def failed(messages: list[dict]) -> bool:
    return any(m["type"] in FAILING_TYPES for m in messages)


# ── Running one record ────────────────────────────────────────────────────────


@dataclass
class RecordResult:
    record_key: str
    bapi_calls: list[str] = field(default_factory=list)
    fields: list[str] = field(default_factory=list)
    simulated: bool = False
    simulate_messages: list[dict] = field(default_factory=list)
    applied: bool = False
    committed: bool = False
    messages: list[dict] = field(default_factory=list)
    error: Optional[str] = None

    def as_dict(self) -> dict:
        return {"record_key": self.record_key, "bapis": self.bapi_calls, "fields": self.fields,
                "simulated": self.simulated, "simulate_messages": self.simulate_messages, "applied": self.applied,
                "committed": self.committed, "messages": self.messages, "error": self.error}


def _call(conn: Any, bapi: str, params: dict) -> dict:
    r = conn.execute_bapi(BAPICall(bapi, params))
    return r if isinstance(r, dict) else {}


def write_record(conn: Any, module: str, record_key: str, changes: dict[str, Any], apply: bool,
                 cache: Optional[dict[str, Interface]] = None) -> RecordResult:
    """Simulate, then (``apply``) write one record's supported changes. See the module docstring for the steps.

    ``changes`` maps "TABLE.FIELD" to the new value; fields without a BAPI mapping must be planned out first.
    """
    cache = {} if cache is None else cache
    spec = OBJECTS[module]
    res = RecordResult(record_key=record_key, fields=sorted(_full(f) for f in changes))
    try:
        calls = build_calls(module, record_key, changes)
    except KeyError as e:
        res.error = f"No BAPI mapping or record key field for {e}"
        return res
    res.bapi_calls = sorted(calls)
    try:
        for bapi, params in calls.items():
            problems = verify_params(conn, bapi, params, cache)
            if problems:
                res.error = "; ".join(problems)
                logger.warning("write-back %s %s: interface check failed (%d problems)", bapi, record_key,
                               len(problems))
                return res
        # simulate
        for bapi, params in calls.items():
            if spec.simulate == "interface_only":
                continue
            iface = cache[bapi]
            if "TESTRUN" in iface.params:
                msgs = return_messages(_call(conn, bapi, {**params, "TESTRUN": "X"}))
            else:
                msgs = return_messages(_call(conn, bapi, params))
                _call(conn, ROLLBACK, {})
            res.simulate_messages += msgs
        res.simulated = True
        if failed(res.simulate_messages):
            logger.info("write-back %s: simulation refused (%s)", record_key,
                        ",".join(sorted({m["type"] for m in res.simulate_messages})))
            return res
        if not apply:
            return res
        # apply: every BAPI of the record, then one commit only if none returned E or A
        for bapi, params in calls.items():
            res.messages += return_messages(_call(conn, bapi, params))
            if failed(res.messages):
                break
        res.applied = True
        if failed(res.messages):
            _call(conn, ROLLBACK, {})
            logger.info("write-back %s: rolled back (%s)", record_key,
                        ",".join(sorted({m["type"] for m in res.messages})))
            return res
        commit = return_messages(_call(conn, COMMIT, {"WAIT": "X"}))
        res.messages += commit
        res.committed = not failed(commit)
        logger.info("write-back %s via %s: %s (%d fields)", record_key, ",".join(res.bapi_calls),
                    "committed" if res.committed else "commit failed", len(res.fields))
    except SAPConnectorError as e:
        res.error = str(e)
        logger.warning("write-back %s: connector error (%s)", record_key, type(e).__name__)
    return res
