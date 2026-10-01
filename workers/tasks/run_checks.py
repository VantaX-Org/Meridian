import json
from datetime import datetime, timezone
import logging
import os
import traceback

import yaml

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


def _live_reference_values(engine, tenant_id: str, metadata: dict) -> dict[str, set[str]]:
    """``TABLE.FIELD`` → values from the source system's live config snapshots.

    Only snapshots with ``source='live'`` count — the SAP-standard baseline is
    already what the rule's own ``reference_values`` encode.
    """
    system_id = metadata.get("system_id")
    if not system_id:
        return {}
    out: dict[str, set[str]] = {}
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        rows = session.execute(
            text("SELECT config_table, config_data FROM config_snapshots "
                 "WHERE system_id = :sid AND source = 'live'"),
            {"sid": system_id},
        ).fetchall()
    for table, data in rows:
        for rec in data or []:
            for col, val in rec.items():
                if val not in (None, ""):
                    out.setdefault(f"{table}.{col}", set()).add(str(val).strip())
    return out


def rule_set_fingerprint(modules: list[str], overrides: dict, generated: list[dict] | None = None) -> str:
    """Identifies the rules a run applied (YAML + governance + app version) — trend
    points produced by different rule sets are flagged as not comparable."""
    import hashlib
    from pathlib import Path

    from checks.runner import _find_module_yaml

    h = hashlib.sha256()
    for m in sorted(modules):
        try:
            h.update(Path(_find_module_yaml(m)).read_bytes())
        except FileNotFoundError:
            h.update(m.encode())
    h.update(json.dumps(overrides, sort_keys=True).encode())
    for f in ("checks/rules/value_lexicon.yaml", "sap/dictionaries/populations.yaml"):
        h.update((Path(__file__).resolve().parents[2] / f).read_bytes())
    h.update(json.dumps(generated or [], sort_keys=True).encode())  # config-derived rules change with the config
    version_file = Path("/app/VERSION")
    if version_file.exists():
        h.update(version_file.read_bytes())
    return h.hexdigest()[:16]


# A full extract (e.g. a quarter of BSEG) needs far more than the old 5 minutes.
_CHECKS_LIMIT = int(os.getenv("MERIDIAN_CHECKS_TIME_LIMIT", "1800"))


@celery_app.task(bind=True, name="workers.tasks.run_checks.run_checks",
                 soft_time_limit=_CHECKS_LIMIT, time_limit=_CHECKS_LIMIT + 60)
def run_checks(self, version_id: str, tenant_id: str, parquet_path: str, reanalyse: bool = False):
    """Execute the full check suite against a dataset (``reanalyse``: again, on the same version)."""
    logger.info(f"run_checks started: version_id={version_id}, tenant_id={tenant_id}")

    engine = get_sync_engine()

    with Session(engine) as session:
        # Step 1: Set RLS context
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

        # Check idempotency — if already complete, skip
        result = session.execute(
            text("SELECT status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if row and row[0] == "complete" and not reanalyse:
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
        # Step 3: Load the dataset (extraction bundle or flat upload).
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            meta_row = session.execute(
                text("SELECT metadata FROM analysis_versions WHERE id = :vid"),
                {"vid": version_id},
            ).fetchone()
            tenant_row = session.execute(
                text("SELECT dqs_weights FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)},
            ).fetchone()
            # remember where the dataset lives (migration analysis re-reads it)
            session.execute(
                text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                     "|| jsonb_build_object('dataset_path', CAST(:p AS text)) WHERE id = :vid"),
                {"vid": version_id, "p": parquet_path},
            )
            session.commit()
        metadata = (meta_row[0] if meta_row else None) or {}
        modules = metadata.get("modules", [])
        tenant_weights = (tenant_row[0] if tenant_row else None) or {}

        from api.services.source_design import dictionary_for
        from workers.dataset import load_dataset

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            # source system's own DDIC (live snapshot) over the SAP-standard bundle
            dictionary = dictionary_for(session, metadata.get("system_id"))
            # rules generated from this system's own field-status customizing
            from checks.field_status_rules import extra_fields, load_config, material_fields
            from sap.field_status_config import conversion_maps, resolve_all, resolve_material
            fs_config = load_config(session, metadata.get("system_id"))
            fs_resolutions = resolve_all(fs_config)
            fs_material = resolve_material(fs_config, dictionary)
        fs_extra = {**extra_fields(fs_resolutions)}
        for t, fs in material_fields(fs_material).items():
            fs_extra[t] = fs_extra.get(t, set()) | fs
        frames, df, row_count, col_count = load_dataset(
            parquet_path, dictionary, modules, extra={f"{t}.{f}" for t, fs in fs_extra.items() for f in fs},
            conversions=conversion_maps(fs_config))

        logger.info(f"Loaded DataFrame: {row_count} rows, {col_count} columns")

        # Records per module = rows of the module's anchor table (flat upload: all rows).
        from checks.frames import _graph
        anchors = _graph()[1]
        module_rows = {m: (len(frames.frames[anchors[m]]) if anchors.get(m) in frames.frames else row_count)
                       for m in modules}
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                                 "|| jsonb_build_object('module_rows', CAST(:mr AS jsonb)) WHERE id = :vid"),
                            {"mr": json.dumps(module_rows), "vid": version_id})
            session.commit()

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

        # Step 6: Run checks for each module
        from checks.runner import run_checks as execute_checks

        all_results = []
        live_refs = _live_reference_values(engine, tenant_id, metadata)
        from checks.overrides import load_overrides
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            rule_overrides = load_overrides(session)
            from checks.field_status_rules import generate, generate_material
            fs_rules = generate(fs_resolutions, modules)
            material_rules = generate_material(fs_material, modules)
            session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                                 "|| jsonb_build_object('field_status', CAST(:fs AS jsonb)) WHERE id = :vid"),
                            {"vid": version_id, "fs": json.dumps([
                                {"segment": r.segment.id, "definition": r.fauna, "reason": r.reason,
                                 "account_groups": len(r.groups),
                                 "rules": sum(1 for x in fs_rules if x["grain"] == r.segment.record_table)}
                                for r in fs_resolutions] + ([
                                {"segment": "material_master", "definition": "T130A/T130F",
                                 "reason": "" if fs_material else "material field selection not read from the system",
                                 "account_groups": len({g for v in fs_material.values() for g in v}),
                                 "rules": len(material_rules)}] if "material_master" in modules else []))})
            session.commit()
            fs_rules = fs_rules + material_rules
            from checks.field_status_rules import suppressed_fields
            fs_suppressed = suppressed_fields(fs_resolutions, fs_material)
        # misplaced values, placeholders, swaps, dead-in-text records (checks/value_placement.py)
        from checks import value_placement
        from checks.runner import _find_module_yaml
        vp_rules = []
        for m in modules:
            try:
                static = yaml.safe_load(_find_module_yaml(m).read_text()).get("rules", [])
            except FileNotFoundError:
                continue
            vp_rules += value_placement.generate(m, static, dictionary)
        fs_rules = fs_rules + vp_rules
        module_count = max(len(modules), 1)
        outliers: dict[str, dict] = {}
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
            results = execute_checks(module_name, frames, tenant_id, reference_values=live_refs,
                                     overrides=rule_overrides, extra_rules=fs_rules, suppressed=fs_suppressed)
            all_results.extend(results)
            from checks.outliers import find as find_outliers
            outliers.update(find_outliers(module_name, frames))  # reported, never scored
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

        # Step 6c: Z-table (customer-namespace) rules. The standard rule
        # packs target SAP-delivered tables only; customers with heavy
        # Y*/Z* customisation get validation coverage via this pass. Rules
        # whose fields aren't in the extract skip silently via the runner.
        try:
            from checks.ztables import discover_ztable_rules
            from checks.runner import REGISTRY as CHECK_REGISTRY
            zt_rules = discover_ztable_rules(tenant_id=str(tenant_id))
            if zt_rules:
                logger.info(f"Running {len(zt_rules)} Z-table rule(s)")
                for rule in zt_rules:
                    check_cls = CHECK_REGISTRY.get(rule.get("check_class", ""))
                    if check_cls is None:
                        continue
                    try:
                        from checks.runner import rule_columns
                        built = frames.frame_for(rule_columns(rule), grain=rule.get("grain"))
                        res = check_cls(rule).run(built[0], key_cols=built[2], grain=built[1]) if built else None
                        if res is not None:
                            all_results.append(res)
                    except Exception as e:
                        logger.warning(
                            f"Z-table rule {rule.get('id')} failed: {e}"
                        )
        except Exception as e:
            logger.warning(f"Z-table check pass failed, continuing: {e}")

        # Step 6d: DDIC conformance — every extracted field against the
        # source system's own dictionary definition (type, length, case,
        # fixed values, live check-table values).
        try:
            from checks.ddic_conformance import run_conformance
            from checks.frames import tables_of
            from checks.runner import get_required_columns
            owner: dict[str, str] = {}
            for m in modules:
                try:
                    for t in tables_of(get_required_columns(m)):
                        owner.setdefault(t, m)
                except FileNotFoundError:
                    continue
            table_frames = dict(frames.frames)
            if frames.flat is not None:
                for t in frames.unsplittable:
                    table_frames[t] = frames.flat[[c for c in frames.flat.columns if c.startswith(t + ".")]]
            for table, tdf in table_frames.items():
                keys = [f"{table}.{k}" for k in dictionary.keys(table)]
                all_results.extend(run_conformance(table, tdf, dictionary, owner.get(table, modules[0] if modules else ""),
                                                   keys, live_refs))
        except Exception as e:
            logger.warning(f"DDIC conformance pass failed, continuing: {e}", exc_info=True)

        logger.info(f"Total check results: {len(all_results)}")

        # Step 6d: Root-cause classification against Config Intelligence.
        # Enriches failing findings with bad_data / bad_config / both so
        # the Workbench and Fix Playbook can show the steward WHY the
        # finding exists, not just WHAT failed. No-ops for tenants without
        # a Config Intelligence run.
        try:
            from checks.root_cause import enrich_results_with_root_cause
            enrich_results_with_root_cause(engine, str(tenant_id), all_results)
        except Exception as e:
            logger.warning(f"root_cause enrichment failed, continuing: {e}")

        # Step 7-8: Score all modules
        from api.services.scoring import score_all_modules

        dqs_results = score_all_modules(all_results, tenant_weights)
        dqs_summary = {mod: result.model_dump() for mod, result in dqs_results.items()}

        # Step 9: Insert findings into Postgres via a single executemany call.
        # Previous code looped per row inside batches, which was ~200x slower
        # than a true executemany on 500+ findings.
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

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
                    "details": json.dumps({**(check_result.details or {}),
                                           **({"error": check_result.error} if check_result.error else {})}),
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
                        ON CONFLICT (version_id, check_id, tenant_id) DO UPDATE SET
                            module = EXCLUDED.module, severity = EXCLUDED.severity,
                            dimension = EXCLUDED.dimension, affected_count = EXCLUDED.affected_count,
                            total_count = EXCLUDED.total_count, pass_rate = EXCLUDED.pass_rate,
                            details = EXCLUDED.details, rule_context = EXCLUDED.rule_context,
                            value_fix_map = EXCLUDED.value_fix_map, record_fixes = EXCLUDED.record_fixes
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

            if reanalyse:
                # checks that no longer run (disabled / removed) drop out of this version,
                # unless an exception or write-back record still points at them
                session.execute(text("""
                    DELETE FROM findings f
                     WHERE f.version_id = :vid AND NOT (f.check_id = ANY(:ids))
                       AND NOT EXISTS (SELECT 1 FROM exceptions e WHERE e.linked_finding_id = f.id)
                       AND NOT EXISTS (SELECT 1 FROM writeback_log w WHERE w.finding_id = f.id)
                """), {"vid": version_id, "ids": [r.check_id for r in all_results]})

            # Step 9b: record-level findings + cross-run issue lifecycle
            # (savepoint: a failure here never loses the findings above).
            try:
                from api.services.record_issues import scope_of, track
                with session.begin_nested():
                    stats = track(session, str(tenant_id), str(version_id), scope_of(metadata), all_results, frames)
                logger.info(f"record issues for {version_id}: {stats}")
            except Exception as e:
                logger.error(f"record-level tracking failed for {version_id}: {e}", exc_info=True)

            # Step 10: Update version with DQS summary + which rule set produced it
            analysis = {"at": datetime.now(timezone.utc).isoformat(), "rule_set": rule_set_fingerprint(modules, rule_overrides, fs_rules),
                        "checks": len(all_results)}
            session.execute(
                text("""
                    UPDATE analysis_versions
                    SET status = 'complete', dqs_summary = CAST(:summary AS jsonb),
                        metadata = COALESCE(metadata, '{}'::jsonb)
                            || jsonb_build_object('rule_set', CAST(:rs AS text), 'analysed_at', CAST(:at AS text),
                                                  'field_usage', CAST(:fu AS jsonb), 'outliers', CAST(:ol AS jsonb))
                            || jsonb_build_object('analyses', COALESCE(metadata->'analyses', '[]'::jsonb)
                                                              || jsonb_build_array(CAST(:an AS jsonb)))
                    WHERE id = :vid AND tenant_id = :tid
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "summary": json.dumps(dqs_summary),
                    "rs": analysis["rule_set"], "at": analysis["at"], "an": json.dumps(analysis),
                    "ol": json.dumps(outliers),
                    # a field systematically used for other data (>30 % of ≥20 values): one field-level
                    # finding, not scored — the records are already flagged by its VP- rule
                    "fu": json.dumps([{"field": r.field, "module": r.module, "share": round(r.affected_count / r.total_count, 3),
                                       "detected": (r.details or {}).get("detected", {})}
                                      for r in all_results if r.check_id.startswith("VP-") and r.total_count >= 20
                                      and r.affected_count / r.total_count > 0.3]),
                },
            )
            session.commit()

        # Insert dqs_history records for analytics tracking
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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

        # Data contracts (quality / volume / schema) against this run
        try:
            from workers.tasks.evaluate_contracts import evaluate_contracts
            evaluate_contracts.delay(version_id, tenant_id)
        except Exception as e:
            logger.warning(f"Failed to enqueue evaluate_contracts (non-fatal): {e}")

        # Enqueue exception scan (non-blocking — failure is non-fatal)
        try:
            from workers.tasks.run_exception_scan import run_exception_scan
            run_exception_scan.delay(version_id, tenant_id)
            logger.info(f"Enqueued run_exception_scan for version_id={version_id}")
        except Exception as e:
            logger.warning(f"Failed to enqueue run_exception_scan (non-fatal): {e}")

        # Enqueue mining — dedup / anomaly / relationship (non-blocking).
        # Mirrors the run_cleaning fan-out: each module's mining runs against
        # the same uploaded parquet and writes data_duplicates / data_anomalies
        # / data_relationships, which back the Dedup, Mining and Relationships
        # pages. Previously nothing enqueued these, so those pages stayed empty.
        # Failure is non-fatal — it must never block analysis completion.
        try:
            from workers.tasks.mining.dedup import run_dedup
            from workers.tasks.mining.anomaly import run_anomaly
            from workers.tasks.mining.relationship import run_relationship
            for module_name in modules:
                run_dedup.delay(version_id, tenant_id, module_name, parquet_path)
                run_anomaly.delay(version_id, tenant_id, module_name, parquet_path)
                run_relationship.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(
                f"Enqueued mining (dedup/anomaly/relationship) for "
                f"version_id={version_id}, modules={modules}"
            )
        except Exception as e:
            logger.warning(f"Failed to enqueue mining tasks (non-fatal): {e}")

        # Enqueue golden-record build (non-blocking — failure is non-fatal).
        # Registers the uploaded records as master_records via the existing
        # survivorship engine (golden_record_engine), so the Golden Records
        # workbench reflects real uploaded data. Previously that engine had
        # no caller at all.
        try:
            from workers.tasks.build_golden_records import build_golden_records
            for module_name in modules:
                build_golden_records.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(
                f"Enqueued build_golden_records for version_id={version_id}, "
                f"modules={modules}"
            )
        except Exception as e:
            logger.warning(f"Failed to enqueue build_golden_records (non-fatal): {e}")

        return {"version_id": version_id, "status": "complete", "findings_count": len(all_results)}

    except Exception as e:
        # Step 12: On failure, update status
        logger.error(f"run_checks failed: {traceback.format_exc()}")
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
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
