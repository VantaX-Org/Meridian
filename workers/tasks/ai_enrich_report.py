"""AI Enrichment Worker — adds narrative prose to an existing deterministic report.

Makes 3 focused LLM calls (executive summary, root cause explanations,
strategic recommendations). If this task fails or times out, the report
remains valid and complete.
"""

import json
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.ai_enrich_report")


def _safe_llm_call(llm, system_prompt: str, user_prompt: str) -> str | None:
    """Make a single LLM call with timeout, returning None on any failure."""
    from llm.provider import safe_invoke

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    return safe_invoke(llm, messages, timeout_seconds=60)


@celery_app.task(
    bind=True,
    name="workers.tasks.ai_enrich_report.ai_enrich_report",
    soft_time_limit=300,
    time_limit=360,
)
def ai_enrich_report(self, version_id: str, tenant_id: str):
    """Add AI narrative to an existing deterministic report.

    If this fails or times out, the report remains valid and complete.
    """
    from llm.provider import get_llm_safe

    llm = get_llm_safe()
    if llm is None:
        logger.info("LLM unavailable — skipping AI enrichment")
        return {"status": "skipped", "reason": "llm_unavailable"}

    engine = get_sync_engine()

    # Load existing report
    with Session(engine) as session:
        session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        result = session.execute(
            text("""
                SELECT report_json FROM reports
                WHERE version_id = :vid AND tenant_id = :tid
                ORDER BY generated_at DESC LIMIT 1
            """),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()

    if not row or not row[0]:
        logger.warning(f"No report found for version={version_id} — skipping AI enrichment")
        return {"status": "skipped", "reason": "no_report"}

    report = row[0] if isinstance(row[0], dict) else json.loads(row[0])

    # Update version status to ai_enriching
    with Session(engine) as session:
        session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        session.execute(
            text("""
                UPDATE analysis_versions SET status = 'ai_enriching'
                WHERE id = :vid AND tenant_id = :tid
                  AND status NOT IN ('complete', 'agents_running', 'agents_complete', 'agents_failed')
            """),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    # --- Call 1: Executive Summary ---
    module_scores = report.get("overall_dqs", {}).get("by_module", {})
    overall_status = report.get("migration_readiness", {}).get("overall_status", "unknown")
    critical_count = report.get("findings_by_severity", {}).get("critical", 0)
    ai_summary = _safe_llm_call(
        llm,
        "You are a senior SAP data quality consultant writing for a CIO audience.",
        (
            f"Given these module scores: {json.dumps(module_scores)}, "
            f"{critical_count} critical findings, and overall status '{overall_status}', "
            f"write a 3-sentence executive summary. Focus on business impact, not technical details."
        ),
    )

    # --- Call 2: Root Cause Explanations ---
    root_causes = report.get("root_causes", [])
    ai_root_causes = None
    if root_causes:
        cluster_summaries = [
            {"id": rc["cluster_id"], "cause": rc["root_cause"], "count": rc["finding_count"]}
            for rc in root_causes[:10]
        ]
        ai_root_causes = _safe_llm_call(
            llm,
            "You are a senior SAP data quality consultant.",
            (
                f"Given these root cause clusters: {json.dumps(cluster_summaries)}, "
                f"write a 1-sentence business explanation for each cluster. "
                f"Why did this happen? What business process created this data pattern? "
                f"Return as JSON array of objects with 'cluster_id' and 'explanation' keys."
            ),
        )

    # --- Call 3: Strategic Recommendations ---
    top_remediations = report.get("remediation_plan", {}).get("priority_sequence", [])[:5]
    ai_recommendations = None
    if top_remediations:
        top_5_summary = [
            {"check_id": r.get("check_id"), "severity": r.get("severity"), "affected": r.get("affected_count")}
            for r in top_remediations
        ]
        ai_recommendations = _safe_llm_call(
            llm,
            "You are a senior SAP data governance advisor.",
            (
                f"Given these top 5 data quality issues: {json.dumps(top_5_summary)}, "
                f"write 3 strategic recommendations for the data governance team. "
                f"Focus on process changes that prevent recurrence, not just one-time fixes."
            ),
        )

    # Update report with AI enrichments
    if ai_summary:
        report["ai_executive_summary"] = ai_summary
    if ai_root_causes:
        report["ai_root_cause_explanations"] = ai_root_causes
    if ai_recommendations:
        report["ai_strategic_recommendations"] = ai_recommendations

    if ai_summary or ai_root_causes or ai_recommendations:
        report["generation_method"] = "ai_enriched"

    # Persist updated report
    with Session(engine) as session:
        session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        session.execute(
            text("""
                UPDATE reports SET report_json = CAST(:report AS jsonb)
                WHERE version_id = :vid AND tenant_id = :tid
            """),
            {"vid": version_id, "tid": tenant_id, "report": json.dumps(report)},
        )
        session.execute(
            text("""
                UPDATE analysis_versions SET status = 'ai_enriched'
                WHERE id = :vid AND tenant_id = :tid
                  AND status NOT IN ('complete', 'agents_running', 'agents_complete', 'agents_failed')
            """),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    logger.info(
        f"AI enrichment complete for version={version_id}: "
        f"summary={'yes' if ai_summary else 'no'}, "
        f"root_causes={'yes' if ai_root_causes else 'no'}, "
        f"recommendations={'yes' if ai_recommendations else 'no'}"
    )

    return {"status": "enriched", "version_id": version_id}
