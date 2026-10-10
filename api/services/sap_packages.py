"""SAP correction packages from an approved remediation batch. Every function returns
file bytes for a person to download and load through SAP's own tools; nothing here
opens a connection to SAP (Meridian is read-only on SAP).

  ltmc_workbook           Migration Cockpit file-staging layout (S/4 migration load)
  mass_maintenance_zip    MM17 / XD99 / XK99 key lists + change log (fix in place)
  mdg_change_request      MDG change-request payload file (customer-side import)
"""
from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Iterable

import pandas as pd
from openpyxl.worksheet.worksheet import Worksheet

from api.services.remediation import ANCHOR, _exportable, _key_parts, cockpit_sheets
from sap.ddic import Dictionary

# object -> (Migration Cockpit migration object, {SAP table: template sheet}).
# ponytail: names unverified for release S/4HANA 2023 — no system reachable to download the
# "Migrate Your Data" templates for Product/Customer/Supplier; verify before relying on a name.
LTMC_OBJECTS: dict[str, tuple[str, dict[str, str]]] = {
    "material": ("Product", {"MARA": "Basic Data", "MAKT": "Descriptions", "MARC": "Plant Data",
                             "MARD": "Storage Location Data", "MBEW": "Valuation Data", "MVKE": "Sales Data",
                             "MARM": "Units of Measure"}),
    "customer": ("Customer", {"KNA1": "General Data", "KNB1": "Company Data", "KNVV": "Sales Data"}),
    "vendor": ("Supplier", {"LFA1": "General Data", "LFB1": "Company Code Data",
                            "LFM1": "Purchasing Organization Data"}),
}
# "TABLE.FIELD" -> template column name, where the template renames a DDIC field. Filled from the verification.
FIELD_ALIASES: dict[str, str] = {}
TABLE_OBJECT = {t: o for o, (_, sheets) in LTMC_OBJECTS.items() for t in sheets}


def no_formulas(ws: Worksheet) -> None:
    """SAP values like '=A' stay text, never a formula (same guard as the remediation export)."""
    for row in ws.iter_rows():
        for cell in row:
            if cell.data_type == "f":
                cell.data_type = "s"


def _description(dictionary: Dictionary | None, table: str, field: str) -> str:
    f = dictionary.field(table, field) if dictionary is not None else None
    return f.description if f else ""


def ltmc_workbook(items: list[dict], dictionary: Dictionary | None) -> bytes:
    sheets = cockpit_sheets(items, dictionary)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        readme = pd.DataFrame({"Meridian correction package": [
            "Migration Cockpit file-staging layout. One sheet per migration object structure.",
            "Row 1: technical field names. Row 2: field descriptions. Values from row 3.",
            "Paste rows into the template downloaded from your S/4HANA release; check sheet names match.",
            "Meridian never writes to SAP. Load this file through the Migration Cockpit yourself.",
        ]})
        readme.to_excel(xw, sheet_name="README", index=False)
        for table, df in sheets.items():
            obj = TABLE_OBJECT.get(table)
            if obj is None:
                continue  # tables outside the three objects: use cockpit_xlsx / mass_change_csv
            mig, names = LTMC_OBJECTS[obj]
            name = f"{mig} - {names[table]}"[:31]
            cols = [FIELD_ALIASES.get(f"{table}.{c}", c) for c in df.columns]
            desc = pd.DataFrame([[_description(dictionary, table, c) for c in df.columns]], columns=cols)
            pd.concat([desc, df.set_axis(cols, axis=1)], ignore_index=True).to_excel(xw, sheet_name=name, index=False)
        for ws in xw.book.worksheets:
            no_formulas(ws)
    return buf.getvalue()


def _zip(files: Iterable[tuple[str, str]]) -> bytes:
    """Deterministic zip: sorted names, fixed timestamps."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, body)
    return buf.getvalue()


def _tsv(rows: list[list[str]]) -> str:
    return "".join("\t".join(v.replace("\t", " ").replace("\n", " ") for v in r) + "\n" for r in rows)


def _business_key(record_key: str, obj: str) -> str:
    """The object's business key (MATNR/KUNNR/LIFNR from remediation.ANCHOR), else the key's last part."""
    parts = _key_parts(record_key)
    _, key_name = ANCHOR.get(obj, (None, None))
    if key_name and key_name in parts:
        return parts[key_name]
    return list(parts.values())[-1]


def mass_maintenance_zip(items: list[dict]) -> bytes:
    """Zip for MM17 / XD99 / XK99: per (transaction, table, field, new value) a key list to
    paste into the multiple selection, plus changes.tsv with every old and new value."""
    from api.services.export_engine import MASS_MAINTENANCE_TCODES

    head = ["TCODE", "TABLE", "FIELD", "NEW_VALUE", "RECORD_KEY", "OLD_VALUE", "RULE"]
    rows, skipped = [], []
    for i in _exportable(items):
        table, field = i["field"].split(".", 1)
        tcode = MASS_MAINTENANCE_TCODES.get(TABLE_OBJECT.get(table, ""), "")
        r = [tcode, table, field, str(i["proposed_value"]), i["record_key"], str(i.get("current_value") or ""),
             i["check_id"]]
        (rows if tcode else skipped).append(r)
    rows.sort()
    groups: dict[tuple[str, str, str, str], list[str]] = {}
    for r in rows:
        obj = TABLE_OBJECT.get(r[1], "")
        groups.setdefault((r[0], r[1], r[2], r[3]), []).append(_business_key(r[4], obj))
    files, readme, seq = [("changes.tsv", _tsv([head, *rows]))], [], {}
    for (tcode, table, field, new), keys in sorted(groups.items()):
        n = seq[(tcode, table, field)] = seq.get((tcode, table, field), 0) + 1
        name = f"{tcode}/{table}-{field}-{n:03d}.txt"
        files.append((name, "".join(f"{k}\n" for k in sorted(set(keys)))))
        readme.append(f"{name}: run {tcode}, table {table}, set {field} to '{new}' for {len(set(keys))} keys "
                      "(paste the file into the key multiple selection).")
    if skipped:
        files.append(("skipped.tsv", _tsv([head, *sorted(skipped)])))
    files.append(("README.txt", "Meridian correction package. Meridian never writes to SAP; run each step "
                                "yourself after review.\n" + "\n".join(readme) + "\n"))
    return _zip(files)
# ponytail: for plant-level fields (MARC), MM17 also needs the plant in its selection. The key
# list holds only the object's business key (MATNR/KUNNR/LIFNR). changes.tsv carries the full
# key, so the steward filters by plant from there. Split groups per plant if stewards ask.


# SAP table's object -> MDG data model (transaction MDGIMG decides which; we only route by object).
MDG_MODEL = {"material": "MM", "customer": "BP", "vendor": "BP"}


def mdg_change_request(items: list[dict], *, batch_id: str, batch_name: str, cr_type: str | None) -> bytes:
    """MDG change-request payload file, grouped by data model (MM/BP) then by entity and key.
    The change_request_type is MDG configuration (transaction MDGIMG) and is never defaulted."""
    by_model: dict[str, dict[tuple[str, str], dict]] = {}
    skipped = 0
    for i in _exportable(items):
        table, field = i["field"].split(".", 1)
        model = MDG_MODEL.get(TABLE_OBJECT.get(table, ""))
        if model is None:
            skipped += 1
            continue
        ent = by_model.setdefault(model, {}).setdefault(
            (table, i["record_key"]), {"entity_type": table, "key": _key_parts(i["record_key"]), "changes": []})
        ent["changes"].append({"attribute": field, "old": i.get("current_value"), "new": i["proposed_value"],
                               "rule": i["check_id"]})
    doc = {
        "format": "meridian.mdg-change-request/1", "batch_id": batch_id, "description": batch_name,
        "change_requests": [
            {"data_model": m, "change_request_type": cr_type,
             "entities": [{**e, "changes": sorted(e["changes"], key=lambda c: c["attribute"])}
                          for _, e in sorted(ents.items())]}
            for m, ents in sorted(by_model.items())],
        "skipped": skipped,
        "note": "File only. Meridian makes no MDG or SAP call. Import it with your MDG file upload or a customer mapping.",
    }
    return json.dumps(doc, indent=2, sort_keys=True).encode()
