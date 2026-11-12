"""Would SAP accept this value for TABLE.FIELD? A deterministic check against the ABAP Dictionary (sap/ddic.py).

``check_value`` runs the checks SAP itself runs when a value is written through a screen, a BAPI or a load file:

* type: NUMC holds digits only, DATS a real calendar date (YYYYMMDD; an ISO date is read too), TIMS HHMMSS,
  DEC/CURR/QUAN/FLTP/INT a number. Anything else (CHAR, UNIT, CUKY, LANG ...) is text.
* length and decimals: a text longer than the field's length is cut by SAP, so it is rejected here; a packed number may
  carry at most ``length - decimals`` integer digits and ``decimals`` decimal places.
* conversion exit: ALPHA and MATN1 left-pad an all-digit value with zeros to the field length, and the check table
  holds the padded value, so membership is tested on the padded form. Other exits (CUNIT ...) are reported, not run.
* lower case: a field whose domain has no lower-case flag stores upper case, so a mixed-case value does not match.
* fixed values: a domain with single fixed values (DD07L) accepts only those.
* check table: the value must be a key of the field's check table. The tenant's live configuration snapshot is used
  when it holds that table; otherwise the SAP-standard baseline (sap/baseline_config.py); otherwise the check is
  skipped and the verdict says so. An empty value is never checked against a check table (SAP skips initial values).

The verdict is ``reject`` when any check fails, ``unknown`` when the field is not in the dictionary, else ``safe``.
For a value a fixed-value or check-table list rejects, ``nearest`` lists the closest valid codes by difflib's
similarity ratio (deterministic for the same input). No database here except ``load_live``; no language model.
"""
from __future__ import annotations

import difflib
import re
from datetime import date
from typing import Any, Optional

from sqlalchemy import text

from sap.baseline_config import BASELINE_CONFIG
from sap.ddic import Dictionary

Values = dict[str, dict[str, Optional[str]]]  # "TABLE.FIELD" -> {code: text}

_NUMBER = {"DEC", "CURR", "QUAN", "FLTP", "INT1", "INT2", "INT4", "INT8"}
_PAD = {"ALPHA", "MATN1"}
_TEXT_COL = re.compile(r"TXT|TEXT|BEZ|^MSEHL$|DESCRIPTION")
_SAP_TYPES = ("ecc", "s4hana", "s4hana_onprem", "s4hana_cloud", "ewm", "ewms")
NEAREST = 3


def _values(tables: dict[str, list[dict[str, Any]]], out: Values) -> Values:
    """{TABLE: [rows]} -> {TABLE.COL: {code: text}}: every column is a possible key, its text the row's text column."""
    for table, rows in tables.items():
        for rec in rows or []:
            if not isinstance(rec, dict):
                continue
            label = next((str(rec[c]) for c in rec if _TEXT_COL.search(str(c)) and rec[c]), None)
            for col, val in rec.items():
                if val not in (None, "") and not _TEXT_COL.search(str(col)):
                    out.setdefault(f"{table}.{col}", {}).setdefault(str(val).strip(), label)
    return out


def baseline_values(system_type: str) -> Values:
    """The SAP-standard customizing values Meridian ships: ECC's, overlaid with the system type's own."""
    out: Values = {}
    for st in dict.fromkeys(("ecc", system_type)):
        for tables in (BASELINE_CONFIG.get(st) or {}).values():
            _values(tables, out)
    return out


async def load_live(db, tid: str, system_id: Optional[str] = None) -> tuple[Optional[str], str, Values]:
    """(system_id, system_type, live values) for one SAP system of the tenant: the one named, else the first active
    SAP system by name. Live values come from config_snapshots with source 'live' only. No system: (None, 'ecc', {})."""
    sql = ("SELECT id::text AS id, system_type FROM sap_systems WHERE tenant_id = :tid AND id::text = :sid"
           if system_id else
           "SELECT id::text AS id, system_type FROM sap_systems WHERE tenant_id = :tid AND is_active "
           "ORDER BY (system_type = ANY(:sap)) DESC, name LIMIT 1")
    row = (await db.execute(text(sql), {"tid": tid, "sid": str(system_id), "sap": list(_SAP_TYPES)})).mappings().first()
    if not row:
        return None, "ecc", {}
    snaps = (await db.execute(text(
        "SELECT config_table, config_data FROM config_snapshots "
        "WHERE tenant_id = :tid AND system_id::text = :sid AND source = 'live'"), {"tid": tid, "sid": row["id"]})).all()
    out: Values = {}
    for table, data in snaps:
        _values({table: data if isinstance(data, list) else []}, out)
    return row["id"], row["system_type"] or "ecc", out


def _type_check(f, v: str) -> Optional[str]:
    """None when the value fits the field's type, length and decimals, else why not."""
    t, n = (f.type or "CHAR").upper(), f.length or 0
    if t == "NUMC":
        if not v.isdigit():
            return f"NUMC {n} holds digits only"
    elif t == "DATS":
        d = v.replace("-", "") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else v
        if d != "00000000":
            try:
                if not re.fullmatch(r"\d{8}", d):
                    raise ValueError
                date(int(d[:4]), int(d[4:6]), int(d[6:]))
            except ValueError:
                return "DATS 8 holds a calendar date YYYYMMDD"
        return None
    elif t == "TIMS":
        if not re.fullmatch(r"([01]\d|2[0-3])[0-5]\d[0-5]\d", v.replace(":", "")):
            return "TIMS 6 holds a time HHMMSS"
        return None
    elif t in _NUMBER:
        s = v.strip().replace(",", "")
        if not re.fullmatch(r"[-+]?\d*\.?\d+|[-+]?\d+\.", s):
            return f"{t} {n} holds a number"
        if t in {"DEC", "CURR", "QUAN"} and n:
            whole, _, frac = s.lstrip("+-").partition(".")
            if len(frac.rstrip("0")) > f.decimals:
                return f"{t} {n} allows {f.decimals} decimal places"
            if len(whole.lstrip("0")) > n - f.decimals:
                return f"{t} {n},{f.decimals} allows {n - f.decimals} digits before the decimal point"
        return None
    if n and len(v) > n:
        return f"too long for {t} {n} ({len(v)} characters)"
    return None


def _nearest(v: str, codes: dict[str, Optional[str]], limit: int = NEAREST) -> list[dict[str, Optional[str]]]:
    keys = sorted(c for c in codes if c)
    hits = [c for c in keys if c.upper() == v.upper()][:1]
    hits += [c for c in difflib.get_close_matches(v.upper(), keys, n=limit, cutoff=0.5) if c not in hits]
    return [{"code": c, "text": codes.get(c)} for c in hits[:limit]]


def check_value(dictionary: Dictionary, qualified: str, value: Any, live: Values, baseline: Values) -> dict[str, Any]:
    """Evidence for one value: {field, value, stored, field_text, data_element, domain, type, length, decimals,
    check_table, check_field, conversion_exit, lowercase, fixed_values, source, checks: [{check, verdict, reason}],
    verdict, reasons, nearest}. ``source`` is 'live', 'baseline' or None: where the check-table values came from."""
    v = "" if value is None else str(value)
    f = dictionary.resolve(qualified) if qualified else None
    out: dict[str, Any] = {"field": qualified, "value": v, "stored": v, "field_text": None, "data_element": None,
                           "domain": None, "type": None, "length": None, "decimals": None, "check_table": None,
                           "check_field": None, "conversion_exit": None, "lowercase": None, "fixed_values": [],
                           "source": None, "checks": [], "verdict": "unknown", "nearest": [],
                           "reasons": [f"{qualified} is not in the SAP dictionary, so it was not checked"]}
    if f is None:
        return out
    out.update(field_text=f.description or None, data_element=f.data_element, domain=f.domain, type=f.type,
               length=f.length, decimals=f.decimals, check_table=f.check_table, check_field=f.check_field,
               conversion_exit=f.conversion_exit, lowercase=f.lowercase,
               fixed_values=[{"code": x.low, "text": x.text or None} for x in f.fixed_values])
    checks: list[dict[str, Any]] = []

    def add(check: str, verdict: str, reason: Optional[str] = None) -> None:
        checks.append({"check": check, "verdict": verdict, "reason": reason})

    bad = _type_check(f, v) if v else None
    t = (f.type or "CHAR").upper()
    add("length" if bad and bad.startswith("too long") else "type", "fail" if bad else "pass", bad)
    stored = v
    if f.conversion_exit in _PAD and v.isdigit() and f.length and len(v) <= f.length:
        stored = v.zfill(f.length)
        add("conversion_exit", "pass", f"{f.conversion_exit} stores {stored}")
    elif f.conversion_exit:
        add("conversion_exit", "skip", f"{f.conversion_exit} converts the value on input; not run here")
    if v and not f.lowercase and t not in _NUMBER and v != v.upper():
        add("lowercase", "fail", f"domain {f.domain or f.data_element} stores upper case, so SAP keeps {v.upper()}")
    out["stored"] = stored
    fixed = f.allowed_values()
    if fixed is not None:
        texts = {x.low: x.text or None for x in f.fixed_values}
        if stored in fixed:
            add("fixed_values", "pass")
        else:
            add("fixed_values", "fail", f"not a fixed value of domain {f.domain}")
            out["nearest"] = _nearest(stored, texts)
    ref = f.check_ref
    if ref:
        values, source = (live[ref], "live") if ref in live else (baseline[ref], "baseline") if ref in baseline else (None, None)
        out["source"] = source
        if not stored:
            add("check_table", "skip", "SAP does not check an empty value against the check table")
        elif values is None:
            add("check_table", "skip", f"check table {f.check_table} was not read from the system and has no baseline")
        elif stored in values or (f.lowercase and stored.upper() in {c.upper() for c in values}):
            add("check_table", "pass", f"{stored} is in {f.check_table} ({source})")
        else:
            add("check_table", "fail", f"not in check table {f.check_table} ({source})")
            out["nearest"] = _nearest(stored, values)
    out["checks"] = checks
    out["reasons"] = [c["reason"] for c in checks if c["verdict"] == "fail"]
    out["verdict"] = "reject" if out["reasons"] else "safe"
    return out


if __name__ == "__main__":
    from sap.ddic import get_dictionary
    d, base = get_dictionary("ecc6"), baseline_values("ecc")
    assert check_value(d, "MARA.MEINS", "EA", {}, base)["verdict"] == "safe"
    r = check_value(d, "MARA.MTART", "FERX", {}, base)
    assert r["verdict"] == "reject" and r["source"] == "baseline" and r["nearest"][0]["code"] == "FERT", r
    assert check_value(d, "MARA.MTART", "ZFRT", {"T134.MTART": {"ZFRT": "Own"}}, base)["source"] == "live"
    assert check_value(d, "MARA.MATKL", "X" * 10, {}, {})["reasons"][0].startswith("too long for CHAR 9")
    assert check_value(d, "MARA.XCHPF", "Y", {}, {})["reasons"] == ["not a fixed value of domain XFELD"]
    assert check_value(d, "MARA.ERSDA", "20260231", {}, {})["verdict"] == "reject"
    assert check_value(d, "MARA.BRGEW", "1.2345", {}, {})["verdict"] == "reject"
    assert check_value(d, "LFA1.LIFNR", "1234", {}, {})["stored"] == "0000001234"
    assert check_value(d, "MARA.NOPE", "1", {}, {})["verdict"] == "unknown"
    print("ok")
