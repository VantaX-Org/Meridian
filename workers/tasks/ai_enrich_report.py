"""AI Enrichment Worker — adds narrative prose to an existing deterministic report.

Makes 3 focused LLM calls (executive summary, root cause explanations,
strategic recommendations). If this task fails or times out, the report
remains valid and complete.
"""

import json
import logging
import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from api.services.prompt_shapes import is_number
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.ai_enrich_report")


# Aletheia rule: the prompts below carry only report aggregates (module scores, counts, check ids, table names);
# no record value, SAP field content or free text from customer data. The answer is proved against those
# aggregates: every number it cites must be one we sent, every cluster id one we offered. Failures are dropped
# and recorded in report["ai_enrichment_rejections"].
MAX_SUMMARY = 900
MAX_EXPLANATION = 400
MAX_RECOMMENDATIONS = 1500
_NUM = re.compile(r"(?<![\w.])\d+(?:\.\d+)?")
_LIST_MARKER = re.compile(r"^\s*(?:[-*]\s*)?\d{1,2}[.)]\s+", re.M)


def _num_forms(x) -> set[str]:
    if not is_number(x):
        return set()
    out = {f"{x:g}", str(int(round(x))), f"{x:.1f}", f"{x:.2f}"}
    return out | {s.rstrip("0").rstrip(".") for s in out if "." in s}


def allowed_numbers(*values) -> set[str]:
    out: set[str] = set()
    for v in values:
        out |= _num_forms(v)
    return out


def unverified_numbers(text_: str, allowed: set[str]) -> list[str]:
    """Numbers in the answer that were not in the input (list markers such as '1.' are ignored)."""
    return [n for n in _NUM.findall(_LIST_MARKER.sub("", text_)) if n not in allowed]


def verify_text(text_: object, allowed: set[str], limit: int, label: str, rejections: list[dict]) -> str | None:
    if not isinstance(text_, str) or not text_.strip():
        rejections.append({"item": label, "reason": "NOT_TEXT"})
        return None
    t = text_.strip()
    if len(t) > limit:
        rejections.append({"item": label, "reason": "TOO_LONG"})
        return None
    bad = unverified_numbers(t, allowed)
    if bad:
        rejections.append({"item": label, "reason": "UNVERIFIED_NUMBER", "numbers": bad[:5]})
        return None
    return t


def verify_root_causes(raw: str | None, clusters: list[dict], rejections: list[dict]) -> str | None:
    """Keep only {cluster_id, explanation} items for a cluster we sent, whose numbers come from that cluster."""
    if not raw:
        return None
    try:
        items = json.loads(re.sub(r"```json|```", "", raw).strip())
    except (ValueError, TypeError):
        rejections.append({"item": "root_causes", "reason": "NOT_JSON"})
        return None
    if not isinstance(items, list):
        rejections.append({"item": "root_causes", "reason": "NOT_A_LIST"})
        return None
    by_id = {c["id"]: c for c in clusters}
    kept, seen = [], set()
    for it in items:
        cid = it.get("cluster_id") if isinstance(it, dict) else None
        if cid not in by_id or cid in seen:
            rejections.append({"item": "root_causes", "reason": "CLUSTER_NOT_OFFERED"})
            continue
        ok = verify_text(it.get("explanation"), allowed_numbers(by_id[cid]["count"]), MAX_EXPLANATION,
                         f"root_cause:{cid}", rejections)
        if ok:
            kept.append({"cluster_id": cid, "explanation": ok})
            seen.add(cid)
    return json.dumps(kept) if kept else None


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
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
    rejections: list[dict] = []
    summary_numbers = allowed_numbers(3, critical_count, *module_scores.values()) if isinstance(module_scores, dict) else set()
    ai_summary = _safe_llm_call(
        llm,
        "You are a senior SAP data quality consultant writing for a CIO audience.",
        (
            f"Given these module scores: {json.dumps(module_scores)}, "
            f"{critical_count} critical findings, and overall status '{overall_status}', "
            f"write a 3-sentence executive summary. Focus on business impact, not technical details."
        ),
    )

    ai_summary = verify_text(ai_summary, summary_numbers, MAX_SUMMARY, "executive_summary", rejections) if ai_summary else None

    # --- Call 2: Root Cause Explanations ---
    root_causes = report.get("root_causes", [])
    ai_root_causes = None
    cluster_summaries: list[dict] = []
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

    ai_root_causes = verify_root_causes(ai_root_causes, cluster_summaries, rejections)

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

    if ai_recommendations:
        rec_numbers = allowed_numbers(3, 5, *(r.get("affected_count") for r in top_remediations))
        ai_recommendations = verify_text(ai_recommendations, rec_numbers, MAX_RECOMMENDATIONS, "recommendations", rejections)

    # Update report with AI enrichments
    if rejections:
        report["ai_enrichment_rejections"] = rejections
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
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
