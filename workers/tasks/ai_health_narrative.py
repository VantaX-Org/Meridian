"""Weekly AI health narrative — generates plain-language explanation of MDM score trends.

Runs every Monday at 06:00 SAST via Celery beat.
Reads the last 8 weeks of mdm_metrics snapshots (metric names and numeric values only).
Computes linear-regression trend lines per metric.
Calls LLM with metric names, trend deltas, and threshold breaches — NO record values, NO PII.
Returns {narrative, projected_score, risk_flags} and writes to mdm_metrics.
Token limit: 1 500 per call.
Creates notification for Admin and Steward users when narrative is ready.
Entire task wrapped in try/except — failure must not prevent weekly metric snapshot.
"""

import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.ai_health_narrative")

SAST = timezone(timedelta(hours=2))


def _set_rls(session: Session, tenant_id: str) -> None:
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})


def _compute_trend(values: list[float]) -> float:
    """Simple linear regression slope over evenly-spaced values."""
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    if denominator == 0:
        return 0.0
    return numerator / denominator


def _build_prompt(metrics_by_week: list[dict], current_score: float) -> str:
    """Build a concise prompt with metric names, trend deltas, and threshold breaches only."""
    metric_keys = [
        "golden_record_coverage_pct",
        "avg_match_confidence",
        "steward_sla_compliance_pct",
        "source_consistency_pct",
        "mdm_health_score",
    ]

    trends: dict[str, float] = {}
    for key in metric_keys:
        values = [w.get(key, 0.0) for w in metrics_by_week]
        trends[key] = round(_compute_trend(values), 4)

    # Threshold breaches
    breaches: list[str] = []
    latest = metrics_by_week[-1] if metrics_by_week else {}
    if latest.get("golden_record_coverage_pct", 1.0) < 0.60:
        breaches.append("golden_record_coverage below 60%")
    if latest.get("steward_sla_compliance_pct", 1.0) < 0.80:
        breaches.append("steward SLA compliance below 80%")
    if latest.get("avg_match_confidence", 1.0) < 0.70:
        breaches.append("average match confidence below 70%")
    if latest.get("source_consistency_pct", 1.0) < 0.75:
        breaches.append("source consistency below 75%")

    prompt = (
        "You are an SAP Master Data Management health analyst. "
        "Given the following weekly MDM metric trends and current values, "
        "write a concise narrative (2 paragraphs max) explaining the score trajectory, "
        "highlight any risks, and project the score 4 weeks ahead.\n\n"
        f"Current MDM Health Score: {current_score:.1f}/100\n"
        f"Weeks of data: {len(metrics_by_week)}\n\n"
        "Weekly trend slopes (positive = improving):\n"
    )
    for key, slope in trends.items():
        direction = "improving" if slope > 0 else "declining" if slope < 0 else "stable"
        prompt += f"  - {key}: {slope:+.4f}/week ({direction})\n"

    if breaches:
        prompt += f"\nThreshold breaches: {', '.join(breaches)}\n"
    else:
        prompt += "\nNo threshold breaches.\n"

    # Latest raw metric values (fractions, not record data)
    prompt += "\nLatest metric values:\n"
    for key in metric_keys:
        prompt += f"  - {key}: {latest.get(key, 0.0):.3f}\n"

    prompt += (
        "\nRespond with ONLY valid JSON: "
        '{"narrative": "...", "projected_score": <float>, "risk_flags": ["...", ...]}\n'
        "Keep the narrative under 200 words. projected_score is the expected MDM Health Score in 4 weeks."
    )
    return prompt


@celery_app.task(name="workers.tasks.ai_health_narrative.generate_health_narrative",
                 soft_time_limit=180, time_limit=240)
def generate_health_narrative() -> None:
    """Weekly task: generate AI health narrative for each tenant."""
    logger.info("ai_health_narrative: starting weekly narrative generation")
    engine = get_sync_engine()

    with Session(engine) as session:
        result = session.execute(text("SELECT id FROM tenants"))
        tenant_ids = [str(r[0]) for r in result.fetchall()]

    for tid in tenant_ids:
        try:
            _generate_for_tenant(engine, tid)
        except Exception as e:
            # Failure must not prevent other tenants or the weekly snapshot
            logger.error(f"  tenant={tid}: ai_health_narrative failed (non-fatal): {e}", exc_info=True)

    logger.info("ai_health_narrative: complete")


def _generate_for_tenant(engine, tenant_id: str) -> None:
    """Generate narrative for a single tenant."""
    with Session(engine) as session:
        _set_rls(session, tenant_id)

        # Load last 8 weeks of weekly mdm_metrics snapshots (aggregate by week)
        result = session.execute(
            text("""
                SELECT
                    date_trunc('week', snapshot_date) as week,
                    AVG(golden_record_coverage_pct) as golden_record_coverage_pct,
                    AVG(avg_match_confidence) as avg_match_confidence,
                    AVG(steward_sla_compliance_pct) as steward_sla_compliance_pct,
                    AVG(source_consistency_pct) as source_consistency_pct,
                    AVG(mdm_health_score) as mdm_health_score
                FROM mdm_metrics
                WHERE tenant_id = :tid
                  AND snapshot_date >= CURRENT_DATE - INTERVAL '56 days'
                  AND domain IS NULL
                GROUP BY date_trunc('week', snapshot_date)
                ORDER BY week ASC
            """),
            {"tid": tenant_id},
        )
        rows = result.fetchall()

        if len(rows) < 2:
            logger.info(f"  tenant={tenant_id}: not enough history for narrative ({len(rows)} weeks)")
            return

        metrics_by_week = [
            {
                "golden_record_coverage_pct": float(r[1] or 0),
                "avg_match_confidence": float(r[2] or 0),
                "steward_sla_compliance_pct": float(r[3] or 0),
                "source_consistency_pct": float(r[4] or 0),
                "mdm_health_score": float(r[5] or 0),
            }
            for r in rows
        ]

        current_score = metrics_by_week[-1]["mdm_health_score"]
        prompt = _build_prompt(metrics_by_week, current_score * 100)

        # Call LLM
        from llm.provider import get_llm
        from api.utils.llm_logger import log_llm_call

        llm = get_llm()
        start_ms = time.monotonic()
        try:
            response = llm.invoke(prompt, max_tokens=1500)
            latency_ms = int((time.monotonic() - start_ms) * 1000)

            content = response.content if hasattr(response, "content") else str(response)
            token_count = getattr(response, "usage_metadata", {}).get("total_tokens", 0) if hasattr(response, "usage_metadata") else 0

            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_health_narrative",
                prompt=prompt,
                model_version=str(getattr(llm, "model", "unknown")),
                token_count=token_count or len(prompt.split()) + len(content.split()),
                latency_ms=latency_ms,
                success=True,
            )
        except Exception as e:
            latency_ms = int((time.monotonic() - start_ms) * 1000)
            log_llm_call(
                tenant_id=tenant_id,
                service_name="ai_health_narrative",
                prompt=prompt,
                model_version="unknown",
                token_count=0,
                latency_ms=latency_ms,
                success=False,
            )
            logger.warning(f"  tenant={tenant_id}: LLM call failed: {e}")
            return

        # Parse JSON response
        try:
            # Strip markdown code fences if present
            raw = content.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()
            parsed = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"  tenant={tenant_id}: failed to parse LLM response: {e}")
            return

        narrative = parsed.get("narrative", "")[:2000]
        projected_score = float(parsed.get("projected_score", current_score * 100))
        risk_flags = parsed.get("risk_flags", [])
        if not isinstance(risk_flags, list):
            risk_flags = []

        # Write to the most recent mdm_metrics row (domain IS NULL = aggregate)
        session.execute(
            text("""
                UPDATE mdm_metrics
                SET ai_narrative = :narrative,
                    ai_projected_score = :projected,
                    ai_risk_flags = :flags
                WHERE tenant_id = :tid
                  AND domain IS NULL
                  AND snapshot_date = (
                      SELECT MAX(snapshot_date) FROM mdm_metrics
                      WHERE tenant_id = :tid AND domain IS NULL
                  )
            """),
            {
                "tid": tenant_id,
                "narrative": narrative,
                "projected": projected_score,
                "flags": json.dumps(risk_flags),
            },
        )

        # Create notifications for Admin and Steward users
        session.execute(
            text("""
                INSERT INTO notifications (id, tenant_id, user_id, type, title, body, link, created_at)
                SELECT gen_random_uuid(), :tid, u.id, 'digest',
                    'Weekly MDM Health Narrative Ready',
                    :body,
                    '/',
                    now()
                FROM users u
                WHERE u.tenant_id = :tid
                  AND u.is_active = true
                  AND u.role IN ('admin', 'steward')
            """),
            {
                "tid": tenant_id,
                "body": f"AI health narrative generated. MDM Health Score: {current_score * 100:.1f}, "
                        f"Projected: {projected_score:.1f}. "
                        f"{len(risk_flags)} risk flag(s) identified.",
            },
        )

        session.commit()
        logger.info(
            f"  tenant={tenant_id}: narrative written, projected={projected_score:.1f}, "
            f"risks={len(risk_flags)}"
        )
