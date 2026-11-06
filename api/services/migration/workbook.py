"""Fill a target system's data workbook from one analysed run.

A SuccessFactors implementation hands over workbooks that define what the new system will accept: definition
sheets list each field with its type, length, mandatory flag and picklist, and value grids carry the exact load
columns. This module reads such a workbook and shapes a run's data to it, so the columns always come from the
workbook and are never invented here.

The upload is never saved back: openpyxl would lose its shapes and comments, so a new workbook is written instead.
Values stay byte for byte, as in every load file; only the workbook's own rules decide which rows are held back.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd
from openpyxl import load_workbook

from checks.base import record_keys
from checks.frames import TableFrames
from sap.ddic import Dictionary, Field

MAX_UNPACKED_BYTES = 500 * 1024 * 1024
HELD_BACK_TAB = "Held back"
HELD_SAMPLE = 200

# Workbook rows below the field list reuse the Type column for notes, so only real field types count.
FIELD_TYPES = {"string", "picklist", "date", "long", "boolean", "double", "go", "country", "attachment",
               "translatable", "generic object", "number", "enum", "decimal", "user", "destination object"}
HIDDEN = {"none", "not visible", "not_visible"}
BOOLEANS = {"true", "false", "yes", "no", "y", "n", "t", "f", "0", "1"}

# Sheet base name (normalised) to the SuccessFactors entities it loads.
SHEET_ENTITIES = {
    "biographicalinfo": {"PerPerson"},
    "personalinfo": {"PerPersonal"},
    "nationalid": {"PerNationalId"},
    "phoneinfo": {"PerPhone"},
    "emailinfo": {"PerEmail"},
    "socialaccounts": {"PerSocialAccount"},
    "csfaddresses": {"PerAddressDEFLT"},
    "paymentinfo": {"PaymentInformationDetailV3"},
    "emergencycontact": {"PerEmergencyContacts"},
    "dependents": {"PerPersonRelationship"},
    "workpermit": {"EmpWorkPermit"},
    "employmentinfoathire": {"EmpEmployment"},
    "employmentinfoatterm": {"EmpEmployment"},
    "jobinfo": {"EmpJob"},
    "csfjobinfo": {"EmpJob"},
    "jobrelationships": {"EmpJobRelationships"},
    "compinfo": {"EmpCompensation"},
    "paycomponent": {"EmpPayCompRecurring"},
    "legalentity": {"FOCompany"},
    "location": {"FOLocation"},
    "position": {"Position"},
    "department": {"FODepartment"},
    "division": {"FODivision"},
    "businessunit": {"FOBusinessUnit"},
    "costcenter": {"FOCostCenter"},
    "jobclassification": {"FOJobCode"},
    "paygrade": {"FOPayGrade"},
    "payrange": {"FOPayRange"},
    "paygroup": {"FOPayGroup"},
    "frequency": {"FOFrequency"},
    "jobfunction": {"FOJobFunction"},
    "geozone": {"FOGeozone"},
    "locationgroup": {"FOLocationGroup"},
    "paycomponentgroup": {"FOPayComponentGroup"},
    "payscaletype": {"FOPayScaleType"},
    "payscalearea": {"FOPayScaleArea"},
    "corporateaddress": {"FOCorporateAddressDEFLT"},
    "csfcorporateaddress": {"FOCorporateAddressDEFLT"},
}


class WorkbookError(ValueError):
    """The upload is not a workbook this module can read; the message is safe to show."""


@dataclass
class Column:
    header: str  # exactly as the output must spell it
    id: str  # the system field id, which is the header unless a definition says otherwise
    label: str = ""
    type: str = ""
    max_length: int = 0  # 0 means no limit
    mandatory: bool = False
    picklist: str = ""
    country: str = ""


@dataclass
class Sheet:
    name: str
    kind: str  # definition | grid
    columns: list[Column] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)  # a grid's own label row under its header, by header


@dataclass
class Workbook:
    sheets: list[Sheet]
    picklists: dict[str, set[str]]  # casefolded picklist id to its allowed values


def _norm(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _base(name: str) -> str:
    """A sheet's name without its grid suffix: 'Location Values' and 'Pay Component Values (US)' name their object."""
    bare = re.sub(r"\s*(Values|Data)\s*(\(.*\)+)?\s*$", "", name, flags=re.I)
    return _norm(bare).replace("centre", "center")


def _is_grid(name: str) -> bool:
    return bool(re.search(r"(Values|Data)\s*(\(.*\)+)?\s*$", name, re.I))


def _length(value) -> int:
    try:
        return max(int(float(value)), 0)
    except (TypeError, ValueError):
        return 0


def _definition(name: str, rows: list[tuple], at: int, id_col: int) -> Sheet:
    head = {_norm(c): i for i, c in enumerate(rows[at]) if c is not None}

    def cell(row, key):
        i = head.get(key)
        return row[i] if i is not None and i < len(row) else None

    sheet, seen = Sheet(name, "definition"), set()
    for row in rows[at + 1:]:
        fid = _text(row[id_col]) if id_col < len(row) else ""
        kind = _text(cell(row, "type"))
        if not fid or kind.lower() not in FIELD_TYPES or fid in seen:
            continue
        if _text(cell(row, "visibility")).lower() in HIDDEN:
            continue
        seen.add(fid)
        sheet.columns.append(Column(
            header=fid, id=fid, label=_text(cell(row, "sflabel")), type=kind.upper(),
            max_length=_length(cell(row, "maxlength")),
            mandatory=_text(cell(row, "mandatory")).lower() == "yes",
            picklist=re.sub(r"^picklist:\s*", "", _text(cell(row, "picklist")), flags=re.I),
            country=_text(cell(row, "country"))))
    return sheet


def _grid(name: str, rows: list[tuple]) -> Optional[Sheet]:
    top = rows[:6]
    if not top:
        return None
    head = max(top, key=lambda r: sum(c is not None for c in r))
    columns = [Column(header=_text(c), id=_text(c)) for c in head if _text(c)]
    if not columns:
        return None
    return Sheet(name, "grid", columns, _labels(head, rows[rows.index(head) + 1:rows.index(head) + 2]))


_DATE = re.compile(r"\d{1,4}[/-]\d{1,2}[/-]\d{1,4}")


def _labels(head: tuple, below: list[tuple]) -> dict[str, str]:
    """The row under a grid's header, when it names the columns. Values carry a date or a number; labels never do."""
    if not below:
        return {}
    pairs = {_text(h): _text(c) for h, c in zip(head, below[0]) if _text(h) and _text(c)}
    cells = [c for c in below[0] if c is not None]
    wordy = (cells and all(isinstance(c, str) and not _DATE.search(c) for c in cells)
             and not any(ch.isdigit() for ch in cells[0]))  # a code in the first cell means a record, not a label
    return pairs if wordy and 2 * len(pairs) >= sum(bool(_text(h)) for h in head) else {}


def _read_picklist(rows: list[tuple], picklists: dict[str, set[str]]) -> None:
    for at, row in enumerate(rows[:3]):
        low = [_text(c).lower() for c in row]
        if "id" in low and "values.externalcode" in low:
            pid, values = low.index("id"), [low.index("values.externalcode")]
            if "values.nonuniqueexternalcode" in low:
                values.append(low.index("values.nonuniqueexternalcode"))
        elif "^picklistid" in low and "value" in low:
            pid, values = low.index("^picklistid"), [low.index("value")]
        else:
            continue
        current = ""
        for r in rows[at + 1:]:
            current = _text(r[pid]) if pid < len(r) and r[pid] is not None else current
            for v in values:
                if current and v < len(r) and _text(r[v]):
                    picklists.setdefault(current.casefold(), set()).add(_text(r[v]))
        return


def parse_workbook(data: bytes) -> Workbook:
    """Read the field definitions, value grids and picklists of an uploaded workbook."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > MAX_UNPACKED_BYTES:
                raise WorkbookError("This workbook is too large once unpacked.")
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
    except (zipfile.BadZipFile, KeyError, OSError) as e:
        raise WorkbookError("This file is not an Excel workbook (.xlsx).") from e

    definitions, grids, picklists = [], [], {}
    try:
        for ws in book.worksheets:
            ws.reset_dimensions()
            rows = list(ws.iter_rows(values_only=True))
            if "picklist" in ws.title.lower():
                _read_picklist(rows, picklists)
                continue
            for at, row in enumerate(rows[:8]):
                low = [_text(c).lower() for c in row]
                if "system field id" in low:
                    definitions.append(_definition(ws.title, rows, at, low.index("system field id")))
                    break
                if "name" in low and "sf label" in low:
                    definitions.append(_definition(ws.title, rows, at, low.index("name")))
                    break
            else:
                grid = _grid(ws.title, rows) if _is_grid(ws.title) else None
                if grid:
                    grids.append(grid)
    finally:
        book.close()

    # A grid is the load format of the object its definition sheet describes: the grid's columns win and take
    # their rules from the definition, by field id or by the label a friendly header repeats.
    by_base = {_base(d.name): d for d in definitions}
    replaced = set()
    for grid in grids:
        definition = by_base.get(_base(grid.name))
        if not definition:
            continue
        replaced.add(definition.name)
        rules = {_norm(c.label): c for c in definition.columns if c.label}
        rules |= {_norm(c.id): c for c in definition.columns}
        for col in grid.columns:
            rule = rules.get(_norm(col.header))
            if rule:
                col.id, col.label, col.type, col.max_length = rule.id, rule.label, rule.type, rule.max_length
                col.mandatory, col.picklist = rule.mandatory, rule.picklist
    sheets = [d for d in definitions if d.name not in replaced] + grids
    if not any(s.columns for s in sheets):
        raise WorkbookError("No field definitions or value grids were found in this workbook.")
    return Workbook(sheets, picklists)


def _candidates(sheet: Sheet, dictionary: Dictionary) -> dict[str, dict[str, Field]]:
    """Each table that could fill a sheet, with its matched column headers.

    A column matches a field of the sheet's own entity by property name. Keys also match by name across entities,
    because the person or user id is the same value on every entity. Nothing looser: a job's start date is not
    the employment's start date, although both are called start date."""
    entities = SHEET_ENTITIES.get(_base(sheet.name))
    # The foundation pay component grid defines components; Meridian holds only what each employee is paid.
    if not entities or (sheet.kind == "grid" and _base(sheet.name) == "paycomponent"):
        return {}
    out: dict[str, dict[str, Field]] = {}
    for table in dictionary.tables.values():
        fields = [f for f in table.fields.values() if f.source and f.source.split(".")[0] in entities]
        if not fields:
            continue
        index = {_norm(k): table.fields[k] for k in table.keys}
        index |= {_norm(f.source.split(".", 1)[1]): table.fields[k]
                  for k in table.keys for f in [table.fields[k]] if f.source}
        index |= {_norm(f.source.split(".", 1)[1]): f for f in fields}
        if "status" in index:  # foundation load files call the status field effectiveStatus
            index["effectivestatus"] = index["status"]
        if "externalcode" in index:  # friendly grids head the code column with the object's name
            index[_base(sheet.name) + "code"] = index["externalcode"]
        hits = {}
        for col in sheet.columns:
            # name.en_US is the localised form of name.
            name = _norm(col.id).replace("centre", "center")
            hit = index.get(name) or index.get(_norm(col.id.split(".")[0]))
            if hit:
                hits[col.header] = hit
        if hits:
            out[table.name] = hits
    return out


def tables_needed(workbook: Workbook, dictionary: Dictionary) -> set[str]:
    """The source tables worth loading for this workbook."""
    return {t for s in workbook.sheets for t in _candidates(s, dictionary)}


_WHOLE = r"[+-]?\d+(?:\.0+)?"
_LONG_MAX = 2**63 - 1
# Identifier columns by spelling: externalCode, code, id, userId, person-id-external, ...Code, ...-id, ...Id (camel case)
_ID_COLUMN = re.compile(r"(?i:^(?:external-?code|code|id|person-?id(?:-?external)?|user-?id)$)|[a-z]Id$|[a-z]Code$|-id$|-code$")
_CONTROL = r"[\x00-\x1f\x7f]"
_WHY = {
    "mandatory": "is mandatory in the workbook definition and the value is blank",
    "too_long": "holds a value longer than the {n} characters the definition allows",
    "bad_date": "holds a value that is not a date",
    "bad_boolean": "holds a value that is not true or false (accepted: true, false, yes, no, y, n, t, f, 0, 1)",
    "bad_whole_number": "holds a value that is not a whole number, which type {type} requires",
    "bad_number": "holds a value that is not a finite number, which type {type} requires",
    "not_in_picklist": "holds a value that is not in picklist {picklist}",
    "bad_id": "holds an identifier with leading or trailing spaces or a control character",
}


def explain(col: Column, reason: str) -> str:
    """Why a value was held back, read from the column definition alone; no free text, no values."""
    why = _WHY.get(reason, reason).format(n=col.max_length, type=col.type, picklist=col.picklist)
    return f"Column {col.id}{f' ({col.label})' if col.label else ''} {why}."


def _problems(col: Column, values: pd.Series, picklists: dict[str, set[str]]) -> list[tuple[pd.Series, str]]:
    """Each way a column's values break its definition, as a row mask and a reason code.

    Checks follow the declared type. A blank type, or STRING, GO, COUNTRY, USER and the other text types, carry
    only the length, mandatory, picklist and identifier checks: nothing else in the definition can be tested."""
    text = values.astype("string").fillna("").str.strip()
    filled = text != ""
    kind = col.type.upper()
    found = []
    if col.mandatory and not col.country:  # a country field is mandatory for that country only
        found.append((~filled, "mandatory"))
    if col.max_length:
        found.append((filled & (text.str.len() > col.max_length), "too_long"))
    if kind == "DATE":
        found.append((filled & pd.to_datetime(text, errors="coerce", format="mixed").isna(), "bad_date"))
    elif kind == "BOOLEAN":
        found.append((filled & ~text.str.lower().isin(BOOLEANS), "bad_boolean"))
    elif kind == "LONG":
        whole = text.str.fullmatch(_WHOLE).fillna(False)
        size = pd.to_numeric(text.where(whole), errors="coerce").abs() <= _LONG_MAX
        found.append((filled & ~(whole & size.fillna(False)), "bad_whole_number"))
    elif kind in ("DOUBLE", "DECIMAL", "NUMBER"):
        num = pd.to_numeric(text.where(filled), errors="coerce")
        found.append((filled & (num.isna() | num.isin([float("inf"), float("-inf")])), "bad_number"))
    allowed = picklists.get(col.picklist.casefold()) if col.picklist else None
    if allowed:  # any column that names a picklist is bound to it, whatever its declared type
        found.append((filled & ~text.isin(allowed), "not_in_picklist"))
    if _ID_COLUMN.search(col.id.split(".")[-1]):
        raw = values.astype("string").fillna("")
        found.append(((raw != raw.str.strip()) | raw.str.contains(_CONTROL, regex=True), "bad_id"))
    return found


def fill(workbook: Workbook, frames: TableFrames) -> tuple[dict[str, pd.DataFrame], dict]:
    """The output tabs, and the report of what could and could not be filled.

    A column with no source is left empty and reported; it holds no row back, or a single unmapped field would
    empty the whole tab. A row is held back only when a value it does carry breaks the workbook's rules."""
    tabs: dict[str, pd.DataFrame] = {}
    held: list[dict] = []
    reasons: Counter = Counter()
    report = []
    for sheet in workbook.sheets:
        options = _candidates(sheet, frames.dictionary)
        present = {}
        for table, hits in options.items():
            df = frames.frames.get(table)
            if df is not None:
                live = {h: f for h, f in hits.items() if f.qualified in df.columns}
                if live:
                    present[table] = live
        table = max(present, key=lambda t: len(present[t]), default=None)
        hits = dict(present.get(table, {}))
        columns = list(sheet.columns)
        added = []
        # Most definition sheets leave out whose record a row is. A load without that id cannot work, so it is
        # added under the source system's own property name, and the report says so.
        if table and sheet.kind == "definition":  # a grid is the exact load format, so nothing is added to it
            have = {f.name for f in hits.values()}
            for key in frames.dictionary.keys(table):
                f = frames.dictionary.field(table, key)
                if key not in have and f.qualified in frames.frames[table].columns:
                    header = f.source.split(".", 1)[1] if f.source else key
                    columns.insert(len(added), Column(header, header, f.description or key, mandatory=True))
                    hits[header] = f
                    added.append(header)
        unmapped = sorted((c for c in columns if c.header not in hits), key=lambda c: not c.mandatory)
        row = {"name": sheet.name, "kind": sheet.kind, "table": table, "columns": len(columns), "added_keys": added,
               "matched": len(hits), "rows": 0, "ready": 0, "held": 0,
               "known": _base(sheet.name) in SHEET_ENTITIES,
               "unmapped": [{"id": c.id, "label": c.label, "mandatory": c.mandatory and not c.country}
                            for c in unmapped]}
        report.append(row)
        if not table:
            continue

        df = frames.frames[table]
        keys = record_keys(df, [f"{table}.{k}" for k in frames.dictionary.keys(table)])
        bad = pd.Series(False, index=df.index)
        for col in columns:
            if col.header not in hits:
                continue
            for mask, reason in _problems(col, df[hits[col.header].qualified], workbook.picklists):
                count = int(mask.sum())
                if not count:
                    continue
                bad |= mask
                reasons[reason] += count
                why = explain(col, reason)
                held += [{"sheet": sheet.name, "record": k, "field": col.id, "reason": reason, "detail": why}
                         for k in keys[mask]]

        out = pd.DataFrame({c.header: df.loc[~bad, hits[c.header].qualified].values if c.header in hits else None
                            for c in columns}, index=range(int((~bad).sum())))
        if sheet.kind == "definition" or sheet.labels:  # the import layout: field ids on row one, labels on row two
            label = {c.header: sheet.labels.get(c.header, c.label) for c in columns}
            out = pd.concat([pd.DataFrame([label]), out], ignore_index=True)
        tabs[sheet.name] = out
        row.update(rows=len(df), ready=int((~bad).sum()), held=int(bad.sum()))

    known = [r for r in report if r["table"]]
    return tabs, {
        "summary": {
            "sheets": len(report), "filled_sheets": len(known),
            "columns": sum(r["columns"] for r in report), "matched_columns": sum(r["matched"] for r in report),
            "mandatory_unmapped": sum(u["mandatory"] for r in known for u in r["unmapped"]),
            "rows": sum(r["rows"] for r in report), "ready": sum(r["ready"] for r in report),
            "held": sum(r["held"] for r in report),
        },
        "sheets": report, "reasons": dict(reasons), "held": held,
    }
