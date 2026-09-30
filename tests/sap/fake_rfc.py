"""In-memory stand-in for a pyrfc Connection (RFC_READ_TABLE semantics).

Enforces what makes real RFC extraction hard: the 512-byte work area
(DATA_BUFFER_EXCEEDED), ROWSKIPS/ROWCOUNT paging, OPTIONS lines of ≤72 chars,
and FIELD_NOT_VALID for fields the table does not have. Field lengths come
from the bundled SAP dictionary.
"""

from __future__ import annotations

import re

import pandas as pd

from sap.ddic import get_dictionary


class FakeRFCError(Exception):
    pass


class FakeConnection:
    def __init__(self, tables: dict[str, pd.DataFrame], release: str = "ecc6"):
        self.tables = tables
        self.dictionary = get_dictionary(release)
        self.calls: list[tuple[str, dict]] = []

    def close(self):
        pass

    def call(self, fm: str, **p):
        self.calls.append((fm, p))
        if fm == "RFC_READ_TABLE":
            return self._read(**p)
        if fm == "RFC_SYSTEM_INFO":
            return {"RFCSI_EXPORT": {"RFCSAPRL": "750", "RFCSYSID": "KPR", "RFCHOST": "sapkpr", "RFCDBSYS": "ORACLE"}}
        if fm == "DDIF_FIELDINFO_GET":
            t = self.dictionary.table(p["TABNAME"])
            if t is None:
                raise FakeRFCError("NOT_FOUND")
            return {"DFIES_TAB": [
                {"FIELDNAME": f.name, "POSITION": i + 1, "KEYFLAG": "X" if f.key else "",
                 "ROLLNAME": f.data_element or "", "DOMNAME": f.domain or "", "DATATYPE": f.type or "",
                 "LENG": f.length, "DECIMALS": f.decimals, "CHECKTABLE": f.check_table or "",
                 "LOWERCASE": "X" if f.lowercase else "", "CONVEXIT": f.conversion_exit or "",
                 "FIELDTEXT": f.description, "VALEXI": "X" if f.fixed_values else ""}
                for i, f in enumerate(t.fields.values())]}
        raise FakeRFCError(f"FU_NOT_FOUND {fm}")

    def _width(self, table: str, field: str) -> int:
        f = self.dictionary.field(table, field)
        if f is None:
            raise FakeRFCError(f"FIELD_NOT_VALID {field}")
        return f.length + (f.decimals + 2 if (f.type or "") in ("DEC", "CURR", "QUAN") else 0)

    def _read(self, QUERY_TABLE, FIELDS=(), OPTIONS=(), ROWCOUNT=0, ROWSKIPS=0, NO_DATA="", **_):
        df = self.tables.get(QUERY_TABLE)
        if df is None:
            raise FakeRFCError("TABLE_NOT_AVAILABLE")
        names = [f["FIELDNAME"] for f in FIELDS]
        widths = [self._width(QUERY_TABLE, n) for n in names]
        if sum(widths) > 512:
            raise FakeRFCError("DATA_BUFFER_EXCEEDED")
        for o in OPTIONS:
            assert len(o["TEXT"]) <= 72, "OPTIONS line longer than 72 characters"
        meta, off = [], 0
        for n, w in zip(names, widths):
            meta.append({"FIELDNAME": n, "OFFSET": off, "LENGTH": w, "TYPE": "C"})
            off += w
        if NO_DATA == "X":
            return {"FIELDS": meta, "DATA": []}
        sel = _filter(df, " ".join(o["TEXT"] for o in OPTIONS))
        sel = sel.iloc[ROWSKIPS:]
        if ROWCOUNT:
            sel = sel.iloc[:ROWCOUNT]
        data = [{"WA": "".join(str(r.get(n, "") or "").ljust(w)[:w] for n, w in zip(names, widths))}
                for r in sel.to_dict(orient="records")]
        return {"FIELDS": meta, "DATA": data}


def _filter(df: pd.DataFrame, where: str) -> pd.DataFrame:
    if not where.strip():
        return df
    mask = pd.Series(True, index=df.index)
    for cond in re.split(r"\s+AND\s+", where.strip()):
        m = re.fullmatch(r"(\w+)\s+IN\s+\(\s*(.*?)\s*\)", cond)
        if m:
            vals = [v.strip().strip("'") for v in m.group(2).split(",")]
            mask &= df[m.group(1)].astype(str).isin(vals)
            continue
        m = re.fullmatch(r"(\w+)\s*(=|>=|<=|>|<)\s*'(.*)'", cond)
        if m:
            col, op, val = m.groups()
            s = df[col].astype(str).str.strip() if col in df else pd.Series("", index=df.index)
            val = val.strip()
            mask &= {"=": s == val, ">=": s >= val, "<=": s <= val, ">": s > val, "<": s < val}[op]
            continue
        m = re.fullmatch(r"(\w+)\s+LIKE\s+'(.*)'", cond)
        if m:
            mask &= df[m.group(1)].astype(str).str.match("^" + m.group(2).replace("%", ".*") + "$")
            continue
        raise AssertionError(f"fake RFC cannot parse condition: {cond}")
    return df[mask]


class FakeRFCConnector:
    """RFCConnector with the fake connection injected (no pyrfc needed)."""

    def __new__(cls, tables, release="ecc6"):
        from sap.rfc import RFCConnector
        c = RFCConnector()
        c._conn = FakeConnection(tables, release)
        return c
