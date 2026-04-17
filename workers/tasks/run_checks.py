import io
import json
import logging
import traceback

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.task_progress import (
    STEP_FINALISE,
    STEP_RUN_CHECKS,
    TOTAL_STEPS,
    update_task_progress,
)
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker")


def _get_minio_client():
    import os
    from minio import Minio

    return Minio(
        endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
        access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
        secret_key=os.getenv("MINIO_SECRET_KEY", ""),
        secure=False,
    )


@celery_app.task(bind=True, name="workers.tasks.run_checks.run_checks",
                 soft_time_limit=300, time_limit=360)
def run_checks(self, version_id: str, tenant_id: str, parquet_path: str):
    """Execute the full check suite against a dataset."""
    logger.info(f"run_checks started: version_id={version_id}, tenant_id={tenant_id}")

    engine = get_sync_engine()

    with Session(engine) as session:
        # Step 1: Set RLS context
        session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

        # Check idempotency — if already complete, skip
        result = session.execute(
            text("SELECT status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if row and row[0] == "complete":
            logger.info(f"Version {version_id} already complete, skipping")
            return {"version_id": version_id, "status": "complete"}

        # Step 2: Update status to running
        session.execute(
            text("UPDATE analysis_versions SET status = 'running' WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    # Announce "Running data quality checks" as soon as the worker picks up the job.
    check_step_num, check_step_name = STEP_RUN_CHECKS
    update_task_progress(
        version_id,
        status="processing",
        current_step=check_step_name,
        step_number=check_step_num,
        total_steps=TOTAL_STEPS,
    )

    try:
        # Step 3: Download parquet from MinIO
        minio_client = _get_minio_client()
        import os
        bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
        response = minio_client.get_object(bucket, parquet_path)
        parquet_bytes = response.read()
        response.close()
        response.release_conn()

        # Step 4: Load into DataFrame — prune columns to only those referenced
        # by any rule in the modules we're about to check. For large extracts
        # (200+ columns) this can save 70-90% of memory and load time.
        #
        # We need to peek at the parquet schema first because we don't know
        # the modules until we query analysis_versions metadata below, which
        # itself happens after the engine reference is valid. So we load the
        # column list once, then re-read with projection if we have modules.
        parquet_buf = io.BytesIO(parquet_bytes)

        # Query modules first (same SELECT as Step 5 below, hoisted here)
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
            result = session.execute(
                text("SELECT metadata FROM analysis_versions WHERE id = :vid"),
                {"vid": version_id},
            )
            row = result.fetchone()
            metadata = row[0] if row else {}
            modules = metadata.get("modules", [])

        needed_columns: set[str] = set()
        try:
            from checks.runner import get_required_columns
            for mod in modules:
                try:
                    needed_columns.update(get_required_columns(mod))
                except FileNotFoundError:
                    # Unknown module — skip pruning, fall back to full load
                    needed_columns = set()
                    break
        except Exception as e:
            logger.warning(f"Column pruning unavailable, loading full parquet: {e}")
            needed_columns = set()

        all_cols: set[str] | None = None
        if needed_columns:
            # Read only the parquet footer metadata to discover columns
            # (no row data). Fall back silently if pyarrow isn't available.
            try:
                import pyarrow.parquet as pq
                schema = pq.read_schema(parquet_buf)
                parquet_buf.seek(0)
                all_cols = set(schema.names)
            except ImportError:
                all_cols = None

        if needed_columns and all_cols is not None:
            project = [c for c in needed_columns if c in all_cols]
            # Always keep likely identifier columns so sample_failing_records
            # still has a usable id_field in the UI, even if no rule references it.
            for id_candidate in all_cols:
                if id_candidate in project:
                    continue
                up = str(id_candidate).upper()
                if up.endswith(("LIFNR", "MATNR", "PARTNER", "KUNNR", "USERID")):
                    project.append(id_candidate)
            if project:
                df = pd.read_parquet(parquet_buf, columns=project)
            else:
                df = pd.read_parquet(parquet_buf)
        else:
            df = pd.read_parquet(parquet_buf)

        row_count = len(df)
        col_count = len(df.columns)
        logger.info(f"Loaded DataFrame: {row_count} rows, {col_count} columns")

        if row_count > 500_000:
            logger.warning(f"Large dataset detected ({row_count} rows). Analysis may take several minutes.")

        self.update_state(state='PROGRESS', meta={
            'stage': 'loaded',
            'message': f'Loaded {row_count} rows, {col_count} columns',
            'progress': 10,
        })
        update_task_progress(
            version_id,
            current_step=check_step_name,
            step_number=check_step_num,
            total_steps=TOTAL_STEPS,
            rows_processed=0,
            total_rows=row_count,
        )

        # Step 5: modules were loaded above as part of column pruning
        # Step 6: Run checks for each module
        from checks.runner import run_checks as execute_checks

        all_results = []
        module_count = max(len(modules), 1)
        for idx, module_name in enumerate(modules):
            logger.info(f"Running checks for module: {module_name}")
            self.update_state(state='PROGRESS', meta={
                'stage': 'checking',
                'message': f'Running checks for {module_name}',
                'progress': 20 + (idx * 60 // module_count),
            })
            # Interpolate row progress across modules so the bar moves smoothly
            # even for a single-module run with 2000 rows.
            rows_done_before = int((idx / module_count) * row_count)
            update_task_progress(
                version_id,
                current_step=f"{check_step_name} — {module_name}",
                step_number=check_step_num,
                total_steps=TOTAL_STEPS,
                rows_processed=rows_done_before,
                total_rows=row_count,
            )
            results = execute_checks(module_name, df, tenant_id)
            all_results.extend(results)
            # Post-module tick so users see movement between modules.
            rows_done_after = int(((idx + 1) / module_count) * row_count)
            update_task_progress(
                version_id,
                current_step=f"{check_step_name} — {module_name}",
                step_number=check_step_num,
                total_steps=TOTAL_STEPS,
                rows_processed=rows_done_after,
                total_rows=row_count,
            )

        logger.info(f"Total check results: {len(all_results)}")

        # Step 7-8: Score all modules
        from api.services.scoring import score_all_modules

        dqs_results = score_all_modules(all_results)
        dqs_summary = {mod: result.model_dump() for mod, result in dqs_results.items()}

        # Step 9: Insert findings into Postgres via a single executemany call.
        # Previous code looped per row inside batches, which was ~200x slower
        # than a true executemany on 500+ findings.
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

            finding_rows = [
                {
                    "version_id": version_id,
                    "tenant_id": tenant_id,
                    "module": check_result.module,
                    "check_id": check_result.check_id,
                    "severity": check_result.severity,
                    "dimension": check_result.dimension,
                    "affected_count": check_result.affected_count,
                    "total_count": check_result.total_count,
                    "pass_rate": check_result.pass_rate,
                    "details": json.dumps(check_result.details) if check_result.details else "{}",
                    "rule_context": json.dumps(check_result.rule_context) if check_result.rule_context else "{}",
                    "value_fix_map": json.dumps(check_result.value_fix_map) if check_result.value_fix_map else "{}",
                    "record_fixes": json.dumps(check_result.record_fixes) if check_result.record_fixes else "[]",
                }
                for check_result in all_results
            ]

            if finding_rows:
                session.execute(
                    text("""
                        INSERT INTO findings (
                            id, version_id, tenant_id, module, check_id, severity,
                            dimension, affected_count, total_count, pass_rate, details,
                            rule_context, value_fix_map, record_fixes
                        ) VALUES (
                            gen_random_uuid(), :version_id, :tenant_id, :module, :check_id,
                            :severity, :dimension, :affected_count, :total_count, :pass_rate,
                            CAST(:details AS jsonb),
                            CAST(:rule_context AS jsonb),
                            CAST(:value_fix_map AS jsonb),
                            CAST(:record_fixes AS jsonb)
                        )
                        ON CONFLICT (version_id, check_id, tenant_id) DO NOTHING
                    """),
                    finding_rows,
                )

            self.update_state(state='PROGRESS', meta={
                'stage': 'saving',
                'message': f'Saved {len(all_results)} findings',
                'progress': 85,
            })
            # Checks finished + deterministic report ready — mark as completed.
            final_step_num, final_step_name = STEP_FINALISE
            update_task_progress(
                version_id,
                status="completed",
                current_step="Analysis complete",
                step_number=final_step_num,
                total_steps=TOTAL_STEPS,
                rows_processed=row_count,
                total_rows=row_count,
                percent_complete=100,
            )

            # Step 10: Update version with DQS summary
            session.execute(
                text("""
                    UPDATE analysis_versions
                    SET status = 'complete', dqs_summary = CAST(:summary AS jsonb)
                    WHERE id = :vid AND tenant_id = :tid
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "summary": json.dumps(dqs_summary),
                },
            )
            session.commit()

        # Insert dqs_history records for analytics tracking
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
            for module_name in modules:
                mod_summary = dqs_summary.get(module_name, {})
                dims = mod_summary.get("dimension_scores", {})
                mod_findings = [r for r in all_results if r.module == module_name]
                session.execute(
                    text("""
                        INSERT INTO dqs_history (
                            id, tenant_id, module_id, dqs_score,
                            completeness, accuracy, consistency,
                            timeliness, uniqueness, validity,
                            finding_count
                        ) VALUES (
                            gen_random_uuid(), :tenant_id, :module_id, :dqs_score,
                            :completeness, :accuracy, :consistency,
                            :timeliness, :uniqueness, :validity,
                            :finding_count
                        )
                        ON CONFLICT (tenant_id, module_id, ((recorded_at AT TIME ZONE 'UTC')::date)) DO NOTHING
                    """),
                    {
                        "tenant_id": tenant_id,
                        "module_id": module_name,
                        "dqs_score": mod_summary.get("composite_score", 0),
                        "completeness": dims.get("completeness", 0),
                        "accuracy": dims.get("accuracy", 0),
                        "consistency": dims.get("consistency", 0),
                        "timeliness": dims.get("timeliness", 0),
                        "uniqueness": dims.get("uniqueness", 0),
                        "validity": dims.get("validity", 0),
                        "finding_count": len(mod_findings),
                    },
                )
            session.commit()
        logger.info(f"Inserted dqs_history records for {len(modules)} modules")

        # Generate deterministic report immediately (no LLM, <1 second)
        try:
            from api.services.deterministic_report import generate_deterministic_report

            findings_for_report = [
                {
                    "check_id": r.check_id,
                    "module": r.module,
                    "severity": r.severity,
                    "dimension": r.dimension,
                    "affected_count": r.affected_count,
                    "total_count": r.total_count,
                    "pass_rate": r.pass_rate,
                    "message": (r.details or {}).get("message", ""),
                    "field": (r.details or {}).get("field", ""),
                    "check_class": (r.rule_context or {}).get("check_class", ""),
                    "rule_context": r.rule_context or {},
                    "value_fix_map": r.value_fix_map or {},
                }
                for r in all_results
            ]

            report = generate_deterministic_report(
                version_id=version_id,
                tenant_id=tenant_id,
                module_names=modules,
                findings=findings_for_report,
                dqs_scores=dqs_summary,
            )

            with Session(engine) as session:
                session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
                session.execute(
                    text("""
                        INSERT INTO reports (id, version_id, tenant_id, report_json, generated_at)
                        VALUES (gen_random_uuid(), :vid, :tid, CAST(:report AS jsonb), now())
                        ON CONFLICT (version_id, tenant_id) DO UPDATE SET report_json = CAST(:report AS jsonb)
                    """),
                    {"vid": version_id, "tid": tenant_id, "report": json.dumps(report)},
                )
                session.commit()
            logger.info(f"Deterministic report generated for version_id={version_id}")
        except Exception as e:
            logger.warning(f"Deterministic report generation failed (non-fatal): {e}")

        logger.info(f"run_checks complete: version_id={version_id}, findings={len(all_results)}")

        # Create notification for analysis completion
        try:
            from api.services.notifications import create_notification_sync
            with Session(engine) as session:
                session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
                module_list = ", ".join(modules)
                create_notification_sync(
                    tenant_id=tenant_id,
                    user_id=None,
                    type="finding",
                    title=f"New analysis complete: {len(all_results)} findings in {module_list}",
                    body=f"Analysis run finished with {len(all_results)} findings across {len(modules)} module(s).",
                    link=f"/findings?version_id={version_id}",
                    session=session,
                )
                session.commit()
        except Exception as e:
            logger.warning(f"Failed to create analysis notification (non-fatal): {e}")

        # Enqueue agent pipeline (skippable for fast-feedback testing)
        import os
        if os.getenv("SKIP_AGENTS", "").lower() in ("true", "1", "yes"):
            logger.info("SKIP_AGENTS=true — skipping agent pipeline")
        else:
            from workers.tasks.run_agents import run_agents
            run_agents.delay(version_id, tenant_id)
            logger.info(f"Enqueued run_agents for version_id={version_id}")

        # Enqueue background AI enrichment for the deterministic report
        if os.getenv("SKIP_AI_ENRICHMENT", "").lower() not in ("true", "1", "yes"):
            try:
                from workers.tasks.ai_enrich_report import ai_enrich_report
                ai_enrich_report.delay(version_id, tenant_id)
                logger.info(f"Enqueued ai_enrich_report for version_id={version_id}")
            except Exception as e:
                logger.warning(f"Failed to enqueue ai_enrich_report (non-fatal): {e}")
        else:
            logger.info("SKIP_AI_ENRICHMENT=true — skipping AI report enrichment")

        # Enqueue cleaning detection (non-blocking — failure is non-fatal)
        try:
            from workers.tasks.run_cleaning import run_cleaning
            for module_name in modules:
                run_cleaning.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(f"Enqueued run_cleaning for version_id={version_id}, modules={modules}")
        except Exception as e:
            logger.warning(f"Failed to enqueue run_cleaning (non-fatal): {e}")

        # Enqueue exception scan (non-blocking — failure is non-fatal)
        try:
            from workers.tasks.run_exception_scan import run_exception_scan
            run_exception_scan.delay(version_id, tenant_id)
            logger.info(f"Enqueued run_exception_scan for version_id={version_id}")
        except Exception as e:
            logger.warning(f"Failed to enqueue run_exception_scan (non-fatal): {e}")

        return {"version_id": version_id, "status": "complete", "findings_count": len(all_results)}

    except Exception as e:
        # Step 12: On failure, update status
        logger.error(f"run_checks failed: {traceback.format_exc()}")
        with Session(engine) as session:
            session.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
            session.execute(
                text("UPDATE analysis_versions SET status = 'failed' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
            session.commit()
        update_task_progress(
            version_id,
            status="failed",
            current_step="Data quality checks failed",
            step_number=check_step_num,
            total_steps=TOTAL_STEPS,
            error=str(e) or e.__class__.__name__,
        )
        raise
