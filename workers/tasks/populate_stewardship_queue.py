"""Populate stewardship_queue from all source tables.

Runs every 15 minutes via Celery beat.  After population completes,
enqueues ai_triage for any new items.

Priority order: (1) critical severity, (2) SLA due date, (3) domain.

Source mapping:
  merge_decision     — match_scores rows with total_score 0.30–0.95
  golden_record_review — master_records with status = pending_review
  exception          — exceptions with status IN (open, in_progress)
  writeback_approval — cleaning_queue with status = approved (pending writeback)
  contract_breach    — contract_compliance_history with compliant = false (recent)
  glossary_review    — glossary_terms past review_cycle_days threshold
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.populate_stewardship_queue")

SAST = timezone(timedelta(hours=2))

# SLA defaults by item type (hours)
SLA_DEFAULTS = {
    "merge_decision": 48,
    "golden_record_review": 72,
    "exception": 24,
    "writeback_approval": 24,
    "contract_breach": 12,
    "glossary_review": 168,  # 7 days
}


def _severity_to_priority(severity: str | None) -> int:
    """Map severity labels to integer priority (1=highest, 5=lowest)."""
    return {"critical": 1, "high": 2, "medium": 3, "low": 4}.get(
        (severity or "").lower(), 3
    )


def _populate_merge_decisions(session: Session, tid: str) -> int:
    """Sync match_scores with total_score 0.30–0.95 (manual review band)."""
    result = session.execute(
        text("""
            INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, sla_hours, due_at)
            SELECT gen_random_uuid(), ms.tenant_id, 'merge_decision', ms.id, ms.domain,
                CASE
                    WHEN ms.total_score >= 0.85 THEN 4
                    WHEN ms.total_score >= 0.70 THEN 3
                    WHEN ms.total_score >= 0.50 THEN 2
                    ELSE 1
                END,
                48,
                now() + interval '48 hours'
            FROM match_scores ms
            WHERE ms.tenant_id = :tid
              AND ms.total_score >= 0.30 AND ms.total_score <= 0.95
              AND ms.auto_action = 'manual_review'
              AND NOT EXISTS (
                  SELECT 1 FROM stewardship_queue sq
                  WHERE sq.source_id = ms.id AND sq.item_type = 'merge_decision' AND sq.tenant_id = :tid
              )
        """),
        {"tid": tid},
    )
    return result.rowcount or 0


def _populate_golden_record_reviews(session: Session, tid: str) -> int:
    """Sync master_records with status = pending_review."""
    result = session.execute(
        text("""
            INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, sla_hours, due_at)
            SELECT gen_random_uuid(), mr.tenant_id, 'golden_record_review', mr.id, mr.domain,
                CASE
                    WHEN mr.overall_confidence >= 0.85 THEN 4
                    WHEN mr.overall_confidence >= 0.60 THEN 3
                    ELSE 2
                END,
                72,
                now() + interval '72 hours'
            FROM master_records mr
            WHERE mr.tenant_id = :tid
              AND mr.status = 'pending_review'
              AND NOT EXISTS (
                  SELECT 1 FROM stewardship_queue sq
                  WHERE sq.source_id = mr.id AND sq.item_type = 'golden_record_review' AND sq.tenant_id = :tid
              )
        """),
        {"tid": tid},
    )
    return result.rowcount or 0


def _populate_exceptions(session: Session, tid: str) -> int:
    """Sync open/in_progress exceptions."""
    result = session.execute(
        text("""
            INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, sla_hours, due_at)
            SELECT gen_random_uuid(), e.tenant_id, 'exception', e.id,
                COALESCE(e.source_system, 'unknown'),
                CASE e.severity
                    WHEN 'critical' THEN 1
                    WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3
                    ELSE 4
                END,
                24,
                COALESCE(e.sla_deadline, now() + interval '24 hours')
            FROM exceptions e
            WHERE e.tenant_id = :tid
              AND e.status IN ('open', 'in_progress')
              AND NOT EXISTS (
                  SELECT 1 FROM stewardship_queue sq
                  WHERE sq.source_id = e.id AND sq.item_type = 'exception' AND sq.tenant_id = :tid
              )
        """),
        {"tid": tid},
    )
    return result.rowcount or 0


def _populate_writeback_approvals(session: Session, tid: str) -> int:
    """Sync cleaning_queue items pending writeback approval."""
    result = session.execute(
        text("""
            INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, sla_hours, due_at)
            SELECT gen_random_uuid(), cq.tenant_id, 'writeback_approval', cq.id,
                COALESCE(cq.object_type, 'unknown'),
                3,
                24,
                now() + interval '24 hours'
            FROM cleaning_queue cq
            WHERE cq.tenant_id = :tid
              AND cq.status = 'approved'
              AND NOT EXISTS (
                  SELECT 1 FROM stewardship_queue sq
                  WHERE sq.source_id = cq.id AND sq.item_type = 'writeback_approval' AND sq.tenant_id = :tid
              )
        """),
        {"tid": tid},
    )
    return result.rowcount or 0


def _populate_contract_breaches(session: Session, tid: str) -> int:
    """Sync recent contract compliance failures."""
    result = session.execute(
        text("""
            INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, sla_hours, due_at)
            SELECT gen_random_uuid(), c.tenant_id, 'contract_breach', c.id,
                COALESCE(c.producer, 'unknown'),
                2,
                12,
                now() + interval '12 hours'
            FROM contracts c
            WHERE c.tenant_id = :tid
              AND c.status = 'active'
              AND EXISTS (
                  SELECT 1 FROM contract_compliance_history cch
                  WHERE cch.contract_id = c.id
                    AND cch.compliant = false
                    AND cch.checked_at >= now() - interval '7 days'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM stewardship_queue sq
                  WHERE sq.source_id = c.id AND sq.item_type = 'contract_breach' AND sq.tenant_id = :tid
              )
        """),
        {"tid": tid},
    )
    return result.rowcount or 0


def _populate_glossary_reviews(session: Session, tid: str) -> int:
    """Sync glossary_terms past their review_cycle_days threshold."""
    result = session.execute(
        text("""
            INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain, priority, sla_hours, due_at)
            SELECT gen_random_uuid(), gt.tenant_id, 'glossary_review', gt.id, gt.domain,
                4,
                168,
                now() + interval '7 days'
            FROM glossary_terms gt
            WHERE gt.tenant_id = :tid
              AND gt.status = 'active'
              AND (
                  gt.last_reviewed_at IS NULL
                  OR gt.last_reviewed_at < now() - (gt.review_cycle_days || ' days')::interval
              )
              AND NOT EXISTS (
                  SELECT 1 FROM stewardship_queue sq
                  WHERE sq.source_id = gt.id AND sq.item_type = 'glossary_review' AND sq.tenant_id = :tid
              )
        """),
        {"tid": tid},
    )
    return result.rowcount or 0


def _mark_resolved_items(session: Session, tid: str) -> int:
    """Auto-resolve queue items whose source has been resolved/completed."""
    # Merge decisions where match_score was reviewed
    result1 = session.execute(
        text("""
            UPDATE stewardship_queue sq
            SET status = 'resolved', updated_at = now()
            WHERE sq.tenant_id = :tid
              AND sq.item_type = 'merge_decision'
              AND sq.status IN ('open', 'in_progress')
              AND EXISTS (
                  SELECT 1 FROM match_scores ms
                  WHERE ms.id = sq.source_id AND ms.reviewed_by IS NOT NULL
              )
        """),
        {"tid": tid},
    )
    count = result1.rowcount or 0

    # Golden records that were promoted
    result2 = session.execute(
        text("""
            UPDATE stewardship_queue sq
            SET status = 'resolved', updated_at = now()
            WHERE sq.tenant_id = :tid
              AND sq.item_type = 'golden_record_review'
              AND sq.status IN ('open', 'in_progress')
              AND EXISTS (
                  SELECT 1 FROM master_records mr
                  WHERE mr.id = sq.source_id AND mr.status IN ('golden', 'promoted')
              )
        """),
        {"tid": tid},
    )
    count += result2.rowcount or 0

    # Exceptions that were resolved/closed
    result3 = session.execute(
        text("""
            UPDATE stewardship_queue sq
            SET status = 'resolved', updated_at = now()
            WHERE sq.tenant_id = :tid
              AND sq.item_type = 'exception'
              AND sq.status IN ('open', 'in_progress')
              AND EXISTS (
                  SELECT 1 FROM exceptions e
                  WHERE e.id = sq.source_id AND e.status IN ('resolved', 'closed')
              )
        """),
        {"tid": tid},
    )
    count += result3.rowcount or 0

    return count


@celery_app.task(name="workers.tasks.populate_stewardship_queue.populate_queue", bind=True, max_retries=1,
                 soft_time_limit=120, time_limit=180)
def populate_queue(self) -> dict:
    """Populate stewardship_queue from all source tables for all tenants.

    After population, enqueues ai_triage for any new items.
    """
    logger.info("populate_stewardship_queue: starting")
    engine = get_sync_engine()
    stats: dict[str, int] = {}

    with Session(engine) as session:
        result = session.execute(text("SELECT id FROM tenants"))
        tenant_ids = [str(r[0]) for r in result.fetchall()]

    for tid in tenant_ids:
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tid)})

                # Auto-resolve items whose source was already handled
                resolved = _mark_resolved_items(session, tid)
                stats[f"{tid}_resolved"] = resolved

                # Populate from each source
                counts = {
                    "merge_decision": _populate_merge_decisions(session, tid),
                    "golden_record_review": _populate_golden_record_reviews(session, tid),
                    "exception": _populate_exceptions(session, tid),
                    "writeback_approval": _populate_writeback_approvals(session, tid),
                    "contract_breach": _populate_contract_breaches(session, tid),
                    "glossary_review": _populate_glossary_reviews(session, tid),
                }

                session.commit()

                total_new = sum(counts.values())
                stats[f"{tid}_new"] = total_new

                logger.info(
                    f"  tenant={tid}: resolved={resolved}, new={total_new} "
                    f"({', '.join(f'{k}={v}' for k, v in counts.items() if v > 0)})"
                )

                # Enqueue ai_triage as a SEPARATE task chain (never blocks population)
                if total_new > 0:
                    from workers.tasks.ai_triage import triage_queue_items
                    triage_queue_items.delay(tid)

        except Exception as e:
            logger.error(f"  tenant={tid}: populate_queue failed: {e}", exc_info=True)

    logger.info(f"populate_stewardship_queue: complete — {stats}")
    return stats
