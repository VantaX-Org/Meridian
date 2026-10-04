"""Triage: assignment rules, teams, SLA policies, business-hours calendar, the ranked
"my queue", bulk triage actions and SLA metrics. Engine: api/services/triage.py.

Every mutating call is also written to audit_log by the audit middleware; record-issue
changes additionally land in record_issue_events (the per-issue history).
"""

import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import triage
from api.services.rbac import current_user_id, current_user_label, require_permission

router = APIRouter(prefix="/api/v1/triage", tags=["triage"])

Severity = Literal["critical", "high", "medium", "low"]
Kind = Literal["issue", "queue"]
Strategy = Literal["round_robin", "least_loaded"]


# ── models ────────────────────────────────────────────────────────────────────


class RuleMatch(BaseModel, extra="forbid"):
    """Each criterion is a list of accepted values (any of); all given criteria must hold."""
    module: Optional[list[str]] = None
    check_id: Optional[list[str]] = None
    severity: Optional[list[Severity]] = None
    dimension: Optional[list[str]] = None
    company_code: Optional[list[str]] = None
    plant: Optional[list[str]] = None
    sales_org: Optional[list[str]] = None


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    match: RuleMatch = RuleMatch()
    assign_user_id: Optional[uuid.UUID] = None
    assign_team_id: Optional[uuid.UUID] = None
    enabled: bool = True
    position: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def _one_target(self) -> "RuleIn":
        if (self.assign_user_id is None) == (self.assign_team_id is None):
            raise ValueError("set exactly one of assign_user_id / assign_team_id")
        return self


class RuleOut(BaseModel):
    id: str
    name: str
    position: int
    enabled: bool
    match: dict[str, Any]
    assign_user_id: Optional[str]
    assign_team_id: Optional[str]
    updated_at: Optional[datetime]


class ReorderIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    strategy: Strategy = "round_robin"
    lead_user_id: Optional[uuid.UUID] = None
    member_ids: Optional[list[uuid.UUID]] = Field(None, max_length=500)


class TeamPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    strategy: Optional[Strategy] = None
    lead_user_id: Optional[uuid.UUID] = None


class MembersIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(max_length=500)


class TeamOut(BaseModel):
    id: str
    name: str
    strategy: str
    lead_user_id: Optional[str]
    member_ids: list[str]
    open_items: int


class PolicyIn(BaseModel):
    severity: Severity
    module: Optional[str] = Field(None, min_length=1, max_length=100)
    ack_minutes: Optional[int] = Field(None, gt=0, le=525600)
    resolve_minutes: int = Field(gt=0, le=525600)
    at_risk_pct: int = Field(80, ge=1, le=99)
    business_hours: bool = False


class PolicyOut(PolicyIn):
    id: Optional[str]
    is_default: bool = False


class SettingsIn(BaseModel):
    timezone: str = "UTC"
    work_days: list[int] = Field([1, 2, 3, 4, 5], min_length=1, max_length=7)
    work_start: time = time(8)
    work_end: time = time(17)
    holidays: list[date] = Field([], max_length=400)
    fallback_user_id: Optional[uuid.UUID] = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"unknown timezone '{v}'")
        return v

    @model_validator(mode="after")
    def _calendar(self) -> "SettingsIn":
        triage.Calendar(self.timezone, tuple(self.work_days), self.work_start, self.work_end)
        return self


class BulkIn(BaseModel):
    kind: Kind
    ids: list[uuid.UUID] = Field(min_length=1, max_length=5000)
    action: Literal["assign", "reassign", "snooze", "unsnooze", "priority", "acknowledge", "wait", "resume"]
    user_id: Optional[uuid.UUID] = None
    team_id: Optional[uuid.UUID] = None
    reason: Optional[str] = Field(None, max_length=1000)
    until: Optional[datetime] = None
    priority: Optional[int] = Field(None, ge=1, le=5)
    waiting: Literal["waiting_sap", "waiting_requester"] = "waiting_sap"
    note: Optional[str] = Field(None, max_length=4000)

    @model_validator(mode="after")
    def _args(self) -> "BulkIn":
        if self.action in ("assign", "reassign") and not (self.user_id or self.team_id):
            raise ValueError("assign / reassign need user_id or team_id")
        if self.action == "snooze":
            if not (self.reason and self.reason.strip()):
                raise ValueError("snooze needs a reason")
            if not self.until or self.until.tzinfo is None or self.until <= datetime.now(UTC):
                raise ValueError("snooze needs a future, timezone-aware 'until'")
        if self.action == "priority" and self.priority is None:
            raise ValueError("priority action needs priority 1..5")
        return self


class BulkOut(BaseModel):
    action: str
    updated: int
    sla: dict[str, Any] = {}


class QueueItem(BaseModel):
    kind: str
    id: str
    module: Optional[str]
    check_id: Optional[str]
    severity: str
    status: str
    ref: Optional[str]
    assigned_to: Optional[str]
    assigned_team_id: Optional[str]
    priority: Optional[int]
    sla_state: Optional[str]
    due_at: Optional[datetime]
    ack_due_at: Optional[datetime]
    acknowledged_at: Optional[datetime]
    sla_paused_at: Optional[datetime]
    snoozed_until: Optional[datetime]
    snooze_reason: Optional[str]
    impact: float
    urgency: float
    rank_score: float


class Bucket(BaseModel):
    count: int
    items: list[QueueItem]


class QueueOut(BaseModel):
    assignee: str
    as_of: datetime
    overdue: Bucket
    due_today: Bucket
    later: Bucket


class MetricsOut(BaseModel):
    weeks: int
    backlog_by_owner: list[dict[str, Any]]
    backlog_by_team: list[dict[str, Any]]
    unassigned: int
    resolved_in_sla: int
    resolved_total: int
    sla_attainment_pct: Optional[float]
    mtta_hours: Optional[float]
    mttr_hours: Optional[float]
    breach_count: int
    weekly: list[dict[str, Any]]


# ── helpers ───────────────────────────────────────────────────────────────────


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    tid = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tid})
    return tid


def _s(v: Any) -> Any:
    return str(v) if isinstance(v, uuid.UUID) else v


async def _active_users(db: AsyncSession, tid: str, ids: list[Optional[uuid.UUID]]) -> None:
    want = {str(i) for i in ids if i}
    if not want:
        return
    rows = await db.execute(text("SELECT id::text FROM users WHERE tenant_id = CAST(:tid AS uuid) AND is_active "
                                 "AND id = ANY(CAST(:ids AS uuid[]))"), {"tid": tid, "ids": list(want)})
    missing = want - {r[0] for r in rows}
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown or inactive user(s): {', '.join(sorted(missing))}")


async def _team_exists(db: AsyncSession, tid: str, team_id: uuid.UUID) -> None:
    if not (await db.execute(text("SELECT 1 FROM triage_teams WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
                             {"id": team_id, "tid": tid})).scalar():
        raise HTTPException(status_code=404, detail="Team not found")


# ── teams ─────────────────────────────────────────────────────────────────────

_TEAMS_SQL = f"""
    SELECT t.id, t.name, t.strategy, t.lead_user_id,
           COALESCE((SELECT array_agg(m.user_id::text ORDER BY m.user_id) FROM triage_team_members m
                      WHERE m.team_id = t.id), '{{}}') AS member_ids,
           (SELECT COUNT(*) FROM record_issues ri WHERE ri.assigned_team_id = t.id
               AND ri.status NOT IN ('resolved', 'accepted'))
         + (SELECT COUNT(*) FROM stewardship_queue sq WHERE sq.assigned_team_id = t.id
               AND sq.status NOT IN ('resolved', 'accepted')) AS open_items
      FROM triage_teams t WHERE t.tenant_id = CAST(:tid AS uuid)"""


async def _team_out(db: AsyncSession, tid: str, team_id: Optional[uuid.UUID] = None) -> list[TeamOut]:
    sql = _TEAMS_SQL + (" AND t.id = :id" if team_id else "") + " ORDER BY t.name"
    rows = await db.execute(text(sql), {"tid": tid, "id": team_id})
    return [TeamOut(**{k: _s(v) for k, v in r._mapping.items()}) for r in rows]


async def _set_members(db: AsyncSession, tid: str, team_id: uuid.UUID, ids: list[uuid.UUID]) -> None:
    await _active_users(db, tid, list(ids))
    await db.execute(text("DELETE FROM triage_team_members WHERE team_id = :id AND tenant_id = CAST(:tid AS uuid)"),
                     {"id": team_id, "tid": tid})
    if ids:
        await db.execute(text("INSERT INTO triage_team_members (tenant_id, team_id, user_id) "
                              "SELECT CAST(:tid AS uuid), :id, u FROM unnest(CAST(:ids AS uuid[])) u"),
                         {"tid": tid, "id": team_id, "ids": list(dict.fromkeys(ids))})


@router.get("/teams", response_model=list[TeamOut])
async def list_teams(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     _r: str = Depends(require_permission("view"))):
    return await _team_out(db, await _rls(db, tenant))


@router.post("/teams", response_model=TeamOut, status_code=201)
async def create_team(body: TeamIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                      _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    await _active_users(db, tid, [body.lead_user_id])
    if (await db.execute(text("SELECT 1 FROM triage_teams WHERE tenant_id = CAST(:tid AS uuid) AND name = :n"),
                         {"tid": tid, "n": body.name})).scalar():
        raise HTTPException(status_code=409, detail="A team with this name exists")
    team_id = (await db.execute(text(
        "INSERT INTO triage_teams (tenant_id, name, strategy, lead_user_id) "
        "VALUES (CAST(:tid AS uuid), :n, :s, :l) RETURNING id"),
        {"tid": tid, "n": body.name, "s": body.strategy, "l": body.lead_user_id})).scalar()
    await _set_members(db, tid, team_id, body.member_ids or [])
    await db.commit()
    return (await _team_out(db, tid, team_id))[0]


@router.patch("/teams/{team_id}", response_model=TeamOut)
async def update_team(team_id: uuid.UUID, body: TeamPatch, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    await _team_exists(db, tid, team_id)
    fields = body.model_dump(exclude_unset=True)
    await _active_users(db, tid, [fields.get("lead_user_id")])
    if fields:
        sets = ", ".join(f"{k} = :{k}" for k in fields)
        try:
            await db.execute(text(f"UPDATE triage_teams SET {sets} WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
                             {**fields, "id": team_id, "tid": tid})
        except Exception as e:  # unique name
            raise HTTPException(status_code=409, detail="A team with this name exists") from e
    await db.commit()
    return (await _team_out(db, tid, team_id))[0]


@router.put("/teams/{team_id}/members", response_model=TeamOut)
async def set_team_members(team_id: uuid.UUID, body: MembersIn, db: AsyncSession = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant),
                           _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    await _team_exists(db, tid, team_id)
    await _set_members(db, tid, team_id, body.user_ids)
    await db.commit()
    return (await _team_out(db, tid, team_id))[0]


@router.delete("/teams/{team_id}", status_code=204)
async def delete_team(team_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                      _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    # rules pointing at the team are removed with it (FK cascade); items keep their owner
    res = await db.execute(text("DELETE FROM triage_teams WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
                           {"id": team_id, "tid": tid})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Team not found")
    await db.commit()


# ── assignment rules ──────────────────────────────────────────────────────────

_RULE_COLS = "id, name, position, enabled, match, assign_user_id, assign_team_id, updated_at"


def _rule_out(r) -> RuleOut:
    return RuleOut(**{k: _s(v) for k, v in r._mapping.items()})


async def _validate_rule(db: AsyncSession, tid: str, body: RuleIn) -> None:
    await _active_users(db, tid, [body.assign_user_id])
    if body.assign_team_id:
        await _team_exists(db, tid, body.assign_team_id)


@router.get("/rules", response_model=list[RuleOut])
async def list_rules(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     _r: str = Depends(require_permission("view"))):
    tid = await _rls(db, tenant)
    rows = await db.execute(text(f"SELECT {_RULE_COLS} FROM assignment_rules WHERE tenant_id = CAST(:tid AS uuid) "
                                 "ORDER BY position, created_at"), {"tid": tid})
    return [_rule_out(r) for r in rows]


@router.post("/rules", response_model=RuleOut, status_code=201)
async def create_rule(body: RuleIn, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    await _validate_rule(db, tid, body)
    if body.position is None:  # append
        body.position = int((await db.execute(text(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM assignment_rules WHERE tenant_id = CAST(:tid AS uuid)"),
            {"tid": tid})).scalar())
    else:  # insert before the rule currently at that position
        await db.execute(text("UPDATE assignment_rules SET position = position + 1 "
                              "WHERE tenant_id = CAST(:tid AS uuid) AND position >= :p"), {"tid": tid, "p": body.position})
    row = (await db.execute(text(f"""
        INSERT INTO assignment_rules (tenant_id, name, position, enabled, match, assign_user_id, assign_team_id,
                                      created_by)
        VALUES (CAST(:tid AS uuid), :name, :pos, :en, CAST(:match AS jsonb), :u, :t, CAST(:by AS uuid))
        RETURNING {_RULE_COLS}"""),
        {"tid": tid, "name": body.name, "pos": body.position, "en": body.enabled,
         "match": body.match.model_dump_json(exclude_none=True), "u": body.assign_user_id,
         "t": body.assign_team_id, "by": current_user_id(request)})).fetchone()
    await db.commit()
    return _rule_out(row)


@router.patch("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(rule_id: uuid.UUID, body: RuleIn, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("manage_rules"))):
    """Full replace of name / match / target / enabled; position changes go through /rules/reorder."""
    tid = await _rls(db, tenant)
    await _validate_rule(db, tid, body)
    row = (await db.execute(text(f"""
        UPDATE assignment_rules SET name = :name, enabled = :en, match = CAST(:match AS jsonb),
               assign_user_id = :u, assign_team_id = :t, updated_at = now()
         WHERE id = :id AND tenant_id = CAST(:tid AS uuid) RETURNING {_RULE_COLS}"""),
        {"tid": tid, "id": rule_id, "name": body.name, "en": body.enabled,
         "match": body.match.model_dump_json(exclude_none=True), "u": body.assign_user_id,
         "t": body.assign_team_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.commit()
    return _rule_out(row)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                      _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    res = await db.execute(text("DELETE FROM assignment_rules WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
                           {"id": rule_id, "tid": tid})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.commit()


@router.post("/rules/reorder", response_model=list[RuleOut])
async def reorder_rules(body: ReorderIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                        _r: str = Depends(require_permission("manage_rules"))):
    """`ids` must list every rule of the tenant exactly once, in the new evaluation order."""
    tid = await _rls(db, tenant)
    have = {r[0] for r in await db.execute(text(
        "SELECT id FROM assignment_rules WHERE tenant_id = CAST(:tid AS uuid)"), {"tid": tid})}
    if len(set(body.ids)) != len(body.ids) or set(body.ids) != have:
        raise HTTPException(status_code=422, detail="ids must list every rule exactly once")
    await db.execute(text("""
        UPDATE assignment_rules r SET position = x.pos - 1, updated_at = now()
          FROM unnest(CAST(:ids AS uuid[])) WITH ORDINALITY AS x(id, pos)
         WHERE r.id = x.id AND r.tenant_id = CAST(:tid AS uuid)"""), {"ids": body.ids, "tid": tid})
    await db.commit()
    return await list_rules(db, tenant, "")


# ── SLA policies + calendar ───────────────────────────────────────────────────


@router.get("/sla-policies", response_model=list[PolicyOut])
async def list_policies(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                        _r: str = Depends(require_permission("view"))):
    """Configured policies, plus the built-in default for any severity without one."""
    tid = await _rls(db, tenant)
    rows = (await db.execute(text(
        "SELECT id, severity, module, ack_minutes, resolve_minutes, at_risk_pct, business_hours FROM sla_policies "
        "WHERE tenant_id = CAST(:tid AS uuid) ORDER BY array_position(ARRAY['critical','high','medium','low'], "
        "severity), module NULLS FIRST"), {"tid": tid})).fetchall()
    out = [PolicyOut(**{k: _s(v) for k, v in r._mapping.items()}) for r in rows]
    covered = {p.severity for p in out if p.module is None}
    out += [PolicyOut(id=None, severity=sev, is_default=True, at_risk_pct=80, business_hours=False,
                      **triage.DEFAULT_POLICIES[sev]) for sev in triage.SEVERITIES if sev not in covered]
    return out


@router.put("/sla-policies", response_model=PolicyOut)
async def upsert_policy(body: PolicyIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                        _r: str = Depends(require_permission("manage_rules"))):
    """Create or replace the policy for (severity, module). Applies to clocks started from now on."""
    tid = await _rls(db, tenant)
    row = (await db.execute(text("""
        INSERT INTO sla_policies (tenant_id, severity, module, ack_minutes, resolve_minutes, at_risk_pct,
                                  business_hours)
        VALUES (CAST(:tid AS uuid), :severity, :module, :ack_minutes, :resolve_minutes, :at_risk_pct, :business_hours)
        ON CONFLICT (tenant_id, severity, COALESCE(module, '')) DO UPDATE
           SET ack_minutes = EXCLUDED.ack_minutes, resolve_minutes = EXCLUDED.resolve_minutes,
               at_risk_pct = EXCLUDED.at_risk_pct, business_hours = EXCLUDED.business_hours
        RETURNING id, severity, module, ack_minutes, resolve_minutes, at_risk_pct, business_hours"""),
        {"tid": tid, **body.model_dump()})).fetchone()
    await db.commit()
    return PolicyOut(**{k: _s(v) for k, v in row._mapping.items()})


@router.delete("/sla-policies/{policy_id}", status_code=204)
async def delete_policy(policy_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("manage_rules"))):
    tid = await _rls(db, tenant)
    res = await db.execute(text("DELETE FROM sla_policies WHERE id = :id AND tenant_id = CAST(:tid AS uuid)"),
                           {"id": policy_id, "tid": tid})
    if not res.rowcount:
        raise HTTPException(status_code=404, detail="Policy not found")
    await db.commit()


@router.get("/settings", response_model=SettingsIn)
async def get_settings(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                       _r: str = Depends(require_permission("view"))):
    tid = await _rls(db, tenant)
    r = (await db.execute(text("SELECT timezone, work_days, work_start, work_end, holidays, fallback_user_id "
                               "FROM triage_settings WHERE tenant_id = CAST(:tid AS uuid)"), {"tid": tid})).fetchone()
    return SettingsIn(**r._mapping) if r else SettingsIn()


@router.put("/settings", response_model=SettingsIn)
async def put_settings(body: SettingsIn, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                       _r: str = Depends(require_permission("manage_settings"))):
    tid = await _rls(db, tenant)
    await _active_users(db, tid, [body.fallback_user_id])
    await db.execute(text("""
        INSERT INTO triage_settings (tenant_id, timezone, work_days, work_start, work_end, holidays, fallback_user_id)
        VALUES (CAST(:tid AS uuid), :timezone, CAST(:work_days AS smallint[]), :work_start, :work_end,
                CAST(:holidays AS date[]), :fallback_user_id)
        ON CONFLICT (tenant_id) DO UPDATE SET timezone = EXCLUDED.timezone, work_days = EXCLUDED.work_days,
               work_start = EXCLUDED.work_start, work_end = EXCLUDED.work_end, holidays = EXCLUDED.holidays,
               fallback_user_id = EXCLUDED.fallback_user_id, updated_at = now()"""),
        {"tid": tid, **body.model_dump(), "work_days": sorted(set(body.work_days)),
         "holidays": sorted(set(body.holidays))})
    await db.commit()
    return body


# ── my queue ──────────────────────────────────────────────────────────────────

_QUEUE_COLS = ("kind, id::text, module, check_id, severity, status, ref, assigned_to::text, assigned_team_id::text, "
               "priority, sla_state, due_at, ack_due_at, acknowledged_at, sla_paused_at, snoozed_until, "
               "snooze_reason, impact::float, urgency::float, rank_score::float")


@router.get("/queue", response_model=QueueOut)
async def my_queue(
    request: Request,
    assignee: str = Query("me", description="'me', a user id, 'team:<id>', 'unassigned' or 'all'"),
    include_snoozed: bool = False,
    limit: int = Query(50, ge=1, le=500, description="items per bucket"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _r: str = Depends(require_permission("view")),
):
    """Open work, ranked (priority, then impact × SLA urgency), grouped overdue / due today / later.
    'Due today' ends at midnight in the tenant's triage timezone."""
    tid = await _rls(db, tenant)
    p: dict[str, Any] = {"tid": tid, "blocks": json.dumps(triage.blocked_features()), "limit": limit}
    where = ["status NOT IN ('resolved', 'accepted')"]
    if assignee == "me":
        uid = current_user_id(request)
        if not uid:
            raise HTTPException(status_code=400, detail="No signed-in user; pass assignee=<user id>")
        where.append("assigned_to = CAST(:who AS uuid)")
        p["who"] = uid
    elif assignee.startswith("team:"):
        where.append("assigned_team_id = CAST(:who AS uuid)")
        p["who"] = assignee[5:]
    elif assignee == "unassigned":
        where.append("assigned_to IS NULL")
    elif assignee != "all":
        where.append("assigned_to = CAST(:who AS uuid)")
        p["who"] = assignee
    if "who" in p:
        try:
            uuid.UUID(p["who"])
        except ValueError:
            raise HTTPException(status_code=422, detail="assignee must be me, unassigned, all, <uuid> or team:<uuid>")
    if not include_snoozed:
        where.append("(snoozed_until IS NULL OR snoozed_until <= now())")
    cal = (await db.run_sync(lambda s: triage.load_settings(s, tid)))["calendar"]
    now = datetime.now(UTC)
    local = now.astimezone(ZoneInfo(cal.tz))
    p["eod"] = datetime.combine(local.date() + timedelta(days=1), time(0), ZoneInfo(cal.tz))
    rows = (await db.execute(text(f"""
        WITH q AS ({triage.ITEMS_SQL}),
             b AS (SELECT q.*, CASE WHEN due_at <= now() THEN 'overdue' WHEN due_at < :eod THEN 'due_today'
                                    ELSE 'later' END AS bucket
                     FROM q WHERE {' AND '.join(where)}),
             n AS (SELECT b.*, COUNT(*) OVER (PARTITION BY bucket) AS total,
                          row_number() OVER (PARTITION BY bucket ORDER BY priority, rank_score DESC,
                                             due_at NULLS LAST, created_at) AS rn FROM b)
        SELECT bucket, total, {_QUEUE_COLS} FROM n WHERE rn <= :limit ORDER BY bucket, rn"""), p)).fetchall()
    out = {k: Bucket(count=0, items=[]) for k in ("overdue", "due_today", "later")}
    for r in rows:
        m = dict(r._mapping)
        b = out[m.pop("bucket")]
        b.count = int(m.pop("total"))
        b.items.append(QueueItem(**m))
    return QueueOut(assignee=assignee, as_of=now, **out)


# ── bulk actions ──────────────────────────────────────────────────────────────


async def _bulk_update(db: AsyncSession, tid: str, kind: str, ids: list, set_sql: str, guard: str,
                       prev_sql: str, action: str, to_value: Optional[str], note: Optional[str],
                       who: dict, extra: Optional[dict] = None) -> int:
    """One guarded UPDATE over the selected items; issues get one history event per changed row."""
    table = triage.TABLES[kind]
    upd = f"""
        WITH old AS (SELECT t.id, {prev_sql} AS prev FROM {table} t
                      WHERE t.tenant_id = CAST(:tid AS uuid) AND t.id = ANY(CAST(:ids AS uuid[])) FOR UPDATE),
             upd AS (UPDATE {table} t SET {set_sql}, updated_at = now() FROM old
                      WHERE t.id = old.id AND t.status NOT IN ('resolved', 'accepted') AND {guard}
                     RETURNING t.id, old.prev)"""
    if kind == "issue":
        sql = upd + """
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value,
                                             to_value, note)
            SELECT CAST(:tid AS uuid), id, CAST(:uid AS uuid), :label, :action, prev, :to_value, :note FROM upd"""
        res = await db.execute(text(sql), {"tid": tid, "ids": ids, "action": action, "to_value": to_value,
                                           "note": note, **who, **(extra or {})})
        return res.rowcount
    res = await db.execute(text(upd + " SELECT COUNT(*) FROM upd"), {"tid": tid, "ids": ids, **(extra or {})})
    return int(res.scalar() or 0)


@router.post("/bulk", response_model=BulkOut)
async def bulk_action(body: BulkIn, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("assign"))):
    """Assign (unassigned items only), reassign, snooze (reason + expiry), unsnooze, set priority,
    acknowledge, wait on SAP / requester (pauses the SLA clock) and resume (restarts it)."""
    tid = await _rls(db, tenant)
    ids = [str(i) for i in dict.fromkeys(body.ids)]
    who = {"uid": current_user_id(request), "label": current_user_label()}
    kind, a = body.kind, body.action
    sla: dict[str, Any] = {}

    if a in ("assign", "reassign"):
        await _active_users(db, tid, [body.user_id])
        if body.team_id:
            await _team_exists(db, tid, body.team_id)
        team_id = str(body.team_id) if body.team_id else None

        def pick(s) -> list[tuple]:
            if body.user_id:
                return [(i, str(body.user_id), team_id, None) for i in ids]
            teams, active = triage.load_teams(s, tid), triage.active_users(s, tid)
            load = {u: int(n) for u, n in s.execute(text(triage._LOAD_SQL), {"tid": tid})}
            team, rows = teams[team_id], []
            for i in ids:
                uid = triage.choose(team, active, load)
                if uid is None:
                    break
                load[uid] = load.get(uid, 0) + 1
                rows.append((i, uid, team_id, None))
            s.execute(text("UPDATE triage_teams SET rr_cursor = :c WHERE id = CAST(:id AS uuid)"),
                      {"c": team.cursor, "id": team_id})
            return rows

        def run(s) -> int:
            rows = pick(s)
            if not rows:
                raise HTTPException(status_code=422, detail="The team has no active member or lead")
            n = triage.write_assignments(s, tid, kind, rows, label=who["label"], actor=who["uid"],
                                         note=body.note or f"{a} (bulk)", only_unassigned=a == "assign")
            sla.update(triage.apply_sla(s, tid, kind, ids))
            return n

        updated = await db.run_sync(run)
    elif a == "snooze":
        updated = await _bulk_update(db, tid, kind, ids, "snoozed_until = :until, snooze_reason = :reason", "true",
                                     "t.snoozed_until::text", "snooze", body.until.isoformat(), body.reason, who,
                                     {"until": body.until, "reason": body.reason.strip()})
    elif a == "unsnooze":
        updated = await _bulk_update(db, tid, kind, ids, "snoozed_until = NULL, snooze_reason = NULL",
                                     "t.snoozed_until IS NOT NULL", "t.snoozed_until::text", "unsnooze", None,
                                     body.note, who)
    elif a == "priority":
        updated = await _bulk_update(db, tid, kind, ids, "priority = :prio", "t.priority IS DISTINCT FROM :prio",
                                     "t.priority::text", "priority", str(body.priority), body.note, who,
                                     {"prio": body.priority})
    elif a == "acknowledge":
        updated = await _bulk_update(
            db, tid, kind, ids,
            "acknowledged_at = now(), status = CASE WHEN t.status = 'open' THEN 'in_progress' ELSE t.status END",
            "t.acknowledged_at IS NULL", "t.status", "acknowledge", None, body.note, who)
    elif a == "wait":
        updated = await _bulk_update(
            db, tid, kind, ids, "status = :waiting, acknowledged_at = COALESCE(t.acknowledged_at, now())",
            "t.status <> :waiting", "t.status", "status", body.waiting, body.note, who, {"waiting": body.waiting})
        sla = await db.run_sync(lambda s: triage.sync_pause(s, tid, kind, ids))
    else:  # resume
        updated = await _bulk_update(db, tid, kind, ids, "status = 'in_progress'",
                                     "t.status IN ('waiting_sap', 'waiting_requester')", "t.status", "status",
                                     "in_progress", body.note, who)
        sla = await db.run_sync(lambda s: triage.sync_pause(s, tid, kind, ids))
    await db.commit()
    return BulkOut(action=a, updated=updated, sla=sla)


# ── metrics ───────────────────────────────────────────────────────────────────


@router.get("/metrics", response_model=MetricsOut)
async def metrics(weeks: int = Query(8, ge=1, le=52), db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant), _r: str = Depends(require_permission("view"))):
    """Backlog by owner / team, SLA attainment, MTTA / MTTR (hours from SLA start), breaches, weekly trend."""
    tid = await _rls(db, tenant)
    p = {"tid": tid, "blocks": "{}", "since": datetime.now(UTC) - timedelta(weeks=weeks)}
    base = f"WITH q AS ({triage.ITEMS_SQL})"
    open_ = "q.status NOT IN ('resolved', 'accepted')"
    backlog = f"""COUNT(*) AS open, COUNT(*) FILTER (WHERE q.sla_state = 'breached') AS breached,
                  COUNT(*) FILTER (WHERE q.sla_state = 'at_risk') AS at_risk"""
    by_owner = (await db.execute(text(f"""{base}
        SELECT q.assigned_to::text AS user_id, u.email, {backlog} FROM q JOIN users u ON u.id = q.assigned_to
         WHERE {open_} GROUP BY 1, 2 ORDER BY open DESC"""), p)).fetchall()
    by_team = (await db.execute(text(f"""{base}
        SELECT q.assigned_team_id::text AS team_id, t.name, {backlog} FROM q
          JOIN triage_teams t ON t.id = q.assigned_team_id WHERE {open_} GROUP BY 1, 2 ORDER BY open DESC"""),
        p)).fetchall()
    s = (await db.execute(text(f"""{base}
        SELECT COUNT(*) FILTER (WHERE {open_} AND q.assigned_to IS NULL) AS unassigned,
               COUNT(*) FILTER (WHERE q.resolved_at >= :since AND q.due_at IS NOT NULL) AS resolved_total,
               COUNT(*) FILTER (WHERE q.resolved_at >= :since AND q.resolved_at <= q.due_at) AS resolved_in_sla,
               COUNT(*) FILTER (WHERE q.resolved_at >= :since AND q.resolved_at > q.due_at) AS resolved_late,
               COUNT(*) FILTER (WHERE {open_} AND q.sla_state = 'breached') AS breached_open,
               AVG(EXTRACT(EPOCH FROM q.acknowledged_at - q.sla_started_at) / 3600)
                   FILTER (WHERE q.acknowledged_at >= :since AND q.acknowledged_at >= q.sla_started_at) AS mtta,
               AVG(EXTRACT(EPOCH FROM q.resolved_at - q.sla_started_at) / 3600)
                   FILTER (WHERE q.resolved_at >= :since AND q.resolved_at >= q.sla_started_at) AS mttr
          FROM q"""), p)).fetchone()
    weekly = (await db.execute(text(f"""{base}
        SELECT w.week::date AS week,
               COUNT(*) FILTER (WHERE date_trunc('week', q.created_at) = w.week) AS opened,
               COUNT(*) FILTER (WHERE date_trunc('week', q.resolved_at) = w.week) AS resolved,
               COUNT(*) FILTER (WHERE date_trunc('week', q.resolved_at) = w.week AND q.resolved_at <= q.due_at)
                   AS resolved_in_sla,
               COUNT(*) FILTER (WHERE date_trunc('week', q.due_at) = w.week AND q.due_at < now()
                                AND (q.resolved_at IS NULL OR q.resolved_at > q.due_at)) AS breached
          FROM generate_series(date_trunc('week', CAST(:since AS timestamptz)), date_trunc('week', now()),
                               interval '1 week') AS w(week)
          LEFT JOIN q ON q.created_at >= w.week AND q.created_at < w.week + interval '1 week'
                      OR q.resolved_at >= w.week AND q.resolved_at < w.week + interval '1 week'
                      OR q.due_at >= w.week AND q.due_at < w.week + interval '1 week'
         GROUP BY w.week ORDER BY w.week"""), p)).fetchall()

    def rows(rs) -> list[dict[str, Any]]:
        return [dict(r._mapping) for r in rs]

    def hours(v) -> Optional[float]:
        return None if v is None else round(float(v), 2)

    return MetricsOut(
        weeks=weeks, backlog_by_owner=rows(by_owner), backlog_by_team=rows(by_team), unassigned=s.unassigned,
        resolved_in_sla=s.resolved_in_sla, resolved_total=s.resolved_total,
        sla_attainment_pct=round(100 * s.resolved_in_sla / s.resolved_total, 1) if s.resolved_total else None,
        mtta_hours=hours(s.mtta), mttr_hours=hours(s.mttr), breach_count=s.breached_open + s.resolved_late,
        weekly=[{**r, "week": r["week"].isoformat()} for r in rows(weekly)])
