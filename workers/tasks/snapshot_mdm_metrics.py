"""Daily MDM metrics snapshot — computes component metrics and MDM Health Score.

Runs after each sync cycle (chained from daily_analysis) or as a standalone daily task.
Reads golden record counts, match confidence, stewardship SLA, and source consistency
from existing tables. Writes a daily row to mdm_metrics per tenant.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.mdm_scoring import compute_mdm_health_score
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.snapshot_mdm_metrics")

SAST = timezone(timedelta(hours=2))


def _set_rls(session: Session, tenant_id: str) -> None:
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})


@celery_app.task(name="workers.tasks.snapshot_mdm_metrics.snapshot_mdm_metrics",
                 soft_time_limit=120, time_limit=180)
def snapshot_mdm_metrics() -> None:
    """Daily task: compute and store MDM health metrics for all tenants."""
    logger.info("snapshot_mdm_metrics: starting")
    engine = get_sync_engine()

    with Session(engine) as session:
        result = session.execute(text("SELECT id FROM tenants"))
        tenant_ids = [str(r[0]) for r in result.fetchall()]

    for tid in tenant_ids:
        try:
            _snapshot_for_tenant(engine, tid)
        except Exception as e:
            logger.error(f"  tenant={tid}: snapshot_mdm_metrics failed: {e}", exc_info=True)

    logger.info("snapshot_mdm_metrics: complete")


def _snapshot_for_tenant(engine, tenant_id: str) -> None:
    """Compute and store MDM metrics for a single tenant."""
    today = datetime.now(SAST).date()

    with Session(engine) as session:
        _set_rls(session, tenant_id)

        # Check if already snapshotted today (aggregate row)
        existing = session.execute(
            text("""
                SELECT 1 FROM mdm_metrics
                WHERE tenant_id = :tid AND snapshot_date = :today AND domain IS NULL
                LIMIT 1
            """),
            {"tid": tenant_id, "today": today},
        ).fetchone()
        if existing:
            logger.info(f"  tenant={tenant_id}: already snapshotted today, skipping")
            return

        # 1. Golden record coverage: promoted / total master records
        gr_result = session.execute(
            text("""
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'golden') as promoted
                FROM master_records
                WHERE tenant_id = :tid
            """),
            {"tid": tenant_id},
        ).fetchone()
        total_records = gr_result[0] or 0
        promoted_records = gr_result[1] or 0
        golden_record_coverage_pct = (promoted_records / total_records) if total_records > 0 else 0.0

        # 2. Average match confidence from recent match_scores (last 30 days)
        mc_result = session.execute(
            text("""
                SELECT AVG(total_score)
                FROM match_scores
                WHERE tenant_id = :tid
                  AND created_at >= CURRENT_DATE - INTERVAL '30 days'
                  AND auto_action IN ('auto_merge', 'queue')
            """),
            {"tid": tenant_id},
        ).fetchone()
        avg_match_confidence = float(mc_result[0] or 0.0)

        # 3. Stewardship SLA compliance: resolved within SLA / total resolved
        sla_result = session.execute(
            text("""
                SELECT
                    COUNT(*) as resolved_total,
                    COUNT(*) FILTER (
                        WHERE updated_at <= created_at + (sla_hours * INTERVAL '1 hour')
                    ) as within_sla
                FROM stewardship_queue
                WHERE tenant_id = :tid
                  AND status = 'resolved'
                  AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
                  AND sla_hours IS NOT NULL
            """),
            {"tid": tenant_id},
        ).fetchone()
        resolved_total = sla_result[0] or 0
        within_sla = sla_result[1] or 0
        steward_sla_compliance_pct = (within_sla / resolved_total) if resolved_total > 0 else 1.0

        # 4. Source consistency: fields where all sources agree with golden
        #    Approximated from survivorship_rules coverage
        sc_result = session.execute(
            text("""
                SELECT
                    COUNT(*) as total_fields,
                    COUNT(*) FILTER (WHERE active = true) as consistent_fields
                FROM survivorship_rules
                WHERE tenant_id = :tid
            """),
            {"tid": tenant_id},
        ).fetchone()
        total_fields = sc_result[0] or 0
        consistent_fields = sc_result[1] or 0
        source_consistency_pct = (consistent_fields / total_fields) if total_fields > 0 else 0.0

        # Compute MDM Health Score
        mdm_health_score = compute_mdm_health_score(
            golden_record_coverage_pct=golden_record_coverage_pct,
            avg_match_confidence=avg_match_confidence,
            steward_sla_compliance_pct=steward_sla_compliance_pct,
            source_consistency_pct=source_consistency_pct,
        )

        # Stewardship backlog count
        backlog_result = session.execute(
            text("""
                SELECT COUNT(*) FROM stewardship_queue
                WHERE tenant_id = :tid AND status IN ('open', 'in_progress')
            """),
            {"tid": tenant_id},
        ).fetchone()
        backlog_count = backlog_result[0] or 0

        # Sync coverage: active sync profiles with a successful run in last 7 days
        sync_result = session.execute(
            text("""
                SELECT
                    COUNT(*) as total_profiles,
                    COUNT(*) FILTER (
                        WHERE last_run_at >= CURRENT_DATE - INTERVAL '7 days'
                    ) as active_recent
                FROM sync_profiles
                WHERE tenant_id = :tid AND active = true
            """),
            {"tid": tenant_id},
        ).fetchone()
        total_profiles = sync_result[0] or 0
        active_recent = sync_result[1] or 0
        sync_coverage_pct = (active_recent / total_profiles) if total_profiles > 0 else 0.0

        # Insert aggregate row (domain IS NULL)
        session.execute(
            text("""
                INSERT INTO mdm_metrics (
                    id, tenant_id, snapshot_date, domain,
                    golden_record_count, golden_record_coverage_pct,
                    avg_match_confidence, steward_sla_compliance_pct,
                    source_consistency_pct, mdm_health_score,
                    backlog_count, sync_coverage_pct
                ) VALUES (
                    gen_random_uuid(), :tid, :today, NULL,
                    :gr_count, :gr_pct,
                    :mc, :sla,
                    :sc, :score,
                    :backlog, :sync_pct
                )
                ON CONFLICT (tenant_id, snapshot_date, domain) DO NOTHING
            """),
            {
                "tid": tenant_id,
                "today": today,
                "gr_count": promoted_records,
                "gr_pct": round(golden_record_coverage_pct, 4),
                "mc": round(avg_match_confidence, 4),
                "sla": round(steward_sla_compliance_pct, 4),
                "sc": round(source_consistency_pct, 4),
                "score": mdm_health_score,
                "backlog": backlog_count,
                "sync_pct": round(sync_coverage_pct, 4),
            },
        )

        session.commit()
        logger.info(
            f"  tenant={tenant_id}: MDM snapshot written — "
            f"score={mdm_health_score:.1f}, coverage={golden_record_coverage_pct:.2%}, "
            f"backlog={backlog_count}"
        )
