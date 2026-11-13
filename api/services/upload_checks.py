"""Is this the right file for this run: the checks an edited workbook passes before its edits are applied.

Pure: no database, no storage. Every result carries ids and counts only, never a cell value.
Each check is ``{"id", "status": "pass" | "warn" | "fail", "detail"}``. A ``fail`` blocks the upload; a ``warn``
needs the person to confirm (``confirm_warnings``).
"""
import hashlib
import re
from datetime import datetime, timezone
from typing import Optional

# Bump a version when the workbook layout changes: files made from an older layout are refused.
TEMPLATE_VERSIONS = {"cleaning": 1, "template": 1}
REQUIRED = ("Table", "Record key", "Field", "Corrected value")
CHECK_IDS = ("fingerprint", "run", "template", "columns", "rows", "keys", "values", "formulas")
_NUMBER = re.compile(r"^[+-]?\d+([.,]\d+)?$")
_NUMERIC_TYPES = {"NUMC": r"^\d+$", "INT1": r"^\d+$", "INT2": r"^-?\d+$", "INT4": r"^-?\d+$", "DATS": r"^\d{8}$|^\d{4}-\d{2}-\d{2}$"}


def columns_hash(headers) -> str:
    return hashlib.sha256("\x1f".join(h.strip() for h in headers).encode()).hexdigest()[:16]


def fingerprint(kind: str, tenant_id: str, system_id: Optional[str], headers, rows: int) -> dict:
    """What a downloaded workbook carries in its hidden marker, besides run id and object."""
    return {"tenant": str(tenant_id), "system": system_id or "", "template_id": kind,
            "template_version": str(TEMPLATE_VERSIONS[kind]), "columns": columns_hash(headers), "rows": str(rows),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def _c(id_: str, status: str, detail: str) -> dict:
    return {"id": id_, "status": status, "detail": detail}


def _records(sheets) -> list:
    return [(n, r) for n, r in sheets if n.startswith("Records to clean") and r]


def check_fingerprint(marker: dict, tenant_id: str) -> dict:
    need = ("version_id", "module", "template_id", "template_version", "columns")
    gone = [k for k in need if not marker.get(k)]
    if len(gone) == len(need):
        return _c("fingerprint", "warn", "The file has no fingerprint. It cannot be tied to a run, so the run you chose is used.")
    if gone:
        return _c("fingerprint", "warn", f"The fingerprint is incomplete: {', '.join(gone)} missing.")
    if marker.get("tenant") and marker["tenant"] != str(tenant_id):
        return _c("fingerprint", "fail", "The file was made for a different organisation.")
    return _c("fingerprint", "pass", "The file carries its fingerprint.")


def check_run(marker: dict, chosen: str, modules: list, latest: Optional[str]) -> dict:
    if marker.get("version_id") and marker["version_id"].lower() != chosen.lower():
        return _c("run", "fail", "The file came from a different run than the one chosen.")
    if marker.get("module") and marker["module"] not in modules:
        return _c("run", "fail", f"The file is for {marker['module']}, which is not an object of the chosen run.")
    if latest and latest.lower() != chosen.lower():
        return _c("run", "warn", "A newer run of this object exists. Your edits will be applied to the chosen run.")
    return _c("run", "pass", "The file matches the chosen run and object.")


def check_template(marker: dict, kind: str) -> dict:
    have, want = marker.get("template_version"), str(TEMPLATE_VERSIONS.get(kind, 1))
    if not have:
        return _c("template", "warn", "The file does not say which template version it was made from.")
    if marker.get("template_id") and marker["template_id"] != kind:
        return _c("template", "fail", "The file was made from a different template.")
    if have != want:
        return _c("template", "fail", f"The template is version {have}; the current version is {want}. Download it again.")
    return _c("template", "pass", f"The template is current (version {want}).")


def check_columns(sheets, marker: dict, kind: str, maps: Optional[dict] = None) -> dict:
    if kind == "cleaning":
        recs = _records(sheets)
        if not recs:
            return _c("columns", "fail", "The sheet Records to clean is missing.")
        head = list(recs[0][1][0])
        gone = [h for h in REQUIRED if h not in head]
        if gone:
            return _c("columns", "fail", f"Required columns missing or renamed: {', '.join(gone)}.")
        if marker.get("columns") and marker["columns"] != columns_hash(h for h in head if h):
            return _c("columns", "fail", "The columns differ from the downloaded workbook: one was renamed, added or removed.")
        return _c("columns", "pass", "All required columns are present and unrenamed.")
    gone = 0
    for name, rows in sheets:
        m = (maps or {}).get(name)
        if m and rows:
            gone += sum(1 for h in m["map"] if h not in rows[0])
    return _c("columns", "fail", f"{gone} column(s) of the template are missing or renamed.") if gone else \
        _c("columns", "pass", "All template columns are present and unrenamed.")


def check_rows(sheets, marker: dict, kind: str) -> dict:
    if kind != "cleaning":
        return _c("rows", "pass", "The template may add or remove rows.")
    got = sum(1 for _, r in _records(sheets) for x in r[1:] if any(x))
    want = marker.get("rows")
    if not want or not want.isdigit():
        return _c("rows", "warn", "The file does not say how many records it had, so added or removed rows cannot be told.")
    if got != int(want):
        return _c("rows", "fail", f"The file has {got} records; the download had {want}. Rows were added or removed.")
    return _c("rows", "pass", f"The record count matches the download ({want}).")


def check_keys(matched: dict) -> dict:
    """``matched`` is the dry run of apply_edits: unmatched and total edits."""
    miss, total = matched.get("unmatched_total", 0), matched.get("total", 0)
    if matched.get("no_table"):
        return _c("keys", "fail", f"{len(matched['no_table'])} table(s) in the file are not in the run.")
    if total and miss == total:
        return _c("keys", "fail", "No record key in the file exists in the run.")
    if miss:
        return _c("keys", "warn", f"{miss} of {total} record keys are not in the run. Those edits are skipped.")
    return _c("keys", "pass", "Every record key exists in the run.")


def check_values(edits, dictionary) -> dict:
    """Value length and type against the field metadata (sap/ddic.py Field)."""
    long = bad = 0
    for e in edits:
        v = e["value"]
        f = dictionary.field(e["table"], e["field"]) if dictionary else None
        if not f or not v:
            continue
        if f.length and f.type in ("CHAR", "NUMC", "DATS", "CLNT", "LANG", "CUKY", "UNIT") and len(v) > f.length:
            long += 1
        pat = _NUMERIC_TYPES.get(f.type or "")
        if (pat and not re.match(pat, v)) or (f.type in ("DEC", "CURR", "QUAN", "FLTP") and not _NUMBER.match(v.replace(" ", ""))):
            bad += 1
    if long or bad:
        return _c("values", "fail", f"{long} value(s) are longer than the field allows; {bad} are the wrong type.")
    return _c("values", "pass", "Value lengths and types fit the field definitions.")


def unsafe(v: str) -> bool:
    """A cell Excel would run as a formula: starts with = + - @ (a plain number is fine), tab or carriage return."""
    return bool(v) and (v[0] in "=@\t\r" or (v[0] in "+-" and not _NUMBER.match(v)))


def check_formulas(edits) -> dict:
    n = sum(1 for e in edits if unsafe(e["value"]))
    return _c("formulas", "fail", f"{n} value(s) start with = + - or @ and would run as a formula.") if n else \
        _c("formulas", "pass", "No value would run as a formula.")


def verdict(checks: list) -> str:
    s = {c["status"] for c in checks}
    return "fail" if "fail" in s else "warn" if "warn" in s else "pass"
