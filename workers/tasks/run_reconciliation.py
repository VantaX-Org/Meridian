"""Celery task: post-load reconciliation of one migration run against the target system.

Deterministic, no LLM. The expected side is the snapshot of the files handed over at the run's latest export
(``migration.snapshot``), checked against its stored digest. When the run has no snapshot, or it cannot be read or
fails the digest, the load is rebuilt by ``export.load_run_tables`` from the mappings as they stand now. Either way the
summary carries ``basis`` ("snapshot" or "rebuilt"), and for a snapshot the export id and date; a skipped snapshot adds
``snapshot_skipped``. The found side is the target system's latest complete extraction. The result goes to migration_reconciliations.
"""

import json
import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

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
    with tenant_session(get_sync_engine(), tenant_id) as session:
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

            from api.services.migration import snapshot
            from api.services.migration.export import target_dictionary

            basis: dict = {"basis": "rebuilt"}
            snap = snapshot.latest(session, run.id)
            expected = held = None
            if snap:
                try:
                    expected, held = snapshot.read(tenant_id, snap.snapshot_prefix, snap.snapshot_sha256)
                    target_dict = target_dictionary(session, run)
                    basis = {"basis": "snapshot", "snapshot_export_id": str(snap.id),
                             "snapshot_exported_at": snap.created_at.isoformat()}
                except Exception as e:  # unreadable or altered snapshot: rebuild, and say why
                    logger.warning("export snapshot not used: %s", e)
                    expected = held = None
                    basis["snapshot_skipped"] = str(e)[:200]
            if expected is None:
                held = {}
                expected, target_dict = load_run_tables(session, run, held)
            if snapshot.newest_has_no_copy(session, run.id):
                basis["newest_export_no_copy"] = True
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
            return _finish(session, reconciliation_id, "done", None, summary={**result["totals"], **basis}, tables=result["tables"],
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


def start_stale_reconciliations(session, tenant_id, system_id) -> list[str]:
    """Re-reconcile every run whose latest finished reconciliation compared this target system and is now out of date.

    Called when a target analysis completes (the same moment the API starts reporting ``stale``). A run with a
    reconciliation still queued or running is skipped, and once the new one finishes it compares the newest extraction,
    so the same run and extraction are never queued twice. Never raises: a failure here must not fail the analysis.
    """
    started: list[str] = []
    try:
        rows = session.execute(text("""
            SELECT DISTINCT ON (c.run_id) c.run_id, c.status, c.target_synced_at, c.target_system_id
              FROM migration_reconciliations c JOIN migration_runs r ON r.id = c.run_id
             WHERE c.tenant_id = :t AND r.status IN ('analysed', 'exported')
             ORDER BY c.run_id, c.created_at DESC"""), {"t": str(tenant_id)}).fetchall()
        latest = session.execute(text(
            "SELECT max(run_at) FROM analysis_versions WHERE tenant_id = :t AND metadata->>'system_id' = :sid "
            "AND position('complete' in status) > 0 AND metadata->>'dataset_path' IS NOT NULL"),
            {"t": str(tenant_id), "sid": str(system_id)}).scalar()
        for row in rows:
            if (row.status != "done" or str(row.target_system_id) != str(system_id) or not latest
                    or not row.target_synced_at or latest <= row.target_synced_at):
                continue
            rid = session.execute(text(
                "INSERT INTO migration_reconciliations (tenant_id, run_id, status, auto_started) "
                "SELECT :t, :r, 'queued', true WHERE NOT EXISTS (SELECT 1 FROM migration_reconciliations "
                "WHERE run_id = :r AND status IN ('queued','running') AND created_at > now() - interval '2 hours') "
                "RETURNING id"), {"t": str(tenant_id), "r": row.run_id}).scalar()
            session.commit()
            if not rid:
                continue
            try:
                task = run_reconciliation.delay(str(tenant_id), str(rid))
                session.execute(text("UPDATE migration_reconciliations SET task_id = :k WHERE id = :id"),
                                {"k": task.id, "id": rid})
            except Exception:
                session.execute(text("UPDATE migration_reconciliations SET status = 'failed', completed_at = now(), "
                                     "error_detail = 'The task queue could not be reached.' WHERE id = :id"), {"id": rid})
            session.commit()
            started.append(str(rid))
    except Exception:
        logger.exception("automatic reconciliation could not be started")
        session.rollback()
    return started
