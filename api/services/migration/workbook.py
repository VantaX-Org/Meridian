"""Fill a target system's data workbook from one analysed run.

A target system hands over files that define what it will accept. A SuccessFactors implementation sends workbooks:
definition sheets list each field with its type, length, mandatory flag and picklist, and value grids carry the exact
load columns. SuccessFactors import templates and LSMW files are delimited, with their ids in a header row. The S/4HANA
Migration Cockpit template lists its fields on a Field List sheet. This module reads each of these and shapes a run's
data to it, so the columns always come from the file and are never invented here. workbook_formats.py handles the
containers.

The upload is never saved back: openpyxl would lose its shapes and comments, so a new file is written instead. Values
stay byte for byte, as in every load file, with two exceptions: a confirmed value mapping replaces a value, and a date
of all zeros, which is how SAP stores no date, is blank. Only the file's own rules and confirmed value mappings decide
which rows are held back.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Optional

import pandas as pd

from api.services.migration.workbook_formats import Source, WorkbookError, leaves, read_source, write_source, written_as
from checks.base import record_keys
from checks.frames import TableFrames
from sap.ddic import Dictionary, Field
from sap.deterministic.normalize import canonical_country

__all__ = ["WorkbookError", "parse_workbook", "tables_needed", "fill", "same_format", "explain"]

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
    # The names the import templates and the User Data File use for the same objects.
    "userdatafile": {"User"},
    "userdirectory": {"User"},
    "user": {"User"},
    "biographicalinformation": {"PerPerson"},
    "personalinformation": {"PerPersonal"},
    "employmentdetails": {"EmpEmployment"},
    "employmentinfo": {"EmpEmployment"},
    "jobhistory": {"EmpJob"},
    "compensationinfo": {"EmpCompensation"},
    "paycomponentrecurring": {"EmpPayCompRecurring"},
    "paycomponentnonrecurring": {"EmpPayCompNonRecurring"},
    "addresses": {"PerAddressDEFLT"},
    "address": {"PerAddressDEFLT"},
    "addressinfo": {"PerAddressDEFLT"},
    "emailinformation": {"PerEmail"},
    "phoneinformation": {"PerPhone"},
    "nationalidcard": {"PerNationalId"},
    "workpermitinfo": {"EmpWorkPermit"},
    "personrelationship": {"PerPersonRelationship"},
}


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
    pos: int = -1  # the column's place on the sheet, when the sheet is a load layout
    table: str = ""  # the SAP structure a cockpit field list names


@dataclass
class Sheet:
    name: str  # unique across the upload
    kind: str  # definition | grid
    columns: list[Column] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)  # a grid's own label row under its header, by header
    top: list[tuple] = field(default_factory=list)  # the template rows kept above the data
    required: bool = False  # a cockpit sheet that must carry data
    plain: bool = False  # a delimited file, whose name need not name a SuccessFactors object
    file: str = ""  # the uploaded file it came from
    raw: str = ""  # its name in that file

    @property
    def base(self) -> str:
        return _base(self.raw or self.name)


@dataclass
class Workbook:
    sheets: list[Sheet]
    picklists: dict[str, set[str]]  # casefolded picklist id to its allowed values
    source: Optional[Source] = None


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


_TECHNICAL = re.compile(r"[A-Z][A-Z0-9_/]*(?:[-.][A-Z0-9_/]+)?")


def _technical(row: tuple) -> bool:
    """A row of SAP field names, such as the header of an LSMW file under its description rows."""
    cells = [_text(c) for c in row if _text(c)]
    return (len(cells) >= 2 and len(set(cells)) == len(cells)
            and sum(bool(_TECHNICAL.fullmatch(c)) for c in cells) >= 0.8 * len(cells))


def _grid(name: str, rows: list[tuple], plain: bool = False) -> Optional[Sheet]:
    top = rows[:6]
    if not top:
        return None
    at = next((i for i, r in enumerate(top) if _technical(r)), None)
    if at is None:
        at = max(range(len(top)), key=lambda i: sum(c is not None for c in top[i]))
    head = top[at]
    columns = [Column(header=_text(c), id=_text(c), pos=i) for i, c in enumerate(head) if _text(c)]
    if not columns:
        return None
    labels = _labels(head, rows[at + 1:at + 2])
    return Sheet(name, "grid", columns, labels, top=list(rows[:at + 1 + bool(labels)]), plain=plain)


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


def _cockpit(raw: list[tuple[str, list[tuple]]]) -> list[Sheet]:
    """The sheets of an S/4HANA Migration Cockpit template, whose Field List sheet defines all the others."""
    listing = next((rows for name, rows in raw if _norm(name) == "fieldlist"), None)
    head = None
    for at, row in enumerate((listing or [])[:10]):
        names = {_norm(c): i for i, c in enumerate(row) if _text(c)}
        if "sheetname" in names:
            head = names
            break
    if head is None:
        return []

    def pick(*keys):
        return next((head[k] for k in keys if k in head), None)

    id_col = pick("sapfield", "sapfieldname", "fieldname", "technicalname", "field")
    if id_col is None:
        return []
    label_col, importance = pick("fielddescription", "description"), pick("importance")
    type_col, length, structure = pick("type"), pick("length"), pick("sapstructure", "structure")

    fields: dict[str, dict[str, Column]] = {}
    current = ""
    for row in listing[at + 1:]:
        def cell(i):
            return _text(row[i]) if i is not None and i < len(row) else ""

        current = cell(head["sheetname"]) or current  # the sheet name is written once, above its fields
        fid = cell(id_col)
        if not current or not fid:
            continue
        kind = cell(type_col).lower()
        fields.setdefault(_norm(re.sub("mandatory", "", current, flags=re.I)), {}).setdefault(fid, Column(
            header=fid, id=fid, label=cell(label_col), mandatory="mandatory" in cell(importance).lower(),
            type="DATE" if kind.startswith("date") else "NUMBER" if kind.startswith("num") else "",
            max_length=_length(cell(length)) if kind.startswith("text") else 0, table=cell(structure)))

    sheets = []
    for name, rows in raw:
        columns = fields.get(_norm(re.sub("mandatory", "", name, flags=re.I)))
        if not columns or _norm(name) == "fieldlist":
            continue
        columns = list(columns.values())

        def cells(row):
            return [_norm(_text(c).replace("*", "")) for c in row]

        wanted = {_norm(c.id) for c in columns} | {_norm(c.label) for c in columns if c.label}
        head_row = max(rows[:10], key=lambda r: len(wanted & set(cells(r))), default=())
        places: dict[str, list[int]] = {}
        for i, c in enumerate(cells(head_row)):
            places.setdefault(c, []).append(i)
        for col in columns:  # labels repeat across groups, so each place is used once
            found = places.get(_norm(col.id)) or places.get(_norm(col.label))
            col.pos = found.pop(0) if found else -1
        top = list(rows)
        while top and not any(_text(c) for c in top[-1]):
            top.pop()
        sheets.append(Sheet(name, "grid", columns, top=top, required="mandatory" in name.lower()))
    return sheets


def _parse(source: Source, picklists: dict[str, set[str]]) -> list[Sheet]:
    """The sheets of one uploaded file."""
    cockpit = _cockpit(source.sheets)
    if cockpit:
        return cockpit
    plain = source.format == "delimited"
    definitions, grids = [], []
    for name, rows in source.sheets:
        if "picklist" in name.lower():
            _read_picklist(rows, picklists)
            continue
        for at, row in enumerate(rows[:8]):
            low = [_text(c).lower() for c in row]
            if "system field id" in low:
                definitions.append(_definition(name, rows, at, low.index("system field id")))
                break
            if "name" in low and "sf label" in low:
                definitions.append(_definition(name, rows, at, low.index("name")))
                break
        else:
            if plain or _is_grid(name) or _base(name) in SHEET_ENTITIES or any(_technical(r) for r in rows[:6]):
                grid = _grid(name, rows, plain)
                if grid:
                    grids.append(grid)

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
                col.mandatory, col.picklist, col.country = rule.mandatory, rule.picklist, rule.country
    return [d for d in definitions if d.name not in replaced] + grids


def parse_workbook(data: bytes, filename: str = "") -> Workbook:
    """Read the field definitions, load layouts and picklists of an upload, in any format it arrives in."""
    source = read_source(data, filename)
    sheets: list[Sheet] = []
    picklists: dict[str, set[str]] = {}
    seen: set[str] = set()
    for leaf in leaves(source):
        for sheet in _parse(leaf, picklists):
            sheet.file, sheet.raw = leaf.name, sheet.name
            n, name = 1, sheet.name[:31]  # a tab name, which Excel cuts at 31 characters
            while name in seen:
                n += 1
                name = f"{sheet.name[:27]} {n}"
            seen.add(name)
            sheet.name = name
            sheets.append(sheet)
    if not any(s.columns for s in sheets):
        raise WorkbookError("No field definitions or value grids were found in this workbook.")
    return Workbook(sheets, picklists, source)


def _entities(sheet: Sheet, dictionary: Dictionary) -> set[str]:
    """The entities a sheet loads, by its known name, or by naming an entity outright as an import template does."""
    known = SHEET_ENTITIES.get(sheet.base)
    if known:
        return known
    return {e for t in dictionary.tables.values() for f in t.fields.values() if f.source and "." in f.source
            for e in [f.source.split(".")[0]] if _norm(e) == sheet.base}  # a source with no dot is a column, not an entity


def _by_field(sheet: Sheet, dictionary: Dictionary) -> dict[str, dict[str, Field]]:
    """A sheet that names no entity, matched by SAP table and field name only.

    A column that names its table must find exactly that field. A bare field name may sit on several tables, so a
    table needs two such columns before it counts. Anything else stays unmatched and is reported."""
    named: dict[str, dict[str, Field]] = {}
    bare: dict[str, dict[str, Field]] = {}
    for col in sheet.columns:
        table, name = re.sub(r"^S_", "", col.table.upper()), col.id.upper()
        split = re.fullmatch(r"([A-Z][A-Z0-9_/]*)[-.]([A-Z0-9_/]+)", name)
        if split and not table:
            table, name = re.sub(r"^S_", "", split.group(1)), split.group(2)
        if table:
            found = dictionary.tables.get(table)
            if found and name in found.fields:
                named.setdefault(table, {})[col.header] = found.fields[name]
        elif _TECHNICAL.fullmatch(col.id):  # as written: a friendly "position" is not the field POSITION
            for found in dictionary.tables.values():
                if name in found.fields:
                    bare.setdefault(found.name, {})[col.header] = found.fields[name]
    return named | {t: h for t, h in bare.items() if len(h) >= 2 and t not in named}


def _candidates(sheet: Sheet, dictionary: Dictionary) -> dict[str, dict[str, Field]]:
    """Each table that could fill a sheet, with its matched column headers.

    A column matches a field of the sheet's own entity by property name. Keys also match by name across entities,
    because the person or user id is the same value on every entity. Nothing looser: a job's start date is not
    the employment's start date, although both are called start date."""
    entities = _entities(sheet, dictionary)
    # The foundation pay component grid defines components; Meridian holds only what each employee is paid.
    if sheet.kind == "grid" and sheet.base == "paycomponent":
        return {}
    if not entities:
        return _by_field(sheet, dictionary)
    out: dict[str, dict[str, Field]] = {}
    for table in dictionary.tables.values():
        fields = [f for f in table.fields.values() if f.source and "." in f.source and f.source.split(".")[0] in entities]
        if not fields:
            continue
        index = {_norm(k): table.fields[k] for k in table.keys}
        index |= {_norm(f.source.split(".", 1)[1]): table.fields[k]
                  for k in table.keys for f in [table.fields[k]] if f.source and "." in f.source}
        index |= {_norm((f.source or "").split(".", 1)[1]): f for f in fields}
        if "status" in index:  # foundation load files call the status field effectiveStatus
            index["effectivestatus"] = index["status"]
        if "externalcode" in index:  # friendly grids head the code column with the object's name
            index[sheet.base + "code"] = index["externalcode"]
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
_TEXT_CONTROL = r"[\x00-\x08\x0b\x0c\x0e-\x1f]"  # tab and line breaks are allowed in free text
_WHY = {
    "mandatory": "is mandatory in the workbook definition and the value is blank",
    "too_long": "holds a value longer than the {n} characters the definition allows",
    "bad_date": "holds a value that is not a date",
    "bad_boolean": "holds a value that is not true or false (accepted: true, false, yes, no, y, n, t, f, 0, 1)",
    "bad_whole_number": "holds a value that is not a whole number, which type {type} requires",
    "bad_number": "holds a value that is not a finite number, which type {type} requires",
    "not_in_picklist": "holds a value that is not in picklist {picklist}",
    "bad_id": "holds an identifier with leading or trailing spaces or a control character",
    "bad_text": "holds a control character that no load file can carry",
    "mandatory_for_country": "is mandatory for the record's country and the value is blank",
    "value_map": "holds a value with no confirmed value mapping",
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
    else:
        found.append((values.astype("string").fillna("").str.contains(_TEXT_CONTROL, regex=True), "bad_text"))
    return found


def _country_field(dictionary: Dictionary, table: str, stored) -> Optional[Field]:
    """The field holding a record's own country. A phone's countryCode is a dialling code, so it never counts."""
    for f in dictionary.tables[table].fields.values():
        if _norm((f.source or "").split(".", 1)[-1]) in ("countryofcompany", "country") and f.qualified in stored:
            return f
    return None


def _country_tokens(text: str) -> set[str]:
    """Each country a definition lists, as 'Brazil (BRA)', in both its three and two letter codes."""
    return {t for code in re.findall(r"\b[A-Z]{3}\b", text) for t in (code, canonical_country(code)) if t}


def _row_countries(values: pd.Series) -> pd.Series:
    text = values.astype("string").fillna("").str.strip()
    return text.map({v: canonical_country(v) or v.upper() for v in text.unique()})


def _value_map(col: Column, f: Field, maps: dict[str, dict[str, str]]) -> tuple[str, dict[str, str]]:
    target = next((k for k in (col.id, f.name, f.qualified, f.source) if k and k in maps), "")
    return target, maps.get(target, {})


def fill(workbook: Workbook, frames: TableFrames, value_maps: Optional[dict[str, dict[str, str]]] = None,
         strict: frozenset[str] | set[str] = frozenset()) -> tuple[dict[str, pd.DataFrame], dict]:
    """The output tabs, and the report of what could and could not be filled.

    A column with no source is left empty and reported; it holds no row back, or a single unmapped field would
    empty the whole tab. A row is held back only when a value it does carry breaks the workbook's rules.

    `value_maps` are the confirmed source to target values, by target field. Under a `strict` target a value with no
    mapping holds its row back; other targets, such as configuration maps, keep the value as it is."""
    maps = value_maps or {}
    mapped = 0
    same = True
    unchecked: list[dict] = []
    tabs: dict[str, pd.DataFrame] = {}
    held: list[dict] = []
    reasons: Counter = Counter()
    report: list[dict[str, Any]] = []
    for sheet in workbook.sheets:
        options = _candidates(sheet, frames.dictionary)
        present = {}
        for name, found in options.items():
            held_table = frames.frames.get(name)
            if held_table is not None:
                live = {h: f for h, f in found.items() if f.qualified in held_table.columns}
                if live:
                    present[name] = live
        table = max(present, key=lambda t: len(present[t]), default=None)
        hits = dict(present[table]) if table else {}
        columns = list(sheet.columns)
        added: list[str] = []
        # Most definition sheets leave out whose record a row is. A load without that id cannot work, so it is
        # added under the source system's own property name, and the report says so.
        if table and sheet.kind == "definition":  # a grid is the exact load format, so nothing is added to it
            have = {f.name for f in hits.values()}
            for key in frames.dictionary.keys(table):
                f = frames.dictionary.field(table, key)
                if f and key not in have and f.qualified in frames.frames[table].columns:
                    header = f.source.split(".", 1)[1] if f.source else key
                    columns.insert(len(added), Column(header, header, f.description or key, mandatory=True))
                    hits[header] = f
                    added.append(header)
        unmapped = sorted((c for c in columns if c.header not in hits), key=lambda c: not c.mandatory)
        row = {"name": sheet.name, "kind": sheet.kind, "table": table, "columns": len(columns), "added_keys": added,
               "matched": len(hits), "rows": 0, "ready": 0, "held": 0,
               "known": bool(options) or sheet.base in SHEET_ENTITIES, "required": sheet.required,
               "unmapped": [{"id": c.id, "label": c.label, "mandatory": c.mandatory and not c.country}
                            for c in unmapped]}
        report.append(row)
        if not table:
            continue

        # A large table stays compressed (checks/frames.ParquetTable), so decode only the columns this sheet reads.
        stored = frames.frames[table]
        key_cols = [c for c in (f"{table}.{k}" for k in frames.dictionary.keys(table)) if c in stored.columns]
        country = _country_field(frames.dictionary, table, stored.columns)
        reads = {*key_cols, *(f.qualified for f in hits.values()), *([country.qualified] if country else [])}
        df = stored[list(reads)]
        keys = record_keys(df, key_cols)
        bad = pd.Series(False, index=df.index)
        countries = _row_countries(df[country.qualified]) if country else None
        values: dict[str, pd.Series] = {}

        def hold(mask: pd.Series, col: Column, reason: str) -> None:
            nonlocal bad
            count = int(mask.sum())
            if not count:
                return
            bad |= mask
            reasons[reason] += count
            why = explain(col, reason)
            held.extend({"sheet": sheet.name, "record": k, "field": col.id, "reason": reason, "detail": why}
                        for k in keys[mask])

        for col in columns:
            if col.header not in hits:
                continue
            f = hits[col.header]
            value = df[f.qualified]
            text = value.astype("string")
            target, vm = _value_map(col, f, maps)
            if vm:
                found = text.isin(list(vm)).fillna(False).astype(bool)
                mapped += int(found.sum())
                value = value.astype(object).where(~found, text.map(vm))
                if target in strict:
                    hold(text.fillna("").str.strip().ne("") & ~found, col, "value_map")
            if col.type.upper() == "DATE":  # SAP stores no date as zeros
                value = value.astype(object).where(~value.astype("string").str.fullmatch("0+").fillna(False), None)
            values[col.header] = value
            for mask, reason in _problems(col, value, workbook.picklists):
                hold(mask, col, reason)
            if col.mandatory and col.country:
                tokens = _country_tokens(col.country)
                if countries is None or not tokens:
                    unchecked.append({"sheet": sheet.name, "id": col.id, "label": col.label})
                else:
                    blank = value.astype("string").fillna("").str.strip() == ""
                    hold(blank & countries.isin(tokens), col, "mandatory_for_country")

        out = pd.DataFrame({c.header: values[c.header][~bad].values if c.header in hits else None
                            for c in columns}, index=range(int((~bad).sum())))
        if sheet.kind == "definition" or sheet.labels:  # the import layout: field ids on row one, labels on row two
            label = {c.header: sheet.labels.get(c.header, c.label) for c in columns}
            out = pd.concat([pd.DataFrame([label]), out], ignore_index=True)
        tabs[sheet.name] = out
        same = same and sheet.kind == "grid" and all(c.pos >= 0 for c in columns if c.header in hits)
        row.update(rows=len(df), ready=int((~bad).sum()), held=int(bad.sum()))

    known = [r for r in report if r["table"]]
    source = workbook.source
    files = {s.file for s in workbook.sheets if s.name in tabs}
    return tabs, {
        "summary": {
            "sheets": len(report), "filled_sheets": len(known),
            "columns": sum(r["columns"] for r in report), "matched_columns": sum(r["matched"] for r in report),
            "mandatory_unmapped": sum(u["mandatory"] for r in known for u in r["unmapped"]),
            "rows": sum(r["rows"] for r in report), "ready": sum(r["ready"] for r in report),
            "held": sum(r["held"] for r in report),
            "mandatory_sheets_empty": sum(r["required"] and not r["ready"] for r in report),
            "mapped_values": mapped,
        },
        "format": {
            "id": source.format if source else "xlsx", "same": bool(source and tabs and same),
            "written_as": written_as(source, files, bool(held)) if source else "xlsx",
            "skipped": source.skipped if source else [],
        },
        "country_unchecked": unchecked, "sheets": report, "reasons": dict(reasons), "held": held,
    }


def same_format(workbook: Workbook, tabs: dict[str, pd.DataFrame], held_csv: Optional[bytes]) -> tuple[bytes, str]:
    """The filled tabs written back in the upload's own layout, each value in its column's own place."""
    loads: dict[str, dict] = {}
    for sheet in workbook.sheets:
        tab = tabs.get(sheet.name)
        if tab is None:
            continue
        body = tab.iloc[1:] if sheet.labels else tab
        rows = [[""] * (max(c.pos for c in sheet.columns) + 1) for _ in range(len(body))]
        for col in sheet.columns:
            if col.pos >= 0:
                for row, value in zip(rows, body[col.header].tolist()):
                    row[col.pos] = "" if pd.isna(value) else str(value)
        loads.setdefault(sheet.file, {})[sheet.raw] = (sheet.top, rows)
    return write_source(workbook.source, loads, held_csv)
