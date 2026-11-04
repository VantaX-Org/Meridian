"""AI triage for stewardship queue items.

Celery task — runs every 15 minutes over stewardship_queue rows where
ai_recommendation IS NULL.  Attaches a recommendation and confidence score.

Security:
  - Runs as a service account, not triggered by user requests directly.
  - The model sees allowlisted metadata only (scores, codes), never a SAP value; output is verified.
  - Token limit: 800 per call.
  - Logs every call via llm_audit_log (prompt hash only, no content).
"""

import json
import logging
import os
import re
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.ai_triage")

MAX_TOKENS = 800
BATCH_SIZE = 50


def _llm_enabled() -> bool:
    """Feature flag — default ON. Set MERIDIAN_TRIAGE_LLM=off to be fully deterministic."""
    val = os.getenv("MERIDIAN_TRIAGE_LLM", "on").strip().lower()
    return val not in ("off", "false", "0", "no")


def deterministic_triage(item: dict[str, Any]) -> tuple[str, float] | None:
    """Score-band and rule-based triage — no LLM.

    Returns (recommendation, confidence) when a deterministic decision can be made,
    else None so the caller can fall through to the LLM.

    At 400k records this handles ~80% of queue items.
    """
    item_type = item.get("item_type")
    meta = item.get("source_metadata") or {}

    if item_type == "merge_decision":
        score = float(meta.get("total_score", 0.0) or 0.0)
        auto_action = meta.get("auto_action")
        if auto_action in ("auto_merge", "auto_reject"):
            return (
                "approve" if auto_action == "auto_merge" else "reject",
                0.99,
            )
        if score >= 0.98:
            return "approve: near-exact match, deterministic score ≥0.98", 0.95
        if score >= 0.85:
            return "approve: strong match, deterministic score ≥0.85 — verify on open", 0.85
        if score <= 0.25:
            return "reject: values clearly differ, deterministic score ≤0.25", 0.90
        if score <= 0.40:
            return "reject: low deterministic score (≤0.40)", 0.75
        return None  # uncertain band → LLM

    if item_type == "golden_record_review":
        conf = float(meta.get("overall_confidence", 0.0) or 0.0)
        status = meta.get("record_status")
        if status == "candidate" and conf >= 0.90:
            return "approve: high-confidence candidate (≥0.90)", 0.90
        if conf < 0.40:
            return "escalate: overall confidence <0.40 — data steward review required", 0.85
        return None

    if item_type == "exception":
        severity = str(meta.get("severity", "")).lower()
        if severity == "critical":
            return "escalate: critical severity requires immediate steward attention", 0.95
        if severity == "low":
            return "review_manually: low-severity exception, batch-handle on next pass", 0.80
        return None

    if item_type == "contract_breach":
        # Contract breaches are always governance events — always escalate.
        return "escalate: data contract breach — notify producer and consumer", 0.95

    if item_type == "glossary_review":
        return "review_manually: glossary term awaits steward definition review", 0.70

    return None


# Metadata keys the model may see: scores, status codes and SAP schema names from _get_source_metadata.
# Contract name/producer/consumer and glossary technical_name are tenant-authored free text, so they stay out.
PROMPT_META_KEYS = frozenset({
    "match_domain", "total_score", "auto_action", "record_domain", "overall_confidence", "record_status",
    "exception_type", "category", "severity", "sap_table", "sap_field", "term_domain",
})
ACTIONS = ("approve", "reject", "escalate", "review_manually")
_TOKEN = re.compile(r"[A-Za-z0-9_.\-]{1,40}")


def facts(item: dict[str, Any]) -> list[str]:
    """Prompt lines from queue metadata only: numbers, and short code-like tokens for allowlisted keys."""
    from api.utils.pii_fields import sanitise_for_prompt

    parts = [
        f"Item type: {item['item_type']}",
        f"Domain: {sanitise_for_prompt('domain', item['domain'])}",
        f"Priority: {item['priority']}",
        f"Status: {item['status']}",
    ]
    if item.get("sla_hours"):
        parts.append(f"SLA hours: {item['sla_hours']}")
    meta = item.get("source_metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            numeric = isinstance(v, (int, float)) and not isinstance(v, bool)
            if k in PROMPT_META_KEYS and (numeric or (isinstance(v, str) and _TOKEN.fullmatch(v))):
                parts.append(f"{k}: {sanitise_for_prompt(k, v)}")
    return parts


def _build_triage_prompt(item: dict[str, Any]) -> str:
    """Build a concise triage prompt from allowlisted queue metadata only: no raw data, no free text."""
    return (
        "You are a data stewardship AI assistant for SAP master data quality.\n"
        "Given the following stewardship queue item, choose one recommendation "
        "(approve, reject, escalate, or review_manually) and a confidence.\n\n"
        "Item details:\n" + "\n".join(facts(item)) + "\n\n"
        "Respond in JSON format: {\"recommendation\": \"...\", \"confidence\": 0.0-1.0}"
    )


def verify(data: object) -> dict:
    """Prove a model triage answer. Deterministic.

    ACTION_ALLOWED         recommendation is one of approve, reject, escalate, review_manually
    CONFIDENCE_IN_RANGE    confidence is a number from 0 to 1 (rejected, not clamped)
    The stored text is written by the server; the model's justification is never kept."""
    d = data if isinstance(data, dict) else {}
    conf = d.get("confidence")
    checks = [
        {"code": "ACTION_ALLOWED", "passed": d.get("recommendation") in ACTIONS},
        {"code": "CONFIDENCE_IN_RANGE",
         "passed": isinstance(conf, (int, float)) and not isinstance(conf, bool) and 0 <= conf <= 1},
    ]
    return {"verified": all(c["passed"] for c in checks), "checks": checks}


def _call_llm(prompt: str, tenant_id: str) -> tuple[str, float]:
    """Call the LLM and return (recommendation_text, confidence).

    Falls back to a safe default if the LLM is unavailable.
    """
    from api.utils.llm_logger import log_llm_call

    start_ms = time.time()
    try:
        from llm.provider import get_llm, safe_invoke

        llm = get_llm()
        # Enforce the 800-token output cap documented in the module header.
        response = safe_invoke(llm, prompt, timeout_seconds=35, max_tokens=MAX_TOKENS)
        if response is None:
            logger.warning("Triage LLM timeout — falling back to review_manually")
            return "review_manually", 0.0
        latency_ms = int((time.time() - start_ms) * 1000)
        content = response if isinstance(response, str) else (
            response.content if hasattr(response, "content") else str(response)
        )
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
    """Parse the LLM JSON response into (recommendation, confidence). A failed verify gives review_manually, 0.0."""
    try:
        start = content.find("{")
        end = content.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(content[start:end])
            if verify(data)["verified"]:
                return f"{data['recommendation']}: AI-assisted triage suggestion, verified", float(data["confidence"])
    except (json.JSONDecodeError, ValueError, TypeError):
        pass
    return "review_manually", 0.0


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

                        # Deterministic SAP-aware triage first; LLM only for the
                        # genuinely uncertain band (and only when enabled).
                        det = deterministic_triage(item)
                        if det is not None:
                            recommendation, confidence = det
                        elif _llm_enabled():
                            prompt = _build_triage_prompt(item)
                            recommendation, confidence = _call_llm(prompt, tid)
                        else:
                            recommendation, confidence = "review_manually", 0.3

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
