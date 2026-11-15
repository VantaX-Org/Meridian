"""Automation chain: what runs on its own, when, how it last went and when it runs next.

  GET /api/v1/automation/chain

Three parts:

  tasks      every Celery beat entry (workers/scheduler.py), its cron, its stage of the chain and its next run (UTC)
  stages     the chain extract, checks, agents, report, monitoring, each with the tenant's latest result and counts
  schedules  the tenant's run schedules (sync_profiles), the same rows GET /api/v1/schedules lists

Beat entries are platform-wide; the stage results and the schedules are the calling tenant's only (RLS plus an explicit
tenant_id filter on every query). Read-only, view permission.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from croniter import croniter  # type: ignore[import-untyped]
from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services import run_schedules
from api.services.rbac import require_permission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/automation", tags=["automation"])

STAGES = ("extract", "checks", "agents", "report", "monitoring")

# Celery task name -> stage of the chain. Anything not listed is platform housekeeping.
STAGE_OF: dict[str, str] = {
    "workers.scheduler.sync_profile_scheduler": "extract",
    "workers.tasks.process_schedules.run_due_process_schedules": "extract",
    "workers.scheduler.daily_analysis": "checks",
    "workers.scheduler.weekly_cleaning_batch": "checks",
    "workers.scheduler.contract_freshness": "checks",
    "workers.tasks.mining.orchestrator.nightly_mining_all_tenants": "checks",
    "workers.tasks.fix_mining.mine_rules_from_fixes": "checks",
    "workers.tasks.populate_stewardship_queue.populate_queue": "agents",
    "workers.tasks.ai_triage.triage_queue_items": "agents",
    "workers.tasks.triage_sla.sla_sweep": "agents",
    "workers.tasks.workflows.sla_sweep": "agents",
    "workers.scheduler.escalate_exceptions": "agents",
    "workers.tasks.ai_health_narrative.generate_health_narrative": "agents",
    "workers.scheduler.monthly_report": "report",
    "workers.scheduler.daily_digest": "report",
    "workers.tasks.send_owner_digests.send_owner_digests": "report",
    "workers.tasks.send_notifications.send_alert_digest": "report",
    "workers.tasks.send_report_pack.send_report_pack": "report",
    "workers.tasks.report_schedules.run_due_report_schedules": "report",
    "workers.tasks.digests.send_due_digests": "report",
    "workers.tasks.learned_monitor_interim.check_interim": "monitoring",
    "workers.tasks.snapshot_mdm_metrics.snapshot_mdm_metrics": "monitoring",
    "workers.tasks.health_samples.sample_health": "monitoring",
    "workers.tasks.run_health_check.check_all_systems": "monitoring",
    "workers.tasks.webhooks.deliver_due_webhooks": "monitoring",
}


def cron_of(schedule: Any) -> str | None:
    """The five-field cron of a celery crontab; None for an interval or anything else."""
    parts = [getattr(schedule, f"_orig_{f}", None) for f in ("minute", "hour", "day_of_month", "month_of_year", "day_of_week")]
    if any(p is None for p in parts):
        return None
    return " ".join(str(p) for p in parts)


def describe(beat_schedule: dict[str, dict], now: datetime) -> list[dict]:
    """Beat entries as rows, soonest next run first. Pure: no I/O."""
    rows = []
    for key, entry in beat_schedule.items():
        task = str(entry.get("task", ""))
        cron = cron_of(entry.get("schedule"))
        next_run = None
        if cron:
            try:
                next_run = croniter(cron, now).get_next(datetime).isoformat()
            except (ValueError, KeyError):
                cron = None
        rows.append({"key": key, "task": task, "stage": STAGE_OF.get(task, "platform"), "cron": cron, "next_run_at": next_run})
    rows.sort(key=lambda r: (r["next_run_at"] is None, r["next_run_at"] or "", r["key"]))
    return rows


def _beat() -> dict[str, dict]:
    try:
        from workers.scheduler import celery_app  # lazy: pulls the worker modules in
        return dict(celery_app.conf.beat_schedule or {})
    except Exception:  # noqa: BLE001 — the screen still shows the tenant's results without the worker package
        logger.warning("automation chain: beat schedule unavailable", exc_info=True)
        return {}


def _iso(v: Any) -> str | None:
    return v.isoformat() if hasattr(v, "isoformat") else (str(v) if v is not None else None)


async def _one(db: AsyncSession, sql: str, tid: str) -> dict:
    row = (await db.execute(text(sql), {"t": tid})).mappings().first()
    return {k: _iso(v) if isinstance(v, datetime) else v for k, v in (row or {}).items()}


async def stage_results(db: AsyncSession, tid: str) -> dict[str, dict]:
    """Latest result and 7-day counts per stage, for one tenant."""
    extract = await _one(db, """
        SELECT (SELECT started_at FROM sync_runs WHERE tenant_id = :t ORDER BY started_at DESC LIMIT 1) AS last_at,
               (SELECT status FROM sync_runs WHERE tenant_id = :t ORDER BY started_at DESC LIMIT 1) AS last_status,
               (SELECT rows_extracted FROM sync_runs WHERE tenant_id = :t ORDER BY started_at DESC LIMIT 1) AS rows,
               COUNT(*) FILTER (WHERE started_at > now() - interval '7 days') AS runs_7d,
               COUNT(*) FILTER (WHERE started_at > now() - interval '7 days' AND status = 'failed') AS failed_7d
          FROM sync_runs WHERE tenant_id = :t""", tid)
    checks = await _one(db, """
        SELECT (SELECT run_at FROM analysis_versions WHERE tenant_id = :t ORDER BY run_at DESC LIMIT 1) AS last_at,
               (SELECT status FROM analysis_versions WHERE tenant_id = :t ORDER BY run_at DESC LIMIT 1) AS last_status,
               (SELECT id::text FROM analysis_versions WHERE tenant_id = :t ORDER BY run_at DESC LIMIT 1) AS version_id,
               COUNT(*) FILTER (WHERE run_at > now() - interval '7 days') AS runs_7d,
               COUNT(*) FILTER (WHERE run_at > now() - interval '7 days' AND status = 'failed') AS failed_7d
          FROM analysis_versions WHERE tenant_id = :t""", tid)
    agents = await _one(db, """
        SELECT (SELECT run_at FROM analysis_versions WHERE tenant_id = :t AND status IN ('agents_complete', 'agents_failed')
                 ORDER BY run_at DESC LIMIT 1) AS last_at,
               (SELECT status FROM analysis_versions WHERE tenant_id = :t AND status IN ('agents_complete', 'agents_failed')
                 ORDER BY run_at DESC LIMIT 1) AS last_status,
               (SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :t AND status IN ('open', 'in_progress', 'escalated')) AS queue_open,
               (SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :t AND status IN ('open', 'in_progress', 'escalated')
                  AND due_at < now()) AS queue_overdue,
               (SELECT COUNT(*) FROM exceptions WHERE tenant_id = :t AND escalation_tier > 1
                  AND status NOT IN ('resolved', 'closed')) AS escalated""", tid)
    report = await _one(db, """
        SELECT MAX(generated_at) AS last_at,
               COUNT(*) FILTER (WHERE generated_at > now() - interval '7 days') AS runs_7d
          FROM reports WHERE tenant_id = :t""", tid)
    monitoring = await _one(db, """
        SELECT (SELECT run_at FROM analysis_versions WHERE tenant_id = :t AND metadata ? 'monitor'
                 ORDER BY run_at DESC LIMIT 1) AS last_at,
               (SELECT (metadata->'monitor'->>'regressed_check_count')::int FROM analysis_versions
                 WHERE tenant_id = :t AND metadata ? 'monitor' ORDER BY run_at DESC LIMIT 1) AS regressed_checks,
               (SELECT (metadata->'monitor'->>'new_records')::int FROM analysis_versions
                 WHERE tenant_id = :t AND metadata ? 'monitor' ORDER BY run_at DESC LIMIT 1) AS new_records,
               (SELECT COUNT(*) FROM webhook_deliveries WHERE tenant_id = :t AND created_at > now() - interval '7 days') AS deliveries_7d,
               (SELECT COUNT(*) FROM webhook_deliveries WHERE tenant_id = :t AND created_at > now() - interval '7 days'
                  AND status = 'failed') AS failed_7d""", tid)
    if agents.get("last_status") is None and checks.get("last_status") in ("agents_complete", "agents_failed"):
        agents["last_status"] = checks["last_status"]
    if monitoring.get("last_at"):
        monitoring["last_status"] = "regressed" if (monitoring.get("regressed_checks") or 0) > 0 else "steady"
    if report.get("last_at"):
        report["last_status"] = "complete"
    return {"extract": extract, "checks": checks, "agents": agents, "report": report, "monitoring": monitoring}


@router.get("/chain")
async def automation_chain(
    request: Request,
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("view")),
) -> dict:
    tid = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tid})
    now = datetime.now(timezone.utc)
    tasks = describe(_beat(), now)
    results = await stage_results(db, tid)
    stages = []
    for s in STAGES:
        mine = [t for t in tasks if t["stage"] == s]
        stages.append({"stage": s, "task_count": len(mine),
                       "next_run_at": next((t["next_run_at"] for t in mine if t["next_run_at"]), None), **results[s]})
    schedules = await run_schedules.list_schedules(db, tenant.id, None)
    return {"generated_at": now.isoformat(), "stages": stages, "tasks": tasks, "schedules": schedules}
