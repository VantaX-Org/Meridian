"""AI triage for stewardship queue items.

Celery task — runs every 15 minutes over stewardship_queue rows where
ai_recommendation IS NULL.  Attaches a recommendation and confidence score.

Security:
  - Runs as a service account, not triggered by user requests directly.
  - Uses sanitise_for_prompt to strip PII before LLM calls.
  - Token limit: 800 per call.
  - Logs every call via llm_audit_log (prompt hash only, no content).
"""

import logging
import os
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.ai_triage")

MAX_TOKENS = 800
BATCH_SIZE = 50


def _build_triage_prompt(item: dict[str, Any]) -> str:
    """Build a concise triage prompt from queue item metadata only — no raw data."""
    from api.utils.pii_fields import sanitise_for_prompt

    parts = [
        f"Item type: {item['item_type']}",
        f"Domain: {sanitise_for_prompt('domain', item['domain'])}",
        f"Priority: {item['priority']}",
        f"Status: {item['status']}",
    ]

    if item.get("sla_hours"):
        parts.append(f"SLA hours: {item['sla_hours']}")

    if item.get("source_metadata"):
        meta = item["source_metadata"]
        if isinstance(meta, dict):
            for k, v in meta.items():
                parts.append(f"{k}: {sanitise_for_prompt(k, v)}")

    prompt = (
        "You are a data stewardship AI assistant for SAP master data quality.\n"
        "Given the following stewardship queue item, provide:\n"
        "1. A brief recommendation (approve, reject, escalate, or review_manually)\n"
        "2. A one-sentence justification\n\n"
        "Item details:\n" + "\n".join(parts) + "\n\n"
        "Respond in JSON format: {\"recommendation\": \"...\", \"justification\": \"...\", \"confidence\": 0.0-1.0}"
    )

    return prompt


def _call_llm(prompt: str, tenant_id: str) -> tuple[str, float]:
    """Call the LLM and return (recommendation_text, confidence).

    Falls back to a safe default if the LLM is unavailable.
    """
    from api.utils.llm_logger import log_llm_call

    start_ms = time.time()
    try:
        from llm.provider import get_llm

        llm = get_llm()
        response = llm.invoke(prompt, max_tokens=MAX_TOKENS)

        latency_ms = int((time.time() - start_ms) * 1000)
        content = response.content if hasattr(response, "content") else str(response)
        token_count = len(content.split())  # rough estimate

        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_triage",
            prompt=prompt,
            model_version=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            token_count=token_count,
            latency_ms=latency_ms,
            success=True,
        )

        return _parse_llm_response(content)

    except Exception as e:
        latency_ms = int((time.time() - start_ms) * 1000)
        logger.warning(f"LLM call failed (non-fatal): {e}")

        log_llm_call(
            tenant_id=tenant_id,
            service_name="ai_triage",
            prompt=prompt,
            model_version=os.getenv("OLLAMA_MODEL", "llama3.1:70b"),
            token_count=0,
            latency_ms=latency_ms,
            success=False,
        )

        return "review_manually", 0.0


def _parse_llm_response(content: str) -> tuple[str, float]:
    """Parse the LLM JSON response into (recommendation, confidence)."""
    import json

    try:
        # Try to extract JSON from the response
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(content[start:end])
            recommendation = data.get("recommendation", "review_manually")
            justification = data.get("justification", "")
            confidence = float(data.get("confidence", 0.5))
            confidence = max(0.0, min(1.0, confidence))

            full_text = f"{recommendation}: {justification}" if justification else recommendation
            return full_text, confidence
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Fallback: use raw content as recommendation
    return content[:500], 0.3


def _get_source_metadata(session: Session, item_type: str, source_id: str) -> dict[str, Any]:
    """Fetch non-PII metadata from the source table for prompt enrichment."""
    metadata: dict[str, Any] = {}

    try:
        if item_type == "merge_decision":
            result = session.execute(
                text("SELECT domain, total_score, auto_action FROM match_scores WHERE id = :id"),
                {"id": source_id},
            )
            row = result.fetchone()
            if row:
                metadata = {"match_domain": row[0], "total_score": float(row[1]), "auto_action": row[2]}

        elif item_type == "golden_record_review":
            result = session.execute(
                text("SELECT domain, overall_confidence, status FROM master_records WHERE id = :id"),
                {"id": source_id},
            )
            row = result.fetchone()
            if row:
                metadata = {"record_domain": row[0], "overall_confidence": float(row[1]), "record_status": row[2]}

        elif item_type == "exception":
            result = session.execute(
                text("SELECT type, category, severity FROM exceptions WHERE id = :id"),
                {"id": source_id},
            )
            row = result.fetchone()
            if row:
                metadata = {"exception_type": row[0], "category": row[1], "severity": row[2]}

        elif item_type == "contract_breach":
            result = session.execute(
                text("SELECT name, producer, consumer FROM contracts WHERE id = :id"),
                {"id": source_id},
            )
            row = result.fetchone()
            if row:
                metadata = {"contract_name": row[0], "producer": row[1], "consumer": row[2]}

        elif item_type == "glossary_review":
            result = session.execute(
                text("SELECT technical_name, sap_table, sap_field, domain FROM glossary_terms WHERE id = :id"),
                {"id": source_id},
            )
            row = result.fetchone()
            if row:
                metadata = {"technical_name": row[0], "sap_table": row[1], "sap_field": row[2], "term_domain": row[3]}

    except Exception as e:
        logger.warning(f"Failed to fetch source metadata for {item_type}/{source_id}: {e}")

    return metadata


@celery_app.task(name="workers.tasks.ai_triage.triage_queue_items", bind=True, max_retries=1,
                 soft_time_limit=300, time_limit=360)
def triage_queue_items(self, tenant_id: str | None = None) -> dict:
    """Triage stewardship queue items that lack an AI recommendation.

    Runs as a separate task chain from queue population so LLM latency
    never blocks item ingestion.
    """
    logger.info("ai_triage: starting triage run")
    engine = get_sync_engine()
    processed = 0
    errors = 0

    with Session(engine) as session:
        # If tenant_id given, process just that tenant; else all tenants
        if tenant_id:
            tenant_ids = [tenant_id]
        else:
            result = session.execute(text("SELECT id FROM tenants"))
            tenant_ids = [str(r[0]) for r in result.fetchall()]

    for tid in tenant_ids:
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tid)})

                # Fetch untriaged items
                result = session.execute(
                    text("""
                        SELECT id, item_type, source_id, domain, priority, status, sla_hours
                        FROM stewardship_queue
                        WHERE tenant_id = :tid
                          AND ai_recommendation IS NULL
                          AND status IN ('open', 'in_progress')
                        ORDER BY priority ASC, due_at ASC NULLS LAST
                        LIMIT :batch_size
                    """),
                    {"tid": tid, "batch_size": BATCH_SIZE},
                )
                items = [dict(r._mapping) for r in result.fetchall()]

                for item in items:
                    try:
                        # Enrich with source metadata
                        item["source_metadata"] = _get_source_metadata(
                            session, item["item_type"], str(item["source_id"])
                        )

                        prompt = _build_triage_prompt(item)
                        recommendation, confidence = _call_llm(prompt, tid)

                        session.execute(
                            text("""
                                UPDATE stewardship_queue
                                SET ai_recommendation = :rec,
                                    ai_confidence = :conf,
                                    updated_at = now()
                                WHERE id = :id AND tenant_id = :tid
                            """),
                            {
                                "rec": recommendation,
                                "conf": confidence,
                                "id": str(item["id"]),
                                "tid": tid,
                            },
                        )
                        processed += 1

                    except Exception as e:
                        logger.warning(f"ai_triage: failed for item {item['id']}: {e}")
                        errors += 1

                session.commit()

        except Exception as e:
            logger.error(f"ai_triage: tenant {tid} failed: {e}", exc_info=True)
            errors += 1

    logger.info(f"ai_triage: complete — processed={processed}, errors={errors}")
    return {"processed": processed, "errors": errors}
