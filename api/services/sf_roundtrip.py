"""Clean in Excel, upload back, re-score.

An exported SuccessFactors file (the filled migration template or the cleaning workbook) carries a hidden
``_meridian`` sheet naming the run it came from. The edited file is read back, its edits are written into a copy
of that run's extraction bundle, and the copy is analysed as the next run of the same lineage.

Nothing in the uploaded file is executed: cells are read as cached values, and every value is stored as text.
"""
import datetime as dt
import io
import json
import re
from typing import Any, Optional

MARKER = "_meridian"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_EDIT_ROWS = 200_000
KINDS = ("template", "cleaning")
CLEAR = "#CLEAR"  # a cell holding only this empties the field; a blank cell is never an edit
NOTE_STATUSES = {"in progress": "in_progress", "not an error": "not_an_error", "fixed": "fixed"}


class RoundTripError(ValueError):
    """The file cannot be applied; the message is shown to the person."""


class InvalidValues(RoundTripError):
    """Cells that cannot be applied, each ``{"sheet", "row", "field", "reason"}`` (row as Excel numbers it)."""

    def __init__(self, rows: list[dict]):
        super().__init__(f"{len(rows)} cell{'s' if len(rows) != 1 else ''} in the file cannot be applied. "
                         "Fix them and upload the file again; nothing was changed.")
        self.rows = rows


EXCEL_ERRORS = {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#SPILL!", "#CALC!",
                "#GETTING_DATA", "#FIELD!", "#BLOCKED!", "#CONNECT!", "#BUSY!", "#UNKNOWN!"}
FORMULA_START = ("=", "@", "\t", "\r")
_E_NOTATION = re.compile(r"[+-]?\d(\.\d+)?[eE][+-]\d+")
_ISO_DATE = re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?")
MAX_EXACT_DIGITS = 15  # Excel keeps 15 significant digits of a number; a longer one is already rounded


def cell_problem(value: str) -> Optional[str]:
    """Why a corrected value cannot be taken as typed, or None. Excel errors, formulas and numbers Excel has
    rounded into E-notation are refused rather than guessed at."""
    v = value.strip()
    if v.upper() in EXCEL_ERRORS:
        return f"holds the Excel error {v.upper()}; type the value itself"
    lead = value.lstrip(" \n")
    if lead.startswith(FORMULA_START) or (lead[:1] in "+-" and any(c in lead for c in "(|!")):
        return "starts like a formula; type the value without a leading = + - or @ (or put an apostrophe first)"
    if _E_NOTATION.fullmatch(v):
        return (f"is a number Excel shows in E-notation, which keeps only {MAX_EXACT_DIGITS} digits; format the "
                "cell as Text and type the full value")
    return None


def marker_rows(version_id: str, module: str, kind: str, maps: Optional[dict] = None, extra: Optional[dict] = None) -> list[dict]:
    """The hidden fingerprint: run, object, kind, and (api/services/upload_checks.py) tenant, system, template id and
    version, column-set hash, record count, generated time."""
    from api.services.upload_checks import TEMPLATE_VERSIONS

    extra = {"template_id": kind, "template_version": str(TEMPLATE_VERSIONS[kind]), **(extra or {})}
    rows = [{"key": "version_id", "value": version_id}, {"key": "module", "value": module}, {"key": "kind", "value": kind}]
    rows += [{"key": k, "value": v} for k, v in extra.items()]
    # one row per sheet: a cell holds 32,767 characters at most
    rows += [{"key": "sheet", "value": json.dumps({"name": n, **m}, separators=(",", ":"))} for n, m in (maps or {}).items()]
    return rows


def stamp_xlsx(data: bytes, version_id: str, module: str, maps: dict, extra: Optional[dict] = None) -> bytes:
    """The template workbook with the hidden marker sheet added."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data))
    ws = wb.create_sheet(MARKER)
    ws.append(["key", "value"])
    for r in marker_rows(version_id, module, "template", maps, extra):
        ws.append([r["key"], r["value"]])
    ws.sheet_state = "hidden"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _text(v) -> str:
    """A cell as the text it was exported as: whole numbers lose the float tail, blanks are empty, a date cell is
    an ISO date (apply_edits writes it in the field's format). A number too long for Excel to hold exactly comes
    out in E-notation, which cell_problem refuses."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time() else v.isoformat(timespec="seconds")
    if isinstance(v, (dt.date, dt.time)):
        return v.isoformat()
    if isinstance(v, (int, float)) and abs(v) >= 10 ** MAX_EXACT_DIGITS:
        return f"{float(v):.{MAX_EXACT_DIGITS - 1}E}"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def read_upload(data: bytes, filename: str) -> dict:
    """Validate and read the file: ``{"sheets": [(name, rows)], "marker": dict}``. Raises RoundTripError."""
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("xlsx", "csv"):
        raise RoundTripError("Upload the Excel (.xlsx) or CSV file you exported.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise RoundTripError("The file is larger than 25 MB.")
    if (ext == "xlsx") != (data[:4] == b"PK\x03\x04"):
        raise RoundTripError("The file content does not match its extension.")
    from api.services.migration.workbook_formats import WorkbookError, read_source

    try:
        source = read_source(data, filename)
    except WorkbookError as e:
        raise RoundTripError(str(e))
    if source.format not in ("xlsx", "delimited"):
        raise RoundTripError("Upload the Excel (.xlsx) or CSV file you exported.")
    sheets = [(n, [tuple(_text(c) for c in r) for r in rows]) for n, rows in source.sheets]
    if sum(len(r) for _, r in sheets) > MAX_EDIT_ROWS:
        raise RoundTripError(f"The file has more than {MAX_EDIT_ROWS:,} rows.")
    marker: dict = {}
    for name, rows in sheets:
        if name == MARKER:
            try:
                for r in rows[1:]:
                    if len(r) > 1 and r[0] == "sheet":
                        m = json.loads(r[1])
                        marker.setdefault("map", {})[m.pop("name")] = m
                    elif len(r) > 1 and r[0]:
                        marker[r[0]] = r[1]
            except (ValueError, KeyError, TypeError):
                raise RoundTripError("The marker in this file is damaged. Choose the run it came from.")
    return {"sheets": [(n, r) for n, r in sheets if n != MARKER], "marker": marker, "ext": ext}


def field_name(label: str, table: str) -> str:
    """The field from the workbook's Field cell: ``MARA.MATKL (Material Group)`` on table MARA is ``MATKL``.
    The description in brackets comes from cleaning_workbook.field_label; a field of another table keeps its
    table prefix, so apply_edits looks it up by its qualified column name."""
    name = label.split(" (", 1)[0].strip()
    return name[len(table) + 1:] if table and name.startswith(table + ".") else name


def _value(cell: str) -> str:
    """The value a cell sets: #CLEAR empties the field; the apostrophe the export put before text that starts
    like a formula is dropped, so the value goes back as it was (as text, never evaluated)."""
    if cell.strip().upper() == CLEAR:
        return ""
    if cell.startswith("'") and cell[1:].lstrip(" \n").startswith(FORMULA_START + ("+", "-")):
        return cell[1:]
    return cell


class _Cells:
    """Collects the edits of one file: refuses bad values and a cell set twice to different values."""

    def __init__(self) -> None:
        self.edits: list[dict] = []
        self.errors: list[dict] = []
        self._seen: dict[tuple, tuple[str, list[int], str]] = {}

    def bad(self, sheet: str, row: int, field: str, reason: str) -> None:
        self.errors.append({"sheet": sheet, "row": row, "field": field, "reason": reason})

    def add(self, sheet: str, row: int, edit: dict, raw: str) -> None:
        problem = cell_problem(raw)
        if problem:
            return self.bad(sheet, row, edit["field"], f"The value {problem}.")
        cell = (edit["table"], edit["key"], edit["field"])
        seen = self._seen.get(cell)
        if seen is None:
            self._seen[cell] = (edit["value"], [row], sheet)
            self.edits.append(edit)
        elif seen[0] == edit["value"]:
            seen[1].append(row)  # the same correction twice is one edit
        else:
            self.bad(sheet, row, edit["field"], f"Record {edit['key']} field {edit['field']} is given different "
                     f"values on rows {', '.join(map(str, seen[1] + [row]))}; keep one.")

    def result(self) -> list[dict]:
        if self.errors:
            raise InvalidValues(self.errors)
        return self.edits


def _record_rows(sheets: list, need: tuple[str, ...]):
    """``(sheet, row, get)`` for every data row of the cleaning workbook's record sheets; row as Excel numbers it."""
    for name, rows in sheets:
        if not name.startswith("Records to clean") or not rows:
            continue
        head = {h: i for i, h in enumerate(rows[0])}
        if any(h not in head for h in need):
            raise RoundTripError(f"The sheet {name} is missing one of: {', '.join(need)}.")
        for n, r in enumerate(rows[1:], start=2):
            yield name, n, (lambda h, r=r: r[head[h]] if h in head and head[h] < len(r) else "")


def cleaning_edits(sheets: list, keys_of=None) -> tuple[list[dict], int]:
    """Edits from the cleaning workbook's record sheets, and how many rows had no corrected value.
    ``keys_of(table)`` names the table's key fields: a corrected value on one would move the record to another
    key, so it is refused. Raises InvalidValues listing every refused cell."""
    cells = _Cells()
    blank = 0
    for sheet, row, get in _record_rows(sheets, ("Table", "Record key", "Field", "Corrected value")):
        raw = get("Corrected value")
        if not raw:
            blank += 1
            continue
        table = get("Table")
        field = field_name(get("Field"), table)
        if keys_of and field.split(".")[-1] in (keys_of(table) or ()):
            cells.bad(sheet, row, field, f"{field} is a key field of {table}; a corrected value would change which "
                      "record this is. Fix keys in the source system.")
            continue
        cells.add(sheet, row, {"table": table, "key": get("Record key"), "field": field, "value": _value(raw)}, raw)
    return cells.result(), blank


def cleaning_notes(sheets: list) -> list[dict]:
    """Status, Owner and Comment set on record rows: ``{"rule", "table", "key", "status", "owner", "comment"}``.
    ``status`` is in_progress, not_an_error, fixed or "" (Open, or unknown text, changes nothing)."""
    out: list[dict] = []
    for _, _, get in _record_rows(sheets, ()):  # cleaning_edits checks the columns; a row with no Rule has no note
        status = NOTE_STATUSES.get(get("Status").strip().lower(), "")
        owner, comment = get("Owner").strip()[:200], get("Comment").strip()[:2000]
        if (status or owner or comment) and get("Rule") and get("Record key"):
            out.append({"rule": get("Rule"), "table": get("Table"), "key": get("Record key"), "status": status,
                        "owner": owner, "comment": comment})
    return out


def template_edits(sheets: list, maps: dict, keys_of) -> tuple[list[dict], dict]:
    """Edits from the filled template. ``maps`` is ``{sheet: {"table", "map": {header: TABLE.FIELD},
    "mapped": [headers]}}``; ``keys_of(table)`` the table's key field names. Returns edits and
    ``{"unmapped": {sheet: [headers]}, "skipped": {sheet: reason}}``."""
    cells = _Cells()
    report: dict = {"unmapped": {}, "skipped": {}}
    for name, rows in sheets:
        if not rows:
            continue
        m = maps.get(name)
        if not m or not m.get("table"):
            report["skipped"][name] = "not a sheet of the exported template"
            continue
        table = m["table"]
        cols = {h: q.split(".", 1)[1] for h, q in m["map"].items() if q.startswith(table + ".") and h not in m.get("mapped", [])}
        head = {h: i for i, h in enumerate(rows[0])}
        report["unmapped"][name] = [h for h in rows[0] if h and h not in m["map"]]
        keys = keys_of(table)
        by_field = {f: h for h, f in cols.items()}
        if not keys or any(k not in by_field or by_field[k] not in head for k in keys):
            report["skipped"][name] = "its key columns are not in the sheet, so rows cannot be matched"
            continue
        for n, r in enumerate(rows[1:], start=2):
            get = lambda h: r[head[h]] if head[h] < len(r) else ""  # noqa: E731
            key = "|".join(f"{k}={get(by_field[k])}" for k in keys)
            for h, f in cols.items():
                # a blank cell is never an edit (the export blanks held and zero dates); #CLEAR empties a field
                if h in head and f not in keys and get(h):
                    cells.add(name, n, {"table": table, "key": key, "field": f, "value": _value(get(h)), "cell": True},
                              get(h))
    return cells.result(), report


_DIGITS = re.compile(r"\d+")


def normalise(value: str, ftype: Optional[str], length: int = 0, old: str = "", alpha: bool = False) -> str:
    """The corrected value in the form the field stores. Dates typed or read as dates go to the field's date
    format (DATS YYYYMMDD, DATE YYYY-MM-DD, DATETIME ISO, TIMS HHMMSS); NUMC and ALPHA-converted numbers get
    their leading zeros back. Without a type the stored value's own shape decides."""
    if not value:
        return value
    t = (ftype or "").upper()
    m = _ISO_DATE.fullmatch(value.strip())
    if m:
        y, mo, d, hh, mm, ss = m.groups()
        timed = hh is not None and (hh, mm, ss or "00") != ("00", "00", "00")
        if not t:  # match how the run stores this field
            t = "DATS" if _DIGITS.fullmatch(old) and len(old) == 8 else "DATETIME" if "T" in old else "DATE"
        if t == "DATS":
            return f"{y}{mo}{d}"
        if t == "DATE" and not timed:
            return f"{y}-{mo}-{d}"
        if t in ("DATE", "DATETIME"):
            return f"{y}-{mo}-{d}T{hh or '00'}:{mm or '00'}:{ss or '00'}"
    if t == "TIMS" and re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", value.strip()):
        return (value.strip().replace(":", "") + "00")[:6]
    if _DIGITS.fullmatch(value):
        if (t == "NUMC" or alpha) and length and len(value) < length:
            return value.zfill(length)
        if t in ("", "CHAR") and len(old) > len(value) and old.startswith("0") and _DIGITS.fullmatch(old):
            return value.zfill(len(old))  # Excel dropped the leading zeros of a number typed into the cell
    return value


def _write(df, rows: list[int], c: str, value: str) -> None:
    """Write the value into rows of column c keeping the column's type: a number stays a number, a date a
    date; anything else makes the column text (pandas string), never a mixed object column."""
    import pandas as pd

    s = df[c]
    loc = df.columns.get_loc(c)
    kind = s.dtype.kind
    try:
        if kind in "iuf":
            if value == "":
                df[c] = s.astype("Float64" if kind == "f" else "Int64")
                df.iloc[rows, loc] = pd.NA
                return
            num = float(value)
            if kind in "iu" and num.is_integer():
                df.iloc[rows, loc] = int(num)
            else:
                if kind != "f":
                    df[c] = s.astype("float64")
                df.iloc[rows, loc] = num
            return
        if kind == "b" and value.lower() in ("true", "false", ""):
            if value == "":
                df[c] = s.astype("boolean")
                df.iloc[rows, loc] = pd.NA
            else:
                df.iloc[rows, loc] = value.lower() == "true"
            return
        if kind == "M":
            ts = pd.NaT if value == "" else pd.Timestamp(value)
            if ts is pd.NaT or s.dt.tz is None:
                df.iloc[rows, loc] = ts
                return
    except (ValueError, TypeError):
        pass
    if not isinstance(s.dtype, pd.StringDtype):
        df[c] = s.astype("string")
    df.iloc[rows, loc] = value


def apply_edits(parent_prefix: str, new_prefix: str, edits: list[dict], dictionary,
                conflicts: frozenset = frozenset(), dry: bool = False) -> dict:
    """Copy the parent bundle to ``new_prefix`` with the edits written in. Returns the counts and the edits
    that matched nothing, as ``{"applied", "unchanged", "unmatched": [..], "no_table", "no_field", "conflicts"}``.

    ``conflicts`` holds ``(table, key, field)`` cells another upload changed after this file was exported: an
    edit there is not applied (the other person's value stays) unless it sets the same value."""
    import pandas as pd
    from urllib.parse import unquote

    from api.config import settings
    from api.services.storage import get_minio_client, list_prefix, upload_file
    from checks.base import record_keys

    from minio.commonconfig import CopySource

    bucket = settings.minio_bucket_uploads
    client = get_minio_client()
    by_table: dict[str, list[dict]] = {}
    for e in edits:
        by_table.setdefault(e["table"], []).append(e)
    out: dict[str, Any] = {"applied": 0, "unchanged": 0, "unmatched": [], "no_table": sorted(set(by_table)), "no_field": [],
                           "edited": [], "conflicts": []}
    field_of = getattr(dictionary, "field", None)
    objects = list_prefix(bucket, parent_prefix)
    if not any(n.endswith(".parquet") for n, _ in objects):
        raise RoundTripError("The run has no extracted tables to edit.")
    for name, _ in objects:
        target = new_prefix + name[len(parent_prefix):]
        table = unquote(name.rsplit("/", 1)[-1][: -len(".parquet")]) if name.endswith(".parquet") else None
        if table not in by_table:
            if not dry:
                client.copy_object(bucket, target, CopySource(bucket, name))
            continue
        out["no_table"].remove(table)
        resp = client.get_object(bucket, name)
        try:
            df = pd.read_parquet(io.BytesIO(resp.read()))
        finally:
            resp.close()
        col = lambda f: next((c for c in (f"{table}.{f}", f) if c in df.columns), None)  # noqa: E731
        key_cols = [c for c in (col(k) for k in dictionary.keys(table)) if c]
        index: dict[str, list[int]] = {}
        for i, k in enumerate(record_keys(df, key_cols)):
            index.setdefault(k, []).append(i)
        for e in by_table[table]:
            c = col(e["field"])
            if c is None:
                if e["field"] not in out["no_field"]:
                    out["no_field"].append(e["field"])
                continue
            rows = index.get(e["key"])
            if not rows:
                out["unmatched"].append({"table": table, "key": e["key"], "field": e["field"]})
                continue
            old = df[c].iloc[rows[0]]
            old_text = "" if pd.isna(old) else _text(old)
            meta = None
            if field_of:
                t, f = e["field"].split(".", 1) if "." in e["field"] else (table, e["field"])
                meta = field_of(t, f)
            value = normalise(e["value"], getattr(meta, "type", None), getattr(meta, "length", 0) or 0, old_text,
                              getattr(meta, "conversion_exit", None) == "ALPHA")
            if old_text == value:
                out["unchanged"] += 1
                continue
            if (table, e["key"], e["field"]) in conflicts:
                out["conflicts"].append({"table": table, "key": e["key"], "field": e["field"], "value": value,
                                         "current": old_text})
                continue
            _write(df, rows, c, value)
            out["applied"] += len(rows)
            out["edited"].append({"table": table, "key": e["key"], "field": e["field"]})
        if dry:  # a check run: nothing is written
            continue
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        upload_file(bucket, target, buf.getvalue(), "application/octet-stream")
    out["total"] = len(edits)
    out["unmatched_total"] = len(out["unmatched"])
    out["unmatched"] = out["unmatched"][:200]
    out["conflicts_total"] = len(out["conflicts"])
    out["conflicts"] = out["conflicts"][:200]
    return out


def drop_staging(prefix: str) -> None:
    """Remove a failed copy's objects (best effort: a leftover is harmless, never re-read)."""
    from api.config import settings
    from api.services.storage import get_minio_client, list_prefix

    bucket = settings.minio_bucket_uploads
    client = get_minio_client()
    for name, _ in list_prefix(bucket, prefix):
        try:
            client.remove_object(bucket, name)
        except Exception:  # noqa: BLE001,S112 - cleanup must not mask the real error
            continue
