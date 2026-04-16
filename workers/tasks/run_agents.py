"""Celery task: run the LangGraph agent pipeline after check engine completes.

Sets RLS context, calls run_graph(), updates findings with remediation text,
and enqueues PDF generation on success.
"""

import asyncio
import json
import logging
import traceback
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.task_progress import (
    STEP_AI_INSIGHTS,
    STEP_BUILD_REPORT,
    STEP_FINALISE,
    TOTAL_STEPS,
    update_task_progress,
)
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.agents")


def _run_async(coro):
    """Run an async function from synchronous Celery context."""
    return asyncio.run(coro)


@celery_app.task(bind=True, name="workers.tasks.run_agents.run_agents",
                 soft_time_limit=900, time_limit=960)
def run_agents(self, version_id: str, tenant_id: str):
    """Execute the full LangGraph agent pipeline."""
    logger.info(f"run_agents started: version_id={version_id}, tenant_id={tenant_id}")

    engine = get_sync_engine()

    # Set status to agents_running
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

        # Idempotency check
        result = session.execute(
            text("SELECT status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if row and row[0] == "agents_complete":
            logger.info(f"Version {version_id} agents already complete, skipping")
            return {"version_id": version_id, "status": "agents_complete"}

        session.execute(
            text("UPDATE analysis_versions SET status = 'agents_running' WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    ai_step_num, ai_step_name = STEP_AI_INSIGHTS
    update_task_progress(
        version_id,
        status="processing",
        current_step=ai_step_name,
        step_number=ai_step_num,
        total_steps=TOTAL_STEPS,
    )

    try:
        from agents.orchestrator import run_graph

        final_state = _run_async(run_graph(version_id, tenant_id))

        if final_state.get("error"):
            logger.error(f"Agent pipeline error: {final_state['error']}")
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                session.execute(
                    text("UPDATE analysis_versions SET status = 'agents_failed' WHERE id = :vid AND tenant_id = :tid"),
                    {"vid": version_id, "tid": tenant_id},
                )
                session.commit()
            update_task_progress(
                version_id,
                status="failed",
                current_step="AI insight generation failed",
                step_number=ai_step_num,
                total_steps=TOTAL_STEPS,
                error=str(final_state["error"]),
            )
            return {"version_id": version_id, "status": "agents_failed", "error": final_state["error"]}

        # AI work done — advance to "Building report"
        build_step_num, build_step_name = STEP_BUILD_REPORT
        update_task_progress(
            version_id,
            current_step=build_step_name,
            step_number=build_step_num,
            total_steps=TOTAL_STEPS,
        )

        # Update findings with remediation text from cross-finding analysis
        remediations = final_state.get("remediations", {})
        logger.info(f"Processing remediation output: {type(remediations)}")

        if remediations and isinstance(remediations, dict):
            effort_estimates = remediations.get("effort_estimates", [])
            fix_sequence = remediations.get("fix_sequence", [])

            # Build per-check_id remediation text from effort estimates and sequencing
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

                total_updated = 0
                for estimate in effort_estimates:
                    check_id = estimate.get("check_id")
                    if not check_id:
                        continue

                    # Build remediation text from cross-finding analysis
                    parts = []
                    complexity = estimate.get("fix_complexity", "")
                    hours = estimate.get("estimated_person_hours", "")
                    basis = estimate.get("estimation_basis", "")
                    if hours:
                        parts.append(f"Estimated effort: {hours} person-hours ({complexity} complexity)")
                    if basis:
                        parts.append(f"Basis: {basis}")

                    # Add sequence position
                    seq = next(
                        (s for s in fix_sequence if s.get("check_id") == check_id),
                        None,
                    )
                    if seq:
                        parts.append(f"Fix priority: #{seq.get('sequence', '?')} — {seq.get('reason', '')}")

                    remediation_text = "\n".join(parts)

                    result = session.execute(
                        text("""
                            UPDATE findings SET remediation_text = :rem_text
                            WHERE version_id = :vid AND tenant_id = :tid AND check_id = :cid
                        """),
                        {
                            "vid": version_id,
                            "tid": tenant_id,
                            "cid": check_id,
                            "rem_text": remediation_text,
                        },
                    )
                    total_updated += result.rowcount

                session.commit()

            logger.info(f"Updated {total_updated} findings with remediation text")

        # Block A — Persist config_matches rows via a single executemany call.
        config_matches = final_state.get("config_matches", [])
        if config_matches:
            cm_rows = [
                {
                    "version_id": version_id,
                    "tenant_id": tenant_id,
                    "module": match.get("module", ""),
                    "check_id": match.get("check_id", ""),
                    "record_key": match.get("record_key"),
                    "field": match.get("field"),
                    "actual_value": str(match.get("actual_value", ""))[:500],
                    "std_rule_expectation": match.get("std_rule_expectation"),
                    "classification": match.get("classification", "ambiguous"),
                    "config_evidence": match.get("config_evidence"),
                    "recommended_action": match.get("recommended_action"),
                    "sap_tcode": match.get("sap_tcode"),
                    "fix_priority": int(match.get("fix_priority", 2)),
                }
                for match in config_matches
            ]
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                session.execute(
                    text("""
                        INSERT INTO config_matches (
                            id, version_id, tenant_id, module, check_id,
                            record_key, field, actual_value, std_rule_expectation,
                            classification, config_evidence, recommended_action,
                            sap_tcode, fix_priority
                        ) VALUES (
                            gen_random_uuid(), :version_id, :tenant_id, :module, :check_id,
                            :record_key, :field, :actual_value, :std_rule_expectation,
                            :classification, :config_evidence, :recommended_action,
                            :sap_tcode, :fix_priority
                        )
                        ON CONFLICT DO NOTHING
                    """),
                    cm_rows,
                )
                session.commit()
            logger.info(f"Persisted {len(config_matches)} config match records for version={version_id}")

        # Block B — Persist config_match_summary and cross-reference fix_priority
        config_match_summary = final_state.get("config_match_summary", {})
        remediations = final_state.get("remediations", {})

        # Cross-reference: if a check_id is in fix_sequence top 3 AND has data_error
        # classifications, upgrade its fix_priority to 1
        if config_matches and remediations:
            fix_sequence = remediations.get("fix_sequence", [])
            urgent_check_ids = {
                s["check_id"] for s in fix_sequence
                if s.get("sequence", 99) <= 3
            }
            if urgent_check_ids:
                with Session(engine) as session:
                    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                    for cid in urgent_check_ids:
                        session.execute(
                            text("""
                                UPDATE config_matches
                                SET fix_priority = 1
                                WHERE version_id = :vid AND tenant_id = :tid
                                  AND check_id = :cid AND classification = 'data_error'
                            """),
                            {"vid": version_id, "tid": tenant_id, "cid": cid}
                        )
                    session.commit()
                logger.info(f"Upgraded fix_priority to 1 for {len(urgent_check_ids)} urgent check IDs")

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("""
                    UPDATE analysis_versions
                    SET config_match_summary = CAST(:summary AS jsonb)
                    WHERE id = :vid AND tenant_id = :tid
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "summary": json.dumps(config_match_summary),
                }
            )
            session.commit()

        # Finalise — flip DB status and mark progress complete.
        final_step_num, final_step_name = STEP_FINALISE
        update_task_progress(
            version_id,
            current_step=final_step_name,
            step_number=final_step_num,
            total_steps=TOTAL_STEPS,
        )

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("UPDATE analysis_versions SET status = 'agents_complete' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
            session.commit()

        update_task_progress(
            version_id,
            status="completed",
            current_step="Analysis complete",
            step_number=final_step_num,
            total_steps=TOTAL_STEPS,
            percent_complete=100,
        )

        # Enqueue PDF generation
        from workers.tasks.generate_pdf import generate_pdf
        generate_pdf.delay(version_id, tenant_id)

        # Enqueue notification check for critical findings
        from workers.tasks.send_notifications import send_notification
        send_notification.delay(version_id, tenant_id, "critical_found")

        logger.info(f"run_agents complete: version_id={version_id}")
        return {"version_id": version_id, "status": "agents_complete"}

    except Exception as e:
        from celery.exceptions import SoftTimeLimitExceeded

        is_timeout = isinstance(e, SoftTimeLimitExceeded)
        if is_timeout:
            logger.warning(f"run_agents timed out for version_id={version_id}")
        else:
            logger.error(f"run_agents failed: {traceback.format_exc()}")

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("UPDATE analysis_versions SET status = 'agents_failed' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
            session.commit()

        # agents_failed maps to "completed" in the frontend — the deterministic
        # report is still valid, so mark progress as completed, not failed.
        final_step_num, final_step_name = STEP_FINALISE
        update_task_progress(
            version_id,
            status="completed",
            current_step="Analysis complete",
            step_number=final_step_num,
            total_steps=TOTAL_STEPS,
            percent_complete=100,
        )

        if is_timeout:
            return {"version_id": version_id, "status": "agents_failed", "error": "Agent pipeline timed out"}
        raise
