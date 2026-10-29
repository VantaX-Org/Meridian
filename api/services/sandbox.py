"""Sandbox tenant mode (migration 115): try decisions on a copy, and let nothing leave the deployment meanwhile.

POST /admin/sandbox/enter sets ``tenants.sandbox`` and, by default, copies the tenant's latest finished run into a
sandbox run: a new analysis_versions row (``metadata.sandbox = true``, ``metadata.sandbox_of`` = the source run, no
storage keys) with the source run's findings, failing records, work groups, work records, feature impact and the
record issues of its failing records. The copy's work rows carry the scope ``sandbox:<source scope>``
(api/services/record_issues.scope_of), so record issues, fix batch items and work refreshes of a decision taken on the
sandbox run never touch the real rows. Being the newest run, the sandbox run is what every screen reads while the
tenant is in sandbox. A decision on a run that is not a sandbox run is refused while the flag is on (``guard_scope``).

While the flag is on every sender checks it (``is_sandbox``) and, instead of sending, records the delivery it held
back in skipped_deliveries with the reason ``sandbox`` (``skip``): alert and per-user emails, Slack and Teams posts,
webhooks, digests, report mailouts and SAP write-backs.

POST /admin/sandbox/exit clears the flag and discards every sandbox run with everything keyed to it, and the record
issues, fix batch items and events of the sandbox scopes. Both are audited.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from sqlalchemy import text

SANDBOX_PREFIX = "sandbox:"
REASON = "sandbox"
_STORAGE_KEYS = ("dataset_path", "upload_path", "findings_archive", "worklist_built_at")


def is_sandbox_scope(scope: Optional[str]) -> bool:
    return bool(scope) and str(scope).startswith(SANDBOX_PREFIX)


# ── the flag ──────────────────────────────────────────────────────────────────────────────────────────────────

_FLAG_SQL = "SELECT sandbox FROM tenants WHERE id = CAST(:t AS uuid)"


def is_sandbox_sync(session, tenant_id: Any) -> bool:
    return bool(session.execute(text(_FLAG_SQL), {"t": str(tenant_id)}).scalar())


async def is_sandbox(db, tenant_id: Any) -> bool:
    return bool((await db.execute(text(_FLAG_SQL), {"t": str(tenant_id)})).scalar())


_SKIP_SQL = ("INSERT INTO skipped_deliveries (tenant_id, channel, kind, ref, reason) "
             "VALUES (CAST(:t AS uuid), :c, :k, :r, :why)")


def skip_sync(session, tenant_id: Any, channel: str, kind: str, ref: Optional[str] = None, reason: str = REASON) -> None:
    """Record a delivery held back (the caller commits). ``ref`` is an id, never an address or a body."""
    session.execute(text(_SKIP_SQL), {"t": str(tenant_id), "c": channel, "k": kind, "r": ref, "why": reason})


async def skip(db, tenant_id: Any, channel: str, kind: str, ref: Optional[str] = None, reason: str = REASON) -> None:
    await db.execute(text(_SKIP_SQL), {"t": str(tenant_id), "c": channel, "k": kind, "r": ref, "why": reason})


def held_back_sync(session, tenant_id: Any, channel: str, kind: str, ref: Optional[str] = None) -> bool:
    """True (and the skip recorded) when the tenant is in sandbox: the caller must not send."""
    if not is_sandbox_sync(session, tenant_id):
        return False
    skip_sync(session, tenant_id, channel, kind, ref)
    return True


async def held_back(db, tenant_id: Any, channel: str, kind: str, ref: Optional[str] = None) -> bool:
    if not await is_sandbox(db, tenant_id):
        return False
    await skip(db, tenant_id, channel, kind, ref)
    return True


async def guard_scope(db, tenant_id: Any, scope: str) -> None:
    """While the tenant is in sandbox, a decision may only land on sandbox rows."""
    from fastapi import HTTPException

    if not is_sandbox_scope(scope) and await is_sandbox(db, tenant_id):
        raise HTTPException(status_code=409, detail="Sandbox mode is on: decisions apply to the sandbox run only. "
                                                    "Exit the sandbox to work on the real run.")


async def status(db, tenant_id: Any) -> dict:
    row = (await db.execute(text("SELECT sandbox, sandbox_since, sandbox_by FROM tenants WHERE id = CAST(:t AS uuid)"),
                            {"t": str(tenant_id)})).fetchone()
    runs = (await db.execute(text(
        "SELECT id::text FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) AND metadata->>'sandbox' = 'true' "
        "ORDER BY run_at DESC"), {"t": str(tenant_id)})).scalars().all()
    skipped = (await db.execute(text("SELECT count(*) FROM skipped_deliveries WHERE tenant_id = CAST(:t AS uuid) "
                                     "AND reason = 'sandbox' AND created_at >= COALESCE(CAST(:since AS timestamptz), "
                                     "'-infinity')"),
                                {"t": str(tenant_id), "since": row[1] if row else None})).scalar() or 0
    return {"sandbox": bool(row and row[0]), "since": row[1] if row else None, "by": row[2] if row else None,
            "runs": list(runs), "skipped_deliveries": int(skipped)}


# ── copying a run (sync; app.tenant_id set; the caller commits) ───────────────────────────────────────────────────

def _columns(session, table: str) -> list[str]:
    return [r[0] for r in session.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :t "
        "ORDER BY ordinal_position"), {"t": table}).fetchall()]


def _copy(session, table: str, where: str, p: dict, overrides: dict[str, str]) -> int:
    """INSERT INTO table SELECT ... FROM table WHERE ``where``, with ``overrides`` (column -> SQL expression)."""
    cols = _columns(session, table)
    exprs = [overrides.get(c, c) for c in cols]
    return session.execute(text(f"INSERT INTO {table} ({', '.join(cols)}) SELECT {', '.join(exprs)} FROM {table} "
                                f"WHERE {where}"), p).rowcount or 0


def copy_run(session, tenant_id: str, source: str) -> tuple[str, dict[str, int]]:
    """Copy run ``source`` into a new sandbox run. Returns (sandbox run id, rows copied per table)."""
    from api.services.record_issues import scope_of

    tid = str(tenant_id)
    row = session.execute(text("SELECT label, metadata, status FROM analysis_versions WHERE id = CAST(:v AS uuid) "
                               "AND tenant_id = CAST(:t AS uuid)"), {"v": source, "t": tid}).fetchone()
    if row is None:
        raise LookupError(source)
    meta = dict(row[1] or {})
    src_scope = scope_of(meta)
    sb_scope = SANDBOX_PREFIX + src_scope
    new_meta = {k: v for k, v in meta.items() if k not in _STORAGE_KEYS}
    new_meta.update(sandbox=True, sandbox_of=source)
    vid = str(uuid.uuid4())
    p = {"t": tid, "src": source, "v": vid, "scope": src_scope, "sb": sb_scope}
    _copy(session, "analysis_versions", "id = CAST(:src AS uuid) AND tenant_id = CAST(:t AS uuid)",
          {**p, "meta": json.dumps(new_meta), "label": f"Sandbox of {row[0] or 'the latest run'}"},
          {"id": "CAST(:v AS uuid)", "run_at": "now()", "metadata": "CAST(:meta AS jsonb)", "label": ":label",
           "parent_version_id": "CAST(:src AS uuid)", "run_number": "NULL"})
    counts: dict[str, int] = {}
    same_run = "version_id = CAST(:src AS uuid) AND tenant_id = CAST(:t AS uuid)"
    counts["findings"] = _copy(session, "findings", same_run, p, {"id": "gen_random_uuid()", "version_id": "CAST(:v AS uuid)"})
    counts["finding_records"] = _copy(session, "finding_records", same_run, p, {"version_id": "CAST(:v AS uuid)"})
    counts["work_groups"] = _copy(session, "work_groups", same_run, p, {"version_id": "CAST(:v AS uuid)"})
    counts["config_impact_results"] = _copy(session, "config_impact_results", same_run, p,
                                            {"id": "gen_random_uuid()", "version_id": "CAST(:v AS uuid)"})
    counts["record_issues"] = _copy(
        session, "record_issues",
        "tenant_id = CAST(:t AS uuid) AND scope = :scope AND (check_id, record_key) IN "
        "(SELECT check_id, record_key FROM finding_records WHERE version_id = CAST(:src AS uuid) "
        "AND tenant_id = CAST(:t AS uuid))", p,
        {"id": "gen_random_uuid()", "scope": ":sb", "first_seen_version": "CAST(:v AS uuid)",
         "last_seen_version": "CAST(:v AS uuid)", "resolved_version": "NULL"})
    counts["work_records"] = _copy(session, "work_records", same_run, p,
                                   {"version_id": "CAST(:v AS uuid)", "scope": ":sb"})
    if "worklist_built_at" in meta:  # the copy's work list is complete only once its rows are in
        session.execute(text("UPDATE analysis_versions SET metadata = metadata || jsonb_build_object("
                             "'worklist_built_at', CAST(:at AS text)) WHERE id = CAST(:v AS uuid)"),
                        {"v": vid, "at": str(meta["worklist_built_at"])})
    return vid, counts


def sandbox_runs(session, tenant_id: str) -> list[str]:
    return [r[0] for r in session.execute(text(
        "SELECT id::text FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) AND metadata->>'sandbox' = 'true'"),
        {"t": str(tenant_id)}).fetchall()]


def discard(session, tenant_id: str, since: Any = None) -> dict[str, int]:
    """Delete every sandbox run with everything keyed to it, the rows of the sandbox scopes, and the draft fix
    batches opened since the sandbox was entered (``since``) that are left empty. No storage is touched: a sandbox run
    has none."""
    from api.services.purge import DELETE_ORDER, UNLINK

    tid = str(tenant_id)
    out: dict[str, int] = {}

    def add(k: str, n: int) -> None:
        if n:
            out[k] = out.get(k, 0) + n

    scope_rows = {"t": tid, "pfx": SANDBOX_PREFIX + "%"}
    add("remediation_items", session.execute(text(
        "DELETE FROM remediation_items WHERE tenant_id = CAST(:t AS uuid) AND scope LIKE :pfx"), scope_rows).rowcount or 0)
    if since is not None:
        add("remediation_batches", session.execute(text(
            "DELETE FROM remediation_batches b WHERE b.tenant_id = CAST(:t AS uuid) AND b.status = 'draft' "
            "AND b.created_at >= :since AND NOT EXISTS (SELECT 1 FROM remediation_items i WHERE i.batch_id = b.id)"),
            {**scope_rows, "since": since}).rowcount or 0)
    add("record_issues", session.execute(text(
        "DELETE FROM record_issues WHERE tenant_id = CAST(:t AS uuid) AND scope LIKE :pfx"), scope_rows).rowcount or 0)
    for vid in sandbox_runs(session, tid):
        p = {"t": tid, "v": vid}
        for table, set_clause, where in UNLINK:
            if table == "record_issues":
                continue  # the sandbox scope's issues are gone above; real issues never point at a sandbox run
            add(f"{table} (unlinked)", session.execute(text(f"UPDATE {table} SET {set_clause} WHERE {where}"), p).rowcount or 0)
        for table, where in DELETE_ORDER:
            if table == "record_issues":
                continue
            add(table, session.execute(text(f"DELETE FROM {table} WHERE {where}"), p).rowcount or 0)
        add("analysis_versions", session.execute(text(
            "DELETE FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)"), p).rowcount or 0)
    return out
