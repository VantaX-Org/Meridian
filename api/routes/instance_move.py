"""Move to new instance: plan, pre-flight, load, reconcile and delta between two systems.

The work runs in workers/tasks/run_instance_move.py. These routes only store requests and read results.
Every run is a dry run unless the caller sends dry_run=false; a live start is checked here (migration target
flag, source differs from target) and audited before it is queued.
"""
from __future__ import annotations

import datetime
import json
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.licence import licensed_module
from api.services.branded_xlsx import ColumnSpec, csv_response
from api.services.migration import instance_move as im
from api.services.rbac import current_user_id, require_permission, scope_from_path, write_audit

router = APIRouter(prefix="/api/v1/migration/move", tags=["migration"], dependencies=[Depends(licensed_module())])
_SYSTEM_COLS = "id, name, system_type, host, client, sysnr, base_url, company_id, migration_target"


class PlanBody(BaseModel):
    source_system_id: uuid.UUID
    target_system_id: uuid.UUID
    modules: list[str] = Field(min_length=1)
    mode: Literal["cleansed", "as_is"] = "cleansed"
    id_map_upload_id: Optional[uuid.UUID] = None
    # A move always carries every record ever held; "full" is the only value and the default.
    history: Literal["full"] = "full"


class RunBody(BaseModel):
    dry_run: bool = True
    waves: Optional[list[int]] = None


class DeltaBody(BaseModel):
    since: datetime.datetime
    dry_run: bool = True


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text(f"SET app.tenant_id = '{tenant.id}'"))


async def _one(db: AsyncSession, sql: str, **p) -> dict:
    row = (await db.execute(text(sql), p)).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return dict(row)


async def _system(db: AsyncSession, sid) -> dict:
    row = (await db.execute(text(f"SELECT {_SYSTEM_COLS} FROM sap_systems WHERE id = :s"), {"s": str(sid)})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="System not found")
    return dict(row)


def _plan_out(row: dict) -> dict:
    plan = row.get("plan") or {}
    body = im.public_plan(plan) if plan.get("waves") else {"waves": [], "unplaced": plan.get("unplaced", [])}
    out = {"id": str(row["id"]), "source": str(row["source_system_id"]), "target": str(row["target_system_id"]),
           "modules": list(row["modules"]), "mode": row["mode"], "waves": body["waves"], "unplaced": body["unplaced"],
           "status": plan.get("status") or ("ready" if plan else "building")}
    for k in ("reason", "config"):
        if plan.get(k):
            out[k] = plan[k]
    pre = row.get("preflight") or {}
    if pre.get("cleansing"):
        out["cleansing"] = pre["cleansing"]
    if pre:
        out["preflight"] = {"status": pre.get("status"), "issues": pre.get("issues", [])}
    return out


@router.post("/plans", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def create_plan(body: PlanBody, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    src, tgt = await _system(db, body.source_system_id), await _system(db, body.target_system_id)
    if im.same_system(src, tgt):
        raise HTTPException(status_code=422, detail="Source and target are the same system.")
    pid = str(uuid.uuid4())
    await db.execute(text("""INSERT INTO move_plans (id, tenant_id, source_system_id, target_system_id, modules, mode,
                                                     id_map_upload_id, created_by)
                             VALUES (:id, :t, :s, :g, :m, :mode, :idm, :u)"""),
                     {"id": pid, "t": str(tenant.id), "s": str(body.source_system_id), "g": str(body.target_system_id),
                      "m": body.modules, "mode": body.mode,
                      "idm": str(body.id_map_upload_id) if body.id_map_upload_id else None,
                      "u": current_user_id(request)})
    await db.commit()
    await _queue_plan(db, tenant, body, pid)
    return _plan_out(await _one(db, "SELECT * FROM move_plans WHERE id = :i", i=pid))


async def _queue_plan(db: AsyncSession, tenant: Tenant, body: PlanBody, pid: str) -> None:
    """Build the plan from a full-history download of the source; download it first when none covers the objects."""
    from workers.tasks.run_instance_move import FULL_HISTORY_SQL, plan_move

    have = (await db.execute(text(FULL_HISTORY_SQL), {"sid": str(body.source_system_id),
                                                      "mods": json.dumps(body.modules)})).scalar()
    if have:
        plan_move.delay(str(tenant.id), pid)
        return
    from celery import chain
    from api.services import jobs
    from workers.tasks.run_extraction import run_extraction

    jobs.ensure_no_extraction(str(tenant.id), str(body.source_system_id))
    vid = str(uuid.uuid4())
    jobs.start_job(str(tenant.id), f"dl-{vid}", "extraction", ", ".join(body.modules), status="queued",
                   system_id=str(body.source_system_id), modules=body.modules, version_id=vid)
    chain(run_extraction.si(str(tenant.id), str(body.source_system_id), body.modules, True, "both", None, False,
                            "Full history for move", vid, history="full"),
          plan_move.si(str(tenant.id), pid)).delay()


@router.get("/plans", dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def list_plans(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> list[dict]:
    await _rls(db, tenant)
    rows = (await db.execute(text("SELECT * FROM move_plans ORDER BY created_at DESC LIMIT 200"))).mappings().all()
    return [_plan_out(dict(r)) for r in rows]


@router.get("/plans/{plan_id}", dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def get_plan(plan_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    return _plan_out(await _one(db, "SELECT * FROM move_plans WHERE id = :i", i=str(plan_id)))


@router.post("/plans/{plan_id}/preflight", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def preflight(plan_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """Queues the pre-flight and returns the issues of the last one (empty until it has run once)."""
    await _rls(db, tenant)
    row = await _one(db, "SELECT preflight FROM move_plans WHERE id = :i", i=str(plan_id))
    from workers.tasks.run_instance_move import preflight_move
    pre = row.get("preflight") or {}
    # Marked queued first so GET /plans/{id} can be polled until the worker writes completed or failed.
    await db.execute(text("UPDATE move_plans SET preflight = CAST(:p AS jsonb) WHERE id = :i"),
                     {"p": json.dumps({**pre, "status": "queued"}, default=str), "i": str(plan_id)})
    await db.commit()
    preflight_move.delay(str(tenant.id), str(plan_id))
    return {"issues": pre.get("issues", []), "status": "queued", "previous": pre.get("status"),
            "cleansing": pre.get("cleansing"), "config": pre.get("config")}


async def _start(db, request, tenant, plan_id, kind: str, dry_run: bool, waves=None, since=None, report=None) -> dict:
    plan = await _one(db, "SELECT * FROM move_plans WHERE id = :i", i=str(plan_id))
    src, tgt = await _system(db, plan["source_system_id"]), await _system(db, plan["target_system_id"])
    why = im.check_safety(src, tgt, dry_run)
    if why:
        raise HTTPException(status_code=409, detail=why)
    rid = str(uuid.uuid4())
    import json
    await db.execute(text("""INSERT INTO move_runs (id, tenant_id, plan_id, kind, dry_run, waves, since, report,
                                                    requested_by)
                             VALUES (:id, :t, :p, :k, :d, :w, :since, CAST(:rep AS jsonb), :u)"""),
                     {"id": rid, "t": str(tenant.id), "p": str(plan_id), "k": kind, "d": dry_run, "w": waves,
                      "since": since, "rep": json.dumps(report or {}), "u": current_user_id(request)})
    if not dry_run:
        await write_audit(db, tenant.id, request, f"instance_move_{kind}", "move_run", rid, None,
                          {"plan_id": str(plan_id), "source": str(plan["source_system_id"]),
                           "target": str(plan["target_system_id"]), "waves": waves, "since": str(since) if since else None})
    await db.commit()
    from workers.tasks.run_instance_move import run_move
    run_move.delay(str(tenant.id), rid)
    return {"id": rid, "status": "queued", "dry_run": dry_run, "kind": kind}


@router.post("/plans/{plan_id}/runs", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def start_run(plan_id: uuid.UUID, body: RunBody, request: Request, db: AsyncSession = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    return await _start(db, request, tenant, plan_id, "load", body.dry_run, body.waves)


@router.post("/plans/{plan_id}/delta", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def start_delta(plan_id: uuid.UUID, body: DeltaBody, request: Request, db: AsyncSession = Depends(get_db),
                      tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    return await _start(db, request, tenant, plan_id, "delta", body.dry_run, since=body.since)


def _run_out(row: dict) -> dict:
    rep = row.get("report") or {}
    return {"id": str(row["id"]), "plan_id": str(row["plan_id"]), "kind": row["kind"], "status": row["status"],
            "reason": row.get("reason"), "dry_run": row["dry_run"], "waves": rep.get("waves", []),
            "checkpoint": row.get("checkpoint"), "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"), "cleansing": row.get("cleansing")}


@router.get("/runs/{run_id}", dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def get_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    row = await _one(db, "SELECT * FROM move_runs WHERE id = :i", i=str(run_id))
    cp = (await db.execute(text("SELECT wave, entity, pass, batch, created_at FROM move_checkpoints WHERE run_id = :i "
                                "ORDER BY created_at DESC, id DESC LIMIT 1"), {"i": str(run_id)})).mappings().first()
    row["checkpoint"] = dict(cp) if cp else None
    out = _run_out(row)
    if row["status"] == "running" and not out["waves"]:
        counts = (await db.execute(text("""SELECT entity, count(*) AS sent, count(*) FILTER (WHERE status IN ('ok', 'validated',
            'exported')) AS ok, count(*) FILTER (WHERE status = 'failed') AS failed FROM move_record_status
            WHERE run_id = :i GROUP BY entity ORDER BY entity"""), {"i": str(run_id)})).mappings().all()
        out["progress"] = [{**dict(c), "error_rate": round(c["failed"] / c["sent"], 4) if c["sent"] else 0.0} for c in counts]
    return out


async def _run_for_write(db, run_id) -> dict:
    return await _one(db, "SELECT * FROM move_runs WHERE id = :i", i=str(run_id))


@router.post("/runs/{run_id}/stop", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def stop_run(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    """The loader checks for 'stopping' before each batch and ends after the batch in flight."""
    await _rls(db, tenant)
    await _run_for_write(db, run_id)
    await db.execute(text("UPDATE move_runs SET status = CASE WHEN status = 'queued' THEN 'stopped' ELSE 'stopping' END "
                          "WHERE id = :i AND status IN ('queued', 'running')"), {"i": str(run_id)})
    await db.commit()
    return {"id": str(run_id), "status": (await _run_for_write(db, run_id))["status"]}


@router.post("/runs/{run_id}/resume", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def resume_run(run_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant)) -> dict:
    """Re-queues a stopped or failed run; batches with a checkpoint are skipped."""
    await _rls(db, tenant)
    run = await _run_for_write(db, run_id)
    if run["status"] not in ("stopped", "failed"):
        raise HTTPException(status_code=409, detail=f"Only a stopped or failed run can resume; this one is {run['status']}.")
    plan = await _one(db, "SELECT * FROM move_plans WHERE id = :i", i=str(run["plan_id"]))
    why = im.check_safety(await _system(db, plan["source_system_id"]), await _system(db, plan["target_system_id"]),
                          run["dry_run"])
    if why:
        raise HTTPException(status_code=409, detail=why)
    await db.execute(text("UPDATE move_runs SET status = 'stopped', reason = NULL, finished_at = NULL WHERE id = :i"),
                     {"i": str(run_id)})
    if not run["dry_run"]:
        await write_audit(db, tenant.id, request, "instance_move_resume", "move_run", str(run_id), None,
                          {"plan_id": str(run["plan_id"])})
    await db.commit()
    from workers.tasks.run_instance_move import run_move
    run_move.delay(str(tenant.id), str(run_id))
    return {"id": str(run_id), "status": "queued"}


@router.post("/runs/{run_id}/retry-failed", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def retry_failed(run_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant)) -> dict:
    """A new run (kind retry) that sends only the records that failed in this one."""
    await _rls(db, tenant)
    run = await _run_for_write(db, run_id)
    n = (await db.execute(text("SELECT count(*) FROM move_record_status WHERE run_id = :i AND status = 'failed'"),
                          {"i": str(run_id)})).scalar() or 0
    if not n:
        raise HTTPException(status_code=409, detail="This run has no failed records.")
    out = await _start(db, request, tenant, run["plan_id"], "retry", run["dry_run"], run.get("waves"),
                       report={"retry_of": str(run_id)})
    return {**out, "records": n}


class RunErrorsOut(BaseModel):
    errors: list[dict]
    total: int


class CleansingLogOut(BaseModel):
    log: list[dict]
    unfixable: list = []


_ERROR_COLS = [ColumnSpec("entity", "Entity"), ColumnSpec("pass", "Pass", "int"), ColumnSpec("record_key", "Record"),
               ColumnSpec("http_code", "HTTP code", "int"), ColumnSpec("message", "Message")]


@router.get("/runs/{run_id}/errors", response_model=RunErrorsOut, dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def run_errors(run_id: uuid.UUID, entity: Optional[str] = None, format: Literal["json", "csv"] = "json",
                     db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    await _run_for_write(db, run_id)
    rows = [dict(r) for r in (await db.execute(text(
        "SELECT entity, pass, record_key, http_code, message FROM move_record_status WHERE run_id = :i "
        "AND status = 'failed' AND (CAST(:e AS text) IS NULL OR entity = :e) ORDER BY entity, pass, record_key"),
        {"i": str(run_id), "e": entity})).mappings().all()]
    if format == "csv":
        return csv_response(rows, _ERROR_COLS, "move-errors", str(run_id)[:8])
    return {"errors": rows, "total": len(rows)}


_LOG_COLS = [ColumnSpec("record_key", "Record"), ColumnSpec("field", "Field"), ColumnSpec("old_value", "Old value"),
             ColumnSpec("new_value", "New value"), ColumnSpec("rule_id", "Rule"), ColumnSpec("source", "Source")]


@router.get("/runs/{run_id}/cleansing-log", response_model=CleansingLogOut, dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def cleansing_log(run_id: uuid.UUID, format: Literal["json", "csv"] = "csv",
                        db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    run = await _run_for_write(db, run_id)
    rows = [dict(r) for r in (await db.execute(text(
        "SELECT record_key, field, old_value, new_value, rule_id, source FROM move_cleansing_log WHERE run_id = :i "
        "ORDER BY id"), {"i": str(run_id)})).mappings().all()]
    if format == "csv":
        return csv_response(rows, _LOG_COLS, "move-cleansing-log", str(run_id)[:8])
    return {"log": rows, "unfixable": (run.get("cleansing") or {}).get("unfixable", [])}


@router.post("/plans/{plan_id}/reconcile", dependencies=[Depends(require_permission("trigger_sync", scope=scope_from_path))])
async def reconcile(plan_id: uuid.UUID, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    await _one(db, "SELECT id FROM move_plans WHERE id = :i", i=str(plan_id))
    rid = str(uuid.uuid4())
    await db.execute(text("INSERT INTO move_reconciliations (id, tenant_id, plan_id) VALUES (:id, :t, :p)"),
                     {"id": rid, "t": str(tenant.id), "p": str(plan_id)})
    await db.commit()
    from workers.tasks.run_instance_move import reconcile_move
    reconcile_move.delay(str(tenant.id), rid)
    return {"id": rid}


@router.get("/reconciliations/{recon_id}", dependencies=[Depends(require_permission("view", scope=scope_from_path))])
async def get_reconciliation(recon_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                             tenant: Tenant = Depends(get_tenant)) -> dict:
    await _rls(db, tenant)
    row = await _one(db, "SELECT * FROM move_reconciliations WHERE id = :i", i=str(recon_id))
    res = row.get("result") or {}
    return {"id": str(row["id"]), "plan_id": str(row["plan_id"]), "status": row["status"],
            "entities": res.get("entities", []), "dqs": res.get("dqs"), "reason": res.get("reason")}
