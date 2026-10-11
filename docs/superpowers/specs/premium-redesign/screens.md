# Meridian screens — insight layer, per-route composition, coverage matrix

Companion to `spec.md` (direction, tokens, primitives, build order) and `rbac.md`. This file holds everything page-level: the insight-first contract every page obeys, the composition of every route, the backend coverage matrix, and the new screens that close the gaps.

Backend facts in this file come from `api/routes/*.py` (73 modules, 397 endpoints) and `db/schema.py` (88 models) in the `dqs-calibration` worktree. Nothing here invents a number: every figure on a screen is a field an endpoint already returns.

---

## 1. The insight contract (applies to every route)

### 1.1 `InsightHeader` — the first thing on every page

New template `design/templates/InsightHeader.tsx`. Rendered above any table, chart or form, directly under the breadcrumb. Four cells, each a sentence, each a `DrillLink`.

| Cell | Question | Data source | Click goes to |
|---|---|---|---|
| **Situation** | What is the situation? | `generate_deterministic_report` summary / `insights/exec.narrative` / page-level aggregate (`findings/aggregate`, `rules/summary`, `mdm-metrics`, `cleaning/metrics`, `exceptions/metrics`, `triage/metrics`, `stewardship/metrics`) | the evidence table on this page, filtered to the stated subset |
| **Changed** | What changed since the last run? | `versions/compare` (newly failing / fixed counts, DQS delta), `scores/history`, `mdm-metrics/history`, `rules/history` | `/runs/[a]/vs/[b]` or the page's own history tab |
| **Why it matters** | Money or process at risk; S/4 readiness | `insights/impact` + `insights/proven-cost` (currency), `config-impact/{version}` (blocked/degraded features), `findings/s4-readiness`, `migration/waves/{id}/cockpit` | `/insights/impact`, `/insights/process`, `/migration/[wave]` |
| **Do next** | What should I do? | `analytics/prescriptive` ranked actions, `simulations` (DQS points gained), `remediation/batches` pending, `cleaning/queue` counts, day-one step from `use-day-one` | the action's screen; the primary `Button` lives here |

Layout: `Card lg`, four columns at ≥ `xl` (`grid-cols-4`, gap 24), two columns at `lg`, stacked below. Cell: label 12/16 `--m-ink-3` ("Situation"), then the sentence 15/20 500 `--m-ink` with the key figure in `m-numeric` 600 and coloured by tone; the drill target shown as a trailing `ArrowUpRight` 14 `--m-accent` on hover. On home only, the Situation cell uses the serif verdict (28/34). Cells with no data render their fresh-install sentence (e.g. "No run yet — the situation appears after the first analysis.") in `--m-ink-3`, never hidden.

Props: `{ situation, changed, why, next: { sentence, href, action?: { label, onClick|href, impact?: string } }, aiSummary?: AiSummaryProps, loading?: boolean }`. Each of the first three: `{ sentence: ReactNode, href?: string, tone?: "neutral"|"go"|"at-risk"|"no-go" }`.

### 1.2 `AiSummary` — the AI layer, labelled

New primitive `design/primitives/AiSummary.tsx`. A collapsible row under the InsightHeader: left a 16px `Sparkles` icon in `--m-accent`, label "AI summary from deterministic findings" 12/16 500 `--m-ink-3`, then the LLM narrative 13/18 `--m-ink-2`. Right: thumbs up/down `IconButton`s → `POST /ai/feedback`. Footer 11/14 `--m-ink-3`: "Generated from {n} findings in run {Mono id}. The model saw aggregates only." When `GET /health/llm` is not ok or the tenant has no provider (`settings/llm`), the row shows the same icon greyed and "AI summary off — showing the deterministic summary" with `_generate_deterministic_summary` text, and a ghost link "Enable in Admin › AI" (admin only). Never blocks the page: renders a 2-line Skeleton while the narrative loads, then swaps.

### 1.3 `ScoreExplainer` — every number explains itself

New primitive `design/primitives/ScoreExplainer.tsx`. Wraps any DQS / dimension / readiness number. Hover (400 ms intent) or click → `Popover` (`m-elev-2`, 360w):

- Header: the score 26/30 `m-numeric` + `ScoreRing 48` + band Pill.
- "How it was computed": six rows dimension · weight (from `settings/scoring`) · dimension score · contribution; bars 4px. Sum row.
- "Caps": "1 Critical finding caps the score at 85 (measured 88.4)" from `findings/config-aware-score` / `findings/aggregate` cap fields; absent when no cap.
- "Rules that moved it most": top 5 by `records_failed × weight` from `findings/aggregate`: Mono check ID, name, pass rate `m-numeric`, `SeverityDot`. Each row a `DrillLink` to `/objects/[obj]?check=…` or the finding drawer.
- Footer link "Open score history" → `scores/history` chart in a Drawer.

Used by: `Counter`, `ScoreRing` (sizes ≥ 48), `Stat` when `explain` prop set, DataTable score cells (click), heatmap cells.

### 1.4 `NextActions` — ranked "do this next" cards

New template `design/templates/NextActions.tsx`. A horizontal rail of up to 5 `Card sm` (min-w 280, snap-scroll). Source: `analytics/prescriptive` (ranked list) merged with `simulations` results (`dqs_after − dqs_before`, `records_fixed`), `config-impact` (`features_unblocked`), `remediation/batches` awaiting approval and `cleaning/queue`. Card: rank badge (1–5, `Badge` neutral), title 13/18 500, impact line 12/16 with up to three impact chips: `+3.2 DQS` (`--m-pass-soft`), `412 records` (neutral), `2 features unblocked` (`--m-accent-soft`). Footer: primary `Button sm` with the verb ("Approve batch", "Open fix sheet", "Run simulation", "Assign owner") and a ghost "Why?" that opens `ScoreExplainer`-style popover showing which findings produce the impact. Empty: one ghost card "Nothing to do yet. Actions appear once a run has findings." Where simulation results are not yet computed, the card shows "Simulate" as the action rather than a guessed number.

### 1.5 Every list

`DataTable` gets, in wave 7: column chooser (`Menu` of columns with checkboxes; persisted per table id in `saved-views` when signed in, `localStorage` otherwise), multi-sort, filter chips bound to URL (`?f.status=open&f.severity=critical`), `ExportMenu` (CSV via client, XLSX/PDF via the route's `/export` endpoint when it exists), saved views (`GET/POST/DELETE /saved-views`: a `Select` of views + "Save view…" Dialog) and density toggle. Any row → detail (page or Drawer). No list ships without these.

### 1.6 Every entity

Has a detail surface (page or Drawer) with the same skeleton: **header** (identifier `Mono`, title, status Pill, actions), **Overview** (all fields, grouped, labels 12 / values 13, with `Mono` for SAP identifiers), **Related** (cross-links to every entity that references it), **History** (trend chart when a history endpoint exists, otherwise the event list), **Audit** (`GET /audit?entity=…` rows, who/when/what), **Export** (`ExportMenu`). Tabs in that order. Nothing is labelled "coming soon"; if a tab's endpoint returns nothing, the tab shows its empty-state sentence.

### 1.7 Finding drill path (≤ 3 clicks from any score)

Score (home / object / run) → **1** `ScoreExplainer` popover → **2** rule row → `FindingDrawer` (rule, field `Mono TABLE.FIELD`, sample records from `versions/{v}/findings/{check}/records`, `root-cause` from `versions/{v}/findings/{check}/root-cause` and `config/root-cause/{finding}`, fix guidance from `findings/{id}/report-context`, Apply/Propose fix) → **3** "Open all failing rows" → `/objects/[obj]?check=…&tab=records` with SAP keys as `Mono` links to `/objects/[obj]/records/[key]`. Three clicks; the FindingDrawer already shows a 20-row sample at click two.

### 1.8 Natural-language palette

`CommandPalette` accepts sentences. A deterministic grammar in `lib/palette-grammar.ts` (no new dependency) parses tokens: object/module names (`objects` list), severities, dimensions, check IDs (`^[A-Z]{2,4}-\d{3}$`), SAP keys (`^\d{6,18}$` or `^[A-Z0-9]{10}$`), systems, "last run", "vs previous", "failing", "blocked", "owner X". Example: "critical material master findings in PRD last run" → `/objects/material_master?severity=critical&system=PRD&run=latest`. The palette shows the parsed filter chips under the input before Enter so the user can see what it understood. Full-text fallback → `/search?q=`. No `/ask` or NLP endpoint exists in this worktree's `api/routes`; when one lands, the palette shows an "Ask Meridian" group that calls it — until then the group is absent, not disabled.

---

## 2. Persona journeys

Three personas, three roles (see `rbac.md`). Home adapts by role (`homeHrefForRole`). Click counts start at the signed-in home; sign-in itself is one form submit.

### 2.1 Programme lead / CIO (role `programme_lead`, legacy `manager`/`viewer`)

Goal: know go/no-go per object and wave, the trend, and the money at risk, and delegate.

1. **Sign in** → `/home/lead`. InsightHeader: Situation (serif) "DQS 82.1, capped at 85 by one Critical. 3 of 12 objects are not ready for Wave 2." Changed "+1.4 since run 0912; 2 objects moved to ready." Why "€1.2M value at risk; 4 S/4 features blocked." Do next "Approve 3 pending fix batches (+2.8 DQS)". Hero: `ScoreRing 160` with cap, DQS trend with run annotations, readiness heatmap (objects × waves).
2. **Click the heatmap cell** (object × wave, red) → `/objects/material_master?wave=2` opens with InsightHeader for that object and the findings table. *(1 click)*
3. **Click "Why it matters" cell** → `/insights/impact?object=material_master`: Proven cost and Value at risk tiles, blocked features table. *(2 clicks)*
4. **Click a blocked feature row** → Drawer with the blocking findings and owners; "Assign to owner" → `PUT /owners`. *(3 clicks; action taken)*
5. **Weekly**: `/migration/[wave]` cockpit — readiness funnel per wave, sign-off button (`POST waves/{id}/signoff`, requires `approve`). Export PDF executive report from the header `ExportMenu`. *(2 clicks from home via Do-next card "Review Wave 2 cockpit")*

### 2.2 Data steward (role `data_steward`, legacy `steward`)

Goal: a prioritised worklist, a fix sheet per record, bulk actions.

1. **Sign in** → `/home/steward`. InsightHeader: Situation "You own 2 objects; 1,240 findings, 86 critical." Changed "41 new failing records since the last run." Why "Your 86 critical findings block Material 360 for 2 plants." Do next "Work the top batch: 412 records, +1.9 DQS". NextActions rail: ranked batches / clusters. Hero: worklist table (Inbox tasks sorted by SLA and impact).
2. **Click rank-1 card "Open fix batch"** → `/fix/[batchId]`: before/after diff table, high-confidence accept, Approve. *(1 click)*
3. **Click a record key** → `/objects/[obj]/records/[key]` fix sheet: every field, failing fields flagged with the rule and proposed value, duplicates and supersession tabs, "Apply fix" / "Propose fix". *(2 clicks)*
4. **Bulk**: back in the batch, select rows → `BulkBar` → "Accept high-confidence" (`POST batches/{id}/accept-high-confidence`) or "Approve batch" → write-back (`POST /writeback`, four-eyes approval appears in Inbox › Approvals for an approver). *(3 clicks from home to a bulk action)*
5. **Inbox** (`/inbox`): Tasks (stewardship queue), Issues, Exceptions, Approvals, Notifications tabs; SLA pills; assign/escalate/resolve from the row drawer.

### 2.3 SAP functional / Basis (role `sap_basis`, legacy `analyst` with `manage_systems`)

Goal: system health, extraction, rule packs, configuration impact.

1. **Sign in** → `/home/basis`. InsightHeader: Situation "4 systems healthy, 1 degraded (PRD RFC latency 2.4 s)." Changed "Config drift: 3 SPRO tables changed since last sync." Why "Drift in T001W blocks 2 plant-level checks." Do next "Run config sync on PRD". Hero: systems health strip + extraction timeline.
2. **Click the degraded system** → `/systems/[id]` with tabs Overview / Objects / Extractions / Configuration / Source design / Custom objects / Pilot scorecard / Schedule. *(1 click)*
3. **Configuration tab › Drift** → `config/drift` table; click a row → Drawer with before/after values, affected rules (`config-pairing/finding-context`), "Re-sync" action. *(2 clicks)*
4. **Rule packs**: `/rules?module=…` coverage by module, enable/disable, versions and dry-run for custom rules. *(2 clicks via Do-next "Review rule pack for new module")*
5. **Extraction**: "Extract now" from the system header (`POST connectivity/extract`, `trigger_sync`); JobTray shows progress; top hairline animates; completion toast links to the run. *(1 click)*

---

## 3. Per-route composition

Conventions: page = `max-w --m-page-max`, padding `--m-page-pad`, gap 24. Order on every page: `Breadcrumb` (h1) → `InsightHeader` (+ `AiSummary` where a narrative exists) → hero visual → `NextActions` (home, object, system, wave, batch only) → tables/forms. Every page lists its **hero**, **empty** (fresh install) and **loading** states. "template" means `ExplorerPage`/`ReportPage`/`RecordPage` already supply it.

### 3.1 Home — `/home/lead`, `/home/steward`, `/home/basis`
- **Insight**: serif verdict in Situation; the other three cells per persona (§2).
- **Hero**: `InstrumentPanel` rebuilt as a 12-col grid inside `Card lg`: `ScoreRing 160 cap` (3 cols) · DQS trend `Line` with **run annotations** (markers from `versions` labels, config-sync events from `sync_runs`, rule changes from `rules/history`; hover shows the annotation) (6 cols) · dimension breakdown `Bar` horizontal, six rows with weight labels and threshold (3 cols). Row 2: `Heatmap` objects × dimensions (8 cols) · **Pareto** of top failing rules (`Bar` + cumulative `Line`, from `findings/aggregate`, 4 cols). Lead variant swaps the Heatmap for objects × waves and adds the readiness funnel (§3.13). Every cell/bar → DrillLink.
- **NextActions** rail under the hero.
- **Lists**: lead "Objects not ready" table; steward worklist (`stewardship` + `issues`, sorted SLA then impact); basis systems health table + recent `sync_runs`.
- **Empty**: Situation cell "No analysis yet. Connect a system and run the first extraction."; `JourneyStepper` card; `GhostPanel` with ghost ring, ghost line, six tracks; NextActions shows the day-one step as the single card.
- **Loading**: InsightHeader skeleton (4 × 2 lines), ring circle 160, three 96 skeletons, `m-motion-stagger`.

### 3.2 Systems — `/systems`, `/systems/[systemId]`, `/systems/[systemId]/extractions/[runId]`
- `/systems` (`ExplorerPage`): InsightHeader (health counts from `systems`, drift from `config/drift`, blocked checks, "Run health check"). Summary: three `Stat` (Systems, Healthy, Config loaded). Table: name + `Mono` SID, type, role Pill, health Pill with pip (`health_status`), config Pill, last extraction + `Sparkline` (`systems/{id}/trends`), modules count. Toolbar: Connect system (Dialog with `POST systems/test-connection` live check, `connect` for RFC), `ExportMenu`. **Empty**: ghost table "No systems yet. Connect your first SAP system to start measuring." **Loading**: template.
- `/systems/[systemId]`: header `Card` (name 22/28, `Mono` SID, type/role Pills, health Pill, actions: Extract now (`connectivity/extract`), Sync configuration (`connectivity/config-sync`), Health check, Menu ⋯ → Edit, Credentials, Delete). InsightHeader. Four `Stat` (Health, Objects loaded, Latest DQS `ScoreRing 48` + `ScoreExplainer`, Open findings). Tabs:
  - **Overview**: DQS trend (`systems/{id}/trends`) with annotations, module map (`system_module_map`, chips), sync profiles (`systems/{id}/profiles`) table with modules[], sync_type, extraction_mode, edit Drawer.
  - **Objects** (`systems/{id}/objects`): DataTable with ScoreRing 24, severity cluster, readiness Pill → `/objects/[obj]`.
  - **Extractions** (`systems/{id}/runs`, `sync_runs`): DataTable run id `Mono`, started, duration, rows, status Pill, steps → `/systems/[id]/extractions/[runId]`; downloads (`POST systems/{id}/downloads`).
  - **Configuration**: sub-tabs **Inventory** (`config/inventory`, `/inventory/{module}` DataTable by module, SPRO table `Mono`, rows, source live/baseline Pill), **Processes** (`config/processes`, `/processes/{id}` Drawer with steps), **Alignment** (`config/alignment/{module}` findings table, severity), **Drift** (`config/drift` DataTable before/after, Drawer with affected rules via `config-pairing/finding-context`), **Ghost & shadow** (`config/ghost`, `config/shadow` tables), **Health** (`config/health-score` ScoreRing 96 + `config/licence-utilisation` table), **Loads** (`connectivity/config-load/{id}` + `/items`, `spro/config/{module}` viewer), **Compare** (`config-pairing/compare/{id}` two-system diff, `POST propose`).
  - **Source design** (`source-design`): Discover button (`POST discover`), coverage `Stat`s (`design/coverage`), tables DataTable (`design/tables`) → Drawer `design/tables/{table}` columns with DDIC types `Mono`, config deviation (`design/config-deviation`), snapshots list + diff (`design/snapshots`, `design/diff`).
  - **Custom objects** (`z-objects`): Detect button, registry DataTable (`registry`, status Pill, mapping), Drawer `registry/{z}` with profile (`profile/{z}`), anomalies (`anomalies` with feedback thumbs), ghost/dormant/drift tables, custom rules (`z-objects/rules`), report export (`z-objects/report`).
  - **Pilot scorecard** (`pilot/scorecard`): `ScoreRing 96`, known issues DataTable (`known_issues`), "Add known issue" Drawer (`POST known-issues`).
  - **Reference data** (`systems/{id}/reference`): postal codes / BIC loaded counts, upload buttons.
  - **Audit**: `audit?entity=system&id=…`.
  **Hero**: Latest DQS tile. **Empty per tab**: one sentence + the action (e.g. "Nothing has been extracted from this system yet." → Extract now; "No configuration discovered yet." → Discover). **Loading**: header 56 + 4 tiles + 240.
- `/systems/[systemId]/extractions/[runId]` (`ReportPage`): narrative; `Bar` step durations; steps DataTable (`sync_runs`, `runs/{v}/steps`), status Pills, errors in `Mono` well; `ExportMenu` (extraction PDF). **Empty**: "Extraction not found." **Loading**: template.

### 3.3 Objects — `/objects`, `/objects/[object]`, `/objects/[object]/records/[key]`, `/objects/[object]/rules/[ruleId]`
- `/objects` (`ExplorerPage`): InsightHeader (objects ready / not, biggest mover from `versions/compare`, blocked features, next action). Filters module/readiness/system/search in URL. Table: object, `ScoreRing 24` + score (`ScoreExplainer` on click), severity cluster, readiness Pill, `Sparkline`, records, owner (`owners`), wave. **Empty**: "No objects measured yet. Objects appear after the first analysis." **Loading**: template.
- `/objects/[object]`: header `Card` (object, `Mono` tables, `ScoreRing 96 cap` with explainer, readiness Pill, owner Pill, `ExportMenu` object PDF/XLSX). InsightHeader + AiSummary. Hero row: dimension `Bar` (6) · Pareto of failing rules · trend `Line`. NextActions. Tabs:
  - **Findings** (`findings?module=`): DataTable `SeverityDot`, check ID `Mono`, rule, field `Mono`, failing `m-numeric` DrillLink, pass rate bar, trend `Sparkline` (`scores/history`), owner → `FindingDrawer` (§1.7).
  - **Field profile** (`systems/{s}/versions/{v}/profile`, `field_profiles`, `table_profiles`): DataTable field `Mono`, completeness bar, distinct, min/max, top values; export.
  - **Records** (`objects/{obj}` rows): DataTable keys `Mono` → fix sheet.
  - **Rules** (`rules?module=`, `rules/coverage/{module}`): coverage bar + rules table with enabled toggle.
  - **Impact** (`config-impact/{v}` filtered to object, `insights/impact`): blocked/degraded features table.
  - **Process** (`business-process/{v}/{module}`): L1–L5 tree with readiness per field.
  - **Lineage** (`lineage/graph`, `field_dependencies`): Graph.
  - **History**: `scores/history` Line + `versions` list.
  **Empty**: "No results for this object in this run." ghost `ring`. **Loading**: header + 320.
- `/objects/[object]/records/[key]` (`RecordPage`): header `Mono` key 22/28, object, status Pill, actions Apply fix / Propose fix / Export fix sheet (`reports/record/{v}/{matnr}.pdf`). Tabs: **Fields** (grouped `Card`s; failing fields: `SeverityDot`, rule `Mono`, proposed value from `record_fixes`), **Findings** (`materials/{matnr}/findings`), **Duplicates** (`materials/{matnr}/duplicates`, `insights/duplicates/{obj}/{id}` with similarity bars → "Propose merge"), **Supersession** (`materials/{matnr}/supersession` chain graph), **Fixes** (`record_fixes` history), **Audit**. **Empty**: "Record not found in this run." **Loading**: 32 + 120.
- `/objects/[object]/rules/[ruleId]`: redirect to `/rules/[ruleId]?object=…` (skeleton 240).

### 3.4 Runs — `/runs`, `/runs/[versionId]`, `/runs/[versionId]/vs/[b]`
- `/runs` (`ExplorerPage`): InsightHeader (latest run verdict, delta vs previous, blocked features, "Compare with baseline"). Filters status/system/archived in URL. Table: run id `Mono`, label, system, started, duration, status Pill, DQS `ScoreRing 24`, `Delta`, `Sparkline`, baseline Pill; row menu: Set baseline (`POST baseline`), Archive/Restore (`versions/archive|restore`), Edit label (`PATCH`). Toolbar Run analysis (`POST versions/{v}/analyse`), `ExportMenu` (`runs/export`). **Empty**: "No runs yet. Run the first extraction from Systems." **Loading**: template.
- `/runs/[versionId]`: header `Card` (id `Mono`, label, status Pill with live progress from `analysis/status/{v}` + SSE `events/{v}`, Compare, Re-run agents (`run-agents`), `ExportMenu` analysis PDF / JSON (`reports/{v}/export.json`)). InsightHeader + AiSummary (narrative from the report). Tabs: **Summary** (ScoreRing 96, four Stat, dimension Bar, Heatmap, Pareto), **Findings** (ExplorerPage inside), **Config matches** (`versions/{v}/config-matches` + `/summary`, DataTable + export), **Steps** (`runs/{v}/steps`, `analysis_run_steps` timeline with durations), **Objects**, **Report** (`reports` model rows, download `reports/{v}/download`), **Audit**. **Empty**: "No findings were produced for this run. Open Steps to see what ran." **Loading**: header + 240.
- `/runs/[a]/vs/[b]`: three `Stat` Before / After / Change; `Waterfall` by dimension; **before/after what-if toggle**: a `Tabs` strip "Actual change | Simulated (if pending batches applied)" using `simulations`; "Newly failing" / "Fixed" `Card`s (`versions/compare`), records DataTable (`versions/compare/records`, `/records/{check_id}`); `ExportMenu` compare PDF. **Empty**: "No earlier run to compare with." **Loading**: 3 tiles + 240.

### 3.5 Rules — `/rules`, `/rules/[ruleId]`, `/rules/contracts`, `/rules/learned`, `/rules/scoring`, `/rules/drafts`, `/rules/dictionary`
- `/rules`: InsightHeader (`rules/summary`: rules/enabled/disabled, changes from `rules/history`, modules with thin coverage from `rules/coverage`, "Review 4 learned rules"). Three `Stat`. Coverage by module DataTable (bars). Filters source/severity/module/enabled/search. DataTable check ID `Mono`, name, module, severity, source Pill, state Pill (draft/active/retired from `rule_versions`), enabled toggle (`PATCH`), suppressions count. Tabs: **All**, **Suppressions** (`rule-suppressions` table, add Dialog, delete), **Feedback** (`rule-feedback`). New rule Drawer: AI generate (`rule-authoring/generate`) with "AI draft" label, dry run (`rules/dry-run`), save (`rules/custom`). **Empty**: "No rules loaded." **Loading**: tiles + table.
- `/rules/[ruleId]`: header (check ID `Mono` 22/28, name, severity, module, state Pill, Enable/Disable, New version). Tabs: **Definition** (YAML `Mono` well), **Where it applies** (`findings/rules/{check}/applicability`), **Results** (pass rate trend `Line`, failing by object), **Versions** (`rules/{id}/versions`, side-by-side diff `rules/{id}/versions/{v}/diff`, transition buttons draft→active→retired `POST transition`), **History** (`rules/{id}/history` + export), **Lineage** (`lineage/rule/{check}`, `lineage/blast-radius/{v}/{check}`), **Suppressions**, **Audit**. **Empty**: "Rule not found." **Loading**: 120/96/320.
- `/rules/contracts` (`ExplorerPage`): table + compliance history `Line` in Drawer (`contracts/{id}/compliance`, `contract_compliance_history`), activate (`PUT activate`). **Empty**: "No data contracts yet. A contract turns a rule into a promise with an owner."
- `/rules/learned` (`ExplorerPage`): `learned-rules` + `ai/proposed-rules` merged with source Pill (mined / AI), confidence bar, Accept/Reject; "Mine now" (`POST learned-rules/mine`). **Empty**: "No learned rules yet. Mining runs after the second analysis."
- `/rules/drafts` (new, `ExplorerPage`): `rule-authoring/drafts` table, open → New rule Drawer prefilled. **Empty**: "No drafts."
- `/rules/dictionary` (new): DDIC browser: `ddic/fields` search (`Field` 40h), DataTable table.field `Mono`, domain, data element, length, used by rules count → `/rules?field=`. Sources `ddic_tables`, `ddic_domains`, `ddic_snapshots` (snapshot `Select`). **Empty**: "No data dictionary snapshot yet. It is captured during extraction."
- `/rules/scoring`: weights form (`settings/scoring`, `PATCH dqs-weights`) with live `Radar` and live `ScoreRing 96` preview; bands and caps; **Cost model** card (`settings/cost-model`: currency, cost per failing record by object); alert thresholds (`PATCH alert-thresholds`). **Empty**: "Save weights; the preview uses the latest findings once a run completes." **Loading**: 3 × 32.

### 3.6 Insights — `/insights/*`
- `/insights` hub: InsightHeader (exec narrative). Grid of `Card`s per insight with a live mini visual. **Empty**: "No insights yet. Insights appear after the first analysis." **Loading**: 6 card skeletons.
- `/insights/readiness`: `Heatmap` modules × waves (cell 40) → `/objects/[obj]?wave=`; legend; DataTable. S/4 readiness `Stat` from `findings/s4-readiness`.
- `/insights/exec` (`ReportPage`): AiSummary; `Waterfall`; **ROI** card (`analytics/roi`: proven cost avoided vs licence, trend); readiness / impact / owners DataTables; executive PDF.
- `/insights/impact`: Proven cost (`insights/proven-cost`, `cost_avoidance`) / Value at risk (`insights/impact`, `impact_records`) tiles in tenant currency; blocked/degraded features DataTable (`config-impact/{v}`, `config_impact_results`) expandable to blocking findings → `analytics/impact/{finding_id}` Drawer.
- `/insights/forecast`: module `Select`; `Line` actual + forecast band (`analytics/forecast/{module}`, `analytics/predictive`); signals table.
- `/insights/owners`: owner cards (`insights/owners`, `data_owners`); assign Drawer (`PUT owners`).
- `/insights/duplicates`: `Graph` (`mining/duplicates`, `data_duplicates`) + clusters table; cluster → `/mdm/golden/merge?cluster=`.
- `/insights/lineage`: `lineage/model` + `/graph` Graph with field dependency edges; guards table (`lineage/guards`); impact (`lineage/impact/{v}`).
- `/insights/mining`: four `Stat` (`mining/summary`); tabs Relationships (`mining/relationships`, `relationships`, `relationship-types`), Patterns (`mining/patterns`), Anomalies (`mining/anomalies`, `data_anomalies`), Candidate rules; "Run mining".
- `/insights/process`: L1 cards with L2 strips (`business-process/{v}/{module}`); `config-impact` features; Designer link.
- `/insights/process/designer`: BPMN canvas (`process-designer/models`, versions `models/{id}/versions`, variants `variants/{v}`, overlay `overlay/{v}`, adopt variant); Stats; export Signavio (`process-designer/.../export/signavio`); mining graph (`process/mining/graph/{v}/{module}`) as overlay toggle. New **Versions** Drawer with diff list.
- `/insights/operations` (new, `ReportPage`): `analytics/operational` + `/team/{user}` (throughput per steward, SLA breaches), `analytics/sprints` (burn-down `Line`), `analytics/bottlenecks` (Pareto), `analytics/capacity` (capacity bars). InsightHeader from `stewardship/metrics`, `triage/metrics`, `exceptions/metrics`. **Empty**: "No stewardship activity yet."
- `/insights/reports` (new): one row per report type (analysis, extraction, cleaning, executive, compare, object, record, migration wave, realignment, process export, config matches, findings, profile, audit) × run `Select`; Generate/Download with job progress; recent `reports` rows table. **Empty**: "Reports are generated from runs. Run an analysis first."

### 3.7 MDM — `/mdm`, `/mdm/golden`, `/mdm/golden/[id]`, `/mdm/golden/merge`, `/mdm/glossary`, `/mdm/glossary/[id]`, `/mdm/match-rules`, `/mdm/survivorship`
- `/mdm` (new overview): InsightHeader (`mdm-metrics`, `analytics/mdm-health`, `mdm-metrics/history` delta, duplicates value at risk, "Review 23 merge candidates"). Hero: golden coverage `ScoreRing 160`, `Line` history, duplicates Pareto by domain. NextActions. Tiles → sub-pages. **Empty**: "No golden records yet."
- `/mdm/golden` (`ExplorerPage`): filters domain/status/confidence; DataTable key `Mono`, domain, status Pill, confidence bar, sources, updated; Run matching (`POST match-rules/simulate` → `dedup/candidates`). 
- `/mdm/golden/[id]` (`RecordPage`): tabs **Survivorship** (field / golden / sources, winner highlighted; overrides `POST overrides`), **Explain** (`master-records/{id}/explain`: per-rule match scores bars), **Cluster** (`cluster-graph` Graph; decisions `POST match-scores/{id}/decision`), **History** (`master-records/{id}/history`, `merge-events`; Undo last merge, Unmerge, Revert event), **Write-back** (`POST writeback` status, approvals), **Audit**. Actions Promote (Dialog), Write back.
- `/mdm/golden/merge`: candidates (`dedup/candidates/{object}`), preview (`POST dedup/preview`) side-by-side, merge (`POST dedup/merge`); pair constraints inline (never-match / always-match → `pair-constraints`).
- `/mdm/glossary` + `/[id]`: terms (`glossary`), AI draft button labelled "AI draft" (`ai-draft`), review (`POST review`), linked rules (`glossary_term_rules`), change log (`glossary_change_log`) in History tab, owners.
- `/mdm/match-rules`: domain Tabs; rules CRUD; tuning dry-run (`POST match-tuning/dry-run`) precision/recall `Line`; pair constraints DataTable.
- `/mdm/survivorship` (new): `survivorship_rules` table per domain (field, strategy, source priority). **Backend gap**: no route exposes `survivorship_rules` — add `GET/PUT /api/v1/survivorship-rules` (wave 10b). Until then this page is omitted from nav, not stubbed.

### 3.8 Inbox — `/inbox`
`ExplorerPage`; InsightHeader (`stewardship/metrics`, `exceptions/metrics`, SLA breaches, "Resolve 3 breached items"). Tabs in the filter bar, each a URL param:
- **Tasks** (`stewardship`, `stewardship_queue`): SLA Pill, severity, title, object `Mono`, assignee, status; Drawer with assign/resolve/escalate; `BulkBar` bulk-approve.
- **Issues** (`issues`, `record_issues` + `record_issue_events`): comments thread in Drawer (`POST comments`), bulk (`POST issues/bulk`).
- **Exceptions** (`exceptions`): assign/escalate/resolve/comment; **Exception rules** Drawer (`exceptions/rules`); **SAP monitor** sub-view (`exceptions/sap-monitor`) as a live table.
- **Approvals** (new tab): four-eyes queue — `remediation/batches?status=awaiting_approval`, `writeback` approvals (`POST writeback/approve/{id}`), `cleaning/queue` approve/reject, golden promotions; only for roles with `approve`.
- **Triage queue** (`triage/queue`, bulk `triage/bulk`) for team leads.
- **Notifications** (`notifications`, mark read / read-all).
**Hero**: Open tile toned by worst SLA. **Empty**: "Inbox zero. Findings assigned to you land here." **Loading**: template.

### 3.9 Fix — `/fix`, `/fix/[batchId]`, `/fix/what-if`
- `/fix` (`ExplorerPage`): InsightHeader (`cleaning/metrics` + `remediation/monitor`: pending batches, records fixable, DQS gain if applied from `simulations`). Tabs **Batches** (`remediation/batches`), **Cleaning queue** (`cleaning/queue`, `cleaning_queue`, approve/reject/apply/rollback, bulk-approve, export options), **Monitor** (`remediation/monitor` live status strip), **Dedup** (`dedup/candidates`). Create batch from cleaning / simulation (`POST batches/from-cleaning|from-simulation`). **Empty**: "No fix proposals yet. Proposals appear when a run finds correctable values."
- `/fix/[batchId]`: header + three `Stat`; InsightHeader (impact if applied); tabs **Items** (diff table before struck / after, confidence bar, item PATCH), **Diff** (`batches/{id}/diff` summary), **Events** (`batches/{id}/events` timeline), **Packages** (`batches/{id}/packages`, `export_packages`; `POST export`), **Audit**. Actions Accept high-confidence, Approve, Export, Write back. **Empty**: "Batch not found."
- `/fix/what-if` (new): the **before/after what-if**. Left: pick scope (object, rules, or batches) → `POST simulations`; right: two `ScoreRing 96` Before/After with `Delta`, dimension `Waterfall`, features unblocked list, records fixed; "Create batch from this simulation". Poll `simulations/{id}` with a progress bar. **Empty**: "Pick an object or a batch to simulate." **Loading**: two ring skeletons.

### 3.10 Import — `/import`
Drop zone (`POST upload`, `upload/match`), three `Stat`, mapping preview with confidence Pills (`field-mappings`), versions DataTable (`versions?source=upload`). **Empty**: "No imports yet."

### 3.11 Admin — `/admin/*`
- `/admin/users`: tabs Users / Roles & access (→ `/admin/roles`) / Sessions; invite Drawer with role + scope (see `rbac.md`); effective permissions Drawer.
- `/admin/roles` (new; `rbac.md` §4).
- `/admin/audit` (new): InsightHeader from `audit/summary`; DataTable (`audit`, `audit_log`): time, actor, action, entity `Mono`, tenant-safe details; filters actor/action/entity/date in URL; export (`audit/export`). Tab **AI audit** (`llm_audit_log`, `llm_decision_cache`): prompt hash, provider, tokens, latency, decision, cache hit Pill; proves the model saw aggregates only. Tab **Role changes** (`audit?action=role.*`). **Empty**: "No activity yet."
- `/admin/notifications` (new): alert channels (`alert-channels` CRUD, test send), notification settings (`POST settings/notifications`), alert thresholds. **Empty**: "No channels. Add email or webhook."
- `/admin/jobs` (new): `jobs` list with status/duration, `jobs/{id}` Drawer with log tail, scheduler view (12 beat tasks, next run), planner (`POST settings/planner`). **Empty**: "No jobs have run."
- `/admin/reference` (new): reference datasets per system (postal codes, BIC) with upload and counts.
- `/admin/settings`: tenant settings (`settings`), doctor (`admin/doctor`), health (`health`, `health/llm`), platform update (`system/update-status`, trigger, progress).
- `/admin/ai`: provider form (`settings/llm/providers`, `settings/llm`, test), **AI audit** link, proposed-rule review queue (`ai/proposed-rules`).
- `/admin/licence`: `licence` tiers/modules Pills, seats, update status.
- `/admin/mappings`: `field-mappings` per module, reset.
- `/admin/triage`: teams / rules (reorder drag) / SLA policies / settings.
- `/admin/billing`: `exceptions/billing` + tiers.

### 3.12 Search — `/search`
Large `Field`; results grouped by kind; parsed-filter chips from the palette grammar (§1.8). **Empty**: "Search objects, records, checks and rules." / "Nothing matches."

### 3.13 Migration — `/migration`, `/migration/[waveId]`, `/migration/dry-run`
- `/migration` (`ExplorerPage`): InsightHeader (waves go/no-go, change, blocked records, "Sign off Wave 1"). Table waves (`migration/waves`) with ScoreRing 24, verdict Pill, cutover date, `Sparkline`; New wave Dialog.
- `/migration/[waveId]`: header + four `Stat`; **readiness funnel** hero (`waves/{id}/cockpit`): horizontal funnel Records → Mapped (`field-map`, `value-map`) → Valid → Loadable → Signed off, each stage a bar with count and drop-off DrillLink to the blocked rows; tabs **Objects**, **Blockers** (`runs/{id}/findings`, fix batch `POST blockers/fix-batch`), **Field map** (`field-map` CRUD, seed), **Value map** (`value-map`, candidates `runs/{id}/value-candidates`), **Dry runs** (`migration/runs`, records `runs/{id}/records`, realignment export), **Sign-off** (`POST signoff`, requires `approve`; shows who signed), **Audit**. Export wave report (`waves/{id}/report.{fmt}`).
- `/migration/dry-run` (`ReportPage`): verdict strip, Blocked/Total, blocked records table, export (`runs/{id}/dry-run/{fmt}`).

### 3.14 Design — `/design`
Living style guide (spec.md §8.14) plus the new InsightHeader, AiSummary (on/off), ScoreExplainer, NextActions, funnel, Pareto and annotated Line demos.

---

## 4. Coverage matrix

Columns: endpoint or entity · screen · how it is shown. **GAP** marks data with no screen in the current `(app)` tree; the screen named after it is the one designed above (§3) that closes it. Scoped by route module in `api/routes/`.

| Endpoint / entity | Screen | How shown |
|---|---|---|
| `admin_doctor` GET /admin/doctor | /admin/settings › Doctor | checks list with Pills |
| `ai_feedback` POST /ai/feedback | AiSummary thumbs (every page) | icon buttons |
| GET/POST /ai/proposed-rules, approve, reject | /rules/learned (source "AI"), /admin/ai review queue | table + Accept/Reject |
| `analyse` POST /versions/{v}/run-agents | /runs/[v] header "Re-run agents" | button + JobTray |
| `analysis_status` GET /analysis/status/{v} | /runs/[v] status Pill, JobTray | live progress |
| `analytics` /predictive, /forecast/{module} | /insights/forecast | Line with band |
| /prescriptive | NextActions rail (home, object, system, wave, batch) | ranked cards |
| /impact, /impact/{finding} | /insights/impact; FindingDrawer impact section | tiles, table, Drawer |
| /operational, /operational/team/{user}, /sprints, /bottlenecks, /capacity | **GAP** → /insights/operations | Line, Pareto, bars |
| /roi | **GAP** → /insights/exec ROI card | Stat + Line |
| /mdm-health | **GAP** → /mdm overview | ScoreRing + tiles |
| `audit` GET /audit, /audit/export, /audit/summary; `audit_log` | **GAP** → /admin/audit; Audit tab on every detail | DataTable + export |
| `auth` /login, /me, /roles, change-password, accept-invite, forgot, reset | auth pages; UserMenu | forms; menu header |
| `business_process` GET /{v}/{module} | /insights/process; /objects/[obj] › Process | L1–L5 tree |
| `cleaning` /cleaning/queue, /{item}, approve, reject, bulk-approve, apply, rollback, export-options, export/{fmt}, /metrics, /audit; `cleaning_queue`, `cleaning_audit`, `cleaning_metrics`, `cleaning_rules` | **GAP (partial)** → /fix › Cleaning queue tab; Inbox › Approvals | DataTable, BulkBar, Drawer |
| /dedup/candidates, /{object}, preview, merge; `dedup_candidates` | /mdm/golden/merge; /fix › Dedup | side-by-side preview |
| `config_impact` GET /{v}; `config_impact_results` | /insights/impact; /insights/process; /objects/[obj] › Impact; InsightHeader "Why" | features table |
| `config_intelligence` discover, /inventory, /inventory/{m}, /processes, /{id}, /alignment, /{m}, /ghost, /shadow, /drift, /licence-utilisation, /health-score, /root-cause/{finding}; `config_*` tables | **GAP (mostly)** → /systems/[id] › Configuration sub-tabs; FindingDrawer root cause | tables, Drawer, ScoreRing |
| `config_matches` /versions/{v}/config-matches, summary, export; `config_matches` | **GAP** → /runs/[v] › Config matches | DataTable + export |
| `config_pairing` compare/{s}, propose/{s}, finding-context | **GAP** → /systems/[id] › Configuration › Compare; Drift Drawer | two-column diff |
| `connect` POST /connect | Connect system Dialog (RFC) | form + test |
| `connectivity` modules, extract, config-sync, health-check, config/{s}/{m}, config-load (+/{s}, /items) | /systems, /systems/[id] header + Configuration › Loads | buttons, tables |
| `contracts` CRUD, activate, compliance; `contracts`, `contract_compliance_history` | /rules/contracts | table, Drawer Line |
| `events` GET /events/{v} (SSE) | JobTray, /runs/[v] status, hairline | live |
| `exceptions` list/detail/create/assign/escalate/resolve/comment, /rules, /metrics; `exceptions`, `exception_comments`, `exception_rules` | /inbox › Exceptions | Drawer, rules Drawer |
| /exceptions/sap-monitor | **GAP** → /inbox › Exceptions › SAP monitor | live table |
| /exceptions/billing; `exception_billing` | /admin/billing | tiers table |
| `field_mappings` list, /module/{m}, PUT, reset | /admin/mappings; /import mapping preview | table + Pills |
| `field_profiles` profile, export; `field_profiles`, `table_profiles` | /objects/[obj] › Field profile | DataTable bars |
| `findings` /findings, export, aggregate, config-aware-score, /rules/{check}/applicability, /scores/history, /s4-readiness, /{id}/report-context | object/run Findings tabs; ScoreExplainer; FindingDrawer; /insights/readiness S/4 tile | tables, popover, Drawer |
| /saved-views CRUD; `saved_views` | every DataTable "Views" Select | Select + Dialog |
| `glossary` list/detail/ai-draft/PUT/review/batch-lookup; `glossary_terms`, `glossary_term_rules`, `glossary_change_log` | /mdm/glossary, /[id] | RecordPage tabs |
| /owners GET/PUT; `data_owners` | /insights/owners; object header owner Pill | cards, Drawer |
| `health` /health, /health/llm | /admin/settings; AiSummary fallback | Pills |
| `insights` readiness, impact, proven-cost, owners, duplicates/{obj}/{id}, merge-proposals, exec | /insights/*; record › Duplicates | heatmap, tiles, Graph |
| `jobs` list, /events, /{id} | JobTray | **GAP (history)** → /admin/jobs |
| `learned_rules` list, mine, approve, reject; `learned_rule_proposals` | /rules/learned | table |
| `licence` GET; `licence_cache` | /admin/licence | Pills, Stat |
| `lineage` model, graph, impact/{v}, blast-radius/{v}/{check}, guards, rule/{check}; `field_dependencies` | /insights/lineage; /rules/[id] › Lineage; /objects/[obj] › Lineage | Graph, tables |
| `llm_settings` providers, GET/PUT, test | /admin/ai | form |
| `master_records` list/detail/promote/writeback/history; `master_records`, `master_record_history` | /mdm/golden, /[id] | RecordPage tabs |
| `match_rules` CRUD, simulate; `match_rules`, `match_scores` | /mdm/match-rules | table, Line |
| `materials` /{matnr}, findings, supersession, duplicates | /objects/material_master/records/[key] tabs | fields, chain graph |
| `mdm_metrics` GET, history; `mdm_metrics` | **GAP** → /mdm overview | ring, Line |
| `merge_explain` explain, cluster-graph, merge-events, pair-constraints, match-tuning/dry-run, unmerge, undo-last-merge, overrides, revert, decision, delete constraint; `mdm_merge_events`, `mdm_pair_constraints` | **GAP (partial)** → /mdm/golden/[id] › Explain / Cluster / History; /mdm/match-rules › tuning | bars, Graph, timeline |
| `migration` analyze, runs, /{id}, records, dry-run/{fmt}, waves CRUD, run, cockpit, signoff, report, realignment, blockers/fix-batch, findings (+export), value-candidates, export, field-map CRUD/seed, value-map; `migration_*`, `transfer_field_mappings`, `transfer_value_mappings` | /migration, /[wave] tabs (**GAP** cockpit funnel, field map, value map, sign-off), /dry-run | funnel, tables |
| `mining` run, duplicates, anomalies, relationships, summary, patterns; `data_duplicates`, `data_anomalies`, `data_relationships` | /insights/mining; /insights/duplicates | Stats, tables, Graph |
| `notifications` list, read, read-all, unread-count; `notifications` | /inbox › Notifications; Rail badge | list |
| /alert-channels CRUD, test; `alert_channels` | **GAP** → /admin/notifications | table + test |
| `object_records` GET /objects/{o}/records/{k} | fix sheet | fields |
| `objects` list, export, /{module}, export | /objects, /[obj] › Records | tables |
| `pilot` known-issues, scorecard; `known_issues` | **GAP** → /systems/[id] › Pilot scorecard | ring + table |
| `process_designer` reference, models CRUD, versions, variants/{v}, overlay, adopt-variant; `process_models`, `process_model_versions`, `process_variants` | /insights/process/designer (**GAP** versions Drawer) | canvas |
| `process_export` signavio | designer Export menu | download |
| `process_mining` graph/{v}/{m} | designer overlay toggle | canvas overlay |
| `prom_metrics` /metrics | not a screen (scrape) | — |
| `record_issues` list, export, /{id}, bulk, comments; `record_issues`, `record_issue_events` | **GAP** → /inbox › Issues | table, Drawer thread |
| `relationships` list, relationship-types; `relationship_types`, `record_relationships` | /insights/mining › Relationships | table |
| `remediation` batches CRUD, from-cleaning, from-simulation, monitor, /{id}, events, items PATCH, accept-high-confidence, approve, export, diff, packages; `remediation_*`, `export_packages`, `record_fixes` | /fix, /fix/[batch] (**GAP** Monitor, Events, Packages, Diff tabs) | tables, timeline |
| `reports` download, export.json, analysis/extraction/cleaning/executive/compare/object/record PDFs; `reports` | ExportMenu on each page; **GAP** → /insights/reports hub | menu, hub |
| `rule_authoring` generate, dry-run, drafts | /rules New rule Drawer; **GAP** → /rules/drafts | form |
| `rule_depth` coverage, /{m}, by-code/{check}, ddic/fields; `ddic_*` | /rules coverage; **GAP** → /rules/dictionary | table |
| `rules` list, export, summary, history, /{id}, PATCH, versions, diff, transition, history (+export), rule-feedback, rule-suppressions CRUD, mined, custom, dry-run; `rules`, `rule_versions`, `rule_suppressions` | /rules, /[id] (**GAP** Versions/diff/transition, Feedback, Suppressions tabs) | tables, diff |
| `runs` export, steps, steps/export; `analysis_run_steps` | /runs, /runs/[v] › Steps | timeline |
| `settings` GET, dqs-weights, alert-thresholds, notifications, planner, scoring, cost-model | /rules/scoring (**GAP** cost model), /admin/notifications, /admin/jobs planner | forms |
| `shell` counts | Rail badges | Badge |
| `simulation` POST, GET /{id} | **GAP** → /fix/what-if; NextActions impact; compare what-if toggle | rings, Waterfall |
| `source_design` discover, design, coverage, tables, /{table}, config/{table}, config-deviation, snapshots, diff | **GAP** → /systems/[id] › Source design | tables, diff |
| `spro_config` config/{m} | /systems/[id] › Configuration › Loads | viewer |
| `stewardship` list, metrics, /{id}, assign, resolve, escalate, bulk-approve; `stewardship_queue`, `steward_metrics` | /inbox › Tasks; /insights/operations | table, Drawer |
| `sync_trigger` modules | Extract now Dialog module picker | checkboxes |
| `system_objects` objects, downloads, versions, trends, reference (postal-codes, bic) | /systems/[id] tabs (**GAP** Reference data) | tables |
| `system_update` status, trigger, progress; `system_update_log` | /admin/settings › Update | Pill + progress |
| `systems` CRUD, test-connection, test, sync, profiles CRUD, runs; `sap_systems`, `system_credentials`, `sync_profiles`, `sync_runs`, `system_module_map` | /systems, /[id] | tables, Dialogs |
| `triage` teams/rules/sla/settings CRUD, queue, bulk, metrics | /admin/triage; /inbox › Triage queue | tables, Dialogs |
| `upload` POST /upload; `upload_match` /upload/match | /import | drop zone |
| `users` list, assignable, PUT, invite, delete; `users` | /admin/users | table, Drawer |
| `versions` list, archive, restore, compare (+records, /{check}), findings/{check}/records (+export), root-cause, analyse, baseline, /{id}, PATCH, status; `analysis_versions`, `finding_records` | /runs, /runs/[v], /vs; FindingDrawer | tables, Drawer |
| `writeback` POST /writeback, approve/{id} | /fix/[batch] Write back; /mdm/golden/[id] › Write-back; **GAP** → /inbox › Approvals | buttons, queue |
| `z_object_intelligence` detect, registry CRUD, profile, anomalies (+feedback), ghost, dormant, drift, rules, report, mapping | **GAP** → /systems/[id] › Custom objects | tables, Drawer |
| `dqs_history` (via /scores/history) | ScoreExplainer history; trend Lines | Line |
| `cost_avoidance`, `impact_records` (via insights) | /insights/impact | tiles |
| `survivorship_rules` | **GAP + backend gap** → /mdm/survivorship (needs `GET/PUT /survivorship-rules`) | table |
| `llm_audit_log`, `llm_decision_cache` | **GAP** → /admin/audit › AI audit (needs `GET /audit/llm`; `audit` route today returns `audit_log` only) | table |
| `config_snapshots`, `record_hashes` | /systems/[id] › Configuration › Loads snapshots; internal | list; — |
| `tenants` | /admin/settings header | read-only |

Gap screens designed above: /insights/operations, /insights/reports, /mdm (overview), /mdm/survivorship, /admin/audit (+AI audit, role changes), /admin/roles, /admin/notifications, /admin/jobs, /admin/reference, /fix/what-if, /rules/drafts, /rules/dictionary, and the new tabs on Systems detail (Configuration sub-tabs, Source design, Custom objects, Pilot scorecard, Reference), Runs detail (Config matches), Rule detail (Versions, History, Feedback, Suppressions), Golden detail (Explain, Cluster, History, Write-back), Inbox (Issues, Approvals, SAP monitor, Triage queue), Fix batch (Diff, Events, Packages), Wave (cockpit funnel, Field map, Value map, Sign-off). Two backend additions are required and named: `GET/PUT /survivorship-rules`, `GET /audit/llm`.

`lib/nav.ts` additions: MDM group gets "Overview" as its index; Insights gets "Operations", "Reports"; Rules gets "Drafts", "Dictionary"; Fix gets "What-if"; `SETTINGS_ITEMS` gets Roles & access, Audit log, Notifications, Jobs, Reference data. Visibility is gated by `/me/permissions` (`rbac.md` §5).
