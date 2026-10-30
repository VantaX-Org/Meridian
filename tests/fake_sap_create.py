"""A fake RFC connector for the create paths (sap/bapi_create.py): it answers RFC_FUNCTION_SEARCH,
RFC_GET_FUNCTION_INTERFACE and DDIF_FIELDINFO_GET from the interfaces below (as SAP documents them), each BAPI with a
configurable RETURN, and read_table for the CVI lookups. It records every call. No live SAP."""
from __future__ import annotations

from typing import Any, Optional

import pandas as pd

from sap import bapi_create as bc
from sap import bapi_writeback as bw

_MAT_STRUCTS: dict[str, set[str]] = {}
for _t in bw.MATERIAL.fields.values():
    for _p in (_t.param, _t.xparam):
        if _p:
            _MAT_STRUCTS.setdefault(_p, set()).update({_t.field, *[sf for _, sf in _t.keys]})
_MAT_STRUCTS.setdefault("HEADDATA", set()).update({"MATERIAL", "MATL_TYPE", "IND_SECTOR", "BASIC_VIEW", "MRP_VIEW",
                                                   "ACCOUNT_VIEW", "SALES_VIEW"})

_BP_STRUCTS: dict[str, set[str]] = {}
_BP_SCALARS: set[str] = set()
for _param, _sf in bc.BP_FIELDS.values():
    if _sf is None:
        _BP_SCALARS.add(_param)
    else:
        _BP_STRUCTS.setdefault(_param, set()).add(_sf)


def interfaces(testrun: bool = True, bp_address: bool = True) -> dict[str, dict[str, tuple[str, Optional[set[str]], bool]]]:
    """bapi -> {parameter: (class, structure fields or None, optional)}"""
    mat = {p: ("I" if p != "UNITSOFMEASURE" and p != "UNITSOFMEASUREX" and p != "MATERIALDESCRIPTION" else "T", f, p != "HEADDATA")
           for p, f in _MAT_STRUCTS.items()}
    mat["RETURN"] = ("E", None, True)
    bp = {p: ("I", f, True) for p, f in _BP_STRUCTS.items() if bp_address or p != "ADDRESSDATA"}
    bp.update({p: ("I", None, p != "PARTNERCATEGORY") for p in _BP_SCALARS})
    bp.update({"BUSINESSPARTNER": ("E", None, True), "RETURN": ("T", None, True)})
    out = {
        bc.SAVEDATA: mat,
        bc.GETINTNUMBER: {"MATERIAL_TYPE": ("I", None, False), "INDUSTRY_SECTOR": ("I", None, False),
                          "REQUIRED_NUMBERS": ("I", None, True), "RETURN": ("E", None, True),
                          "MATERIAL_NUMBER": ("T", None, True)},
        bc.BP_CREATE: bp,
        bc.ROLE_ADD_2: {"BUSINESSPARTNER": ("I", None, False), "BUSINESSPARTNERROLE": ("I", None, True),
                        "RETURN": ("T", None, True)},
        bc.ROLE_ADD: {"BUSINESSPARTNER": ("I", None, False), "BUSINESSPARTNERROLE": ("I", None, False),
                      "RETURN": ("T", None, True)},
        bc.ADDRESS_ADD: {"BUSINESSPARTNER": ("I", None, False), "ADDRESSDATA": ("I", set(_BP_STRUCTS["ADDRESSDATA"]), True),
                         "RETURN": ("T", None, True)},
    }
    if testrun:
        out[bc.SAVEDATA]["TESTRUN"] = ("I", None, True)
        out[bc.BP_CREATE]["TESTRUN"] = ("I", None, True)
    return out


OK = {"TYPE": "S", "ID": "BP", "NUMBER": "000", "MESSAGE": "ok"}


class FakeSAP:
    def __init__(self, testrun: bool = True, missing: tuple[str, ...] = (), returns: Optional[dict] = None,
                 sim_returns: Optional[dict] = None, drop: tuple[tuple[str, str], ...] = (), bp_address: bool = True,
                 number: str = "000000000000004711", partner: str = "0000100042", cvi: Optional[str] = "0000200077"):
        self.calls: list[tuple[str, dict]] = []
        self.ifaces = interfaces(testrun, bp_address)
        for bapi, field in drop:  # a field this release lacks: (BAPI, "PARAM.FIELD")
            p, f = field.split(".")
            self.ifaces[bapi][p][1].discard(f)
        self.missing = set(missing)
        self.returns = returns or {}
        self.sim_returns = sim_returns or {}
        self.number, self.partner, self.cvi = number, partner, cvi
        self.testrun = testrun
        self._sim_seen: set[str] = set()
        self.connect = lambda params: None

    # context manager like sap.get_connector()
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute_bapi(self, call) -> dict:
        name, params = call.bapi_name, call.params
        self.calls.append((name, params))
        if name == "RFC_FUNCTION_SEARCH":
            fn = params["FUNCNAME"]
            return {"FUNCTIONS": [] if fn in self.missing else [{"FUNCNAME": fn}]}
        if name == "RFC_GET_FUNCTION_INTERFACE":
            fm = params["FUNCNAME"]
            if fm in self.missing or fm not in self.ifaces:
                return {"PARAMS": []}
            return {"PARAMS": [{"PARAMETER": p, "PARAMCLASS": c, "TABNAME": f"T_{fm}_{p}" if f is not None else "",
                                "OPTIONAL": "X" if opt else ""} for p, (c, f, opt) in self.ifaces[fm].items()]}
        if name == "DDIF_FIELDINFO_GET":
            tab = params["TABNAME"]
            for fm, ps in self.ifaces.items():
                for p, (_, f, _) in ps.items():
                    if f is not None and tab == f"T_{fm}_{p}":
                        return {"DFIES_TAB": [{"FIELDNAME": x} for x in sorted(f)]}
            return {"DFIES_TAB": []}
        if name in (bw.COMMIT, bw.ROLLBACK):
            return {"RETURN": {"TYPE": "", "MESSAGE": ""}}
        if name == bc.GETINTNUMBER:
            return {"MATERIAL_NUMBER": [{"MATERIAL": self.number}], "RETURN": {"TYPE": "", "MESSAGE": ""}}
        is_sim = params.get("TESTRUN") == "X" or (not self.testrun and name in (bc.SAVEDATA, bc.BP_CREATE)
                                                  and name not in self._sim_seen)
        if name in (bc.SAVEDATA, bc.BP_CREATE):
            self._sim_seen.add(name)
        ret = (self.sim_returns if is_sim else self.returns).get(name, OK)
        out: dict[str, Any] = {"RETURN": [ret] if name != bc.SAVEDATA else ret}
        if name == bc.BP_CREATE and not is_sim and ret.get("TYPE") not in ("E", "A"):
            out["BUSINESSPARTNER"] = self.partner
        return out

    def read_table(self, table, fields, where=None, max_rows=0):
        if table == "BUT000":
            return pd.DataFrame([{"PARTNER_GUID": "GUID-1"}])
        if table in ("CVI_CUST_LINK", "CVI_VEND_LINK"):
            col = "CUSTOMER" if table == "CVI_CUST_LINK" else "VENDOR"
            return pd.DataFrame([{col: self.cvi}] if self.cvi else [])
        raise RuntimeError("no such table")

    def names(self) -> list[str]:
        return [n for n, _ in self.calls
                if n not in ("RFC_GET_FUNCTION_INTERFACE", "DDIF_FIELDINFO_GET", "RFC_FUNCTION_SEARCH")]
