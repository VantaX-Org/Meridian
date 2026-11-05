"""Celery task: post-load reconciliation of one migration run against the target system.

Deterministic, no LLM. The expected load is rebuilt by ``export.load_run_tables`` (the records the load files carry);
the found side is the target system's latest complete extraction. The result goes to migration_reconciliations.
"""

import json
import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.reconciliation")

_FINDINGS = text("SELECT check_id, severity, dimension, affected_count, total_count, pass_rate, details, "
                 "finding_type FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m")


def _findings(session, tenant_id, version_id, modules) -> dict[str, list[dict]]:
    return {m: [dict(r) for r in session.execute(
        _FINDINGS, {"v": str(version_id), "t": str(tenant_id), "m": m}).mappings().all()] for m in modules}


def _finish(session, rid, status, error=None, **cols) -> dict:
    sets = ", ".join(f"{k} = CAST(:{k} AS jsonb)" if k in ("summary", "tables", "records", "scores") else f"{k} = :{k}"
                     for k in cols)
    session.execute(text(f"UPDATE migration_reconciliations SET status = :st, error_detail = :err, "
                         f"completed_at = now(){', ' + sets if sets else ''} WHERE id = :rid"),
                    {"rid": rid, "st": status, "err": error,
                     **{k: json.dumps(v) if k in ("summary", "tables", "records", "scores") else v
                        for k, v in cols.items()}})
    session.commit()
    return {"reconciliation_id": rid, "status": status, "error": error}


@celery_app.task(bind=True, name="workers.tasks.run_reconciliation.run_reconciliation",
                 soft_time_limit=1800, time_limit=1860, acks_late=True, reject_on_worker_lost=True)
def run_reconciliation(self, tenant_id, reconciliation_id):
    engine = get_sync_engine()
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        session.execute(text("UPDATE migration_reconciliations SET status = 'running' WHERE id = :rid"),
                        {"rid": reconciliation_id})
        session.commit()
        try:
            from api.services.migration.export import load_run_tables
            from api.services.migration.post_load import reconcile, score_sides
            from checks.runner import module_rules
            from workers.dataset import load_dataset
            from workers.tasks.run_migration import resolve_source_version

            run = session.execute(text(
                "SELECT r.* FROM migration_reconciliations c JOIN migration_runs r ON r.id = c.run_id "
                "WHERE c.id = :rid"), {"rid": reconciliation_id}).fetchone()
            cfg = session.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"),
                                  {"t": str(tenant_id)}).scalar() or {}
            summary = run.gap_summary or {}
            rule_text = {m: {r.get("id"): r.get("message", "") for r in module_rules(m)} for m in run.modules}
            source_findings = _findings(session, tenant_id, run.source_version_id, run.modules)

            def scores(target_findings):
                return score_sides(list(run.modules), summary, target_findings, source_findings, cfg, rule_text)

            if not run.dest_system_id:
                return _finish(session, reconciliation_id, "failed",
                               "The run has no target system to reconcile against.", scores=scores(None))
            version_id, meta = resolve_source_version(session, run.dest_system_id, None)
            if not version_id or not meta.get("dataset_path"):
                return _finish(session, reconciliation_id, "failed",
                               "The target system has no completed analysis. Extract the target first.",
                               scores=scores(None))

            held: dict = {}
            expected, target_dict = load_run_tables(session, run, held)
            if not expected:
                return _finish(session, reconciliation_id, "failed", "No transfer-ready records in the load.",
                               scores=scores(None))
            target, _, _, _ = load_dataset(meta["dataset_path"], target_dict, tables=set(expected))
            cov = meta.get("coverage") or []
            target.incomplete = {c["table"] for c in cov if c.get("complete") is False or c.get("truncated")}
            target.partial = {c["table"] for c in cov if c.get("partial")}

            result = reconcile(expected, held, target, target_dict)
            records = {t["table"]: t.pop("records") for t in result["tables"]}
            synced = session.execute(text("SELECT run_at FROM analysis_versions WHERE id = :v"),
                                     {"v": version_id}).scalar()
            return _finish(session, reconciliation_id, "done", None, summary=result["totals"], tables=result["tables"],
                           records=records, record_cap=result["record_cap"], target_version_id=version_id,
                           target_synced_at=synced, target_system_id=run.dest_system_id,
                           scores=scores(_findings(session, tenant_id, version_id, run.modules)))
        except SoftTimeLimitExceeded:
            session.rollback()
            return _finish(session, reconciliation_id, "failed", "time limit reached")
        except Exception as e:
            logger.exception("post-load reconciliation failed")
            session.rollback()
            return _finish(session, reconciliation_id, "failed", str(e)[:500])
