"""Branded XLSX writer — one cover sheet plus styled data sheets for every
Excel export in Meridian. See ui-brand-exports-addendum.md section 3.2.

Usage: build a list of ``SheetSpec`` (one per data sheet) and call
``build_workbook(...)``. Every workbook gets a "Cover" sheet with the
Meridian mark, tenant, run and generation metadata, and every data sheet
gets the same header styling, number formats and formula-injection guard.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Iterable, Literal, Mapping, Optional
from zoneinfo import ZoneInfo

from fastapi import Response
from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

if TYPE_CHECKING:
    import pandas as pd

SAST = ZoneInfo("Africa/Johannesburg")

ACCENT = "2D3A8C"
_ACCENT = ACCENT
_LINE = "D5DBE0"
_WHITE = "FFFFFF"

# Spreadsheet formula-injection guard — same prefixes as api.routes.audit._csv_cell.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

MAX_SHEET_TITLE = 31
ROW_CAP = 100_000

_MARK_PATH = Path(__file__).resolve().parents[2] / "templates" / "assets" / "brand" / "mark-light.png"

ColumnKind = Literal["text", "int", "pct", "money", "date", "datetime", "mono", "raw"]


def guard_formula_cell(value: object) -> object:
    """Prefix a leading apostrophe onto text that looks like a spreadsheet formula.

    Shared with api.routes.audit, which imports this instead of keeping its
    own ``_csv_cell`` guard.
    """
    if not isinstance(value, str):
        return value
    # Excel/Sheets strip leading spaces and newlines, so " =1+1" still evaluates.
    if value.lstrip(" \n").startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


# Prefixes that actually trigger formula evaluation when a cell is opened in
# Excel/Sheets. "-" and "+" are excluded here on top of FORMULA_PREFIXES:
# unlike "=", "@", tab and CR, a leading "-"/"+" alone does not evaluate as a
# formula in modern Excel/Sheets without a following operator, and SAP load
# files routinely carry literal negative quantities and "-"-prefixed codes
# that a reimport must receive byte-for-byte.
_SAP_REIMPORT_FORMULA_PREFIXES = ("=", "@", "\t", "\r")


def guard_sap_reimport_cell(value: object) -> object:
    """Same guard as :func:`guard_formula_cell`, narrowed for files that are
    reimported into SAP rather than opened by a human in a spreadsheet.

    Still blocks the prefixes that evaluate as a formula ("=", "@", tab, CR)
    but leaves a leading "-"/"+" untouched, so a negative quantity or a
    "-"-prefixed SAP code round-trips unchanged. See N3 in the UI batch 2
    re-review: the plain guard was corrupting reimport data.
    """
    if not isinstance(value, str):
        return value
    if value.lstrip(" \n").startswith(_SAP_REIMPORT_FORMULA_PREFIXES):
        return "'" + value
    return value


def guard_frame(df: pd.DataFrame, sap_columns: Iterable[str] = ()) -> pd.DataFrame:
    """The shared formula-injection guard for every DataFrame export writer (xlsx or csv).

    Columns in ``sap_columns`` carry SAP-mapped values that are reimported, so they get the
    narrowed :func:`guard_sap_reimport_cell` (a negative quantity or "-" code stays as is).
    Every other column gets the full :func:`guard_formula_cell`. Returns a copy.
    """
    sap = set(sap_columns)
    out = df.copy()
    for col in out.columns:
        out[col] = out[col].map(guard_sap_reimport_cell if col in sap else guard_formula_cell)
    return out


@dataclass(frozen=True)
class ColumnSpec:
    key: str
    header: str
    kind: ColumnKind = "text"
    scale: float = 1.0  # pct columns: raw value is already 0-100 (scale=1.0) or 0-1 (scale=100)
    fill_by_value: Optional[Mapping[str, str]] = None  # cell value -> hex fill (no '#')
    width: Optional[int] = None


@dataclass(frozen=True)
class SheetSpec:
    title: str  # <=31 chars, sentence case; truncated/deduplicated by the writer
    columns: list[ColumnSpec]
    rows: Iterable[Mapping[str, object]]
    note: Optional[str] = None  # one sentence under the title row on the cover


def _to_sast(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(SAST)


def _fmt_generated(dt: datetime) -> str:
    sast = _to_sast(dt)
    return f"{sast.day} {sast.strftime('%b %Y, %H:%M')} SAST"


def _unique_title(title: str, used: set[str]) -> str:
    base = (title or "Sheet")[:MAX_SHEET_TITLE]
    if base not in used:
        used.add(base)
        return base
    counter = 2
    while True:
        suffix = f" {counter}"
        candidate = base[: MAX_SHEET_TITLE - len(suffix)] + suffix
        if candidate not in used:
            used.add(candidate)
            return candidate
        counter += 1


def _cell_value_and_format(raw: object, kind: ColumnKind, scale: float) -> tuple[object, Optional[str]]:
    if raw is None or raw == "":
        return (None, None)
    if kind == "int":
        try:
            return (int(raw), "#,##0")
        except (TypeError, ValueError):
            return (raw, None)
    if kind == "pct":
        try:
            value = float(raw) * scale
        except (TypeError, ValueError):
            return (raw, None)
        return (value / 100.0, "0.0%")
    if kind == "money":
        try:
            return (float(raw), "#,##0.00")
        except (TypeError, ValueError):
            return (raw, None)
    if kind == "date":
        d = raw
        if isinstance(d, datetime):
            d = _to_sast(d).replace(tzinfo=None)
        return (d, "yyyy-mm-dd")
    if kind == "datetime":
        if isinstance(raw, datetime):
            return (_to_sast(raw).replace(tzinfo=None), "yyyy-mm-dd hh:mm")
        return (raw, "yyyy-mm-dd hh:mm")
    if kind == "mono":
        return (guard_formula_cell(raw), None)
    if kind == "raw":
        # Narrowed guard for SAP-reimport files (see guard_sap_reimport_cell):
        # still blocks "=" / "@" / tab / CR, but leaves a leading "-"/"+" on a
        # negative quantity or SAP code untouched.
        return (guard_sap_reimport_cell(raw), None)
    return (guard_formula_cell(raw), None)


def _column_width(header: str, sample_values: list[str]) -> int:
    lengths = sorted(len(v) for v in sample_values[:500])
    if lengths:
        idx = min(int(len(lengths) * 0.95), len(lengths) - 1)
        p95 = lengths[idx]
    else:
        p95 = 0
    return max(10, min(60, max(len(header), p95)))


def _write_data_sheet(ws: Worksheet, spec: SheetSpec) -> tuple[int, bool]:
    """Write one data sheet. Returns (row_count, truncated)."""
    header_font = Font(color=_WHITE, bold=True, size=11)
    header_fill = PatternFill(fill_type="solid", fgColor=_ACCENT)
    header_border = Border(bottom=Side(style="thin", color=_LINE))

    for col_idx, col in enumerate(spec.columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=col.header)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = header_border
        if col.kind in ("mono", "raw"):
            cell.font = Font(color=_WHITE, bold=True, size=11, name="Consolas")
    ws.row_dimensions[1].height = 18

    sample_values: dict[int, list[str]] = {i: [] for i in range(1, len(spec.columns) + 1)}
    row_count = 0
    truncated = False
    row_idx = 2
    for row in spec.rows:
        if row_count >= ROW_CAP:
            truncated = True
            row_count += 1  # keep counting so the cover can report the true total
            continue
        for col_idx, col in enumerate(spec.columns, start=1):
            raw = row.get(col.key)
            value, number_format = _cell_value_and_format(raw, col.kind, col.scale)
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            if number_format:
                cell.number_format = number_format
            if col.kind in ("mono", "raw"):
                cell.font = Font(name="Consolas", size=10)
            if col.fill_by_value and raw in col.fill_by_value:
                cell.fill = PatternFill(fill_type="solid", fgColor=col.fill_by_value[raw])
            if len(sample_values[col_idx]) < 500 and value is not None:
                sample_values[col_idx].append(str(value))
        row_idx += 1
        row_count += 1

    last_row = row_idx - 1
    ws.freeze_panes = "A2"
    if last_row >= 1:
        ws.auto_filter.ref = ws.dimensions
    for col_idx, col in enumerate(spec.columns, start=1):
        width = col.width or _column_width(col.header, sample_values[col_idx])
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    return row_count, truncated


def _write_cover_sheet(
    ws: Worksheet,
    *,
    tenant_name: str,
    run_label: Optional[str],
    run_id: Optional[str],
    title: str,
    generated_at: datetime,
    sheet_meta: list[tuple[str, int, Optional[str]]],
) -> None:
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 60

    if _MARK_PATH.exists():
        try:
            img = XLImage(str(_MARK_PATH))
            img.width = 64
            img.height = 64
            ws.add_image(img, "A1")
        except Exception:
            pass  # cover still renders without the mark if Pillow/the file is unavailable

    ws["A3"] = "Meridian"
    ws["A3"].font = Font(bold=True, size=20, color=_ACCENT)
    ws["A4"] = guard_formula_cell(title)
    ws["A4"].font = Font(size=14)

    rows: list[tuple[str, object]] = [
        ("Organisation", guard_formula_cell(tenant_name)),
        ("Run", guard_formula_cell(run_label) or "—"),
        ("Run ID", guard_formula_cell(run_id) or "—"),
        ("Generated", _fmt_generated(generated_at)),
    ]
    row_idx = 6
    for label, value in rows:
        ws.cell(row=row_idx, column=1, value=label).font = Font(bold=True)
        cell = ws.cell(row=row_idx, column=2, value=value)
        if label == "Run ID":
            cell.font = Font(name="Consolas", size=10)
        row_idx += 1

    row_idx += 1
    ws.cell(row=row_idx, column=1, value="Sheets").font = Font(bold=True)
    row_idx += 1
    for sheet_title, count, note in sheet_meta:
        text = f"{sheet_title} — {count:,} row{'s' if count != 1 else ''}"
        if note:
            # Don't guard `note` here on its own: it's being appended mid-string
            # after the sheet_title/count prefix, not placed at the start of the
            # cell. Guarding it here would leave a literal, visible apostrophe
            # in the middle of the sentence. The whole concatenated `text` is
            # guarded once below, which is what matters for the cell's actual
            # leading character.
            text += f". {note}"
        ws.cell(row=row_idx, column=1, value=guard_formula_cell(sheet_title)).font = Font(bold=False)
        ws.cell(row=row_idx, column=2, value=guard_formula_cell(text))
        row_idx += 1


def build_workbook(
    *,
    tenant_name: str,
    run_label: Optional[str],
    run_id: Optional[str],
    title: str,
    sheets: list[SheetSpec],
    generated_at: Optional[datetime] = None,
) -> bytes:
    """Build a branded workbook: a "Cover" sheet first (active on open) plus one
    styled, data sheet per entry in ``sheets``. See module docstring."""
    generated_at = generated_at or datetime.now(timezone.utc)

    wb = Workbook()
    cover_ws = wb.active
    cover_ws.title = "Cover"

    used_titles = {"Cover"}
    sheet_meta: list[tuple[str, int, Optional[str]]] = []
    for spec in sheets:
        title_final = _unique_title(spec.title, used_titles)
        ws = wb.create_sheet(title_final)
        row_count, truncated = _write_data_sheet(ws, spec)
        note = spec.note
        if truncated:
            truncated_note = "Truncated to 100 000 rows; narrow the filter to export the rest."
            note = f"{note} {truncated_note}" if note else truncated_note
        sheet_meta.append((title_final, row_count, note))

    _write_cover_sheet(
        cover_ws,
        tenant_name=tenant_name,
        run_label=run_label,
        run_id=run_id,
        title=title,
        generated_at=generated_at,
        sheet_meta=sheet_meta,
    )
    wb.active = 0  # Cover is active on open

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def xlsx_response(data: bytes, filename: str) -> Response:
    """Wrap workbook bytes in a download response with the spreadsheet media type."""
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _export_filename(kind: str, run_label: Optional[str], ext: str, generated_at: Optional[datetime] = None) -> str:
    """``meridian-{kind}-{run_label_slug}-{YYYYMMDD-HHMM-SAST}.{ext}``."""
    generated_at = generated_at or datetime.now(timezone.utc)
    sast = _to_sast(generated_at)
    slug = "-".join((run_label or "export").lower().split())
    slug = "".join(c if c.isalnum() or c == "-" else "-" for c in slug).strip("-") or "export"
    return f"meridian-{kind}-{slug}-{sast.strftime('%Y%m%d-%H%M')}-SAST.{ext}"


def xlsx_filename(kind: str, run_label: Optional[str], generated_at: Optional[datetime] = None) -> str:
    """``meridian-{kind}-{run_label_slug}-{YYYYMMDD-HHMM-SAST}.xlsx``."""
    return _export_filename(kind, run_label, "xlsx", generated_at)


def csv_filename(kind: str, run_label: Optional[str], generated_at: Optional[datetime] = None) -> str:
    """``meridian-{kind}-{run_label_slug}-{YYYYMMDD-HHMM-SAST}.csv``."""
    return _export_filename(kind, run_label, "csv", generated_at)


def csv_response(
    rows: Iterable[Mapping[str, object]],
    columns: list[ColumnSpec],
    kind: str,
    run_label: Optional[str] = None,
) -> Response:
    """Build a guarded, ``meridian-``-prefixed CSV download for one flat row set.

    Every ``text``/``mono`` cell is passed through ``guard_formula_cell`` — the
    same guard the xlsx writer applies to data-sheet cells, so pasting SAP values
    (or any user-controlled text) into Excel can never execute as a formula.
    """
    import csv as csv_mod

    buf = io.StringIO()
    fieldnames = [c.key for c in columns]
    writer = csv_mod.DictWriter(buf, fieldnames=fieldnames)
    writer.writerow({c.key: c.header for c in columns})
    for row in rows:
        out: dict[str, object] = {}
        for c in columns:
            value = row.get(c.key)
            if c.kind in ("mono", "text"):
                value = guard_formula_cell(value)
            elif c.kind == "raw":
                value = guard_sap_reimport_cell(value)
            out[c.key] = value
        writer.writerow(out)
    filename = csv_filename(kind, run_label)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
