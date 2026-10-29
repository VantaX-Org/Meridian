"""The fix sheet in business words: a record's key split into SAP-named columns (Material number, Plant), its name
under the object's own heading (Material name), the field's description beside its SAP name (Base unit of measure, MARA-MEINS) and the values the
rule accepts, with their meanings. The technical ids stay in grey columns at the end, under the headers the import
reads (api/routes/work.py import_sheet), so a filled-in sheet still imports.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sap.data_dictionary import DATA_DICTIONARY, get_field_description

POSSIBLE_VALUES_SHOWN = 20

# Key fields the data dictionary does not describe, and the heading of each key field's record name.
_KEY_LABELS = {
    "KOSTL": "Cost centre", "AUFNR": "Order", "PSPNR": "WBS element", "PSPHI": "Project", "VBELN": "Sales document",
    "PRCTR": "Profit centre", "SAKNR": "G/L account", "LIFNR": "Vendor number", "KUNNR": "Customer number",
}
_NAME_HEADERS = {
    "MATNR": "Material name", "LIFNR": "Vendor name", "KUNNR": "Customer name", "PARTNER": "Business partner name",
    "SAKNR": "G/L account name", "ANLN1": "Asset name", "KOSTL": "Cost centre name", "PRCTR": "Profit centre name",
    "AUFNR": "Order name", "EQUNR": "Equipment name", "TPLNR": "Functional location name",
    "PSPNR": "WBS element name", "PSPHI": "Project name", "EBELN": "Vendor", "VBELN": "Customer",
    "WERKS": "Plant name", "BUKRS": "Company code name", "CHARG": "Material",
}


def split_key(record_key: str) -> list[tuple[str, str]]:
    """``MATNR=101|WERKS=3000`` as [(MATNR, 101), (WERKS, 3000)]; a bare key is one unnamed part."""
    if "=" not in record_key:
        return [("", record_key)]
    return [tuple(p.split("=", 1)) for p in record_key.split("|") if "=" in p]  # type: ignore[misc]


def key_label(field: str) -> str:
    """A key field's business name: Material number, Plant, Company code."""
    if not field:
        return "Record"
    if field in _KEY_LABELS:
        return _KEY_LABELS[field]
    for table in DATA_DICTIONARY.values():
        if field in table and table[field].get("description"):
            return str(table[field]["description"])
    return field


def key_header(field: str) -> str:
    """A key column's heading: its description and SAP name, "Material number (MATNR)"."""
    label = key_label(field)
    return f"{label} ({field})" if field and label != field else label


def sap_field(field: Optional[str]) -> Optional[str]:
    """``MARA.MEINS`` written the way SAP shows it: MARA-MEINS."""
    return field.replace(".", "-", 1) if field else None


def field_label(field: Optional[str]) -> Optional[str]:
    """``MARA.MEINS`` as "Base unit of measure"; a field the dictionary does not know keeps its SAP name."""
    if not field:
        return None
    table, _, name = field.rpartition(".")
    if table:
        desc = get_field_description(table, name)
        if desc and desc != field:
            return desc
    return key_label(name) if name in _KEY_LABELS else field


def name_header(keys: Iterable[str]) -> str:
    """The heading of the records' name: the first key field that has one (Material name), else Name."""
    return next((_NAME_HEADERS[k] for k in keys if k in _NAME_HEADERS), "Name")


def with_meaning(value: object, allowed: Optional[list[dict]]) -> Optional[str]:
    """A value with its meaning where the rule gives one: "EA (each)"."""
    if value is None or value == "":
        return None
    label = next((a["label"] for a in allowed or [] if a["value"] == str(value) and a["label"]), None)
    return f"{value} ({label})" if label else str(value)


def possible_values(allowed: Optional[list[dict]]) -> Optional[str]:
    """The values the rule accepts, with meanings, the first POSSIBLE_VALUES_SHOWN and how many more."""
    if not allowed:
        return None
    shown = ", ".join(with_meaning(a["value"], allowed) or "(blank)" for a in allowed[:POSSIBLE_VALUES_SHOWN])
    more = len(allowed) - POSSIBLE_VALUES_SHOWN
    return f"{shown} and {more} more" if more > 0 else shown


def key_columns(rows: list[dict]) -> list[str]:
    """The key fields of these rows, in first-seen order: one column each when every row has the same key shape,
    else none (a mixed sheet keeps the record as one readable text)."""
    shapes = {tuple(f for f, _ in split_key(r["record_key"])) for r in rows}
    return list(next(iter(shapes))) if len(shapes) == 1 else []


def readable_key(record_key: str) -> str:
    """``MATNR=101|WERKS=3000`` as "Material number 101, Plant 3000"."""
    return ", ".join(f"{key_label(f)} {v}" if f else v for f, v in split_key(record_key))
