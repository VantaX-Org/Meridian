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
from datetime import date
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
    # country-specific sheets load one entity set per country: PerGlobalInfoUSA, PerGlobalInfoZAF, ...
    "csfpersonalinfoglobalinfo": {"PerGlobalInfo*"},
    "csflegalentity": {"FOLegalEntityLocal*"},
    "csfjobclassification": {"FOJobClassLocal*"},
    "paymentinfo": {"PaymentInformationDetailV3"},
    "emergencycontact": {"PerEmergencyContacts"},
    "dependents": {"PerPersonRelationship", "PerPersonal", "PerNationalId"},
    "workpermit": {"EmpWorkPermit"},
    "employmentinfoathire": {"EmpEmployment"},
    "employmentinfoatterm": {"EmpEmployment"},
    "jobinfo": {"EmpJob"},
    "csfjobinfo": {"EmpJob"},
    "jobrelationships": {"EmpJobRelationships"},
    "compinfo": {"EmpCompensation"},
    # one Pay Component sheet holds both: the non-recurring table carries its pay date and code
    "paycomponent": {"EmpPayCompRecurring", "EmpPayCompNonRecurring"},
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
    "personrelationshipinfo": {"PerPersonRelationship"},
    "personinfo": {"PerPerson"},
    "basicuserinfo": {"User"},
    # contingent workers are loaded as a person, an email and an employment with job data
    "contingentworker": {"PerPerson", "PerPersonal", "PerEmail", "EmpEmployment", "EmpJob"},
    "globalassignment": {"EmpGlobalAssignment"},
    "globalassignmentinfo": {"EmpGlobalAssignment"},
    # the dictionary holds termination dates on the employment (no EmpEmploymentTermination entity)
    "terminationinfo": {"EmpEmployment"},
}


# Columns the import itself reads, such as DELIMIT, which no source system holds. They stay blank and are reported
# apart from the fields that have no source.
IMPORT_CONTROL = {"operation"}
# A dotted id whose tail is a locale is a localised property (name.en_US); any other dot steps into a navigation.
_LOCALE = re.compile(r"\.[a-z]{2}_[A-Z]{2}$")


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
    mapped: dict[str, str] = field(default_factory=dict)  # header to TABLE.FIELD, as a person corrected it

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


def add_system_picklists(book: "Workbook", rows: list[dict]) -> int:
    """Picklist values read from the connected system (PickListValueV2, stored as rows of {picklist id: code}) for the
    picklists the workbook's own picklist sheet leaves empty. The sheet wins where it carries values."""
    sheet = {pid for pid, values in book.picklists.items() if values}
    added = 0
    for row in rows or []:
        for pid, code in row.items():
            if pid.casefold() not in sheet and _text(code):
                book.picklists.setdefault(pid.casefold(), set()).add(_text(code))
                added += 1
    return added


def _cockpit(raw: list[tuple[str, list[tuple]]]) -> list[Sheet]:
    """The sheets of an S/4HANA Migration Cockpit template, whose Field List sheet defines all the others."""
    listing = next((rows for name, rows in raw if _norm(name) == "fieldlist"), None)
    if listing is None:
        return []
    head = None
    for at, row in enumerate(listing[:10]):
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
        listed = fields.get(_norm(re.sub("mandatory", "", name, flags=re.I)))
        if not listed or _norm(name) == "fieldlist":
            continue
        columns = list(listed.values())

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
    # The foundation pay component grid defines the components themselves, not what each employee is paid.
    if sheet.kind == "grid" and sheet.base == "paycomponent":
        return {"FOPayComponent"}
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


def _named_table(sheet: Sheet) -> str:
    """The table a grid names in brackets, as "EmpJob Values (EMPJOBHIST)" does: it breaks a tie between tables."""
    found = re.search(r"\(([A-Z][A-Z0-9_/]*)\)\s*$", sheet.raw or sheet.name)
    return found.group(1) if found else ""


def _candidates(sheet: Sheet, dictionary: Dictionary) -> dict[str, dict[str, Field]]:
    """The matched tables of a sheet, with the columns a person mapped by hand added to their table.

    A hand mapping names a field the dictionary holds, or it is ignored: a field name is never invented."""
    out = _matched(sheet, dictionary)
    for header, ref in sheet.mapped.items():
        table, _, name = ref.partition(".")
        found = dictionary.tables.get(table)
        if found and name in found.fields:
            for hits in out.values():
                hits.pop(header, None)
            out.setdefault(table, {})[header] = found.fields[name]
    return out


def apply_column_map(workbook: Workbook, column_map: dict[str, str]) -> None:
    """Put a saved column map, keyed "sheet::header", on the workbook's sheets."""
    for sheet in workbook.sheets:
        headers = {c.header for c in sheet.columns}
        sheet.mapped = {h: ref for key, ref in (column_map or {}).items()
                        for name, _, h in [key.partition("::")] if name == sheet.name and h in headers and ref}


def coverage(workbook: Workbook, dictionary: Dictionary) -> dict:
    """How many columns resolve to a dictionary field, without a run: per sheet, the best table's matches."""
    sheets = []
    for sheet in workbook.sheets:
        options = _candidates(sheet, dictionary)
        table = _pick(options, sheet, dictionary)
        hits = options.get(table, {}) if table else {}
        sheets.append({"name": sheet.name, "table": table, "columns": len(sheet.columns), "matched": len(hits),
                       "unmapped": [{"header": c.header, "id": c.id, "label": c.label, "mandatory": c.mandatory}
                                    for c in sheet.columns if c.header not in hits]})
    return {"columns": sum(s["columns"] for s in sheets), "matched": sum(s["matched"] for s in sheets),
            "sheets": sheets}


def _matched(sheet: Sheet, dictionary: Dictionary) -> dict[str, dict[str, Field]]:
    """Each table that could fill a sheet, with its matched column headers.

    A column matches a field of the sheet's own entity by property name. Keys also match by name across entities,
    because the person or user id is the same value on every entity. Nothing looser: a job's start date is not
    the employment's start date, although both are called start date."""
    entities = _entities(sheet, dictionary)
    if not entities:
        return _by_field(sheet, dictionary)
    out: dict[str, dict[str, Field]] = {}
    for table in dictionary.tables.values():
        fields = [f for f in table.fields.values() if f.source and "." in f.source and f.source.split(".")[0] in entities
                  # a related person's name is a dependant's, never the employee's own
                  and ("related person" not in f.source or "PerPersonRelationship" in entities)]
        if not fields:
            continue
        keys = {_norm(k): table.fields[k] for k in table.keys}
        keys |= {_norm(f.source.split(".", 1)[1]): table.fields[k]
                 for k in table.keys for f in [table.fields[k]] if f.source and "." in f.source}
        index = dict(keys)
        index |= {_norm((f.source or "").split(".", 1)[1].split(" ")[0]): f for f in fields}
        if "status" in index:  # foundation load files call the status field effectiveStatus
            index["effectivestatus"] = index["status"]
        if "externalcode" in index:  # friendly grids head the code column with the object's name
            index[sheet.base + "code"] = index["externalcode"]
        if "EmpEmployment" in entities and "company" not in index:  # at hire, the new assignment's company is the job's
            index.update({"company": f for f in table.fields.values() if f.source == "EmpJob.company"})
        hits = {}
        for col in sheet.columns:
            # name.en_US is the localised form of name.
            name = _norm(col.id).replace("centre", "center")
            # personInfo.person-id-external is the person's id reached through a navigation. Only a key matches by
            # its tail: cust_LegalEntity.externalCode is the legal entity's code, not this object's own.
            hit = index.get(name) or index.get(_norm(col.id.split(".")[0])) or keys.get(_norm(col.id.rsplit(".", 1)[-1]))
            if hit:
                hits[col.header] = hit
        if hits:
            out[table.name] = hits
    return out


_PROPERTY = re.compile(r"[A-Za-z][A-Za-z0-9_]*")


def _camel(column_id: str) -> str:
    """A column id as an OData property spelling: job-code and job code become jobCode, name.en_US name_en_US."""
    head, *rest = re.split(r"[-\s]+", column_id.strip().replace(".", "_"))
    return head + "".join(w[:1].upper() + w[1:] for w in rest)


def learned_property(column_id: str) -> str:
    """The property a column id is learned as: homeAddress.zip-code is homeAddress.zipCode, reached through the
    homeAddress navigation, while job-code is jobCode and a localised name.en_US stays name_en_US."""
    nav, dot, sub = column_id.partition(".")
    return f"{nav}.{_camel(sub)}" if dot and not _LOCALE.search(column_id) else _camel(column_id)


def learn(workbook: Workbook, dictionary: Dictionary) -> dict[str, dict[str, str]]:
    """Unmatched columns that name a plain property of their sheet's entity, as {TABLE: {FIELD: "Entity.property"}}.

    The workbook asks for a property the dictionary does not carry yet. It is added to the table that already reads
    most of that entity, so the next extraction asks for it. Extraction checks every property against the tenant's
    own $metadata and drops one the entity does not have, so a column is learned, never invented."""
    out: dict[str, dict[str, str]] = {}
    for sheet in workbook.sheets:
        entities = _entities(sheet, dictionary)
        if len(entities) != 1:
            continue
        entity = next(iter(entities))
        counts = {t.name: sum(1 for f in t.fields.values() if (f.source or "").split(".")[0] == entity)
                  for t in dictionary.tables.values() if t.provenance.startswith("canonical:successfactors")}
        home = max((t for t in counts if counts[t]), key=lambda t: (counts[t], t), default=None)
        if not home:  # no table reads this entity yet: the workbook adds one (source_design.with_learned)
            home = re.sub(r"[^A-Z0-9_]", "", entity.upper())
            if home in dictionary.tables:
                home = f"SF_{home}"
        matched = {h for hits in _candidates(sheet, dictionary).values() for h in hits}
        known = dictionary.tables.get(home)
        have = {(f.source or "").split(".", 1)[-1] for f in known.fields.values()} if known else set()
        for col in sheet.columns:
            # homeAddress.city is the city reached through the homeAddress navigation: it is learned as nav.prop,
            # which extraction reads with $expand after checking both names against the tenant's $metadata
            prop = learned_property(col.id)
            if (col.header in matched or _norm(col.id) in IMPORT_CONTROL or prop in have
                    or not all(_PROPERTY.fullmatch(p) for p in prop.split("."))):
                continue
            name = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", prop.replace(".", "_")).upper()
            if not known or name not in known.fields:
                out.setdefault(home, {})[name] = f"{entity}.{prop}"
    return out


def learn_sap(workbook: Workbook, dictionary: Dictionary, scope: set[str],
              lookup) -> tuple[dict[str, dict[str, str]], dict[str, list[str]]]:
    """Unmatched SAP columns resolved against the system's DD03L.

    A column naming its table is looked up on that table, in the object's `scope` or not. A bare field name is
    looked up across the object's tables in `scope`. A hit on a table the dictionary does not know is learned too:
    the caller reads that table's definition from the system's DDIC, so the next extraction reads the table.

    `lookup(tables, fields)` returns the (table, field) pairs DD03L holds. A field on exactly one in-scope table is
    learned as {TABLE: {FIELD: "TABLE.FIELD"}}, so the next extraction asks for it. The second result names, per
    column id, the tables that hold it when that is not exactly one: several is ambiguous and is not guessed, none is
    not in the system. Only names DD03L returns are learned."""
    scope = {t for t in scope if t in dictionary.tables}
    asks: dict[str, tuple[str, set[str]]] = {}
    for sheet in workbook.sheets:
        if _entities(sheet, dictionary):
            continue
        matched = {h for hits in _candidates(sheet, dictionary).values() for h in hits}
        for col in sheet.columns:
            if col.header in matched:
                continue
            table, name = re.sub(r"^S_", "", col.table.upper()), col.id.upper()
            split = re.fullmatch(r"([A-Z][A-Z0-9_/]*)[-.]([A-Z0-9_/]+)", name)
            if split and not table:
                table, name = re.sub(r"^S_", "", split.group(1)), split.group(2)
            if table:
                # a named table is asked about even outside the object's scope: the workbook says where it lives
                if table not in dictionary.tables or name not in dictionary.tables[table].fields:
                    asks[col.id] = (name, {table})
            elif _TECHNICAL.fullmatch(col.id) and not any(name in t.fields for t in dictionary.tables.values()):
                asks[col.id] = (name, scope)
    if not asks:
        return {}, {}
    found = lookup({t for _, ts in asks.values() for t in ts}, {n for n, _ in asks.values()})
    learned: dict[str, dict[str, str]] = {}
    unresolved: dict[str, list[str]] = {}
    for col_id, (name, tables) in asks.items():
        hits = sorted(t for t in tables if (t, name) in found)
        if len(hits) == 1:
            learned.setdefault(hits[0], {})[name] = f"{hits[0]}.{name}"
        else:
            unresolved[col_id] = hits
    return learned, unresolved


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


def _pick(options: dict, sheet, dictionary) -> Optional[str]:
    """The sheet's main table. A sheet that carries every key of a table keyed on a start or effective date takes
    that history table (EmpJob history for Job Info) over a current-record table with more matched columns,
    unless the sheet names its table."""
    def dated(t: str) -> bool:
        keys = set(dictionary.keys(t))
        return bool(keys & {"START_DATE", "EFFECTIVE_DATE"}) and keys <= {f.name for f in options[t].values()}
    return max(options, key=lambda t: (t == _named_table(sheet), dated(t), len(options[t])), default=None)


LOAD_MODES = {"full": "Full Purge", "incremental": "Incremental Load"}  # SuccessFactors Import Employee Data purge types
_DATED_KEYS = ("START_DATE", "EFFECTIVE_DATE")
_CHANGED = re.compile(r"\.lastModified(DateTime)?$")


def _when(values: pd.Series) -> pd.Series:
    return pd.to_datetime(values.astype("string"), errors="coerce", utc=True)


def _history_order(df: pd.DataFrame, table: str, dictionary: Dictionary) -> pd.DataFrame:
    """An effective-dated table in load order: by person, then start date, then sequence number. Every row stays."""
    keys = dictionary.keys(table)
    if not set(keys) & set(_DATED_KEYS):
        return df
    order = [k for k in keys if k not in (*_DATED_KEYS, "SEQ_NUMBER")][:1] + [k for k in keys if k in _DATED_KEYS]
    order += [k for k in keys if k == "SEQ_NUMBER"]
    cols = [c for c in (f"{table}.{k}" for k in order) if c in df.columns]

    def sort_key(s: pd.Series) -> pd.Series:
        name = str(s.name).split(".", 1)[1]
        if name in _DATED_KEYS:
            return _when(s)
        return pd.to_numeric(s, errors="coerce") if name == "SEQ_NUMBER" else s.astype("string")
    return df.sort_values(cols, key=sort_key, kind="stable", na_position="last") if cols else df


def _changed_field(dictionary: Dictionary, table: str, held: Any) -> Optional[Field]:
    """The held field an incremental load filters on: the record's last-modified time, else its start date."""
    t = dictionary.tables[table]
    stamp = next((f for f in t.fields.values() if (f.type or "").upper() in {"DATE", "DATETIME"}
                  and _CHANGED.search(f.source or "") and f.qualified in held), None)
    return stamp or next((t.fields[k] for k in t.keys if k in _DATED_KEYS and k in t.fields
                          and t.fields[k].qualified in held), None)


def _date_col(frames: TableFrames, table: str) -> Optional[str]:
    """The held column of a table keyed or dated on a start or effective date, used to line up history rows."""
    return next((f"{table}.{k}" for k in ("START_DATE", "EFFECTIVE_DATE")
                 if f"{table}.{k}" in frames.frames[table].columns), None)


def fill(workbook: Workbook, frames: TableFrames, value_maps: Optional[dict[str, dict[str, str]]] = None,
         strict: frozenset[str] | set[str] = frozenset(), *, load_mode: str = "full",
         since: Optional[date] = None) -> tuple[dict[str, pd.DataFrame], dict]:
    """The output tabs, and the report of what could and could not be filled.

    A column with no source is left empty and reported; it holds no row back, or a single unmapped field would
    empty the whole tab. A row is held back only when a value it does carry breaks the workbook's rules.

    `value_maps` are the confirmed source to target values, by target field. Under a `strict` target a value with no
    mapping holds its row back; other targets, such as configuration maps, keep the value as it is.

    A `full` load (the default) writes every history row of an effective-dated table, in person, start date and
    sequence order, and never filters on status, so inactive and terminated people stay. An `incremental` load
    keeps only rows changed on or after `since`, by the table's last-modified field or else its start date."""
    if load_mode not in LOAD_MODES:
        raise ValueError(f"load_mode must be one of {sorted(LOAD_MODES)}")
    if load_mode == "incremental" and since is None:
        raise ValueError("an incremental load needs a since date")
    maps = value_maps or {}
    unfiltered: list[str] = []
    start_date_only: list[str] = []
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
        table = _pick(present, sheet, frames.dictionary)
        hits = dict(present[table]) if table else {}
        # A sheet that spans several entities (a contingent worker's name, email and assignment) takes the columns
        # its main table lacks from another table, joined on that table's key. Only when the main table holds one
        # row per person, so a dependant's sheet never takes the employee's own name. A history table keyed on the
        # person and a date (EmpJob history, EmpCompensation) also joins, each row taking the record in force on its date.
        joins: dict[str, list[tuple[str, Any]]] = {}
        on: set[str] = set()
        if table and len(set(frames.dictionary.keys(table)) - {"START_DATE", "EFFECTIVE_DATE", "SEQ_NUMBER"}) == 1:
            for other in sorted(present, key=lambda t: -len(present[t])):
                other_keys = frames.dictionary.keys(other)
                if other == table or not other_keys:
                    continue
                key = other_keys[0]
                mine = frames.dictionary.field(table, key)
                if mine is None or mine.qualified not in frames.frames[table].columns:
                    continue
                for h, extra in present[other].items():
                    if h not in hits:
                        hits[h] = extra
                        joins.setdefault(other, []).append((key, extra))
                        on.add(mine.qualified)
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
                    if sum("-" in c.id for c in sheet.columns) * 2 > len(sheet.columns):  # kebab sheet: person-id-external
                        header = re.sub(r"(?<!^)(?=[A-Z])", "-", header).lower()
                    columns.insert(len(added), Column(header, header, f.description or key, mandatory=True))
                    hits[header] = f
                    added.append(header)
        control = [c.id for c in columns if c.header not in hits and _norm(c.id) in IMPORT_CONTROL]
        unmapped = sorted((c for c in columns if c.header not in hits and _norm(c.id) not in IMPORT_CONTROL),
                          key=lambda c: not c.mandatory)
        row: dict[str, Any] = {"name": sheet.name, "kind": sheet.kind, "table": table, "columns": len(columns), "added_keys": added,
               "control": control, "map": {h: f.qualified for h, f in hits.items()}, "mapped": [],
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
        joined = {f.qualified for fs in joins.values() for _, f in fs}
        changed = _changed_field(frames.dictionary, table, stored.columns) if load_mode == "incremental" else None
        my_date = _date_col(frames, table)
        reads = {*key_cols, *on, *(f.qualified for f in hits.values() if f.qualified not in joined),
                 *([country.qualified] if country else []), *([changed.qualified] if changed else []),
                 *([my_date] if my_date else [])}
        df = stored[list(reads)].copy()
        if load_mode == "incremental":
            row["since_field"] = changed.qualified if changed else None
            if changed:
                df = df[(_when(df[changed.qualified]) >= pd.Timestamp(since, tz="UTC")).fillna(False)]
                if changed.name in _DATED_KEYS:  # no last-modified field: a back-dated change is missed
                    start_date_only.append(sheet.name)
            else:
                unfiltered.append(sheet.name)
        from api.services.connectivity_manager import _asof_join, _primary_first  # lazy: avoids an import cycle
        for other, fs in joins.items():
            key = fs[0][0]
            mine = frames.dictionary.field(table, key)
            assert mine is not None  # checked when the join was planned
            cols = [f.qualified for _, f in fs]
            their_date = _date_col(frames, other)
            flag = f"{other}.IS_PRIMARY"
            held_other = frames.frames[other][[f"{other}.{key}", *cols, *(c for c in (their_date, flag)
                                                                        if c and c in frames.frames[other].columns)]]
            if my_date and their_date:
                left = pd.DataFrame({"__k": df[mine.qualified].to_numpy(),
                                     "__asof": pd.to_datetime(df[my_date], errors="coerce").to_numpy()})
                right = pd.DataFrame({"__k": held_other[f"{other}.{key}"].to_numpy(),
                                      "__asof": pd.to_datetime(held_other[their_date], errors="coerce").to_numpy(),
                                      **{c: held_other[c].to_numpy() for c in cols}})
                got = _asof_join(left, right, ["__k"])
                for c in cols:
                    df[c] = got[c].to_numpy()
                continue
            # First row per key wins (a person's first email), the primary record first where the table maps isPrimary.
            side = _primary_first(held_other, flag).drop_duplicates(f"{other}.{key}").set_index(f"{other}.{key}")
            for c in cols:
                df[c] = df[mine.qualified].map(side[c])
        df = _history_order(df, table, frames.dictionary)
        keys = record_keys(df, key_cols)
        bad = pd.Series(False, index=df.index)
        dated = [c for c in key_cols if c.split(".", 1)[1] in _DATED_KEYS]
        if dated:  # two rows for one person, start date and sequence: the load would keep only one
            dup = df.duplicated(key_cols, keep="first")
            if dup.any():
                bad |= dup
                reasons["duplicate_effective_record"] += int(dup.sum())
                held.extend({"sheet": sheet.name, "record": k, "field": dated[0].split(".", 1)[1],
                             "reason": "duplicate_effective_record",
                             "detail": "Duplicate effective record: another row has the same person, start date "
                                       "and sequence number."} for k in keys[dup])
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
                row["mapped"].append(col.header)  # round trip skips these: the cell no longer holds the SAP value
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
        missing = {c.id: int((values[c.header].astype("string").fillna("").str.strip() == "").sum())
                   if c.header in values else len(df) for c in columns if c.mandatory and not c.country}
        row.update(rows=len(df), ready=int((~bad).sum()), held=int(bad.sum()),
                   mandatory_missing={k: v for k, v in missing.items() if v},
                   people=int(df[key_cols[0]].nunique()) if key_cols else len(df))

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
            "load_mode": load_mode, "since": since.isoformat() if since else None,
            "mandatory_missing": sum(sum(r.get("mandatory_missing", {}).values()) for r in report),
            "incremental_unfiltered": unfiltered,
            "start_date_only": start_date_only,
        },
        "purge_type": LOAD_MODES[load_mode] if any(
            frames.dictionary.tables[r["table"]].provenance == "canonical:successfactors" for r in known) else None,
        "format": {
            "id": source.format if source else "xlsx", "same": bool(source and tabs and same),
            "written_as": written_as(source, files, bool(held)) if source else "xlsx",
            "skipped": source.skipped if source else [],
        },
        "country_unchecked": unchecked, "sheets": report, "reasons": dict(reasons), "held": held,
    }


def same_format(workbook: Workbook, tabs: dict[str, pd.DataFrame], held_csv: Optional[bytes]) -> tuple[bytes, str]:
    """The filled tabs written back in the upload's own layout, each value in its column's own place."""
    assert workbook.source is not None, "only an uploaded file has a layout to write back"
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


_NUMERIC = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP", "D16D", "D34D"}
VALUES_SHOWN = 50  # a longer value list is named by its check table, not written out


def blank_template(dictionary: Dictionary, rules: list[dict], target_values: dict[str, set[str]]) -> dict[str, pd.DataFrame]:
    """A blank load template for a module, in the Migration Cockpit layout this module parses back.

    The Field List names every field the module's rules read, plus each table's keys, with its description, whether
    it is required (a key or a field a completeness rule checks), its type and length, and the values it may take: the
    rule's own list first, then the domain's fixed values, then the target's check table values. One data sheet per
    table carries the field ids in row 1 and their descriptions in row 2. Only dictionary fields are listed.

    A SuccessFactors module gets the SuccessFactors import layout instead (see _sf_template)."""
    wanted: dict[str, set[str]] = {}
    required: set[str] = set()
    ruled: dict[str, list[str]] = {}
    for rule in rules:
        ref = rule.get("field")
        if not isinstance(ref, str) or "." not in ref:
            continue
        table, name = ref.split(".", 1)
        if dictionary.tables.get(table) is None or name not in dictionary.tables[table].fields:
            continue
        wanted.setdefault(table, set()).add(name)
        if rule.get("check_class") == "null_check":
            required.add(ref)
        values = rule.get("valid_values") or list((rule.get("valid_values_with_labels") or {}).keys())
        if values and ref not in ruled:
            ruled[ref] = [str(v) for v in values]

    def values_of(f: Field) -> str:
        values = ruled.get(f.qualified) or sorted(f.allowed_values() or target_values.get(f.check_ref or "", set()))
        return ", ".join(values) if 0 < len(values) <= VALUES_SHOWN else ""

    def columns_of(table: str) -> list[Field]:
        t = dictionary.tables[table]
        return [t.fields[n] for n in [k for k in t.keys if k in t.fields] + sorted(wanted[table] - set(t.keys))]

    if any("." in (f.source or "") for table in wanted for f in columns_of(table)):
        return _sf_template(dictionary, {t: columns_of(t) for t in sorted(wanted)}, required, values_of)
    listing, sheets = [], {}
    for table in sorted(wanted):
        t = dictionary.tables[table]
        sheet = table[:31].replace("/", "_")
        fields = columns_of(table)
        for f in fields:
            kind = "Date" if f.type == "DATS" else "Number" if (f.type or "") in _NUMERIC else "Text"
            listing.append({
                "Sheet Name": sheet, "SAP Structure": table, "SAP Field": f.name, "Field Description": f.description,
                "Importance": "Mandatory" if f.name in t.keys or f.qualified in required else "Optional",
                "Type": kind, "Length": f.length or "", "Allowed values": values_of(f), "Check table": f.check_ref or "",
            })
        sheets[sheet] = pd.DataFrame([[f.description for f in fields]], columns=[f.name for f in fields])
    return {"Field List": pd.DataFrame(listing, columns=[
        "Sheet Name", "SAP Structure", "SAP Field", "Field Description", "Importance", "Type", "Length",
        "Allowed values", "Check table"])} | sheets


_SF_TYPES = {"DATE": "date", "DATETIME": "date", "INTEGER": "long", "DECIMAL": "decimal", "BOOLEAN": "boolean"}
# A country-specific entity set loads through the sheet the import templates name it by, never by its own name.
_SF_SHEETS = {"FOJobClassLocal*": "CSF Job Classification", "FOLegalEntityLocal*": "CSF Legal Entity",
              "PerGlobalInfo*": "CSF Personal Info Global Info"}


def _sf_grid_name(sheet: str, table: str, split: bool) -> Optional[str]:
    """A grid's tab name, within the 31 characters Excel allows. A split grid names its table in brackets."""
    names = [f"{sheet} Values ({table})", f"{sheet} Data ({table})"] if split else [f"{sheet} Values", f"{sheet} Data"]
    return next((name for name in names if len(name) <= 31 and len(sheet) <= 31), None)


def _sf_template(dictionary: Dictionary, tables: dict[str, list[Field]], required: set[str], values_of) -> dict:
    """The SuccessFactors import layout: per entity, a definition sheet and a grid of its property ids.

    An entity spread over several tables gets one grid per table, named "<Entity> Values (<TABLE>)", so each grid
    loads one table. A field with no SuccessFactors property (an ECC infotype), or whose entity cannot name a tab
    (its name, with the table, is longer than Excel allows), goes on a technical grid of TABLE-FIELD ids. Only
    dictionary fields are written, so no field name is guessed."""
    def entity(f: Field) -> str:
        src = f.source or ""
        return src.split(".", 1)[0] if "." in src else ""

    spread: dict[str, set[str]] = {}
    for table, fields in tables.items():
        for f in fields:
            if entity(f):
                spread.setdefault(entity(f), set()).add(table)
    definitions: dict[str, dict[str, dict]] = {}
    grids: dict[str, dict[str, Field]] = {}
    for table, fields in tables.items():
        t = dictionary.tables[table]
        keys = [f for f in fields if f.name in t.keys]
        technical = [f for f in fields if not entity(f)]
        for name in sorted({entity(f) for f in fields if entity(f)}):
            sheet = _SF_SHEETS.get(name, name)
            own = [f for f in fields if entity(f) == name]
            grid = "*" not in sheet and _sf_grid_name(sheet, table, len(spread[name]) > 1)
            if not grid:
                technical += own
                continue
            columns = grids.setdefault(grid, {})
            for f in keys + own:  # a key is written once, by its own property name
                columns.setdefault((f.source or "").split(".", 1)[1].split(" ")[0] if entity(f) else f.name, f)
            rows = definitions.setdefault(sheet, {})
            for prop, f in columns.items():
                row = rows.setdefault(prop, {
                    "System Field ID": prop, "SF Label": f.description,
                    "Type": "picklist" if f.picklist else _SF_TYPES.get((f.type or "").upper(), "string"),
                    "Max Length": f.length or "", "Mandatory": "", "Picklist": f.picklist or "",
                    "Allowed values": values_of(f), "SAP Structure": [], "SAP Field": []})
                if f.name in t.keys or f.qualified in required:
                    row["Mandatory"] = "Yes"
                if f.qualified not in {f"{a}.{b}" for a, b in zip(row["SAP Structure"], row["SAP Field"])}:
                    row["SAP Structure"].append(table)
                    row["SAP Field"].append(f.name)
        if technical:
            columns = grids.setdefault(f"SAP {table} Data"[:31], {})
            for f in keys + [f for f in technical if f not in keys]:
                columns.setdefault(f"{table}-{f.name}", f)
    out = {sheet: pd.DataFrame([r | {"SAP Structure": ", ".join(r["SAP Structure"]),
                                     "SAP Field": ", ".join(r["SAP Field"])} for r in rows.values()])
           for sheet, rows in definitions.items()}
    return out | {grid: pd.DataFrame([[f.description for f in columns.values()]], columns=list(columns))
                  for grid, columns in grids.items()}


INSTRUCTIONS_TAB = "Load instructions"
GENERATED_NOTE = "generated from metadata; replace with the tenant's downloaded template if its headers differ"


def instructions(load_mode: str = "full", since: Optional[date] = None, sheets: Optional[list[dict]] = None,
                 generated: list[str] | tuple[str, ...] = ()) -> pd.DataFrame:
    """The cover sheet of a SuccessFactors load: the load mode, the purge type to pick on import, and per sheet the
    rows written and the mandatory values still missing."""
    if load_mode == "incremental":
        rows = [("Load mode", f"Incremental: only records changed on or after {since.isoformat() if since else '(no date)'}."),
                ("Purge type", "Choose Incremental Load in Import Employee Data. Records not in the file stay as "
                               "they are in the tenant.")]
    else:
        rows = [("Load mode", "Full: every effective-dated record of each person, in start date and sequence order. "
                              "Inactive and terminated people are included where the extract holds them."),
                ("Purge type", "Choose Full Purge in Import Employee Data. Each person's history in the tenant is "
                               "replaced by the rows in this file, so load every sheet complete.")]
    for r in sheets or []:
        if not r.get("table"):
            continue
        missing = ", ".join(f"{k} ({v})" for k, v in (r.get("mandatory_missing") or {}).items()) or "none"
        rows.append((f"Sheet {r['name']}", f"{r['rows']} rows for {r.get('people', 0)} records; {r['ready']} ready, "
                                           f"{r['held']} held back; mandatory values missing: {missing}."))
    rows += [(f"Sheet {name}", GENERATED_NOTE.capitalize() + ".") for name in generated]
    return pd.DataFrame(rows, columns=["Topic", "Detail"])


def sf_load_templates(dictionary: Dictionary, target_values: dict[str, set[str]]) -> dict[str, pd.DataFrame]:
    """A load template for every SuccessFactors entity the dictionary describes, in the import layout of _sf_template.

    Headers are the dictionary's own property names, never guessed. A table whose fields carry no SuccessFactors
    entity (a payroll export) is left out. Every sheet is marked as generated, since a tenant's downloaded template
    is the authority on its headers."""
    tables: dict[str, list[Field]] = {}
    for name, t in sorted(dictionary.tables.items()):
        if t.provenance != "canonical:successfactors":
            continue
        own = [f for f in t.fields.values()
               if re.fullmatch(r"[A-Z][A-Za-z0-9_]*\.[A-Za-z][\w.]*", (f.source or "").split(" ")[0])]
        if own:
            keys = [t.fields[k] for k in t.keys if k in t.fields]
            tables[name] = keys + [f for f in own if f not in keys]

    def values_of(f: Field) -> str:
        values = sorted(f.allowed_values() or target_values.get(f.check_ref or "", set()))
        return ", ".join(values) if 0 < len(values) <= VALUES_SHOWN else ""

    tabs = _sf_template(dictionary, tables, set(), values_of)
    return {INSTRUCTIONS_TAB: instructions(generated=sorted(tabs))} | tabs
