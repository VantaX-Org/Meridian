"""Rule proposal Celery task — analyses steward corrections and proposes match rules.

Reads ai_feedback_log corrections for a domain, groups by field and correction pattern,
generates up to 10 proposed rules per run via LLM, writes to ai_proposed_rules.
Rate-limited to 10 proposals per weekly run.
Notifies Admin and Steward users that rules await review.
"""

import json
import logging
import re
import time
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

from api.services import app_links

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
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

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
                    "VALUES (:id, :tid, :domain, CAST(:rule AS jsonb), :rationale, :count, 'pending')"
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


_CODE = re.compile(r"[A-Za-z0-9_]{1,20}")


def _summarise_corrections(corrections: list) -> dict:
    """Aggregate correction counts for the LLM prompt. Counts only: steward free text (correction_reason) can
    carry SAP values, so only how many corrections gave a reason is sent, never what it said."""
    decision_counts: dict[str, int] = {}
    with_reason = 0

    for _, _ai_rec, steward_dec, reason, _ in corrections:
        key = steward_dec if isinstance(steward_dec, str) and _CODE.fullmatch(steward_dec) else "other"
        decision_counts[key] = decision_counts.get(key, 0) + 1
        if reason:
            with_reason += 1

    return {
        "total_corrections": len(corrections),
        "patterns": {"decision_distribution": decision_counts, "corrections_with_reason": with_reason},
    }


MATCH_TYPES = ("exact", "fuzzy", "phonetic", "numeric_range", "semantic")


def verify(p: object, known_fields: set[str]) -> dict:
    """Prove one proposed rule before it is stored. Deterministic, grounded in the rule catalogue.

    FIELD_KNOWN             field is a SAP field of the rule catalogue (TABLE.FIELD or its short name) or one
                            already used by an active match rule of the domain
    MATCH_TYPE_ALLOWED      match_type is one of exact, fuzzy, phonetic, numeric_range, semantic
    WEIGHT_IN_RANGE         weight is a number from 0 to 100 (rejected, not clamped)
    THRESHOLD_IN_RANGE      threshold is a number from 0 to 1 (rejected, not clamped)
    The rationale is written by the server; the model's free text is never stored."""
    rule = p.get("proposed_rule") if isinstance(p, dict) else None
    rule = rule if isinstance(rule, dict) else {}

    def num(x, hi):
        return isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= hi

    checks = [
        {"code": "FIELD_KNOWN", "passed": isinstance(rule.get("field"), str) and rule["field"] in known_fields},
        {"code": "MATCH_TYPE_ALLOWED", "passed": rule.get("match_type") in MATCH_TYPES},
        {"code": "WEIGHT_IN_RANGE", "passed": num(rule.get("weight"), 100)},
        {"code": "THRESHOLD_IN_RANGE", "passed": num(rule.get("threshold"), 1)},
    ]
    return {"verified": all(c["passed"] for c in checks), "checks": checks}


def _known_fields(existing_rules: list) -> set[str]:
    from api.services.ai_column_matcher import _load_all_module_fields

    fields = {r[0] for r in existing_rules}
    for module_fields in _load_all_module_fields().values():
        fields |= module_fields | {f.split(".")[-1] for f in module_fields}
    return fields


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
  Corrections with a written reason: {correction_summary['patterns']['corrections_with_reason']} (text not shown)

Based on these patterns, propose up to 10 match rules that would reduce the need
for manual steward intervention. Each rule should specify:
- field: the SAP field name to match on
- match_type: one of exact, fuzzy, phonetic, numeric_range, semantic
- weight: importance 0-100
- threshold: minimum score 0.0-1.0

Respond in JSON format only:
{{"proposals": [
  {{"proposed_rule": {{"field": "...", "match_type": "...", "weight": N, "threshold": N.N}}}}
]}}"""

    start_ms = time.monotonic_ns() // 1_000_000

    try:
        from llm.provider import get_llm, safe_invoke

        llm = get_llm().bind(max_tokens=600)
        response = safe_invoke(llm, prompt, timeout_seconds=45)
        if response is None:
            logger.warning(f"Rule proposal LLM timeout for {domain}")
            return []  # No rules suggested on timeout
        elapsed_ms = int((time.monotonic_ns() // 1_000_000) - start_ms)

        content = response if isinstance(response, str) else (
            response.content if hasattr(response, "content") else str(response)
        )

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

        # Verify each proposal; rationale is server-written
        known = _known_fields(existing_rules)
        n = correction_summary["total_corrections"]
        valid = []
        for p in proposals if isinstance(proposals, list) else []:
            if verify(p, known)["verified"]:
                r = p["proposed_rule"]
                rule = {"field": r["field"], "match_type": r["match_type"],
                        "weight": int(r["weight"]), "threshold": float(r["threshold"])}
                valid.append({
                    "proposed_rule": rule,
                    "rationale": f"Proposed by the model from {n} steward correction(s) in the last 7 days; "
                                 "field, match type, weight and threshold verified",
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


def _notify_reviewers(session: Session, tenant_id: str, domain: str, count: int, *,
                      roles: tuple[str, ...] = ("admin", "steward", "ai_reviewer"),
                      title: str | None = None, body: str | None = None,
                      link: str = app_links.RULE_DRAFTS) -> None:
    """Notify reviewer users (admin/steward/ai_reviewer by default) that items await review."""
    from api.services.notifications import create_notification_sync
    from api.services.rbac import persona_for

    reviewers = session.execute(
        text(
            "SELECT id FROM users "
            "WHERE tenant_id = :tid AND role = ANY(:roles) "
            "AND is_active = true"
        ),
        # users.role holds the persona key now (platform_admin, data_steward, ...): match it as well as the legacy key.
        {"tid": tenant_id, "roles": sorted(set(roles) | {persona_for(r) for r in roles})},
    ).fetchall()

    title = title or f"{count} new AI-proposed match rules"
    body = body or f"Domain: {domain}. Review and approve or reject proposed rules in Settings."

    for (user_id,) in reviewers:
        try:
            create_notification_sync(
                tenant_id=tenant_id,
                user_id=str(user_id),
                type="rule_proposal",
                title=title,
                body=body,
                link=link,
                session=session,
            )
        except Exception as e:
            logger.warning(f"Failed to notify user {user_id}: {e}")
