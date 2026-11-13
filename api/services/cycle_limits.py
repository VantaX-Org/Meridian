"""Limits and plain reasons for the clean cycle (download, fix in Excel, upload back).

Pure helpers used by api/services/sf_roundtrip.py and api/routes/upload.py: they decide whether an uploaded file is
the right kind, find a renamed sheet, list the rows that matched nothing with their sheet and row number, and say
why an upload applied nothing and what to do about it.
"""
import io
import zipfile
from typing import Callable, Optional

RECORD_SHEET = "Records to clean"
RECORD_HEAD = ("Record key", "Corrected value")
MAX_REJECTED_ROWS = 200

CSV_CLEANING = ("Upload the .xlsx file Meridian gave you, not a CSV copy. A CSV keeps one sheet and drops the hidden "
                "sheet that names the run. In Excel use File, Save As, Excel Workbook (.xlsx), or download the "
                "workbook again.")


def is_record_sheet(name: str, rows: list) -> bool:
    """A sheet of cleaning rows: by its name, or by its header when the sheet was renamed."""
    if name.startswith(RECORD_SHEET):
        return True
    return bool(rows) and all(h in rows[0] for h in RECORD_HEAD)


def check_upload(ext: str, sheets: list, marker: dict) -> None:
    """Refuse a cleaning workbook saved as CSV, and one whose record sheets were renamed past recognition."""
    from api.services.sf_roundtrip import RoundTripError

    if ext == "csv" and any(is_record_sheet(n, r) for n, r in sheets):
        raise RoundTripError(CSV_CLEANING)
    if marker.get("kind") == "cleaning" and not any(is_record_sheet(n, r) for n, r in sheets):
        raise RoundTripError(f"The sheet '{RECORD_SHEET}' is missing. It was renamed, removed, or its header row "
                             f"was changed. Name the sheet '{RECORD_SHEET}' again with the columns "
                             f"{', '.join(RECORD_HEAD)} in row 1, or download the workbook again.")


def rename_by_header(sheets: list, maps: dict) -> list:
    """Template sheets renamed in Excel get their exported name back when their header row matches exactly one
    exported sheet that is not in the file under its own name."""
    present = {n for n, _ in sheets}
    free = {n: set(m.get("map") or {}) for n, m in maps.items() if n not in present and m.get("map")}
    out = []
    for name, rows in sheets:
        if name not in maps and rows and free:
            head = set(rows[0])
            hits = [n for n, cols in free.items() if cols and cols <= head]
            if len(hits) == 1:
                free.pop(hits[0])
                name = hits[0]
        out.append((name, rows))
    return out


def _locations(sheets: list, kind: str, maps: dict, keys_of: Callable[[str], list]) -> dict:
    """``(table, key) -> (sheet, row)`` for every data row; row is the Excel row number (the header is row 1)."""
    from api.services.sf_roundtrip import field_name

    at: dict = {}
    for name, rows in sheets:
        if not rows:
            continue
        head = {h: i for i, h in enumerate(rows[0])}
        cell = lambda r, h: r[head[h]] if h in head and head[h] < len(r) else ""  # noqa: E731
        if kind == "cleaning":
            if not is_record_sheet(name, rows):
                continue
            for j, r in enumerate(rows[1:], start=2):
                t = cell(r, "Table")
                at.setdefault((t, cell(r, "Record key"), field_name(cell(r, "Field"), t)), (name, j))
            continue
        m = maps.get(name) or {}
        table = m.get("table")
        if not table:
            continue
        by_field = {q.split(".", 1)[1]: h for h, q in (m.get("map") or {}).items() if q.startswith(table + ".")}
        keys = keys_of(table)
        if not keys or any(k not in by_field for k in keys):
            continue
        for j, r in enumerate(rows[1:], start=2):
            at.setdefault((table, "|".join(f"{k}={cell(r, by_field[k])}" for k in keys)), (name, j))
    return at


def rejected_rows(sheets: list, kind: str, maps: Optional[dict], keys_of: Callable[[str], list], edits: list[dict],
                  result: dict) -> tuple[list[dict], int]:
    """The edits that changed nothing because they matched nothing, with sheet, row and reason. At most
    MAX_REJECTED_ROWS rows, plus the total."""
    at = _locations(sheets, kind, maps or {}, keys_of)

    def where(table: str, key: str, field: str) -> tuple[str, int]:
        return at.get((table, key, field)) or at.get((table, key)) or ("", 0)

    out: list[dict] = []
    total = 0

    def add(e: dict, reason: str) -> None:
        nonlocal total
        total += 1
        if len(out) < MAX_REJECTED_ROWS:
            t, k, f = (str(e.get(x) or "") for x in ("table", "key", "field"))
            sheet, row = where(t, k, f)
            out.append({"sheet": sheet, "row": row, "table": t, "key": k, "field": f, "reason": reason})

    no_table, no_field = set(result.get("no_table") or []), set(result.get("no_field") or [])
    for e in edits:
        if e.get("table") in no_table:
            add(e, f"The run has no table {e['table']}. Keep the Table column as it was exported.")
        elif e.get("field") in no_field:
            add(e, f"Table {e['table']} has no field {e['field']}. Keep the Field column as it was exported.")
    for u in result.get("unmatched") or []:
        add(u, "No record in the run has this key. The key was changed, or the record is not in this run.")
    total += max(0, int(result.get("unmatched_total") or 0) - len(result.get("unmatched") or []))
    return out, total


def no_edit_reason(kind: str, report: dict) -> tuple[str, str]:
    """Why a file holds nothing to apply, and the fix."""
    if kind == "cleaning":
        if report.get("blank"):
            return (f"No row has a Corrected value ({report['blank']:,} rows are blank).",
                    "Type the right value in the Corrected value column, or #CLEAR to empty a field, then upload again.")
        return ("The sheet Records to clean has no rows.", "Download the workbook again from the run and fill it in.")
    skipped = report.get("skipped") or {}
    if skipped:
        why = "; ".join(f"{n}: {r}" for n, r in list(skipped.items())[:5])
        return (f"No sheet could be read ({why}).",
                "Keep the sheet names and the key columns as they were exported, or download the template again.")
    return ("The file holds no edits to apply. Every changed cell was blank.",
            "Type the new values in the cells, or #CLEAR to empty a field, then upload again.")


def nothing_applied(result: dict, rejected: int, already: bool) -> tuple[str, str, str]:
    """``(reason, detail, fix)`` when an upload changed no value of the run."""
    if result.get("unchanged") and not rejected:
        if already:
            return ("already_applied",
                    f"These changes are already in the cleaned run ({result['unchanged']:,} values are the same).",
                    "Nothing to do. To make more changes, download the workbook from the latest run.")
        return ("no_changes", f"Every corrected value equals the value in the run ({result['unchanged']:,} rows).",
                "Type a different value in Corrected value, or #CLEAR to empty a field, then upload again.")
    return ("no_match", f"No edit matched a record of the run ({rejected:,} rows were rejected).",
            "Download the rejected rows, check the Table, Record key and Field columns against the run, "
            "and upload again.")


def zip_parts(parts: list[tuple[bytes, str]], name: str) -> bytes:
    """Several workbooks in one download."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for body, filename in parts:
            z.writestr(filename, body)
    return buf.getvalue()
