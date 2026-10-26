"""Report history (stored files) and scheduled reports — migration 089.

  GET    /api/v1/reports/history                  paged list, newest first, ``kind`` filter
  GET    /api/v1/reports/history/{id}/download    the stored file
  DELETE /api/v1/reports/history/{id}             the creator, or a reports admin
  GET    /api/v1/reports/schedules                every schedule of the tenant
  GET    /api/v1/reports/schedules/options        report types, recipients, systems, the tenant time zone
  POST   /api/v1/reports/schedules                create
  PUT    /api/v1/reports/schedules/{id}           replace (the creator, or a reports admin)
  DELETE /api/v1/reports/schedules/{id}           the creator, or a reports admin
  POST   /api/v1/reports/schedules/{id}/run       run now (queued on the worker)

Every route needs the export permission (as every report download does); changing or deleting
someone else's file or schedule also needs reports admin (``manage_settings``). Every query sets
app.tenant_id and carries ``tenant_id``; row-level security is the second line, not the only one.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, time, timezone
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import report_history as rh
from api.services import rbac
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1/reports", tags=["report-library"],
                   dependencies=[Depends(require_permission("export"))])
logger = logging.getLogger("meridian.report_library")


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    tid = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tid})
    return tid


def _uid(request: Request) -> Optional[str]:
    uid = getattr(request.state, "local_user_id", None)
    try:
        return str(uuid.UUID(str(uid))) if uid else None
    except ValueError:
        return None


async def _actor(request: Request, db: AsyncSession, tid: str) -> Optional[str]:
    """The signed-in user's id when it is a user of this tenant (created_by is a users FK)."""
    uid = _uid(request)
    if not uid:
        return None
    found = (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                              {"u": uid, "t": tid})).scalar()
    return uid if found else None


async def _is_reports_admin(request: Request, tenant: Tenant, db: AsyncSession) -> bool:
    try:
        await require_permission("manage_settings")(request, tenant, db)
        return True
    except HTTPException:
        return False


async def _may_change(request: Request, tenant: Tenant, db: AsyncSession, owner: Any) -> bool:
    uid = _uid(request)
    if uid and owner is not None and str(owner) == uid:
        return True
    return await _is_reports_admin(request, tenant, db)


def _parse_id(value: str, what: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{what} not found.")


# ── history ──────────────────────────────────────────────────────────────────

class ReportFileOut(BaseModel):
    id: str
    kind: str
    name: str
    version_id: Optional[str]
    run_label: Optional[str]
    run_at: Optional[datetime]
    format: str
    file_name: str
    size_bytes: int
    source: str
    schedule_id: Optional[str]
    created_by: Optional[str]
    created_by_label: Optional[str]
    created_at: datetime
    can_delete: bool


class ReportFilePage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ReportFileOut]


@router.get("/history", response_model=ReportFilePage)
async def list_history(request: Request, kind: Optional[str] = Query(None, max_length=40),
                       limit: int = Query(25, ge=1, le=200), offset: int = Query(0, ge=0),
                       db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ReportFilePage:
    """Stored report files, newest first. ``kind`` narrows to one report type."""
    tid = await _rls(db, tenant)
    where, p = "f.tenant_id = CAST(:t AS uuid)", {"t": tid, "limit": limit, "offset": offset}
    if kind:
        where += " AND f.kind = :kind"
        p["kind"] = kind
    total = (await db.execute(text(f"SELECT count(*) FROM report_files f WHERE {where}"), p)).scalar() or 0
    rows = (await db.execute(text(f"""
        SELECT f.id, f.kind, f.name, f.version_id, av.label AS run_label, av.run_at, f.format, f.file_name,
               f.size_bytes, f.source, f.schedule_id, f.created_by,
               COALESCE(u.name, f.created_by_email) AS created_by_label, f.created_at
          FROM report_files f
          LEFT JOIN analysis_versions av ON av.id = f.version_id AND av.tenant_id = f.tenant_id
          LEFT JOIN users u ON u.id = f.created_by AND u.tenant_id = f.tenant_id
         WHERE {where}
         ORDER BY f.created_at DESC, f.id DESC LIMIT :limit OFFSET :offset
    """), p)).mappings().all()
    admin = await _is_reports_admin(request, tenant, db) if rows else False
    uid = _uid(request)
    items = [ReportFileOut(
        **{k: (str(r[k]) if r[k] is not None and k in ("id", "version_id", "schedule_id", "created_by") else r[k])
           for k in r.keys()},
        can_delete=admin or (uid is not None and r["created_by"] is not None and str(r["created_by"]) == uid),
    ) for r in rows]
    return ReportFilePage(total=int(total), limit=limit, offset=offset, items=items)


def content_disposition(file_name: str) -> str:
    """An attachment header that cannot be broken out of: an ASCII-only ``filename`` (anything else,
    quotes, CR/LF and separators included, becomes ``_``) and the exact name as RFC 5987 ``filename*``."""
    from urllib.parse import quote

    ascii_name = "".join(c if (c.isascii() and c.isalnum()) or c in "._-" else "_" for c in file_name)[:200] or "report"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name, safe='')}"


@router.get("/history/{file_id}/download")
async def download_history(file_id: str, request: Request, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> Response:
    from api.routes.reports import _audit_export

    tid = await _rls(db, tenant)
    fid = _parse_id(file_id, "Report")
    row = (await db.execute(text(
        "SELECT kind, version_id, params, file_name, content_type, storage_key, content FROM report_files "
        "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"), {"id": fid, "t": tid})).first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    try:
        data = await asyncio.to_thread(rh.read_report_file, row.storage_key, row.content)
    except Exception as e:
        logger.warning("stored report %s unreadable (%s)", fid, type(e).__name__)
        raise HTTPException(status_code=404, detail="The stored file is no longer available.")
    # The same report.export audit row as a direct download (api/routes/reports.py).
    await _audit_export(request, tenant, row.kind, row.version_id, (row.params or {}).get("module"))
    return Response(content=data, media_type=row.content_type,
                    headers={"Content-Disposition": content_disposition(row.file_name)})


@router.delete("/history/{file_id}", status_code=204)
async def delete_history(file_id: str, request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> Response:
    tid = await _rls(db, tenant)
    fid = _parse_id(file_id, "Report")
    row = (await db.execute(text("SELECT created_by, storage_key FROM report_files "
                                 "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                            {"id": fid, "t": tid})).first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    if not await _may_change(request, tenant, db, row.created_by):
        raise HTTPException(status_code=403, detail="Only the person who made this report or a reports admin can delete it.")
    await _rls(db, tenant)
    await db.execute(text("DELETE FROM report_files WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                     {"id": fid, "t": tid})
    await db.commit()
    await asyncio.to_thread(rh.remove_report_object, row.storage_key)
    return Response(status_code=204)


# ── schedules ────────────────────────────────────────────────────────────────

class ScheduleParams(BaseModel):
    scope: str = Field("latest", max_length=64, description="'latest', 'upload' or a system id")
    module: Optional[str] = Field(None, max_length=64)


class ScheduleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field(..., max_length=40)
    format: Optional[Literal["pdf", "xlsx", "json"]] = None
    params: ScheduleParams = ScheduleParams()
    cadence: Literal["daily", "weekly", "monthly"]
    time_of_day: time = time(7, 0)
    weekday: Optional[int] = Field(None, ge=0, le=6)
    day_of_month: Optional[int] = Field(None, ge=1, le=31)
    timezone: Optional[str] = Field(None, max_length=64)
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    recipient_channel_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    enabled: bool = True

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown time zone")
        return v

    @field_validator("time_of_day")
    @classmethod
    def _minute(cls, v: time) -> time:
        return v.replace(second=0, microsecond=0, tzinfo=None)


class ScheduleOut(BaseModel):
    id: str
    name: str
    kind: str
    format: str
    params: dict
    cadence: str
    time_of_day: str
    weekday: Optional[int]
    day_of_month: Optional[int]
    timezone: str
    recipient_user_ids: list[str]
    recipient_channel_ids: list[str]
    enabled: bool
    last_run_at: Optional[datetime]
    last_status: Optional[str]
    next_run_at: Optional[datetime]
    created_by: Optional[str]
    created_at: datetime
    summary: str
    can_edit: bool


_SCHED_COLS = ("id, name, kind, format, params, cadence, time_of_day, weekday, day_of_month, timezone, "
               "recipient_user_ids, recipient_channel_ids, enabled, last_run_at, last_status, next_run_at, "
               "created_by, created_at")


def _sched_out(r: Any, can_edit: bool) -> ScheduleOut:
    return ScheduleOut(
        id=str(r["id"]), name=r["name"], kind=r["kind"], format=r["format"], params=dict(r["params"] or {}),
        cadence=r["cadence"], time_of_day=r["time_of_day"].strftime("%H:%M"), weekday=r["weekday"],
        day_of_month=r["day_of_month"], timezone=r["timezone"],
        recipient_user_ids=[str(u) for u in r["recipient_user_ids"] or []],
        recipient_channel_ids=[str(c) for c in r["recipient_channel_ids"] or []], enabled=r["enabled"],
        last_run_at=r["last_run_at"], last_status=r["last_status"], next_run_at=r["next_run_at"],
        created_by=str(r["created_by"]) if r["created_by"] else None, created_at=r["created_at"],
        summary=rh.describe_cadence(r["cadence"], r["time_of_day"], r["timezone"], r["weekday"], r["day_of_month"]),
        can_edit=can_edit,
    )


async def _validated(body: ScheduleIn, db: AsyncSession, tid: str) -> dict:
    """The row values for a schedule, or 422 with the reason."""
    t = rh.REPORT_TYPES.get(body.kind)
    if t is None or not t.schedulable:
        raise HTTPException(status_code=422, detail=f"This report cannot be scheduled: {body.kind}")
    if body.format and body.format != t.format:
        raise HTTPException(status_code=422, detail=f"{t.name} is produced as {t.format.upper()} only.")
    module = body.params.module or None
    if t.needs_module and not module:
        raise HTTPException(status_code=422, detail="Choose an object: this report needs one.")
    if module:
        from api.services.pdf_reports import _modules

        if module not in _modules():
            raise HTTPException(status_code=422, detail=f"Unknown module: {module}")
    scope = body.params.scope or "latest"
    if scope not in ("latest", "upload"):
        try:
            sid = str(uuid.UUID(scope))
        except ValueError:
            raise HTTPException(status_code=422, detail="Scope is 'latest', 'upload' or a system id.")
        if not (await db.execute(text("SELECT 1 FROM sap_systems WHERE id = CAST(:s AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                                 {"s": sid, "t": tid})).scalar():
            raise HTTPException(status_code=422, detail="System not found.")
        scope = sid
    users = sorted({str(u) for u in body.recipient_user_ids})
    channels = sorted({str(c) for c in body.recipient_channel_ids})
    if users:
        n = (await db.execute(text("SELECT count(*) FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
                                   "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": tid, "ids": users})).scalar()
        if n != len(users):
            raise HTTPException(status_code=422, detail="One or more recipients are not active users.")
        # A report goes only to people allowed to download it (the worker checks again at send time).
        allowed = await db.run_sync(lambda s: rbac.active_users_holding_sync(s, tid, users, "export"))
        if len(allowed) != len(users):
            raise HTTPException(status_code=422, detail="One or more recipients do not have the export permission.")
    if channels:
        n = (await db.execute(text("SELECT count(*) FROM alert_channels WHERE tenant_id = CAST(:t AS uuid) "
                                   "AND id = ANY(CAST(:ids AS uuid[]))"), {"t": tid, "ids": channels})).scalar()
        if n != len(channels):
            raise HTTPException(status_code=422, detail="One or more alert channels were not found.")
    tz = body.timezone
    if not tz:
        tz = (await db.execute(text("SELECT timezone FROM triage_settings WHERE tenant_id = CAST(:t AS uuid)"),
                               {"t": tid})).scalar() or "UTC"
    weekday = (body.weekday if body.weekday is not None else 0) if body.cadence == "weekly" else None
    dom = (body.day_of_month or 1) if body.cadence == "monthly" else None
    params: dict[str, Any] = {"scope": scope}
    if module:
        params["module"] = module
    nxt = rh.next_run_at(body.cadence, body.time_of_day, tz, rh.utcnow(), weekday=weekday, day_of_month=dom)
    return {"name": body.name.strip(), "kind": body.kind, "format": t.format, "params": params,
            "cadence": body.cadence, "time_of_day": body.time_of_day, "weekday": weekday, "day_of_month": dom,
            "timezone": tz, "users": users, "channels": channels, "enabled": body.enabled, "next": nxt}


async def _load(db: AsyncSession, tid: str, sid: str) -> Any:
    row = (await db.execute(text(f"SELECT {_SCHED_COLS} FROM report_schedules "
                                 "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                            {"id": sid, "t": tid})).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    return row


@router.get("/schedules", response_model=list[ScheduleOut])
async def list_schedules(request: Request, db: AsyncSession = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant)) -> list[ScheduleOut]:
    tid = await _rls(db, tenant)
    rows = (await db.execute(text(f"SELECT {_SCHED_COLS} FROM report_schedules WHERE tenant_id = CAST(:t AS uuid) "
                                  "ORDER BY created_at"), {"t": tid})).mappings().all()
    admin = await _is_reports_admin(request, tenant, db) if rows else False
    uid = _uid(request)
    return [_sched_out(r, admin or (uid is not None and r["created_by"] is not None and str(r["created_by"]) == uid))
            for r in rows]


class TypeOption(BaseModel):
    id: str
    name: str
    format: str
    needs_run: bool
    needs_module: bool


class Recipient(BaseModel):
    id: str
    label: str
    detail: Optional[str] = None


class ScheduleOptions(BaseModel):
    timezone: str
    types: list[TypeOption]
    users: list[Recipient]
    channels: list[Recipient]
    systems: list[Recipient]
    modules: list[str]


@router.get("/schedules/options", response_model=ScheduleOptions)
async def schedule_options(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> ScheduleOptions:
    """What a schedule can be: report types, active users and alert channels to send to, systems
    to scope to, objects, and the tenant's time zone (the default for a new schedule)."""
    from api.services.pdf_reports import _modules

    tid = await _rls(db, tenant)
    p = {"t": tid}
    tz = (await db.execute(text("SELECT timezone FROM triage_settings WHERE tenant_id = CAST(:t AS uuid)"), p)).scalar()
    users = (await db.execute(text("SELECT id, name, email FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
                                   "ORDER BY lower(name)"), p)).fetchall()
    channels = (await db.execute(text("SELECT id, kind, target FROM alert_channels WHERE tenant_id = CAST(:t AS uuid) "
                                      "AND enabled ORDER BY created_at"), p)).fetchall()
    systems = (await db.execute(text("SELECT id, name FROM sap_systems WHERE tenant_id = CAST(:t AS uuid) "
                                     "ORDER BY lower(name)"), p)).fetchall()
    return ScheduleOptions(
        timezone=tz or "UTC",
        types=[TypeOption(id=k, name=v.name, format=v.format, needs_run=v.needs_run, needs_module=v.needs_module)
               for k, v in rh.REPORT_TYPES.items() if v.schedulable],
        users=[Recipient(id=str(u.id), label=u.name, detail=u.email) for u in users],
        channels=[Recipient(id=str(c.id), label=rh.channel_label(c.kind, c.target), detail=c.kind) for c in channels],
        systems=[Recipient(id=str(s.id), label=s.name) for s in systems],
        modules=sorted(_modules()),
    )


@router.post("/schedules", response_model=ScheduleOut, status_code=201)
async def create_schedule(body: ScheduleIn, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> ScheduleOut:
    tid = await _rls(db, tenant)
    v = await _validated(body, db, tid)
    actor = await _actor(request, db, tid)
    import json

    row = (await db.execute(text(f"""
        INSERT INTO report_schedules (tenant_id, name, kind, format, params, cadence, time_of_day, weekday,
                                      day_of_month, timezone, recipient_user_ids, recipient_channel_ids, enabled,
                                      next_run_at, created_by)
        VALUES (CAST(:t AS uuid), :name, :kind, :format, CAST(:params AS jsonb), :cadence, :tod, :weekday, :dom, :tz,
                CAST(:users AS uuid[]), CAST(:channels AS uuid[]), :enabled, :next, CAST(:by AS uuid))
        RETURNING {_SCHED_COLS}
    """), {"t": tid, "name": v["name"], "kind": v["kind"], "format": v["format"], "params": json.dumps(v["params"]),
           "cadence": v["cadence"], "tod": v["time_of_day"], "weekday": v["weekday"], "dom": v["day_of_month"],
           "tz": v["timezone"], "users": v["users"], "channels": v["channels"], "enabled": v["enabled"],
           "next": v["next"], "by": actor})).mappings().first()
    await db.commit()
    return _sched_out(row, True)


@router.put("/schedules/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(schedule_id: str, body: ScheduleIn, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> ScheduleOut:
    import json

    tid = await _rls(db, tenant)
    sid = _parse_id(schedule_id, "Schedule")
    cur = await _load(db, tid, sid)
    if not await _may_change(request, tenant, db, cur["created_by"]):
        raise HTTPException(status_code=403, detail="Only the person who made this schedule or a reports admin can change it.")
    await _rls(db, tenant)
    v = await _validated(body, db, tid)
    row = (await db.execute(text(f"""
        UPDATE report_schedules SET name = :name, kind = :kind, format = :format, params = CAST(:params AS jsonb),
               cadence = :cadence, time_of_day = :tod, weekday = :weekday, day_of_month = :dom, timezone = :tz,
               recipient_user_ids = CAST(:users AS uuid[]), recipient_channel_ids = CAST(:channels AS uuid[]),
               enabled = :enabled, next_run_at = :next, updated_at = now()
         WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)
        RETURNING {_SCHED_COLS}
    """), {"id": sid, "t": tid, "name": v["name"], "kind": v["kind"], "format": v["format"],
           "params": json.dumps(v["params"]), "cadence": v["cadence"], "tod": v["time_of_day"],
           "weekday": v["weekday"], "dom": v["day_of_month"], "tz": v["timezone"], "users": v["users"],
           "channels": v["channels"], "enabled": v["enabled"], "next": v["next"]})).mappings().first()
    await db.commit()
    return _sched_out(row, True)


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                          tenant: Tenant = Depends(get_tenant)) -> Response:
    tid = await _rls(db, tenant)
    sid = _parse_id(schedule_id, "Schedule")
    cur = await _load(db, tid, sid)
    if not await _may_change(request, tenant, db, cur["created_by"]):
        raise HTTPException(status_code=403, detail="Only the person who made this schedule or a reports admin can delete it.")
    await _rls(db, tenant)
    await db.execute(text("DELETE FROM report_schedules WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                     {"id": sid, "t": tid})
    await db.commit()
    return Response(status_code=204)


def _enqueue_run(tenant_id: str, schedule_id: str, due_at: datetime) -> None:
    from workers.tasks.report_schedules import run_report_schedule

    run_report_schedule.delay(tenant_id, schedule_id, due_at.isoformat())


class RunQueued(BaseModel):
    queued: bool
    due_at: datetime


@router.post("/schedules/{schedule_id}/run", response_model=RunQueued, status_code=202)
async def run_schedule_now(schedule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant)) -> RunQueued:
    """Generate and deliver the schedule's report now, on the worker. The run keeps its own slot
    (this request's time), so it never takes the place of the next scheduled run."""
    tid = await _rls(db, tenant)
    sid = _parse_id(schedule_id, "Schedule")
    cur = await _load(db, tid, sid)
    if not await _may_change(request, tenant, db, cur["created_by"]):
        raise HTTPException(status_code=403, detail="Only the person who made this schedule or a reports admin can run it.")
    due = datetime.now(timezone.utc).replace(microsecond=0)
    try:
        _enqueue_run(tid, sid, due)
    except Exception as e:
        logger.error("run now not queued (%s)", type(e).__name__)
        raise HTTPException(status_code=503, detail="The report worker is not reachable. Try again shortly.")
    return RunQueued(queued=True, due_at=due)
