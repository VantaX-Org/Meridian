"""Weekly per-owner digest email, spec 8.3. Reuses the existing Notification
table's type='digest' convention (db/schema.py) for both delivery and the
"last sent" timestamp read back by GET /api/v1/insights/owners."""
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.insights_owners import OWNER_ISSUE_SQL, baseline_cutoff, build_owner_card, load_owner_aggregates
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.owner_digests")


@celery_app.task(soft_time_limit=300, time_limit=360)
def send_owner_digests():
    engine = get_sync_engine()
    with Session(engine) as session:
        tenant_ids = [r[0] for r in session.execute(text("SELECT id FROM tenants")).fetchall()]

    sent = 0
    for tenant_id in tenant_ids:
        try:
            with tenant_session(engine, tenant_id) as session:
                rows = session.execute(
                    text(OWNER_ISSUE_SQL), {"tid": str(tenant_id), "cutoff": baseline_cutoff()}
                ).fetchall()
                issue_rows = [dict(r._mapping) for r in rows]
                aggregates = load_owner_aggregates(issue_rows)
                for owner, agg in aggregates.items():
                    card = build_owner_card(
                        owner, agg["score"], agg["delta"], agg["open_by_severity"],
                        agg["fixed_since_baseline"], agg["oldest_item_age_days"],
                    )
                    session.execute(
                        text("""
                            INSERT INTO notifications (id, tenant_id, user_id, type, title, body, link, is_read, created_at)
                            VALUES (:id, :tid, :uid, 'digest', :title, :body, :link, false, now())
                        """),
                        {"id": str(uuid.uuid4()), "tid": str(tenant_id), "uid": agg["user_id"],
                         "title": "Your weekly data quality digest", "body": card.digest, "link": "/insights/owners"},
                    )
                session.commit()
            sent += 1
        except Exception:
            logger.exception(f"owner digests: failed for tenant={tenant_id}, continuing with remaining tenants")
    logger.info(f"owner digests sent for {sent}/{len(tenant_ids)} tenants")
