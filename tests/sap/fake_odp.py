"""A fake SAP that serves ODP providers through RODPS_REPL_ODP_GET_DETAIL / OPEN / FETCH / CLOSE.

It records every call, answers RFC_GET_FUNCTION_INTERFACE with the interface Meridian expects (or a changed one),
and returns each provider's rows in packages of ``package_rows`` rows, either as structured rows or as character
lines laid out by the field lengths. Anything not ODP falls through to the RFC_READ_TABLE fake.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from sap.odp import FN_CLOSE, FN_DETAIL, FN_FETCH, FN_OPEN, ODP_FUNCTIONS
from tests.sap.fake_rfc import FakeConnection, FakeRFCError

INTERFACES: dict[str, list[tuple[str, str, bool]]] = {  # (parameter, class, optional)
    FN_DETAIL: [("I_SUBSCRIBER_TYPE", "I", False), ("I_CONTEXT", "I", False), ("I_ODPNAME", "I", False),
                ("ET_FIELDS", "T", False), ("ET_SEGMENTS", "T", True)],
    FN_OPEN: [("I_SUBSCRIBER_TYPE", "I", False), ("I_SUBSCRIBER_NAME", "I", False),
              ("I_SUBSCRIBER_PROCESS", "I", True), ("I_CONTEXT", "I", False), ("I_ODPNAME", "I", False),
              ("I_EXTRACTION_MODE", "I", False), ("I_MAXPACKAGESIZE", "I", True), ("E_POINTER", "E", False)],
    FN_FETCH: [("I_POINTER", "I", False), ("I_MAXPACKAGESIZE", "I", True), ("ET_DATA", "T", False),
               ("E_NO_MORE_DATA", "E", False)],
    FN_CLOSE: [("I_POINTER", "I", False)],
}


@dataclass
class Provider:
    fields: list[tuple[str, int, bool]]           # (name, length, key)
    rows: pd.DataFrame
    package_rows: int = 2
    character: bool = False                       # rows as fixed-width lines in DATA instead of structures
    binary: bool = False                          # rows as bytes (a compressed package format)


@dataclass
class ODPState:
    providers: dict[tuple[str, str], Provider] = field(default_factory=dict)
    missing: set[str] = field(default_factory=set)        # functions this system does not have
    interfaces: dict[str, list[tuple[str, str, bool]]] = field(default_factory=lambda: dict(INTERFACES))
    open_pointers: dict[str, list] = field(default_factory=dict)
    closed: list[str] = field(default_factory=list)


class ODPConnection(FakeConnection):
    def __init__(self, tables: dict[str, pd.DataFrame], state: ODPState, release: str = "ecc6"):
        super().__init__(tables, release)
        self.odp = state

    def odp_calls(self) -> list[str]:
        return [fm for fm, _ in self.calls if fm.startswith("RODPS_REPL")]

    def _call(self, fm: str, **p):
        s = self.odp
        if fm == "RFC_FUNCTION_SEARCH":
            self.calls.append((fm, p))
            name = p["FUNCNAME"]
            return {"FUNCTIONS": [] if name in s.missing or name not in ODP_FUNCTIONS else [{"FUNCNAME": name}]}
        if fm == "RFC_GET_FUNCTION_INTERFACE":
            self.calls.append((fm, p))
            if p["FUNCNAME"] in s.missing or p["FUNCNAME"] not in s.interfaces:
                raise FakeRFCError(f"FU_NOT_FOUND {p['FUNCNAME']}")
            return {"PARAMS": [{"PARAMCLASS": c, "PARAMETER": n, "OPTIONAL": "X" if o else ""}
                               for n, c, o in s.interfaces[p["FUNCNAME"]]]}
        if fm in ODP_FUNCTIONS:
            self.calls.append((fm, p))
            if fm in s.missing:
                raise FakeRFCError(f"FU_NOT_FOUND {fm}")
            known = {n for n, _, _ in s.interfaces[fm]}
            unknown = set(p) - known
            if unknown:
                raise FakeRFCError(f"CALL_FUNCTION_PARM_UNKNOWN {sorted(unknown)}")
            return getattr(self, "_" + fm.rsplit("_", 1)[1].lower())(**p)
        return super()._call(fm, **p)

    def _provider(self, p) -> Provider:
        prov = self.odp.providers.get((p["I_CONTEXT"], p["I_ODPNAME"]))
        if prov is None:
            raise FakeRFCError(f"ODP {p['I_ODPNAME']} not found in context {p['I_CONTEXT']}")
        return prov

    def _detail(self, **p):
        prov = self._provider(p)
        return {"ET_FIELDS": [{"NAME": n, "TYPE": "CHAR", "LENGTH": w, "OUTPUTLENG": w, "KEYFLAG": "X" if k else ""}
                              for n, w, k in prov.fields], "ET_SEGMENTS": []}

    def _open(self, **p):
        assert p["I_EXTRACTION_MODE"] == "F", "full extraction only"
        prov = self._provider(p)
        pointer = f"P{len(self.odp.open_pointers) + 1:04d}"
        records = prov.rows.to_dict(orient="records")
        packages = [records[i:i + prov.package_rows] for i in range(0, len(records), prov.package_rows)] or [[]]
        self.odp.open_pointers[pointer] = [prov, packages]
        return {"E_POINTER": pointer}

    def _fetch(self, I_POINTER, **_):
        prov, packages = self.odp.open_pointers[I_POINTER]
        if I_POINTER in self.odp.closed:
            raise FakeRFCError("pointer closed")
        rows = packages.pop(0) if packages else []
        names = [n for n, _, _ in prov.fields]
        if prov.binary:
            data = [{"DATA": b"\x78\x9c" + str(r).encode()} for r in rows]
        elif prov.character:
            data = [{"DATA": "".join(str(r.get(n, "")).ljust(w)[:w] for n, w, _ in prov.fields)} for r in rows]
        else:
            data = [{n: r.get(n, "") for n in names} for r in rows]
        return {"ET_DATA": data, "E_NO_MORE_DATA": "" if packages else "X"}

    def _close(self, I_POINTER):
        self.odp.closed.append(I_POINTER)
        return {}
