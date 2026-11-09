# Requirements traceability

This table lists each capability, the code that builds it and the tests that cover it. It lists only files that exist in the repository on 9 November 2026. Paths are relative to the repository root. A name with `*` stands for several files with that prefix.

## Capabilities

### 1. Extraction

- Built in: `sap/rfc.py`, `sap/successfactors.py`, `sap/odp.py`, `sap/extraction_plan.py`, `sap/extraction_registry.py`, `workers/tasks/run_extraction.py`, `api/services/delta_extraction.py`, `api/services/extraction_dry_run.py`.
- Tested by: `tests/test_pyrfc_connector.py`, `test_rfc_logon.py`, `test_rfc_group_join.py`, `test_successfactors_paging.py`, `test_sf_extraction_from_date.py`, `test_extraction_registry_preview.py`, `test_extraction_plan_*.py`, `test_system_extraction_path_pg.py`, `test_extract_store_memory.py`, `test_btp_connector.py`.

### 2. Rules per object

The runner is `checks/runner.py` with `checks/rule_files.py`. The CI job in `unit-tests.yml` also runs `checks.rule_reconciler --strict`. Rule counts below come from parsing the YAML files.

| Object | Rule files | Rules | Tests |
|---|---|---|---|
| Material master | `checks/rules/ecc/material_master.yaml`, `material_master.generated.yaml` | 1,076 | 12 files named `test_mm_*` or `test_material*`, including `test_mm_depth_rules.py` and `test_mm_exhaustive_rules.py` |
| Customer master | `checks/rules/ecc/sd_customer_master*.yaml` | 803 | 6 files named `test_customer_*` |
| SuccessFactors | `checks/rules/successfactors/*.yaml`, without the column map | 1,866 | 15 files named `test_sf_*` or `test_successfactors*` |

### 3. Scoring

- Built in: `api/services/scoring.py`, `receipt_math.py`, `score_delta.py`, `mdm_scoring.py`.
- Tested by: `tests/test_scoring_dimension_aliases.py`, `test_score_delta.py`, `test_dqs_history_pg.py`, `test_dqs_forecast_interval.py`, `test_migration_dest_score.py`.

### 4. Cleansing

- Built in: `api/services/cleaning_engine.py`, `api/routes/cleaning.py`, `workers/tasks/run_cleaning.py`, the Cleansing screen in the frontend.
- Tested by: `tests/test_cleaning_engine.py`, the `test_cleaning_*` files, and the vitest files CleansingDedup, CleansingExport and CleansingProposals.

### 5. Post-clean monitoring

- Built in: `api/services/learned_monitors.py`, `learned_monitors_interim.py`, `object_monitor.py`, `monitor.py`, `api/routes/learned_monitors.py`, `workers/tasks/learned_monitor_interim.py`, and the LearnedMonitors and ObjectMonitors screens.
- Tested by: `tests/test_learned_monitors*.py`, `test_learned_monitor_routes.py`, `test_object_monitor_pg.py`, and the vitest files LearnedMonitors, ObjectMonitors and WorkMonitor.

### 6. Migration target workbooks

- Built in: `api/services/migration/` (`workbook.py`, `workbook_formats.py`, `export.py`, `engine.py`, `cockpit.py`, `dest_score.py`, `load_sim.py`, `post_load.py`, `field_status.py`), `api/routes/migration.py`, `workers/tasks/run_migration.py`, and the Migration and MigrationScenarios screens.
- Tested by: `tests/test_migration_workbook.py`, `test_workbook_learned_fields.py`, `test_target_workbook_pg.py`, `test_sf_workbook_entities.py`, `test_sf_workbook_formats.py`, `test_workbook_formats.py`, the `test_migration_*` files, vitest `Migration.test.tsx`, and the journey [docs/journeys/migration-wave.md](../journeys/migration-wave.md).
- Gap: validation against the customer's real import templates is not yet proven. See the [RAID log](raid-log.md).

### 7. Approvals

- Built in: `api/services/workflow.py`, `change_requests.py`, `api/routes/workflows.py`, `change_requests.py`, `writeback.py`, `golden_writeback.py`, `workers/tasks/workflows.py`, `change_requests.py`, `run_batch_writeback.py`.
- Tested by: the `test_workflow_*_pg.py` files, `test_writeback_approvals_*`, the `test_writeback_*_pg.py` files, `test_change_requests_pg.py`, `test_survivorship_approval_setting.py`, and the journey [docs/journeys/find-fix-approve-send.md](../journeys/find-fix-approve-send.md).

### 8. Reporting

- Built in: `api/routes/reports.py`, `report_library.py`, `api/services/pdf_reports.py`, `report_pdf.py`, `export_engine.py`, `pptx_export.py`, `branded_xlsx.py`, `workers/tasks/generate_pdf.py`, `report_schedules.py`, `send_report_pack.py`, and the Reports screen.
- Tested by: `tests/test_pdf_reports.py`, `test_pdf_reports_pg.py`, `test_pdf_branding.py`, the `test_report_*` files, `test_new_reports.py`, and vitest `Reports.test.tsx`.

### 9. Aletheia insights

- Built in: `api/services/aletheia_engine.py`, `aletheia_found.py`, the `insights_*.py` services, `api/routes/aletheia_engine.py`, `insights.py`, the `aletheia_*.py` routes, the Insights, AletheiaFound, AletheiaEvidence and AletheiaSurvivorship screens, and `frontend/design/v2/admin/engine.tsx`.
- Tested by: `tests/test_aletheia_engine.py`, `test_aletheia_found.py`, `test_aletheia_survivorship.py`, `test_aletheia_actions_route.py`, about 12 `test_insights_*` files, and the vitest files AletheiaEngine, AletheiaFound, AletheiaEvidence, AletheiaSurvivorship and Insights.
- Note: the engine client sends only aggregate metrics (composite, failing_rules, affected_records, critical, high, blockers, auto_fixable_pct). It does not send records.

### 10. Licensing

- Built in: `api/middleware/licence.py`, `api/routes/licence.py`, `cloudflare/licence-worker/`, `scripts/issue_offline_licence.py`, `workers/tasks/revalidate_licence.py`.
- Tested by: `tests/test_licence_edges.py`, `test_licence_enforcement.py`, `test_licence_gating.py`, `test_licence_grace.py`, `test_licence_signing.py`, `test_licence_validate_route.py`, `test_issue_offline_licence.py`, and `cloudflare/licence-worker/src/index.test.ts`.
- Closed: the licence was narrowed to the three licensed modules on 9 November 2026 (RAID D-03).

### 11. Help and training

- Built in: `api/routes/user_guide.py`, `help_videos.py`, `api/services/user_guide.py`, `frontend/docs/guide/`, `frontend/docs/help-videos/` (31 mp4 videos with captions), `docs/admin-training/`, `docs/help-videos.md`, and the workflow `.github/workflows/record-help-videos.yml`.
- Tested by: `tests/test_help_videos.py`, `test_user_guide.py`, vitest `Help.test.tsx`, and the Playwright specs `v2-help.spec.ts` and `guided-tours-v2.spec.ts`.

## Acceptance

Each capability is accepted in the signed-in run of [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md). That run is still to be done. Acceptance results per capability: To confirm (Test lead).
