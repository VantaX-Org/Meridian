"""Stored report history and the schedule arithmetic behind scheduled reports (migration 089).

Every report file Meridian hands out is kept: downloads from /api/v1/reports/* (stored by
api/routes/reports.py's route class after the response is built) and scheduled runs
(workers/tasks/report_schedules.py). The bytes go to the reports bucket of the object store the
app already uses (api/services/storage.py) under ``history/<tenant>/<file id>/<file name>``; only
when the store is unreachable is a file under ``DB_FALLBACK_MAX_BYTES`` kept in Postgres instead.

Schedules are evaluated in their own IANA time zone (defaulted from the tenant's triage settings),
so "weekly on Monday at 07:00" means 07:00 local whatever the UTC offset or daylight saving does.
Everything here is deterministic Python over stored data; no LLM is involved.
"""

from __future__ import annotations

import calendar
import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.config import settings
from api.services import storage
from api.services.version_status import finished_sql

logger = logging.getLogger("meridian.report_history")

# Files above this are kept only in the object store; a store outage then leaves them unstored.
DB_FALLBACK_MAX_BYTES = 10 * 1024 * 1024
# Nothing larger than this is kept at all (a runaway export must not fill the bucket).
MAX_STORED_BYTES = 200 * 1024 * 1024
# A scheduled file above this goes out as a link, not an attachment.
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

CONTENT_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "json": "application/json",
}
CADENCES = ("daily", "weekly", "monthly")
SOURCES = ("download", "schedule", "run_now")


@dataclass(frozen=True)
class ReportType:
    name: str
    format: str  # pdf | xlsx | json
    needs_run: bool = True
    needs_module: bool = False
    schedulable: bool = True


# The catalogue's reports (api/routes/reports.py _CATALOGUE), keyed by its ids.
REPORT_TYPES: dict[str, ReportType] = {
    "board": ReportType("Board pack", "pdf"),
    "workbook": ReportType("Analyst workbook", "xlsx"),
    "executive": ReportType("Executive summary", "pdf"),
    "analysis": ReportType("Analysis report", "pdf"),
    "extraction": ReportType("Extraction report", "pdf"),
    "cleaning": ReportType("Cleaning and fixes", "pdf"),
    "trend": ReportType("Trend report", "pdf"),
    "owners": ReportType("Owner workload", "pdf"),
    "object": ReportType("Object report", "pdf", needs_module=True),
    "json": ReportType("Run data", "json"),
    "rules": ReportType("Rule catalogue", "pdf", needs_run=False, needs_module=True),
    "dictionary": ReportType("Data dictionary", "pdf", needs_run=False),
    # Download only: a comparison needs two runs, a fix sheet a record, the full report is the stored one.
    "compare": ReportType("Run comparison", "pdf", schedulable=False),
    "record": ReportType("Record fix sheet", "pdf", schedulable=False),
    "full": ReportType("Full report", "pdf", schedulable=False),
    # Issued per migration wave (api/routes/wave_certificates.py), never on a schedule.
    "readiness_certificate": ReportType("Readiness certificate", "pdf", needs_run=False, schedulable=False),
}

# Report route endpoint (function name) -> report kind, for the downloads that are stored.
ENDPOINT_KINDS: dict[str, str] = {
    "download_report": "full", "export_report_json": "json", "analysis_report_pdf": "analysis",
    "extraction_report_pdf": "extraction", "cleaning_report_pdf": "cleaning",
    "executive_report_pdf": "executive", "comparison_report_pdf": "compare", "object_report_pdf": "object",
    "record_report_pdf": "record", "board_report_pdf": "board", "trend_report_pdf": "trend",
    "rules_report_pdf": "rules", "dictionary_report_pdf": "dictionary", "owners_report_pdf": "owners",
    "workbook_xlsx": "workbook",
}


def report_name(kind: str) -> str:
    t = REPORT_TYPES.get(kind)
    return t.name if t else kind.replace("_", " ").capitalize()


def format_of(file_name: str, content_type: Optional[str] = None) -> str:
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext in CONTENT_TYPES:
        return ext
    for fmt, mime in CONTENT_TYPES.items():
        if content_type and content_type.startswith(mime):
            return fmt
    return "pdf"


def history_key(tenant_id: str, file_id: str, file_name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in file_name)[:200] or "report"
    return f"history/{tenant_id}/{file_id}/{safe}"


# ── storing and reading files ────────────────────────────────────────────────

def store_report_file(
    session: Session, tenant_id: str, *, kind: str, data: bytes, file_name: str,
    content_type: Optional[str] = None, version_id: Optional[str] = None, params: Optional[dict] = None,
    source: str = "download", schedule_id: Optional[str] = None, created_by: Optional[str] = None,
    created_by_email: Optional[str] = None, name: Optional[str] = None,
) -> Optional[str]:
    """Keep one generated file: the object store first, the capped Postgres column if the store
    fails. Returns the new report_files id, or None when the file could not be kept (too large,
    or the store failed and it is over the fallback cap). ``session`` has the tenant set; the
    caller commits."""
    import json

    if source not in SOURCES:
        raise ValueError(f"unknown report source: {source}")
    size = len(data)
    if size > MAX_STORED_BYTES:
        logger.warning("report %s not kept: %d bytes is over the history cap", kind, size)
        return None
    fmt = format_of(file_name, content_type)
    mime = content_type or CONTENT_TYPES[fmt]
    file_id = str(uuid.uuid4())
    key: Optional[str] = history_key(str(tenant_id), file_id, file_name)
    content: Optional[bytes] = None
    try:
        storage.upload_file(settings.minio_bucket_reports, key, data, mime)
    except Exception as e:
        key = None
        if size > DB_FALLBACK_MAX_BYTES:
            logger.warning("report %s not kept: object store failed (%s) and %d bytes is over the "
                           "database fallback cap", kind, type(e).__name__, size)
            return None
        logger.warning("object store failed (%s); keeping report %s in the database", type(e).__name__, kind)
        content = data
    session.execute(text("""
        INSERT INTO report_files (id, tenant_id, kind, name, version_id, format, file_name, content_type,
                                  size_bytes, sha256, storage_key, content, params, source, schedule_id,
                                  created_by, created_by_email)
        VALUES (:id, :t, :kind, :name, CAST(:v AS uuid), :fmt, :fn, :ct, :size, :sha, :key, :content,
                CAST(:params AS jsonb), :source, CAST(:sid AS uuid), CAST(:by AS uuid), :email)
    """), {
        "id": file_id, "t": str(tenant_id), "kind": kind, "name": name or report_name(kind),
        "v": str(version_id) if version_id else None, "fmt": fmt, "fn": file_name, "ct": mime, "size": size,
        "sha": hashlib.sha256(data).hexdigest(), "key": key, "content": content,
        "params": json.dumps(params or {}, default=str), "source": source,
        "sid": str(schedule_id) if schedule_id else None, "by": str(created_by) if created_by else None,
        "email": created_by_email,
    })
    return file_id


def read_report_file(storage_key: Optional[str], content: Optional[bytes]) -> bytes:
    if content is not None:
        return bytes(content)
    if not storage_key:
        raise FileNotFoundError("report file has no stored bytes")
    return storage.download_file(settings.minio_bucket_reports, storage_key)


def remove_report_object(storage_key: Optional[str]) -> None:
    """Best effort: the row is the record; an orphaned object is harmless and logged."""
    if not storage_key:
        return
    try:
        storage.delete_file(settings.minio_bucket_reports, storage_key)
    except Exception as e:
        logger.warning("report object not removed (%s)", type(e).__name__)


# ── generating a report outside a request (schedules) ───────────────────────

class NoRun(Exception):
    """The schedule's scope has no finished run yet."""


@dataclass
class Generated:
    data: bytes
    file_name: str
    content_type: str
    version_id: Optional[str]


def resolve_run(session: Session, tenant_id: str, scope: Optional[str]) -> Optional[str]:
    """The latest finished run of the scope: ``latest`` (any), ``upload`` (file uploads) or a
    system id. None when there is none."""
    where, p = "", {"t": str(tenant_id)}
    if scope and scope != "latest":
        where = "AND COALESCE(metadata->>'system_id', 'upload') = :scope"
        p["scope"] = scope
    row = session.execute(text(
        f"SELECT id FROM analysis_versions WHERE tenant_id = :t AND {finished_sql()} {where} "
        "ORDER BY run_at DESC LIMIT 1"), p).first()
    return str(row[0]) if row else None


def _stored_analysis_pdf(session: Session, tenant_id: str, vid: str) -> Optional[bytes]:
    path = session.execute(text("SELECT pdf_path FROM reports WHERE tenant_id = :t AND version_id = :v"),
                           {"t": str(tenant_id), "v": vid}).scalar()
    if not path:
        return None
    try:
        return storage.download_file(settings.minio_bucket_reports, path)
    except Exception:
        return None


def generate_report(session: Session, tenant_id: str, kind: str, params: dict) -> Optional[Generated]:
    """Render one report the way its download route does. Raises NoRun when the scope has no
    finished run; None when the builder found nothing to report on."""
    import json

    t = REPORT_TYPES[kind]
    module = params.get("module") or None
    vid = resolve_run(session, tenant_id, params.get("scope")) if t.needs_run else None
    if t.needs_run and not vid:
        raise NoRun(params.get("scope") or "latest")
    suffix = "_".join(x for x in (module, vid) if x)
    if kind == "workbook":
        from api.services.workbook_report import build as build_workbook

        out = build_workbook(session, str(tenant_id), vid, None, module)
        return Generated(out[0], out[1], CONTENT_TYPES["xlsx"], vid) if out else None
    if kind == "json":
        payload = session.execute(text("SELECT report_json FROM reports WHERE tenant_id = :t AND version_id = :v"),
                                  {"t": str(tenant_id), "v": vid}).scalar()
        if not payload:
            return None
        body = json.dumps(payload, indent=2, default=str).encode()
        return Generated(body, f"meridian_dq_report_{vid}.json", CONTENT_TYPES["json"], vid)
    data: Optional[bytes] = _stored_analysis_pdf(session, tenant_id, vid) if kind == "analysis" and vid else None
    if data is None:
        from api.services.pdf_reports import build

        data = build(session, str(tenant_id), kind, vid, None, module=module, runs=int(params.get("runs") or 12))
    if not data:
        return None
    return Generated(data, f"meridian_{kind}{'_' + suffix if suffix else ''}.pdf", CONTENT_TYPES["pdf"], vid)


# ── schedule arithmetic ─────────────────────────────────────────────────────

def zone(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def tenant_timezone(session: Session, tenant_id: str) -> str:
    """The tenant's time zone: its triage settings (Admin › Triage), else UTC."""
    try:
        tz = session.execute(text("SELECT timezone FROM triage_settings WHERE tenant_id = :t"),
                             {"t": str(tenant_id)}).scalar()
    except Exception:
        session.rollback()
        tz = None
    return tz or "UTC"


def _at(day: date, at: time, tz: ZoneInfo) -> datetime:
    """``day`` at local time ``at`` in ``tz``, as UTC. A wall time skipped by a DST change maps
    forward (zoneinfo's fold=0 rule), so a slot is never lost."""
    local = datetime.combine(day, at.replace(tzinfo=None)).replace(tzinfo=tz)
    return local.astimezone(timezone.utc)


def next_run_at(cadence: str, at: time, tz_name: Optional[str], after: datetime, *,
                weekday: Optional[int] = None, day_of_month: Optional[int] = None) -> datetime:
    """The first slot strictly after ``after`` (UTC): daily at ``at``, weekly on ``weekday``
    (0 = Monday) at ``at``, or monthly on ``day_of_month`` (clamped to the month's last day) at
    ``at``, all in local time of ``tz_name``."""
    tz = zone(tz_name)
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    local_day = after.astimezone(tz).date()
    if cadence == "daily":
        for i in range(0, 3):
            cand = _at(local_day + timedelta(days=i), at, tz)
            if cand > after:
                return cand
    elif cadence == "weekly":
        wd = 0 if weekday is None else int(weekday)
        first = local_day + timedelta(days=(wd - local_day.weekday()) % 7)
        for i in range(0, 3):
            cand = _at(first + timedelta(days=7 * i), at, tz)
            if cand > after:
                return cand
    elif cadence == "monthly":
        dom = 1 if day_of_month is None else int(day_of_month)
        y, m = local_day.year, local_day.month
        for _ in range(0, 3):
            cand = _at(date(y, m, min(dom, calendar.monthrange(y, m)[1])), at, tz)
            if cand > after:
                return cand
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    else:
        raise ValueError(f"unknown cadence: {cadence}")
    raise AssertionError("no slot found")  # unreachable: each loop spans more than one period


def schedule_next(row: Any, after: datetime) -> datetime:
    """``next_run_at`` for a report_schedules row (mapping or object)."""
    get = row.get if isinstance(row, dict) else (lambda k: getattr(row, k))
    return next_run_at(get("cadence"), get("time_of_day"), get("timezone"), after,
                       weekday=get("weekday"), day_of_month=get("day_of_month"))


def describe_cadence(cadence: str, at: time, tz_name: str, weekday: Optional[int] = None,
                     day_of_month: Optional[int] = None) -> str:
    hhmm = at.strftime("%H:%M")
    if cadence == "daily":
        return f"Every day at {hhmm} ({tz_name})"
    if cadence == "weekly":
        return f"Every {calendar.day_name[weekday or 0]} at {hhmm} ({tz_name})"
    return f"Monthly on day {day_of_month or 1} at {hhmm} ({tz_name})"


def mask_email(address: str) -> str:
    local, _, domain = str(address).partition("@")
    return f"{local[:1]}***@{domain}" if domain else "an email address"


def channel_label(kind: str, target: str) -> str:
    """How a channel is named to users: never a webhook URL (it carries a token)."""
    if kind == "email":
        return f"Email {mask_email(target)}"
    return {"slack": "Slack", "teams": "Microsoft Teams", "webhook": "Webhook"}.get(kind, kind)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
