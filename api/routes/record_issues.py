"""Record issues — the steward work list: one row per failing SAP record per check,
tracked across runs (auto-resolved when a later run shows the record passing,
re-opened when it fails again). See api/services/record_issues.py.
"""

import io
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import current_user_id, current_user_label, has_permission, require_permission

router = APIRouter(prefix="/api/v1/issues", tags=["issues"])

Status = Literal["open", "in_progress", "waiting_sap", "waiting_requester", "accepted", "resolved"]
# accepted = a signed-off exception (risk accepted / false positive) → needs `approve`
_RESOLUTIONS = {"accepted": {"accepted_risk", "false_positive"}, "resolved": {"fixed_in_source"}}


class BulkUpdate(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=5000)
    status: Optional[Status] = None
    resolution: Optional[str] = None
    assigned_to: Optional[str] = None   # user id, or "" to unassign
    note: Optional[str] = None


class CommentBody(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


def _where(status, module, check_id, severity, assigned_to, scope, search, request,
           version_id: Optional[uuid.UUID] = None) -> tuple[str, dict]:
    where, p = ["1=1"], {}
    for col, val in (("status", status), ("module", module), ("check_id", check_id),
                     ("severity", severity), ("scope", scope)):
        if val:
            where.append(f"ri.{col} = :{col}")
            p[col] = val
    if assigned_to == "unassigned":
        where.append("ri.assigned_to IS NULL")
    elif assigned_to:
        where.append("ri.assigned_to = CAST(:assignee AS uuid)")
        p["assignee"] = current_user_id(request) if assigned_to == "me" else assigned_to
    if search:
        where.append("ri.record_key ILIKE :q")
        p["q"] = f"%{search}%"
    if version_id:
        # issues whose record failed this check in that version
        where.append("EXISTS (SELECT 1 FROM finding_records fr WHERE fr.version_id = CAST(:version_id AS uuid) "
                     "AND fr.check_id = ri.check_id AND fr.record_key = ri.record_key)")
        p["version_id"] = str(version_id)
    return " AND ".join(where), p


_SELECT = """
    SELECT ri.id, ri.scope, ri.module, ri.check_id, ri.record_key, ri.grain, ri.severity, ri.status,
           ri.resolution, ri.assigned_to, u.email AS assignee_email, ri.first_seen_version,
           ri.last_seen_version, ri.resolved_version, ri.first_seen_at, ri.last_seen_at, ri.resolved_at,
           ri.reopened_count, ri.priority, ri.assigned_team_id, ri.acknowledged_at, ri.due_at, ri.ack_due_at,
           ri.risk_at, ri.sla_state, ri.sla_paused_at, ri.snoozed_until, ri.snooze_reason,
           f.details->>'message' AS message, f.details->>'field_checked' AS field
      FROM record_issues ri
      LEFT JOIN users u ON u.id = ri.assigned_to
      LEFT JOIN findings f ON f.version_id = ri.last_seen_version AND f.check_id = ri.check_id
"""
_ORDER = ("ORDER BY CASE ri.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, "
          "ri.first_seen_at, ri.check_id, ri.record_key")


def _row(r) -> dict:
    return {k: (str(v) if isinstance(v, uuid.UUID) else v.isoformat() if hasattr(v, "isoformat") else v)
            for k, v in r._mapping.items()}


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": str(tenant.id)})


@router.get("")
async def list_issues(
    request: Request,
    status: Optional[str] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = None,
    assigned_to: Optional[str] = Query(None, description="user id, 'me' or 'unassigned'"),
    scope: Optional[str] = None,
    search: Optional[str] = None,
    version_id: Optional[uuid.UUID] = Query(None, description="Only records failing in this version"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    where, p = _where(status, module, check_id, severity, assigned_to, scope, search, request, version_id)
    total = (await db.execute(text(f"SELECT COUNT(*) FROM record_issues ri WHERE {where}"), p)).scalar()
    # status counts ignore the status filter so the tabs always show every bucket
    w2, p2 = _where(None, module, check_id, severity, assigned_to, scope, search, request, version_id)
    counts = dict((await db.execute(text(f"SELECT ri.status, COUNT(*) FROM record_issues ri WHERE {w2} "
                                         f"GROUP BY ri.status"), p2)).fetchall())
    rows = await db.execute(text(f"{_SELECT} WHERE {where} {_ORDER} LIMIT :limit OFFSET :offset"),
                            {**p, "limit": limit, "offset": offset})
    return {"total": int(total or 0), "counts": counts, "items": [_row(r) for r in rows.fetchall()]}


@router.get("/export")
async def export_issues(
    request: Request,
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    status: Optional[str] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = None,
    assigned_to: Optional[str] = None,
    scope: Optional[str] = None,
    search: Optional[str] = None,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("export")),
):
    """The work list with SAP record keys — hand to the team correcting data in SAP."""
    import pandas as pd

    await _rls(db, tenant)
    where, p = _where(status, module, check_id, severity, assigned_to, scope, search, request, version_id)
    rows = (await db.execute(text(f"{_SELECT} WHERE {where} {_ORDER} LIMIT 1000000"), p)).fetchall()
    df = pd.DataFrame([_row(r) for r in rows])
    if format == "csv":
        data, media, ext = df.to_csv(index=False).encode(), "text/csv", "csv"
    else:
        buf = io.BytesIO()
        df.to_excel(buf, index=False, engine="openpyxl")
        data, media, ext = buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    return StreamingResponse(io.BytesIO(data), media_type=media,
                             headers={"Content-Disposition": f"attachment; filename=record_issues.{ext}"})


@router.get("/{issue_id}")
async def get_issue(
    issue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    await _rls(db, tenant)
    row = (await db.execute(text(f"{_SELECT} WHERE ri.id = :id"), {"id": issue_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Issue not found")
    events = await db.execute(text(
        "SELECT action, from_value, to_value, note, user_label, version_id, created_at "
        "FROM record_issue_events WHERE issue_id = :id ORDER BY created_at"), {"id": issue_id})
    history = await db.execute(text("""
        SELECT v.id AS version_id, v.run_at, (fr.record_key IS NOT NULL) AS failing
          FROM analysis_versions v
          LEFT JOIN finding_records fr ON fr.version_id = v.id AND fr.check_id = :cid AND fr.record_key = :rk
         WHERE COALESCE(v.metadata->>'system_id', 'upload') = :scope AND v.status = 'complete'
           AND EXISTS (SELECT 1 FROM findings f WHERE f.version_id = v.id AND f.check_id = :cid)
         ORDER BY v.run_at DESC LIMIT 20
    """), {"cid": row.check_id, "rk": row.record_key, "scope": row.scope})
    return {"issue": _row(row), "events": [_row(e) for e in events.fetchall()],
            "runs": [_row(h) for h in history.fetchall()]}


@router.post("/bulk")
async def bulk_update(
    body: BulkUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """Change status / assignee of many issues; every change is an audited event."""
    if body.status is None and body.assigned_to is None and not body.note:
        raise HTTPException(status_code=400, detail="Nothing to change.")
    need = {"approve"} if body.status == "accepted" else set()
    if body.status or body.assigned_to is not None:
        need.add("assign")
    if body.note and not body.status:  # a note on a status change is that change's reason
        need.add("analyse")
    missing = [a for a in need if not has_permission(role, a)]
    if missing:
        raise HTTPException(status_code=403, detail=f"Your role cannot {', '.join(sorted(missing))}.")
    if body.status in _RESOLUTIONS and body.resolution not in _RESOLUTIONS[body.status]:
        raise HTTPException(status_code=400, detail=(
            f"Status '{body.status}' needs a resolution: {', '.join(sorted(_RESOLUTIONS[body.status]))}."))
    if body.resolution == "false_positive" and not (body.note or "").strip():
        raise HTTPException(status_code=400, detail="Say why it is not an issue: a false positive needs a note.")

    await _rls(db, tenant)
    ids = list(body.ids)
    who = {"uid": current_user_id(request), "label": current_user_label()}
    changed = 0
    if body.status:
        res = await db.execute(text("""
            WITH old AS (SELECT id, status FROM record_issues WHERE id = ANY(CAST(:ids AS uuid[])) FOR UPDATE),
                 upd AS (
                    UPDATE record_issues ri SET status = :st, resolution = :res, updated_at = now(),
                           acknowledged_at = COALESCE(ri.acknowledged_at, CASE WHEN :st <> 'open' THEN now() END),
                           resolved_at = CASE WHEN :st IN ('resolved', 'accepted') THEN now() END,
                           -- a steward's judgement; re-opening by hand withdraws it
                           steward_verdict = CASE WHEN :res = 'false_positive' THEN 'false_positive'
                                                  WHEN :res IS NOT NULL THEN 'real' END
                      FROM old WHERE ri.id = old.id AND old.status <> :st
                    RETURNING ri.id, old.status AS prev)
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value, to_value, note)
            SELECT :tid, id, CAST(:uid AS uuid), :label, 'status', prev, :st, :note FROM upd
        """), {"ids": ids, "st": body.status, "res": body.resolution if body.status in _RESOLUTIONS else None,
               "tid": str(tenant.id), "note": body.note, **who})
        changed = max(changed, res.rowcount)
    if body.assigned_to is not None:
        assignee = body.assigned_to or None
        if assignee and not (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid)"),
                                              {"u": assignee})).scalar():
            raise HTTPException(status_code=404, detail="Assignee not found.")
        res = await db.execute(text("""
            WITH old AS (SELECT id, assigned_to FROM record_issues WHERE id = ANY(CAST(:ids AS uuid[])) FOR UPDATE),
                 upd AS (
                    UPDATE record_issues ri SET assigned_to = CAST(:a AS uuid), updated_at = now(),
                           assigned_at = now(), assigned_team_id = NULL, assigned_by_rule = NULL
                      FROM old WHERE ri.id = old.id AND old.assigned_to IS DISTINCT FROM CAST(:a AS uuid)
                    RETURNING ri.id, old.assigned_to AS prev)
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value, to_value, note)
            SELECT :tid, id, CAST(:uid AS uuid), :label, 'assign', CAST(prev AS text), :a, :note FROM upd
        """), {"ids": ids, "a": assignee, "tid": str(tenant.id), "note": body.note, **who})
        changed = max(changed, res.rowcount)
    if body.note and body.status is None and body.assigned_to is None:
        res = await db.execute(text("""
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, note)
            SELECT :tid, id, CAST(:uid AS uuid), :label, 'comment', :note
              FROM record_issues WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"ids": ids, "tid": str(tenant.id), "note": body.note, **who})
        changed = res.rowcount
    if body.status or body.assigned_to:
        from api.services import triage
        tid = str(tenant.id)
        await db.run_sync(lambda s: (triage.sync_pause(s, tid, "issue", ids), triage.apply_sla(s, tid, "issue", ids)))
    await db.commit()
    return {"updated": changed}


@router.post("/{issue_id}/comments")
async def add_comment(
    issue_id: uuid.UUID,
    body: CommentBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("analyse")),
):
    await _rls(db, tenant)
    res = await db.execute(text("""
        INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, note)
        SELECT :tid, id, CAST(:uid AS uuid), :label, 'comment', :note FROM record_issues WHERE id = :id
    """), {"tid": str(tenant.id), "id": issue_id, "uid": current_user_id(request),
           "label": current_user_label(), "note": body.body})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Issue not found")
    await db.commit()
    return {"ok": True}
