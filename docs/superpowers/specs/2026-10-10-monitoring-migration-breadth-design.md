# Design: monitoring, migration readiness, platform breadth (origin/main b8768694)

Sizes: S = 1-3 days, M = 1-2 weeks, L = 3+ weeks.

## 1. Continuous monitoring (S). About 80% exists.

### Exists
- Scheduling
  - Per-object cron schedules live in the `sync_profiles` table (011).
  - Chain: `sync_profile_scheduler` (5 min, workers/scheduler.py:864), then `run_sync`, then `run_checks`.
  - UI: systems/[systemId]/schedules-panel.tsx.
- Trend
  - API: GET /systems/{id}/trends (api/routes/system_objects.py:177).
  - Frontend client getTrends (frontend/lib/api/system-objects.ts:49-123) has no caller.
  - Component: design/charts/Sparkline.
- Regression monitor
  - api/services/monitor.py diffs each run against the pinned baseline.
  - It drafts a fix batch from the diff.
- Alerts
  - Threshold checks, built by threshold_breaches (send_notifications.py:145). These are scoped per system correctly.
  - `alert_channels` table (057): webhook, Slack, Teams, email, with digest modes.
  - API: api/routes/notifications.py:163-185.

### Fix
1. Scope alerts per system in send_notifications.py:
   - Add a `scope` filter to `_completed()`.
   - `_send_immediate_critical` must compare runs of the same system.
   - `send_alert_digest` builds one alert per system. Add `system_name` to the alert.
   - Reason: today it compares against the tenant-wide latest run, which can belong to a different system.
2. daily_analysis (scheduler.py:48):
   - Remove `run_checks.delay` and the stale `dqs_history` insert.
   - Reason: it re-scores old parquet files. Fresh data already comes in through `sync_profiles`.
3. Migration 067 for `dqs_history`:
   - Add a nullable `system_id`.
   - Unique key becomes (tenant, COALESCE(system_id, 'upload'), module, day).
   - Pass `system_id` from run_checks.py:665.
4. UI:
   - systems/[systemId]/trend-panel.tsx, built on getTrends.
   - Alert channels panel in admin/settings, plus POST /alert-channels/{id}/test.
   - /systems list shows next run and a trend arrow.
5. Tests:
   - Per-system digest test.
   - `dqs_history` upsert test on pg.
   - vitest for both new panels.

## 2. Migration cockpit (M). About 60% of the backend exists.

### Exists
- Engine: api/services/migration/engine.py.
  - Gap types and per-record go / conditional / no-go verdicts.
  - Export of load files.
- Worker: workers/tasks/run_migration.py.
- Tables: 044 and 048.
- API: about 20 /migration endpoints, with client frontend/lib/api/migration.ts.
- Readiness grid
  - Service: api/services/insights_readiness.py.
  - Endpoint: /insights/readiness.
  - Built from tenant setting `alert_thresholds.readiness_waves`.
  - Returns 409 when that setting is unset, and no UI can set it.
- S/4 area rollup: GET /findings/s4-readiness (no UI).

### Gaps
- The migration UI was removed in #413.
- "conditional" is shown as no_go (insights_readiness.py:38).
- No wave entity, target date, stage or sign-off.
- No readiness trend.
- No blockers list.

### Build
1. Data model:
   - New table `migration_waves`:
     - Identity: id, tenant_id, name.
     - Systems: source_system_id, target_system_id.
     - Scope and plan: modules[], target_date, stage (plan/mock1/mock2/dress/cutover).
     - Thresholds: min_readiness (default 95), min_dqs.
     - Sign-off: signed_off_by, signed_off_at.
     - Row-level security, same as migration 043.
   - Add `migration_runs.wave_id`.
   - Copy any existing `readiness_waves` settings into rows.
2. Readiness grid (insights_readiness.py):
   - Group by wave.
   - Map conditional to `at_risk`.
   - Add `score` and `records_blocked` to each cell.
3. Endpoints:
   - CRUD /migration/waves.
   - POST /migration/waves/{id}/run.
   - GET /migration/waves/{id}/cockpit:
     - Objects, overall verdict, trend from `migration_runs`.
     - Top 20 blockers from `migration_gap_findings`.
     - S/4 areas.
   - POST /migration/waves/{id}/signoff: needs the approve permission and writes the audit log.
4. Auto re-run: when a system's run completes in run_checks, enqueue `run_migration` for each wave sourced from that system. The readiness trend then refreshes on the monitoring schedule.
5. Labels: map modules to business objects (Material, BP customer, BP supplier, GL account, Fixed asset). Put the map in api/services/migration/__init__.py.
6. UI:
   - /migration: wave list, verdict pill, readiness %, sparkline, Run now, create wave.
   - /migration/[waveId] tabs:
     - Objects.
     - Blockers: drill into findings; Create fix batch.
     - Mapping: field-map and value-map editors.
     - S/4 areas.
     - Downloads.
   - nav.ts: "Migration" points to /migration.
7. Tests:
   - pytest: grid, cockpit SQL on pg, wave CRUD with row-level security.
   - vitest.
   - e2e: migration-cockpit.

## 3. Breadth

### 3a. Match pipeline (M)
- Problems today:
  - cleaning_engine fuzzy matching only runs on `df.head(500)` (line 210).
  - mining/dedup.py blocks on the primary key.
  - match_engine is only called by /match-rules/simulate.
  - Result: `match_scores` holds seed data only, so the steward merge queue is empty on real data.
- Build:
  1. New workers/tasks/run_match.py, fanned out from run_checks next to run_dedup (run_checks.py:828).
  2. Blocking:
     - Extract a shared `blocks()` helper from checks/types/similarity_check.py.
     - Business partners: name key plus country and postcode.
     - Materials: name key plus material group and type.
     - `max_block` cap. Skipped records are reported, never counted as passes.
  3. Scoring: `match_engine.score_candidate_pair(dry_run=False)`, which persists `match_scores`.
  4. Respect `mdm_pair_constraints` (merge_explain.drop_blocked_pairs).
  5. Remove both old dedup paths:
    - the `head(500)` loop in cleaning_engine
    - primary-key blocking in mining/dedup.py
  6. Defer cross-system matching.
- Tests:
  - New tests/test_match_pipeline.py: 10k synthetic rows with planted duplicates.
  - Update test_dedup_blocking.py.

### 3b. Ownership and rule lineage (S)
- New table `data_owners`:
  - Columns: tenant_id, kind (object/rule/system), ref, owner_user_id, steward_user_id.
  - Unique on (tenant_id, kind, ref).
  - Field ownership stays in the glossary.
- API:
  - GET and PUT /owners in api/routes/glossary.py.
  - Triage auto-assign order:
    1. rule owner
    2. object owner
    3. glossary steward
    4. fallback
- GET /lineage/rule/{check_id} returns fields, targets, tables, joins, glossary terms and owners.
  - Fields and targets: rule_columns and target_columns (checks/runner.py:195-202).
  - Joins: joins.yaml.
- UI:
  - Lineage and ownership section on rules/[ruleId].
  - Owner picker on objects/[object].
- Also check that /search covers glossary terms and rules.
- Candidate deletion: legacy api/services/lineage_service.py, used by contracts.py.

### 3c. Scale (L), evidence-gated
- Today: whole tables load into pandas. The practical limit is about 10-30M rows on a 64Gi worker.
- Build:
  1. Shard row-local rules by a hash of the anchor key once a table passes SHARD_ROWS (default 5M):
     - Run shards as a Celery chord.
     - Merge additive CheckResults.
  2. Use DuckDB over parquet for whole-dataset rule types: uniqueness, aggregate, group_sum, balance.
     - DuckDB is a new dependency.
     - Similarity and hierarchy run per block.
     - Rule types with no SQL translation run on a sample and are labelled as sampled.
  3. Write extraction output in chunks with ParquetWriter.
  4. Tests:
     - Sharded results equal unsharded results.
     - DuckDB results equal pandas results on the golden fixtures.
- Gate: build only after a real >30M-row out-of-memory failure. Until then, raise the worker memory limit.

## Order
1. Monitoring
2. Migration cockpit
3. Match pipeline
4. Ownership and lineage
5. Scale

Not doing:
- MDG change requests that post to SAP. Meridian never posts to SAP.
- A catalog crawler.
- Learned anomaly thresholds.
- Spark.
