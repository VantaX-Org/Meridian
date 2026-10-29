"""Undo for work decisions: record what a decision changed, put it back within ten minutes.

Every mutating decision route (work decide, group accept-all and set-value, remediation approve and send-back)
snapshots the rows it is about to change into a ``Recorder`` and saves one ``undo_actions`` row (migration 100):
``payload`` says what was done, ``inverse`` holds the previous state of every row that was changed. POST
/api/v1/actions/undo (api/routes/actions.py) calls ``apply_inverse``, which restores:

  issues   record_issues status, resolution, steward verdict, assignee, acknowledgement (what decide, accept-all,
           set-value and assign touch)
  items    remediation_items of a draft fix batch: rows the decision created are deleted, rows it replaced or
           removed are put back as they were
  batch    remediation_batches status, approval and filter (approve, send-back)

The clock is ``now()`` below so a test can freeze it; the window is ``WINDOW``. Nothing here commits: the route
that calls it commits once, so the decision and its undo row land together.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant
from api.services import attention, work_analytics, worklist
from api.services.rbac import current_user_id, current_user_label

WINDOW = timedelta(minutes=10)
WINDOW_SENTENCE = "This can no longer be undone: undo is open for 10 minutes after a change, and that time has passed."

_ISSUE_COLS = ("status", "resolution", "resolved_at", "steward_verdict", "assigned_to", "assigned_at", "acknowledged_at")
_ISSUE_SELECT = ("SELECT id::text AS id, status, resolution, resolved_at, steward_verdict, assigned_to::text AS assigned_to, "
                 "assigned_at, acknowledged_at FROM record_issues WHERE tenant_id = CAST(:t AS uuid) "
                 "AND id = ANY(CAST(:ids AS uuid[]))")


def now() -> datetime:
    """The clock the window is measured on (a test replaces it)."""
    return datetime.now(timezone.utc)


def owner_key(request: Optional[Request]) -> str:
    """Who made a change: the user id, or 'local' when auth is off (the key saved_views uses)."""
    return current_user_id(request) or "local"


def _json(row: dict) -> dict:
    return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in row.items()}


Key = tuple[str, str, str]  # (batch id, check id, record key)


class Recorder:
    """Collects the state a decision is about to change. Create one per request, pass it to the code that writes,
    then ``await save(...)``. The first snapshot of a row wins, so several decisions on one record invert to the
    state before the first."""

    def __init__(self) -> None:
        self.issues: dict[str, dict] = {}
        self.items_before: dict[Key, dict] = {}
        self.written: set[Key] = set()
        self.removed: set[Key] = set()
        self.touched: list[tuple[str, str]] = []
        self.scope: Optional[str] = None
        self.batch: Optional[dict] = None

    # snapshots ---------------------------------------------------------------------------------------------

    async def issue_rows(self, db: AsyncSession, tenant: Tenant, ids: list[str]) -> None:
        new = [i for i in dict.fromkeys(ids) if i and i not in self.issues]
        if not new:
            return
        for r in (await db.execute(text(_ISSUE_SELECT), {"t": str(tenant.id), "ids": new})).mappings().all():
            self.issues[r["id"]] = _json(dict(r))

    async def item_rows(self, db: AsyncSession, tenant: Tenant, scope: str, module: str, record_key: str,
                        check_id: Optional[str] = None) -> None:
        """Fix-batch items of a record in draft batches (the only ones a decision can change)."""
        rows = (await db.execute(text("""
            SELECT i.batch_id::text AS batch_id, i.issue_id::text AS issue_id, i.scope, i.module, i.check_id, i.record_key,
                   i.grain, i.field, i.current_value, i.proposed_value, i.proposal_source, i.confidence, i.accepted,
                   i.recon_status, i.recon_version::text AS recon_version
              FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
             WHERE i.tenant_id = CAST(:t AS uuid) AND i.scope = :scope AND i.module = :m AND i.record_key = :k
               AND b.status = 'draft' AND (CAST(:c AS text) IS NULL OR i.check_id = :c)"""),
            {"t": str(tenant.id), "scope": scope, "m": module, "k": record_key, "c": check_id})).mappings().all()
        for r in rows:
            self.items_before.setdefault((r["batch_id"], r["check_id"], r["record_key"]), _json(dict(r)))

    def wrote(self, batch: str, check_id: str, record_key: str) -> None:
        self.written.add((str(batch), check_id, record_key))
        self.touched.append((check_id, record_key))

    def deleted(self, batch: str, check_id: str, record_key: str) -> None:
        self.removed.add((str(batch), check_id, record_key))
        self.touched.append((check_id, record_key))

    def touch(self, check_id: str, record_key: str) -> None:
        self.touched.append((check_id, record_key))

    # saving ------------------------------------------------------------------------------------------------

    def inverse(self) -> dict:
        changed = self.written | self.removed
        return {
            "scope": self.scope,
            "issues": list(self.issues.values()),
            "items": {"restore": [self.items_before[k] for k in sorted(changed) if k in self.items_before],
                      "delete": [{"batch_id": b, "check_id": c, "record_key": k}
                                 for b, c, k in sorted(self.written) if (b, c, k) not in self.items_before]},
            "batch": self.batch,
            "touched": [list(t) for t in dict.fromkeys(self.touched)],
        }

    def empty(self) -> bool:
        return not (self.issues or self.written or self.removed or self.batch)

    async def save(self, db: AsyncSession, tenant: Tenant, request: Request, kind: str, payload: dict) -> Optional[str]:
        """Write the undo row and return its id; None when the decision changed nothing there is to put back."""
        if self.empty():
            return None
        aid = str(uuid.uuid4())
        await db.execute(text("""
            INSERT INTO undo_actions (id, tenant_id, user_id, kind, payload, inverse, created_at)
            VALUES (CAST(:id AS uuid), CAST(:t AS uuid), :u, :kind, CAST(:p AS jsonb), CAST(:i AS jsonb), :at)"""),
            {"id": aid, "t": str(tenant.id), "u": owner_key(request), "kind": kind,
             "p": json.dumps(payload, default=str), "i": json.dumps(self.inverse(), default=str), "at": now()})
        return aid


# applying --------------------------------------------------------------------------------------------------


async def _event(db: AsyncSession, tenant: Tenant, request: Request, issue_id: str, action: str, frm, to, note: str) -> None:
    await db.execute(text("""
        INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value, to_value, note)
        VALUES (CAST(:t AS uuid), CAST(:i AS uuid), CAST(:u AS uuid), :label, :a, :f, :to, :note)"""),
        {"t": str(tenant.id), "i": issue_id, "u": current_user_id(request), "label": current_user_label(),
         "a": action, "f": frm, "to": to, "note": note})


async def load(db: AsyncSession, tenant: Tenant, action_id: uuid.UUID) -> Optional[dict]:
    row = (await db.execute(text(
        "SELECT id::text AS id, user_id, kind, payload, inverse, created_at, undone_at FROM undo_actions "
        "WHERE id = :id AND tenant_id = CAST(:t AS uuid)"), {"id": str(action_id), "t": str(tenant.id)})).mappings().first()
    return dict(row) if row else None


def check_window(row: dict) -> None:
    """409 when the action was already undone or is older than the window."""
    if row["undone_at"] is not None:
        raise HTTPException(status_code=409, detail="This change has already been undone.")
    if now() - row["created_at"] > WINDOW:
        raise HTTPException(status_code=409, detail=WINDOW_SENTENCE)


async def apply_inverse(db: AsyncSession, tenant: Tenant, request: Request, row: dict) -> dict:
    """Restore the state the action recorded. 409 when a fix batch the action touched has moved on (approved or
    exported) since: the draft it wrote to is no longer the user's to change."""
    inv = row["inverse"] or {}
    t = str(tenant.id)
    items = inv.get("items") or {}
    restore, delete = items.get("restore") or [], items.get("delete") or []

    batches = sorted({i["batch_id"] for i in restore} | {i["batch_id"] for i in delete})
    if batches:
        not_draft = (await db.execute(text(
            "SELECT count(*) FROM remediation_batches WHERE tenant_id = CAST(:t AS uuid) "
            "AND id = ANY(CAST(:b AS uuid[])) AND status <> 'draft'"), {"t": t, "b": batches})).scalar()
        if not_draft:
            raise HTTPException(status_code=409, detail="The fix batch this change went into has since been approved, "
                                                        "so it can no longer be undone here.")
    batch = inv.get("batch")
    if batch:
        cur = (await db.execute(text("SELECT status FROM remediation_batches WHERE id = CAST(:b AS uuid) "
                                     "AND tenant_id = CAST(:t AS uuid)"), {"b": batch["id"], "t": t})).scalar()
        if cur != batch["after_status"]:
            raise HTTPException(status_code=409, detail=f"The batch is now {cur}, so this change can no longer be undone.")

    done = {"issues": 0, "items_restored": 0, "items_removed": 0, "batch": False}

    if delete:
        res = await db.execute(text("""
            DELETE FROM remediation_items i USING jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(batch_id uuid, check_id text, record_key text)
             WHERE i.tenant_id = CAST(:t AS uuid) AND i.batch_id = x.batch_id AND i.check_id = x.check_id
               AND i.record_key = x.record_key"""), {"t": t, "rows": json.dumps(delete)})
        done["items_removed"] = res.rowcount
    if restore:
        res = await db.execute(text("""
            INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key, grain, field,
                                           current_value, proposed_value, proposal_source, confidence, accepted,
                                           recon_status, recon_version)
            SELECT CAST(:t AS uuid), x.batch_id, x.issue_id, x.scope, x.module, x.check_id, x.record_key, x.grain, x.field,
                   x.current_value, x.proposed_value, x.proposal_source, x.confidence, x.accepted, x.recon_status, x.recon_version
              FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(batch_id uuid, issue_id uuid, scope text, module text,
                   check_id text, record_key text, grain text, field text, current_value text, proposed_value text,
                   proposal_source text, confidence text, accepted boolean, recon_status text, recon_version uuid)
            ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
               SET issue_id = EXCLUDED.issue_id, grain = EXCLUDED.grain, field = EXCLUDED.field,
                   current_value = EXCLUDED.current_value, proposed_value = EXCLUDED.proposed_value,
                   proposal_source = EXCLUDED.proposal_source, confidence = EXCLUDED.confidence,
                   accepted = EXCLUDED.accepted, recon_status = EXCLUDED.recon_status,
                   recon_version = EXCLUDED.recon_version, updated_at = now()"""),
            {"t": t, "rows": json.dumps(restore)})
        done["items_restored"] = res.rowcount

    issues = inv.get("issues") or []
    if issues:
        ids = [i["id"] for i in issues]
        now_rows = {r["id"]: r for r in (await db.execute(text(_ISSUE_SELECT), {"t": t, "ids": ids})).mappings().all()}
        await db.execute(text("""
            UPDATE record_issues ri SET status = x.status, resolution = x.resolution, resolved_at = x.resolved_at,
                   steward_verdict = x.steward_verdict, assigned_to = x.assigned_to, assigned_at = x.assigned_at,
                   acknowledged_at = x.acknowledged_at, updated_at = now()
              FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(id uuid, status text, resolution text, resolved_at timestamptz,
                   steward_verdict text, assigned_to uuid, assigned_at timestamptz, acknowledged_at timestamptz)
             WHERE ri.id = x.id AND ri.tenant_id = CAST(:t AS uuid)"""), {"t": t, "rows": json.dumps(issues)})
        for i in issues:
            cur = now_rows.get(i["id"])
            if cur is None:
                continue
            if cur["status"] != i["status"]:
                await _event(db, tenant, request, i["id"], "status", cur["status"], i["status"], "Decision undone")
            if cur["assigned_to"] != i["assigned_to"]:
                await _event(db, tenant, request, i["id"], "assign", cur["assigned_to"], i["assigned_to"], "Decision undone")
        done["issues"] = len(issues)

    if batch:
        await db.execute(text("""
            UPDATE remediation_batches SET status = :status, approved_by = CAST(:ab AS uuid), approved_by_label = :abl,
                   approved_at = CAST(:aa AS timestamptz), filter = CAST(:f AS jsonb)
             WHERE id = CAST(:b AS uuid) AND tenant_id = CAST(:t AS uuid)"""),
            {"status": batch["status"], "ab": batch["approved_by"], "abl": batch["approved_by_label"],
             "aa": datetime.fromisoformat(batch["approved_at"]) if batch["approved_at"] else None,
             "f": json.dumps(batch["filter"]), "b": batch["id"], "t": t})
        await db.execute(text("""
            INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, action, from_value, to_value)
            VALUES (CAST(:t AS uuid), CAST(:b AS uuid), NULL, CAST(:u AS uuid), :label, 'undone', :frm, :to)"""),
            {"t": t, "b": batch["id"], "u": current_user_id(request), "label": current_user_label(),
             "frm": batch["after_status"], "to": batch["status"]})
        done["batch"] = True

    scope, touched = inv.get("scope"), [tuple(x) for x in inv.get("touched") or []]
    if scope and touched:
        await db.run_sync(lambda s: worklist.refresh(s, t, scope, touched))
    if issues and not (scope and touched):  # a change over several systems (a batch reassigned): recompute from the issues
        await db.run_sync(lambda s: worklist.refresh_issues(s, t, [i["id"] for i in issues]))
    if batch:
        await db.run_sync(lambda s: worklist.refresh_batch(s, t, batch["id"]))
    await db.execute(text("UPDATE undo_actions SET undone_at = :at WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:t AS uuid)"),
                     {"at": now(), "id": row["id"], "t": t})
    return done


def after_commit(tenant: Tenant) -> None:
    """Caches a decision (or its undo) makes stale."""
    work_analytics.forget(tenant.id)
    attention.invalidate(tenant.id)


async def batch_snapshot(db: AsyncSession, tenant: Tenant, batch_id: Any, after_status: str) -> dict:
    """The batch row as it is before an approve or send-back, with the status that change leaves it in."""
    r = (await db.execute(text(
        "SELECT id::text AS id, status, approved_by::text AS approved_by, approved_by_label, approved_at, filter "
        "FROM remediation_batches WHERE id = CAST(:b AS uuid) AND tenant_id = CAST(:t AS uuid)"),
        {"b": str(batch_id), "t": str(tenant.id)})).mappings().one()
    return _json({**dict(r), "after_status": after_status})
