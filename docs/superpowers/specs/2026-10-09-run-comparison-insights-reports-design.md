# Run comparison, insights and scheduled reports

Date: 2026-10-09. Status: approved (three phases, in order). Builds on the frontend redesign (`docs/superpowers/specs/2026-10-08-frontend-redesign-design.md`, PR #413) and ships as one PR per phase.

## 1. Why

The backend already computes run-over-run comparisons (`GET /api/v1/versions/compare`, `/versions/compare/records`, `/versions/{id}/baseline`, `GET /api/v1/reports/compare.pdf`), forecasts (`/analytics/predictive`), and a set of analytics nobody renders (`/analytics/roi`, `/sprints`, `/bottlenecks`, `/capacity`, `/mdm-health`, `/operational`). The frontend exposes almost none of it: the record-level diff page `runs/[versionId]/vs/[b]` has no inbound link, runs cannot be compared from the list, cleaning batches do not show their before-and-after effect, there is no trend view, and no report is ever sent without a person clicking download.

Two comparison types matter to the customer: the same system over time (run N vs run N-1, or vs a pinned baseline), and before vs after a cleaning batch. Output is in-app, PDF, and a scheduled e-mail digest.

### 1.1 Beyond the market

Informatica Data Quality, SAP Information Steward, Ataccama, Collibra DQ and Syniti all show a score trend line and a list of failed rules per run. None of them answers the three questions a migration lead asks in the weekly meeting. Meridian answers all three, deterministically, with no LLM in the loop:

1. **Why did the score move?** Every comparison decomposes the delta per module into named causes: records fixed by a specific cleaning batch (joined on `remediation_items`), records fixed outside Meridian, new regressions, scope change (rows added or removed), and rules added or removed between the runs. Competitors show two numbers and leave the attribution to a consultant. See 4.4.
2. **Will we be ready by go-live?** The trend page is a burn-down, not a line chart: the user sets a go-live date and target DQS, and the page shows required velocity vs observed velocity per module, the existing `/analytics/predictive` forecast as the projected line, and the date each module crosses the target at current pace. Competitors forecast nothing or forecast a single global number. See 4.2.
3. **What do I do about it?** Every regression list has a `Create fix batch` action that turns the newly failing checks into a cleaning batch in one click (existing `POST /api/v1/remediation/batches`). The digest e-mail carries the same attribution narrative, so the lead reads cause and action, not a score. Competitors stop at the report.

Two further details competitors lack: a deterministic narrative (template sentences generated from the comparison data, identical in-app and in the PDF, so two readers see the same words) and a check-by-run heatmap across N runs so a rule that flaps is visible at a glance instead of only in pairwise diffs.

## 2. Scope

| Phase | Deliverable | Backend change |
|---|---|---|
| 1 | Surface what exists on the new design kit: compare from the run list and run page, pin baseline, check-level deltas, narrative and PDF on the vs page, DQS trend sparkline per system, before-vs-after link per exported batch, `Create fix batch` from newly failing checks | none |
| 2 | Why and when: delta attribution endpoint, multi-run trend endpoint, `/insights/trends` burn-down with go-live target, attribution section on the vs page, insights hub pages for the orphan analytics endpoints | yes (two read-only endpoints) |
| 3 | Scheduled digest: `report_schedules` table, daily beat task that renders and e-mails the PDF, `/admin/reports` page, new `digest` PDF kind carrying the attribution narrative | yes |

Out of scope: cross-system comparison (later phase, noted in 4.4), comparison of runs from different modules, custom report builder, Teams/Slack delivery of the digest (e-mail only), PDF attachment over Microsoft Graph or Resend (link only, see 5.3).

### 2.1 Global constraints

- Every page is built from `@/design` (`frontend/design/index.ts`) on the redesign shell from PR #413. No legacy components, no `components/ui-core`, no raw hex, no `any`. `npm run lint:tokens` allowlist is never extended.
- The redesign (#413) ships first; `feat/run-comparison` branches from `feat/frontend-redesign` and rebases onto `main` once #413 merges.
- All numbers come from the API or from pure functions in `frontend/lib/*`; the narrative is template text, never LLM output.
- Append-only rule ids, root cause for every failure, one PR per phase, opened and not merged.

## 3. Phase 1 — surface what exists

All pages live under `frontend/app/(app)/` and import UI only from `@/design`. API calls go through `frontend/lib/api/versions.ts`, `remediation.ts`, `reports.ts` (existing functions; no signature changes except where a type is missing).

### 3.1 Runs list `runs/page.tsx`

- New column `DQS` (overall score from `dqs_summary`, "—" when null) and a `Compare` action column.
- A row checkbox selects up to two runs; a sticky `BulkBar` ("2 selected · Compare") navigates to `/runs/{newer}/vs/{older}` (newer = later `run_at`). Selection lives in component state, not the URL.
- Above the table: one `Sparkline` per system (max 6 systems, sorted by last run), built from the complete runs of that system (`metadata.system_id`, fallback `upload`), x = `run_at`, y = overall DQS. Clicking a sparkline filters the table to that system via `useUrlState("system")`, which maps to `getVersions({ system_id })`.
- Overall DQS per run: `dqs_summary` is `Record<module, DQSSummary>`; overall = mean of module `dqs` values. A helper `overallDqs(version): number | null` lives in `frontend/lib/runs.ts` and is reused by every phase.

### 3.2 Run detail `runs/[versionId]/page.tsx`

- Header actions:
  - `Compare with previous`: links to `/runs/{id}/vs/{prevId}` where `prevId` is computed client-side from `getVersions({ system_id })` (same scope, `status === "complete"`, `run_at` earlier than this run, newest first). Hidden when no previous run exists.
  - `Compare with baseline`: links to `/runs/{id}/vs/baseline` (the vs page resolves the literal `baseline` by omitting `v1`, so `_resolve_pair` picks the pinned baseline). Shown only when some other run in the same scope has `metadata.baseline === true`.
  - `Pin as baseline` / `Unpin baseline`: calls `pinBaseline(id, pinned)` then invalidates `queryKeys.run("list")` and `queryKeys.run(id)`.
- A `Baseline` pill when `metadata.baseline === true`. `Version.metadata` gains `baseline?: boolean` in `frontend/types/api.ts`.

### 3.3 Diff page `runs/[versionId]/vs/[b]/page.tsx`

- Route param `b` may be a version id or the literal `baseline`. When `baseline`, the page calls `compareRecords(versionId)` and `compareVersions(undefined, versionId)` with v1 omitted (the client already accepts `v1?`); the resolved `v1` returned in the response populates the header.
- New top section, above the existing record diff: per-module cards from `compareVersions` — DQS before, after, delta (signed, coloured by sign, tabular figures), the six dimension deltas as a `Bar`, and two lists `Newly failing` / `Fixed` (check id in `Mono`, severity pill, count). Each list row links to the existing record-level drill (`checkId` state).
- `Download PDF` button: `getComparisonReportUrl(v2, v1?)` in `frontend/lib/api/reports.ts` already returns the URL; open it with `downloadAuthenticated(url, "comparison.pdf")` from `frontend/lib/api/download.ts`.
- `module` URL filter via `useUrlState("module")` is passed to both compare calls.
- Narrative: a pure function `compareNarrative(cmp: VersionComparison, diff: RecordDiff | null): string[]` in `frontend/lib/narrative.ts` returns template sentences rendered as the `ReportPage` narrative, one paragraph per sentence. Sentences, in order, each omitted when its data is empty: overall movement (`DQS moved from 71.2 to 74.8 (+3.6) across 3 modules.`), biggest mover (`material_master improved most (+6.1), driven by validity (+9.0).`), regressions (`2 checks newly fail: MM041 (critical, 1 240 records), MM077 (high, 88 records).`), fixes (`5 checks fixed, 3 410 records resolved.`), checks not comparable (`4 checks did not run cleanly in both runs; their deltas are excluded.`, counting `comparable === false` in the record diff). Numbers use `Intl.NumberFormat("en-ZA")`, one decimal for scores. Phase 3 ports the same sentences to Python for the digest.
- `Create fix batch` on the `Newly failing` list: a `Button` per check row and a bulk one on the section header. It calls a new `createBatch(name, filter)` client in `frontend/lib/api/remediation.ts` (`POST /api/v1/remediation/batches`, body `{ name, filter: { version_id: v2, check_id, module } }`, response `{ id, name, status, item_count }` as the route returns) with the name `Regressions {check_id} {v2 label or date}`; on success toast `Batch created` with a link to `/fix?tab=batches`. Shown only when the user has the `apply` permission (`useRole`). API 400 (`No open issues match this filter.` or the item cap) is shown verbatim in the toast.

### 3.4 Batches tab `fix/batches-tab.tsx`

- For every batch with `status === "exported"`, a `Before vs after` link. v1 = `batch.filter.version_id`; when null, v1 = the `MonitorItem.baseline.id` for the batch's scope (`getMonitor` already returns baseline and latest per scope). v2 = `MonitorItem.latest.id` for that scope. The link is `/runs/{v2}/vs/{v1}?module={batch.filter.module}` when the module filter is set. When no monitor item exists for the scope or `latest.id === v1`, show the link disabled with the tooltip `No run since export`.
- The batch drawer (`BatchDetailBody`) shows the same link under the metadata list.

### 3.5 Navigation

`frontend/lib/nav.ts` entry for `/runs` is relabelled `Runs` (keywords keep `compare history snapshots baseline`), since the page is now the run list with compare, not only comparison. `next.config.ts` needs no change. `PAGE_TITLES` updated to match; `frontend/__tests__/legacy-redirects.test.ts` unaffected.

## 4. Phase 2 — why and when

### 4.0 Backend endpoints (read-only, `api/routes/versions.py`)

**`GET /api/v1/versions/compare/attribution?v1&v2&module?`** decomposes the delta between two runs of the same scope. `_resolve_pair` resolves the pair as the other compare routes do. Response:

```json
{
  "v1": {"id": "...", "run_at": "...", "label": null, "row_count": 120400},
  "v2": {"id": "...", "run_at": "...", "label": null, "row_count": 121000},
  "modules": [
    {
      "module": "material_master",
      "dqs_before": 71.2, "dqs_after": 74.8, "delta": 3.6,
      "resolved_total": 3410, "new_total": 1328,
      "fixed_by_batches": [{"batch_id": "...", "batch_name": "...", "exported_at": "...", "records": 2100}],
      "fixed_elsewhere": 1310,
      "regressions": [{"check_id": "MM041", "severity": "critical", "records": 1240}],
      "scope_change": {"rows_before": 120400, "rows_after": 121000},
      "rules_added": ["MM201"], "rules_removed": []
    }
  ]
}
```

Definitions, all SQL in `api/services/attribution.py` (sync session, reused by the Phase 3 digest):

- `resolved` and `new` record keys per check come from `DIFF_SQL` in `api/services/record_issues.py` (resolved = in v1 not v2; new = in v2 not v1). Checks with `ran_v1 XOR ran_v2` go to `rules_added` / `rules_removed` and are excluded from every count.
- `fixed_by_batches`: resolved keys that match `remediation_items.record_key` and `check_id` for batches of the same scope with `status = 'exported'` and `exported_at` between `v1.run_at` and `v2.run_at`, grouped by batch, each key counted once (first batch by `exported_at`). `fixed_elsewhere = resolved_total - sum(fixed_by_batches.records)`.
- `regressions`: `new` per check where the check ran in both runs, sorted by records desc, top 20.
- `scope_change` from `analysis_versions.metadata->>'row_count'` of each run.
- `dqs_before`/`dqs_after` from `dqs_summary[module].dqs`.

**`GET /api/v1/versions/trend?system_id&module?&limit=24`** returns per complete run of the scope, newest last:

```json
{
  "runs": [{"id": "...", "run_at": "...", "label": null, "baseline": false}],
  "modules": [{"module": "material_master", "dqs": [71.2, 72.0, 74.8], "dimensions": {"completeness": [..], "accuracy": [..], "consistency": [..], "timeliness": [..], "uniqueness": [..], "validity": [..]}}],
  "checks": [{"check_id": "MM041", "module": "material_master", "severity": "critical", "affected": [0, 12, 1240]}]
}
```

`dqs` and `dimensions` come from `dqs_summary`; `checks.affected` from `findings.affected_count` per version (null when the check did not run in that version). `checks` is limited to the 60 checks with the highest max affected count across the window. `limit` caps the number of runs (max 60).

Both endpoints: tenant RLS as every other route, 404 when the scope has fewer than two complete runs (attribution) or none (trend), Pydantic response models, pytest with Postgres (skips without `MERIDIAN_TEST_DB_URL`).

Later phase (out of scope now): cross-system attribution comparing two scopes on the same module.

### 4.1 Typed clients `frontend/lib/api/analytics.ts`

Add functions, one per orphan endpoint, with response interfaces copied field-for-field from the Pydantic models in `api/routes/analytics.py` (the implementer reads the route file; the spec does not restate the fields):

- `getRoi()` → `GET /api/v1/analytics/roi`
- `getSprints()` → `GET /api/v1/analytics/sprints`
- `getBottlenecks()` → `GET /api/v1/analytics/bottlenecks`
- `getCapacity()` → `GET /api/v1/analytics/capacity`
- `getMdmHealth()` → `GET /api/v1/analytics/mdm-health`
- `getOperational()` → `GET /api/v1/analytics/operational`
- `getModuleForecast(moduleId)` → `GET /api/v1/analytics/forecast/{module_id}`

Query keys under `queryKeys.analytics(kind, ...args)` in `frontend/lib/query-keys.ts` (add if missing).

### 4.2 Pages

| Route | Template | Content |
|---|---|---|
| `/insights/trends` | `ReportPage` | Burn-down for one system (`useUrlState("system")`, default = system with the latest run). Data from `getVersionTrend(systemId, module?, limit)` (new client in `versions.ts` for 4.0). Filters via `useUrlState`: `module` (default `all` = mean of modules), `range` (`30d` default, `90d`, `1y`, `all`), `goal` (target DQS, default `90`), `target` (go-live date ISO, default empty). `Line` chart: observed DQS per run, the `/analytics/predictive` forecast for the module as a second series, a horizontal goal line, and a vertical go-live marker when `target` is set. `Stat`s above the chart: current DQS, observed velocity (points per week over the range, least-squares slope from `frontend/lib/trend.ts: slope(points)`), required velocity (`(goal - current) / weeks to target`, `—` without a target), projected crossing date (`current + slope × weeks`, `Never at current pace` when slope ≤ 0 and current < goal) with a `Pill` go / at-risk / no-go (go: projected ≤ target; at-risk: projected within 30 days after target; no-go otherwise). Below: `Heatmap` rows = checks (top 60 from the trend endpoint), cols = run dates, cell = affected count; click opens `/runs/{id}` filtered to the check. A per-dimension delta table last run vs first run in range. |
| `/insights/roi` | `ReportPage` | `getRoi()`: headline numbers as `Stat`s, a `Waterfall` of cost avoided by module, a table per module. |
| `/insights/capacity` | `ReportPage` | `getSprints()`, `getBottlenecks()`, `getCapacity()`: three sections with tabs via the `Tabs` primitive and `useUrlState("tab", "sprints")`. |
| `/insights/mdm-health` | `ReportPage` | `getMdmHealth()`: `Stat`s plus a `Radar` across the health axes the endpoint returns. |
| `/home/lead` | existing | A new `Operational` section with `getOperational()` KPIs rendered as `Stat`s. |

`insights/page.tsx` adds tiles for `trends`, `roi`, `capacity`, `mdm-health` to the `tiles` array (metric: "—" until loaded, then one headline number each). `nav.ts` Insights group gains `/insights/trends` (icon `TrendingUp`); the other three are reachable from the landing only (keeps the rail short).

### 4.4 Attribution on the vs page

`runs/[versionId]/vs/[b]/page.tsx` gains a `Why the score moved` section between the module cards and the record diff, from `getAttribution(v2, v1?, module?)` (new client in `versions.ts`). Per module a `Waterfall`: before, `+ fixed by batches` (one bar per batch, label = batch name, click opens `/fix?tab=batches&batch={id}`), `+ fixed elsewhere`, `− regressions`, `scope change` (grey, informational), after. Beside it a list of `rules_added` / `rules_removed` in `Mono`. The narrative from 3.3 gains two sentences from this data: `Batch "Q3 vendors" fixed 2 100 records; 1 310 more were fixed outside Meridian.` and `Scope grew by 600 rows.` (omitted when zero).

### 4.3 Empty and error states

Every page uses `ReportPage` `state` with `EmptyState` (`No complete runs for this system yet.`) and `ErrorState` with retry, matching `runs/page.tsx`.

## 5. Phase 3 — scheduled digest

### 5.1 Data

Table `report_schedules` (migration `067_report_schedules.py`, `down_revision = "066"`), SQLAlchemy model `ReportSchedule` in `db/schema.py`, RLS policy like every other tenant table:

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK tenants | RLS |
| system_id | UUID nullable | null = all systems (one e-mail, one section per system) |
| report_type | text | `executive` \| `compare` \| `digest` |
| cadence | text | `weekly` \| `monthly` |
| day | int | weekly: 0–6 (Monday = 0); monthly: 1–28 |
| recipients | JSONB text[] | validated e-mail addresses, 1–20 |
| enabled | bool default true | |
| last_sent_at | timestamptz nullable | idempotency |
| created_by | UUID nullable | |
| created_at / updated_at | timestamptz | |

### 5.2 API `api/routes/report_schedules.py`

Permission `manage_settings`. All queries include `tenant_id` and set `app.tenant_id`.

- `GET /api/v1/report-schedules` → list
- `POST /api/v1/report-schedules` → create (Pydantic body validates enum values, day ranges, e-mail format, 1–20 recipients)
- `PATCH /api/v1/report-schedules/{id}` → partial update (same validation)
- `DELETE /api/v1/report-schedules/{id}`
- `POST /api/v1/report-schedules/{id}/send` → enqueue `workers.tasks.send_report_schedules.send_one.delay(schedule_id, tenant_id)` and return 202

Registered in `api/main.py`.

### 5.3 Worker `workers/tasks/send_report_schedules.py`

- `send_report_schedules()` beat task, daily at 05:00 UTC (`workers/scheduler.py` `beat_schedule` entry `report-schedules-daily-05am`), `soft_time_limit=1500`, `time_limit=1800`. For each tenant (same `_get_tenants` / `_set_rls` pattern as `daily_digest`), select enabled schedules where `due(schedule, today)` and `last_sent_at` is null or before today's due instant; call `send_one`.
- `due(schedule, today: date) -> bool`: weekly → `today.weekday() == day`; monthly → `today.day == day`. Pure function, unit-tested.
- `send_one(schedule_id, tenant_id)` Celery task: resolve the system scope list (one scope, or every scope with a complete run when `system_id` is null); for each scope find `v2` = latest complete run, `v1` = pinned baseline else previous complete run (reuse the SQL from `api/routes/versions._resolve_pair`, lifted into `api/services/version_pairs.py:resolve_pair_sync(session, tenant_id, v1, v2)` so both the route and the worker call one function); render the PDF via `api.services.pdf_reports.build(session, tenant_id, kind, vid, vid1)` where kind is `executive`, `comparison`, or `digest`; e-mail each recipient. Update `last_sent_at = now()` only after at least one e-mail was delivered. Idempotent: a second call on the same day with `last_sent_at` already today is a no-op.
- E-mail: `_deliver_email(recipient, subject, body, attachments=None)` in `workers/tasks/send_notifications.py` gains an optional `attachments: list[tuple[str, bytes, str]]` (filename, content, mime). `_send_email_smtp` attaches them as `MIMEApplication`. Microsoft Graph and Resend paths ignore attachments and the body then includes the download link (`{APP_URL}/api/v1/reports/compare.pdf?v2=…&v1=…` or `/reports/executive.pdf`). Body is plain text: subject line, per-system DQS before/after/delta, top three newly failing checks, open critical count, link.
- `digest` kind in `api/services/pdf_reports.py`: one page per system — latest run vs previous (DQS, dimension deltas), the attribution narrative from `api/services/narrative.py` (Python twin of `frontend/lib/narrative.ts`, same sentences in the same order, fed by `api/services/attribution.py`), top five movers (checks by absolute change in failing count), regressions with the count of records, open critical findings (top ten by failing count). The plain-text e-mail body carries the same narrative sentences. No new SQL beyond the critical-findings query.

### 5.4 Admin page `frontend/app/(app)/admin/reports/page.tsx`

- Typed client `frontend/lib/api/report-schedules.ts` (`listSchedules`, `createSchedule`, `updateSchedule`, `deleteSchedule`, `sendNow`).
- `DataTable` of schedules (report type, system, cadence + day, recipients count, enabled pill, last sent, actions). A `Drawer` form for create/edit using the `Input`, `Select`, `Switch` primitives; native `<input type="email">` per recipient row. Actions: pause/resume (`enabled` toggle), send now (toast `Sending…`, then `Queued`), delete (confirm `Dialog`).
- `nav.ts` `SETTINGS_ITEMS` gains `{ href: "/admin/reports", label: "Scheduled reports", anyOf: ["manage_settings"] }`.

## 6. Error handling

- Frontend: every query surfaces `ErrorState` with retry; mutations show the API error via the existing toast helper. `pinBaseline` failure leaves the UI unchanged.
- Backend: validation errors 422 with field names; unknown schedule 404; `send_one` logs and continues on a failing scope so one bad system does not block the others; e-mail delivery failures are logged per recipient and do not raise.

## 7. Testing

- Frontend: vitest per new or changed page under the page's `__tests__/` folder, mocking `@/lib/api/*` with the `vi.mock(..., importActual)` pattern from `fix/__tests__/page.test.tsx`. Each test covers: loading skeleton, empty, error + retry, and the primary interaction (compare selection navigates; pin baseline calls `pinBaseline`; before-vs-after link href; create fix batch posts the filter; trends range and goal in URL; schedule create submits the right body). Pure functions (`overallDqs`, `compareNarrative`, `slope`, burn-down status) get table-driven unit tests in `frontend/__tests__/`.
- Backend: pytest for the attribution service (fixture: two versions, finding_records, one exported batch; asserts fixed-by-batch vs elsewhere split, rules_added exclusion), the trend endpoint shape, the Python narrative equal to the fixture sentences, `due()`, `resolve_pair_sync` (Postgres test, skips without `MERIDIAN_TEST_DB_URL`, runs `alembic upgrade head` like `tests/test_exception_rules_pg.py`), the schedules API (create/validate/list/send 202), `send_one` idempotency with the mailer mocked, and `tests/test_task_registration.py` still green with the new beat entry.
- Gates per commit: `npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run` from `frontend/`; `python3 -m pytest -q -p no:cacheprovider` on touched test files.

## 8. Delivery

Branch `feat/run-comparison` from `feat/frontend-redesign` (rebase onto `main` once #413 merges). One PR per phase, opened not merged. Phase 1 first.
