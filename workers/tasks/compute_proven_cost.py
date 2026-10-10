"""Post-analysis: money proven lost/held in transactions, attributed to findings. Deterministic."""
import json
import logging
from datetime import date

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker")

_UPSERT = text("""
    INSERT INTO proven_cost_results (tenant_id, version_id, metric, amount, currency, by_currency,
                                     documents, check_ids, items)
    VALUES (:t, :v, :metric, :amount, :currency, CAST(:by_currency AS jsonb), :documents, :check_ids,
            CAST(:items AS jsonb))
    ON CONFLICT (version_id, metric) DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency,
        by_currency = EXCLUDED.by_currency, documents = EXCLUDED.documents, check_ids = EXCLUDED.check_ids,
        items = EXCLUDED.items, computed_at = now()
""")


@celery_app.task(bind=True, name="workers.tasks.compute_proven_cost.compute_proven_cost",
                 soft_time_limit=600, time_limit=660)
def compute_proven_cost(self, version_id: str, tenant_id: str, parquet_path: str) -> dict[str, int]:
    from api.services import proven_cost as pc
    from api.services.merge_explain import REVIEW_FLOOR
    from api.services.source_design import dictionary_for
    from sap.extraction_plan import PROVEN_COST_DATA
    from workers.dataset import load_dataset

    with Session(get_sync_engine()) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        try:
            metadata = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                                       {"v": version_id}).scalar() or {}
            system_id = metadata.get("system_id")
            frames, _, _, _ = load_dataset(parquet_path, dictionary_for(session, system_id), None,
                                           tables=set(PROVEN_COST_DATA))
            failing: dict[str, set[str]] = {}
            for cid, key in session.execute(text(
                    "SELECT check_id, record_key FROM finding_records WHERE version_id = :v AND tenant_id = :t"),
                    {"v": version_id, "t": tenant_id}):
                failing.setdefault(cid, set()).add(key)
            pairs = [(a, b) for a, b in session.execute(text("""
                SELECT candidate_a_key, candidate_b_key FROM match_scores
                WHERE tenant_id = :t AND domain = 'business_partner'
                  AND auto_action <> 'dismissed' AND total_score >= :floor"""),
                {"t": tenant_id, "floor": REVIEW_FLOOR})]
            rows = pc.compute(frames, date.today(), pc.vendor_clusters(pairs), failing)
            session.execute(_UPSERT, [{
                "t": tenant_id, "v": version_id, "metric": r["metric"], "amount": r["amount"],
                "currency": r["currency"], "by_currency": json.dumps(r["by_currency"]),
                "documents": r["documents"], "check_ids": r["check_ids"], "items": json.dumps(r["items"]),
            } for r in rows])
            session.commit()
            return {r["metric"]: r["documents"] for r in rows}
        except SoftTimeLimitExceeded:
            session.rollback()
            logger.warning(f"compute_proven_cost {version_id}: time limit")
            return {}
        except Exception:
            session.rollback()
            logger.exception(f"compute_proven_cost {version_id}: failed")
            raise
