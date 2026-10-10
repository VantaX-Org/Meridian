"""SAP correction packages from an approved remediation batch. Every function returns
file bytes for a person to download and load through SAP's own tools; nothing here
opens a connection to SAP (Meridian is read-only on SAP).

  ltmc_workbook           Migration Cockpit file-staging layout (S/4 migration load)
"""
from __future__ import annotations

import io

import pandas as pd
from openpyxl.worksheet.worksheet import Worksheet

from api.services.remediation import cockpit_sheets
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
