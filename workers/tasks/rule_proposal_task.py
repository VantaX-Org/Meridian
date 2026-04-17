"""Rule proposal Celery task — analyses steward corrections and proposes match rules.

Reads ai_feedback_log corrections for a domain, groups by field and correction pattern,
generates up to 10 proposed rules per run via LLM, writes to ai_proposed_rules.
Rate-limited to 10 proposals per weekly run.
Notifies Admin and Steward users that rules await review.
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.rule_proposal_task")


@celery_app.task(bind=True, name="workers.tasks.rule_proposal_task.rule_proposal_task",
                 soft_time_limit=180, time_limit=240)
def rule_proposal_task(self, tenant_id: str, domain: str) -> dict:
    """Analyse recent steward corrections and propose new match rules.

    Args:
        tenant_id: Tenant UUID string
        domain: SAP domain to analyse corrections for

    Returns:
        Dict with status and count of proposals created
    """
    engine = get_sync_engine()

    with Session(engine) as session:
        session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

        # ── Rate limit: skip if 10+ pending proposals exist for this domain ──
        pending_count = session.execute(
            text(
                "SELECT COUNT(*) FROM ai_proposed_rules "
                "WHERE tenant_id = :tid AND domain = :domain "
                "AND status = 'pending' "
                "AND created_at >= now() - interval '7 days'"
            ),
            {"tid": tenant_id, "domain": domain},
        ).scalar() or 0

        if pending_count >= 10:
            logger.info(f"Rate limited: {pending_count} pending proposals for {domain}")
            return {"status": "rate_limited", "proposals_created": 0}

        # ── Load corrections from past 7 days ────────────────────────────────
        corrections = session.execute(
            text(
                "SELECT queue_item_id, ai_recommendation, steward_decision, "
                "correction_reason, created_at "
                "FROM ai_feedback_log "
                "WHERE tenant_id = :tid AND domain = :domain "
                "AND created_at >= now() - interval '7 days' "
                "AND steward_decision != ai_recommendation "
                "ORDER BY created_at DESC"
            ),
            {"tid": tenant_id, "domain": domain},
        ).fetchall()

        if not corrections:
            return {"status": "no_corrections", "proposals_created": 0}

        # ── Group corrections by pattern ─────────────────────────────────────
        correction_summary = _summarise_corrections(corrections)

        # ── Call LLM to propose rules ────────────────────────────────────────
        proposals = _generate_proposals(tenant_id, domain, correction_summary, session)

        if not proposals:
            return {"status": "no_proposals", "proposals_created": 0}

        # ── Write proposals to ai_proposed_rules ─────────────────────────────
        created = 0
        for proposal in proposals[:10]:  # Cap at 10
            proposal_id = str(uuid.uuid4())
            session.execute(
                text(
                    "INSERT INTO ai_proposed_rules "
                    "(id, tenant_id, domain, proposed_rule, rationale, "
                    " supporting_correction_count, status) "
                    "VALUES (:id, :tid, :domain, :rule::jsonb, :rationale, :count, 'pending')"
                ),
                {
                    "id": proposal_id,
                    "tid": tenant_id,
                    "domain": domain,
                    "rule": json.dumps(proposal["proposed_rule"]),
                    "rationale": proposal["rationale"],
                    "count": len(corrections),
                },
            )
            created += 1

        session.commit()

        # ── Notify admins and stewards ───────────────────────────────────────
        _notify_reviewers(session, tenant_id, domain, created)

        logger.info(f"Created {created} rule proposals for {domain}")
        return {"status": "completed", "proposals_created": created}


def _summarise_corrections(corrections: list) -> dict:
    """Aggregate correction patterns for the LLM prompt — never raw data."""
    summary = {
        "total_corrections": len(corrections),
        "patterns": {},
    }

    reason_counts: dict[str, int] = {}
    decision_counts: dict[str, int] = {}

    for _, ai_rec, steward_dec, reason, _ in corrections:
        decision_counts[steward_dec] = decision_counts.get(steward_dec, 0) + 1
        if reason:
            # Sanitise reason text before including in summary
            from api.utils.pii_fields import sanitise_for_prompt
            sanitised_reason = sanitise_for_prompt("correction_reason", reason)
            # Group by first 50 chars of sanitised reason to find patterns
            key = sanitised_reason[:50].strip().lower()
            reason_counts[key] = reason_counts.get(key, 0) + 1

    summary["patterns"]["decision_distribution"] = decision_counts
    summary["patterns"]["top_reasons"] = dict(
        sorted(reason_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    )

    return summary


def _generate_proposals(
    tenant_id: str,
    domain: str,
    correction_summary: dict,
    session: Session,
) -> list[dict]:
    """Use LLM to generate match rule proposals from correction patterns."""
    from api.utils.llm_logger import log_llm_call

    # Load existing match rules for context
    existing_rules = session.execute(
        text(
            "SELECT field, match_type, weight, threshold FROM match_rules "
            "WHERE tenant_id = :tid AND domain = :domain AND active = true"
        ),
        {"tid": tenant_id, "domain": domain},
    ).fetchall()

    existing_rules_text = "\n".join(
        f"  - {field}: {match_type} (weight={weight}, threshold={threshold})"
        for field, match_type, weight, threshold in existing_rules
    ) or "  None configured"

    prompt = f"""You are an SAP master data quality expert. Analyse these steward correction patterns
and propose new or improved match rules for the "{domain}" domain.

Current match rules:
{existing_rules_text}

Steward correction summary (past 7 days):
  Total corrections: {correction_summary['total_corrections']}
  Decision distribution: {json.dumps(correction_summary['patterns']['decision_distribution'])}
  Top correction reasons: {json.dumps(correction_summary['patterns']['top_reasons'])}

Based on these patterns, propose up to 10 match rules that would reduce the need
for manual steward intervention. Each rule should specify:
- field: the SAP field name to match on
- match_type: one of exact, fuzzy, phonetic, numeric_range, semantic
- weight: importance 0-100
- threshold: minimum score 0.0-1.0

Respond in JSON format only:
{{"proposals": [
  {{"proposed_rule": {{"field": "...", "match_type": "...", "weight": N, "threshold": N.N}},
    "rationale": "..."}}
]}}"""

    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm

        llm = get_llm().bind(max_tokens=600)
        response = llm.invoke(prompt)
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response.content if hasattr(response, "content") else str(response)

        token_count = getattr(response, "usage_metadata", {})
        total_tokens = 0
        if isinstance(token_count, dict):
            total_tokens = token_count.get("total_tokens", 0)

        log_llm_call(
            tenant_id=tenant_id,
            service_name="rule_proposal_task",
            prompt=prompt,
            model_version=getattr(llm, "model", "unknown"),
            token_count=total_tokens,
            latency_ms=elapsed_ms,
            success=True,
        )

        # Parse response
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()

        result = json.loads(cleaned)
        proposals = result.get("proposals", [])

        # Validate each proposal
        valid = []
        for p in proposals:
            rule = p.get("proposed_rule", {})
            if (
                rule.get("field")
                and rule.get("match_type") in ("exact", "fuzzy", "phonetic", "numeric_range", "semantic")
                and isinstance(rule.get("weight"), (int, float))
                and isinstance(rule.get("threshold"), (int, float))
            ):
                rule["weight"] = max(0, min(100, int(rule["weight"])))
                rule["threshold"] = max(0.0, min(1.0, float(rule["threshold"])))
                valid.append({
                    "proposed_rule": rule,
                    "rationale": str(p.get("rationale", "")),
                })

        return valid

    except Exception as e:
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)
        logger.warning(f"Rule proposal LLM call failed for {domain}: {e}")

        try:
            log_llm_call(
                tenant_id=tenant_id,
                service_name="rule_proposal_task",
                prompt=prompt,
                model_version="unknown",
                token_count=0,
                latency_ms=elapsed_ms,
                success=False,
            )
        except Exception:
            pass

        return []


def _notify_reviewers(session: Session, tenant_id: str, domain: str, count: int) -> None:
    """Notify admin and steward users that new rule proposals await review."""
    from api.services.notifications import create_notification_sync

    # Find all admin and steward users for this tenant
    reviewers = session.execute(
        text(
            "SELECT id FROM users "
            "WHERE tenant_id = :tid AND role IN ('admin', 'steward', 'ai_reviewer') "
            "AND is_active = true"
        ),
        {"tid": tenant_id},
    ).fetchall()

    for (user_id,) in reviewers:
        try:
            create_notification_sync(
                tenant_id=tenant_id,
                user_id=str(user_id),
                type="rule_proposal",
                title=f"{count} new AI-proposed match rules",
                body=f"Domain: {domain}. Review and approve or reject proposed rules in Settings.",
                link="/settings?tab=ai-rules",
                session=session,
            )
        except Exception as e:
            logger.warning(f"Failed to notify user {user_id}: {e}")
