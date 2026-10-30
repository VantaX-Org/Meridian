"""Creating master data in SAP through standard BAPIs (ABAP systems), with the discipline of sap/bapi_writeback.py.

One record at a time, through the connector's ``execute_bapi`` (sap/rfc.py), never pyrfc directly:

  1. plan       which proposed fields a create BAPI carries (``plan_create``); every other field is listed with the
                reason and goes out with the export load file instead. Required fields missing stop the plan.
  2. available  every function the path needs is on the connected system (RFC_FUNCTION_SEARCH). When one is not,
                nothing is sent: the request ends approved with an export load file and the reason (``unavailable``).
  3. verify     each call's parameters and structure fields against the system's interface (RFC_GET_FUNCTION_INTERFACE,
                DDIF_FIELDINFO_GET), as bapi_writeback.verify_params does; whether TESTRUN exists is read here too.
  4. simulate   TESTRUN = 'X' where the create BAPI has it on this release; otherwise the call without a commit,
                then BAPI_TRANSACTION_ROLLBACK. Nothing is committed when the simulation returns an E or A message.
  5. create     the real calls in one LUW (create, then role and address calls), BAPI_TRANSACTION_COMMIT (WAIT = 'X')
                only when no RETURN of any of them holds an E or A message; otherwise BAPI_TRANSACTION_ROLLBACK. The
                created key (material number, business partner and, under CVI, its customer or vendor) is returned.

Objects:
  material          BAPI_MATERIAL_SAVEDATA: HEADDATA (MATERIAL, MATL_TYPE, IND_SECTOR and the view flags) and the
                    client, plant, valuation, sales, description and unit structures of the write-back mapping. The
                    number is MARA.MATNR when given (external numbering), else BAPI_MATERIAL_GETINTNUMBER
                    (MATERIAL_TYPE, INDUSTRY_SECTOR, REQUIRED_NUMBERS = 1; table MATERIAL_NUMBER-MATERIAL). An internal
                    number is drawn before the simulation (the simulation needs one): a refused simulation leaves a
                    gap in the number range, never a material.
  business_partner  BAPI_BUPA_CREATE_FROM_DATA: PARTNERCATEGORY, PARTNERGROUP, BUSINESSPARTNEREXTERN, CENTRALDATA,
                    CENTRALDATAPERSON / ORGANIZATION / GROUP, ADDRESSDATA (exporting BUSINESSPARTNER); roles named in
                    BUT100.RLTYP by BAPI_BUPA_ROLE_ADD_2 (BUSINESSPARTNER, BUSINESSPARTNERROLE), or BAPI_BUPA_ROLE_ADD
                    on releases without it; the address by BAPI_BUPA_ADDRESS_ADD where the create BAPI has no
                    ADDRESSDATA on this release.
  customer, vendor  the business partner path under customer/vendor integration (CVI): a partner with the role FLCU00
                    (customer) or FLVN00 (vendor), whose general data CVI synchronises to KNA1 / LFA1 in the same LUW;
                    after the commit the customer or vendor number is read from CVI_CUST_LINK / CVI_VEND_LINK. Sales
                    area, company code and purchasing data (KNVV, KNB1, LFB1, LFM1, bank details) are maintained by
                    the CVI classes, which are not remote-enabled: those fields go with the export.

The function, parameter, structure and field names follow SAP's interface documentation. None is taken on trust: steps
2 and 3 check each against the connected system before anything is sent. Logs carry the BAPI, the object and message
types, never a field value.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Optional

from .base import BAPICall, SAPConnectorError
from .bapi_writeback import (
    COMMIT, MATERIAL, ROLLBACK, _lit, _rows, _ReadFailed, build_calls, failed, function_exists, read_interface,
    return_messages, verify_params,
)

logger = logging.getLogger("meridian.sap.create")

GETINTNUMBER = "BAPI_MATERIAL_GETINTNUMBER"
SAVEDATA = "BAPI_MATERIAL_SAVEDATA"
BP_CREATE = "BAPI_BUPA_CREATE_FROM_DATA"
ROLE_ADD_2 = "BAPI_BUPA_ROLE_ADD_2"
ROLE_ADD = "BAPI_BUPA_ROLE_ADD"
ADDRESS_ADD = "BAPI_BUPA_ADDRESS_ADD"

OBJECTS = ("material", "business_partner", "customer", "vendor")
MODULE_OF = {"material": "material_master", "business_partner": "business_partner",
             "customer": "sd_customer_master", "vendor": "accounts_payable"}
CVI_ROLE = {"customer": "FLCU00", "vendor": "FLVN00"}
CVI_LINK = {"customer": ("CVI_CUST_LINK", "CUSTOMER", "KUNNR"), "vendor": ("CVI_VEND_LINK", "VENDOR", "LIFNR")}

# ── material ──────────────────────────────────────────────────────────────────
# Key fields of the material's structures, read from the proposal (never sent as fields of their own).
MATERIAL_KEYS = {"MARC.WERKS": "WERKS", "MBEW.BWKEY": "BWKEY", "MBEW.BWTAR": "BWTAR", "MVKE.VKORG": "VKORG",
                 "MVKE.VTWEG": "VTWEG", "MARM.MEINH": "MEINH", "MAKT.SPRAS": "SPRAS"}
MATERIAL_HEAD = {"MARA.MTART": "MATL_TYPE", "MARA.MBRSH": "IND_SECTOR"}
MATERIAL_REQUIRED = ("MARA.MTART", "MARA.MBRSH", "MARA.MEINS", "MAKT.MAKTX", "MAKT.SPRAS")

# ── business partner ──────────────────────────────────────────────────────────
# proposal field -> (create BAPI parameter, structure field or None for a scalar parameter)
BP_FIELDS: dict[str, tuple[str, Optional[str]]] = {
    "BUT000.TYPE": ("PARTNERCATEGORY", None), "BUT000.BU_GROUP": ("PARTNERGROUP", None),
    "BUT000.PARTNER": ("BUSINESSPARTNEREXTERN", None),
    "BUT000.BU_SORT1": ("CENTRALDATA", "SEARCHTERM1"), "BUT000.BU_SORT2": ("CENTRALDATA", "SEARCHTERM2"),
    "BUT000.TITLE": ("CENTRALDATA", "TITLE_KEY"),
    "BUT000.NAME_FIRST": ("CENTRALDATAPERSON", "FIRSTNAME"), "BUT000.NAME_LAST": ("CENTRALDATAPERSON", "LASTNAME"),
    "BUT000.BIRTHDT": ("CENTRALDATAPERSON", "BIRTHDATE"), "BUT000.NATIO": ("CENTRALDATAPERSON", "NATIONALITY"),
    "BUT000.LANGU_CORR": ("CENTRALDATAPERSON", "CORRESPONDLANGUAGE"),
    "BUT000.NAME_ORG1": ("CENTRALDATAORGANIZATION", "NAME1"), "BUT000.NAME_ORG2": ("CENTRALDATAORGANIZATION", "NAME2"),
    "BUT000.NAME_ORG3": ("CENTRALDATAORGANIZATION", "NAME3"), "BUT000.NAME_ORG4": ("CENTRALDATAORGANIZATION", "NAME4"),
    "BUT000.NAME_GRP1": ("CENTRALDATAGROUP", "NAMEGROUP1"),
    "ADRC.COUNTRY": ("ADDRESSDATA", "COUNTRY"), "ADRC.REGION": ("ADDRESSDATA", "REGION"),
    "ADRC.LANGU": ("ADDRESSDATA", "LANGU"), "ADRC.CITY1": ("ADDRESSDATA", "CITY"),
    "ADRC.POST_CODE1": ("ADDRESSDATA", "POSTL_COD1"), "ADRC.STREET": ("ADDRESSDATA", "STREET"),
    "ADRC.HOUSE_NUM1": ("ADDRESSDATA", "HOUSE_NO"),
}
# The general data of a customer or vendor, held by its business partner under CVI.
_GENERAL = {"NAME1": "BUT000.NAME_ORG1", "NAME2": "BUT000.NAME_ORG2", "NAME3": "BUT000.NAME_ORG3",
            "NAME4": "BUT000.NAME_ORG4", "SORTL": "BUT000.BU_SORT1", "LAND1": "ADRC.COUNTRY", "REGIO": "ADRC.REGION",
            "ORT01": "ADRC.CITY1", "PSTLZ": "ADRC.POST_CODE1", "STRAS": "ADRC.STREET", "SPRAS": "ADRC.LANGU"}
CVI_ALIASES: dict[str, dict[str, str]] = {
    "customer": {f"KNA1.{k}": v for k, v in _GENERAL.items()},
    "vendor": {f"LFA1.{k}": v for k, v in _GENERAL.items()},
}
CVI_EXPORT_REASON = {
    "customer": ("Sales area and company code data of a customer (KNVV, KNB1) are maintained by the CVI classes "
                 "(CMD_EI_API), which are not remote-enabled; Meridian exports a load file for them"),
    "vendor": ("Company code, purchasing and bank data of a vendor (LFB1, LFM1, LFBK) are maintained by the CVI "
               "classes (VMD_EI_API), which are not remote-enabled; Meridian exports a load file for them"),
}
ROLE_FIELD = "BUT100.RLTYP"


@dataclass
class CreatePlan:
    object: str
    fields: dict[str, Any]                          # TABLE.FIELD -> value the create path carries
    export: list[dict] = field(default_factory=list)  # [{field, reason}] going with the load file instead
    problems: list[str] = field(default_factory=list)  # required fields missing: nothing can be created
    roles: list[str] = field(default_factory=list)   # business partner roles to add
    keys: dict[str, str] = field(default_factory=dict)  # material structure keys (WERKS, SPRAS, ...)

    def as_dict(self) -> dict:
        return {"object": self.object, "fields": sorted(self.fields), "export": self.export, "problems": self.problems,
                "roles": self.roles}


@dataclass
class CreateResult:
    object: str
    key: Optional[str] = None                        # MATNR=... / PARTNER=...[|KUNNR=...|LIFNR=...]
    bapis: list[str] = field(default_factory=list)
    simulated: bool = False
    simulate_messages: list[dict] = field(default_factory=list)
    applied: bool = False
    committed: bool = False
    messages: list[dict] = field(default_factory=list)
    error: Optional[str] = None
    unavailable: Optional[str] = None                # the create path is not on this release: export, and why
    export: list[dict] = field(default_factory=list)
    note: Optional[str] = None

    def as_dict(self) -> dict:
        return {"object": self.object, "key": self.key, "bapis": self.bapis, "simulated": self.simulated,
                "simulate_messages": self.simulate_messages, "applied": self.applied, "committed": self.committed,
                "messages": self.messages, "error": self.error, "unavailable": self.unavailable,
                "export": self.export, "note": self.note}


def _up(f: str) -> str:
    return str(f).strip().upper()


def plan_create(obj: str, payload: dict[str, Any]) -> CreatePlan:
    """Which proposed fields the create path carries, which go with the export and why, what is missing. Never
    contacts SAP."""
    if obj not in OBJECTS:
        raise ValueError(f"unknown object {obj}")
    values = {_up(k): v for k, v in payload.items() if v not in (None, "")}
    plan = CreatePlan(object=obj, fields={})
    if obj == "material":
        for f, v in values.items():
            if f in MATERIAL_KEYS:
                plan.keys[MATERIAL_KEYS[f]] = str(v)
            elif f in MATERIAL_HEAD or f == "MARA.MATNR" or f in MATERIAL.fields:
                plan.fields[f] = v
            else:
                plan.export.append({"field": f, "reason": f"No create mapping for {f} in {SAVEDATA}; it goes with "
                                                          "the load file"})
        plan.problems = [f"{f} is required to create a material" for f in MATERIAL_REQUIRED if f not in values]
        return plan
    aliases = CVI_ALIASES.get(obj, {})
    for f, v in values.items():
        if f == ROLE_FIELD:
            plan.roles = [r.strip().upper() for r in str(v).replace(";", ",").split(",") if r.strip()]
            continue
        target = aliases.get(f, f)
        if target in BP_FIELDS:
            plan.fields[target] = v
        elif obj in CVI_EXPORT_REASON and f.split(".")[0] not in ("BUT000", "ADRC"):
            plan.export.append({"field": f, "reason": CVI_EXPORT_REASON[obj]})
        else:
            plan.export.append({"field": f, "reason": f"No create mapping for {f} in {BP_CREATE}; it goes with the "
                                                      "load file"})
    if obj in CVI_ROLE:
        plan.fields.setdefault("BUT000.TYPE", "2")
        if CVI_ROLE[obj] not in plan.roles:
            plan.roles.insert(0, CVI_ROLE[obj])
    if "BUT000.TYPE" not in plan.fields:
        plan.problems.append("BUT000.TYPE (1 person, 2 organisation, 3 group) is required to create a business "
                             "partner")
    elif str(plan.fields["BUT000.TYPE"]) == "1" and "BUT000.NAME_LAST" not in plan.fields:
        plan.problems.append("BUT000.NAME_LAST is required to create a person")
    elif str(plan.fields["BUT000.TYPE"]) == "2" and "BUT000.NAME_ORG1" not in plan.fields:
        plan.problems.append(f"{'KNA1.NAME1' if obj == 'customer' else 'LFA1.NAME1' if obj == 'vendor' else 'BUT000.NAME_ORG1'} "
                             "is required to create an organisation")
    return plan


# ── building the calls ────────────────────────────────────────────────────────


def material_call(plan: CreatePlan, number: str) -> dict:
    """BAPI_MATERIAL_SAVEDATA parameters for a new material with number ``number``."""
    keys = {"MATNR": number, **plan.keys}
    if "BWKEY" not in keys and "WERKS" in keys:
        keys["BWKEY"] = keys["WERKS"]
    keys.setdefault("BWTAR", "")
    if "MEINH" not in keys and "MARA.MEINS" in plan.fields:
        keys["MEINH"] = str(plan.fields["MARA.MEINS"])
    record_key = "|".join(f"{k}={v}" for k, v in keys.items())
    changes = {f: v for f, v in plan.fields.items() if f in MATERIAL.fields}
    params = build_calls("material_master", record_key, changes).get(SAVEDATA, {}) if changes else {}
    head = params.setdefault("HEADDATA", {})
    head["MATERIAL"] = number
    for f, hf in MATERIAL_HEAD.items():
        if f in plan.fields:
            head[hf] = str(plan.fields[f])
    head.setdefault("BASIC_VIEW", "X")
    return params


def bp_call(plan: CreatePlan, addressdata: bool = True) -> tuple[dict, dict]:
    """(BAPI_BUPA_CREATE_FROM_DATA parameters, ADDRESSDATA for a separate address call when ``addressdata`` is
    False)."""
    p: dict[str, Any] = {}
    address: dict[str, str] = {}
    for f, v in plan.fields.items():
        param, sf = BP_FIELDS[f]
        val = str(v).replace("-", "")[:8] if f == "BUT000.BIRTHDT" else str(v)
        if sf is None:
            p[param] = val
        elif param == "ADDRESSDATA" and not addressdata:
            address[sf] = val
        else:
            p.setdefault(param, {})[sf] = val
    return p, address


# ── running a create ──────────────────────────────────────────────────────────


def _call(conn: Any, bapi: str, params: dict) -> dict:
    r = conn.execute_bapi(BAPICall(bapi, params))
    return r if isinstance(r, dict) else {}


def _verify(conn: Any, calls: list[tuple[str, dict]], cache: dict) -> list[str]:
    problems: list[str] = []
    for bapi, params in calls:
        problems += verify_params(conn, bapi, params, cache)
    return problems


def _missing_functions(conn: Any, names: list[str], cache: dict) -> list[str]:
    return [n for n in names if not function_exists(conn, n, cache)]


Phase = Callable[[str], None]


def create(conn: Any, obj: str, payload: dict[str, Any], *, on_phase: Optional[Phase] = None,
           cache: Optional[dict] = None) -> CreateResult:
    """Simulate, then create one record. ``on_phase`` is told "committing" just before the commit is sent and
    "committed" after (the caller persists it, so a retry never creates twice). See the module docstring."""
    cache = {} if cache is None else cache
    plan = plan_create(obj, payload)
    res = CreateResult(object=obj, export=list(plan.export))
    if plan.problems:
        res.error = "; ".join(plan.problems)
        return res
    phase = on_phase or (lambda _p: None)
    try:
        if obj == "material":
            return _create_material(conn, plan, res, phase, cache)
        return _create_partner(conn, obj, plan, res, phase, cache)
    except SAPConnectorError as e:
        res.error = str(e)
        logger.warning("create %s: connector error (%s)", obj, type(e).__name__)
        return res


def _simulate(conn: Any, bapi: str, params: dict, cache: dict, res: CreateResult) -> dict:
    iface = read_interface(conn, bapi, cache)
    if "TESTRUN" in iface.params:
        out = _call(conn, bapi, {**params, "TESTRUN": "X"})
    else:
        out = _call(conn, bapi, params)
        _call(conn, ROLLBACK, {})
    res.simulate_messages += return_messages(out)
    return out


def _commit(conn: Any, res: CreateResult, phase: Phase) -> None:
    if failed(res.messages):
        _call(conn, ROLLBACK, {})
        logger.info("create %s: rolled back (%s)", res.object, ",".join(sorted({m["type"] for m in res.messages})))
        return
    phase("committing")
    commit = return_messages(_call(conn, COMMIT, {"WAIT": "X"}))
    res.messages += commit
    res.committed = not failed(commit)
    if res.committed:
        phase("committed")
    logger.info("create %s via %s: %s", res.object, ",".join(res.bapis), "committed" if res.committed else
                "commit failed")


def _create_material(conn: Any, plan: CreatePlan, res: CreateResult, phase: Phase, cache: dict) -> CreateResult:
    external = str(plan.fields.get("MARA.MATNR") or "").strip()
    needed = [SAVEDATA] + ([] if external else [GETINTNUMBER])
    missing = _missing_functions(conn, needed, cache)
    if missing:
        res.unavailable = f"{', '.join(missing)} is not available on this system; Meridian exports a load file"
        return res
    num_params = {"MATERIAL_TYPE": str(plan.fields["MARA.MTART"]), "INDUSTRY_SECTOR": str(plan.fields["MARA.MBRSH"]),
                  "REQUIRED_NUMBERS": 1}
    probe = material_call(plan, external or "0")
    problems = _verify(conn, [(SAVEDATA, probe)] + ([] if external else [(GETINTNUMBER, num_params)]), cache)
    if problems:
        res.error = "; ".join(problems)
        return res
    if external:
        number = external
    else:
        res.bapis.append(GETINTNUMBER)
        out = _call(conn, GETINTNUMBER, num_params)
        msgs = return_messages(out)
        rows = out.get("MATERIAL_NUMBER") or []
        number = str((rows[0] if rows else {}).get("MATERIAL", "")).strip()
        if failed(msgs) or not number:
            res.simulate_messages += msgs
            res.error = "SAP gave no internal material number for this material type and industry sector"
            return res
    res.key = f"MATNR={number}"
    params = material_call(plan, number)
    res.bapis.append(SAVEDATA)
    _simulate(conn, SAVEDATA, params, cache, res)
    res.simulated = True
    if failed(res.simulate_messages):
        res.key = None
        logger.info("create material: simulation refused (%s)", ",".join(sorted({m["type"] for m in res.simulate_messages})))
        return res
    res.messages += return_messages(_call(conn, SAVEDATA, params))
    res.applied = True
    _commit(conn, res, phase)
    if not res.committed:
        res.key = None
    return res


def _role_bapi(conn: Any, cache: dict) -> Optional[str]:
    for name in (ROLE_ADD_2, ROLE_ADD):
        if function_exists(conn, name, cache):
            return name
    return None


def _cvi_number(conn: Any, obj: str, partner: str) -> Optional[str]:
    """The customer or vendor CVI created for the partner (read after the commit), or None when not readable."""
    table, col, _ = CVI_LINK[obj]
    try:
        bp = _rows(conn, "BUT000", ["PARTNER_GUID"], f"PARTNER = {_lit(partner)}")
        if not bp or not bp[0].get("PARTNER_GUID"):
            return None
        link = _rows(conn, table, [col], f"PARTNER_GUID = {_lit(bp[0]['PARTNER_GUID'])}")
    except _ReadFailed:
        return None
    return link[0].get(col) or None if link else None


def _create_partner(conn: Any, obj: str, plan: CreatePlan, res: CreateResult, phase: Phase,
                    cache: dict) -> CreateResult:
    if not function_exists(conn, BP_CREATE, cache):
        res.unavailable = (f"{BP_CREATE} is not available on this system" + (
            " (no business partner, so no customer/vendor integration)" if obj in CVI_ROLE else "")
            + "; Meridian exports a load file")
        return res
    role_bapi = _role_bapi(conn, cache) if plan.roles else None
    if plan.roles and role_bapi is None:
        res.unavailable = (f"Neither {ROLE_ADD_2} nor {ROLE_ADD} is available on this system, so the role "
                           f"{', '.join(plan.roles)} cannot be given; Meridian exports a load file")
        return res
    iface = read_interface(conn, BP_CREATE, cache)
    has_address = "ADDRESSDATA" in iface.params
    params, address = bp_call(plan, addressdata=has_address)
    if address and not function_exists(conn, ADDRESS_ADD, cache):
        for f in [f for f in plan.fields if BP_FIELDS[f][0] == "ADDRESSDATA"]:
            res.export.append({"field": f, "reason": f"{BP_CREATE} takes no address on this release and "
                                                     f"{ADDRESS_ADD} is not available; it goes with the load file"})
        address = {}
    calls = [(BP_CREATE, params)]
    calls += [(ADDRESS_ADD, {"BUSINESSPARTNER": "0", "ADDRESSDATA": address})] if address else []
    role_param = {ROLE_ADD_2: "BUSINESSPARTNERROLE", ROLE_ADD: "BUSINESSPARTNERROLE"}
    calls += [(role_bapi, {"BUSINESSPARTNER": "0", role_param[role_bapi]: r}) for r in plan.roles] if role_bapi else []
    problems = _verify(conn, calls, cache)
    if problems:
        res.error = "; ".join(problems)
        return res
    res.bapis = sorted({b for b, _ in calls})
    # simulate: the create (the role and address calls need the partner, so their check is the interface above)
    _simulate(conn, BP_CREATE, params, cache, res)
    res.simulated = True
    if failed(res.simulate_messages):
        logger.info("create %s: simulation refused (%s)", obj, ",".join(sorted({m["type"] for m in res.simulate_messages})))
        return res
    out = _call(conn, BP_CREATE, params)
    res.messages += return_messages(out)
    res.applied = True
    partner = str(out.get("BUSINESSPARTNER") or "").strip()
    if not failed(res.messages) and not partner:
        res.messages.append({"type": "E", "id": "", "number": "", "message": f"{BP_CREATE} returned no partner number"})
    if not failed(res.messages):
        for bapi, p in calls[1:]:
            res.messages += return_messages(_call(conn, bapi, {**p, "BUSINESSPARTNER": partner}))
            if failed(res.messages):
                break
    _commit(conn, res, phase)
    if res.committed:
        res.key = f"PARTNER={partner}"
        if obj in CVI_LINK:
            number = _cvi_number(conn, obj, partner)
            if number:
                res.key += f"|{CVI_LINK[obj][2]}={number}"
            else:
                res.note = (f"Business partner {partner} was created with the role {CVI_ROLE[obj]}; Meridian could "
                            f"not read the {obj} number from {CVI_LINK[obj][0]} (the RFC user needs read access)")
    return res
