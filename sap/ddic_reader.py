"""Read a connected ABAP system's own data dictionary (ECC, S/4HANA, EWM, GRC, MDG).

Produces the same table/domain structure as the bundled SAP-standard
dictionary (sap/dictionaries/ecc6), so a live snapshot can overlay the bundle
field by field: customer appends (ZZ* fields), Z/Y tables, changed lengths and
fixed values are then known exactly as the source system defines them.

RFC objects used (all standard, remote-enabled or readable via RFC_READ_TABLE):
  RFC_SYSTEM_INFO     — SAP release, system id, host
  CVERS               — software component versions (SAP_APPL / S4CORE / EA-HR …)
  DDIF_FIELDINFO_GET  — fields incl. includes/appends: key, data element,
                        domain, type, length, decimals, check table, lowercase,
                        conversion exit, texts
  DD02L / DD02T       — table class, delivery class, description
  DD05S               — foreign-key field assignment (field → check-table field)
  DD07L               — domain fixed values
  TADIR               — customer-namespace tables (Z*/Y*)

Authorisations the RFC user needs are listed in docs/sap-connector.md.
"""

from __future__ import annotations

import logging
from typing import Iterable, Optional

from .base import SAPConnectorError

logger = logging.getLogger("meridian.sap.ddic_reader")

_CUSTOMER_PREFIXES = ("Z", "Y")


def _chunks(items: list[str], n: int) -> Iterable[list[str]]:
    for i in range(0, len(items), n):
        yield items[i:i + n]


def _in_clause(field: str, values: list[str]) -> str:
    return f"{field} IN (" + ",".join(f"'{v}'" for v in values) + ")"


def utc_offset_seconds(conn) -> Optional[int]:
    """The ABAP system's offset from UTC in seconds (RFC_SYSTEM_INFO RFCSI_EXPORT-RFCZONE),
    or None when the system does not say. Read-only."""
    # ponytail: sign assumed SAP local = UTC + RFCZONE, and RFCZONE taken to already include daylight
    # saving (RFCDAYST only flags it). Verify: RFC_SYSTEM_INFO vs SY-UZEIT against UTC on a real system;
    # MERIDIAN_SAP_UTC_OFFSET_SECONDS overrides at check time (checks/types/freshness_check.py).
    try:
        zone = str(conn.call("RFC_SYSTEM_INFO").get("RFCSI_EXPORT", {}).get("RFCZONE") or "").strip()
        return int(zone) if zone else None
    except (SAPConnectorError, ValueError, AttributeError) as e:
        logger.warning(f"RFC_SYSTEM_INFO time zone unavailable: {e}")
        return None


def system_info(conn) -> dict:
    """Release, system id and installed software components."""
    info: dict = {}
    try:
        si = conn.call("RFC_SYSTEM_INFO").get("RFCSI_EXPORT", {})
        info = {
            "sap_release": (si.get("RFCSAPRL") or "").strip(),
            "system_id": (si.get("RFCSYSID") or "").strip(),
            "host": (si.get("RFCHOST") or "").strip(),
            "database": (si.get("RFCDBSYS") or "").strip(),
        }
    except SAPConnectorError as e:
        logger.warning(f"RFC_SYSTEM_INFO failed: {e}")
    try:
        cv = conn.read_table_full("CVERS", ["COMPONENT", "RELEASE", "EXTRELEASE"], ["COMPONENT"])
        info["components"] = {
            r["COMPONENT"]: {"release": r["RELEASE"], "sp": r.get("EXTRELEASE", "")}
            for r in cv.to_dict(orient="records")
        }
    except SAPConnectorError as e:
        logger.warning(f"CVERS read failed: {e}")
        info["components"] = {}
    comps = info["components"]
    info["product"] = "s4hana" if "S4CORE" in comps else ("ecc6" if "SAP_APPL" in comps else "unknown")
    return info


def customer_tables(conn, limit: int = 5000) -> list[str]:
    """Customer-namespace transparent tables (TADIR R3TR TABL Z*/Y*)."""
    names: list[str] = []
    for prefix in _CUSTOMER_PREFIXES:
        df = conn.read_table_full(
            "TADIR", ["OBJ_NAME"], ["OBJ_NAME"],
            where=f"PGMID = 'R3TR' AND OBJECT = 'TABL' AND OBJ_NAME LIKE '{prefix}%'",
            max_rows=limit,
        )
        names += df["OBJ_NAME"].tolist() if "OBJ_NAME" in df else []
    if not names:
        return []
    transp: list[str] = []
    for batch in _chunks(sorted(set(names)), 40):
        df = conn.read_table_full("DD02L", ["TABNAME", "TABCLASS"], ["TABNAME"],
                                  where=_in_clause("TABNAME", batch) + " AND AS4LOCAL = 'A'")
        transp += df.loc[df["TABCLASS"] == "TRANSP", "TABNAME"].tolist() if len(df) else []
    return sorted(set(transp))


def read_tables(conn, tables: list[str], language: str = "E") -> tuple[dict[str, dict], list[dict]]:
    """Table definitions in bundle format + a per-table status list."""
    out: dict[str, dict] = {}
    status: list[dict] = []
    meta: dict[str, dict] = {}
    for batch in _chunks(sorted(set(tables)), 40):
        try:
            d2 = conn.read_table_full("DD02L", ["TABNAME", "TABCLASS", "CONTFLAG"], ["TABNAME"],
                                      where=_in_clause("TABNAME", batch) + " AND AS4LOCAL = 'A'")
            t2 = conn.read_table_full("DD02T", ["TABNAME", "DDTEXT"], ["TABNAME"],
                                      where=_in_clause("TABNAME", batch) + f" AND DDLANGUAGE = '{language}' AND AS4LOCAL = 'A'")
            texts = dict(zip(t2.get("TABNAME", []), t2.get("DDTEXT", [])))
            for r in d2.to_dict(orient="records"):
                meta[r["TABNAME"]] = {"category": r["TABCLASS"], "delivery_class": r["CONTFLAG"],
                                      "description": texts.get(r["TABNAME"], "")}
        except SAPConnectorError as e:
            logger.warning(f"DD02L/DD02T read failed: {e}")

    for t in sorted(set(tables)):
        try:
            res = conn.call("DDIF_FIELDINFO_GET", TABNAME=t, LANGU=language, ALL_TYPES="X")
        except SAPConnectorError as e:
            not_found = "NOT_FOUND" in str(e)
            status.append({"table": t, "status": "not_found" if not_found else "failed", "detail": str(e)[:200]})
            continue
        dfies = res.get("DFIES_TAB") or []
        if not dfies:
            status.append({"table": t, "status": "not_found"})
            continue
        fields = []
        for f in dfies:
            name = (f.get("FIELDNAME") or "").strip()
            if not name or name.startswith("."):
                continue
            fields.append({
                "pos": int(f.get("POSITION") or 0),
                "name": name,
                "key": (f.get("KEYFLAG") or "").strip() == "X",
                "data_element": (f.get("ROLLNAME") or "").strip() or None,
                "domain": (f.get("DOMNAME") or "").strip() or None,
                "type": (f.get("DATATYPE") or "").strip() or None,
                "length": int(f.get("LENG") or 0),
                "decimals": int(f.get("DECIMALS") or 0),
                "description": (f.get("FIELDTEXT") or f.get("SCRTEXT_M") or "").strip(),
                "check_table": (f.get("CHECKTABLE") or "").strip() or None,
                "lowercase": (f.get("LOWERCASE") or "").strip() == "X",
                "conversion_exit": (f.get("CONVEXIT") or "").strip() or None,
                "has_fixed_values": (f.get("VALEXI") or "").strip() == "X",
                "customer_field": name.startswith(("ZZ", "YY")),
            })
        m = meta.get(t, {})
        out[t] = {
            "table": t,
            "description": m.get("description", ""),
            "category": m.get("category", ""),
            "delivery_class": m.get("delivery_class", ""),
            "fields": sorted(fields, key=lambda x: x["pos"]),
            "foreign_keys": [],
            "customer_table": t.startswith(_CUSTOMER_PREFIXES),
        }
        status.append({"table": t, "status": "live", "fields": len(fields)})

    _attach_check_fields(conn, out)
    return out, status


def _attach_check_fields(conn, tables: dict[str, dict]) -> None:
    """DD05S: which check-table column each checked field maps to.

    DD05S lists, per checked field (TABNAME/FIELDNAME), which of the table's
    fields (FORKEY) supplies the check table's PRIMPOS-th key field. The row
    whose FORKEY is the checked field itself gives its check-table column.
    """
    from sap.ddic import get_dictionary

    std = get_dictionary("s4hana")
    for batch in _chunks(list(tables), 40):
        try:
            df = conn.read_table_full(
                "DD05S", ["TABNAME", "FIELDNAME", "PRIMPOS", "FORTABLE", "FORKEY"],
                ["TABNAME", "FIELDNAME", "PRIMPOS"],
                where=_in_clause("TABNAME", batch) + " AND AS4LOCAL = 'A'",
            )
        except SAPConnectorError as e:
            logger.warning(f"DD05S read failed: {e}")
            continue
        for r in df.to_dict(orient="records"):
            t = tables.get(r["TABNAME"])
            if not t or r.get("FORKEY") != r.get("FIELDNAME") or r.get("FORTABLE") != r["TABNAME"]:
                continue
            f = next((x for x in t["fields"] if x["name"] == r["FIELDNAME"]), None)
            check = (f or {}).get("check_table")
            if not check or check == "*":
                continue
            ct = tables.get(check)
            key_order = [x["name"] for x in ct["fields"] if x["key"]] if ct else \
                [n for n, x in (std.table(check).fields.items() if std.table(check) else []) if x.key]
            pos = int(r.get("PRIMPOS") or 0)
            if 0 < pos <= len(key_order):
                t["foreign_keys"].append({"field": r["FIELDNAME"], "foreign_table": check,
                                          "foreign_field": key_order[pos - 1]})


def read_domains(conn, domains: list[str], language: str = "E") -> dict[str, dict]:
    """Fixed values (DD07L) for the given domains, in bundle domain format."""
    out: dict[str, dict] = {}
    for batch in _chunks(sorted(set(domains)), 25):
        try:
            df = conn.read_table_full(
                "DD07L", ["DOMNAME", "VALPOS", "DOMVALUE_L", "DOMVALUE_H"], ["DOMNAME", "VALPOS"],
                where=_in_clause("DOMNAME", batch) + " AND AS4LOCAL = 'A'",
            )
        except SAPConnectorError as e:
            logger.warning(f"DD07L read failed: {e}")
            continue
        for r in df.to_dict(orient="records"):
            d = out.setdefault(r["DOMNAME"], {"domain": r["DOMNAME"], "fixed_values": [], "source": "live"})
            d["fixed_values"].append({"low": r["DOMVALUE_L"], "high": r.get("DOMVALUE_H") or None, "text": ""})
    return out


def snapshot(conn, tables: list[str], include_customer_tables: bool = True) -> dict:
    """Full DDIC snapshot: system info, table definitions, fixed values, coverage."""
    info = system_info(conn)
    z_tables: list[str] = []
    if include_customer_tables:
        try:
            z_tables = customer_tables(conn)
        except SAPConnectorError as e:
            logger.warning(f"customer table discovery failed: {e}")
    defs, status = read_tables(conn, list(dict.fromkeys(tables + z_tables)))
    domains = sorted({f["domain"] for t in defs.values() for f in t["fields"]
                      if f.get("domain") and f.get("has_fixed_values")})
    fixed = read_domains(conn, domains)
    return {
        "system_info": info,
        "tables": defs,
        "domains": fixed,
        "customer_tables": z_tables,
        "status": status,
    }


def parse_odata_metadata(xml_text: str, namespace_hint: Optional[str] = None) -> dict[str, dict]:
    """Entity types from an OData V2/V4 $metadata document (SuccessFactors, S/4HANA Cloud).

    Returns {EntityType: {"keys": [...], "properties": {name: {type, max_length, nullable}}}}.
    """
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml_text)
    out: dict[str, dict] = {}
    for et in root.iter():
        if not et.tag.endswith("}EntityType") and et.tag != "EntityType":
            continue
        name = et.get("Name")
        keys = [pr.get("Name") for k in et if k.tag.endswith("Key") for pr in k]
        props = {}
        for p in et:
            if p.tag.endswith("}Property") or p.tag == "Property":
                props[p.get("Name")] = {
                    "type": p.get("Type"),
                    "max_length": int(p.get("MaxLength")) if (p.get("MaxLength") or "").isdigit() else None,
                    "nullable": p.get("Nullable", "true") != "false",
                }
        out[name] = {"keys": keys, "properties": props}
    return out
