# Meridian frontend redesign

Date: 2026-10-08. Status: approved approach A ("new shell, new design system, rebuild in waves"). This document is the design the implementation plan is written from.

## 1. Why

The current frontend is a six-hub, tabbed shell over 70 routes. Users report four problems: details are hard to reach (score to failing row takes six or more clicks and the tab shell hides depth), pages freeze (one SSE event invalidates every React Query cache in the app), pages are incomplete (blank tabs, stub pages, redirect shims), and reporting and insights are thin compared with Ataccama, Collibra, Soda, Monte Carlo, SAP MDG, Semarchy, Purview, Experian and Qlik.

The redesign replaces the shell and the design system, rebuilds every page onto one kit, and adds an insights layer that competitors do not have for SAP migrations.

## 2. Users and success

Three personas carry equal weight:

- **Programme lead / executive.** Wants a go/no-go view per S/4 object and wave, trend since last run, money and process at risk, and a digest they can forward.
- **Data steward.** Works failing records for hours beside SAP GUI. Wants the shortest path from a number to the rows behind it, a fix sheet per record, and batches they can approve and export.
- **SAP functional / Basis.** Wants systems, extraction health, rule packs, field mappings and configuration impact, and wants to know why a run failed without reading worker logs.

Success criteria:

- Any score, chart point or count reaches its failing rows in at most three clicks, and the breadcrumb preserves the filters that got there.
- No page re-fetches data it does not show when a job finishes.
- No route renders blank, "coming soon" or a redirect shim.
- Every persona has a home that answers "what changed and what do I do next" without navigating.
- The legacy design system is deleted at the end of Wave 3.

## 3. Architecture

### 3.1 Route tree

The new shell lives under `frontend/app/(app)/`. Routes are object-centred, not hub-centred.

| Route | Page template | Purpose |
|---|---|---|
| `/home` | Home | Redirects to the persona home for the user's role, or to the override stored in `localStorage` under `meridian:home`. |
| `/home/lead`, `/home/steward`, `/home/basis` | Home | Persona homes (section 6). |
| `/objects` | Explorer | All S/4 objects with score, delta, blockers, owner, readiness. |
| `/objects/[object]` | Explorer | One object: dimension scores, rule list, trend, record table. `[object]` is the module id (`material_master`). |
| `/objects/[object]/rules/[ruleId]` | Explorer | One rule: description, logic, failing records, history across runs. |
| `/objects/[object]/records/[key]` | Record | Record fix sheet (section 7). `[key]` is the URL-encoded primary key. |
| `/runs` | Explorer | Analysis runs (versions): label, status, rows, score, baseline pin. |
| `/runs/[versionId]` | Report | One run: what ran, what failed, time per step, worker error text. |
| `/runs/[a]/vs/[b]` | Report | Run diff: new, fixed, regressed waterfall and record diff. |
| `/fix` | Explorer | Fix batches list. |
| `/fix/[batchId]` | Explorer | One batch: items, confidence, accept, approve, export. |
| `/inbox` | Explorer | Issue inbox: assigned findings with recommended action, SLA, owner. |
| `/insights` | Report | Index of reports. |
| `/insights/readiness` | Report | Migration-readiness cockpit (section 8.1). |
| `/insights/impact` | Report | Process impact: blocked and degraded SAP features with value at risk (8.2). |
| `/insights/owners` | Report | Owner scorecards with narrative digest (8.3). |
| `/insights/duplicates` | Report | Duplicate graph with merge impact (8.4). |
| `/insights/exec` | Report | Executive report, printable, scheduled (8.5). |
| `/systems` | Explorer | SAP systems, health, last extraction. |
| `/systems/[systemId]` | Explorer | One system: profiles, extractions, discovered objects, credentials. |
| `/systems/[systemId]/extractions/[runId]` | Report | One extraction: tables, rows, time, error. |
| `/import` | Explorer | File import. |
| `/rules` | Explorer | Rule packs per object, enable or disable, thresholds, custom rules. |
| `/rules/[ruleId]` | Explorer | Rule definition editor. |
| `/admin/users`, `/admin/mappings`, `/admin/ai`, `/admin/licence`, `/admin/triage`, `/admin/settings` | Explorer | Admin pages. |
| `/search` | Explorer | Global search results (object, material, rule id, batch, run). |

Legacy pages the table above does not name are rebuilt in Wave 3 under these routes, on the Explorer template unless stated:

| Legacy route | New route | Note |
|---|---|---|
| `/glossary`, `/glossary/[id]` | `/mdm/glossary`, `/mdm/glossary/[id]` | |
| `/golden-records`, `/golden-records/[id]`, `/golden-records/merge` | `/mdm/golden`, `/mdm/golden/[id]`, `/mdm/golden/merge` | Merge links to `/insights/duplicates`. |
| `/match-rules*` | `/mdm/match-rules` | |
| `/business-process`, `/process`, `/process/designer` | `/insights/process` (Report), `/insights/process/designer` | |
| `/lineage`, `/relationships` | `/insights/lineage` (Report) | One page, two tabs. |
| `/mining` | `/insights/mining` (Report) | |
| `/migration` | `/insights/readiness` | Folded into the cockpit. |
| `/analytics` | `/insights/forecast` (Report) | DQS forecast. |
| `/contracts` | `/rules/contracts` | Data contracts beside rule packs. |
| `/reports` | `/insights` | The index lists generated reports. |
| `/exceptions*` | `/inbox?kind=exception` | Exceptions are inbox items with a kind filter. |
| `/settings/exception-billing` | `/admin/billing` | |
| `/settings/scoring` | `/rules/scoring` | DQS weights and caps. |
| `/notifications` | job tray plus `/inbox` | No page. |
| `/command-centre` (live) | `/home/basis` | Live section on the Basis home. |
| `/versions` | `/runs` | |

The rail gains an **MDM** section between Fix and Inbox for `/mdm/*`.

Legacy routes under `app/(dashboard)/*` keep working during the waves. A single adapter layout `app/(dashboard)/layout.tsx` renders the legacy page inside the new shell from Wave 1 day one. When a page is rebuilt, its legacy route becomes a `next.config.ts` redirect to the new route and the legacy files are deleted. The nine redirect-shim pages that exist today are replaced by `next.config.ts` redirects in Wave 1.

### 3.2 Shell

- **Left rail.** 56px collapsed, 240px expanded; state in `localStorage` under `meridian:rail`. Sections in order: Home, Objects, Runs, Fix, Inbox, Insights, Systems, Rules, Admin. Fix and Inbox show badge counts from one `GET /api/shell/counts` call, refreshed on the SSE events that change them. Role and licence gating reuses `visibleNav()` from `lib/nav.ts`, which is repointed at the new route list.
- **Top bar.** Breadcrumb, global search (keyboard `/`), run selector, job tray, theme toggle, user menu.
- **Breadcrumb.** Built by `useDrill()` from the URL. Each crumb carries the search params that were active when it was visited, so returning to an ancestor restores its filters. Crumbs are links.
- **Run selector.** Shows the pinned baseline and the latest run. Every page that reads run-scoped data reads `?run=` from the URL; when absent it uses the latest run. Changing the selector rewrites `?run=` on the current URL.
- **Job tray.** Replaces the job rail. One SSE stream, one query key per job. A finished job invalidates only the query keys listed in its payload's `touches` field (section 9.1).
- **Command palette.** Keyboard `⌘K`. Reuses the nav list plus recent records and runs.

### 3.3 Page templates

Four templates in `frontend/design/templates/`. Every page uses exactly one.

- **Home.** A header with the persona's headline figure and delta, then tiles that each link to one Explorer with filters applied, then one or two lists.
- **Explorer.** Filter bar, summary strip, table, detail drawer. The table is the TanStack table kit; the drawer opens on row click and shows the row's detail without leaving the page. A "Open" action in the drawer goes to the full page.
- **Record.** Header with key, object and status, then the fix sheet layout (section 7).
- **Report.** Narrative paragraph, charts, tables, export action. Every chart point links to the Explorer with the matching filter.

### 3.4 Design system package

`frontend/design/` replaces `lib/aurora`, `components/aurora`, `components/ui-core` and `app/styles/ui-core.css`, `app/styles/aurora.css`.

```
frontend/design/
  tokens.css          colour, type, space, radius, elevation, motion; light and dark
  tokens.ts           typed access to the same values for charts and inline styles
  primitives/         Button, IconButton, Field, Select, Combobox, Pill, Badge, Tabs,
                      Drawer, Dialog, Menu, Toast, Tooltip, Skeleton, EmptyState,
                      ErrorState, Mono, Delta, Stat, SeverityDot, ScoreRing
  table/              DataTable (TanStack table + virtual), column helpers, Pager,
                      BulkBar, row drawer wiring
  charts/             Line, Bar, Waterfall, Radar, Heatmap, Sparkline, built on recharts
                      with one theme and one onPointClick contract
  templates/          HomePage, ExplorerPage, RecordPage, ReportPage
  shell/              Rail, TopBar, Breadcrumb, RunSelector, JobTray, CommandPalette
  index.ts            the only import path pages use: "@/design"
```

Pages import from `@/design` only. `npm run lint:tokens` is repointed at `frontend/design/tokens.css` as the single allowed source of raw colour values; the allowlist is emptied. Legacy token files stay until Wave 3 ends, then are deleted together with the lint allowlist entries that cover them.

## 4. Visual system

Mode stays "operate": dense, scannable, keyboard-friendly, presentable to a sponsor. The identity changes from a paper ledger to an instrument panel: a cool slate canvas, white sheets, near-black ink, one indigo accent for selection and links, and hue reserved for defect state.

### 4.1 Colour

Light values first. Dark values under `:root[data-theme="dark"]` and under `prefers-color-scheme: dark` when no theme is set.

| Role | Token | Light | Dark |
|---|---|---|---|
| Canvas | `--m-canvas` | `#EDF0F2` | `#0F1417` |
| Sheet | `--m-sheet` | `#FFFFFF` | `#171D21` |
| Sheet raised | `--m-sheet-raised` | `#F7F9FA` | `#1E262B` |
| Hairline | `--m-line` | `#D5DBE0` | `#2C363D` |
| Ink | `--m-ink` / `--m-ink-2` / `--m-ink-3` | `#101418` / `#3C4852` / `#5C6872` | `#E8EDF0` / `#AEB9C2` / `#84909A` |
| Accent | `--m-accent` | `#2D3A8C` | `#8C9BEA` |
| Accent soft | `--m-accent-soft` | `#E4E8FA` | `#242C52` |
| Critical | `--m-critical` | `#B3261E` | `#F28B82` |
| High | `--m-high` | `#C65A00` | `#F0A35C` |
| Medium | `--m-medium` | `#8A6A00` | `#D9B64A` |
| Low | ink-3 ring, no hue | | |
| Pass | `--m-pass` | `#1E7A46` | `#6CCB8E` |
| Chart series | `--m-viz-1..8` | eight hues chosen for distinguishability on both canvases; critical and high keep their own hues in every chart | |

Rules: colour never decorates. Charts give hue to critical and high only; medium and low are ink at 60% and 35%. No gradients, no glass, no blur. Selection and focus are accent. Delta up is pass, delta down is critical, in both text and sparkline endpoint.

### 4.2 Type

- UI: **Public Sans**, loaded with `next/font`. Weights 400, 500, 600.
- SAP identifiers: **JetBrains Mono**, weight 400 and 500, used only for check IDs, `TABLE.FIELD`, record keys, run IDs and sample values. Its zero is distinguishable from O.
- Root 13px. Scale: page title 24/30 600; section title 15/20 600; drawer title 17/24 600; body and table 13/18; meta 12/16; stat value 22/28 600; hero figure 40/48 600; score ring 48.
- Tabular figures for all numbers. Sentence case. No all-caps labels, no arrows on links.

### 4.3 Space, shape, motion

- 4px grid, `--m-space-1..24`. Page gutter `space-6`, `space-3` under 720px.
- Radii: `--m-radius-control` 4px, `--m-radius-sheet` 6px. Chips and pills are the only rounded-full shapes.
- Elevation: hairline border on sheets; shadow only on drawer, dialog, menu, palette.
- Motion: 120ms ease-out for drawer and menu, none for tables. `prefers-reduced-motion` disables all.

### 4.4 State encoding

Every status has a shape as well as a hue: critical is a filled square, high a filled triangle, medium a filled circle, low a ring, pass a check. Delta chips show sign, value and the run they compare to. Readiness is a three-state pill: Go, At risk, No-go.

## 5. The drill contract

Every number on every page follows one path:

```
score (object or dimension)
  → dimension (completeness, accuracy, consistency, timeliness, uniqueness, validity)
    → rule (one check id)
      → records (failing rows for that rule, filtered)
        → record (fix sheet)
```

Implementation:

- A `DrillLink` component takes `{object, dimension?, ruleId?, filters?}` and renders the correct href with `?run=` and the filters as search params.
- Every chart in `design/charts` takes `onPointClick(point)`; the Report template maps a point to a `DrillLink` target.
- Every Stat and tile is a `DrillLink`.
- The Explorer template reads its filters from the URL, so a drill target is a plain link, shareable, and survives reload.
- `useDrill()` reads the URL and returns `{crumbs, up, next}`. Crumbs include the filters that were active on each ancestor.

## 6. Persona homes

### 6.1 Programme lead (`/home/lead`)

- Headline: overall readiness (Go / At risk / No-go count per wave) and the DQS with delta since the pinned baseline.
- Tiles: objects by readiness, blockers open, money at risk, batches awaiting approval, days to next wave gate.
- Lists: top regressions since last run (from the run diff), objects with no owner.
- Narrative: three sentences generated deterministically from the diff (what improved, what regressed, what blocks the next wave). The LLM is not used here.

### 6.2 Data steward (`/home/steward`)

- Headline: my open items, items due this week, fixed since last run.
- Tiles: inbox by severity, batches in draft, records assigned to me, rules I own.
- Lists: next ten records to work (sorted by SLA, then severity), recently fixed with reconciliation status.
- Keyboard: `j`/`k` moves through the list, `enter` opens the fix sheet.

### 6.3 SAP functional / Basis (`/home/basis`)

- Headline: systems healthy / degraded / down, last extraction per system with duration.
- Tiles: extractions failed in 7 days, tables that hit a size or buffer limit, rule packs disabled, mappings missing.
- Lists: recent extraction runs with the decisive error line, configuration drift events.

## 7. Record fix sheet

Route `/objects/[object]/records/[key]`. Template Record.

Layout, top to bottom:

1. **Header.** Key in mono, description, object, plant or organisational level selector where the object has one, status pill (passing, failing, in batch, fixed), owner, links to open in SAP GUI (transaction and key copied to clipboard) and to the duplicate graph if the record has candidates.
2. **Failing rules strip.** One chip per failing rule with severity shape, rule id, short message. Clicking a chip scrolls to the field in the sheet.
3. **Fix sheet table.** One row per field the rules touch, grouped by SAP view (basic data, purchasing, plant, accounting). Columns: field (`TABLE.FIELD` mono), current value, proposed value (from the rule's auto-fix or the steward's edit), evidence (rule id, why), source (rule, steward, manual), confidence, golden value from master sources when one exists. Proposed cells are editable. Accepting a proposal adds the record to the open draft batch for the object, or creates one.
4. **History.** Runs in which this record failed or passed, batches it was in, reconciliation results.
5. **Related.** Supersession chain, BOM usage, open purchase orders and sales orders that reference the record (counts, linking to the Explorer filtered by document).

Data: `GET /api/materials/{matnr}` family already exists for material master; the same shape is generalised as `GET /api/objects/{object}/records/{key}` returning `{header, failing_rules, fields[], history[], related}`. Material master is the first implementation; business partner follows in Wave 3.

## 8. Insights

Every insight page uses the Report template and reads `?run=` and `?baseline=`.

### 8.1 Migration-readiness cockpit (`/insights/readiness`)

- Grid: rows are S/4 objects, columns are waves. Each cell is Go, At risk or No-go, computed from blockers (critical findings on fields the migration mapping marks mandatory) and from the object's DQS against a threshold set in `/rules`.
- Click a cell: the Explorer for that object filtered to blocking rules.
- Side panel: blockers by owner, days to gate, trend of blockers per run.
- Export: PDF with the grid and the blockers list.

### 8.2 Process impact (`/insights/impact`)

- Reads `config_impact_results`. Table of SAP features (MIGO, VA01, F110 and others from the 52 rules) with status blocked or degraded, the findings that cause it, record count, and value at risk.
- Value at risk is the sum of a configured value per record per feature (set in `/rules`, default from the seed) times blocked records. The computation is deterministic and the formula is shown on the page.
- Click a feature: the Explorer filtered to the causing rules.

### 8.3 Owner scorecards (`/insights/owners`)

- One card per owner (steward or team): score, delta, open items by severity, fixed since baseline, oldest item age.
- Narrative digest per owner, deterministic, three sentences.
- Schedule: weekly email of the digest per owner through the existing notifications service. The page shows the schedule and the last send.

### 8.4 Duplicate graph (`/insights/duplicates`)

- Force-directed graph of duplicate candidate clusters for the selected object, built on the existing `getMaterialDuplicates` shape. Node size is reference count (open POs, SOs, BOMs). Edge label is the match score.
- Select a cluster: panel with pick-from-master per field, the merge's impact (documents that would move), and an action that creates a merge proposal in a batch.

### 8.5 Executive report (`/insights/exec`)

- The current executive report rebuilt on the Report template with the readiness grid, run diff waterfall, impact table, owner table and narrative. Printable through the existing PDF worker. Schedulable weekly.

### 8.6 Run diff (`/runs/[a]/vs/[b]`)

- Waterfall chart: baseline score, plus fixed, minus new, minus regressed, equals current. Each bar links to the records in that class.
- Table of rules with count delta and a sparkline over the last ten runs.
- Field correlation: for regressed rules, the fields whose values changed most between the two runs, from `compareRecords`.

## 9. Data and state

### 9.1 Queries and events

- React Query stays. Query keys are typed per entity in `lib/query-keys.ts`: `['object', id, run]`, `['rule', id, run]`, `['records', object, filters]`, `['run', id]`, `['batch', id]`, `['inbox', filters]`, `['systems']`, `['shell-counts']`.
- The SSE job stream carries `touches: string[]` listing the entity prefixes a job changed. The job tray calls `invalidateQueries` for those prefixes only. If `touches` is absent, nothing is invalidated and a toast offers "Refresh".
- The API side adds `touches` to the job payload in `api/routes/events.py` (run_checks touches `object`, `rule`, `records`, `run`, `shell-counts`; run_sync touches `systems`, `run`; batch operations touch `batch`, `inbox`, `shell-counts`).
- Polling fallback stays at 15s for the jobs list only.

### 9.2 URL as state

- Filters, sort, page, selected row and `run` live in search params through `hooks/use-url-state.ts`, extended with typed schemas per Explorer.
- No global client store. Rail state and home override are the only `localStorage` keys.

### 9.3 Tables

- `DataTable` wraps TanStack table and virtualiser. Client-side for under 5,000 rows; server-side paging, sort and filter above that, using the existing paged endpoints. Every Explorer declares which mode it uses.
- Row drawer reads the row's detail query; the table does not refetch when the drawer opens.

### 9.4 API additions

| Endpoint | Purpose |
|---|---|
| `GET /api/shell/counts` | Badge counts for Fix and Inbox. |
| `GET /api/objects` | Objects with score, delta, blockers, owner, readiness for a run. |
| `GET /api/objects/{object}` | Dimension scores, rules, trend. |
| `GET /api/objects/{object}/records/{key}` | Record fix sheet payload. |
| `GET /api/insights/readiness` | Readiness grid. |
| `GET /api/insights/owners` | Owner scorecards and digests. |
| `GET /api/runs/{id}/steps` | Steps, durations and error text per run (persists what today is only in the worker log). |

All are tenant-scoped through the existing middleware. Existing endpoints are reused wherever they already return the shape; the new ones compose them server-side so pages make one call.

## 10. Error handling and empty states

- Every Explorer and Report has three designed states: loading skeleton with the page's real layout, empty state that names what would appear and the action that produces it (connect a system, run an analysis), and error state that shows the API's message and a retry.
- Run and extraction pages show the decisive error line from the worker, stored by the new steps endpoint, so a Basis user does not read logs.
- Network errors in the job stream back off and show a dot in the job tray; they never block the page.
- Mutations (accept, approve, export, edit) are optimistic only where the API returns the final state in the response; otherwise they wait and disable the control.

## 11. Freeze fixes (Wave 0)

Shipped alone on the current shell before any new code:

1. `hooks/use-jobs.ts`: replace the predicate that invalidates every non-jobs query with invalidation of the keys named in the job's `touches` field. Until the API sends `touches`, invalidate only the keys that a run changes today: `issues`, `issue`, `version`, `versions`, `system-versions`, `material`, `config-impact`, `pilot-scorecard`, `notifications-unread-count`.
2. `components/shell/tab-bodies.tsx`: add entries for `/analyse/coverage` (`components/analyse/coverage` `RuleCoverage`) and `/process/designer` (`components/process/designer/page` `ProcessDesigner`). `WorkspaceHub` renders nothing when a tab has no entry, which is why these two tabs are blank.
3. Tables above 2,000 rows that are not virtualised switch to the existing virtualiser.

## 12. Waves

| Wave | Scope | Exit |
|---|---|---|
| 0 | Section 11. | No freeze on job completion; no blank tab. |
| 1 | Design package, shell, templates, adapter layout, persona homes, `/objects`, `/objects/[object]`, rule page, record fix sheet for material master, `/runs`, run page, run diff. API: shell counts, objects, record, steps. | Every legacy page renders inside the new shell. Drill contract works end to end for material master. |
| 2 | Insights: readiness, impact, owners, duplicates, executive report. Scheduled digests. | Each insight page's chart points drill to rows. |
| 3 | Fix batches, inbox, MDM pages, remaining insights (process, lineage, mining, forecast), contracts, scoring, billing, systems, extractions, import, rules, admin, search, business partner record. Delete legacy shell, Aurora, ui-core, legacy routes and lint allowlist. | No file imports from `lib/aurora`, `components/aurora`, `components/ui-core`. `npm run lint:tokens` passes with an empty allowlist. |

## 13. Testing

- Design package: a Storybook-free visual check page at `/design` in development only, rendering every primitive in both themes; removed from production builds.
- Unit: `vitest` for `useDrill`, `DrillLink` href building, URL state schemas, delta and readiness computations, narrative generation.
- Component: React Testing Library for DataTable (sort, filter, drawer open without refetch), JobTray (invalidates only touched keys), RunSelector (rewrites `?run=`).
- API: pytest for each new endpoint with tenant isolation checks, plus a test that run_checks and run_sync emit `touches`.
- End to end: one Playwright journey per persona: lead opens readiness and reaches a failing record in three clicks; steward accepts a proposal and sees the batch; Basis opens a failed extraction and reads the error line.
- Performance budget: Explorer first render under 1s with 5,000 rows on the reference laptop; no React Query refetch storm on job completion (asserted in the JobTray test).

## 14. Out of scope

Micro-frontends, per-page feature flags (wave order is the flag), offline cache, a mobile layout beyond "usable at 400px", theming beyond light and dark, and LLM-written narratives (all narratives are deterministic).
