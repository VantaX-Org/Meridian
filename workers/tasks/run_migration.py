"""Celery task: source→source / source→destination migration analysis.

Deterministic. Pulls cleaned SOURCE master data, reads the live DESTINATION
SAP system's own config via the gap engine, and persists per-record gap
findings + a transfer-readiness verdict. No LLM on any path.
"""

import logging

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.workers.migration")


@celery_app.task(
    bind=True,
    name="workers.tasks.run_migration.run_migration",
    soft_time_limit=600,
    time_limit=660,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_migration(self, tenant_id, run_id, mode, source_system_id,
                  dest_system_id, modules):
    """Analyse transfer-readiness for a migration run."""
    engine = get_sync_engine()
    tid = str(tenant_id)

    try:
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": tid})

            # Idempotent claim — only the queued→running transition proceeds.
            claimed = session.execute(
                text("""
                    UPDATE migration_runs
                       SET status='running', task_id=:task, started_at=now()
                     WHERE id=:rid AND tenant_id=:tid AND status='queued'
                """),
                {"task": self.request.id, "rid": str(run_id), "tid": tid},
            )
            session.commit()
            if claimed.rowcount == 0:
                logger.info(f"Migration run {run_id} not in 'queued' — skipping re-entry")
                return

            if mode == "source_to_source":
                # Writeback owns its own 4-eyes gate; this run is just a launcher.
                session.execute(
                    text("""
                        UPDATE migration_runs
                           SET status='analysed', readiness_verdict=NULL,
                               gap_summary=CAST(:gs AS jsonb), completed_at=now()
                         WHERE id=:rid AND tenant_id=:tid
                    """),
                    {
                        "rid": str(run_id), "tid": tid,
                        "gs": '{"mode":"source_to_source","delegated_to":"writeback"}',
                    },
                )
                session.commit()
                logger.info(f"Migration run {run_id}: source_to_source → writeback")
                return

            _run_source_to_destination(
                session, tid, run_id, source_system_id, dest_system_id, modules
            )

    except SoftTimeLimitExceeded:
        logger.error(f"Migration run {run_id} timed out")
        _fail(tenant_id, run_id, "analysis exceeded the time limit")
    except Exception as e:  # noqa: BLE001 — sanitise, never leak a trace to callers
        logger.error(f"Migration run {run_id} failed: {e}")
        _fail(tenant_id, run_id, str(e))


def _run_source_to_destination(session, tid, run_id, source_system_id,
                               dest_system_id, modules):
    import json

    from api.services.connectivity_manager import ConnectivityManager
    from api.services.migration import SourceTargetMap, TransferGapAnalyzer
    from api.services.migration.serializers import gap_summary_from_result
    from agents.readiness import compute_readiness_status

    manager = ConnectivityManager(session, str(tid))
    dest_row = manager._load_system(str(dest_system_id))
    dest_params = manager._build_connection_params(dest_row)
    dest_system_type = dest_params.get("system_type")

    # Field map for this destination system type (one editor map per type).
    map_rows = session.execute(
        text("""
            SELECT module, source_field, dest_table, dest_field,
                   transform_note, is_confirmed
              FROM transfer_field_mappings
             WHERE tenant_id=:tid AND dest_system_type=:dst
        """),
        {"tid": tid, "dst": dest_system_type},
    ).mappings().all()
    field_map = SourceTargetMap([dict(r) for r in map_rows])

    analyzer = TransferGapAnalyzer(dest_system_type, dest_params)

    # Re-run safety: drop any prior findings for this run before re-inserting.
    session.execute(
        text("DELETE FROM migration_gap_findings WHERE run_id=:rid AND tenant_id=:tid"),
        {"rid": str(run_id), "tid": tid},
    )
    session.commit()

    summaries: list[dict] = []
    total_records = 0
    weighted_score_sum = 0.0
    total_critical = 0

    for module in modules:
        records = _pull_source_records(session, tid, module)
        if not records:
            logger.info(f"Migration run {run_id}: no source records for {module}")
            continue

        result = analyzer.analyze(module, records, field_map)
        ready = result.transfer_ready_by_record

        for f in result.findings:
            session.execute(
                text("""
                    INSERT INTO migration_gap_findings
                        (id, tenant_id, run_id, module, object_type, record_key,
                         dest_table, field, gap_type, severity, detail,
                         status_source, domain_provenance, transfer_ready)
                    VALUES (gen_random_uuid(), :tid, :rid, :mod, :ot, :rk,
                            :dt, :fld, :gt, :sev, :detail, :ss, :dp, :tr)
                """),
                {
                    "tid": tid, "rid": str(run_id), "mod": f.module,
                    "ot": f.object_type, "rk": f.record_key,
                    "dt": f.dest_table, "fld": f.source_field,
                    "gt": f.gap_type.value, "sev": f.severity.value,
                    "detail": f.reason,
                    "ss": f.status_source,
                    "dp": f.domain_provenance.value if f.domain_provenance else None,
                    "tr": ready.get(f.record_key, True),
                },
            )

        summaries.append(gap_summary_from_result(result))
        n = result.score.n_records
        total_records += n
        weighted_score_sum += result.score.score * n
        total_critical += result.score.critical_count

    session.commit()

    agg_score = round(weighted_score_sum / total_records, 2) if total_records else 0.0
    verdict = compute_readiness_status(agg_score, total_critical)
    gap_summary = {"modules": summaries, "aggregate_score": agg_score,
                   "verdict": verdict, "n_records": total_records}

    session.execute(
        text("""
            UPDATE migration_runs
               SET status='analysed', readiness_verdict=:v, readiness_score=:s,
                   critical_count=:c, gap_summary=CAST(:gs AS jsonb),
                   completed_at=now()
             WHERE id=:rid AND tenant_id=:tid
        """),
        {"v": verdict, "s": agg_score, "c": total_critical,
         "gs": json.dumps(gap_summary), "rid": str(run_id), "tid": tid},
    )
    session.commit()
    logger.info(f"Migration run {run_id}: analysed — {verdict} ({agg_score})")


def _pull_source_records(session, tid, module) -> list[dict]:
    """Cleaned source records for a module: golden master_records, else approved cleaning_queue."""
    rows = session.execute(
        text("""
            SELECT sap_object_key AS record_key, golden_fields AS data
              FROM master_records
             WHERE tenant_id=:tid AND domain=:mod
               AND status IN ('golden','pending_review')
        """),
        {"tid": tid, "mod": module},
    ).mappings().all()
    if rows:
        return [
            {"record_key": r["record_key"], "object_type": module, "data": r["data"] or {}}
            for r in rows
        ]

    rows = session.execute(
        text("""
            SELECT record_key, record_data_after AS data
              FROM cleaning_queue
             WHERE tenant_id=:tid AND object_type=:mod
               AND status IN ('approved','applied')
        """),
        {"tid": tid, "mod": module},
    ).mappings().all()
    return [
        {
            "record_key": r["record_key"], "object_type": module,
            "data": {k: v for k, v in (r["data"] or {}).items() if k not in ("issue", "error")},
        }
        for r in rows
    ]


def _fail(tenant_id, run_id, message: str) -> None:
    engine = get_sync_engine()
    try:
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("""
                    UPDATE migration_runs
                       SET status='failed', error_detail=:err, completed_at=now()
                     WHERE id=:rid AND tenant_id=:tid
                """),
                {"err": message[:200], "rid": str(run_id), "tid": str(tenant_id)},
            )
            session.commit()
    except Exception as e:  # noqa: BLE001
        logger.error(f"Could not mark migration run {run_id} failed: {e}")
