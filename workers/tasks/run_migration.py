"""Celery task: transfer-readiness gap analysis (source→destination).

Deterministic, no LLM. Pulls cleaned source master data, connects to the *live*
destination SAP system, gap-analyses source-vs-destination against the
destination's own config, persists per-record gaps and a transfer verdict.

source_to_source is a thin launcher — the existing 4-eyes writeback path owns
its own gate, so this task only records the run.
"""

import json
import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.migration")


def _pull_source(session: Session, tenant_id: str, module: str):
    """Return (keys, records) of cleaned source data for a module.

    Golden master records first, else steward-approved cleaning-queue rows.
    Both tables carry an explicit business key, so the export route can re-pull
    and match the same keys without re-deriving them.
    """
    rows = session.execute(
        text("""
            SELECT sap_object_key, golden_fields FROM master_records
            WHERE tenant_id = :tid AND domain = :m
              AND status IN ('golden', 'pending_review')
        """),
        {"tid": tenant_id, "m": module},
    ).fetchall()
    if rows:
        return [r[0] for r in rows], [dict(r[1] or {}) for r in rows]

    rows = session.execute(
        text("""
            SELECT record_key, record_data_after, record_data_before
            FROM cleaning_queue
            WHERE tenant_id = :tid AND object_type = :m AND status = 'approved'
        """),
        {"tid": tenant_id, "m": module},
    ).fetchall()
    keys, records = [], []
    for r in rows:
        data = dict(r[1] or r[2] or {})
        data = {k: v for k, v in data.items() if k not in ("issue", "error")}
        keys.append(r[0])
        records.append(data)
    return keys, records


@celery_app.task(
    bind=True,
    name="workers.tasks.run_migration.run_migration",
    soft_time_limit=600,
    time_limit=660,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_migration(self, tenant_id, run_id, mode, source_system_id, dest_system_id, modules):
    engine = get_sync_engine()
    dest_params: dict = {}

    try:
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            # Idempotent claim — only one worker advances a queued run.
            claimed = session.execute(
                text("UPDATE migration_runs SET status = 'running', task_id = :tid, "
                     "started_at = now() WHERE id = :rid AND status = 'queued'"),
                {"tid": self.request.id, "rid": run_id},
            )
            session.commit()
            if claimed.rowcount == 0:
                logger.info(f"Migration run {run_id} already claimed — skipping")
                return

            try:
                if mode == "source_to_source":
                    # Writeback owns its own 4-eyes gate; nothing to gap-analyse.
                    session.execute(
                        text("UPDATE migration_runs SET status = 'analysed', "
                             "readiness_verdict = NULL, gap_summary = CAST(:s AS jsonb), "
                             "completed_at = now() WHERE id = :rid"),
                        {"s": json.dumps({"mode": "source_to_source",
                                          "delegated_to": "writeback"}), "rid": run_id},
                    )
                    session.commit()
                    logger.info(f"Migration run {run_id} (source_to_source) recorded")
                    return

                from api.services.connectivity_manager import ConnectivityManager
                from api.services.migration import (
                    SourceTargetMap, TransferGapAnalyzer, aggregate_verdict,
                )

                manager = ConnectivityManager(session, tenant_id)
                dest_row = manager._load_system(dest_system_id)
                dest_params = manager._build_connection_params(dest_row)
                dest_system_type = dest_params["system_type"]

                map_rows = session.execute(
                    text("SELECT module, source_field, dest_table, dest_field, transform_note "
                         "FROM transfer_field_mappings WHERE tenant_id = :tid "
                         "AND dest_system_type = :dst"),
                    {"tid": tenant_id, "dst": dest_system_type},
                ).fetchall()
                field_map = SourceTargetMap([dict(r._mapping) for r in map_rows])

                analyzer = TransferGapAnalyzer(dest_system_type, dest_params)

                # Re-run safety: clear any prior findings for this run.
                session.execute(
                    text("DELETE FROM migration_gap_findings WHERE run_id = :rid"),
                    {"rid": run_id},
                )
                session.commit()

                results = []
                for module in modules:
                    try:
                        keys, records = _pull_source(session, tenant_id, module)
                        if not records:
                            logger.info(f"Migration {run_id}: no source records for {module}")
                            continue
                        result = analyzer.analyze(
                            module, records, field_map, object_type=module, record_keys=keys,
                        )
                        results.append(result)
                        for f in result.findings:
                            session.execute(
                                text("""
                                    INSERT INTO migration_gap_findings
                                        (id, tenant_id, run_id, module, object_type,
                                         record_key, dest_table, field, gap_type, severity,
                                         detail, status_source, domain_provenance, transfer_ready)
                                    VALUES (gen_random_uuid(), :tid, :rid, :mod, :ot, :rk,
                                            :dt, :fld, :gt, :sev, :detail, :ss, :dp, false)
                                """),
                                {
                                    "tid": tenant_id, "rid": run_id, "mod": f.module,
                                    "ot": f.object_type, "rk": f.record_key,
                                    "dt": f.dest_table, "fld": f.dest_field,
                                    "gt": f.gap_type.value, "sev": f.severity.value,
                                    "detail": f.reason, "ss": f.status_source,
                                    "dp": f.domain_provenance,
                                },
                            )
                        session.commit()
                    except SoftTimeLimitExceeded:
                        raise
                    except Exception as e:
                        logger.error(f"Migration {run_id}: module {module} failed: {e}")
                        session.rollback()

                verdict = aggregate_verdict(results)
                summary = {
                    "status": verdict.status, "score": verdict.score,
                    "critical_count": verdict.critical_count,
                    "blocking_count": verdict.blocking_count,
                    "ungrounded_count": verdict.ungrounded_count,
                    "by_module": verdict.by_module,
                    "blockers": verdict.blockers, "conditions": verdict.conditions,
                }
                session.execute(
                    text("UPDATE migration_runs SET status = 'analysed', "
                         "readiness_verdict = :v, readiness_score = :sc, "
                         "critical_count = :cc, gap_summary = CAST(:s AS jsonb), "
                         "completed_at = now() WHERE id = :rid"),
                    {"v": verdict.status, "sc": verdict.score, "cc": verdict.critical_count,
                     "s": json.dumps(summary), "rid": run_id},
                )
                session.commit()
                logger.info(f"Migration {run_id} analysed: {verdict.status} ({verdict.score})")

            except SoftTimeLimitExceeded:
                logger.error(f"Migration {run_id} timed out")
                raise
            except Exception as e:
                logger.error(f"Migration {run_id} failed: {e}")
                session.rollback()
                session.execute(
                    text("UPDATE migration_runs SET status = 'failed', "
                         "error_detail = :err, completed_at = now() WHERE id = :rid"),
                    {"err": str(e)[:200], "rid": run_id},
                )
                session.commit()
    finally:
        for key in ("password", "client_secret", "api_key", "client_id"):
            if key in dest_params:
                dest_params[key] = ""
