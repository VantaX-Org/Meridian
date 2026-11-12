"""Clean in Excel, upload back, re-score.

An exported SuccessFactors file (the filled migration template or the cleaning workbook) carries a hidden
``_meridian`` sheet naming the run it came from. The edited file is read back, its edits are written into a copy
of that run's extraction bundle, and the copy is analysed as the next run of the same lineage.

Nothing in the uploaded file is executed: cells are read as cached values, and every value is stored as text.
"""
import io
import json
from typing import Any, Optional

MARKER = "_meridian"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_EDIT_ROWS = 200_000
KINDS = ("template", "cleaning")
CLEAR = "#CLEAR"  # a cell holding only this empties the field; a blank cell is never an edit
NOTE_STATUSES = {"in progress": "in_progress", "not an error": "not_an_error", "fixed": "fixed"}


class RoundTripError(ValueError):
    """The file cannot be applied; the message is shown to the person."""


def marker_rows(version_id: str, module: str, kind: str, maps: Optional[dict] = None) -> list[dict]:
    rows = [{"key": "version_id", "value": version_id}, {"key": "module", "value": module}, {"key": "kind", "value": kind}]
    # one row per sheet: a cell holds 32,767 characters at most
    rows += [{"key": "sheet", "value": json.dumps({"name": n, **m}, separators=(",", ":"))} for n, m in (maps or {}).items()]
    return rows


def stamp_xlsx(data: bytes, version_id: str, module: str, maps: dict) -> bytes:
    """The template workbook with the hidden marker sheet added."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data))
    ws = wb.create_sheet(MARKER)
    ws.append(["key", "value"])
    for r in marker_rows(version_id, module, "template", maps):
        ws.append([r["key"], r["value"]])
    ws.sheet_state = "hidden"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _text(v) -> str:
    """A cell as the text it was exported as: whole numbers lose the float tail, blanks are empty."""
    if v is None:
        return ""
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
    return "" if cell.strip().upper() == CLEAR else cell


def _record_rows(sheets: list, need: tuple[str, ...]):
    """A cell getter for every data row of the cleaning workbook's record sheets."""
    for name, rows in sheets:
        if not name.startswith("Records to clean") or not rows:
            continue
        head = {h: i for i, h in enumerate(rows[0])}
        if any(h not in head for h in need):
            raise RoundTripError(f"The sheet {name} is missing one of: {', '.join(need)}.")
        for r in rows[1:]:
            yield lambda h, r=r: r[head[h]] if h in head and head[h] < len(r) else ""


def cleaning_edits(sheets: list) -> tuple[list[dict], int]:
    """Edits from the cleaning workbook's record sheets, and how many rows had no corrected value."""
    out: list[dict] = []
    blank = 0
    for get in _record_rows(sheets, ("Table", "Record key", "Field", "Corrected value")):
        if not get("Corrected value"):
            blank += 1
            continue
        out.append({"table": get("Table"), "key": get("Record key"), "field": field_name(get("Field"), get("Table")),
                    "value": _value(get("Corrected value"))})
    return out, blank


def cleaning_notes(sheets: list) -> list[dict]:
    """Status, Owner and Comment set on record rows: ``{"rule", "table", "key", "status", "owner", "comment"}``.
    ``status`` is in_progress, not_an_error, fixed or "" (Open, or unknown text, changes nothing)."""
    out: list[dict] = []
    for get in _record_rows(sheets, ()):  # cleaning_edits checks the columns; a row with no Rule has no note
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
    edits: list[dict] = []
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
        for r in rows[1:]:
            get = lambda h: r[head[h]] if head[h] < len(r) else ""  # noqa: E731
            key = "|".join(f"{k}={get(by_field[k])}" for k in keys)
            for h, f in cols.items():
                # a blank cell is never an edit (the export blanks held and zero dates); #CLEAR empties a field
                if h in head and f not in keys and get(h):
                    edits.append({"table": table, "key": key, "field": f, "value": _value(get(h)), "cell": True})
    return edits, report


def apply_edits(parent_prefix: str, new_prefix: str, edits: list[dict], dictionary) -> dict:
    """Copy the parent bundle to ``new_prefix`` with the edits written in. Returns the counts and the edits
    that matched nothing, as ``{"applied", "unchanged", "unmatched": [..], "no_table", "no_field"}``."""
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
                           "edited": []}
    objects = list_prefix(bucket, parent_prefix)
    if not any(n.endswith(".parquet") for n, _ in objects):
        raise RoundTripError("The run has no extracted tables to edit.")
    for name, _ in objects:
        target = new_prefix + name[len(parent_prefix):]
        table = unquote(name.rsplit("/", 1)[-1][: -len(".parquet")]) if name.endswith(".parquet") else None
        if table not in by_table:
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
            if ("" if pd.isna(old) else _text(old)) == e["value"]:
                out["unchanged"] += 1
                continue
            df[c] = df[c].astype(object)
            df.iloc[rows, df.columns.get_loc(c)] = e["value"]
            out["applied"] += len(rows)
            out["edited"].append({"table": table, "key": e["key"], "field": e["field"]})
        buf = io.BytesIO()
        df.to_parquet(buf, index=False)
        upload_file(bucket, target, buf.getvalue(), "application/octet-stream")
    out["unmatched_total"] = len(out["unmatched"])
    out["unmatched"] = out["unmatched"][:200]
    return out
