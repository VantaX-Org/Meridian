"""Read and write the file shapes a migration workbook arrives in.

A target system hands over its load format in many containers: Excel workbooks old and new, OpenDocument sheets, the
S/4HANA Migration Cockpit's XML Spreadsheet 2003 template, delimited load files for SuccessFactors or LSMW, and ZIPs
of any of these. Everything here is about the container. What the sheets mean is decided in workbook.py.

Writing keeps the upload's own layout. Cockpit XML and delimited files are written in their own format. The binary
and macro Excel formats, and OpenDocument, come back as .xlsx, because a load tool can read it and no writer for the
others is installed. The upload itself is never saved through a library that would lose parts of it.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from html import unescape
from pathlib import PurePosixPath
from typing import Optional
from xml.etree.ElementTree import ParseError
from xml.sax.saxutils import escape

from defusedxml import ElementTree as SafeXml
from defusedxml.common import DefusedXmlException
from openpyxl import Workbook as NewBook
from openpyxl import load_workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from python_calamine import CalamineError, CalamineWorkbook, PasswordError, WorksheetNotFound, XmlError, ZipError

MAX_UNPACKED_BYTES = 500 * 1024 * 1024
MAX_MEMBERS = 200
MAX_ZIP_ENTRIES = 1000  # a real workbook holds tens of parts; thousands is a zip bomb
MAX_XML_ROWS = 1_048_576
MAX_XML_COLUMNS = 16_384
MAX_XML_CELLS = 20_000_000
HELD_BACK_FILE = "Held back.csv"

_SPREADSHEET_NS = "urn:schemas-microsoft-com:office:spreadsheet"
_SS = "{" + _SPREADSHEET_NS + "}"
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ODS = b"application/vnd.oasis.opendocument.spreadsheet"
_TEXT_EXTENSIONS = {"csv", "tsv", "txt", "dat"}
_MEDIA = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xml": "application/xml", "csv": "text/csv", "tsv": "text/tab-separated-values",
    "txt": "text/plain", "dat": "text/plain", "zip": "application/zip",
}
_DAMAGED = "This workbook could not be read. It may be damaged."
_LOCKED = "This workbook is password protected. Remove the password and upload it again."
_UNKNOWN = "This file is not a workbook or a load file this system can read."


class WorkbookError(ValueError):
    """The upload is not a workbook this module can read; the message is safe to show."""


@dataclass
class Source:
    """One uploaded file. An archive holds its readable files as members, and has no sheets of its own."""

    format: str  # xlsx | xls | xlsb | ods | xml2003 | delimited | archive
    name: str = ""
    sheets: list[tuple[str, list[tuple]]] = field(default_factory=list)
    text: str = ""  # the decoded XML, spliced on write
    encoding: str = "utf-8"
    delimiter: str = ","
    newline: str = "\n"
    members: list["Source"] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)  # archive files that could not be read


def leaves(source: Source) -> list[Source]:
    return source.members if source.format == "archive" else [source]


def _unique(name: str, taken) -> str:
    stem, dot, ext = name.rpartition(".")
    stem, dot, ext = (stem, dot, ext) if dot else (name, "", "")
    out, n = name, 1
    while out in taken:
        n += 1
        out = f"{stem} {n}{dot}{ext}"
    return out


def _cell(value):
    if value == "":
        return None
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _calamine(data: bytes, kind: str, name: str) -> Source:
    try:
        book = CalamineWorkbook.from_filelike(io.BytesIO(data))
        sheets = [(n, [tuple(_cell(c) for c in row)
                       for row in book.get_sheet_by_name(n).to_python(skip_empty_area=False)])
                  for n in book.sheet_names]
    except PasswordError as e:
        raise WorkbookError(_LOCKED) from e
    except (CalamineError, XmlError, ZipError, WorksheetNotFound, ValueError) as e:
        raise WorkbookError(_DAMAGED) from e
    return Source(kind, name, sheets)


def _openpyxl(data: bytes, name: str) -> Source:
    try:
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
        try:
            sheets = []
            for ws in book.worksheets:
                ws.reset_dimensions()
                sheets.append((ws.title, list(ws.iter_rows(values_only=True))))
        finally:
            book.close()
    except (zipfile.BadZipFile, KeyError, OSError, ValueError) as e:
        raise WorkbookError(_DAMAGED) from e
    return Source("xlsx", name, sheets)


def _archive(z: zipfile.ZipFile, name: str, budget: list[int]) -> Source:
    files = [i for i in z.infolist() if not i.is_dir()]
    files = [i for i in files if "__MACOSX" not in i.filename and not PurePosixPath(i.filename).name.startswith(".")]
    if len(files) > MAX_MEMBERS:
        raise WorkbookError(f"This archive holds more than {MAX_MEMBERS} files.")
    out = Source("archive", name)
    taken: set[str] = set()
    for info in files:
        base = PurePosixPath(info.filename.replace("\\", "/")).name
        try:
            member = read_source(z.read(info), base, budget)
        except WorkbookError as e:
            if str(e) == _TOO_LARGE:
                raise
            out.skipped.append(base)
            continue
        member.name = _unique(base, taken)
        taken.add(member.name)
        out.members.append(member)
    if not out.members:
        raise WorkbookError("No workbook or load file could be read in this archive.")
    return out


_TOO_LARGE = "This workbook is too large once unpacked."


def _check_budget(z: zipfile.ZipFile, left: list[int]) -> None:
    """Refuse before anything is unpacked. ``file_size`` is the declared size, and zipfile never reads past it."""
    infos = z.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        raise WorkbookError(f"This file holds more than {MAX_ZIP_ENTRIES} parts.")
    left[0] -= sum(i.file_size for i in infos)
    if left[0] < 0:
        raise WorkbookError(_TOO_LARGE)


def check_zip_budget(data: bytes) -> None:
    """Decompression-bomb guard for a zip-based workbook read outside read_source: WorkbookError when too large,
    zipfile.BadZipFile when it is not a zip at all."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        _check_budget(z, [MAX_UNPACKED_BYTES])


def _zip(data: bytes, name: str, budget: Optional[list[int]]) -> Source:
    left = [MAX_UNPACKED_BYTES] if budget is None else budget
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            _check_budget(z, left)
            names = set(z.namelist())
            if "xl/workbook.xml" in names:
                return _openpyxl(data, name)
            if "xl/workbook.bin" in names:
                return _calamine(data, "xlsb", name)
            if "mimetype" in names and z.read("mimetype").startswith(_ODS):
                return _calamine(data, "ods", name)
            if budget is not None:
                raise WorkbookError(_UNKNOWN)  # one level of archive only
            return _archive(z, name, left)
    except zipfile.BadZipFile as e:
        raise WorkbookError(_DAMAGED) from e


def _decode(data: bytes) -> tuple[str, str]:
    if data[:3] == b"\xef\xbb\xbf":
        choices = ["utf-8-sig"]
    elif data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        choices = ["utf-16"]
    else:
        choices = ["utf-8", "cp1252"]
    for encoding in choices:
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "\x00" in text:
            break
        return text, encoding
    raise WorkbookError(_UNKNOWN)


def _attr_int(element, key: str, default: int) -> int:
    value = element.get(_SS + key)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as e:
        raise WorkbookError(_DAMAGED) from e


def _xml_cell(data):
    if data is None:
        return None
    text = "".join(data.itertext())
    if data.get(_SS + "Type") == "Number":
        try:
            return _cell(float(text))
        except ValueError:
            return text
    return text or None


def _xml_rows(table) -> list[tuple]:
    rows: list[tuple] = []
    cells_left = MAX_XML_CELLS
    for row in table.findall(_SS + "Row"):
        at = _attr_int(row, "Index", len(rows) + 1)
        if at < len(rows) + 1 or at > MAX_XML_ROWS:
            raise WorkbookError(_DAMAGED)
        rows.extend([()] * (at - 1 - len(rows)))
        cells: list = []
        for cell in row.findall(_SS + "Cell"):
            col = _attr_int(cell, "Index", len(cells) + 1)
            merge = _attr_int(cell, "MergeAcross", 0)
            if col < len(cells) + 1 or merge < 0 or col + merge > MAX_XML_COLUMNS:
                raise WorkbookError(_DAMAGED)
            cells_left -= col - len(cells) + merge
            if cells_left < 0:
                raise WorkbookError(_TOO_LARGE)
            cells.extend([None] * (col - 1 - len(cells)))
            cells.append(_xml_cell(cell.find(_SS + "Data")))
            cells.extend([None] * merge)
        span = _attr_int(row, "Span", 0)
        if span < 0 or len(rows) + 1 + span > MAX_XML_ROWS:
            raise WorkbookError(_DAMAGED)
        rows.append(tuple(cells))
        rows.extend([()] * span)
    return rows


def _xml2003(text: str, encoding: str, name: str) -> Source:
    try:
        root = SafeXml.fromstring(text)
    except (ParseError, DefusedXmlException) as e:
        raise WorkbookError(_DAMAGED) from e
    sheets = []
    for ws in root.iter(_SS + "Worksheet"):
        table = ws.find(_SS + "Table")
        sheets.append((ws.get(_SS + "Name") or "", _xml_rows(table) if table is not None else []))
    return Source("xml2003", name, sheets, text=text, encoding=encoding)


def _sheet_name(filename: str) -> str:
    """A load file's object: 'Location Import Template.csv' loads Location. Excel's forbidden characters are dropped."""
    stem = PurePosixPath(filename).stem or "Load file"
    stem = re.sub(r"[\s_-]*(import[\s_-]*)?template.*$", "", stem, flags=re.I) or stem
    return re.sub(r"[\[\]:*?/\\]", " ", stem).strip() or "Load file"


def _delimited(text: str, encoding: str, name: str) -> Source:
    line = next((ln for ln in text.splitlines() if ln.strip()), "")
    try:
        delimiter = max(",;\t|", key=lambda d: len(next(csv.reader([line], delimiter=d), [])))
        if len(next(csv.reader([line], delimiter=delimiter), [])) < 2:
            raise WorkbookError(_UNKNOWN)
        rows = [tuple(c or None for c in r) for r in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)]
    except csv.Error as e:
        raise WorkbookError(_UNKNOWN) from e
    return Source("delimited", name, [(_sheet_name(name), rows)], encoding=encoding, delimiter=delimiter,
                  newline="\r\n" if "\r\n" in text else "\n")


def read_source(data: bytes, filename: str = "", budget: Optional[list[int]] = None) -> Source:
    """What the bytes are, from the bytes. The file name only names the output."""
    name = PurePosixPath((filename or "").replace("\\", "/")).name
    if not data:
        raise WorkbookError("This file is empty.")
    if data[:2] == b"PK":
        return _zip(data, name, budget)
    if data[:8] == _OLE:
        if "EncryptedPackage".encode("utf-16-le") in data:
            raise WorkbookError(_LOCKED)
        return _calamine(data, "xls", name)
    text, encoding = _decode(data)
    head = text.lstrip()[:4096]
    if head.startswith("<"):
        if _SPREADSHEET_NS not in head:
            raise WorkbookError(_UNKNOWN)
        return _xml2003(text, encoding, name)
    return _delimited(text, encoding, name)


def _ext(source: Source) -> str:
    if source.format == "xml2003":
        return "xml"
    if source.format == "delimited":
        ext = PurePosixPath(source.name).suffix.lstrip(".").lower()
        return ext if ext in _TEXT_EXTENSIONS else "csv"
    return "xlsx"


def written_as(source: Source, filled: set[str], held: bool) -> str:
    """The extension of the same-layout export: a ZIP unless one file with no held rows comes back."""
    files = [s for s in leaves(source) if s.name in filled]
    return _ext(files[0]) if len(files) == 1 and not held else "zip"


def _clean(value: str) -> str:
    return ILLEGAL_CHARACTERS_RE.sub("", value)


def _xlsx_cell(ws, value):
    if not isinstance(value, str):
        return value
    value = _clean(value)
    if value[:1] not in ("=", "#"):  # openpyxl would write these as a formula or an error
        return value or None
    cell = WriteOnlyCell(ws, value=value)
    cell.data_type = "s"
    return cell


def _write_xlsx(source: Source, loads: dict) -> bytes:
    book = NewBook(write_only=True)
    for name, rows in source.sheets:
        ws = book.create_sheet(name[:31])
        if name in loads:
            top, body = loads[name]
            rows = [*top, *body]
        for row in rows:
            ws.append([_xlsx_cell(ws, c) for c in row])
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def _write_delimited(source: Source, load: tuple) -> bytes:
    top, body = load
    out = io.StringIO(newline="")
    writer = csv.writer(out, delimiter=source.delimiter, lineterminator=source.newline)
    writer.writerows([["" if c is None else c for c in row] for row in top])
    writer.writerows(body)
    try:
        return out.getvalue().encode(source.encoding)
    except UnicodeEncodeError:  # ponytail: a name outside the template's code page moves the file to UTF-8
        return out.getvalue().encode("utf-8-sig")


def _splice_xml(source: Source, loads: dict) -> bytes:
    """Add rows to the template's text, so its styles, sheets and processing instructions stay as they arrived.

    Every value goes in as a String cell. The cockpit's number and date cell types have not been tried against a real
    template. ponytail: no split at the cockpit's 100 MB file limit; split into several files if a load reaches it."""
    text = source.text
    bound = re.search(r'xmlns:(\w+)="' + re.escape(_SPREADSHEET_NS) + '"', text)
    ss = bound.group(1) if bound else "ss"
    for m in reversed(list(re.finditer(r"<(\w+:)?Worksheet\b[^>]*>", text))):
        name = re.search(r"""[\s:]Name=(["'])(.*?)\1""", m.group(0))
        load = loads.get(unescape(name.group(2))) if name else None
        if load is None:
            continue
        pre = m.group(1) or ""
        end = text.find(f"</{pre}Worksheet>", m.end())
        opened = re.compile(rf"<{pre}Table\b[^>]*>").search(text, m.end(), max(end, 0))
        close = text.find(f"</{pre}Table>", opened.end(), end) if opened else -1
        if opened is None or close < 0:  # a sheet with no table has nowhere to take rows
            raise WorkbookError(_DAMAGED)
        inner = text[opened.end():close]
        while (at := inner.rfind(f"<{pre}Row")) >= 0 and "Data" not in inner[at:]:  # blank rows Excel left at the end
            inner = inner[:at].rstrip()
        rows = "".join(
            f"<{pre}Row>" + "".join(
                f'<{pre}Cell {ss}:Index="{i}"><{pre}Data {ss}:Type="String">{escape(_clean(v))}</{pre}Data></{pre}Cell>'
                for i, v in enumerate(row, 1) if v != "") + f"</{pre}Row>"
            for row in load[1])
        tag = re.sub(r'\s+[\w:]*Expanded(?:Row|Column)Count="\d+"', "", opened.group(0))
        text = text[:opened.start()] + tag + inner + rows + text[close:]
    return text.encode(source.encoding, "xmlcharrefreplace")


def _write(source: Source, load: dict) -> bytes:
    if source.format == "xml2003":
        return _splice_xml(source, load)
    if source.format == "delimited":
        return _write_delimited(source, next(iter(load.values())))
    return _write_xlsx(source, load)


def write_source(source: Source, loads: dict[str, dict], held_csv: Optional[bytes]) -> tuple[bytes, str]:
    """The filled files in the upload's own layout, and the extension of what came back.

    `loads` is, per file name, each filled sheet's (rows kept from the template, data rows). Held rows cannot go inside
    a load file, because the load tool would read them, so they travel beside it in a ZIP."""
    files: dict[str, bytes] = {}
    for leaf in leaves(source):
        if leaf.name not in loads:
            continue
        stem = PurePosixPath(leaf.name).stem or "workbook"
        wanted = leaf.name if leaf.format in ("delimited", "xml2003") and leaf.name else f"{stem}.{_ext(leaf)}"
        files[_unique(wanted, files)] = _write(leaf, loads[leaf.name])
    if len(files) == 1 and held_csv is None:
        content = next(iter(files.values()))
        return content, _ext(next(s for s in leaves(source) if s.name in loads))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
        if held_csv is not None:
            z.writestr(HELD_BACK_FILE, held_csv)
    return out.getvalue(), "zip"


def media_type(ext: str) -> str:
    return _MEDIA[ext]
