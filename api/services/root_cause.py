"""Root cause of a finding by origin: who set the failing values, how and when.

For each failing record of a check, the latest change document (CDPOS) for the
rule's field names the user, transaction and date. If that field was never
changed, the record's creation names them instead (CDPOS FNAME 'KEY', else
CDHDR CHANGE_IND 'I'). Origins:
  migration  created before the system's go-live and the field never changed
  interface  USR02.USTYP B (system) or S (service): an interface or batch user
  dialog     any other user, grouped by transaction
  unknown    no change document at all
Deterministic: the same SAP state gives the same answer. SAP is only read.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from dataclasses import field as _field
from functools import lru_cache
from typing import Callable, Optional

import pandas as pd

from sap.base import SAPConnectorError
from sap.change_documents import CDHDR_FIELDS, CDPOS_FIELDS, class_of
from sap.ddic import Dictionary

MAX_RECORDS = 5000  # ponytail: per check, first keys in sort order; stream the rest if a check needs every record
TOP = 5
INTERFACE_USER_TYPES = frozenset({"B", "S"})
_LABEL = {"interface": "interface/batch user", "dialog": "dialog user"}

Reader = Callable[[str, list[str], list[str]], pd.DataFrame]  # (table, fields, wheres) -> rows


@dataclass(frozen=True)
class Attribution:
    origin: str
    username: str
    tcode: str
    udate: str


@dataclass
class RootCause:
    check_id: str
    status: str  # computed · not_applicable · unavailable
    field: Optional[str] = None
    analysed: int = 0
    total: int = 0
    origins: list[dict[str, str | int | float]] = _field(default_factory=list)
    summary: str = ""
    detail: str = ""


@lru_cache(maxsize=1)
def _rule_fields() -> dict[tuple[str, str], str]:
    from api.services.tenant_seed import raw_rules

    return {(m, str(r["id"])): r["field"] for _, _, m, r in raw_rules() if isinstance(r.get("field"), str)}


def rule_field(module: str, check_id: str) -> Optional[str]:
    """The ``TABLE.FIELD`` a shipped rule checks, None for rules without one (generated, multi-field)."""
    return _rule_fields().get((module, check_id))


def parse_record_key(key: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in key.split("|") if "=" in p)


def tabkey(table: str, values: dict[str, str], dictionary: Dictionary) -> Optional[str]:
    """CDPOS.TABKEY of a record without its 3-character client, trailing blanks stripped.
    None when the record key lacks one of the table's DDIC keys."""
    t = dictionary.table(table)
    if t is None or any(k not in values for k in t.keys):
        return None
    return "".join(values[k].ljust(t.fields[k].length) for k in t.keys).rstrip()


def classify(username: str, udate: str, ustyp: str, created_only: bool, go_live: Optional[str]) -> str:
    if not username:
        return "unknown"
    if created_only and go_live and udate < go_live:
        return "migration"
    if ustyp in INTERFACE_USER_TYPES:
        return "interface"
    return "dialog"


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    return df.astype(str).apply(lambda s: s.str.strip())


def attribute(values: dict[str, str], table: str, fname: str, key_field: str, cdpos: pd.DataFrame,
              cdhdr: pd.DataFrame, ustyp: dict[str, str], go_live: Optional[str],
              dictionary: Dictionary) -> Attribution:
    """Who last set ``table.fname`` of one record: its latest change, else its creation."""
    oid = values.get(key_field, "")
    pos = cdpos[(cdpos["OBJECTID"] == oid) & (cdpos["TABNAME"] == table) & cdpos["FNAME"].isin([fname, "KEY"])]
    tk = tabkey(table, values, dictionary)
    if tk is not None:
        pos = pos[pos["TABKEY"].str[3:].str.rstrip() == tk]
    hdr = cdhdr[cdhdr["OBJECTID"] == oid]
    if len(pos):
        last = pos.sort_values("CHANGENR").iloc[-1]
        created_only = not (pos["FNAME"] == fname).any()
        h = hdr[hdr["CHANGENR"] == last["CHANGENR"]]
    else:
        h, created_only = hdr[hdr["CHANGE_IND"] == "I"].sort_values("CHANGENR").iloc[:1], True
    if not len(h):
        return Attribution("unknown", "", "", "")
    r = h.iloc[0]
    user = str(r["USERNAME"])
    return Attribution(classify(user, str(r["UDATE"]), ustyp.get(user, ""), created_only, go_live),
                       user, str(r["TCODE"]), str(r["UDATE"]))


def _sentence(fld: str, o: dict[str, str | int | float]) -> str:
    pct = f"{float(o['share']):.0f}%"
    tcode = o["tcode"] or "no transaction"
    if o["origin"] == "unknown":
        return f"{pct} of failing {fld} values have no change document."
    if o["origin"] == "migration":
        return f"{pct} of failing {fld} values were created before go-live by {o['username']} via {tcode} and never changed."
    return f"{pct} of failing {fld} values were last set by {_LABEL[str(o['origin'])]} {o['username']} via {tcode}."


def aggregate(fld: str, attributions: list[Attribution]) -> tuple[list[dict[str, str | int | float]], str]:
    """Top origins (origin, user, transaction) by record count. Ties are broken by key, so the result is deterministic."""
    n = len(attributions)
    counts = Counter((a.origin, a.username, a.tcode) for a in attributions)
    top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP]
    origins: list[dict[str, str | int | float]] = [
        {"origin": o, "username": u, "tcode": t, "records": c, "share": round(100 * c / n, 1)}
        for (o, u, t), c in top]
    return origins, _sentence(fld, origins[0]) if origins else ""


def _read_docs(read: Reader, plans: list[tuple[str, tuple[str, str], list[dict[str, str]]]]
               ) -> tuple[dict[str, pd.DataFrame], dict[str, pd.DataFrame], dict[str, str]]:
    """CDPOS and CDHDR of every failing object, one read per class, plus USR02 user types."""
    from sap.extraction_plan import in_lists

    want: dict[str, tuple[set[str], set[str], set[str]]] = {}
    for fld, (cls, key), recs in plans:
        ids, tabs, fnames = want.setdefault(cls, (set(), set(), {"KEY"}))
        ids |= {r[key] for r in recs if r.get(key)}
        tabs.add(fld.split(".", 1)[0])
        fnames.add(fld.split(".", 1)[1])
    cdpos: dict[str, pd.DataFrame] = {}
    cdhdr: dict[str, pd.DataFrame] = {}
    for cls, (ids, tabs, fnames) in sorted(want.items()):
        head = f"OBJECTCLAS = '{cls}'"
        narrow = f"{in_lists('TABNAME', tabs, 100)[0]} AND {in_lists('FNAME', fnames, 100)[0]}"
        cdpos[cls] = _clean(read("CDPOS", CDPOS_FIELDS, [f"{head} AND {w} AND {narrow}" for w in in_lists("OBJECTID", ids)]))
        cdhdr[cls] = _clean(read("CDHDR", CDHDR_FIELDS, [f"{head} AND {w}" for w in in_lists("OBJECTID", ids)]))
    users = set().union(*(set(h["USERNAME"]) for h in cdhdr.values())) - {""}
    try:
        u = _clean(read("USR02", ["BNAME", "USTYP"], in_lists("BNAME", users)))
        ustyp = dict(zip(u["BNAME"], u["USTYP"]))
    except SAPConnectorError:
        ustyp = {}  # USR02 not authorised: users classify as dialog
    return cdpos, cdhdr, ustyp


def root_causes(read: Reader, records: dict[tuple[str, str], list[str]], go_live: Optional[str],
                dictionary: Dictionary) -> list[RootCause]:
    """One RootCause per (module, check_id). ``records`` maps each to its failing record keys.
    ``go_live`` is YYYYMMDD or None."""
    out: list[RootCause] = []
    plans: dict[tuple[str, str], tuple[str, tuple[str, str], list[dict[str, str]], int]] = {}
    for (module, check_id), keys in sorted(records.items()):
        fld = rule_field(module, check_id)
        c = class_of(fld.split(".", 1)[0]) if fld else None
        if fld is None or c is None:
            out.append(RootCause(check_id, "not_applicable", fld, 0, len(keys),
                                 detail="the rule's field has no SAP change documents"))
            continue
        plans[(module, check_id)] = (fld, c, [parse_record_key(k) for k in sorted(keys)[:MAX_RECORDS]], len(keys))
    if not plans:
        return out
    try:
        cdpos, cdhdr, ustyp = _read_docs(read, [(f, c, r) for f, c, r, _ in plans.values()])
    except SAPConnectorError as e:
        return out + [RootCause(cid, "unavailable", f, 0, n, detail=str(e)[:300])
                      for (_, cid), (f, _, _, n) in plans.items()]
    for (_, check_id), (fld, (cls, key), recs, total) in plans.items():
        table, fname = fld.split(".", 1)
        atts = [attribute(r, table, fname, key, cdpos[cls], cdhdr[cls], ustyp, go_live, dictionary) for r in recs]
        origins, summary = aggregate(fld, atts)
        out.append(RootCause(check_id, "computed", fld, len(recs), total, origins, summary))
    return out
